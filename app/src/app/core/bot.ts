import { gaussian, pick, randomInt, Rng, shuffle } from "./rng";
import { attackableTargets } from "./territory";
import {
    CAPITAL_HP,
    Difficulty,
    GameState,
    McqAnswer,
    McqQuestion,
    NumericAnswer,
    NumericQuestion,
    PlayerId,
    RegionId,
} from "./types";

export const BOT_CORRECT_PROBABILITY: Record<Difficulty, number> = {
    [Difficulty.Easy]: 0.4,
    [Difficulty.Medium]: 0.65,
    [Difficulty.Hard]: 0.85,
};

/** Standard deviation of numeric guesses, as a fraction of the true value. */
export const BOT_NUMERIC_SPREAD: Record<Difficulty, number> = {
    [Difficulty.Easy]: 0.35,
    [Difficulty.Medium]: 0.2,
    [Difficulty.Hard]: 0.08,
};

export const BOT_MIN_RESPONSE_MS = 2500;
export const BOT_MAX_RESPONSE_MS = 9000;

function responseTime(rng: Rng): number {
    return randomInt(rng, BOT_MIN_RESPONSE_MS, BOT_MAX_RESPONSE_MS);
}

export function botAnswerMcq(
    rng: Rng,
    difficulty: Difficulty,
    question: McqQuestion
): McqAnswer {
    const correct = rng() < BOT_CORRECT_PROBABILITY[difficulty];
    const wrong = question.options
        .map((_, i) => i)
        .filter((i) => i !== question.correctIndex);
    return {
        optionIndex: correct ? question.correctIndex : pick(rng, wrong),
        responseTimeMs: responseTime(rng),
    };
}

export function botAnswerNumeric(
    rng: Rng,
    difficulty: Difficulty,
    question: NumericQuestion
): NumericAnswer {
    const sigma = Math.max(
        1,
        Math.abs(question.correctValue) * BOT_NUMERIC_SPREAD[difficulty]
    );
    return {
        value: Math.round(question.correctValue + gaussian(rng) * sigma),
        responseTimeMs: responseTime(rng),
    };
}

/** Higher = more attractive. Exported for tests and debugging. */
export function scoreTarget(
    state: GameState,
    botId: PlayerId,
    targetId: RegionId
): number {
    const target = state.territories[targetId];
    const neighbors = state.map.regions[targetId].neighbors;
    let score = 0;

    // Cluster completion: prefer targets surrounded by our own land.
    const ownNeighbors = neighbors.filter(
        (n) => state.territories[n].ownerId === botId
    ).length;
    score += (ownNeighbors / neighbors.length) * 10;

    // Damaged enemy capitals and land bordering them.
    if (target.isCapital && target.ownerId && target.hp < CAPITAL_HP) {
        score += 30 + (CAPITAL_HP - target.hp) * 10;
    } else if (
        neighbors.some((n) => {
            const t = state.territories[n];
            return (
                t.isCapital &&
                t.ownerId !== null &&
                t.ownerId !== botId &&
                t.hp < CAPITAL_HP
            );
        })
    ) {
        score += 15;
    }

    // Healthy capitals are expensive; neutral land is cheap.
    if (target.isCapital && target.hp === CAPITAL_HP) score -= 5;
    if (target.ownerId === null) score += 3;

    if (target.walled) score -= 100;
    return score;
}

export function botChooseTarget(
    rng: Rng,
    state: GameState,
    botId: PlayerId,
    difficulty: Difficulty
): RegionId | null {
    const targets = attackableTargets(state, botId);
    if (targets.length === 0) return null;

    const unwalled = targets.filter((t) => !state.territories[t].walled);
    const pool = unwalled.length > 0 ? unwalled : targets;

    if (difficulty === Difficulty.Easy) return pick(rng, pool);

    const noise = difficulty === Difficulty.Medium ? 10 : 0;
    let best: RegionId = pool[0];
    let bestScore = -Infinity;
    for (const t of shuffle(rng, pool)) {
        const s = scoreTarget(state, botId, t) + rng() * noise;
        if (s > bestScore) {
            bestScore = s;
            best = t;
        }
    }
    return best;
}

/** Picks a starting capital, preferring regions not adjacent to an existing capital. */
export function botChooseCapital(rng: Rng, state: GameState): RegionId {
    const free = Object.values(state.territories)
        .filter((t) => t.ownerId === null)
        .map((t) => t.regionId);
    const isolated = free.filter(
        (id) =>
            !state.map.regions[id].neighbors.some(
                (n) => state.territories[n].isCapital
            )
    );
    return pick(rng, isolated.length > 0 ? isolated : free);
}
