import {
    ALL_POWER_UPS,
    createSeededRng,
    DEFAULT_CONFIG,
    Difficulty,
    MATCH_TIMING,
    MatchEvent,
    MatchSnapshot,
    PlayerConfig,
    POINT_VALUES,
    PointsTally,
    PowerUpEffect,
    PowerUpSettings,
    QuestionDeck,
    RoomSettings,
    ServerMessage,
} from "@conquiztador/core";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AwardPlayer } from "./django.js";
import { isAborted, Match, MatchTiming } from "./match.js";
import { Lobby, Member, RoomError } from "./rooms.js";

/** Every pause 1 ms; a human who doesn't act times out after 30 ms (choices) or 60 ms (answers). */
const FAST = Object.fromEntries(Object.keys(MATCH_TIMING).map((k) => [k, 1])) as MatchTiming;
FAST.choiceMs = 30;
const ANSWER_MS = 60;

const DECK: QuestionDeck = {
    mcq: Array.from({ length: 5 }, (_, i) => ({
        id: `m${i}`,
        text: `Question ${i}`,
        category: `category ${i}`,
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
    /** Runs (on the next tick) before the scripted reply to a prompt or question. */
    onEvent?: (e: MatchEvent, match: Match) => void;
    private lastOptions: string[] = [];

    constructor(
        readonly user: { uuid: string; displayName: string; points: number },
        /** The match this player is in (throws RoomError if none). */
        private readonly matchOf: (me: Bot) => Match
    ) {}

    send(m: ServerMessage) {
        this.messages.push(m);
        if (m.type !== "match") return;
        const e = m.event;
        this.events.push(e);
        if (this.onEvent) this.later((match) => this.onEvent(e, match));
        if (!this.respond) return;
        if (e.kind === "prompt") this.later((match) => match.selectRegion(this.user.uuid, e.options[0]));
        if (e.kind === "question" && e.timeMs > FAST.spectateMs) {
            if (e.question.kind === "mcq") this.lastOptions = e.question.options;
            const value = e.question.kind === "mcq" ? this.lastOptions.indexOf("right") : 42;
            this.later((match) => match.answer(this.user.uuid, value));
        }
    }

    /**
     * Acts on the next tick, like a real client. By then the prompt or question
     * may be gone (time ran out, a bot took the seat, the match ended): ignore that.
     */
    private later(act: (match: Match) => void) {
        setTimeout(() => {
            try {
                act(this.matchOf(this));
            } catch (e) {
                if (!(e instanceof RoomError)) throw e;
            }
        }, 0);
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
        timeLimitMs: ANSWER_MS,
        django: {
            deck: async () => DECK,
            award: async (matchId, players) => {
                awards.push({ matchId, players });
                return Object.fromEntries(players.map((p) => [p.user, 123]));
            },
        },
    });
    const human = (name: string) => {
        const m = new Bot({ uuid: `u-${name}`, displayName: name, points: 0 }, (me) => lobby.matchOf(me));
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
        const settings: RoomSettings = { rounds: 3, placement: "random", seats: 2, language: "en", powerUps: ALL_POWER_UPS };
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
        const room = await lobby.create(alice, { name: "r", settings: { rounds: 3, placement: "draft", seats: 2, language: "en", powerUps: ALL_POWER_UPS } });
        await lobby.join(bob, room.id);
        lobby.lock(alice);
        await new Promise((r) => setTimeout(r, 20));

        // Bob drops and comes back in time: he gets the match again.
        lobby.disconnect(bob);
        const bob2 = new Bot(bob.user, (me) => lobby.matchOf(me));
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

// ---------------------------------------------------------------- power-ups

/**
 * A match run directly (no lobby), with a seeded rng so bots and questions
 * are repeatable. Humans are scripted Bots with ids "u-<name>".
 */
function direct(options: {
    humans: string[];
    bots?: Difficulty[];
    powerUps?: PowerUpSettings;
    rounds?: number;
    timeLimitMs?: number;
    neutral?: Difficulty;
    seed?: number;
}) {
    const players: PlayerConfig[] = [
        ...options.humans.map((name) => ({ id: `u-${name}`, name, kind: "human" as const })),
        ...(options.bots ?? []).map((difficulty, i) => ({
            id: `bot-${i + 1}`,
            name: `Bot ${i + 1}`,
            kind: "bot" as const,
            difficulty,
        })),
    ];
    const humans: Record<string, Bot> = {};
    const match: Match = new Match(
        {
            ...DEFAULT_CONFIG,
            players,
            rounds: options.rounds ?? 3,
            placement: "random",
            powerUps: options.powerUps ?? ALL_POWER_UPS,
            timeLimitMs: options.timeLimitMs ?? ANSWER_MS,
            neutralDifficulty: options.neutral ?? Difficulty.Medium,
        },
        DECK,
        { send: (id, event) => humans[id]?.send({ type: "match", event }) },
        { timing: FAST, rng: createSeededRng(options.seed ?? 1) }
    );
    for (const name of options.humans)
        humans[`u-${name}`] = new Bot({ uuid: `u-${name}`, displayName: name, points: 0 }, () => match);
    /** Plays the match; resolves when it ends or is aborted. */
    const run = (): Promise<void> =>
        match.run().then(
            (): void => undefined,
            (e): void => {
                if (!isAborted(e)) throw e;
            }
        );
    return { match, human: (name: string) => humans[`u-${name}`], run };
}

/** What a call did: "ok", or the RoomError code it was refused with. */
function outcome(act: () => void): string {
    try {
        act();
        return "ok";
    } catch (e) {
        if (e instanceof RoomError) return e.code;
        throw e;
    }
}

async function until(condition: () => boolean, timeoutMs = 5000) {
    const start = Date.now();
    while (!condition()) {
        if (Date.now() - start > timeoutMs) assert.fail("timed out waiting");
        await new Promise((r) => setTimeout(r, 2));
    }
}

function effects(bot: Bot): PowerUpEffect[] {
    return bot.events.flatMap((e) => (e.kind === "powerUpEffect" ? [e.effect] : []));
}

/** Each power-up use / grant changes exactly that charge by one, relative to the state shown before it. */
function assertChargesTrack(events: MatchEvent[]) {
    let shown: MatchSnapshot | null = null;
    for (const e of events) {
        if (e.kind === "powerUpUsed" || e.kind === "powerUpGranted") {
            assert.ok(shown, "power-up news before any state");
            const before = shown.powerUps[e.playerId][e.powerUp];
            const after = e.state.powerUps[e.playerId][e.powerUp];
            assert.equal(after, before + (e.kind === "powerUpUsed" ? -1 : 1), `${e.kind} ${e.powerUp} by ${e.playerId}`);
        }
        if ("state" in e) shown = e.state;
    }
}

function capitalOf(state: Pick<MatchSnapshot, "territories">, id: string): string {
    return Object.values(state.territories).find((t) => t.isCapital && t.ownerId === id).regionId;
}

describe("power-ups in matches", () => {
    it("fortify and scout: only on your turn, effect private, use public, charge spent", async () => {
        const { match, human, run } = direct({ humans: ["alice", "bob"] });
        const alice = human("alice");
        const bob = human("bob");
        const results: Record<string, string> = {};
        let capital = "";
        alice.onEvent = (e, m) => {
            if (e.kind !== "prompt" || e.prompt !== "target" || results.scout) return;
            const s = m.state;
            capital = capitalOf(s, "u-alice");
            const notMine = Object.values(s.territories).find((t) => t.ownerId !== "u-alice").regionId;
            results.aidOnTurn = outcome(() => m.usePowerUp("u-alice", "fiftyFifty"));
            results.bob = outcome(() => m.usePowerUp("u-bob", "fortify", capitalOf(s, "u-bob")));
            results.notMine = outcome(() => m.usePowerUp("u-alice", "fortify", notMine));
            results.noRegion = outcome(() => m.usePowerUp("u-alice", "fortify"));
            results.chargesAfterFailures = String(m.state.powerUps["u-alice"].fortify);
            results.fortify = outcome(() => m.usePowerUp("u-alice", "fortify", capital));
            results.again = outcome(() => m.usePowerUp("u-alice", "fortify", capital));
            results.scout = outcome(() => m.usePowerUp("u-alice", "scout"));
        };
        const done = run();
        const battleAt = () => alice.events.findIndex((e) => e.kind === "battle" && e.attackerId === "u-alice");
        await until(() => battleAt() >= 0 && alice.events.slice(battleAt()).some((e) => e.kind === "question"));
        match.abort();
        await done;

        assert.deepEqual(results, {
            aidOnTurn: "not_your_turn",
            bob: "not_your_turn",
            notMine: "invalid",
            noRegion: "invalid",
            chargesAfterFailures: "1",
            fortify: "ok",
            again: "invalid",
            scout: "ok",
        });
        const mine = effects(alice);
        assert.deepEqual(mine[0], { kind: "fortify", regionId: capital });
        assert.equal(mine[1].kind, "scout");
        assert.deepEqual(effects(bob), [], "effects go to their user only");

        // Everyone sees the uses, the wall and the charges spent.
        const used = bob.events.flatMap((e) => (e.kind === "powerUpUsed" ? [e] : []));
        assert.deepEqual(
            used.map((e) => [e.playerId, e.powerUp]),
            [
                ["u-alice", "fortify"],
                ["u-alice", "scout"],
            ]
        );
        assert.equal(used[0].state.territories[capital].walled, true);
        assert.equal(used[0].state.powerUps["u-alice"].fortify, 0);
        assertChargesTrack(bob.events);

        // The scouted question is the one her battle uses.
        const scouted = mine[1].kind === "scout" && mine[1].category;
        const question = alice.events.slice(battleAt()).find((e) => e.kind === "question");
        assert.equal(question?.kind === "question" && question.question.category, scouted);
    });

    it("50/50, Extra Time and Range Finder: only while you answer, effects never leak", async () => {
        const { match, human, run } = direct({ humans: ["alice", "bob"], neutral: Difficulty.Hard, rounds: 6, seed: 3 });
        const alice = human("alice");
        const bob = human("bob");
        const results: Record<string, string> = {};
        let rightIndex = -1;
        alice.onEvent = (e, m) => {
            if (e.kind !== "question" || e.timeMs <= FAST.spectateMs) return;
            if (e.question.kind === "mcq" && !results.fiftyFifty) {
                rightIndex = e.question.options.indexOf("right");
                results.rangeFinderOnMcq = outcome(() => m.usePowerUp("u-alice", "rangeFinder"));
                results.fortifyInBattle = outcome(() => m.usePowerUp("u-alice", "fortify", capitalOf(m.state, "u-alice")));
                results.fiftyFifty = outcome(() => m.usePowerUp("u-alice", "fiftyFifty"));
                results.fiftyFiftyAgain = outcome(() => m.usePowerUp("u-alice", "fiftyFifty"));
                results.extraTime = outcome(() => m.usePowerUp("u-alice", "extraTime"));
            }
            if (e.question.kind === "numeric" && !results.rangeFinder)
                results.rangeFinder = outcome(() => m.usePowerUp("u-alice", "rangeFinder"));
        };
        const done = run();
        await until(() => !!results.rangeFinder || alice.events.some((e) => e.kind === "gameOver"));
        match.abort();
        await done;

        assert.deepEqual(results, {
            rangeFinderOnMcq: "invalid",
            fortifyInBattle: "not_your_turn",
            fiftyFifty: "ok",
            fiftyFiftyAgain: "invalid",
            extraTime: "ok",
            rangeFinder: "ok",
        });
        const [fifty, extra, range] = effects(alice);
        assert.ok(fifty.kind === "fiftyFifty" && fifty.removed.length === 2);
        assert.ok(!fifty.removed.includes(rightIndex), "50/50 never hides the answer");
        assert.deepEqual(extra, { kind: "extraTime", bonusMs: 5000 });
        assert.ok(range.kind === "rangeFinder" && range.min <= 42 && 42 <= range.max);
        assert.deepEqual(effects(bob), []);
        // Nobody else's messages carry the hidden options or the bracket.
        for (const e of bob.events) assert.ok(!/removed|"min"|aids/.test(JSON.stringify(e)), `leak in ${e.kind}`);
        assertChargesTrack(bob.events);
    });

    it("Extra Time really extends your answer time", async () => {
        const { match, human, run } = direct({ humans: ["alice"], bots: [Difficulty.Easy], seed: 2 });
        const alice = human("alice");
        alice.respond = false;
        const late: string[] = [];
        let used = "";
        alice.onEvent = (e, m) => {
            if (e.kind === "prompt") outcome(() => m.selectRegion("u-alice", e.options[0]));
            if (e.kind !== "question" || e.timeMs <= FAST.spectateMs) return;
            if (e.question.kind === "numeric") return void outcome(() => m.answer("u-alice", 42));
            const right = e.question.options.indexOf("right");
            if (!used) used = outcome(() => m.usePowerUp("u-alice", "extraTime"));
            // Answer well after the 60 ms limit.
            setTimeout(() => late.push(outcome(() => m.answer("u-alice", right))), 150);
        };
        const done = run();
        await until(() => late.length >= 2);
        match.abort();
        await done;

        assert.equal(used, "ok");
        assert.deepEqual(late, ["ok", "not_your_turn"], "a late answer is only taken with Extra Time");
        const result = alice.events.find((e) => e.kind === "mcqResult");
        const answers = result?.kind === "mcqResult" ? Object.values(result.answers) : [];
        assert.ok(answers.some((a) => a.responseTimeMs >= 150 && a.responseTimeMs < 5000));
        assert.equal(match.pointsSoFar()["u-alice"].correct_answer, 1, "and it counts as correct");
    });

    it("bots fortify and use 50/50, announced to everyone with consistent charges", async () => {
        const { human, run } = direct({ humans: ["alice"], bots: [Difficulty.Hard, Difficulty.Hard], rounds: 12, seed: 7 });
        const alice = human("alice");
        await run();
        const used = alice.events.flatMap((e) => (e.kind === "powerUpUsed" ? [e] : []));
        const fortify = used.find((e) => e.powerUp === "fortify" && e.playerId.startsWith("bot"));
        assert.ok(fortify, "a bot fortified");
        assert.equal(fortify.state.territories[capitalOf(fortify.state, fortify.playerId)].walled, true);
        assert.ok(used.some((e) => e.powerUp === "fiftyFifty" && e.playerId.startsWith("bot")), "a bot used 50/50");
        assert.ok(used.every((e) => e.playerId !== "u-alice"), "alice used nothing");
        assert.deepEqual(effects(alice), [], "bots' effects stay private");
        assertChargesTrack(alice.events);
    });

    it("announces power-ups earned in reward mode", async () => {
        const { human, run } = direct({
            humans: ["alice"],
            bots: [Difficulty.Easy],
            powerUps: { mode: "reward", kinds: ["scout", "extraTime"] },
            rounds: 8,
        });
        const alice = human("alice");
        await run();
        const started = alice.events.find((e) => e.kind === "started");
        assert.deepEqual(started?.kind === "started" && started.state.powerUps["u-alice"], {
            fiftyFifty: 0,
            rangeFinder: 0,
            fortify: 0,
            extraTime: 0,
            scout: 0,
        });
        const granted = alice.events.flatMap((e) => (e.kind === "powerUpGranted" ? [e] : []));
        assert.ok(
            granted.some((e) => e.playerId === "u-alice" && e.reason === "correct"),
            "alice earned one for correct answers"
        );
        for (const e of granted) assert.ok(["scout", "extraTime"].includes(e.powerUp));
        assertChargesTrack(alice.events);
    });

    it("re-sends your power-up effects when you reconnect", async () => {
        const { match, human, run } = direct({ humans: ["alice"], bots: [Difficulty.Easy], timeLimitMs: 300 });
        const alice = human("alice");
        alice.respond = false;
        let atPrompt: MatchEvent[] = [];
        let atQuestion: MatchEvent[] = [];
        alice.onEvent = (e, m) => {
            if (e.kind === "prompt" && e.prompt === "target" && !atPrompt.length) {
                m.usePowerUp("u-alice", "scout");
                const from = alice.events.length;
                m.resume("u-alice");
                atPrompt = alice.events.slice(from);
            }
            if (e.kind === "prompt") outcome(() => m.selectRegion("u-alice", e.options[0]));
            if (e.kind === "question" && e.question.kind === "mcq" && e.timeMs > FAST.spectateMs && !atQuestion.length) {
                m.usePowerUp("u-alice", "fiftyFifty");
                m.usePowerUp("u-alice", "extraTime");
                const from = alice.events.length;
                m.resume("u-alice");
                atQuestion = alice.events.slice(from);
            }
        };
        const done = run();
        await until(() => atQuestion.length > 0 && atPrompt.length > 0);
        match.abort();
        await done;

        const scout = effects(alice).find((e) => e.kind === "scout");
        const fifty = effects(alice).find((e) => e.kind === "fiftyFifty");
        assert.deepEqual(
            atPrompt.map((e) => e.kind),
            ["started", "prompt", "powerUpEffect"]
        );
        assert.deepEqual(atPrompt[2], { kind: "powerUpEffect", effect: scout });

        // Effects come after the question they apply to; the question has the base time left
        // and Extra Time is re-sent as an effect (the client adds it once).
        assert.deepEqual(
            atQuestion.map((e) => e.kind),
            ["started", "battle", "question", "powerUpEffect", "powerUpEffect"]
        );
        const q = atQuestion[2];
        assert.ok(q.kind === "question" && q.timeMs > 0 && q.timeMs <= 300, "base time left, no bonus");
        assert.deepEqual(atQuestion[3], { kind: "powerUpEffect", effect: fifty });
        assert.deepEqual(atQuestion[4], { kind: "powerUpEffect", effect: { kind: "extraTime", bonusMs: 5000 } });
    });

    it("on reconnect after the base time ran out, still re-sends the question while Extra Time runs", async () => {
        const { match, human, run } = direct({ humans: ["alice"], bots: [Difficulty.Easy], timeLimitMs: 40 });
        const alice = human("alice");
        alice.respond = false;
        let resumed: MatchEvent[] = [];
        alice.onEvent = (e, m) => {
            if (e.kind === "prompt") outcome(() => m.selectRegion("u-alice", e.options[0]));
            if (e.kind === "question" && e.question.kind === "mcq" && e.timeMs > FAST.spectateMs && !resumed.length) {
                const right = e.question.options.indexOf("right");
                m.usePowerUp("u-alice", "extraTime");
                setTimeout(() => {
                    const from = alice.events.length;
                    m.resume("u-alice");
                    resumed = alice.events.slice(from);
                    outcome(() => m.answer("u-alice", right));
                }, 100);
            }
        };
        const done = run();
        await until(() => resumed.length > 0);
        match.abort();
        await done;
        const q = resumed.find((e) => e.kind === "question");
        assert.equal(q?.kind === "question" && q.timeMs, 0);
        assert.deepEqual(resumed.at(-1), { kind: "powerUpEffect", effect: { kind: "extraTime", bonusMs: 5000 } });
    });
});

describe("match settings", () => {
    it("plays a one-round match end to end", async () => {
        const { lobby, human } = setup();
        const alice = human("alice");
        await lobby.startSolo(alice, { rounds: 1, placement: "random", language: "en", bots: [Difficulty.Medium] });
        const over = await alice.done();
        assert.equal(over.state.round, 1);
        assert.deepEqual(
            alice.events.filter((e) => e.kind === "roundEnd"),
            [{ kind: "roundEnd", round: 1, final: true }]
        );
    });

    it("passes the power-up settings to the match (default: one of each)", async () => {
        const { lobby, human } = setup({ ...FAST, choiceMs: 200 });
        const charges = async (powerUps?: PowerUpSettings) => {
            const alice = human("alice");
            alice.respond = false;
            await lobby.startSolo(alice, { rounds: 1, placement: "random", language: "en", bots: [Difficulty.Easy], powerUps });
            await until(() => alice.events.some((e) => e.kind === "started"));
            lobby.leave(alice);
            const started = alice.events.find((e) => e.kind === "started");
            return started?.kind === "started" ? started.state.powerUps : {};
        };
        const one = { fiftyFifty: 1, rangeFinder: 1, fortify: 1, extraTime: 1, scout: 1 };
        const none = { fiftyFifty: 0, rangeFinder: 0, fortify: 0, extraTime: 0, scout: 0 };
        assert.deepEqual(await charges(), { "u-alice": one, "bot-2": one });
        assert.deepEqual(await charges({ mode: "none", kinds: [] }), { "u-alice": none, "bot-2": none });
        assert.deepEqual((await charges({ mode: "oneEach", kinds: ["scout"] }))["u-alice"], { ...none, scout: 1 });
    });
});
