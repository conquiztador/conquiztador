import { capitalCandidates } from "./territory";
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

/**
 * A bot "knows" the answer with its difficulty's probability; otherwise it
 * guesses among the wrong options still shown (50/50 can leave just one, and
 * then a guess may also land on the right one).
 */
export function botAnswerMcq(
    rng: Rng,
    difficulty: Difficulty,
    question: McqQuestion,
    removed: number[] = []
): McqAnswer {
    const knows = rng() < BOT_CORRECT_PROBABILITY[difficulty];
    const shown = question.options
        .map((_, i) => i)
        .filter((i) => !removed.includes(i));
    const wrong = shown.filter((i) => i !== question.correctIndex);
    let optionIndex = question.correctIndex;
    if (!knows && wrong.length) {
        // With options removed the guess is over everything still shown.
        optionIndex = removed.length ? pick(rng, shown) : pick(rng, wrong);
    }
    return { optionIndex, responseTimeMs: responseTime(rng) };
}

/**
 * Gaussian guess around the true value. With a Range Finder bracket the
 * spread is halved and the guess is kept inside the bracket.
 */
export function botAnswerNumeric(
    rng: Rng,
    difficulty: Difficulty,
    question: NumericQuestion,
    bracket?: { min: number; max: number }
): NumericAnswer {
    const sigma =
        Math.max(
            1,
            Math.abs(question.correctValue) * BOT_NUMERIC_SPREAD[difficulty]
        ) * (bracket ? 0.5 : 1);
    let value = Math.round(question.correctValue + gaussian(rng) * sigma);
    if (bracket) value = Math.min(bracket.max, Math.max(bracket.min, value));
    return { value, responseTimeMs: responseTime(rng) };
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

/** Picks a starting capital among the allowed (spaced-out) regions. */
export function botChooseCapital(rng: Rng, state: GameState): RegionId {
    return pick(rng, capitalCandidates(state));
}
