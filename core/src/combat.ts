import { McqAnswer, NumericAnswer, Side } from "./types";

export type McqOutcome = Side | "tiebreak";

function isAnswerCorrect(
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
    timeLimitMs: number
): McqOutcome {
    const a = isAnswerCorrect(attacker, correctIndex, timeLimitMs);
    const d = isAnswerCorrect(defender, correctIndex, timeLimitMs);

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
    timeLimitMs: number
): Side {
    const aValid = validNumeric(attacker, timeLimitMs);
    const dValid = validNumeric(defender, timeLimitMs);

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
