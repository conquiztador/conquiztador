import Application from "../Application";
import { ButtonEvent, GameEvent } from "../Events";
import { Page } from "shared/Page";
import LayerManager from "app/managers/LayerManager";
import { botChooseTarget } from "app/core/bot";
import { GameEngine } from "app/core/GameEngine";
import { BULGARIA } from "app/core/maps/bulgaria";
import {
    Difficulty,
    GameConfig,
    GamePhase,
    GameState,
    PlayerId,
    RegionId,
    Side,
} from "app/core/types";
import { BattleOverlay, Combatant } from "app/game/components/BattleOverlay";
import { HUD, matchHud } from "app/game/components/MatchHud";
import { MapEvent, MapView } from "app/game/components/MapView";
import { LocalQuestionProvider } from "app/game/questions/LocalQuestionProvider";
import { COLORS, PLAYER_COLORS, wait } from "app/game/ui";
import { territoriesOf } from "app/core/territory";
import { sfx } from "app/audio/sfx";

const NEUTRAL: Combatant = {
    name: "Neutral",
    color: COLORS.neutral,
    isHuman: false,
};
const HUMAN_ID = "you";
/** Map labels never render smaller than this many CSS pixels. */
const MIN_LABEL_PX = 9;
const MAP_LABEL_FONT = 11;

/** The match screen: map, HUD and battle flow driven by the GameEngine. */
export class ConquestPage extends Page {
    private engine: GameEngine;
    private map: MapView;
    private overlay: BattleOverlay;
    private colors: Record<PlayerId, number> = {};
    private matchId = 0;
    private regionWaiter: ((id: RegionId) => void) | null = null;
    /** Players whose capital has been shown; others are hidden until revealed. */
    private revealed = new Set<PlayerId>();

    constructor(app: Application, layerManager: LayerManager) {
        super(app, layerManager);
        this.visible = false;

        matchHud.set((s) => ({ ...s, onQuit: () => this.quit() }));
        this.overlay = new BattleOverlay();

        this.app.stage.on(GameEvent.startMatch, (config: GameConfig) =>
            this.startMatch(config)
        );
        this.layout();
    }

    /** Status line shown in the HUD. */
    private set status(text: string) {
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
            const players = this.engine?.getState().players.length ?? 3;
            const cols = Math.max(1, Math.floor((W - 2 * m) / 160));
            const gridH = Math.ceil(players / cols) * HUD.playerRow + 2 * m;
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

    private startMatch(config: GameConfig) {
        const id = ++this.matchId;
        this.revealed.clear();
        this.colors = Object.fromEntries(
            config.players.map((p, i) => [p.id, PLAYER_COLORS[i]])
        );

        this.map?.destroy({ children: true });

        this.map = new MapView(this.app.ticker, 1.1);
        this.map.setPlayerColors(this.colors);
        this.map.on(MapEvent.regionSelected, (r: RegionId) => {
            if (!this.regionWaiter) return;
            sfx.select();
            this.regionWaiter(r);
        });

        this.addChild(this.map);
        this.overlay.close();

        this.engine = new GameEngine(
            config,
            BULGARIA,
            new LocalQuestionProvider()
        );
        this.engine.start();
        this.layout();
        this.status = "";
        matchHud.set((s) => ({ ...s, visible: true }));
        this.visible = true;
        this.run(id).catch((e) => console.error(e));
    }

    private quit() {
        this.matchId++; // stops the running loop
        this.regionWaiter = null;
        this.overlay.close();
        this.visible = false;
        matchHud.set((s) => ({ ...s, visible: false }));
        this.app.stage.emit(ButtonEvent.exitButtonClicked);
    }

    /** Renders map and HUD, hiding capitals that haven't been revealed yet. */
    private refresh(activeId = this.engine.activePlayer?.id ?? null) {
        const hide = <S extends { territories: GameState["territories"] }>(
            s: S
        ): S => ({
            ...s,
            territories: Object.fromEntries(
                Object.entries(s.territories).map(([id, t]) => [
                    id,
                    t.isCapital && t.ownerId && !this.revealed.has(t.ownerId)
                        ? { ...t, ownerId: null, isCapital: false }
                        : t,
                ])
            ),
        });
        this.map.render(hide(this.engine.getPublicState()));

        const state = hide(this.engine.getState());
        matchHud.set((s) => ({
            ...s,
            round: state.round,
            rounds: state.config.rounds,
            players: state.players.map((p) => {
                const owned = territoriesOf(state.territories, p.id);
                return {
                    id: p.id,
                    name: p.name,
                    color: this.colors[p.id],
                    isBot: p.kind === "bot",
                    regions: owned.length,
                    capitalHp: owned.find((t) => t.isCapital)?.hp ?? 0,
                    eliminated: p.eliminated,
                    active: p.id === activeId && !p.eliminated,
                };
            }),
        }));
    }

    /**
     * Plays capital placements that haven't been shown yet, one player at a
     * time in turn order. Bots (and random placement) get a short "selecting"
     * pause first; a capital the human just clicked is animated right away.
     */
    private async revealCapitals(alive: () => boolean) {
        const s = this.engine.getState();
        for (const playerId of s.turnOrder) {
            if (this.revealed.has(playerId)) continue;
            const capital = Object.values(s.territories).find(
                (t) => t.isCapital && t.ownerId === playerId
            );
            if (!capital) continue;
            const player = s.players.find((p) => p.id === playerId);
            const regionName = BULGARIA.regions[capital.regionId].name;

            if (player.kind === "bot" || s.config.placement === "random") {
                this.status =
                    playerId === HUMAN_ID
                        ? "Selecting your capital…"
                        : `${player.name} is selecting a capital…`;
                this.refresh(playerId);
                await wait(1100);
                if (!alive()) return;
            }

            this.refresh(playerId);
            sfx.select();
            await this.map.claim(
                capital.regionId,
                this.colors[playerId],
                () => {
                    this.revealed.add(playerId);
                    this.refresh(playerId);
                }
            );
            if (!alive()) return;
            this.status =
                playerId === HUMAN_ID
                    ? `Your capital: ${regionName}`
                    : `${player.name} chose ${regionName}`;
            await wait(700);
            if (!alive()) return;
        }
    }

    private playerName(id: PlayerId | null) {
        if (id === null) return "Neutral";
        return id === HUMAN_ID
            ? "You"
            : this.engine.getState().players.find((p) => p.id === id).name;
    }

    private combatant(id: PlayerId | null): Combatant {
        if (id === null) return NEUTRAL;
        return {
            name: this.playerName(id),
            color: this.colors[id],
            isHuman: id === HUMAN_ID,
        };
    }

    private waitForRegion(selectable: RegionId[]): Promise<RegionId> {
        this.map.setSelectable(selectable);
        return new Promise((resolve) => {
            this.regionWaiter = (id) => {
                this.regionWaiter = null;
                this.map.setSelectable([]);
                resolve(id);
            };
        });
    }

    // ------------------------------------------------------------ main loop

    private async run(id: number) {
        const alive = () => id === this.matchId;
        while (alive() && this.engine.phase !== GamePhase.GameOver) {
            this.refresh();
            await this.revealCapitals(alive);
            if (!alive()) return;
            this.refresh();
            switch (this.engine.phase) {
                case GamePhase.CapitalSelection:
                    await this.capitalSelection();
                    break;
                case GamePhase.TurnSelectTarget:
                    await this.selectTarget();
                    break;
                // Bot-only battles resolve instantly, so any battle phase
                // may be current here; battle() replays it for the viewer.
                case GamePhase.BattleMcq:
                case GamePhase.BattleNumeric:
                case GamePhase.BattleResolution:
                    await this.battle();
                    break;
                case GamePhase.RoundEnd: {
                    const s = this.engine.getState();
                    this.status =
                        s.round >= s.config.rounds
                            ? "Final round complete!"
                            : `Round ${s.round} complete`;
                    await wait(1400);
                    this.engine.continue();
                    break;
                }
                default:
                    throw new Error(`Unexpected phase ${this.engine.phase}`);
            }
        }
        if (!alive()) return;
        this.refresh();
        this.status = "Game over";
        await wait(1200);
        if (!alive()) return;
        this.visible = false;
        matchHud.set((s) => ({ ...s, visible: false }));
        this.app.stage.emit(GameEvent.matchFinished, this.engine.getState());
    }

    private async capitalSelection() {
        this.status = "Choose your capital";
        const region = await this.waitForRegion(
            this.engine.capitalCandidates()
        );
        this.engine.selectCapital(HUMAN_ID, region);
    }

    private async selectTarget() {
        const player = this.engine.activePlayer;
        const targets = this.engine.attackableTargets(player.id);
        let target: RegionId;

        if (player.kind === "human") {
            this.status = "Your turn — choose a region to attack";
            target = await this.waitForRegion(targets);
        } else {
            this.status = `${player.name} is choosing a target…`;
            await wait(700);
            target = botChooseTarget(
                Math.random,
                this.engine.getState(),
                player.id,
                player.difficulty ?? Difficulty.Medium
            );
            this.map.setFocus(target);
            this.status = `${player.name} attacks ${BULGARIA.regions[target].name}!`;
            await wait(900);
        }
        this.map.setFocus(target);
        this.engine.selectTarget(player.id, target);
    }

    /** Plays one battle (and any capital chain that follows) until the turn moves on. */
    private async battle() {
        const first = this.engine.getState().battle;
        const target = this.engine.getState().territories[first.targetId];
        const attacker = this.combatant(first.attackerId);
        const defender = this.combatant(first.defenderId);
        const humanSide: Side | null = attacker.isHuman
            ? "attacker"
            : defender.isHuman
            ? "defender"
            : null;
        const opponentSide: Side =
            humanSide === "attacker" ? "defender" : "attacker";
        const limit = this.engine.getState().config.timeLimitMs;

        await this.overlay.open({
            attacker,
            defender,
            targetName: BULGARIA.regions[first.targetId].name,
            isCapital: target.isCapital,
            capitalHp: target.hp,
            chainIndex: first.chainIndex,
            walled: target.walled,
        });

        if (first.chainIndex > 1) {
            await this.overlay.announce(
                `Siege continues!\nBattle ${first.chainIndex} for the capital`
            );
        }

        // Phase 1
        const pub = this.engine.getPublicState().battle;
        const opponentMs =
            this.engine.getState().battle.mcqAnswers[opponentSide]
                ?.responseTimeMs ?? null;
        const answer = await this.overlay.askMcq(
            pub.mcq,
            humanSide,
            opponentMs,
            limit
        );
        if (humanSide) {
            if (answer) this.engine.submitMcq(HUMAN_ID, answer);
            else this.engine.expireTimer();
        }
        let s = this.engine.getState();
        await this.overlay.revealMcq(
            s.battle.mcq.correctIndex,
            s.battle.mcqAnswers
        );

        // Phase 2
        if (this.engine.getState().battle.numeric) {
            await this.overlay.announce(
                "Both correct!\nTie-breaker…",
                COLORS.highlight,
                800
            );
            const opMs =
                this.engine.getState().battle.numericAnswers[opponentSide]
                    ?.responseTimeMs ?? null;
            const num = await this.overlay.askNumeric(
                this.engine.getPublicState().battle.numeric,
                humanSide,
                opMs,
                limit
            );
            if (humanSide) {
                if (num) this.engine.submitNumeric(HUMAN_ID, num);
                else this.engine.expireTimer();
            }
            s = this.engine.getState();
            await this.overlay.revealNumeric(
                s.battle.numeric.correctValue,
                s.battle.numericAnswers,
                s.battle.result.winner
            );
        }

        // Resolution
        s = this.engine.getState();
        const r = s.battle.result;
        const regionName = BULGARIA.regions[s.battle.targetId].name;
        this.refresh();
        let text: string;
        let color: number = COLORS.gold;
        if (r.winner === "defender") {
            text = `${defender.name} ${
                defender.name === "You" ? "hold" : "holds"
            } ${regionName}!`;
            color =
                humanSide === "defender"
                    ? COLORS.correct
                    : humanSide
                    ? COLORS.wrong
                    : COLORS.text;
        } else if (r.eliminatedPlayerId) {
            text = `Capital captured!\n${this.playerName(
                r.eliminatedPlayerId
            )} ${r.eliminatedPlayerId === HUMAN_ID ? "are" : "is"} eliminated`;
        } else if (r.captured) {
            text = `${attacker.name} ${
                attacker.name === "You" ? "conquer" : "conquers"
            } ${regionName}!`;
            color =
                humanSide === "attacker"
                    ? COLORS.correct
                    : humanSide
                    ? COLORS.wrong
                    : COLORS.text;
        } else if (r.wallBroken) {
            text = "The wall is breached!";
        } else {
            text = `Capital hit! ${r.targetHpAfter} shield${
                r.targetHpAfter === 1 ? "" : "s"
            } left`;
        }
        if (color === COLORS.correct) sfx.conquer();
        else if (color === COLORS.wrong) sfx.defeat();
        else sfx.impact();
        await this.overlay.announce(text, color, 1400, false);
        this.overlay.close();
        this.map.setFocus(null);
        this.engine.continue();
    }
}
