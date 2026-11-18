import {
    ALL_POWER_UPS,
    DEFAULT_CONFIG,
    Difficulty,
    GameConfig,
    PlayerId,
    POINT_VALUES,
    PointsReason,
    PointsTally,
    SoloSettings,
    ErrorCode,
    PublicUser,
    ROOM_COUNTDOWN_MS,
    RoomLeftReason,
    RoomSettings,
    RoomStatus,
    RoomSummary,
    RoomView,
    SeatSetting,
    SeatView,
    ServerMessage,
} from "@conquiztador/core";
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";

import type { DjangoClient } from "./django.js";
import { NoQuestionsError } from "./django.js";
import { isAborted, Match, MatchTiming } from "./match.js";

/** A logged-in user's current connection, as the lobby sees it. */
export interface Member {
    readonly user: PublicUser;
    send(message: ServerMessage): void;
}

/** A request the lobby refuses; reported to the client as an `error`. */
export class RoomError extends Error {
    constructor(
        readonly code: ErrorCode,
        message: string
    ) {
        super(message);
    }
}

export const BOT_NAMES = ["Asparuh", "Krum", "Simeon", "Samuil"] as const;

type Seat =
    | { kind: "open"; player: { uuid: string; displayName: string } | null }
    | { kind: "bot"; difficulty: Difficulty; name: string };

export interface Room {
    readonly id: string;
    readonly name: string;
    /** scrypt hash; null for open rooms. */
    readonly password: { salt: Buffer; hash: Buffer } | null;
    /** Hidden from the room list (single-player). */
    readonly private: boolean;
    authorUuid: string;
    status: RoomStatus;
    settings: RoomSettings;
    seats: Seat[];
    countdownEndsAt: number | null;
    countdownTimer: NodeJS.Timeout | null;
    match: Match | null;
    /** Players offline mid-match, with the timer that hands their seat to a bot. */
    offline: Map<string, NodeJS.Timeout>;
}

export interface LobbyOptions {
    countdownMs?: number;
    /** Called when a room's match starts (tests). */
    onStart?: (room: Room) => void;
    /** Questions and points. Without it, rooms reach "playing" but no match runs (tests). */
    django?: Pick<DjangoClient, "deck" | "award">;
    matchTiming?: Partial<MatchTiming>;
    /** Answer time per question; defaults to the engine's (tests shorten it). */
    timeLimitMs?: number;
    /** How long a player who dropped mid-match keeps their seat. */
    reconnectMs?: number;
}

/** Room settings as a caller may give them: power-ups default to all kinds, one each. */
export type RoomSettingsInput = Omit<RoomSettings, "powerUps"> & Partial<Pick<RoomSettings, "powerUps">>;
export type SoloSettingsInput = Omit<SoloSettings, "powerUps"> & Partial<Pick<SoloSettings, "powerUps">>;

/** Default supply for new rooms and single-player (agents.md §2.5). */
export const DEFAULT_POWER_UPS = ALL_POWER_UPS;

/** Validates settings (the protocol schema), copying them so callers can't mutate the room's. */
function checkSettings(settings: RoomSettingsInput): RoomSettings {
    const parsed = RoomSettings.safeParse({ ...settings, powerUps: settings.powerUps ?? DEFAULT_POWER_UPS });
    if (!parsed.success) throw new RoomError("invalid", parsed.error.issues[0]?.message ?? "Invalid settings");
    const { powerUps } = parsed.data;
    return { ...parsed.data, powerUps: { mode: powerUps.mode, kinds: [...new Set(powerUps.kinds)] } };
}

/** agents.md §2.8 */
export const RECONNECT_MS = 60_000;

const KEY_LENGTH = 32;

function hashPassword(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) =>
        scrypt(password, salt, KEY_LENGTH, (err, key) => (err ? reject(err) : resolve(key)))
    );
}

/**
 * Rooms live in memory (agents.md §2.6, §2.8). Users are identified by
 * uuid; each user has at most one current connection and one room.
 */
export class Lobby {
    readonly rooms = new Map<string, Room>();
    /** user uuid → their current connection. */
    private readonly members = new Map<string, Member>();
    /** user uuid → the room they sit in. */
    private readonly roomOf = new Map<string, Room>();
    private readonly watchers = new Set<string>();
    private listDirty = false;
    private readonly countdownMs: number;

    constructor(private readonly options: LobbyOptions = {}) {
        this.countdownMs = options.countdownMs ?? ROOM_COUNTDOWN_MS;
    }

    // ------------------------------------------------------------ connections

    /**
     * Registers a freshly authenticated connection. Returns the connection it
     * replaces (same user, e.g. a second tab), which the caller closes.
     */
    connect(member: Member): Member | null {
        const previous = this.members.get(member.user.uuid) ?? null;
        this.members.set(member.user.uuid, member);
        const room = this.roomOf.get(member.user.uuid);
        if (room) {
            member.send({ type: "room", room: this.view(room) });
            // Back within the reconnect window: pick the match up again.
            const timer = room.offline.get(member.user.uuid);
            if (timer) {
                clearTimeout(timer);
                room.offline.delete(member.user.uuid);
            }
            room.match?.resume(member.user.uuid);
        }
        return previous === member ? null : previous;
    }

    /** A connection closed. Ignored if the user has already reconnected. */
    disconnect(member: Member): void {
        const uuid = member.user.uuid;
        if (this.members.get(uuid) !== member) return;
        this.members.delete(uuid);
        this.watchers.delete(uuid);
        const room = this.roomOf.get(uuid);
        if (!room) return;
        if (room.status !== "playing") {
            // Before a match, a disconnect is a leave.
            this.leave(member, "left");
            return;
        }
        // Mid-match: keep the seat for a while; questions time out meanwhile.
        room.offline.set(
            uuid,
            setTimeout(() => {
                room.offline.delete(uuid);
                if (this.roomOf.get(uuid) === room && !this.members.has(uuid)) this.removePlayer(room, uuid, "left");
            }, this.options.reconnectMs ?? RECONNECT_MS)
        );
    }

    roomOfUser(uuid: string): Room | undefined {
        return this.roomOf.get(uuid);
    }

    // ------------------------------------------------------------ room list

    watch(member: Member): void {
        this.watchers.add(member.user.uuid);
        member.send({ type: "rooms", rooms: this.summaries() });
    }

    unwatch(member: Member): void {
        this.watchers.delete(member.user.uuid);
    }

    summaries(): RoomSummary[] {
        return [...this.rooms.values()]
            .filter((r) => !r.private)
            .map((r) => ({
                id: r.id,
                name: r.name,
                author: this.authorName(r),
                hasPassword: r.password !== null,
                status: r.status,
                settings: r.settings,
                filled: r.seats.filter(isFilled).length,
            }));
    }

    // ------------------------------------------------------------ joining

    async create(
        member: Member,
        request: { name: string; password?: string; settings: RoomSettingsInput; private?: boolean }
    ): Promise<Room> {
        this.assertNotInRoom(member);
        const settings = checkSettings(request.settings);
        let password: Room["password"] = null;
        if (request.password) {
            const salt = randomBytes(16);
            password = { salt, hash: await hashPassword(request.password, salt) };
            this.assertNotInRoom(member); // may have joined elsewhere meanwhile
        }
        const room: Room = {
            id: randomUUID(),
            name: request.name.trim(),
            password,
            private: request.private ?? false,
            authorUuid: member.user.uuid,
            status: "waiting",
            settings,
            seats: Array.from({ length: settings.seats }, (): Seat => ({ kind: "open", player: null })),
            countdownEndsAt: null,
            countdownTimer: null,
            match: null,
            offline: new Map(),
        };
        room.seats[0] = { kind: "open", player: playerOf(member) };
        this.rooms.set(room.id, room);
        this.roomOf.set(member.user.uuid, room);
        this.watchers.delete(member.user.uuid);
        this.changed(room);
        return room;
    }

    /** Single-player: a private room with bots that starts right away. */
    async startSolo(member: Member, settings: SoloSettingsInput): Promise<Room> {
        const room = await this.create(member, {
            name: "solo",
            private: true,
            settings: {
                rounds: settings.rounds,
                placement: settings.placement,
                language: settings.language,
                powerUps: settings.powerUps,
                seats: settings.bots.length + 1,
            },
        });
        settings.bots.forEach((difficulty, i) => {
            room.seats[i + 1] = { kind: "bot", difficulty, name: this.freeBotName(room) };
        });
        this.start(room);
        return room;
    }

    async join(member: Member, roomId: string, password?: string): Promise<Room> {
        this.assertNotInRoom(member);
        const room = this.findRoom(roomId);
        if (room.password) {
            if (!password) throw new RoomError("wrong_password", "This room needs a password");
            const hash = await hashPassword(password, room.password.salt);
            if (!timingSafeEqual(hash, room.password.hash))
                throw new RoomError("wrong_password", "Wrong password");
            // The room may have changed while hashing.
            this.assertNotInRoom(member);
            if (this.rooms.get(roomId) !== room) throw new RoomError("room_not_found", "Room is gone");
        }
        if (room.status !== "waiting") throw new RoomError("room_locked", "The room is locked");
        const seat = room.seats.find((s) => s.kind === "open" && s.player === null);
        if (!seat || seat.kind !== "open") throw new RoomError("room_full", "No free seats");
        seat.player = playerOf(member);
        this.roomOf.set(member.user.uuid, room);
        this.watchers.delete(member.user.uuid);
        this.changed(room);
        return room;
    }

    leave(member: Member, reason: RoomLeftReason = "left"): void {
        const uuid = member.user.uuid;
        const room = this.roomOf.get(uuid);
        if (!room) throw new RoomError("not_in_room", "You are not in a room");
        this.removePlayer(room, uuid, reason);
    }

    // ------------------------------------------------------------ author controls

    updateSettings(member: Member, patch: Partial<RoomSettings>): void {
        const room = this.authorRoom(member);
        const next = checkSettings({ ...room.settings, ...patch });
        if (next.seats !== room.settings.seats) this.resizeSeats(room, next.seats);
        room.settings = next;
        this.changed(room);
    }

    setSeat(member: Member, index: number, setting: SeatSetting): void {
        const room = this.authorRoom(member);
        const seat = room.seats[index];
        if (!seat) throw new RoomError("invalid", "No such seat");
        if (seat.kind === "open" && seat.player?.uuid === room.authorUuid)
            throw new RoomError("invalid", "You can't give away your own seat");

        if (setting.kind === "open") {
            if (seat.kind === "bot") room.seats[index] = { kind: "open", player: null };
        } else if (seat.kind === "bot") {
            seat.difficulty = setting.difficulty;
        } else {
            const removed = seat.player;
            room.seats[index] = {
                kind: "bot",
                difficulty: setting.difficulty,
                name: this.freeBotName(room),
            };
            if (removed) {
                this.roomOf.delete(removed.uuid);
                this.members.get(removed.uuid)?.send({ type: "roomLeft", roomId: room.id, reason: "removed" });
            }
        }
        this.changed(room);
    }

    lock(member: Member): void {
        const room = this.authorRoom(member);
        if (!room.seats.every(isFilled))
            throw new RoomError("invalid", "Every seat must be filled first");
        room.status = "countdown";
        room.countdownEndsAt = Date.now() + this.countdownMs;
        room.countdownTimer = setTimeout(() => this.start(room), this.countdownMs);
        this.changed(room);
    }

    unlock(member: Member): void {
        const room = this.roomOfMember(member);
        if (room.authorUuid !== member.user.uuid) throw new RoomError("not_author", "Only the room's author can do that");
        if (room.status !== "countdown") throw new RoomError("invalid", "The room isn't counting down");
        this.cancelCountdown(room);
        this.changed(room);
    }

    // ------------------------------------------------------------ views

    view(room: Room): RoomView {
        return {
            id: room.id,
            name: room.name,
            hasPassword: room.password !== null,
            authorUuid: room.authorUuid,
            status: room.status,
            settings: room.settings,
            seats: room.seats.map((s): SeatView => (s.kind === "bot" ? { ...s } : { kind: "open", player: s.player })),
            countdownMs:
                room.status === "countdown" && room.countdownEndsAt !== null
                    ? Math.max(0, room.countdownEndsAt - Date.now())
                    : null,
        };
    }

    /** Players (by uuid) seated in a room. */
    playersIn(room: Room): string[] {
        return room.seats.flatMap((s) => (s.kind === "open" && s.player ? [s.player.uuid] : []));
    }

    member(uuid: string): Member | undefined {
        return this.members.get(uuid);
    }

    /** Removes a room (e.g. after its match ends) and tells whoever is in it. */
    close(room: Room, reason: RoomLeftReason = "closed"): void {
        if (room.countdownTimer) clearTimeout(room.countdownTimer);
        room.offline.forEach(clearTimeout);
        room.offline.clear();
        for (const uuid of this.playersIn(room)) {
            if (this.roomOf.get(uuid) !== room) continue;
            this.roomOf.delete(uuid);
            this.members.get(uuid)?.send({ type: "roomLeft", roomId: room.id, reason });
        }
        this.rooms.delete(room.id);
        this.listChanged();
    }

    // ------------------------------------------------------------ internals

    private start(room: Room): void {
        room.countdownTimer = null;
        room.countdownEndsAt = null;
        room.status = "playing";
        this.changed(room);
        this.options.onStart?.(room);
        if (this.options.django) void this.playMatch(room);
    }

    /** Loads the questions, runs the match, saves points, then reopens or closes the room. */
    private async playMatch(room: Room): Promise<void> {
        const django = this.options.django;
        let deck;
        try {
            deck = await django.deck(room.settings.language);
        } catch (e) {
            const code = e instanceof NoQuestionsError ? "no_questions" : "internal";
            if (code === "internal") console.error("deck: Django unavailable", e);
            for (const uuid of this.playersIn(room))
                this.members.get(uuid)?.send({ type: "error", code, message: "Couldn't load questions" });
            this.afterMatch(room);
            return;
        }
        if (this.rooms.get(room.id) !== room) return; // everyone left meanwhile

        const match = new Match(this.gameConfig(room), deck, {
            send: (id, event) => this.members.get(id)?.send({ type: "match", event }),
        }, { timing: this.options.matchTiming });
        room.match = match;
        let points: Record<PlayerId, PointsTally> = {};
        try {
            points = (await match.run()).points;
        } catch (e) {
            if (!isAborted(e)) console.error("match failed", e);
            points = match.pointsSoFar();
        }
        room.match = null;
        await this.savePoints(match.id, points);
        this.afterMatch(room);
    }

    private gameConfig(room: Room): GameConfig {
        return {
            ...DEFAULT_CONFIG,
            rounds: room.settings.rounds,
            placement: room.settings.placement,
            powerUps: room.settings.powerUps,
            ...(this.options.timeLimitMs ? { timeLimitMs: this.options.timeLimitMs } : {}),
            players: room.seats.map((s, i) =>
                s.kind === "bot"
                    ? { id: `bot-${i + 1}`, name: s.name, kind: "bot" as const, difficulty: s.difficulty }
                    : { id: s.player.uuid, name: s.player.displayName, kind: "human" as const }
            ),
        };
    }

    private async savePoints(matchId: string, points: Record<PlayerId, PointsTally>) {
        const players = Object.entries(points)
            .map(([user, tally]) => ({
                user,
                entries: (Object.keys(tally) as PointsReason[]).map((reason) => ({
                    reason,
                    count: tally[reason],
                    amount: tally[reason] * POINT_VALUES[reason],
                })),
            }))
            .filter((p) => p.entries.some((e) => e.amount > 0));
        if (players.length === 0) return;
        // The award is idempotent per match, so retrying is safe.
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const balances = await this.options.django.award(matchId, players);
                for (const [uuid, balance] of Object.entries(balances))
                    this.members.get(uuid)?.send({ type: "balance", points: balance });
                return;
            } catch (e) {
                console.error(`points: award attempt ${attempt} failed`, e);
                await new Promise((r) => setTimeout(r, 1000 * attempt));
            }
        }
    }

    /** Multiplayer rooms reopen for a rematch; single-player rooms close. */
    private afterMatch(room: Room) {
        room.offline.forEach(clearTimeout);
        room.offline.clear();
        if (this.rooms.get(room.id) !== room) return;
        // Players still offline when the match ended lose their seat now.
        for (const uuid of this.playersIn(room))
            if (!this.members.has(uuid)) this.removePlayer(room, uuid, "left");
        if (this.rooms.get(room.id) !== room) return;
        if (room.private) {
            this.close(room, "closed");
            return;
        }
        room.status = "waiting";
        this.changed(room);
    }

    /** The room's running match, for a player who's in it. */
    matchOf(member: Member): Match {
        const room = this.roomOf.get(member.user.uuid);
        if (!room?.match) throw new RoomError("not_in_room", "You are not in a match");
        return room.match;
    }

    private cancelCountdown(room: Room): void {
        if (room.countdownTimer) clearTimeout(room.countdownTimer);
        room.countdownTimer = null;
        room.countdownEndsAt = null;
        room.status = "waiting";
    }

    private removePlayer(room: Room, uuid: string, reason: RoomLeftReason): void {
        const index = room.seats.findIndex((s) => s.kind === "open" && s.player?.uuid === uuid);
        if (room.status === "playing") {
            // Mid-match a Medium bot plays the seat on (agents.md §2.8).
            room.match?.replaceWithBot(uuid);
            if (index >= 0)
                room.seats[index] = { kind: "bot", difficulty: Difficulty.Medium, name: this.freeBotName(room) };
            const timer = room.offline.get(uuid);
            if (timer) clearTimeout(timer);
            room.offline.delete(uuid);
        } else if (index >= 0) {
            room.seats[index] = { kind: "open", player: null };
        }
        this.roomOf.delete(uuid);
        this.members.get(uuid)?.send({ type: "roomLeft", roomId: room.id, reason });

        // Anyone leaving cancels the countdown (agents.md §2.8).
        if (room.status === "countdown") this.cancelCountdown(room);

        const remaining = this.playersIn(room);
        if (remaining.length === 0) {
            room.match?.abort(); // nobody left to play for
            this.close(room);
            return;
        }
        // The next player (in seat order) becomes the author.
        if (room.authorUuid === uuid) room.authorUuid = remaining[0];
        this.changed(room);
    }

    private resizeSeats(room: Room, count: number): void {
        while (room.seats.length < count) room.seats.push({ kind: "open", player: null });
        // Shrink from the end, skipping seats that hold players.
        for (let i = room.seats.length - 1; room.seats.length > count && i >= 0; i--) {
            const s = room.seats[i];
            if (s.kind === "bot" || s.player === null) room.seats.splice(i, 1);
        }
        if (room.seats.length > count)
            throw new RoomError("invalid", "Too many players for that many seats");
    }

    private freeBotName(room: Room): string {
        const used = new Set(room.seats.flatMap((s) => (s.kind === "bot" ? [s.name] : [])));
        return BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${used.size + 1}`;
    }

    private authorName(room: Room): string {
        for (const s of room.seats)
            if (s.kind === "open" && s.player?.uuid === room.authorUuid) return s.player.displayName;
        return "";
    }

    private findRoom(roomId: string): Room {
        const room = this.rooms.get(roomId);
        if (!room) throw new RoomError("room_not_found", "Room not found");
        return room;
    }

    private roomOfMember(member: Member): Room {
        const room = this.roomOf.get(member.user.uuid);
        if (!room) throw new RoomError("not_in_room", "You are not in a room");
        return room;
    }

    /** The member's room, if they're its author and it can still be changed. */
    private authorRoom(member: Member): Room {
        const room = this.roomOfMember(member);
        if (room.authorUuid !== member.user.uuid) throw new RoomError("not_author", "Only the room's author can do that");
        if (room.status !== "waiting") throw new RoomError("room_locked", "The room is locked");
        return room;
    }

    private assertNotInRoom(member: Member): void {
        if (this.roomOf.has(member.user.uuid)) throw new RoomError("already_in_room", "Leave your current room first");
    }

    /** Sends the room to everyone in it and refreshes the room list. */
    private changed(room: Room): void {
        if (this.rooms.has(room.id)) {
            const view = this.view(room);
            for (const uuid of this.playersIn(room)) this.members.get(uuid)?.send({ type: "room", room: view });
        }
        this.listChanged();
    }

    /** Coalesces list updates from one event into one message. */
    private listChanged(): void {
        if (this.listDirty) return;
        this.listDirty = true;
        queueMicrotask(() => {
            this.listDirty = false;
            if (this.watchers.size === 0) return;
            const message: ServerMessage = { type: "rooms", rooms: this.summaries() };
            for (const uuid of this.watchers) this.members.get(uuid)?.send(message);
        });
    }
}

function isFilled(seat: Seat): boolean {
    return seat.kind === "bot" || seat.player !== null;
}

function playerOf(member: Member) {
    return { uuid: member.user.uuid, displayName: member.user.displayName };
}
