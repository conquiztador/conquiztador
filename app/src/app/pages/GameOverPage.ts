import * as PIXI from "pixi.js";

import Application from "../Application";
import { ButtonEvent, GameEvent } from "../Events";
import { Page } from "shared/Page";
import LayerManager from "app/managers/LayerManager";
import { territoriesOf } from "app/core/territory";
import { GameState } from "app/core/types";
import { Button, COLORS, label } from "app/game/ui";
import { sfx } from "app/audio/sfx";
import { playerName, t } from "app/i18n";

/** Final standings after a match. */
export class GameOverPage extends Page {
    private content = new PIXI.Container();
    private menuButton: Button;
    private againButton: Button;
    private state: GameState | null = null;

    constructor(app: Application, layerManager: LayerManager) {
        super(app, layerManager);
        this.visible = false;
        this.addChild(this.content);

        const menu = new Button("", 260, 60, 24).onClick(() => {
            this.visible = false;
            this.app.stage.emit(ButtonEvent.exitButtonClicked);
        });
        const again = new Button("", 260, 60, 24).onClick(() => {
            this.visible = false;
            this.app.stage.emit(ButtonEvent.newGameButtonClicked);
        });
        this.menuButton = menu;
        this.againButton = again;
        this.addChild(menu, again);

        this.app.stage.on(GameEvent.matchFinished, (s: GameState) =>
            this.show(s)
        );
        this.relabel();
        this.layout();
    }

    protected relabel() {
        const m = t().gameOver;
        this.menuButton.label = m.mainMenu;
        this.againButton.label = m.playAgain;
        if (this.state) this.renderStandings(this.state);
    }

    protected layout() {
        const { x } = this.app.center;
        const y = this.app.designHeight - 108;
        this.menuButton.position.set(x - 150, y);
        this.againButton.position.set(x + 150, y);
        if (this.state) this.renderStandings(this.state);
    }

    private show(state: GameState) {
        this.state = state;
        if (state.winners.includes("you")) sfx.victory();
        else sfx.gameLost();
        this.renderStandings(state);
        this.visible = true;
    }

    private renderStandings(state: GameState) {
        const m = t().gameOver;
        const top = this.app.isPortrait ? 220 : 130;
        this.content
            .removeChildren()
            .forEach((c) => c.destroy({ children: true }));
        const winners = state.players.filter((p) =>
            state.winners.includes(p.id)
        );
        const youWon = state.winners.includes("you");

        const title =
            winners.length > 1
                ? m.draw
                : youWon
                ? m.victory
                : m.wins(winners[0] ? playerName(winners[0]) : m.nobody);
        const heading = label(title, 60, youWon ? COLORS.gold : COLORS.text, {
            stroke: { color: 0x000000, width: 6 },
        });
        heading.anchor.set(0.5);
        heading.position.set(this.app.center.x, top);
        this.content.addChild(heading);

        const ranked = [...state.players]
            .map((p) => ({
                p,
                count: territoriesOf(state.territories, p.id).length,
            }))
            .sort((a, b) => b.count - a.count);

        ranked.forEach(({ p, count }, i) => {
            const row = label(
                `${i + 1}.  ${playerName(p)}  —  ${
                    p.eliminated ? m.eliminated : m.regions(count)
                }`,
                30,
                state.winners.includes(p.id) ? COLORS.gold : COLORS.text
            );
            row.anchor.set(0.5);
            row.position.set(this.app.center.x, top + 120 + i * 60);
            this.content.addChild(row);
        });
    }
}
