import {
    ALL_POWER_UPS,
    Difficulty,
    POWER_UP_KINDS,
    PowerUpKind,
    PowerUpMode,
    PowerUpSettings,
    PowerUpSettingsSchema,
    ROOM_ROUNDS,
    ROOM_SEATS_MAX,
    ROUNDS_MAX,
    ROUNDS_MIN,
} from "@conquiztador/core";

/**
 * Match settings shared by the single-player lobby and room settings:
 * rounds (presets or a custom number) and power-ups (agents.md §2.1, §2.5).
 * Pure helpers so the forms stay simple and testable.
 */

export const DEFAULT_ROUNDS = 5;

/** A whole number of rounds in range, or null for anything else. */
export function parseRounds(text: string): number | null {
    const trimmed = text.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const n = Number(trimmed);
    return n >= ROUNDS_MIN && n <= ROUNDS_MAX ? n : null;
}

export function isPresetRounds(rounds: number): boolean {
    return (ROOM_ROUNDS as readonly number[]).includes(rounds);
}

/** What's wrong with the power-up choice, or null when it's fine. */
export function powerUpProblem(settings: PowerUpSettings): "kinds" | null {
    return settings.mode !== "none" && settings.kinds.length === 0
        ? "kinds"
        : null;
}

/**
 * Switches the supply mode. Kinds are kept while power-ups are off, so
 * switching back restores them; coming back with none chosen enables all.
 */
export function withMode(
    settings: PowerUpSettings,
    mode: PowerUpMode
): PowerUpSettings {
    const kinds =
        mode !== "none" && settings.kinds.length === 0
            ? [...POWER_UP_KINDS]
            : settings.kinds;
    return { mode, kinds };
}

/** Turns one kind on or off, keeping the canonical order. */
export function toggleKind(
    settings: PowerUpSettings,
    kind: PowerUpKind
): PowerUpSettings {
    const on = settings.kinds.includes(kind);
    const kinds = POWER_UP_KINDS.filter((k) =>
        k === kind ? !on : settings.kinds.includes(k)
    );
    return { ...settings, kinds };
}

/** Valid power-up settings from anything (e.g. old saved values). */
export function sanitizePowerUps(raw: unknown): PowerUpSettings {
    const parsed = PowerUpSettingsSchema.safeParse(raw);
    if (!parsed.success)
        return { ...ALL_POWER_UPS, kinds: [...ALL_POWER_UPS.kinds] };
    const { mode, kinds } = parsed.data;
    return { mode, kinds: POWER_UP_KINDS.filter((k) => kinds.includes(k)) };
}

/** What the single-player lobby remembers between visits. */
export interface LobbySettings {
    opponents: number;
    difficulty: Difficulty;
    rounds: number;
    placement: "draft" | "random";
    powerUps: PowerUpSettings;
}

export const DEFAULT_LOBBY: LobbySettings = {
    opponents: 2,
    difficulty: Difficulty.Medium,
    rounds: DEFAULT_ROUNDS,
    placement: "draft",
    powerUps: ALL_POWER_UPS,
};

/**
 * Lobby settings from storage: every field that's missing or invalid
 * (older versions stored fewer fields) falls back to its default.
 */
export function sanitizeLobby(raw: unknown): LobbySettings {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<
        string,
        unknown
    >;
    const opponents =
        Number.isInteger(o.opponents) &&
        (o.opponents as number) >= 1 &&
        (o.opponents as number) <= ROOM_SEATS_MAX - 1
            ? (o.opponents as number)
            : DEFAULT_LOBBY.opponents;
    const difficulty = (Object.values(Difficulty) as unknown[]).includes(
        o.difficulty
    )
        ? (o.difficulty as Difficulty)
        : DEFAULT_LOBBY.difficulty;
    const rounds =
        typeof o.rounds === "number" && parseRounds(String(o.rounds)) !== null
            ? o.rounds
            : DEFAULT_LOBBY.rounds;
    const placement =
        o.placement === "draft" || o.placement === "random"
            ? o.placement
            : DEFAULT_LOBBY.placement;
    const powerUps =
        "powerUps" in o ? sanitizePowerUps(o.powerUps) : ALL_POWER_UPS;
    return { opponents, difficulty, rounds, placement, powerUps };
}
