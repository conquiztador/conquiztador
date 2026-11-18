import {
    BULGARIA,
    botChooseCapital,
    botChooseTarget,
    DeckQuestionProvider,
    Difficulty,
    GameConfig,
    GameEngine,
    GamePhase,
    GameState,
    MATCH_TIMING,
    MatchEvent,
    MatchSnapshot,
    PlayerId,
    PointsReason,
    PointsTally,
    PublicQuestion,
    QuestionDeck,
    RegionId,
    Rng,
    Side,
} from "@conquiztador/core";
import { randomUUID } from "node:crypto";

import { RoomError } from "./rooms.js";

export type MatchTiming = { -readonly [K in keyof typeof MATCH_TIMING]: number };

export interface MatchHooks {
    /** Delivers an event to one human player (dropped if they're offline). */
    send(playerId: PlayerId, event: MatchEvent): void;
}

export interface MatchResult {
    state: GameState;
    /** Per human player (incl. ones who quit), what they earned. */
    points: Record<PlayerId, PointsTally>;
}

/** Thrown inside the match loop once the match is aborted. */
class Aborted extends Error {}

type Pending =
    | {
          kind: "region";
          playerId: PlayerId;
          options: RegionId[];
          deadline: number;
          prompt: "capital" | "target";
          resolve: (regionId: RegionId | null) => void;
      }
    | {
          kind: "answers";
          phase: GamePhase.BattleMcq | GamePhase.BattleNumeric;
          waiting: Set<PlayerId>;
          startedAt: number;
          resolve: () => void;
      };

/**
 * Runs one match on the server: owns the engine, paces every step with
 * MATCH_TIMING, waits for human input with deadlines, plays bots, and
 * streams events to the players. Correct answers only leave the server
 * once a question is over.
 */
export class Match {
    readonly id = randomUUID();
    private readonly engine: GameEngine;
    private readonly timing: MatchTiming;
    private pending: Pending | null = null;
    private aborted = false;
    private readonly sleepers = new Set<() => void>();
    /** Capitals already shown to players. */
    private readonly revealed = new Set<PlayerId>();
    /** Capitals humans clicked (shown without the "selecting…" pause). */
    private readonly clicked = new Set<PlayerId>();
    private readonly tallies: Record<PlayerId, PointsTally> = {};
    /** The battle and open question, for players who reconnect mid-battle. */
    private current: {
        battle: Extract<MatchEvent, { kind: "battle" }>;
        question: { event: Extract<MatchEvent, { kind: "question" }>; sentAt: number } | null;
    } | null = null;

    constructor(
        config: GameConfig,
        deck: QuestionDeck,
        private readonly hooks: MatchHooks,
        options: { timing?: Partial<MatchTiming>; rng?: Rng } = {}
    ) {
        const rng = options.rng ?? Math.random;
        this.timing = { ...MATCH_TIMING, ...options.timing };
        this.engine = new GameEngine(config, BULGARIA, new DeckQuestionProvider(deck, rng), rng);
        this.rng = rng;
        for (const p of config.players) if (p.kind === "human") this.tallies[p.id] = {};
    }

    private readonly rng: Rng;

    // ------------------------------------------------------------ queries

    get state(): GameState {
        return this.engine.getState();
    }

    humans(): PlayerId[] {
        return this.engine
            .getState()
            .players.filter((p) => p.kind === "human")
            .map((p) => p.id);
    }

    snapshot(): MatchSnapshot {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { map, battle, ...rest } = this.engine.getPublicState();
        return rest;
    }

    // ------------------------------------------------------------ player input

    selectRegion(playerId: PlayerId, regionId: RegionId): void {
        const p = this.pending;
        if (p?.kind !== "region" || p.playerId !== playerId) throw new RoomError("not_your_turn", "Not your turn");
        if (!p.options.includes(regionId)) throw new RoomError("invalid", "You can't choose that region");
        p.resolve(regionId);
    }

    answer(playerId: PlayerId, value: number): void {
        const p = this.pending;
        if (p?.kind !== "answers" || !p.waiting.has(playerId))
            throw new RoomError("not_your_turn", "No question for you right now");
        const responseTimeMs = Math.max(0, Date.now() - p.startedAt);
        if (p.phase === GamePhase.BattleMcq) {
            const options = this.engine.getState().battle.mcq.options.length;
            if (!Number.isInteger(value) || value < 0 || value >= options)
                throw new RoomError("invalid", "No such option");
            this.engine.submitMcq(playerId, { optionIndex: value, responseTimeMs });
        } else {
            this.engine.submitNumeric(playerId, { value, responseTimeMs });
        }
        p.waiting.delete(playerId);
        this.broadcast({ kind: "answered", side: this.sideOf(playerId) });
        if (p.waiting.size === 0) p.resolve();
    }

    /** A player quit or didn't reconnect: a Medium bot plays their seat. */
    replaceWithBot(playerId: PlayerId): void {
        const player = this.engine.getState().players.find((p) => p.id === playerId);
        if (!player || player.kind !== "human") return;
        this.engine.replaceWithBot(playerId, Difficulty.Medium);
        const p = this.pending;
        if (p?.kind === "region" && p.playerId === playerId) p.resolve(null);
        if (p?.kind === "answers" && p.waiting.delete(playerId) && p.waiting.size === 0) p.resolve();
        this.broadcast({ kind: "botTakeover", playerId, state: this.snapshot() });
    }

    /** What each human has earned so far (for a match that ends early). */
    pointsSoFar(): Record<PlayerId, PointsTally> {
        return this.tallies;
    }

    /** Re-sends what a reconnecting player needs to pick the match up again. */
    resume(playerId: PlayerId): void {
        this.hooks.send(playerId, {
            kind: "started",
            matchId: this.id,
            you: playerId,
            state: this.snapshot(),
            resumed: true,
        });
        const c = this.current;
        if (c) {
            this.hooks.send(playerId, c.battle);
            const q = c.question;
            const left = q ? q.event.timeMs - (Date.now() - q.sentAt) : 0;
            if (q && left > 0) this.hooks.send(playerId, { ...q.event, timeMs: left, opponentMs: null });
        }
        const p = this.pending;
        if (p?.kind === "region" && p.playerId === playerId)
            this.hooks.send(playerId, {
                kind: "prompt",
                prompt: p.prompt,
                options: p.options,
                timeMs: Math.max(0, p.deadline - Date.now()),
            });
    }

    abort(): void {
        this.aborted = true;
        this.sleepers.forEach((wake) => wake());
        const p = this.pending;
        if (p?.kind === "region") p.resolve(null);
        else if (p) p.resolve();
    }

    // ------------------------------------------------------------ the match

    /** Plays the match to the end. Rejects with Aborted if aborted. */
    async run(): Promise<MatchResult> {
        const engine = this.engine;
        engine.start();
        for (const id of this.humans())
            this.hooks.send(id, { kind: "started", matchId: this.id, you: id, state: this.snapshot(), resumed: false });

        while (engine.phase !== GamePhase.GameOver) {
            await this.revealCapitals();
            switch (engine.phase) {
                case GamePhase.CapitalSelection:
                    await this.chooseCapital();
                    break;
                case GamePhase.TurnSelectTarget:
                    await this.chooseTarget();
                    await this.battle();
                    break;
                case GamePhase.BattleMcq:
                case GamePhase.BattleNumeric:
                case GamePhase.BattleResolution:
                    await this.battle();
                    break;
                case GamePhase.RoundEnd: {
                    const s = engine.getState();
                    this.broadcast({ kind: "roundEnd", round: s.round, final: s.round >= s.config.rounds });
                    await this.sleep(this.timing.roundEndMs);
                    engine.continue();
                    break;
                }
                default:
                    throw new Error(`Unexpected phase ${engine.phase}`);
            }
        }

        const state = engine.getState();
        for (const id of state.winners) if (this.tallies[id] && this.isHuman(id)) this.count(id, "victory");
        this.broadcast({ kind: "gameOver", state: this.snapshot(), points: this.tallies });
        return { state, points: this.tallies };
    }

    /** Shows capitals placed since the last reveal, one by one in turn order. */
    private async revealCapitals() {
        const s = this.engine.getState();
        const fresh = s.turnOrder.filter(
            (id) =>
                !this.revealed.has(id) &&
                Object.values(s.territories).some((t) => t.isCapital && t.ownerId === id)
        );
        this.broadcast({ kind: "state", state: this.snapshot() });
        let ms = 0;
        for (const id of fresh) {
            this.revealed.add(id);
            const instant = this.clicked.has(id) && s.config.placement === "draft";
            ms += instant ? this.timing.ownCapitalRevealMs : this.timing.capitalRevealMs;
        }
        if (ms) await this.sleep(ms);
    }

    private async chooseCapital() {
        const player = this.engine.activePlayer;
        const region = await this.ask(player.id, "capital", this.engine.capitalCandidates());
        if (region) this.clicked.add(player.id);
        this.engine.selectCapital(player.id, region ?? botChooseCapital(this.rng, this.engine.getState()));
    }

    private async chooseTarget() {
        const player = this.engine.activePlayer;
        this.broadcast({ kind: "turn", playerId: player.id });
        let target: RegionId | null = null;
        let auto = false;
        if (player.kind === "human") {
            target = await this.ask(player.id, "target", this.engine.attackableTargets(player.id));
            auto = target === null;
        } else {
            await this.sleep(this.timing.botThinkMs);
        }
        const bot = this.engine.getState().players.find((p) => p.id === player.id);
        target ??= botChooseTarget(
            this.rng,
            this.engine.getState(),
            player.id,
            bot.kind === "bot" ? bot.difficulty ?? Difficulty.Medium : Difficulty.Medium
        );
        this.broadcast({ kind: "target", playerId: player.id, targetId: target, auto });
        if (player.kind === "bot" || auto) await this.sleep(this.timing.botAttackMs);
        this.engine.selectTarget(player.id, target);
    }

    /** Plays the current battle and any capital chain that follows it. */
    private async battle() {
        for (;;) {
            const s = this.engine.getState();
            const b = s.battle;
            const target = s.territories[b.targetId];
            const battleEvent: Extract<MatchEvent, { kind: "battle" }> = {
                kind: "battle",
                attackerId: b.attackerId,
                defenderId: b.defenderId,
                targetId: b.targetId,
                chainIndex: b.chainIndex,
                isCapital: target.isCapital,
                hp: target.hp,
                walled: target.walled,
            };
            this.current = { battle: battleEvent, question: null };
            this.broadcast(battleEvent);
            await this.sleep(this.timing.battleIntroMs + (b.chainIndex > 1 ? this.timing.chainAnnounceMs : 0));

            await this.question(GamePhase.BattleMcq);
            const afterMcq = this.engine.getState().battle;
            this.broadcast({ kind: "mcqResult", correctIndex: afterMcq.mcq.correctIndex, answers: afterMcq.mcqAnswers });
            for (const side of ["attacker", "defender"] as Side[]) {
                const id = this.idOf(side);
                if (id && afterMcq.mcqAnswers[side]?.optionIndex === afterMcq.mcq.correctIndex)
                    this.count(id, "correct_answer");
            }
            await this.sleep(this.timing.mcqRevealMs);

            if (afterMcq.numeric) {
                this.broadcast({ kind: "tieBreaker" });
                await this.sleep(this.timing.tieBreakerMs);
                await this.question(GamePhase.BattleNumeric);
                const nb = this.engine.getState().battle;
                this.broadcast({
                    kind: "numericResult",
                    correctValue: nb.numeric.correctValue,
                    answers: nb.numericAnswers,
                    winner: nb.result.winner,
                });
                const winnerId = this.idOf(nb.result.winner);
                if (winnerId) this.count(winnerId, "tiebreaker_win");
                await this.sleep(this.timing.numericRevealMs);
            }

            const done = this.engine.getState().battle;
            const r = done.result;
            if (r.winner === "attacker") {
                const id = done.attackerId;
                if (target.isCapital) {
                    this.count(id, "capital_hit");
                    if (r.captured) this.count(id, "capital_captured");
                } else if (r.captured) {
                    this.count(id, "region_taken");
                }
            }
            this.current = null;
            this.broadcast({ kind: "battleResult", result: r, state: this.snapshot() });
            await this.sleep(this.timing.resultMs);

            this.engine.continue();
            if (this.engine.phase !== GamePhase.BattleMcq) return;
        }
    }

    /**
     * Shows the current question to everyone and waits for the humans in the
     * battle (or a short spectator pause if both sides are bots).
     */
    private async question(phase: GamePhase.BattleMcq | GamePhase.BattleNumeric) {
        const s = this.engine.getState();
        const b = s.battle;
        const mcq = phase === GamePhase.BattleMcq;
        const question: PublicQuestion = mcq
            ? { kind: "mcq", text: b.mcq.text, category: b.mcq.category, options: b.mcq.options }
            : { kind: "numeric", text: b.numeric.text, category: b.numeric.category };
        const answers = mcq ? b.mcqAnswers : b.numericAnswers;
        const waiting = new Set<PlayerId>();
        // Bots answered already; only humans still to answer are waited for.
        if (this.engine.phase === phase)
            for (const side of ["attacker", "defender"] as Side[]) {
                const id = this.idOf(side);
                if (id && this.isHuman(id) && !answers[side]) waiting.add(id);
            }
        const timeMs = waiting.size ? s.config.timeLimitMs : this.timing.spectateMs;
        if (this.current)
            this.current.question = {
                event: { kind: "question", question, timeMs, opponentMs: null },
                sentAt: Date.now(),
            };

        for (const id of this.humans()) {
            const side = this.sideOfOrNull(id);
            const opponent = side === "attacker" ? "defender" : side === "defender" ? "attacker" : null;
            const opponentId = opponent ? this.idOf(opponent) : null;
            const opponentIsBot = opponent !== null && (opponentId === null || !this.isHuman(opponentId));
            this.hooks.send(id, {
                kind: "question",
                question,
                timeMs,
                opponentMs: opponentIsBot ? answers[opponent]?.responseTimeMs ?? null : null,
            });
        }

        if (waiting.size === 0) {
            await this.sleep(timeMs);
            return;
        }
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => finish(), timeMs + this.timing.answerGraceMs);
            const finish = () => {
                clearTimeout(timer);
                this.pending = null;
                resolve();
            };
            this.pending = { kind: "answers", phase, waiting, startedAt: Date.now(), resolve: finish };
        });
        this.check();
        if (this.engine.phase === phase) this.engine.expireTimer();
    }

    /** Prompts a human to choose; null when their time ran out (or they left). */
    private async ask(playerId: PlayerId, prompt: "capital" | "target", options: RegionId[]) {
        if (!this.isHuman(playerId)) return null;
        const timeMs = this.timing.choiceMs;
        this.hooks.send(playerId, { kind: "prompt", prompt, options, timeMs });
        const region = await new Promise<RegionId | null>((resolve) => {
            const timer = setTimeout(() => finish(null), timeMs + this.timing.answerGraceMs);
            const finish = (r: RegionId | null) => {
                clearTimeout(timer);
                this.pending = null;
                resolve(r);
            };
            this.pending = { kind: "region", playerId, options, prompt, deadline: Date.now() + timeMs, resolve: finish };
        });
        this.check();
        return region;
    }

    // ------------------------------------------------------------ helpers

    private sleep(ms: number): Promise<void> {
        this.check();
        return new Promise<void>((resolve) => {
            const wake = () => {
                clearTimeout(timer);
                this.sleepers.delete(wake);
                resolve();
            };
            const timer = setTimeout(wake, ms);
            this.sleepers.add(wake);
        }).then(() => this.check());
    }

    private check() {
        if (this.aborted) throw new Aborted("Match aborted");
    }

    private broadcast(event: MatchEvent) {
        for (const id of this.humans()) this.hooks.send(id, event);
    }

    private isHuman(id: PlayerId) {
        return this.engine.getState().players.some((p) => p.id === id && p.kind === "human");
    }

    /** Points only go to humans (a seat taken over by a bot stops earning). */
    private count(id: PlayerId, reason: PointsReason) {
        if (!this.tallies[id] || !this.isHuman(id)) return;
        this.tallies[id][reason] = (this.tallies[id][reason] ?? 0) + 1;
    }

    private idOf(side: Side): PlayerId | null {
        const b = this.engine.getState().battle;
        return side === "attacker" ? b.attackerId : b.defenderId;
    }

    private sideOfOrNull(id: PlayerId): Side | null {
        const b = this.engine.getState().battle;
        return b?.attackerId === id ? "attacker" : b?.defenderId === id ? "defender" : null;
    }

    private sideOf(id: PlayerId): Side {
        return this.sideOfOrNull(id);
    }
}

export function isAborted(e: unknown): boolean {
    return e instanceof Aborted;
}
