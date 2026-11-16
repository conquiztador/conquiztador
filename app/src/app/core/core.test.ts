import { describe, it, expect } from "@jest/globals";

import { BULGARIA } from "./maps/bulgaria";
import { resolveMcq, resolveNumeric } from "./combat";
import { applyAttackerWin, findAsymmetricEdges } from "./territory";
import {
    botAnswerMcq,
    botAnswerNumeric,
    botChooseTarget,
    BOT_MAX_RESPONSE_MS,
    BOT_MIN_RESPONSE_MS,
} from "./bot";
import { createSeededRng } from "./rng";
import {
    DEFAULT_CONFIG,
    GameEngine,
    GameRuleError,
    QuestionProvider,
} from "./GameEngine";
import {
    Difficulty,
    GameState,
    GameConfig,
    GamePhase,
    MapGraph,
    Territory,
} from "./types";

const LIMIT = 15000;

/** Test-only: inject a hand-crafted state into the engine. */
function setState(engine: GameEngine, state: GameState) {
    ((engine as unknown) as { state: GameState }).state = state;
}

// A line map a - b - c - d - e keeps engine scenarios easy to reason about.
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

const questions: QuestionProvider = {
    nextMcq: () => ({
        id: "q",
        text: "?",
        options: ["0", "1", "2", "3"],
        correctIndex: 1,
    }),
    nextNumeric: () => ({ id: "n", text: "?", correctValue: 100 }),
};

const right = (ms = 1000) => ({ optionIndex: 1, responseTimeMs: ms });
const wrong = (ms = 1000) => ({ optionIndex: 0, responseTimeMs: ms });

function humans(overrides: Partial<GameConfig> = {}): GameConfig {
    return {
        ...DEFAULT_CONFIG,
        placement: "draft",
        rotateTurnOrder: false,
        players: [
            { id: "p1", name: "P1", kind: "human" },
            { id: "p2", name: "P2", kind: "human" },
        ],
        ...overrides,
    };
}

/** Draft game on LINE with capitals at a and e; returns engine and the first player. */
function draftedGame(overrides: Partial<GameConfig> = {}) {
    const engine = new GameEngine(
        humans(overrides),
        LINE,
        questions,
        createSeededRng(1)
    );
    engine.start();
    const first = engine.getState().turnOrder[0];
    const second = engine.getState().turnOrder[1];
    engine.selectCapital(first, "a");
    engine.selectCapital(second, "e");
    return { engine, first, second };
}

describe("capital placement", () => {
    function draft() {
        const engine = new GameEngine(
            humans(),
            LINE,
            questions,
            createSeededRng(1)
        );
        engine.start();
        const [first, second] = engine.getState().turnOrder;
        return { engine, first, second };
    }

    it("rejects a capital bordering another capital", () => {
        const { engine, first, second } = draft();
        engine.selectCapital(first, "a");
        expect(() => engine.selectCapital(second, "b")).toThrow(GameRuleError);
    });

    it("only offers regions with a gap to existing capitals", () => {
        const { engine, first } = draft();
        engine.selectCapital(first, "c");
        expect(engine.capitalCandidates().sort()).toEqual(["a", "e"]);
    });

    it("keeps bot and random capitals apart on the Bulgaria map", () => {
        for (let seed = 1; seed <= 200; seed++) {
            const engine = new GameEngine(
                {
                    ...DEFAULT_CONFIG,
                    placement: "random",
                    players: [1, 2, 3, 4, 5].map((i) => ({
                        id: `b${i}`,
                        name: `B${i}`,
                        kind: "bot" as const,
                        difficulty: Difficulty.Medium,
                    })),
                },
                BULGARIA,
                questions,
                createSeededRng(seed)
            );
            engine.start();
            const { territories } = engine.getState();
            for (const t of Object.values(territories)) {
                if (!t.isCapital) continue;
                const touching = BULGARIA.regions[t.regionId].neighbors.filter(
                    (n) => territories[n].isCapital
                );
                expect(touching).toEqual([]);
            }
        }
    });
});

describe("Bulgaria map", () => {
    it("has 28 regions", () => {
        expect(Object.keys(BULGARIA.regions)).toHaveLength(28);
    });

    it("has symmetric adjacency", () => {
        expect(findAsymmetricEdges(BULGARIA)).toEqual([]);
    });

    it("is connected", () => {
        const seen = new Set(["sofia-city"]);
        const queue = ["sofia-city"];
        while (queue.length) {
            for (const n of BULGARIA.regions[queue.shift()].neighbors) {
                if (!seen.has(n)) {
                    seen.add(n);
                    queue.push(n);
                }
            }
        }
        expect(seen.size).toBe(28);
    });
});

describe("resolveMcq", () => {
    it.each([
        [right(), wrong(), "attacker"],
        [wrong(), right(), "defender"],
        [wrong(), wrong(), "defender"],
        [right(), right(), "tiebreak"],
    ])("%o vs %o -> %s", (a, d, expected) => {
        expect(resolveMcq(a, d, 1, LIMIT)).toBe(expected);
    });

    it("treats late answers as wrong", () => {
        expect(resolveMcq(right(LIMIT + 1), wrong(), 1, LIMIT)).toBe(
            "defender"
        );
        expect(resolveMcq(right(), right(LIMIT + 1), 1, LIMIT)).toBe(
            "attacker"
        );
    });
});

describe("resolveNumeric", () => {
    const n = (value: number | null, ms = 1000) => ({
        value,
        responseTimeMs: ms,
    });

    it("closest answer wins", () => {
        expect(resolveNumeric(n(90), n(120), 100, LIMIT)).toBe("attacker");
        expect(resolveNumeric(n(130), n(80), 100, LIMIT)).toBe("defender");
    });

    it("equal distance is won by the faster player", () => {
        expect(resolveNumeric(n(90, 2000), n(110, 3000), 100, LIMIT)).toBe(
            "attacker"
        );
        expect(resolveNumeric(n(90, 3000), n(110, 2000), 100, LIMIT)).toBe(
            "defender"
        );
    });

    it("perfect tie favours the defender", () => {
        expect(resolveNumeric(n(90), n(110), 100, LIMIT)).toBe("defender");
    });

    it("missing or late answers lose", () => {
        expect(resolveNumeric(n(null), n(5000), 100, LIMIT)).toBe("defender");
        expect(resolveNumeric(n(5000), n(100, LIMIT + 1), 100, LIMIT)).toBe(
            "attacker"
        );
        expect(resolveNumeric(undefined, undefined, 100, LIMIT)).toBe(
            "defender"
        );
    });
});

describe("applyAttackerWin", () => {
    const t = (o: Partial<Territory>): Territory => ({
        regionId: "x",
        ownerId: null,
        hp: 1,
        isCapital: false,
        walled: false,
        ...o,
    });

    it("captures a standard territory", () => {
        const r = applyAttackerWin(
            { x: t({ ownerId: "p2" }) },
            "p1",
            "x",
            "transfer"
        );
        expect(r.captured).toBe(true);
        expect(r.territories.x.ownerId).toBe("p1");
    });

    it("wall absorbs the win", () => {
        const r = applyAttackerWin(
            { x: t({ walled: true }) },
            "p1",
            "x",
            "transfer"
        );
        expect(r.wallBroken).toBe(true);
        expect(r.captured).toBe(false);
        expect(r.territories.x).toMatchObject({ walled: false, ownerId: null });
    });

    it("capital capture eliminates and transfers or neutralizes land", () => {
        const map = {
            x: t({ regionId: "x", ownerId: "p2", hp: 1, isCapital: true }),
            y: t({ regionId: "y", ownerId: "p2" }),
        };
        const transfer = applyAttackerWin(map, "p1", "x", "transfer");
        expect(transfer.eliminatedPlayerId).toBe("p2");
        expect(transfer.territories.x).toMatchObject({
            ownerId: "p1",
            isCapital: false,
            hp: 1,
        });
        expect(transfer.territories.y.ownerId).toBe("p1");

        const neutral = applyAttackerWin(map, "p1", "x", "neutral");
        expect(neutral.territories.x.ownerId).toBe("p1");
        expect(neutral.territories.y.ownerId).toBeNull();
        expect(map.y.ownerId).toBe("p2"); // input not mutated
    });
});

describe("bots", () => {
    const q = {
        id: "q",
        text: "?",
        options: ["a", "b", "c", "d"],
        correctIndex: 2,
    };

    it("answer correctly at roughly the configured rate with human-like timing", () => {
        const rng = createSeededRng(42);
        for (const [difficulty, p] of [
            [Difficulty.Easy, 0.4],
            [Difficulty.Medium, 0.65],
            [Difficulty.Hard, 0.85],
        ] as const) {
            let correct = 0;
            for (let i = 0; i < 4000; i++) {
                const a = botAnswerMcq(rng, difficulty, q);
                if (a.optionIndex === 2) correct++;
                expect(a.responseTimeMs).toBeGreaterThanOrEqual(
                    BOT_MIN_RESPONSE_MS
                );
                expect(a.responseTimeMs).toBeLessThanOrEqual(
                    BOT_MAX_RESPONSE_MS
                );
            }
            expect(correct / 4000).toBeCloseTo(p, 1);
        }
    });

    it("hard bots estimate closer than easy bots", () => {
        const rng = createSeededRng(7);
        const nq = { id: "n", text: "?", correctValue: 1000 };
        const avgErr = (d: Difficulty) => {
            let sum = 0;
            for (let i = 0; i < 2000; i++)
                sum += Math.abs(botAnswerNumeric(rng, d, nq).value - 1000);
            return sum / 2000;
        };
        expect(avgErr(Difficulty.Hard)).toBeLessThan(avgErr(Difficulty.Easy));
    });

    it("avoid walled targets and prefer damaged enemy capitals", () => {
        const { engine, first } = draftedGame();
        const s = engine.getState();
        s.territories.b = { ...s.territories.b, ownerId: first };
        s.territories.c = { ...s.territories.c, ownerId: first };
        s.territories.d = { ...s.territories.d, ownerId: first };
        s.territories.e.hp = 2;
        expect(
            botChooseTarget(createSeededRng(1), s, first, Difficulty.Hard)
        ).toBe("e");

        s.territories.e.walled = true;
        // Only target left is walled, so it is still chosen.
        expect(
            botChooseTarget(createSeededRng(1), s, first, Difficulty.Hard)
        ).toBe("e");
    });
});

describe("GameEngine", () => {
    it("validates player count", () => {
        expect(
            () =>
                new GameEngine(
                    humans({
                        players: [{ id: "p", name: "p", kind: "human" }],
                    }),
                    LINE,
                    questions
                )
        ).toThrow(GameRuleError);
    });

    it("random placement gives each player one 3 HP capital", () => {
        const engine = new GameEngine(
            humans({ placement: "random" }),
            BULGARIA,
            questions,
            createSeededRng(3)
        );
        engine.start();
        const capitals = Object.values(engine.getState().territories).filter(
            (t) => t.isCapital
        );
        expect(capitals).toHaveLength(2);
        expect(capitals.every((c) => c.hp === 3)).toBe(true);
        expect(engine.phase).toBe(GamePhase.TurnSelectTarget);
    });

    it("rejects non-adjacent targets and out-of-turn actions", () => {
        const { engine, first, second } = draftedGame();
        expect(() => engine.selectTarget(first, "c")).toThrow(GameRuleError);
        expect(() => engine.selectTarget(second, "d")).toThrow(GameRuleError);
    });

    it("hides correct answers from the public state until resolved", () => {
        const { engine, first } = draftedGame();
        engine.selectTarget(first, "b");
        // Neutral bot already answered; attacker hasn't.
        expect(engine.getPublicState().battle.mcq.correctIndex).toBeUndefined();
        expect(engine.getState().battle.mcq.correctIndex).toBe(1);
    });

    it("attacker wrong -> defender holds and turn passes", () => {
        const { engine, first, second } = draftedGame();
        engine.selectTarget(first, "b");
        engine.submitMcq(first, wrong());
        expect(engine.phase).toBe(GamePhase.BattleResolution);
        expect(engine.getState().battle.result.winner).toBe("defender");
        engine.continue();
        expect(engine.activePlayer.id).toBe(second);
        expect(engine.getState().territories.b.ownerId).toBeNull();
    });

    it("timer expiry counts as a wrong answer", () => {
        const { engine, first } = draftedGame();
        engine.selectTarget(first, "b");
        engine.expireTimer();
        expect(engine.getState().battle.result.winner).toBe("defender");
    });

    function attack(
        engine: GameEngine,
        attacker: string,
        defender: string,
        target: string
    ) {
        engine.selectTarget(attacker, target);
        engine.submitMcq(attacker, right());
        engine.submitMcq(defender, wrong());
    }

    it("capital siege chains until captured, then the game ends", () => {
        const { engine, first, second } = draftedGame();
        const s = engine.getState();
        // Give `first` the whole line up to d so they border the capital at e.
        for (const id of ["b", "c", "d"]) s.territories[id].ownerId = first;
        setState(engine, s);

        attack(engine, first, second, "e");
        let r = engine.getState().battle.result;
        expect(r).toMatchObject({
            winner: "attacker",
            targetHpAfter: 2,
            chainContinues: true,
        });

        engine.continue();
        expect(engine.phase).toBe(GamePhase.BattleMcq);
        expect(engine.getState().battle.chainIndex).toBe(2);
        engine.submitMcq(first, right());
        engine.submitMcq(second, right()); // tie-breaker
        expect(engine.phase).toBe(GamePhase.BattleNumeric);
        expect(
            engine.getPublicState().battle.numeric.correctValue
        ).toBeUndefined();
        engine.submitNumeric(first, { value: 100, responseTimeMs: 3000 });
        engine.submitNumeric(second, { value: 100, responseTimeMs: 4000 });
        r = engine.getState().battle.result;
        expect(r).toMatchObject({
            winner: "attacker",
            decidedBy: "numeric",
            targetHpAfter: 1,
        });

        engine.continue();
        engine.submitMcq(first, right());
        engine.submitMcq(second, wrong());
        r = engine.getState().battle.result;
        expect(r).toMatchObject({
            captured: true,
            eliminatedPlayerId: second,
            chainContinues: false,
        });

        engine.continue();
        expect(engine.phase).toBe(GamePhase.GameOver);
        expect(engine.getState().winners).toEqual([first]);
    });

    it("a successful defence breaks the siege chain", () => {
        const { engine, first, second } = draftedGame();
        const s = engine.getState();
        for (const id of ["b", "c", "d"]) s.territories[id].ownerId = first;
        setState(engine, s);

        attack(engine, first, second, "e");
        engine.continue();
        engine.submitMcq(first, wrong());
        engine.submitMcq(second, right());
        expect(engine.getState().battle.result.winner).toBe("defender");
        engine.continue();
        expect(engine.activePlayer.id).toBe(second);
        expect(engine.getState().territories.e.hp).toBe(2);
    });

    it("capital captured on the final turn of the final round ends the game correctly", () => {
        const { engine, first, second } = draftedGame({
            rounds: 1,
            placement: "draft",
        });
        // first passes their turn by failing.
        engine.selectTarget(first, "b");
        engine.submitMcq(first, wrong());
        engine.continue();

        const s = engine.getState();
        for (const id of ["b", "c", "d"]) s.territories[id].ownerId = second;
        s.territories.a.hp = 1;
        setState(engine, s);

        attack(engine, second, first, "a");
        expect(engine.getState().battle.result.eliminatedPlayerId).toBe(first);
        engine.continue();
        expect(engine.phase).toBe(GamePhase.GameOver);
        expect(engine.getState().winners).toEqual([second]);
    });

    it("ends after the configured rounds and ranks by territory count", () => {
        const { engine, first, second } = draftedGame({ rounds: 2 });
        const s = engine.getState();
        s.territories.b.ownerId = first;
        setState(engine, s);
        // Round 1: both fail.
        engine.selectTarget(first, "c");
        engine.submitMcq(first, wrong());
        engine.continue();
        engine.selectTarget(second, "d");
        engine.submitMcq(second, wrong());
        engine.continue();
        expect(engine.phase).toBe(GamePhase.RoundEnd);
        engine.continue();
        expect(engine.getState().round).toBe(2);
        // Round 2: both fail.
        engine.selectTarget(first, "c");
        engine.submitMcq(first, wrong());
        engine.continue();
        engine.selectTarget(second, "d");
        engine.submitMcq(second, wrong());
        engine.continue();
        engine.continue();
        expect(engine.phase).toBe(GamePhase.GameOver);
        expect(engine.getState().winners).toEqual([first]);
    });

    it("plays a full bot-only game on Bulgaria without errors", () => {
        for (let seed = 1; seed <= 20; seed++) {
            const rng = createSeededRng(seed);
            const config: GameConfig = {
                ...DEFAULT_CONFIG,
                rounds: 7,
                players: [1, 2, 3, 4, 5].map((i) => ({
                    id: `b${i}`,
                    name: `Bot ${i}`,
                    kind: "bot" as const,
                    difficulty: Difficulty.Hard,
                })),
            };
            const engine = new GameEngine(config, BULGARIA, questions, rng);
            engine.start();
            let steps = 0;
            while (engine.phase !== GamePhase.GameOver && steps++ < 10000) {
                if (engine.phase === GamePhase.TurnSelectTarget) {
                    const p = engine.activePlayer;
                    engine.selectTarget(
                        p.id,
                        botChooseTarget(
                            rng,
                            engine.getState(),
                            p.id,
                            p.difficulty
                        )
                    );
                } else {
                    engine.continue();
                }
            }
            expect(engine.phase).toBe(GamePhase.GameOver);
            expect(engine.getState().winners.length).toBeGreaterThan(0);
        }
    });
});
