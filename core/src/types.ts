export type PlayerId = string;
export type RegionId = string;

export enum GamePhase {
    Lobby = "LOBBY",
    CapitalSelection = "CAPITAL_SELECTION",
    TurnSelectTarget = "TURN_SELECT_TARGET",
    BattleMcq = "BATTLE_MCQ",
    BattleNumeric = "BATTLE_NUMERIC",
    BattleResolution = "BATTLE_RESOLUTION",
    RoundEnd = "ROUND_END",
    GameOver = "GAME_OVER",
}

export enum Difficulty {
    Easy = "EASY",
    Medium = "MEDIUM",
    Hard = "HARD",
}

export type PlacementMode = "random" | "draft";
export type CapitalCaptureRule = "transfer" | "neutral";

/** Power-ups (agents.md §2.5). */
export const POWER_UP_KINDS = [
    "fiftyFifty",
    "rangeFinder",
    "fortify",
    "extraTime",
    "scout",
] as const;
export type PowerUpKind = (typeof POWER_UP_KINDS)[number];

/**
 * How players get power-ups:
 * - none: never.
 * - oneEach: one charge of each enabled kind at the start.
 * - random: a few random charges (of enabled kinds) at the start.
 * - reward: none at the start; earned for correct answers and regions taken.
 * - catchUp: none at the start; earned for wrong answers and regions lost.
 */
export const POWER_UP_MODES = [
    "none",
    "oneEach",
    "random",
    "reward",
    "catchUp",
] as const;
export type PowerUpMode = (typeof POWER_UP_MODES)[number];

export interface PowerUpSettings {
    mode: PowerUpMode;
    /** Which kinds are in play (at least one unless mode is "none"). */
    kinds: PowerUpKind[];
}

/** Charges a player holds, by kind. */
export type PowerUpInventory = Record<PowerUpKind, number>;

/** Milestone counters for the reward / catch-up modes. */
export interface PowerUpProgress {
    correct: number;
    wrong: number;
    taken: number;
    lost: number;
}

export type PowerUpGrantReason = "start" | "correct" | "wrong" | "taken" | "lost";

export interface PowerUpGrant {
    playerId: PlayerId;
    kind: PowerUpKind;
    reason: PowerUpGrantReason;
}

/** What using a power-up revealed, for the player who used it only. */
export type PowerUpEffect =
    | { kind: "fiftyFifty"; removed: number[] }
    | { kind: "rangeFinder"; min: number; max: number }
    | { kind: "extraTime"; bonusMs: number }
    | { kind: "fortify"; regionId: RegionId }
    | { kind: "scout"; category: string | null };

/** Help a side has in the current battle (hidden from other players). */
export interface BattleAids {
    /** Option indices removed by 50/50. */
    fiftyFifty?: number[];
    rangeFinder?: { min: number; max: number };
    /** Extra answer time on the multiple-choice question. */
    mcqBonusMs?: number;
    /** Extra answer time on the numeric question. */
    numericBonusMs?: number;
}

export interface Region {
    id: RegionId;
    name: string;
    neighbors: RegionId[];
}

export interface MapGraph {
    id: string;
    regions: Record<RegionId, Region>;
}

export interface PlayerConfig {
    id: PlayerId;
    name: string;
    kind: "human" | "bot";
    difficulty?: Difficulty;
}

export interface Player extends PlayerConfig {
    eliminated: boolean;
}

export interface GameConfig {
    players: PlayerConfig[];
    rounds: number;
    placement: PlacementMode;
    onCapitalCaptured: CapitalCaptureRule;
    neutralDifficulty: Difficulty;
    timeLimitMs: number;
    /** Rotate turn order each round so the same player doesn't always go first. */
    rotateTurnOrder: boolean;
    powerUps: PowerUpSettings;
}

export const CAPITAL_HP = 3;
export const STANDARD_HP = 1;

export interface Territory {
    regionId: RegionId;
    ownerId: PlayerId | null;
    hp: number;
    isCapital: boolean;
    walled: boolean;
}

export interface McqQuestion {
    id: string;
    text: string;
    category?: string;
    options: string[];
    correctIndex: number;
}

export interface NumericQuestion {
    id: string;
    text: string;
    category?: string;
    correctValue: number;
}

export interface McqAnswer {
    optionIndex: number | null;
    responseTimeMs: number;
}

export interface NumericAnswer {
    value: number | null;
    responseTimeMs: number;
}

export type Side = "attacker" | "defender";

export interface BattleResult {
    winner: Side;
    decidedBy: "mcq" | "numeric";
    /** HP left on the target after this battle (0 = captured). */
    targetHpAfter: number;
    wallBroken: boolean;
    captured: boolean;
    eliminatedPlayerId: PlayerId | null;
    /** True when the attacker immediately attacks the same capital again. */
    chainContinues: boolean;
}

export interface BattleState {
    attackerId: PlayerId;
    /** null = neutral environment defender. */
    defenderId: PlayerId | null;
    targetId: RegionId;
    /** 1 for the first battle of a turn, incremented on each capital chain attack. */
    chainIndex: number;
    mcq: McqQuestion;
    mcqAnswers: Partial<Record<Side, McqAnswer>>;
    numeric: NumericQuestion | null;
    numericAnswers: Partial<Record<Side, NumericAnswer>>;
    /** Power-ups used in this battle, per side. */
    aids: Partial<Record<Side, BattleAids>>;
    result: BattleResult | null;
}

export interface GameState {
    phase: GamePhase;
    config: GameConfig;
    map: MapGraph;
    players: Player[];
    territories: Record<RegionId, Territory>;
    round: number;
    turnOrder: PlayerId[];
    turnIndex: number;
    battle: BattleState | null;
    winners: PlayerId[];
    /** Power-up charges per player (public: everyone sees everyone's). */
    powerUps: Record<PlayerId, PowerUpInventory>;
    powerUpProgress: Record<PlayerId, PowerUpProgress>;
}
