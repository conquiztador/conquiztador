import { ALL_POWER_UPS, Difficulty, NO_POWER_UPS, RoomSettings, RoomView, ServerMessage } from "@conquiztador/core";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Lobby, Member, Room, RoomError } from "./rooms.js";

class FakeMember implements Member {
    inbox: ServerMessage[] = [];
    constructor(readonly user: { uuid: string; displayName: string; points: number }) {}
    send(m: ServerMessage) {
        this.inbox.push(m);
    }
    lastRoom(): RoomView | undefined {
        for (let i = this.inbox.length - 1; i >= 0; i--) {
            const m = this.inbox[i];
            if (m.type === "room") return m.room;
        }
    }
    last<T extends ServerMessage["type"]>(type: T) {
        return [...this.inbox].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
    }
}

const SETTINGS: RoomSettings = { rounds: 5, placement: "draft", seats: 3, language: "en", powerUps: ALL_POWER_UPS };
const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(options: ConstructorParameters<typeof Lobby>[0] = {}) {
    const lobby = new Lobby({ countdownMs: 40, ...options });
    const make = (name: string) => {
        const m = new FakeMember({ uuid: `u-${name}`, displayName: name, points: 0 });
        lobby.connect(m);
        return m;
    };
    return { lobby, alice: make("alice"), bob: make("bob"), carol: make("carol") };
}

async function rejects(promise: Promise<unknown> | (() => unknown), code: string) {
    try {
        await (typeof promise === "function" ? promise() : promise);
    } catch (e) {
        assert.ok(e instanceof RoomError, `expected RoomError, got ${e}`);
        assert.equal(e.code, code);
        return;
    }
    assert.fail(`expected ${code}`);
}

describe("lobby rooms", () => {
    it("creates a room with the author in seat 0 and lists it", async () => {
        const { lobby, alice, bob } = setup();
        lobby.watch(bob);
        const room = await lobby.create(alice, { name: " Alice's room ", settings: SETTINGS });
        await tick();
        const view = alice.lastRoom()!;
        assert.equal(view.name, "Alice's room");
        assert.equal(view.seats.length, 3);
        assert.deepEqual(view.seats[0], { kind: "open", player: { uuid: "u-alice", displayName: "alice" } });
        assert.equal(view.authorUuid, "u-alice");
        const list = bob.last("rooms")!.rooms;
        assert.equal(list.length, 1);
        assert.deepEqual(
            { id: list[0].id, author: list[0].author, filled: list[0].filled, hasPassword: list[0].hasPassword },
            { id: room.id, author: "alice", filled: 1, hasPassword: false }
        );
    });

    it("lets players join open seats until full", async () => {
        const { lobby, alice, bob, carol } = setup();
        const room = await lobby.create(alice, { name: "r", settings: { ...SETTINGS, seats: 2 } });
        await lobby.join(bob, room.id);
        assert.equal(alice.lastRoom()!.seats[1].kind, "open");
        await rejects(lobby.join(carol, room.id), "room_full");
        await rejects(lobby.join(bob, room.id), "already_in_room");
        await rejects(lobby.join(carol, "nope"), "room_not_found");
    });

    it("checks passwords and never lists them", async () => {
        const { lobby, alice, bob, carol } = setup();
        const room = await lobby.create(alice, { name: "r", password: "secret", settings: SETTINGS });
        assert.equal(lobby.summaries()[0].hasPassword, true);
        assert.ok(!JSON.stringify(lobby.summaries()).includes("secret"));
        await rejects(lobby.join(bob, room.id), "wrong_password");
        await rejects(lobby.join(bob, room.id, "guess"), "wrong_password");
        await lobby.join(carol, room.id, "secret");
        assert.equal(lobby.roomOfUser("u-carol"), room);
    });

    it("only the author changes settings and seats", async () => {
        const { lobby, alice, bob } = setup();
        const room = await lobby.create(alice, { name: "r", settings: SETTINGS });
        await lobby.join(bob, room.id);
        await rejects(() => lobby.updateSettings(bob, { rounds: 7 }), "not_author");
        await rejects(() => lobby.setSeat(bob, 2, { kind: "bot", difficulty: Difficulty.Easy }), "not_author");
        lobby.updateSettings(alice, { rounds: 7, language: "bg" });
        assert.equal(bob.lastRoom()!.settings.rounds, 7);
        assert.equal(bob.lastRoom()!.settings.language, "bg");
    });

    it("defaults power-ups to one of each kind", async () => {
        const { lobby, alice } = setup();
        const { rounds, placement, seats, language } = SETTINGS;
        await lobby.create(alice, { name: "r", settings: { rounds, placement, seats, language } });
        assert.deepEqual(alice.lastRoom()!.settings.powerUps, ALL_POWER_UPS);
        assert.deepEqual(ALL_POWER_UPS, {
            mode: "oneEach",
            kinds: ["fiftyFifty", "rangeFinder", "fortify", "extraTime", "scout"],
        });
    });

    it("accepts any round count from 1 to 15 and valid power-up settings", async () => {
        const { lobby, alice, bob } = setup();
        await lobby.create(alice, { name: "r", settings: SETTINGS });
        for (const rounds of [1, 4, 15]) {
            lobby.updateSettings(alice, { rounds });
            assert.equal(alice.lastRoom()!.settings.rounds, rounds);
        }
        for (const rounds of [0, 16, 2.5]) await rejects(() => lobby.updateSettings(alice, { rounds }), "invalid");
        assert.equal(alice.lastRoom()!.settings.rounds, 15, "a refused change changes nothing");

        lobby.updateSettings(alice, { powerUps: { mode: "reward", kinds: ["scout", "scout", "fortify"] } });
        assert.deepEqual(alice.lastRoom()!.settings.powerUps, { mode: "reward", kinds: ["scout", "fortify"] });
        lobby.updateSettings(alice, { powerUps: NO_POWER_UPS });
        assert.deepEqual(alice.lastRoom()!.settings.powerUps, NO_POWER_UPS);
        await rejects(() => lobby.updateSettings(alice, { powerUps: { mode: "random", kinds: [] } }), "invalid");
        await rejects(lobby.create(bob, { name: "r", settings: { ...SETTINGS, rounds: 99 } }), "invalid");
        assert.equal(lobby.roomOfUser("u-bob"), undefined);
    });

    it("turns seats into bots with names and difficulties", async () => {
        const { lobby, alice } = setup();
        await lobby.create(alice, { name: "r", settings: SETTINGS });
        lobby.setSeat(alice, 1, { kind: "bot", difficulty: Difficulty.Easy });
        lobby.setSeat(alice, 2, { kind: "bot", difficulty: Difficulty.Hard });
        lobby.setSeat(alice, 2, { kind: "bot", difficulty: Difficulty.Medium });
        const seats = alice.lastRoom()!.seats;
        assert.deepEqual(seats[1], { kind: "bot", difficulty: Difficulty.Easy, name: "Asparuh" });
        assert.deepEqual(seats[2], { kind: "bot", difficulty: Difficulty.Medium, name: "Krum" });
        lobby.setSeat(alice, 1, { kind: "open" });
        assert.deepEqual(alice.lastRoom()!.seats[1], { kind: "open", player: null });
        await rejects(() => lobby.setSeat(alice, 0, { kind: "bot", difficulty: Difficulty.Easy }), "invalid");
        await rejects(() => lobby.setSeat(alice, 4, { kind: "open" }), "invalid");
    });

    it("making an occupied seat a bot removes its player", async () => {
        const { lobby, alice, bob } = setup();
        const room = await lobby.create(alice, { name: "r", settings: SETTINGS });
        await lobby.join(bob, room.id);
        lobby.setSeat(alice, 1, { kind: "bot", difficulty: Difficulty.Hard });
        assert.deepEqual(bob.last("roomLeft"), { type: "roomLeft", roomId: room.id, reason: "removed" });
        assert.equal(lobby.roomOfUser("u-bob"), undefined);
        assert.equal(alice.lastRoom()!.seats[1].kind, "bot");
    });

    it("resizes seats, keeping players", async () => {
        const { lobby, alice, bob } = setup();
        const room = await lobby.create(alice, { name: "r", settings: { ...SETTINGS, seats: 5 } });
        lobby.setSeat(alice, 1, { kind: "bot", difficulty: Difficulty.Easy });
        await lobby.join(bob, room.id); // seat 2
        lobby.updateSettings(alice, { seats: 2 });
        const seats = alice.lastRoom()!.seats;
        assert.equal(seats.length, 2);
        assert.ok(seats.every((s) => s.kind === "open" && s.player));
        lobby.updateSettings(alice, { seats: 4 });
        assert.equal(alice.lastRoom()!.seats.length, 4);
    });

    it("locks only when full, counts down, then starts", async () => {
        const started: Room[] = [];
        const { lobby, alice, bob } = setup({ onStart: (r) => started.push(r) });
        const room = await lobby.create(alice, { name: "r", settings: { ...SETTINGS, seats: 3 } });
        lobby.setSeat(alice, 2, { kind: "bot", difficulty: Difficulty.Easy });
        await rejects(() => lobby.lock(alice), "invalid");
        await lobby.join(bob, room.id);
        await rejects(() => lobby.lock(bob), "not_author");
        lobby.lock(alice);
        const view = bob.lastRoom()!;
        assert.equal(view.status, "countdown");
        assert.ok(view.countdownMs! > 0 && view.countdownMs! <= 40);
        await rejects(() => lobby.updateSettings(alice, { rounds: 3 }), "room_locked");
        await wait(60);
        assert.equal(bob.lastRoom()!.status, "playing");
        assert.deepEqual(started, [room]);
    });

    it("cancels the countdown when someone leaves or the author unlocks", async () => {
        const started: Room[] = [];
        const { lobby, alice, bob, carol } = setup({ onStart: (r) => started.push(r) });
        const room = await lobby.create(alice, { name: "r", settings: { ...SETTINGS, seats: 2 } });
        await lobby.join(bob, room.id);
        lobby.lock(alice);
        await rejects(lobby.join(carol, room.id), "room_locked");
        lobby.leave(bob);
        assert.equal(alice.lastRoom()!.status, "waiting");

        await lobby.join(bob, room.id);
        lobby.lock(alice);
        await rejects(() => lobby.unlock(bob), "not_author");
        lobby.unlock(alice);
        assert.equal(alice.lastRoom()!.status, "waiting");
        await wait(60);
        assert.deepEqual(started, []);
    });

    it("hands authorship over and closes empty rooms", async () => {
        const { lobby, alice, bob, carol } = setup();
        lobby.watch(carol);
        const room = await lobby.create(alice, { name: "r", settings: SETTINGS });
        await lobby.join(bob, room.id);
        lobby.leave(alice);
        assert.equal(bob.lastRoom()!.authorUuid, "u-bob");
        lobby.leave(bob);
        await tick();
        assert.equal(lobby.rooms.size, 0);
        assert.deepEqual(carol.last("rooms")!.rooms, []);
    });

    it("a disconnect leaves the room; a replaced connection does not", async () => {
        const { lobby, alice, bob } = setup();
        const room = await lobby.create(alice, { name: "r", settings: SETTINGS });
        await lobby.join(bob, room.id);

        const bob2 = new FakeMember(bob.user);
        assert.equal(lobby.connect(bob2), bob);
        assert.equal(bob2.lastRoom()!.id, room.id); // resumes the room view
        lobby.disconnect(bob); // the old tab closing changes nothing
        assert.equal(lobby.roomOfUser("u-bob"), room);

        lobby.disconnect(bob2);
        assert.equal(lobby.roomOfUser("u-bob"), undefined);
        assert.deepEqual(alice.lastRoom()!.seats[1], { kind: "open", player: null });
    });

    it("hides private rooms from the list", async () => {
        const { lobby, alice } = setup();
        await lobby.create(alice, { name: "solo", settings: SETTINGS, private: true });
        assert.deepEqual(lobby.summaries(), []);
    });
});
