import {
    ClientMessage,
    ErrorCode,
    MatchEvent,
    PowerUpKind,
    PROTOCOL_VERSION,
    PublicUser,
    RoomSettings,
    RoomSummary,
    RoomView,
    SeatSetting,
    ServerMessage,
    SoloSettings,
} from "@conquiztador/core";

import { environment } from "src/environments/environment";
import { Messages, setLocalPlayerId } from "app/i18n";
import {
    login,
    LoginFailedError,
    logout,
    register,
    RegisterFailedError,
    savedToken,
} from "app/services/AuthService";
import { createStore } from "app/ui/store";

/** Must match the server's CloseCode. */
const CLOSE_AUTH_FAILED = 4001;
const CLOSE_REPLACED = 4004;
/** Mid-match, keep trying for a little longer than the server's 60 s window. */
const RECONNECT_DELAY_MS = 1500;
const RECONNECT_ATTEMPTS = 45;

type Text = (m: Messages) => string;

/**
 * - login/register: account forms
 * - rooms/room: multiplayer room list and room
 * - solo: waiting for a single-player match to start
 * - match: a match is on screen (the PIXI pages take over)
 */
export type Screen =
    | "closed"
    | "login"
    | "register"
    | "rooms"
    | "room"
    | "solo"
    | "match";

export interface MultiplayerState {
    screen: Screen;
    mode: "multi" | "solo";
    connection: "offline" | "connecting" | "online";
    user: PublicUser | null;
    rooms: RoomSummary[];
    room: RoomView | null;
    /** Local clock time the countdown ends, while the room counts down. */
    countdownEndsAt: number | null;
    /** A short message for the player (errors, "you were removed"…). */
    notice: Text | null;
    /** Set when the connection dropped; the screen offers to reconnect. */
    lost: Text | null;
    /** Trying to get back into a running match or room. */
    reconnecting: boolean;
    /** A login/register request is in flight. */
    busy: boolean;
}

const INITIAL: MultiplayerState = {
    screen: "closed",
    mode: "multi",
    connection: "offline",
    user: null,
    rooms: [],
    room: null,
    countdownEndsAt: null,
    notice: null,
    lost: null,
    reconnecting: false,
    busy: false,
};

export const multiplayerStore = createStore<MultiplayerState>(INITIAL);

function patch(p: Partial<MultiplayerState>) {
    multiplayerStore.set((s) => ({ ...s, ...p }));
}

function gameServerUrl(): string {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    return `${scheme}://${location.host}${environment.gameServerPath}`;
}

/**
 * The browser side of the game server connection: logs in, keeps the
 * socket, mirrors rooms into `multiplayerStore`, and hands match events to
 * the match screen.
 */
class GameClient {
    private socket: WebSocket | null = null;
    private pendingSolo: SoloSettings | null = null;
    private reconnectAttempts = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    /** Called when the player goes back to the main menu. */
    onExit: () => void = () => undefined;
    /** Receives every match event (the match screen sets this). */
    onMatchEvent: (event: MatchEvent) => void = () => undefined;
    /** The connection to a running match is gone for good. */
    onMatchLost: () => void = () => undefined;
    /** The server refused something during a match (e.g. a power-up). */
    onMatchError: (code: ErrorCode, message: string) => void = () => undefined;

    /** Opens the multiplayer screens: login first if there's no token. */
    open(): void {
        const token = savedToken();
        patch({ ...INITIAL, mode: "multi", screen: token ? "rooms" : "login" });
        if (token) this.connect(token);
    }

    /**
     * Starts a single-player match on the server (logging in first if
     * needed). The match screen appears once the server starts it.
     */
    startSolo(settings: SoloSettings): void {
        this.pendingSolo = settings;
        const token = savedToken();
        const s = multiplayerStore.get();
        patch({
            mode: "solo",
            notice: null,
            screen: token ? "solo" : "login",
        });
        if (!token) return;
        if (s.connection === "online") this.flushSolo();
        else this.connect(token);
    }

    /** Back to the main menu; closing the socket leaves any room too. */
    exit(): void {
        this.pendingSolo = null;
        this.disconnect();
        patch({ ...INITIAL, user: multiplayerStore.get().user });
        this.onExit();
    }

    showLogin(): void {
        patch({ screen: "login", notice: null });
    }

    showRegister(): void {
        patch({ screen: "register", notice: null });
    }

    async login(email: string, password: string): Promise<void> {
        await this.authenticate(
            () => login(email, password),
            (e) =>
                e instanceof LoginFailedError
                    ? (m) => m.account.loginFailed
                    : null
        );
    }

    async register(
        email: string,
        password: string,
        username: string
    ): Promise<void> {
        await this.authenticate(
            () => register(email, password, username),
            (e) => {
                if (!(e instanceof RegisterFailedError)) return null;
                const first = e.problems[0];
                return first === "username"
                    ? (m) => m.account.usernameProblem
                    : first === "password"
                    ? (m) => m.account.passwordProblem
                    : (m) => m.account.emailProblem;
            }
        );
    }

    logout(): void {
        this.disconnect();
        logout();
        patch({
            ...INITIAL,
            mode: multiplayerStore.get().mode,
            screen: "login",
        });
    }

    reconnect(): void {
        const token = savedToken();
        if (token) this.connect(token);
        else this.logout();
    }

    // Rooms ------------------------------------------------------------

    createRoom(name: string, password: string, settings: RoomSettings): void {
        this.send({
            type: "createRoom",
            name,
            password: password || undefined,
            settings,
        });
    }

    joinRoom(roomId: string, password?: string): void {
        this.send({
            type: "joinRoom",
            roomId,
            password: password || undefined,
        });
    }

    leaveRoom(): void {
        this.send({ type: "leaveRoom" });
    }

    updateSettings(settings: Partial<RoomSettings>): void {
        this.send({ type: "updateSettings", settings });
    }

    setSeat(index: number, seat: SeatSetting): void {
        this.send({ type: "setSeat", index, seat });
    }

    lock(): void {
        this.send({ type: "lockRoom" });
    }

    unlock(): void {
        this.send({ type: "unlockRoom" });
    }

    dismissNotice(): void {
        patch({ notice: null });
    }

    // Match ------------------------------------------------------------

    selectRegion(regionId: string): void {
        this.send({ type: "selectRegion", regionId });
    }

    answer(value: number): void {
        this.send({ type: "answer", value });
    }

    /** `regionId`: the region to fortify. */
    usePowerUp(kind: PowerUpKind, regionId?: string): void {
        this.send({ type: "usePowerUp", kind, regionId });
    }

    /** Quit mid-match: a bot takes the seat (agents.md §2.8). */
    quitMatch(): void {
        if (multiplayerStore.get().mode === "solo") {
            this.exit();
            return;
        }
        this.leaveRoom();
        patch({ screen: "rooms", room: null, notice: null });
        this.send({ type: "watchRooms" });
    }

    /** After the game-over screen: the menu, or play again. */
    afterMatch(choice: "menu" | "again"): void {
        const s = multiplayerStore.get();
        if (choice === "menu") {
            this.exit();
        } else if (s.mode === "solo") {
            patch({ screen: "closed" }); // the lobby page takes over
        } else {
            patch({ screen: s.room ? "room" : "rooms", notice: null });
        }
    }

    // Internals --------------------------------------------------------

    private flushSolo() {
        if (!this.pendingSolo) return;
        this.send({ type: "startSolo", settings: this.pendingSolo });
        this.pendingSolo = null;
    }

    private async authenticate(
        request: () => Promise<string>,
        explain: (e: unknown) => Text | null
    ) {
        patch({ busy: true, notice: null });
        try {
            const token = await request();
            const solo = multiplayerStore.get().mode === "solo";
            patch({ busy: false, screen: solo ? "solo" : "rooms" });
            this.connect(token);
        } catch (e) {
            console.error(e);
            patch({
                busy: false,
                notice: explain(e) ?? ((m) => m.account.serverUnreachable),
            });
        }
    }

    private connect(token: string): void {
        this.disconnect();
        patch({ connection: "connecting", lost: null });
        const socket = new WebSocket(gameServerUrl());
        this.socket = socket;

        socket.onopen = () =>
            this.send({ type: "auth", token, protocol: PROTOCOL_VERSION });
        socket.onmessage = (event) => {
            let message: ServerMessage;
            try {
                message = JSON.parse(event.data as string) as ServerMessage;
            } catch {
                return;
            }
            this.receive(message);
        };
        socket.onclose = (event) => {
            if (this.socket !== socket) return; // we closed it on purpose
            this.socket = null;
            this.onClosed(event.code);
        };
    }

    private onClosed(code: number) {
        if (code === CLOSE_AUTH_FAILED) {
            // The token no longer works: log in again.
            logout();
            patch({ ...INITIAL, screen: "login" });
            return;
        }
        const s = multiplayerStore.get();
        const inGame =
            s.screen === "match" || s.screen === "room" || s.screen === "solo";
        if (
            code !== CLOSE_REPLACED &&
            inGame &&
            this.reconnectAttempts < RECONNECT_ATTEMPTS
        ) {
            // Keep the screen; the server holds the seat for a while.
            this.reconnectAttempts++;
            patch({ connection: "offline", reconnecting: true });
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                const token = savedToken();
                if (token) this.connect(token);
            }, RECONNECT_DELAY_MS);
            return;
        }
        patch({
            connection: "offline",
            reconnecting: false,
            room: null,
            countdownEndsAt: null,
            screen:
                s.screen === "match" || s.screen === "solo"
                    ? "rooms"
                    : s.screen,
            lost:
                code === CLOSE_REPLACED
                    ? (m) => m.rooms.replaced
                    : (m) => m.rooms.disconnected,
        });
        if (s.screen === "match") this.onMatchLost();
    }

    private disconnect(): void {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        const socket = this.socket;
        this.socket = null;
        socket?.close(1000);
    }

    private send(message: ClientMessage): void {
        if (this.socket?.readyState === WebSocket.OPEN)
            this.socket.send(JSON.stringify(message));
    }

    private receive(message: ServerMessage): void {
        const s = multiplayerStore.get();
        switch (message.type) {
            case "welcome":
                this.reconnectAttempts = 0;
                patch({
                    connection: "online",
                    reconnecting: false,
                    user: message.user,
                });
                if (this.pendingSolo) this.flushSolo();
                // A room we're still in arrives as a `room` message next.
                else if (s.mode === "multi" && s.screen === "rooms")
                    this.send({ type: "watchRooms" });
                return;
            case "rooms":
                patch({ rooms: message.rooms });
                return;
            case "room": {
                const room = message.room;
                const countdownEndsAt =
                    room.countdownMs === null
                        ? null
                        : Date.now() + room.countdownMs;
                // During a match (or a solo start) the room only updates
                // in the background.
                if (s.screen === "match" || s.screen === "solo") {
                    patch({ room, countdownEndsAt });
                    return;
                }
                patch({
                    // Entering a room clears notices from the room list.
                    ...(s.screen !== "room" ? { notice: null } : {}),
                    screen: "room",
                    room,
                    countdownEndsAt,
                });
                return;
            }
            case "roomLeft":
                if (s.mode === "solo" || s.screen === "match") {
                    patch({ room: null, countdownEndsAt: null });
                    return;
                }
                patch({
                    screen: "rooms",
                    room: null,
                    countdownEndsAt: null,
                    notice:
                        message.reason === "removed"
                            ? (m) => m.rooms.removed
                            : message.reason === "closed"
                            ? (m) => m.rooms.closed
                            : null,
                });
                this.send({ type: "watchRooms" });
                return;
            case "match":
                if (message.event.kind === "started") {
                    setLocalPlayerId(message.event.you);
                    patch({ screen: "match", notice: null });
                }
                this.onMatchEvent(message.event);
                return;
            case "balance":
                if (s.user)
                    patch({ user: { ...s.user, points: message.points } });
                return;
            case "error": {
                const code = message.code;
                // The match screen shows its own errors briefly.
                if (s.screen === "match") {
                    this.onMatchError(code, message.message);
                    return;
                }
                patch({
                    notice: (m) =>
                        m.rooms.errors[code] ?? m.rooms.errors.invalid,
                });
                return;
            }
            case "pong":
                return;
        }
    }
}

export const gameClient = new GameClient();
