import Application from "../Application";
import { GameEvent } from "../Events";
import { Page } from "shared/Page";
import LayerManager from "app/managers/LayerManager";
import {
    enabledKinds,
    ErrorCode,
    GamePhase,
    MATCH_TIMING,
    MatchEvent,
    MatchSnapshot,
    PlayerId,
    PowerUpEffect,
    PowerUpKind,
    RegionId,
    Side,
    territoriesOf,
} from "@conquiztador/core";
import { BattleOverlay, Combatant } from "app/game/components/BattleOverlay";
import { HUD, matchHud } from "app/game/components/MatchHud";
import { MapEvent, MapView } from "app/game/components/MapView";
import {
    clearToast,
    powerUpStore,
    showToast,
} from "app/game/components/PowerUps";
import {
    localPlayerId,
    Messages,
    onLanguageChange,
    playerName,
    who,
} from "app/i18n";
import { COLORS, PLAYER_COLORS, wait } from "app/game/ui";
import { gameClient } from "app/multiplayer/GameClient";
import { sfx } from "app/audio/sfx";

const NEUTRAL: Combatant = {
    id: null,
    name: "",
    color: COLORS.neutral,
    isHuman: false,
};
/** Status text, re-read from the dictionary when the language changes. */
type Text = (m: Messages) => string;
/** Map labels never render smaller than this many CSS pixels. */
const MIN_LABEL_PX = 9;
const MAP_LABEL_FONT = 11;
/** Leave the server's pause a little slack so we never fall behind. */
const SLACK_MS = 100;
/**
 * An event handled this long after it arrived means we fell behind (e.g.
 * the tab was in the background and animations paused): skip animations
 * until we've caught up with the server.
 */
const LATE_MS = 1000;
/** Stop waiting for the server's reply to a power-up after this long. */
const PENDING_MS = 4000;

/**
 * The match screen: map, HUD and battle overlay. The match itself runs on
 * the game server; this page plays its events in order, animating each one
 * within the time the server gives it, and sends the player's choices back.
 */
export class ConquestPage extends Page {
    private map: MapView;
    private overlay: BattleOverlay;
    private colors: Record<PlayerId, number> = {};
    /** Bumped per match so a stale event queue stops. */
    private matchId = 0;
    private queue: Promise<void> = Promise.resolve();
    private state: MatchSnapshot | null = null;
    private regionWaiter: ((id: RegionId) => void) | null = null;
    /** Players whose capital has been shown; others are hidden until revealed. */
    private revealed = new Set<PlayerId>();
    /** The battle on screen: who fights, and which side is the local player. */
    private battleInfo: {
        attacker: Combatant;
        defender: Combatant;
        targetId: RegionId;
        wasCapital: boolean;
        humanSide: Side | null;
    } | null = null;
    /** The choice the server is waiting for from you, if any. */
    private promptInfo: {
        kind: "capital" | "target";
        options: RegionId[];
    } | null = null;
    /** Picking one of your regions to fortify (during the target prompt). */
    private fortifying = false;
    /** You used Scout this turn (once per turn). */
    private scoutedThisTurn = false;
    private pendingTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(app: Application, layerManager: LayerManager) {
        super(app, layerManager);
        this.visible = false;

        matchHud.set((s) => ({ ...s, onQuit: () => this.quit() }));
        this.overlay = new BattleOverlay();

        gameClient.onMatchEvent = (event) => this.enqueue(event);
        gameClient.onMatchLost = () => this.hide();
        gameClient.onMatchError = (code) => this.onServerError(code);
        powerUpStore.set((s) => ({
            ...s,
            onUse: (kind) => this.usePowerUp(kind),
        }));
        // Region labels on the map; HUD and battle card are React and
        // re-render on their own.
        onLanguageChange(() => this.state && this.refresh());
        this.layout();
    }

    private get you(): PlayerId {
        return localPlayerId();
    }

    /** Status line shown in the HUD. */
    private set status(text: Text) {
        matchHud.set((s) => ({ ...s, message: text }));
    }

    /**
     * Sizes the map to fill the window space the HUD leaves free (in real
     * pixels, ignoring the design-area letterbox).
     * - Wide windows: HUD is a column on the right; the map gets full height.
     * - Tall windows: HUD bar on top, map below it, player grid under the map.
     */
    protected layout() {
        if (!this.map) return;
        const W = window.innerWidth;
        const H = window.innerHeight;
        const m = HUD.margin;
        const mapW = this.map.mapWidth;
        const mapH = this.map.mapHeight;
        const aspect = mapW / mapH;

        let area: { x: number; y: number; w: number; h: number };
        if (W / H > 1.15) {
            // Give the map full height, and the HUD whatever width is left
            // (within limits).
            const side = Math.min(
                HUD.sideMax,
                Math.max(HUD.sideMin, W - (H - 2 * m) * aspect - 3 * m)
            );
            matchHud.set((s) => ({
                ...s,
                layout: { kind: "side", width: side },
            }));
            area = { x: m, y: m, w: W - side - 3 * m, h: H - 2 * m };
        } else {
            const players = this.state?.players.length ?? 3;
            const cols = Math.max(1, Math.floor((W - 2 * m) / 160));
            const gridH =
                Math.ceil(players / cols) * HUD.playerRow +
                2 * m +
                (this.powerUpsInPlay() ? HUD.powerUpBar : 0);
            const top = HUD.barHeight + m;
            const h = Math.min((W - 2 * m) / aspect, H - top - gridH);
            // Centre the map + player grid in the space under the bar
            // rather than leaving all the slack at the bottom.
            const slack = Math.max(0, H - top - h - gridH);
            area = { x: m, y: top + slack / 2, w: W - 2 * m, h };
            matchHud.set((s) => ({
                ...s,
                layout: {
                    kind: "top",
                    barHeight: HUD.barHeight,
                    playersTop: area.y + h + m,
                },
            }));
        }

        // On-screen scale of the map, centered within its area.
        const k = Math.min(area.w / mapW, area.h / mapH);
        const stageScale = this.app.stage.scale.x;
        const topLeft = this.app.screenToStage(
            area.x + (area.w - mapW * k) / 2,
            area.y + (area.h - mapH * k) / 2
        );
        this.map.scale.set(k / stageScale);
        this.map.position.copyFrom(topLeft);
        this.map.setLabelScale(
            Math.max(1, MIN_LABEL_PX / (MAP_LABEL_FONT * k))
        );
    }

    // ------------------------------------------------------------ events

    /** Plays server events one after another; `started` resets everything. */
    private enqueue(event: MatchEvent) {
        if (event.kind === "started") {
            this.reset(event.state);
            this.queue = Promise.resolve();
        }
        const id = this.matchId;
        const receivedAt = performance.now();
        this.queue = this.queue
            .then(() =>
                id === this.matchId
                    ? this.handle(event, performance.now() - receivedAt)
                    : undefined
            )
            .catch((e) => console.error("match event failed", event.kind, e));
    }

    /** `lag`: how long the event waited behind earlier ones, in ms. */
    private async handle(e: MatchEvent, lag: number): Promise<void> {
        const id = this.matchId;
        const alive = () => id === this.matchId;
        const late = lag > LATE_MS;
        switch (e.kind) {
            case "started":
                // Back after a reconnect: show capitals without replaying them.
                if (e.resumed) await this.revealCapitals(alive, true);
                this.refresh();
                return;
            case "state":
                this.state = e.state;
                await this.revealCapitals(alive, late);
                if (!alive()) return;
                this.refresh();
                this.describeWaiting();
                return;
            case "prompt":
                // Time is counted from when the server asked.
                if (e.timeMs - lag > 0)
                    this.prompt(e.prompt, e.options, e.timeMs - lag);
                return;
            case "turn": {
                this.scoutedThisTurn = false;
                powerUpStore.set((p) => ({ ...p, scouted: null }));
                const player = this.player(e.playerId);
                this.refresh(e.playerId);
                if (e.playerId !== this.you)
                    this.status = (m) =>
                        m.status.choosingTarget(playerName(player));
                return;
            }
            case "target": {
                this.endPrompt();
                const player = this.player(e.playerId);
                const target = e.targetId;
                this.map.setFocus(target);
                this.status = (m) =>
                    m.status.attacks(who(player), m.regions[target]);
                return;
            }
            case "battle":
                this.setPending(null);
                powerUpStore.set((p) => ({ ...p, scouted: null }));
                await this.openBattle(e, late);
                return;
            case "question":
                this.setPending(null);
                if (e.timeMs - lag > 0)
                    this.askQuestion({
                        ...e,
                        timeMs: e.timeMs - lag,
                        opponentMs:
                            e.opponentMs === null
                                ? null
                                : Math.max(0, e.opponentMs - lag),
                    });
                return;
            case "answered":
                if (
                    this.battleInfo?.humanSide &&
                    e.side !== this.battleInfo.humanSide
                )
                    this.overlay.opponentAnswered();
                return;
            case "mcqResult": {
                if (!this.battleInfo) return;
                const shown = this.overlay.revealMcq(e.correctIndex, e.answers);
                if (!late) await shown;
                return;
            }
            case "tieBreaker":
                if (this.battleInfo && !late)
                    await this.overlay.announce(
                        (m) => m.status.tieBreaker,
                        COLORS.highlight,
                        MATCH_TIMING.tieBreakerMs - 300 - SLACK_MS
                    );
                return;
            case "numericResult": {
                if (!this.battleInfo) return;
                const shown = this.overlay.revealNumeric(
                    e.correctValue,
                    e.answers,
                    e.winner
                );
                if (!late) await shown;
                return;
            }
            case "battleResult":
                this.state = e.state;
                if (late) this.closeBattle();
                else await this.showResult(e.result);
                return;
            case "roundEnd":
                this.status = (m) =>
                    e.final
                        ? m.status.finalRoundComplete
                        : m.status.roundComplete(e.round);
                return;
            case "powerUpUsed": {
                // Fortify adds a wall; aids only change charges (keep the
                // board as it is mid-battle).
                this.state =
                    e.powerUp === "fortify"
                        ? e.state
                        : { ...this.state, powerUps: e.state.powerUps };
                // Your own use stays pending until its `powerUpEffect`.
                this.refresh();
                if (this.fortifying) this.map.setSelectable(this.fortifiable());
                const player = this.player(e.playerId);
                const kind = e.powerUp;
                showToast((m) =>
                    m.powerUps.used(who(player), m.powerUps.names[kind])
                );
                return;
            }
            case "powerUpEffect":
                this.onEffect(e.effect);
                return;
            case "powerUpGranted": {
                this.state = {
                    ...this.state,
                    powerUps: e.state.powerUps,
                    powerUpProgress: e.state.powerUpProgress,
                };
                this.refresh();
                const player = this.player(e.playerId);
                const kind = e.powerUp;
                showToast((m) =>
                    m.powerUps.earned(who(player), m.powerUps.aName[kind])
                );
                return;
            }
            case "botTakeover": {
                this.state = e.state;
                const player = this.player(e.playerId);
                this.refresh();
                this.status = (m) => m.status.botTakesOver(player.name);
                return;
            }
            case "gameOver":
                this.state = e.state;
                this.endPrompt();
                this.overlay.close();
                this.refresh();
                this.status = (m) => m.status.gameOver;
                await wait(1200);
                if (!alive()) return;
                this.hide();
                this.app.stage.emit(
                    GameEvent.matchFinished,
                    e.state,
                    e.points,
                    this.you
                );
                return;
        }
    }

    /** A new match: fresh map, colours and HUD. */
    private reset(state: MatchSnapshot) {
        this.matchId++;
        this.state = state;
        this.revealed.clear();
        this.battleInfo = null;
        this.scoutedThisTurn = false;
        this.endPrompt();
        this.setPending(null);
        powerUpStore.set((p) => ({ ...p, scouted: null }));
        clearToast();
        this.colors = Object.fromEntries(
            state.config.players.map((p, i) => [p.id, PLAYER_COLORS[i]])
        );

        this.map?.destroy({ children: true });
        this.map = new MapView(this.app.ticker, 1.1);
        this.map.setPlayerColors(this.colors);
        this.map.on(MapEvent.regionSelected, (r: RegionId) => {
            if (this.fortifying) {
                sfx.select();
                this.fortify(r);
                return;
            }
            if (!this.regionWaiter) return;
            sfx.select();
            this.regionWaiter(r);
        });
        this.addChild(this.map);
        this.overlay.close();

        this.layout();
        this.status = () => "";
        matchHud.set((s) => ({ ...s, visible: true }));
        this.visible = true;
        this.app.stage.emit(GameEvent.startMatch);
    }

    private hide() {
        this.matchId++; // stops the event queue
        this.endPrompt();
        this.setPending(null);
        powerUpStore.set((p) => ({
            ...p,
            enabled: [],
            charges: null,
            scouted: null,
        }));
        clearToast();
        this.overlay.close();
        this.visible = false;
        matchHud.set((s) => ({ ...s, visible: false }));
    }

    private quit() {
        this.hide();
        gameClient.quitMatch();
    }

    // ------------------------------------------------------------ rendering

    /** Renders map and HUD, hiding capitals that haven't been revealed yet. */
    private refresh(activeId = this.activeId()) {
        const s = this.state;
        if (!s || !this.map) return;
        const territories = Object.fromEntries(
            Object.entries(s.territories).map(([id, t]) => [
                id,
                t.isCapital && t.ownerId && !this.revealed.has(t.ownerId)
                    ? { ...t, ownerId: null, isCapital: false }
                    : t,
            ])
        );
        this.map.render({ territories, players: s.players });

        matchHud.set((h) => ({
            ...h,
            round: s.round,
            rounds: s.config.rounds,
            players: s.players.map((p) => {
                const owned = territoriesOf(territories, p.id);
                return {
                    id: p.id,
                    name: p.name,
                    color: this.colors[p.id],
                    isBot: p.kind === "bot",
                    regions: owned.length,
                    capitalHp: owned.find((t) => t.isCapital)?.hp ?? 0,
                    eliminated: p.eliminated,
                    active: p.id === activeId && !p.eliminated,
                    charges: this.powerUpsInPlay()
                        ? s.powerUps?.[p.id] ?? null
                        : null,
                };
            }),
        }));
        this.syncPowerUps();
    }

    private activeId(): PlayerId | null {
        const s = this.state;
        if (!s) return null;
        if (s.phase === GamePhase.RoundEnd || s.phase === GamePhase.GameOver)
            return null;
        return s.turnOrder[s.turnIndex] ?? null;
    }

    /** While drafting, says whose capital we're waiting for. */
    private describeWaiting() {
        const s = this.state;
        const active = this.activeId();
        if (s.phase !== GamePhase.CapitalSelection || !active) return;
        if (active === this.you) return; // the prompt says it
        const player = this.player(active);
        this.status = (m) => m.status.selectingCapital(playerName(player));
    }

    /**
     * Plays capital placements that haven't been shown yet, one player at a
     * time in turn order. Bots (and random placement) get a short "selecting"
     * pause first; a capital someone clicked is animated right away.
     */
    private async revealCapitals(alive: () => boolean, instant = false) {
        const s = this.state;
        if (instant) {
            for (const t of Object.values(s.territories))
                if (t.isCapital && t.ownerId) this.revealed.add(t.ownerId);
            return;
        }
        for (const playerId of s.turnOrder) {
            if (this.revealed.has(playerId)) continue;
            const capital = Object.values(s.territories).find(
                (t) => t.isCapital && t.ownerId === playerId
            );
            if (!capital) continue;
            const player = this.player(playerId);
            const region = capital.regionId;

            if (player.kind === "bot" || s.config.placement === "random") {
                this.status = (m) =>
                    playerId === this.you
                        ? m.status.selectingYourCapital
                        : m.status.selectingCapital(playerName(player));
                this.refresh(playerId);
                await wait(1100);
                if (!alive()) return;
            }

            this.refresh(playerId);
            sfx.select();
            await this.map.claim(region, this.colors[playerId], () => {
                this.revealed.add(playerId);
                this.refresh(playerId);
            });
            if (!alive()) return;
            this.status = (m) =>
                playerId === this.you
                    ? m.status.yourCapital(m.regions[region])
                    : m.status.choseCapital(
                          playerName(player),
                          m.regions[region]
                      );
            await wait(600);
            if (!alive()) return;
        }
    }

    private player(id: PlayerId) {
        return this.state.players.find((p) => p.id === id);
    }

    private combatant(id: PlayerId | null): Combatant {
        if (id === null) return NEUTRAL;
        return {
            id,
            name: this.player(id).name,
            color: this.colors[id],
            isHuman: id === this.you,
        };
    }

    // ------------------------------------------------------------ your move

    /** Lets the player click a region until they do or time runs out. */
    private prompt(
        kind: "capital" | "target",
        options: RegionId[],
        timeMs: number
    ) {
        this.status = (m) =>
            kind === "capital" ? m.status.chooseCapital : m.status.yourTurn;
        this.promptInfo = { kind, options };
        this.fortifying = false;
        this.setPending(null);
        this.refresh();
        matchHud.set((s) => ({ ...s, deadline: performance.now() + timeMs }));
        this.map.setSelectable(options);
        this.regionWaiter = (id) => {
            if (kind === "target") this.map.setFocus(id);
            this.endPrompt();
            gameClient.selectRegion(id);
        };
    }

    private endPrompt() {
        this.regionWaiter = null;
        this.promptInfo = null;
        this.fortifying = false;
        this.map?.setSelectable([]);
        matchHud.set((s) => ({ ...s, deadline: null }));
        this.syncPowerUps();
    }

    // ------------------------------------------------------------ power-ups

    private powerUpsInPlay(): boolean {
        return (
            !!this.state && enabledKinds(this.state.config.powerUps).length > 0
        );
    }

    /** Your regions that can still take a wall. */
    private fortifiable(): RegionId[] {
        if (!this.state) return [];
        return Object.values(this.state.territories)
            .filter((t) => t.ownerId === this.you && !t.walled)
            .map((t) => t.regionId);
    }

    /** Mirrors what the power-up views need into their store. */
    private syncPowerUps() {
        const s = this.state;
        const target =
            this.promptInfo?.kind === "target"
                ? {
                      fortifiable: this.fortifiable().length,
                      scouted: this.scoutedThisTurn,
                  }
                : null;
        powerUpStore.set((p) => ({
            ...p,
            enabled: s ? enabledKinds(s.config.powerUps) : [],
            charges: s?.powerUps?.[this.you] ?? null,
            target,
            fortifying: this.fortifying,
        }));
    }

    /** A power-up button was pressed (the views only enable usable ones). */
    private usePowerUp(kind: PowerUpKind) {
        if (kind === "fortify") {
            if (this.fortifying) this.stopFortifying();
            else this.startFortifying();
            return;
        }
        this.sendPowerUp(kind);
    }

    private sendPowerUp(kind: PowerUpKind, regionId?: RegionId) {
        sfx.click();
        this.setPending(kind);
        gameClient.usePowerUp(kind, regionId);
    }

    /** While a use waits for the server, the buttons stay disabled. */
    private setPending(kind: PowerUpKind | null) {
        if (this.pendingTimer) clearTimeout(this.pendingTimer);
        this.pendingTimer = null;
        if (kind)
            this.pendingTimer = setTimeout(
                () => this.setPending(null),
                PENDING_MS
            );
        if (powerUpStore.get().pending !== kind)
            powerUpStore.set((p) => ({ ...p, pending: kind }));
    }

    /** Fortify: the map lets you pick one of your regions instead. */
    private startFortifying() {
        if (this.promptInfo?.kind !== "target") return;
        this.fortifying = true;
        this.map.setSelectable(this.fortifiable());
        this.status = (m) => m.powerUps.chooseFortify;
        this.syncPowerUps();
    }

    private stopFortifying() {
        this.fortifying = false;
        if (this.promptInfo) {
            this.map.setSelectable(this.promptInfo.options);
            this.status = (m) => m.status.yourTurn;
        }
        this.syncPowerUps();
    }

    private fortify(regionId: RegionId) {
        this.stopFortifying();
        this.sendPowerUp("fortify", regionId);
    }

    /** What your power-up revealed (private to you). */
    private onEffect(effect: PowerUpEffect) {
        this.setPending(null);
        switch (effect.kind) {
            case "fiftyFifty":
            case "rangeFinder":
            case "extraTime":
                this.overlay.applyEffect(effect);
                return;
            case "scout":
                // Shown until the battle starts (the question shows it then).
                if (this.battleInfo) return;
                this.scoutedThisTurn = true;
                powerUpStore.set((p) => ({
                    ...p,
                    scouted: { category: effect.category },
                }));
                this.syncPowerUps();
                return;
            case "fortify":
                // The wall arrives with `powerUpUsed`.
                return;
        }
    }

    /** The server refused something (e.g. a power-up at the wrong moment). */
    private onServerError(code: ErrorCode) {
        if (!this.visible) return;
        const wasPowerUp = powerUpStore.get().pending !== null;
        this.setPending(null);
        showToast((m) => {
            const reason = m.rooms.errors[code] ?? m.rooms.errors.invalid;
            return wasPowerUp ? m.powerUps.rejected(reason) : reason;
        });
    }

    // ------------------------------------------------------------ battles

    private async openBattle(
        e: Extract<MatchEvent, { kind: "battle" }>,
        late: boolean
    ) {
        const attacker = this.combatant(e.attackerId);
        const defender = this.combatant(e.defenderId);
        this.battleInfo = {
            attacker,
            defender,
            targetId: e.targetId,
            wasCapital: e.isCapital,
            humanSide: attacker.isHuman
                ? "attacker"
                : defender.isHuman
                ? "defender"
                : null,
        };
        this.map.setFocus(e.targetId);
        const opening = this.overlay.open({
            attacker,
            defender,
            targetId: e.targetId,
            isCapital: e.isCapital,
            capitalHp: e.hp,
            chainIndex: e.chainIndex,
            walled: e.walled,
        });
        if (late) return;
        await opening;
        if (e.chainIndex > 1) {
            await this.overlay.announce(
                (m) => m.status.siegeContinues(e.chainIndex),
                COLORS.gold,
                MATCH_TIMING.chainAnnounceMs - 300 - SLACK_MS
            );
        }
    }

    /** Shows the question; the answer goes to the server when given. */
    private askQuestion(e: Extract<MatchEvent, { kind: "question" }>) {
        const side = this.battleInfo?.humanSide ?? null;
        if (e.question.kind === "mcq") {
            void this.overlay
                .askMcq(e.question, side, e.opponentMs, e.timeMs)
                .then((a) => a && gameClient.answer(a.optionIndex));
        } else {
            void this.overlay
                .askNumeric(e.question, side, e.opponentMs, e.timeMs)
                .then((a) => a && gameClient.answer(a.value));
        }
    }

    private async showResult(
        r: Extract<MatchEvent, { kind: "battleResult" }>["result"]
    ) {
        const info = this.battleInfo;
        this.refresh();
        if (!info) return;
        const { attacker, defender, humanSide } = info;
        const region = info.targetId;
        /** Who a combatant is, in the current language (neutral included). */
        const whoIs = (c: Combatant, m: Messages) =>
            c.id === null
                ? { name: m.players.neutral, you: false }
                : who({ id: c.id, name: c.name });
        let text: Text;
        let color: number = COLORS.gold;
        if (r.winner === "defender") {
            text = (m) => m.status.holds(whoIs(defender, m), m.regions[region]);
            color =
                humanSide === "defender"
                    ? COLORS.correct
                    : humanSide
                    ? COLORS.wrong
                    : COLORS.text;
        } else if (r.eliminatedPlayerId) {
            const eliminated = this.player(r.eliminatedPlayerId);
            text = (m) => m.status.capitalCaptured(who(eliminated));
        } else if (r.captured) {
            text = (m) =>
                m.status.conquers(whoIs(attacker, m), m.regions[region]);
            color =
                humanSide === "attacker"
                    ? COLORS.correct
                    : humanSide
                    ? COLORS.wrong
                    : COLORS.text;
        } else if (r.wallBroken) {
            text = (m) => m.status.wallBreached;
        } else {
            const hp = r.targetHpAfter;
            text = (m) => m.status.capitalHit(hp);
        }
        if (color === COLORS.correct) sfx.conquer();
        else if (color === COLORS.wrong) sfx.defeat();
        else sfx.impact();
        await this.overlay.announce(
            text,
            color,
            MATCH_TIMING.resultMs - 300 - SLACK_MS,
            false
        );
        this.closeBattle();
    }

    private closeBattle() {
        this.refresh();
        this.overlay.close();
        this.battleInfo = null;
        this.map.setFocus(null);
    }
}
