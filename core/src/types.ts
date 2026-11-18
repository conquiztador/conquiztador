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
}
