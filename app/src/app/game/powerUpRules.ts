import type {
    PowerUpEffect,
    PowerUpInventory,
    PowerUpKind,
} from "@conquiztador/core";

/**
 * Client-side power-up rules (agents.md §2.5): when a power-up button is
 * enabled, and how a power-up's private effect changes the question on
 * screen. Mirrors what the server accepts so the player never presses a
 * button the server would reject.
 */

/** Help the local player has on the question on screen. */
export interface QuestionAids {
    /** Option indices hidden by 50/50. */
    removed: number[] | null;
    /** Range Finder bracket. */
    range: { min: number; max: number } | null;
    /** Extra Time added to your timer. */
    bonusMs: number;
}

export const NO_AIDS: QuestionAids = { removed: null, range: null, bonusMs: 0 };

/** What the local player is doing right now, as far as power-ups care. */
export type PowerUpMoment =
    /** Nothing a power-up can be used on. */
    | { kind: "none" }
    /** You hold the target prompt (your turn, before choosing a target). */
    | {
          kind: "target";
          /** How many of your regions could take a wall. */
          fortifiable: number;
          /** Scout was already used this turn. */
          scouted: boolean;
      }
    /**
     * A question in a battle you fight. `answering` is true until you answer
     * or your time runs out.
     */
    | { kind: "mcq" | "numeric"; answering: boolean; aids: QuestionAids };

export interface PowerUpCheck {
    /** Your charges (undefined before the match state arrives). */
    charges: PowerUpInventory | undefined;
    moment: PowerUpMoment;
    /** A use is waiting for the server's answer: block further uses. */
    pending: boolean;
}

/** Whether the server would accept using `kind` right now. */
export function canUsePowerUp(kind: PowerUpKind, check: PowerUpCheck): boolean {
    const { charges, moment: m, pending } = check;
    if (pending || (charges?.[kind] ?? 0) < 1) return false;
    switch (kind) {
        case "fortify":
            return m.kind === "target" && m.fortifiable > 0;
        case "scout":
            return m.kind === "target" && !m.scouted;
        case "fiftyFifty":
            return m.kind === "mcq" && m.answering && m.aids.removed === null;
        case "rangeFinder":
            return m.kind === "numeric" && m.answering && m.aids.range === null;
        case "extraTime":
            return (
                (m.kind === "mcq" || m.kind === "numeric") &&
                m.answering &&
                m.aids.bonusMs === 0
            );
        default:
            return false;
    }
}

/**
 * Applies a power-up's private effect to the question on screen. Effects
 * can arrive again after a reconnect, so applying one twice changes
 * nothing; the same object is returned when nothing changed.
 */
export function applyEffect(
    aids: QuestionAids,
    effect: PowerUpEffect,
    question: "mcq" | "numeric"
): QuestionAids {
    switch (effect.kind) {
        case "fiftyFifty": {
            if (question !== "mcq") return aids;
            const removed = [...effect.removed].sort((a, b) => a - b);
            if (aids.removed && sameNumbers(aids.removed, removed)) return aids;
            return { ...aids, removed };
        }
        case "rangeFinder": {
            if (question !== "numeric") return aids;
            const { min, max } = effect;
            if (aids.range?.min === min && aids.range?.max === max) return aids;
            return { ...aids, range: { min, max } };
        }
        case "extraTime":
            // Once per question: the bonus is set, never added up.
            if (aids.bonusMs === effect.bonusMs) return aids;
            return { ...aids, bonusMs: effect.bonusMs };
        default:
            return aids;
    }
}

function sameNumbers(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((n, i) => n === b[i]);
}

/** Power-ups that work during each kind of question. */
export const QUESTION_POWER_UPS: Record<"mcq" | "numeric", PowerUpKind[]> = {
    mcq: ["fiftyFifty", "extraTime"],
    numeric: ["rangeFinder", "extraTime"],
};

/** Power-ups used from the HUD on your turn, before choosing a target. */
export const TURN_POWER_UPS: PowerUpKind[] = ["fortify", "scout"];

/** Total charges a player holds. */
export function totalCharges(inventory: PowerUpInventory | undefined): number {
    if (!inventory) return 0;
    return Object.values(inventory).reduce((sum, n) => sum + n, 0);
}

/** Icons for the HUD and battle buttons. */
export const POWER_UP_ICONS: Record<PowerUpKind, string> = {
    fiftyFifty: "½",
    rangeFinder: "🎯",
    fortify: "🧱",
    extraTime: "⏱",
    scout: "🔭",
};
