import { McqAnswer, NumericAnswer, Side } from "./types";

export type McqOutcome = Side | "tiebreak";

/** One limit for both sides, or a limit per side (Extra Time). */
export type TimeLimit = number | Record<Side, number>;

export function limitFor(limit: TimeLimit, side: Side): number {
    return typeof limit === "number" ? limit : limit[side];
}

export function isAnswerCorrect(
    answer: McqAnswer | undefined,
    correctIndex: number,
    timeLimitMs: number
): boolean {
    return (
        !!answer &&
        answer.optionIndex === correctIndex &&
        answer.responseTimeMs <= timeLimitMs
    );
}

/**
 * Phase 1. Attacker must be correct to have any chance; defender holds on
 * any attacker mistake. Both correct goes to the numeric tie-breaker.
 */
export function resolveMcq(
    attacker: McqAnswer | undefined,
    defender: McqAnswer | undefined,
    correctIndex: number,
    timeLimitMs: TimeLimit
): McqOutcome {
    const a = isAnswerCorrect(
        attacker,
        correctIndex,
        limitFor(timeLimitMs, "attacker")
    );
    const d = isAnswerCorrect(
        defender,
        correctIndex,
        limitFor(timeLimitMs, "defender")
    );

    if (!a) return "defender";
    if (!d) return "attacker";
    return "tiebreak";
}

function validNumeric(
    answer: NumericAnswer | undefined,
    timeLimitMs: number
): answer is NumericAnswer & { value: number } {
    return (
        !!answer &&
        typeof answer.value === "number" &&
        Number.isFinite(answer.value) &&
        answer.responseTimeMs <= timeLimitMs
    );
}

/**
 * Phase 2. Closest answer wins; equal distance is broken by faster response.
 * A missing/late answer always loses. A perfect tie (or both missing)
 * favours the defender.
 */
export function resolveNumeric(
    attacker: NumericAnswer | undefined,
    defender: NumericAnswer | undefined,
    correctValue: number,
    timeLimitMs: TimeLimit
): Side {
    const aValid = validNumeric(attacker, limitFor(timeLimitMs, "attacker"));
    const dValid = validNumeric(defender, limitFor(timeLimitMs, "defender"));

    if (!aValid) return "defender";
    if (!dValid) return "attacker";

    const aDiff = Math.abs(attacker.value - correctValue);
    const dDiff = Math.abs(defender.value - correctValue);

    if (aDiff !== dDiff) return aDiff < dDiff ? "attacker" : "defender";
    if (attacker.responseTimeMs !== defender.responseTimeMs) {
        return attacker.responseTimeMs < defender.responseTimeMs
            ? "attacker"
            : "defender";
    }
    return "defender";
}
