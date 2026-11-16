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
    PlayerId,
    RegionId,
    Side,
} from "app/core/types";
import { BattleOverlay, Combatant } from "app/game/components/BattleOverlay";
import { HudView } from "app/game/components/HudView";
import { MapEvent, MapView } from "app/game/components/MapView";
import { LocalQuestionProvider } from "app/game/questions/LocalQuestionProvider";
import { Button, COLORS, label, PLAYER_COLORS, wait } from "app/game/ui";
import { sfx } from "app/audio/sfx";

const NEUTRAL: Combatant = {
    name: "Neutral",
    color: COLORS.neutral,
    isHuman: false,
};
const HUMAN_ID = "you";

/** The match screen: map, HUD and battle flow driven by the GameEngine. */
export class ConquestPage extends Page {
    private engine: GameEngine;
    private map: MapView;
    private hud: HudView;
    private overlay: BattleOverlay;
    private quitButton: Button;
    private message = label("", 26, COLORS.text, {
        stroke: { color: 0x000000, width: 4 },
    });
    private colors: Record<PlayerId, number> = {};
    private matchId = 0;
    private regionWaiter: ((id: RegionId) => void) | null = null;

    constructor(app: Application, layerManager: LayerManager) {
        super(app, layerManager);
        this.visible = false;

        this.message.anchor.set(0.5);
        this.addChild(this.message);

        this.quitButton = new Button("Quit", 120, 44, 20).onClick(() =>
            this.quit()
        );
        this.addChild(this.quitButton);

        this.overlay = new BattleOverlay();

        this.app.stage.on(GameEvent.startMatch, (config: GameConfig) =>
            this.startMatch(config)
        );
        this.layout();
    }

    /**
     * Landscape: map on the left, HUD on the right.
     * Portrait: map across the top, HUD underneath.
     */
    protected layout() {
        const w = this.app.designWidth;
        const h = this.app.designHeight;
        this.quitButton.position.set(w - 90, 50);

        if (this.app.isPortrait) {
            this.message.position.set(w / 2, 120);
            this.message.style.wordWrapWidth = w - 40;
        } else {
            this.message.position.set(450, 50);
            this.message.style.wordWrapWidth = 820;
        }
        this.message.style.wordWrap = true;
        this.message.style.align = "center";
        if (!this.map) return;

        if (this.app.isPortrait) {
            const mapWidth = w - 30;
            this.map.scale.set(mapWidth / this.map.mapWidth);
            this.map.position.set(15, 165);
            const hudTop = 165 + this.map.mapHeight * this.map.scale.y + 20;
            this.hud.position.set(20, hudTop);
            this.hud.resize(w - 40, h - hudTop - 30);
        } else {
            this.map.scale.set(1);
            this.map.position.set(30, 110);
            this.hud.position.set(910, 110);
            this.hud.resize(340, 560);
        }
    }

    private startMatch(config: GameConfig) {
        const id = ++this.matchId;
        this.colors = Object.fromEntries(
            config.players.map((p, i) => [p.id, PLAYER_COLORS[i]])
        );

        this.map?.destroy({ children: true });
        this.hud?.destroy({ children: true });

        this.map = new MapView(this.app.ticker, 1.1);
        this.map.setPlayerColors(this.colors);
        this.map.on(MapEvent.regionSelected, (r: RegionId) => {
            if (!this.regionWaiter) return;
            sfx.select();
            this.regionWaiter(r);
        });

        this.hud = new HudView(this.colors);

        this.addChild(this.map, this.hud);
        this.layout();
        this.overlay.close();

        this.engine = new GameEngine(
            config,
            BULGARIA,
            new LocalQuestionProvider()
        );
        this.engine.start();
        this.visible = true;
        this.run(id).catch((e) => console.error(e));
    }

    private quit() {
        this.matchId++; // stops the running loop
        this.regionWaiter = null;
        this.overlay.close();
        this.visible = false;
        this.app.stage.emit(ButtonEvent.exitButtonClicked);
    }

    private refresh() {
        const state = this.engine.getPublicState();
        this.map.render(state);
        this.hud.render(
            this.engine.getState(),
            this.engine.activePlayer?.id ?? null
        );
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
                    this.message.text =
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
        this.message.text = "Game over";
        await wait(1200);
        if (!alive()) return;
        this.visible = false;
        this.app.stage.emit(GameEvent.matchFinished, this.engine.getState());
    }

    private async capitalSelection() {
        this.message.text = "Choose your capital";
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
            this.message.text = "Your turn — choose a region to attack";
            target = await this.waitForRegion(targets);
        } else {
            this.message.text = `${player.name} is choosing a target…`;
            await wait(700);
            target = botChooseTarget(
                Math.random,
                this.engine.getState(),
                player.id,
                player.difficulty ?? Difficulty.Medium
            );
            this.map.setFocus(target);
            this.message.text = `${player.name} attacks ${BULGARIA.regions[target].name}!`;
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
