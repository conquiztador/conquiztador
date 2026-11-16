import { botAnswerMcq, botAnswerNumeric, botChooseCapital } from "./bot";
import { resolveMcq, resolveNumeric } from "./combat";
import { Rng, shuffle } from "./rng";
import {
    applyAttackerWin,
    attackableTargets,
    capitalCandidates,
    isAttackable,
    territoriesOf,
} from "./territory";
import {
    BattleResult,
    BattleState,
    CAPITAL_HP,
    Difficulty,
    GameConfig,
    GamePhase,
    GameState,
    MapGraph,
    McqAnswer,
    McqQuestion,
    NumericAnswer,
    NumericQuestion,
    Player,
    PlayerId,
    RegionId,
    Side,
    STANDARD_HP,
    Territory,
} from "./types";

export interface QuestionProvider {
    nextMcq(): McqQuestion;
    nextNumeric(): NumericQuestion;
}

export class GameRuleError extends Error {}

export const DEFAULT_CONFIG: Omit<GameConfig, "players"> = {
    rounds: 5,
    placement: "random",
    onCapitalCaptured: "transfer",
    neutralDifficulty: Difficulty.Medium,
    timeLimitMs: 15000,
    rotateTurnOrder: true,
};

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;

/** Client-safe battle view: correct answers are hidden until the battle is resolved. */
export type PublicBattleState = Omit<BattleState, "mcq" | "numeric"> & {
    mcq: Omit<McqQuestion, "correctIndex"> & { correctIndex?: number };
    numeric:
        | (Omit<NumericQuestion, "correctValue"> & { correctValue?: number })
        | null;
};
export type PublicGameState = Omit<GameState, "battle"> & {
    battle: PublicBattleState | null;
};

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

/**
 * Authoritative game state machine. All transitions are validated here;
 * UI and networking layers only call these methods and render the state.
 */
export class GameEngine {
    private state: GameState;

    constructor(
        config: GameConfig,
        map: MapGraph,
        private readonly questions: QuestionProvider,
        private readonly rng: Rng = Math.random
    ) {
        const count = config.players.length;
        if (count < MIN_PLAYERS || count > MAX_PLAYERS) {
            throw new GameRuleError(
                `Player count must be ${MIN_PLAYERS}-${MAX_PLAYERS}, got ${count}`
            );
        }
        if (new Set(config.players.map((p) => p.id)).size !== count) {
            throw new GameRuleError("Player ids must be unique");
        }
        if (config.rounds < 1) throw new GameRuleError("Rounds must be >= 1");

        const territories: Record<RegionId, Territory> = {};
        for (const id of Object.keys(map.regions)) {
            territories[id] = {
                regionId: id,
                ownerId: null,
                hp: STANDARD_HP,
                isCapital: false,
                walled: false,
            };
        }

        this.state = {
            phase: GamePhase.Lobby,
            config: clone(config),
            map,
            players: config.players.map((p) => ({ ...p, eliminated: false })),
            territories,
            round: 0,
            turnOrder: config.players.map((p) => p.id),
            turnIndex: 0,
            battle: null,
            winners: [],
        };
    }

    // ---------------------------------------------------------------- queries

    getState(): GameState {
        return clone(this.state);
    }

    getPublicState(): PublicGameState {
        const s = clone(this.state) as PublicGameState;
        const b = s.battle;
        if (b && !b.result) {
            const mcqDone = !!this.state.battle.numeric;
            if (!mcqDone) delete b.mcq.correctIndex;
            if (b.numeric) delete b.numeric.correctValue;
        }
        return s;
    }

    get phase(): GamePhase {
        return this.state.phase;
    }

    get activePlayer(): Player | null {
        const id = this.state.turnOrder[this.state.turnIndex];
        return this.state.players.find((p) => p.id === id) ?? null;
    }

    /** Regions where a capital may be placed right now. */
    capitalCandidates(): RegionId[] {
        return capitalCandidates(this.state);
    }

    attackableTargets(playerId: PlayerId): RegionId[] {
        return attackableTargets(this.state, playerId);
    }

    // ---------------------------------------------------------------- setup

    start(): void {
        this.expectPhase(GamePhase.Lobby);
        this.state.round = 1;
        this.state.turnOrder = shuffle(
            this.rng,
            this.state.players.map((p) => p.id)
        );
        this.state.turnIndex = 0;

        if (this.state.config.placement === "random") {
            while (this.state.turnIndex < this.state.turnOrder.length) {
                this.placeCapital(
                    this.state.turnOrder[this.state.turnIndex],
                    botChooseCapital(this.rng, this.state)
                );
                this.state.turnIndex++;
            }
            this.beginRound();
        } else {
            this.state.phase = GamePhase.CapitalSelection;
            this.autoDraftBots();
        }
    }

    selectCapital(playerId: PlayerId, regionId: RegionId): void {
        this.expectPhase(GamePhase.CapitalSelection);
        this.expectActive(playerId);
        const t = this.state.territories[regionId];
        if (!t) throw new GameRuleError(`Unknown region ${regionId}`);
        if (t.ownerId !== null) throw new GameRuleError("Region already taken");
        if (!capitalCandidates(this.state).includes(regionId))
            throw new GameRuleError(
                "Capitals must have at least one region between them"
            );

        this.placeCapital(playerId, regionId);
        this.state.turnIndex++;
        this.autoDraftBots();
    }

    private placeCapital(playerId: PlayerId, regionId: RegionId) {
        Object.assign(this.state.territories[regionId], {
            ownerId: playerId,
            hp: CAPITAL_HP,
            isCapital: true,
        });
    }

    private autoDraftBots() {
        const order = this.state.turnOrder;
        while (this.state.turnIndex < order.length) {
            const player = this.player(order[this.state.turnIndex]);
            if (player.kind !== "bot") return;
            this.placeCapital(
                player.id,
                botChooseCapital(this.rng, this.state)
            );
            this.state.turnIndex++;
        }
        this.beginRound();
    }

    // ---------------------------------------------------------------- turns

    private beginRound() {
        this.state.turnIndex = -1;
        this.advanceTurn();
    }

    /** Moves to the next active player who can attack, or to ROUND_END. */
    private advanceTurn() {
        this.state.battle = null;
        const order = this.state.turnOrder;
        while (++this.state.turnIndex < order.length) {
            const p = this.player(order[this.state.turnIndex]);
            if (!p.eliminated && attackableTargets(this.state, p.id).length) {
                this.state.phase = GamePhase.TurnSelectTarget;
                return;
            }
        }
        this.state.phase = GamePhase.RoundEnd;
    }

    selectTarget(playerId: PlayerId, targetId: RegionId): void {
        this.expectPhase(GamePhase.TurnSelectTarget);
        this.expectActive(playerId);
        if (!isAttackable(this.state, playerId, targetId)) {
            throw new GameRuleError(`${targetId} is not attackable`);
        }
        this.startBattle(playerId, targetId, 1);
    }

    private startBattle(
        attackerId: PlayerId,
        targetId: RegionId,
        chain: number
    ) {
        this.state.battle = {
            attackerId,
            defenderId: this.state.territories[targetId].ownerId,
            targetId,
            chainIndex: chain,
            mcq: this.questions.nextMcq(),
            mcqAnswers: {},
            numeric: null,
            numericAnswers: {},
            result: null,
        };
        this.state.phase = GamePhase.BattleMcq;
        this.fillBotAnswers();
        this.tryResolve();
    }

    // ---------------------------------------------------------------- battle

    submitMcq(playerId: PlayerId, answer: McqAnswer): void {
        this.expectPhase(GamePhase.BattleMcq);
        const side = this.sideOf(playerId);
        if (this.state.battle.mcqAnswers[side]) {
            throw new GameRuleError("Already answered");
        }
        this.state.battle.mcqAnswers[side] = { ...answer };
        this.tryResolve();
    }

    submitNumeric(playerId: PlayerId, answer: NumericAnswer): void {
        this.expectPhase(GamePhase.BattleNumeric);
        const side = this.sideOf(playerId);
        if (this.state.battle.numericAnswers[side]) {
            throw new GameRuleError("Already answered");
        }
        this.state.battle.numericAnswers[side] = { ...answer };
        this.tryResolve();
    }

    /** Called when the question timer runs out: missing answers count as no answer. */
    expireTimer(): void {
        const b = this.state.battle;
        const timedOut = {
            optionIndex: null as number | null,
            value: null as number | null,
            responseTimeMs: this.state.config.timeLimitMs + 1,
        };
        if (this.state.phase === GamePhase.BattleMcq) {
            for (const side of ["attacker", "defender"] as Side[]) {
                b.mcqAnswers[side] ??= timedOut;
            }
        } else if (this.state.phase === GamePhase.BattleNumeric) {
            for (const side of ["attacker", "defender"] as Side[]) {
                b.numericAnswers[side] ??= timedOut;
            }
        } else {
            throw new GameRuleError("No active question");
        }
        this.tryResolve();
    }

    private fillBotAnswers() {
        const b = this.state.battle;
        for (const side of ["attacker", "defender"] as Side[]) {
            const difficulty = this.botDifficulty(side);
            if (difficulty === null) continue;
            if (this.state.phase === GamePhase.BattleMcq) {
                b.mcqAnswers[side] ??= botAnswerMcq(
                    this.rng,
                    difficulty,
                    b.mcq
                );
            } else if (this.state.phase === GamePhase.BattleNumeric) {
                b.numericAnswers[side] ??= botAnswerNumeric(
                    this.rng,
                    difficulty,
                    b.numeric
                );
            }
        }
    }

    private tryResolve() {
        const b = this.state.battle;
        const limit = this.state.config.timeLimitMs;

        if (this.state.phase === GamePhase.BattleMcq) {
            if (!b.mcqAnswers.attacker || !b.mcqAnswers.defender) return;
            const outcome = resolveMcq(
                b.mcqAnswers.attacker,
                b.mcqAnswers.defender,
                b.mcq.correctIndex,
                limit
            );
            if (outcome === "tiebreak") {
                b.numeric = this.questions.nextNumeric();
                this.state.phase = GamePhase.BattleNumeric;
                this.fillBotAnswers();
                this.tryResolve();
            } else {
                this.finishBattle(outcome, "mcq");
            }
        } else if (this.state.phase === GamePhase.BattleNumeric) {
            if (!b.numericAnswers.attacker || !b.numericAnswers.defender)
                return;
            const winner = resolveNumeric(
                b.numericAnswers.attacker,
                b.numericAnswers.defender,
                b.numeric.correctValue,
                limit
            );
            this.finishBattle(winner, "numeric");
        }
    }

    private finishBattle(winner: Side, decidedBy: "mcq" | "numeric") {
        const b = this.state.battle;
        const target = this.state.territories[b.targetId];
        let result: BattleResult = {
            winner,
            decidedBy,
            targetHpAfter: target.hp,
            wallBroken: false,
            captured: false,
            eliminatedPlayerId: null,
            chainContinues: false,
        };

        if (winner === "attacker") {
            const wasCapital = target.isCapital;
            const outcome = applyAttackerWin(
                this.state.territories,
                b.attackerId,
                b.targetId,
                this.state.config.onCapitalCaptured
            );
            this.state.territories = outcome.territories;
            if (outcome.eliminatedPlayerId) {
                this.player(outcome.eliminatedPlayerId).eliminated = true;
            }
            result = {
                ...result,
                targetHpAfter: outcome.targetHpAfter,
                wallBroken: outcome.wallBroken,
                captured: outcome.captured,
                eliminatedPlayerId: outcome.eliminatedPlayerId,
                chainContinues: wasCapital && !outcome.captured,
            };
        }

        b.result = result;
        this.state.phase = GamePhase.BattleResolution;
    }

    /** Leaves BATTLE_RESOLUTION or ROUND_END once the UI has shown the outcome. */
    continue(): void {
        if (this.state.phase === GamePhase.BattleResolution) {
            const b = this.state.battle;
            if (this.activePlayers().length <= 1) return this.endGame();
            if (b.result.chainContinues) {
                return this.startBattle(
                    b.attackerId,
                    b.targetId,
                    b.chainIndex + 1
                );
            }
            return this.advanceTurn();
        }
        if (this.state.phase === GamePhase.RoundEnd) {
            if (this.state.round >= this.state.config.rounds) {
                return this.endGame();
            }
            this.state.round++;
            if (this.state.config.rotateTurnOrder) {
                const [first, ...rest] = this.state.turnOrder;
                this.state.turnOrder = [...rest, first];
            }
            return this.beginRound();
        }
        throw new GameRuleError(`Cannot continue from ${this.state.phase}`);
    }

    private endGame() {
        const active = this.activePlayers();
        const score = (p: Player) => {
            const owned = territoriesOf(this.state.territories, p.id);
            return [owned.length, owned.reduce((sum, t) => sum + t.hp, 0)];
        };
        let best: number[] = [-1, -1];
        let winners: PlayerId[] = [];
        for (const p of active) {
            const s = score(p);
            const cmp = s[0] - best[0] || s[1] - best[1];
            if (cmp > 0) {
                best = s;
                winners = [p.id];
            } else if (cmp === 0) {
                winners.push(p.id);
            }
        }
        this.state.winners = winners;
        this.state.battle = null;
        this.state.phase = GamePhase.GameOver;
    }

    // ---------------------------------------------------------------- helpers

    private activePlayers(): Player[] {
        return this.state.players.filter((p) => !p.eliminated);
    }

    private player(id: PlayerId): Player {
        return this.state.players.find((p) => p.id === id);
    }

    private sideOf(playerId: PlayerId): Side {
        const b = this.state.battle;
        if (b.attackerId === playerId) return "attacker";
        if (b.defenderId === playerId) return "defender";
        throw new GameRuleError(`${playerId} is not part of this battle`);
    }

    private botDifficulty(side: Side): Difficulty | null {
        const b = this.state.battle;
        const id = side === "attacker" ? b.attackerId : b.defenderId;
        if (id === null) return this.state.config.neutralDifficulty;
        const p = this.player(id);
        return p.kind === "bot" ? p.difficulty ?? Difficulty.Medium : null;
    }

    private expectPhase(phase: GamePhase) {
        if (this.state.phase !== phase) {
            throw new GameRuleError(
                `Expected phase ${phase}, but game is in ${this.state.phase}`
            );
        }
    }

    private expectActive(playerId: PlayerId) {
        if (this.state.turnOrder[this.state.turnIndex] !== playerId) {
            throw new GameRuleError(`It is not ${playerId}'s turn`);
        }
    }
}
