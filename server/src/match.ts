import {
    BattleAids,
    BULGARIA,
    botChooseCapital,
    botChooseFortify,
    botChooseTarget,
    DeckQuestionProvider,
    Difficulty,
    GameConfig,
    GameEngine,
    GamePhase,
    GameRuleError,
    GameState,
    isAnswerCorrect,
    MATCH_TIMING,
    MatchEvent,
    MatchSnapshot,
    PlayerId,
    PointsReason,
    PointsTally,
    PowerUpEffect,
    PowerUpGrant,
    PowerUpKind,
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
          /** Per human still answering: when their time runs out (Extra Time moves it). */
          deadlines: Map<PlayerId, number>;
          /** Re-arms the wait for the latest deadline. */
          reschedule: () => void;
          resolve: () => void;
      };

/** Power-up news to everyone, before its state is attached. */
type Announcement =
    | Omit<Extract<MatchEvent, { kind: "powerUpUsed" }>, "state">
    | Omit<Extract<MatchEvent, { kind: "powerUpGranted" }>, "state">;

/** Grants earned by answering (announced after the answers are shown). */
const ANSWER_GRANTS = new Set<PowerUpGrant["reason"]>(["correct", "wrong"]);

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
    /**
     * The last state players were sent. Power-up news from the middle of a
     * battle is built on it, not on the engine's state, which already holds
     * the outcome of a battle with no human in it.
     */
    private shown: MatchSnapshot | null = null;
    /** Earned power-ups not announced yet (regions taken / lost wait for the battle result). */
    private heldGrants: PowerUpGrant[] = [];
    /** Scout results this turn, re-sent to a player who reconnects at their target prompt. */
    private readonly scouts = new Map<PlayerId, PowerUpEffect>();

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

    /**
     * Uses a power-up (agents.md §2.5). Fortify and Scout only while the
     * player is choosing a target; the battle aids only while the server
     * waits for their answer. What it revealed goes to the player alone.
     */
    usePowerUp(playerId: PlayerId, kind: PowerUpKind, regionId?: RegionId): void {
        const p = this.pending;
        const onTurn = kind === "fortify" || kind === "scout";
        // Battle aids only while the player's own time runs (the wait may be longer for the
        // opponent's Extra Time).
        const allowed = onTurn
            ? p?.kind === "region" && p.prompt === "target" && p.playerId === playerId
            : p?.kind === "answers" &&
              p.waiting.has(playerId) &&
              Date.now() <= p.deadlines.get(playerId) + this.timing.answerGraceMs;
        if (!allowed) throw new RoomError("not_your_turn", onTurn ? "Not your turn" : "No question for you right now");
        let effect: PowerUpEffect;
        try {
            effect = this.engine.usePowerUp(playerId, kind, regionId);
        } catch (e) {
            if (e instanceof GameRuleError) throw new RoomError("invalid", e.message);
            throw e;
        }
        if (effect.kind === "extraTime" && p.kind === "answers") {
            p.deadlines.set(playerId, p.deadlines.get(playerId) + effect.bonusMs);
            p.reschedule();
        }
        if (effect.kind === "scout") this.scouts.set(playerId, effect);
        this.hooks.send(playerId, { kind: "powerUpEffect", effect });
        this.broadcast({ kind: "powerUpUsed", playerId, powerUp: kind, state: this.snapshot() });
    }

    /** A player quit or didn't reconnect: a Medium bot plays their seat. */
    replaceWithBot(playerId: PlayerId): void {
        const player = this.engine.getState().players.find((p) => p.id === playerId);
        if (!player || player.kind !== "human") return;
        this.engine.replaceWithBot(playerId, Difficulty.Medium);
        const p = this.pending;
        if (p?.kind === "region" && p.playerId === playerId) p.resolve(null);
        if (p?.kind === "answers" && p.waiting.delete(playerId) && p.waiting.size === 0) p.resolve();
        // Mid-battle the engine may already hold the outcome: only the seat changes.
        const state = this.current && this.shown ? { ...this.shown, players: this.snapshot().players } : this.snapshot();
        this.broadcast({ kind: "botTakeover", playerId, state });
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
            // Mid-battle: what the others see (the engine may be ahead of the reveal).
            state: (this.current && this.shown) || this.snapshot(),
            resumed: true,
        });
        const c = this.current;
        if (c) {
            this.hooks.send(playerId, c.battle);
            const q = c.question;
            if (q) {
                const mcq = q.event.question.kind === "mcq";
                const aids = this.aidsOf(playerId);
                // The question carries the base time left; the client adds a re-sent Extra Time
                // effect once, so the question is re-sent while either still runs.
                const bonus = (mcq ? aids?.mcqBonusMs : aids?.numericBonusMs) ?? 0;
                const left = q.event.timeMs - (Date.now() - q.sentAt);
                if (left + bonus > 0) {
                    this.hooks.send(playerId, { ...q.event, timeMs: Math.max(0, left), opponentMs: null });
                    for (const effect of aidEffects(aids, mcq))
                        this.hooks.send(playerId, { kind: "powerUpEffect", effect });
                }
            }
        }
        const p = this.pending;
        if (p?.kind === "region" && p.playerId === playerId) {
            this.hooks.send(playerId, {
                kind: "prompt",
                prompt: p.prompt,
                options: p.options,
                timeMs: Math.max(0, p.deadline - Date.now()),
            });
            const scout = p.prompt === "target" ? this.scouts.get(playerId) : undefined;
            if (scout) this.hooks.send(playerId, { kind: "powerUpEffect", effect: scout });
        }
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
        this.shown = this.snapshot();
        for (const id of this.humans())
            this.hooks.send(id, { kind: "started", matchId: this.id, you: id, state: this.shown, resumed: false });

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
        this.scouts.clear();
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
        if (bot.kind === "bot") this.botFortify(bot.id, bot.difficulty ?? Difficulty.Medium);
        target ??= botChooseTarget(
            this.rng,
            this.engine.getState(),
            player.id,
            bot.kind === "bot" ? bot.difficulty ?? Difficulty.Medium : Difficulty.Medium
        );
        this.broadcast({ kind: "target", playerId: player.id, targetId: target, auto });
        if (player.kind === "bot" || auto) await this.sleep(this.timing.botAttackMs);
        this.engine.selectTarget(player.id, target);
        this.scouts.clear();
    }

    /** Bots wall their capital when it's threatened (agents.md §2.5). */
    private botFortify(botId: PlayerId, difficulty: Difficulty) {
        const region = botChooseFortify(this.rng, this.engine.getState(), botId, difficulty);
        if (!region) return;
        this.engine.usePowerUp(botId, "fortify", region);
        this.broadcast({ kind: "powerUpUsed", playerId: botId, powerUp: "fortify", state: this.snapshot() });
    }

    /**
     * Bots use 50/50 and Range Finder inside the engine as a question starts.
     * Called before the question is shown, so any aid on a side is a bot's.
     */
    private announceBotAids(kind: "fiftyFifty" | "rangeFinder") {
        const b = this.engine.getState().battle;
        for (const side of ["attacker", "defender"] as Side[]) {
            const id = this.idOf(side);
            if (id && b.aids[side]?.[kind]) this.announce({ kind: "powerUpUsed", playerId: id, powerUp: kind });
        }
    }

    /** Power-ups earned so far, to announce now; with `reasons`, only those (the rest wait). */
    private takeGrants(reasons?: Set<PowerUpGrant["reason"]>): PowerUpGrant[] {
        const all = [...this.heldGrants, ...this.engine.drainGrants()];
        this.heldGrants = reasons ? all.filter((g) => !reasons.has(g.reason)) : [];
        return reasons ? all.filter((g) => reasons.has(g.reason)) : all;
    }

    private announceGrants(grants: PowerUpGrant[]) {
        for (const g of grants)
            this.announce({ kind: "powerUpGranted", playerId: g.playerId, powerUp: g.kind, reason: g.reason });
    }

    /**
     * Broadcasts power-up news on the last shown state plus this one charge
     * change, so each news event changes exactly one charge by one and
     * nothing about a battle's outcome leaks early.
     */
    private announce(event: Announcement) {
        const base = this.shown ?? this.snapshot();
        const delta = event.kind === "powerUpUsed" ? -1 : 1;
        this.broadcast({ ...event, state: withCharges(base, [{ playerId: event.playerId, kind: event.powerUp }], delta) });
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
            this.announceBotAids("fiftyFifty");
            await this.sleep(this.timing.battleIntroMs + (b.chainIndex > 1 ? this.timing.chainAnnounceMs : 0));

            await this.question(GamePhase.BattleMcq);
            const afterMcq = this.engine.getState().battle;
            this.broadcast({ kind: "mcqResult", correctIndex: afterMcq.mcq.correctIndex, answers: afterMcq.mcqAnswers });
            for (const side of ["attacker", "defender"] as Side[]) {
                const id = this.idOf(side);
                // Same rule as the engine: a late answer isn't correct (Extra Time moves the limit).
                const limit = s.config.timeLimitMs + (afterMcq.aids[side]?.mcqBonusMs ?? 0);
                if (id && isAnswerCorrect(afterMcq.mcqAnswers[side], afterMcq.mcq.correctIndex, limit))
                    this.count(id, "correct_answer");
            }
            this.announceGrants(this.takeGrants(ANSWER_GRANTS));
            await this.sleep(this.timing.mcqRevealMs);

            if (afterMcq.numeric) {
                this.broadcast({ kind: "tieBreaker" });
                this.announceBotAids("rangeFinder");
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
            // Regions taken / lost earn power-ups: the result shows the board, then each grant.
            const grants = this.takeGrants();
            this.broadcast({ kind: "battleResult", result: r, state: withCharges(this.snapshot(), grants, -1) });
            this.announceGrants(grants);
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
            const startedAt = Date.now();
            const deadlines = new Map([...waiting].map((id) => [id, startedAt + timeMs]));
            let timer: NodeJS.Timeout | undefined;
            const finish = () => {
                clearTimeout(timer);
                this.pending = null;
                resolve();
            };
            // The wait ends at the latest deadline (Extra Time), plus grace for answers in flight.
            const reschedule = () => {
                clearTimeout(timer);
                const end = Math.max(...deadlines.values()) + this.timing.answerGraceMs;
                timer = setTimeout(finish, end - Date.now());
            };
            this.pending = { kind: "answers", phase, waiting, startedAt, deadlines, reschedule, resolve: finish };
            reschedule();
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
        if ("state" in event) this.shown = event.state;
        for (const id of this.humans()) this.hooks.send(id, event);
    }

    /** What the player's side used in the current battle, if they're in it. */
    private aidsOf(playerId: PlayerId): BattleAids | undefined {
        const side = this.sideOfOrNull(playerId);
        return side ? this.engine.getState().battle.aids[side] : undefined;
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

/** A copy of `state` with one charge per change added (`delta` 1) or removed (-1). */
function withCharges(
    state: MatchSnapshot,
    changes: { playerId: PlayerId; kind: PowerUpKind }[],
    delta: 1 | -1
): MatchSnapshot {
    const powerUps = { ...state.powerUps };
    for (const { playerId, kind } of changes) {
        const charges = powerUps[playerId];
        if (charges) powerUps[playerId] = { ...charges, [kind]: Math.max(0, charges[kind] + delta) };
    }
    return { ...state, powerUps };
}

/** The private effects behind a side's aids on the open question, re-sent after a reconnect. */
function aidEffects(aids: BattleAids | undefined, mcq: boolean): PowerUpEffect[] {
    const out: PowerUpEffect[] = [];
    if (mcq && aids?.fiftyFifty) out.push({ kind: "fiftyFifty", removed: aids.fiftyFifty });
    if (!mcq && aids?.rangeFinder) out.push({ kind: "rangeFinder", ...aids.rangeFinder });
    const bonusMs = mcq ? aids?.mcqBonusMs : aids?.numericBonusMs;
    if (bonusMs) out.push({ kind: "extraTime", bonusMs });
    return out;
}

export function isAborted(e: unknown): boolean {
    return e instanceof Aborted;
}
