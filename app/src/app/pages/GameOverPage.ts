import * as PIXI from "pixi.js";

import Application from "../Application";
import { ButtonEvent, GameEvent } from "../Events";
import { Page } from "shared/Page";
import LayerManager from "app/managers/LayerManager";
import { territoriesOf } from "app/core/territory";
import { GameState } from "app/core/types";
import { Button, COLORS, label } from "app/game/ui";

/** Final standings after a match. */
export class GameOverPage extends Page {
    private content = new PIXI.Container();

    constructor(app: Application, layerManager: LayerManager) {
        super(app, layerManager);
        this.visible = false;
        this.addChild(this.content);

        const menu = new Button("Main menu", 260, 60, 24).onClick(() => {
            this.visible = false;
            this.app.stage.emit(ButtonEvent.exitButtonClicked);
        });
        menu.position.set(this.app.center.x - 150, 660);
        const again = new Button("Play again", 260, 60, 24).onClick(() => {
            this.visible = false;
            this.app.stage.emit(ButtonEvent.newGameButtonClicked);
        });
        again.position.set(this.app.center.x + 150, 660);
        this.addChild(menu, again);

        this.app.stage.on(GameEvent.matchFinished, (s: GameState) =>
            this.show(s)
        );
    }

    private show(state: GameState) {
        this.content
            .removeChildren()
            .forEach((c) => c.destroy({ children: true }));
        const winners = state.players.filter((p) =>
            state.winners.includes(p.id)
        );
        const youWon = state.winners.includes("you");

        const title =
            winners.length > 1
                ? "It's a draw!"
                : youWon
                ? "Victory!"
                : `${winners[0]?.name ?? "Nobody"} wins`;
        const t = label(title, 60, youWon ? COLORS.gold : COLORS.text, {
            stroke: { color: 0x000000, width: 6 },
        });
        t.anchor.set(0.5);
        t.position.set(this.app.center.x, 130);
        this.content.addChild(t);

        const ranked = [...state.players]
            .map((p) => ({
                p,
                count: territoriesOf(state.territories, p.id).length,
            }))
            .sort((a, b) => b.count - a.count);

        ranked.forEach(({ p, count }, i) => {
            const row = label(
                `${i + 1}.  ${p.name}  —  ${
                    p.eliminated
                        ? "eliminated"
                        : `${count} region${count === 1 ? "" : "s"}`
                }`,
                30,
                state.winners.includes(p.id) ? COLORS.gold : COLORS.text
            );
            row.anchor.set(0.5);
            row.position.set(this.app.center.x, 250 + i * 60);
            this.content.addChild(row);
        });

        this.visible = true;
    }
}
