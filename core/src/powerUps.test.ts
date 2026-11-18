import { describe, it, expect } from "@jest/globals";

import { botAnswerMcq, botAnswerNumeric } from "./bot";
import { DEFAULT_CONFIG, GameEngine, GameRuleError, QuestionProvider } from "./GameEngine";
import { BULGARIA } from "./maps/bulgaria";
import {
    ALL_POWER_UPS,
    botChooseFortify,
    CATCH_UP_WRONG_EVERY,
    EXTRA_TIME_MS,
    emptyInventory,
    emptyProgress,
    enabledKinds,
    fiftyFiftyRemoved,
    grantableKind,
    MAX_CHARGES_PER_KIND,
    milestoneEarned,
    RANDOM_START_CHARGES,
    RANGE_FINDER_MIN_WIDTH,
    rangeFinderBracket,
    REWARD_CORRECT_EVERY,
    startingInventory,
} from "./powerUps";
import { createSeededRng } from "./rng";
import {
    Difficulty,
    GameConfig,
    GamePhase,
    GameState,
    MapGraph,
    McqQuestion,
    POWER_UP_KINDS,
    PowerUpSettings,
} from "./types";

const LIMIT = DEFAULT_CONFIG.timeLimitMs;

const LINE: MapGraph = {
    id: "line",
    regions: {
        a: { id: "a", name: "A", neighbors: ["b"] },
        b: { id: "b", name: "B", neighbors: ["a", "c"] },
        c: { id: "c", name: "C", neighbors: ["b", "d"] },
        d: { id: "d", name: "D", neighbors: ["c", "e"] },
        e: { id: "e", name: "E", neighbors: ["d"] },
    },
};

/** Numbered questions so tests can tell which one a battle got. */
function numberedQuestions(): QuestionProvider {
    let n = 0;
    return {
        nextMcq: () => {
            n++;
            return {
                id: `q${n}`,
                text: `Q${n}`,
                category: `cat${n}`,
                options: ["0", "1", "2", "3"],
                correctIndex: 1,
            };
        },
        nextNumeric: () => ({ id: "n", text: "?", correctValue: 100 }),
    };
}

const right = (ms = 1000) => ({ optionIndex: 1, responseTimeMs: ms });
const wrong = (ms = 1000) => ({ optionIndex: 0, responseTimeMs: ms });

function setState(engine: GameEngine, state: GameState) {
    (engine as unknown as { state: GameState }).state = state;
}

/** Two humans drafted onto LINE with capitals at a and e. */
function game(powerUps: PowerUpSettings = ALL_POWER_UPS, overrides: Partial<GameConfig> = {}) {
    const engine = new GameEngine(
        {
            ...DEFAULT_CONFIG,
            placement: "draft",
            rotateTurnOrder: false,
            powerUps,
            players: [
                { id: "p1", name: "P1", kind: "human" },
                { id: "p2", name: "P2", kind: "human" },
            ],
            ...overrides,
        },
        LINE,
        numberedQuestions(),
        createSeededRng(1)
    );
    engine.start();
    const [first, second] = engine.getState().turnOrder;
    engine.selectCapital(first, "a");
    engine.selectCapital(second, "e");
    return { engine, first, second };
}

/** Gives `first` b, c and d so they border `second`'s capital at e. */
function besiege(engine: GameEngine, first: string) {
    const s = engine.getState();
    for (const id of ["b", "c", "d"]) s.territories[id].ownerId = first;
    setState(engine, s);
}

const mcq: McqQuestion = { id: "q", text: "?", options: ["0", "1", "2", "3"], correctIndex: 1 };

// ---------------------------------------------------------------- pure rules

describe("power-up supply", () => {
    it("none gives nothing, whatever kinds are listed", () => {
        expect(startingInventory(Math.random, { mode: "none", kinds: [...POWER_UP_KINDS] })).toEqual(
            emptyInventory()
        );
        expect(enabledKinds({ mode: "none", kinds: ["scout"] })).toEqual([]);
    });

    it("oneEach gives one of each enabled kind only", () => {
        const inv = startingInventory(Math.random, { mode: "oneEach", kinds: ["fortify", "scout"] });
        expect(inv).toEqual({ ...emptyInventory(), fortify: 1, scout: 1 });
    });

    it("random gives the configured number of enabled charges", () => {
        for (let seed = 1; seed < 30; seed++) {
            const inv = startingInventory(createSeededRng(seed), {
                mode: "random",
                kinds: ["fiftyFifty", "extraTime"],
            });
            const total = Object.values(inv).reduce((a, b) => a + b, 0);
            expect(total).toBe(RANDOM_START_CHARGES);
            expect(inv.fiftyFifty + inv.extraTime).toBe(RANDOM_START_CHARGES);
        }
    });

    it("reward and catch-up start empty", () => {
        for (const mode of ["reward", "catchUp"] as const)
            expect(startingInventory(Math.random, { mode, kinds: [...POWER_UP_KINDS] })).toEqual(
                emptyInventory()
            );
    });

    it("reward earns on every Nth correct answer, not on wrong ones", () => {
        const settings: PowerUpSettings = { mode: "reward", kinds: ["scout"] };
        const progress = emptyProgress();
        const earned = Array.from({ length: 2 * REWARD_CORRECT_EVERY }, () =>
            milestoneEarned(settings, progress, "correct")
        );
        expect(earned.filter(Boolean)).toHaveLength(2);
        expect(earned[REWARD_CORRECT_EVERY - 1]).toBe(true);
        expect(milestoneEarned(settings, progress, "wrong")).toBe(false);
        expect(milestoneEarned(settings, progress, "lost")).toBe(false);
    });

    it("catch-up earns on wrong answers and lost regions, not on good play", () => {
        const settings: PowerUpSettings = { mode: "catchUp", kinds: ["scout"] };
        const progress = emptyProgress();
        const wrongs = Array.from({ length: CATCH_UP_WRONG_EVERY }, () =>
            milestoneEarned(settings, progress, "wrong")
        );
        expect(wrongs[CATCH_UP_WRONG_EVERY - 1]).toBe(true);
        expect(milestoneEarned(settings, progress, "lost")).toBe(true);
        for (let i = 0; i < 10; i++) {
            expect(milestoneEarned(settings, progress, "correct")).toBe(false);
            expect(milestoneEarned(settings, progress, "taken")).toBe(false);
        }
    });

    it("grants only enabled kinds and respects the per-kind cap", () => {
        const settings: PowerUpSettings = { mode: "reward", kinds: ["fortify", "scout"] };
        const inv = emptyInventory();
        inv.fortify = MAX_CHARGES_PER_KIND;
        for (let i = 0; i < 20; i++) expect(grantableKind(Math.random, settings, inv)).toBe("scout");
        inv.scout = MAX_CHARGES_PER_KIND;
        expect(grantableKind(Math.random, settings, inv)).toBeNull();
    });
});

describe("50/50", () => {
    it("removes two wrong options and never the right one", () => {
        for (let seed = 1; seed < 50; seed++) {
            const removed = fiftyFiftyRemoved(createSeededRng(seed), mcq);
            expect(removed).toHaveLength(2);
            expect(removed).not.toContain(mcq.correctIndex);
            expect(new Set(removed).size).toBe(2);
        }
    });

    it("always leaves at least one wrong option", () => {
        const three = { ...mcq, options: ["0", "1", "2"] };
        expect(fiftyFiftyRemoved(createSeededRng(1), three)).toHaveLength(1);
    });

    it("helps bots: they never pick a removed option and are right more often", () => {
        const rng = createSeededRng(9);
        const n = 4000;
        let plain = 0;
        let helped = 0;
        for (let i = 0; i < n; i++) {
            if (botAnswerMcq(rng, Difficulty.Easy, mcq).optionIndex === 1) plain++;
            const a = botAnswerMcq(rng, Difficulty.Easy, mcq, [0, 2]);
            expect([1, 3]).toContain(a.optionIndex);
            if (a.optionIndex === 1) helped++;
        }
        // Easy: 40% → 40% + 60% × ½ = 70%.
        expect(plain / n).toBeCloseTo(0.4, 1);
        expect(helped / n).toBeCloseTo(0.7, 1);
    });
});

describe("Range Finder", () => {
    it("brackets the answer, about ±25% wide, not always centred", () => {
        const mids = new Set<number>();
        for (let seed = 1; seed < 200; seed++) {
            const { min, max } = rangeFinderBracket(createSeededRng(seed), 1000);
            expect(min).toBeLessThan(1000);
            expect(max).toBeGreaterThan(1000);
            expect(max - min).toBeGreaterThanOrEqual(500);
            expect(max - min).toBeLessThanOrEqual(502);
            expect(Number.isInteger(min) && Number.isInteger(max)).toBe(true);
            mids.add(Math.round((min + max) / 2));
        }
        expect(mids.size).toBeGreaterThan(10);
    });

    it("has a minimum width for small and negative answers", () => {
        for (const v of [0, 1, -3, 2.5]) {
            const { min, max } = rangeFinderBracket(createSeededRng(3), v);
            expect(min).toBeLessThanOrEqual(v);
            expect(max).toBeGreaterThanOrEqual(v);
            expect(max - min).toBeGreaterThanOrEqual(RANGE_FINDER_MIN_WIDTH);
        }
    });

    it("keeps bot guesses inside the bracket", () => {
        const rng = createSeededRng(4);
        const bracket = { min: 900, max: 1200 };
        for (let i = 0; i < 500; i++) {
            const { value } = botAnswerNumeric(rng, Difficulty.Easy, { id: "n", text: "?", correctValue: 1000 }, bracket);
            expect(value).toBeGreaterThanOrEqual(900);
            expect(value).toBeLessThanOrEqual(1200);
        }
    });
});

describe("botChooseFortify", () => {
    function state(): GameState {
        const { engine } = game();
        const s = engine.getState();
        // p? at a (capital); b belongs to the other player → threatened.
        return s;
    }

    it("walls a threatened capital", () => {
        const s = state();
        const owner = s.territories.a.ownerId;
        const other = s.territories.e.ownerId;
        s.territories.b.ownerId = other;
        expect(botChooseFortify(createSeededRng(1), s, owner, Difficulty.Hard)).toBe("a");
    });

    it("does nothing when safe, already walled or out of charges", () => {
        const s = state();
        const owner = s.territories.a.ownerId;
        expect(botChooseFortify(createSeededRng(1), s, owner, Difficulty.Hard)).toBeNull();
        s.territories.b.ownerId = s.territories.e.ownerId;
        s.territories.a.walled = true;
        expect(botChooseFortify(createSeededRng(1), s, owner, Difficulty.Hard)).toBeNull();
        s.territories.a.walled = false;
        s.powerUps[owner].fortify = 0;
        expect(botChooseFortify(createSeededRng(1), s, owner, Difficulty.Hard)).toBeNull();
    });
});

// ---------------------------------------------------------------- engine

describe("GameEngine power-ups", () => {
    it("are off by default", () => {
        const { engine, first } = game(DEFAULT_CONFIG.powerUps);
        expect(engine.getState().powerUps[first]).toEqual(emptyInventory());
        expect(() => engine.usePowerUp(first, "scout")).toThrow(GameRuleError);
    });

    it("oneEach hands out a charge of each enabled kind at the start", () => {
        const { engine, first, second } = game({ mode: "oneEach", kinds: ["fortify", "fiftyFifty"] });
        for (const id of [first, second])
            expect(engine.getState().powerUps[id]).toEqual({ ...emptyInventory(), fortify: 1, fiftyFifty: 1 });
    });

    describe("fortify", () => {
        it("is a free action that walls your own region", () => {
            const { engine, first } = game();
            expect(engine.usePowerUp(first, "fortify", "a")).toEqual({ kind: "fortify", regionId: "a" });
            const s = engine.getState();
            expect(s.territories.a.walled).toBe(true);
            expect(s.powerUps[first].fortify).toBe(0);
            expect(engine.phase).toBe(GamePhase.TurnSelectTarget);
            expect(engine.activePlayer.id).toBe(first);
        });

        it("rejects other players' land, unknown regions, the wrong turn and empty stock", () => {
            const { engine, first, second } = game({ mode: "random", kinds: ["fortify"] });
            expect(() => engine.usePowerUp(first, "fortify", "e")).toThrow(GameRuleError);
            expect(() => engine.usePowerUp(first, "fortify", "b")).toThrow(GameRuleError);
            expect(() => engine.usePowerUp(first, "fortify", "zzz")).toThrow(GameRuleError);
            expect(() => engine.usePowerUp(first, "fortify")).toThrow(GameRuleError);
            expect(() => engine.usePowerUp(second, "fortify", "e")).toThrow(GameRuleError);
            engine.usePowerUp(first, "fortify", "a");
            expect(() => engine.usePowerUp(first, "fortify", "a")).toThrow(/Already fortified/);
            expect(engine.getState().powerUps[first].fortify).toBe(RANDOM_START_CHARGES - 1);
        });

        it("a failed use doesn't spend a charge", () => {
            const { engine, first } = game();
            expect(() => engine.usePowerUp(first, "fortify", "e")).toThrow(GameRuleError);
            expect(engine.getState().powerUps[first].fortify).toBe(1);
        });

        it("the wall absorbs the next win and then is gone", () => {
            const { engine, first, second } = game();
            besiege(engine, first);
            // Pass p1's turn so p2 can fortify their capital.
            engine.selectTarget(first, "e");
            engine.submitMcq(first, wrong());
            engine.submitMcq(second, wrong());
            engine.continue();
            engine.usePowerUp(second, "fortify", "e");
            const s = engine.getState();
            // Back to p1 next round.
            expect(engine.activePlayer.id).toBe(second);
            s.turnIndex = 0;
            s.phase = GamePhase.TurnSelectTarget;
            setState(engine, s);
            engine.selectTarget(first, "e");
            engine.submitMcq(first, right());
            engine.submitMcq(second, wrong());
            const r = engine.getState().battle.result;
            expect(r).toMatchObject({ wallBroken: true, targetHpAfter: 3, captured: false });
            expect(engine.getState().territories.e.walled).toBe(false);
        });
    });

    describe("scout", () => {
        it("reveals the category of your next question, which you then get", () => {
            const { engine, first } = game();
            const effect = engine.usePowerUp(first, "scout");
            expect(effect.kind).toBe("scout");
            const category = effect.kind === "scout" ? effect.category : null;
            expect(category).toMatch(/^cat\d+$/);
            engine.selectTarget(first, "b");
            expect(engine.getState().battle.mcq.category).toBe(category);
        });

        it("can't be used twice in a turn or outside your turn", () => {
            const { engine, first, second } = game({ mode: "random", kinds: ["scout"] });
            engine.usePowerUp(first, "scout");
            expect(() => engine.usePowerUp(first, "scout")).toThrow(/Already scouted/);
            expect(() => engine.usePowerUp(second, "scout")).toThrow(GameRuleError);
        });

        it("doesn't carry the question into a capital chain", () => {
            const { engine, first, second } = game();
            besiege(engine, first);
            engine.usePowerUp(first, "scout");
            engine.selectTarget(first, "e");
            const firstQuestion = engine.getState().battle.mcq.id;
            engine.submitMcq(first, right());
            engine.submitMcq(second, wrong());
            engine.continue();
            expect(engine.getState().battle.chainIndex).toBe(2);
            expect(engine.getState().battle.mcq.id).not.toBe(firstQuestion);
        });
    });

    describe("50/50 in a battle", () => {
        it("removes two wrong options for the user only", () => {
            const { engine, first } = game();
            engine.selectTarget(first, "b");
            const effect = engine.usePowerUp(first, "fiftyFifty");
            expect(effect.kind === "fiftyFifty" && effect.removed).toHaveLength(2);
            expect(effect.kind === "fiftyFifty" && effect.removed).not.toContain(1);
            expect(engine.getState().battle.aids.attacker.fiftyFifty).toEqual(
                effect.kind === "fiftyFifty" && effect.removed
            );
            expect(engine.getPublicState().battle.aids).toBeUndefined();
        });

        it("is rejected after answering, outside battles, and for spectators", () => {
            const { engine, first, second } = game({ mode: "random", kinds: ["fiftyFifty"] });
            expect(() => engine.usePowerUp(first, "fiftyFifty")).toThrow(/No question/);
            engine.selectTarget(first, "b"); // neutral defender: p2 only watches
            expect(() => engine.usePowerUp(second, "fiftyFifty")).toThrow(/not part of this battle/);
            engine.usePowerUp(first, "fiftyFifty");
            expect(() => engine.usePowerUp(first, "fiftyFifty")).toThrow(/Already used/);
            engine.submitMcq(first, wrong());
            expect(engine.phase).toBe(GamePhase.BattleResolution);
        });
    });

    describe("extra time", () => {
        it("makes a late answer count for the player who used it", () => {
            const { engine, first, second } = game();
            besiege(engine, first);
            engine.selectTarget(first, "e");
            expect(engine.usePowerUp(first, "extraTime")).toEqual({ kind: "extraTime", bonusMs: EXTRA_TIME_MS });
            engine.submitMcq(first, right(LIMIT + 3000));
            engine.submitMcq(second, right(LIMIT + 3000)); // no extra time: too late
            expect(engine.getState().battle.result).toMatchObject({ winner: "attacker", decidedBy: "mcq" });
        });

        it("still has a limit", () => {
            const { engine, first } = game();
            engine.selectTarget(first, "b");
            engine.usePowerUp(first, "extraTime");
            engine.submitMcq(first, right(LIMIT + EXTRA_TIME_MS + 1));
            expect(engine.getState().battle.result.winner).toBe("defender");
        });

        it("only covers the question it was used on", () => {
            const { engine, first, second } = game({ mode: "random", kinds: ["extraTime"] });
            besiege(engine, first);
            engine.selectTarget(first, "e");
            engine.usePowerUp(first, "extraTime");
            engine.submitMcq(first, right(LIMIT + 1000));
            engine.submitMcq(second, right());
            expect(engine.phase).toBe(GamePhase.BattleNumeric);
            engine.submitNumeric(first, { value: 100, responseTimeMs: LIMIT + 1000 });
            engine.submitNumeric(second, { value: 50, responseTimeMs: 1000 });
            expect(engine.getState().battle.result.winner).toBe("defender");
        });

        it("timer expiry with extra time still counts as no answer", () => {
            const { engine, first } = game();
            engine.selectTarget(first, "b");
            engine.usePowerUp(first, "extraTime");
            engine.expireTimer();
            const a = engine.getState().battle.mcqAnswers.attacker;
            expect(a.responseTimeMs).toBeGreaterThan(LIMIT + EXTRA_TIME_MS);
            expect(engine.getState().battle.result.winner).toBe("defender");
        });
    });

    describe("Range Finder in a battle", () => {
        it("only works in the tie-breaker and brackets the answer", () => {
            const { engine, first, second } = game();
            besiege(engine, first);
            engine.selectTarget(first, "e");
            expect(() => engine.usePowerUp(first, "rangeFinder")).toThrow(/tie-breaker/);
            engine.submitMcq(first, right());
            engine.submitMcq(second, right());
            const effect = engine.usePowerUp(second, "rangeFinder");
            if (effect.kind !== "rangeFinder") throw new Error("wrong effect");
            expect(effect.min).toBeLessThanOrEqual(100);
            expect(effect.max).toBeGreaterThanOrEqual(100);
            expect(engine.getPublicState().battle.aids).toBeUndefined();
        });
    });

    describe("earning", () => {
        it("reward mode grants a power-up on the Nth correct answer", () => {
            const { engine, first, second } = game({ mode: "reward", kinds: ["scout"] });
            besiege(engine, first);
            for (let i = 0; i < REWARD_CORRECT_EVERY; i++) {
                if (engine.phase !== GamePhase.BattleMcq) engine.selectTarget(first, "e");
                engine.submitMcq(first, right());
                engine.submitMcq(second, wrong());
                if (i < REWARD_CORRECT_EVERY - 1) engine.continue();
            }
            expect(engine.drainGrants()).toEqual([{ playerId: first, kind: "scout", reason: "correct" }]);
            expect(engine.drainGrants()).toEqual([]);
            expect(engine.getState().powerUps[first].scout).toBe(1);
        });

        it("catch-up mode grants a power-up to whoever loses a region", () => {
            const { engine, first, second } = game({ mode: "catchUp", kinds: ["fortify"] });
            const s = engine.getState();
            s.territories.b.ownerId = second;
            setState(engine, s);
            engine.selectTarget(first, "b");
            engine.submitMcq(first, right());
            engine.submitMcq(second, wrong());
            const grants = engine.drainGrants();
            expect(grants).toContainEqual({ playerId: second, kind: "fortify", reason: "lost" });
            expect(grants.some((g) => g.playerId === first)).toBe(false);
        });

        it("neutral defenders never earn anything", () => {
            const { engine, first } = game({ mode: "catchUp", kinds: ["fortify"] });
            engine.selectTarget(first, "b");
            engine.submitMcq(first, right());
            // The neutral bot may have been right too: win the tie-breaker.
            if (engine.phase === GamePhase.BattleNumeric)
                engine.submitNumeric(first, { value: 100, responseTimeMs: 1000 });
            expect(engine.getState().battle.result.captured).toBe(true);
            expect(engine.drainGrants()).toEqual([]);
        });
    });

    it("a bot attacking a capital uses its 50/50", () => {
        const engine = new GameEngine(
            {
                ...DEFAULT_CONFIG,
                placement: "draft",
                rotateTurnOrder: false,
                powerUps: ALL_POWER_UPS,
                players: [
                    { id: "bot", name: "Bot", kind: "bot", difficulty: Difficulty.Hard },
                    { id: "me", name: "Me", kind: "human" },
                ],
            },
            LINE,
            numberedQuestions(),
            createSeededRng(2)
        );
        engine.start();
        const s = engine.getState();
        // Make it the bot's turn with the human's capital in reach.
        for (const t of Object.values(s.territories)) Object.assign(t, { ownerId: null, isCapital: false, hp: 1 });
        Object.assign(s.territories.a, { ownerId: "bot", isCapital: true, hp: 3 });
        Object.assign(s.territories.b, { ownerId: "bot" });
        Object.assign(s.territories.c, { ownerId: "me", isCapital: true, hp: 3 });
        s.turnOrder = ["bot", "me"];
        s.turnIndex = 0;
        s.phase = GamePhase.TurnSelectTarget;
        setState(engine, s);
        engine.selectTarget("bot", "c");
        const after = engine.getState();
        expect(after.powerUps.bot.fiftyFifty).toBe(0);
        expect(after.battle.aids.attacker.fiftyFifty).toHaveLength(2);
        expect(after.battle.mcqAnswers.attacker.optionIndex).not.toBeNull();
        expect(after.battle.aids.attacker.fiftyFifty).not.toContain(after.battle.mcqAnswers.attacker.optionIndex);
    });

    it("plays full bot-only games on Bulgaria in every mode", () => {
        for (const mode of ["oneEach", "random", "reward", "catchUp"] as const) {
            for (let seed = 1; seed <= 5; seed++) {
                const rng = createSeededRng(seed);
                const engine = new GameEngine(
                    {
                        ...DEFAULT_CONFIG,
                        rounds: 7,
                        powerUps: { mode, kinds: [...POWER_UP_KINDS] },
                        players: [Difficulty.Easy, Difficulty.Medium, Difficulty.Hard].map((d, i) => ({
                            id: `b${i}`,
                            name: `B${i}`,
                            kind: "bot" as const,
                            difficulty: d,
                        })),
                    },
                    BULGARIA,
                    numberedQuestions(),
                    rng
                );
                engine.start();
                let steps = 0;
                while (engine.phase !== GamePhase.GameOver) {
                    if (++steps > 10_000) throw new Error("game did not end");
                    if (engine.phase === GamePhase.TurnSelectTarget) {
                        const s = engine.getState();
                        const id = engine.activePlayer.id;
                        const fortify = botChooseFortify(rng, s, id, Difficulty.Medium);
                        if (fortify) engine.usePowerUp(id, "fortify", fortify);
                        const targets = engine.attackableTargets(id);
                        engine.selectTarget(id, targets[Math.floor(rng() * targets.length)]);
                    } else {
                        engine.continue();
                    }
                }
                const s = engine.getState();
                for (const inv of Object.values(s.powerUps))
                    for (const n of Object.values(inv)) {
                        expect(n).toBeGreaterThanOrEqual(0);
                        expect(n).toBeLessThanOrEqual(MAX_CHARGES_PER_KIND);
                    }
            }
        }
    });
});
