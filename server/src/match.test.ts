import {
    Difficulty,
    MATCH_TIMING,
    MatchEvent,
    POINT_VALUES,
    PointsTally,
    QuestionDeck,
    RoomSettings,
    ServerMessage,
} from "@conquiztador/core";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AwardPlayer } from "./django.js";
import type { MatchTiming } from "./match.js";
import { Lobby, Member } from "./rooms.js";

/** Every pause 1 ms; a human who doesn't act times out after 30 ms. */
const FAST = Object.fromEntries(Object.keys(MATCH_TIMING).map((k) => [k, 1])) as MatchTiming;
FAST.choiceMs = 30;

const DECK: QuestionDeck = {
    mcq: Array.from({ length: 5 }, (_, i) => ({
        id: `m${i}`,
        text: `Question ${i}`,
        options: ["right", "wrong 1", "wrong 2", "wrong 3"],
        correctIndex: 0,
    })),
    numeric: [{ id: "n", text: "How many?", correctValue: 42 }],
};

/**
 * A scripted human: chooses the first offered region and always picks the
 * option whose text is "right" (so we can predict their points).
 */
class Bot implements Member {
    events: MatchEvent[] = [];
    messages: ServerMessage[] = [];
    respond = true;
    private lastOptions: string[] = [];

    constructor(
        readonly user: { uuid: string; displayName: string; points: number },
        private readonly lobby: () => Lobby
    ) {}

    send(m: ServerMessage) {
        this.messages.push(m);
        if (m.type !== "match") return;
        const e = m.event;
        this.events.push(e);
        if (!this.respond) return;
        const match = () => this.lobby().matchOf(this);
        if (e.kind === "prompt") setTimeout(() => match().selectRegion(this.user.uuid, e.options[0]), 0);
        if (e.kind === "question" && e.timeMs > FAST.spectateMs) {
            if (e.question.kind === "mcq") this.lastOptions = e.question.options;
            const value = e.question.kind === "mcq" ? this.lastOptions.indexOf("right") : 42;
            setTimeout(() => {
                try {
                    match().answer(this.user.uuid, value);
                } catch {
                    // Not waiting for us (e.g. we're spectating this one).
                }
            }, 0);
        }
    }

    done(): Promise<Extract<MatchEvent, { kind: "gameOver" }>> {
        return new Promise((resolve) => {
            const poll = setInterval(() => {
                const over = this.events.find((e) => e.kind === "gameOver");
                if (over && over.kind === "gameOver") {
                    clearInterval(poll);
                    resolve(over);
                }
            }, 5);
        });
    }
}

function setup(timing: Partial<MatchTiming> = FAST, reconnectMs = 50) {
    const awards: { matchId: string; players: AwardPlayer[] }[] = [];
    const lobby: Lobby = new Lobby({
        countdownMs: 1,
        reconnectMs,
        matchTiming: timing,
        django: {
            deck: async () => DECK,
            award: async (matchId, players) => {
                awards.push({ matchId, players });
                return Object.fromEntries(players.map((p) => [p.user, 123]));
            },
        },
    });
    const human = (name: string) => {
        const m = new Bot({ uuid: `u-${name}`, displayName: name, points: 0 }, () => lobby);
        lobby.connect(m);
        return m;
    };
    return { lobby, awards, human };
}

function expectedTotal(tally: PointsTally) {
    return Object.entries(tally).reduce((s, [r, n]) => s + POINT_VALUES[r as keyof typeof POINT_VALUES] * n, 0);
}

describe("matches", () => {
    it("plays a single-player match to the end and saves points", async () => {
        const { lobby, awards, human } = setup();
        const alice = human("alice");
        await lobby.startSolo(alice, {
            rounds: 3,
            placement: "draft",
            language: "en",
            bots: [Difficulty.Easy, Difficulty.Easy],
        });
        const over = await alice.done();
        assert.equal(over.state.phase, "GAME_OVER");

        const kinds = new Set(alice.events.map((e) => e.kind));
        for (const k of ["started", "prompt", "turn", "target", "battle", "question", "mcqResult", "battleResult"])
            assert.ok(kinds.has(k as MatchEvent["kind"]), `no ${k} event`);

        // Answers stay secret while a question is open.
        for (const e of alice.events.filter((e) => e.kind === "question"))
            assert.ok(!/correct/i.test(JSON.stringify(e)), "question leaked its answer");

        // Alice always answers right, so she earned something; the ledger matches.
        const tally = over.points["u-alice"];
        assert.ok((tally.correct_answer ?? 0) > 0);
        assert.equal(Object.keys(over.points).length, 1, "bots earn nothing");
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(awards.length, 1);
        const saved = awards[0].players[0];
        assert.equal(saved.user, "u-alice");
        assert.equal(
            saved.entries.reduce((s, e) => s + e.amount, 0),
            expectedTotal(tally)
        );
        assert.ok(alice.messages.some((m) => m.type === "balance" && m.points === 123));
        // Single-player rooms close afterwards.
        assert.equal(lobby.rooms.size, 0);
    });

    it("picks for a human whose time runs out", async () => {
        const { lobby, human } = setup();
        const alice = human("alice");
        alice.respond = false;
        await lobby.startSolo(alice, { rounds: 3, placement: "draft", language: "en", bots: [Difficulty.Easy] });
        const over = await alice.done();
        assert.equal(over.state.phase, "GAME_OVER");
        assert.ok(alice.events.some((e) => e.kind === "target" && e.playerId === "u-alice" && e.auto));
    });

    it("multiplayer: a player who quits is replaced by a bot, the room reopens", async () => {
        const { lobby, awards, human } = setup();
        const alice = human("alice");
        const bob = human("bob");
        const settings: RoomSettings = { rounds: 3, placement: "random", seats: 2, language: "en" };
        const room = await lobby.create(alice, { name: "r", settings });
        await lobby.join(bob, room.id);
        lobby.lock(alice);
        await new Promise((r) => setTimeout(r, 20));
        assert.ok(room.match, "match running");

        lobby.leave(bob);
        assert.ok(alice.events.some((e) => e.kind === "botTakeover" && e.playerId === "u-bob"));
        const over = await alice.done();
        assert.equal(over.state.players.find((p) => p.id === "u-bob").kind, "bot");
        // Bob keeps what he earned before leaving (if anything) but no victory bonus.
        assert.equal(over.points["u-bob"]?.victory, undefined);

        await new Promise((r) => setTimeout(r, 20));
        assert.equal(room.status, "waiting");
        assert.equal(awards.length <= 1, true);
        assert.equal(lobby.roomOfUser("u-alice"), room);
    });

    it("keeps a dropped player's seat until the reconnect window ends", async () => {
        const slow = { ...FAST, choiceMs: 200 };
        const { lobby, human } = setup(slow, 60);
        const alice = human("alice");
        const bob = human("bob");
        const room = await lobby.create(alice, { name: "r", settings: { rounds: 3, placement: "draft", seats: 2, language: "en" } });
        await lobby.join(bob, room.id);
        lobby.lock(alice);
        await new Promise((r) => setTimeout(r, 20));

        // Bob drops and comes back in time: he gets the match again.
        lobby.disconnect(bob);
        const bob2 = new Bot(bob.user, () => lobby);
        lobby.connect(bob2);
        assert.ok(bob2.events.some((e) => e.kind === "started" && e.resumed));
        assert.equal(room.match.state.players.find((p) => p.id === "u-bob").kind, "human");

        // Bob drops for good: after the window a bot takes his seat.
        lobby.disconnect(bob2);
        await new Promise((r) => setTimeout(r, 120));
        assert.equal(lobby.roomOfUser("u-bob"), undefined);
        assert.ok(alice.events.some((e) => e.kind === "botTakeover" && e.playerId === "u-bob"));
        await alice.done();
    });

    it("rejects input out of turn", async () => {
        const { lobby, human } = setup({ ...FAST, choiceMs: 200 });
        const alice = human("alice");
        alice.respond = false;
        await lobby.startSolo(alice, { rounds: 3, placement: "draft", language: "en", bots: [Difficulty.Easy] });
        await new Promise((r) => setTimeout(r, 10));
        const match = lobby.matchOf(alice);
        assert.throws(() => match.answer("u-alice", 0), /No question/);
        const prompt = alice.events.find((e) => e.kind === "prompt");
        if (prompt?.kind === "prompt") {
            assert.throws(() => match.selectRegion("u-alice", "not-a-region"), /can't choose/);
            assert.throws(() => match.selectRegion("u-bot", prompt.options[0]), /Not your turn/);
        }
        lobby.leave(alice);
    });
});
