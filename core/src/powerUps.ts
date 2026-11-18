import { pick, Rng, shuffle } from "./rng";
import {
    BattleState,
    Difficulty,
    GameState,
    McqQuestion,
    PlayerId,
    POWER_UP_KINDS,
    PowerUpGrantReason,
    PowerUpInventory,
    PowerUpKind,
    PowerUpProgress,
    PowerUpSettings,
    RegionId,
} from "./types";

/** Power-up rules and values (agents.md §2.5). */

/** Extra Time adds this much to the player's own answer timer. */
export const EXTRA_TIME_MS = 5000;
/** "random" mode: charges each player starts with (kinds may repeat). */
export const RANDOM_START_CHARGES = 3;
/** "reward" mode: one random power-up per this many correct answers... */
export const REWARD_CORRECT_EVERY = 3;
/** ...and per this many regions taken. */
export const REWARD_TAKEN_EVERY = 2;
/** "catchUp" mode: one random power-up per this many wrong answers... */
export const CATCH_UP_WRONG_EVERY = 2;
/** ...and per this many regions lost. */
export const CATCH_UP_LOST_EVERY = 1;
/** A player never holds more than this many charges of one kind. */
export const MAX_CHARGES_PER_KIND = 3;
/** Range Finder bracket width, as a fraction of the answer (±25%). */
export const RANGE_FINDER_WIDTH = 0.5;
/** Smallest Range Finder bracket, for answers near zero. */
export const RANGE_FINDER_MIN_WIDTH = 4;

export const NO_POWER_UPS: PowerUpSettings = { mode: "none", kinds: [] };
export const ALL_POWER_UPS: PowerUpSettings = {
    mode: "oneEach",
    kinds: [...POWER_UP_KINDS],
};

export function emptyInventory(): PowerUpInventory {
    return Object.fromEntries(
        POWER_UP_KINDS.map((k) => [k, 0])
    ) as PowerUpInventory;
}

export function emptyProgress(): PowerUpProgress {
    return { correct: 0, wrong: 0, taken: 0, lost: 0 };
}

/** Kinds in play (deduplicated, in canonical order). */
export function enabledKinds(settings: PowerUpSettings): PowerUpKind[] {
    if (settings.mode === "none") return [];
    return POWER_UP_KINDS.filter((k) => settings.kinds.includes(k));
}

/** What one player starts the match with. */
export function startingInventory(
    rng: Rng,
    settings: PowerUpSettings
): PowerUpInventory {
    const inv = emptyInventory();
    const kinds = enabledKinds(settings);
    if (settings.mode === "oneEach") for (const k of kinds) inv[k] = 1;
    if (settings.mode === "random" && kinds.length)
        for (let i = 0; i < RANDOM_START_CHARGES; i++) inv[pick(rng, kinds)]++;
    return inv;
}

/**
 * Adds one to a milestone counter and says whether that earned a power-up
 * under the current mode.
 */
export function milestoneEarned(
    settings: PowerUpSettings,
    progress: PowerUpProgress,
    event: keyof PowerUpProgress
): boolean {
    progress[event]++;
    const n = progress[event];
    if (settings.mode === "reward") {
        if (event === "correct") return n % REWARD_CORRECT_EVERY === 0;
        if (event === "taken") return n % REWARD_TAKEN_EVERY === 0;
    }
    if (settings.mode === "catchUp") {
        if (event === "wrong") return n % CATCH_UP_WRONG_EVERY === 0;
        if (event === "lost") return n % CATCH_UP_LOST_EVERY === 0;
    }
    return false;
}

export const MILESTONE_REASON: Record<
    keyof PowerUpProgress,
    PowerUpGrantReason
> = { correct: "correct", wrong: "wrong", taken: "taken", lost: "lost" };

/**
 * A random enabled kind the player can still hold more of, or null when
 * they're full (or nothing is enabled).
 */
export function grantableKind(
    rng: Rng,
    settings: PowerUpSettings,
    inventory: PowerUpInventory
): PowerUpKind | null {
    const open = enabledKinds(settings).filter(
        (k) => inventory[k] < MAX_CHARGES_PER_KIND
    );
    return open.length ? pick(rng, open) : null;
}

/** 50/50: two wrong options to hide (all but one wrong option if fewer). */
export function fiftyFiftyRemoved(rng: Rng, question: McqQuestion): number[] {
    const wrong = question.options
        .map((_, i) => i)
        .filter((i) => i !== question.correctIndex);
    const keep = Math.max(1, wrong.length - 2);
    return shuffle(rng, wrong)
        .slice(keep)
        .sort((a, b) => a - b);
}

/**
 * Range Finder: an integer bracket about ±25% of the answer wide, randomly
 * placed so the answer isn't always in the middle (never at the very edge).
 */
export function rangeFinderBracket(
    rng: Rng,
    correctValue: number
): { min: number; max: number } {
    const width = Math.max(
        RANGE_FINDER_MIN_WIDTH,
        Math.abs(correctValue) * RANGE_FINDER_WIDTH
    );
    const offset = 0.1 + rng() * 0.8;
    const min = Math.floor(correctValue - width * offset);
    const max = Math.ceil(min + width);
    return { min, max: Math.max(max, Math.ceil(correctValue)) };
}

// ------------------------------------------------------------------ bots

/** Chance a bot uses 50/50 in a battle that doesn't involve a capital. */
export const BOT_FIFTY_FIFTY_CASUAL = 0.2;

/**
 * Bots use 50/50 in capital battles (attacking or defending one), and now
 * and then otherwise.
 */
export function botWantsFiftyFifty(
    rng: Rng,
    state: GameState,
    battle: BattleState
): boolean {
    return (
        state.territories[battle.targetId].isCapital ||
        rng() < BOT_FIFTY_FIFTY_CASUAL
    );
}

/**
 * Bots fortify their own capital when it borders another player's land and
 * isn't walled yet (Easy bots only half the time). Returns the region to
 * wall, or null.
 */
export function botChooseFortify(
    rng: Rng,
    state: GameState,
    botId: PlayerId,
    difficulty: Difficulty
): RegionId | null {
    if ((state.powerUps[botId]?.fortify ?? 0) < 1) return null;
    const capital = Object.values(state.territories).find(
        (t) => t.isCapital && t.ownerId === botId
    );
    if (!capital || capital.walled) return null;
    const threatened = state.map.regions[capital.regionId].neighbors.some(
        (n) => {
            const owner = state.territories[n].ownerId;
            return owner !== null && owner !== botId;
        }
    );
    if (!threatened) return null;
    if (difficulty === Difficulty.Easy && rng() < 0.5) return null;
    return capital.regionId;
}
