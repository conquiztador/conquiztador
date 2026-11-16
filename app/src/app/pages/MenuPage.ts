import * as PIXI from "pixi.js";

import Application from "../Application";
import { ButtonEvent } from "../Events";
import { Page } from "shared/Page";
import { Button, COLORS, label } from "app/game/ui";
import LayerManager from "app/managers/LayerManager";

export class MenuPage extends Page {
    private _newGameButton: Button;
    private title: PIXI.Text;
    private subtitle: PIXI.Text;

    constructor(app: Application, layerManager: LayerManager) {
        super(app, layerManager);

        this.visible = true;

        const title = (this.title = label("Conquiztador", 72, COLORS.gold, {
            stroke: { color: 0x000000, width: 8 },
        }));
        title.anchor.set(0.5);
        const subtitle = (this.subtitle = label(
            "Conquer Bulgaria, one question at a time",
            24
        ));
        subtitle.anchor.set(0.5);
        this.addChild(title, subtitle);

        this.addNewGamesButton();

        this.attachListeners();
        this.layout();
    }

    protected layout() {
        const { x, y } = this.app.center;
        this.title.position.set(x, y - 160);
        this.subtitle.position.set(x, y - 90);
        this._newGameButton.position.set(x, y);
    }

    private addNewGamesButton() {
        this._newGameButton = new Button("New game", 300, 60, 26);

        this.addChild(this._newGameButton);
    }

    private attachListeners() {
        this.app.stage.on(
            ButtonEvent.exitButtonClicked,
            this.onExitButtonClicked,
            this
        );

        this._newGameButton.on("pointerup", this.onNewGameButtonClicked, this);
    }

    private onExitButtonClicked() {
        this.visible = true;
    }

    private onNewGameButtonClicked() {
        this.visible = false;
        this.app.stage.emit(ButtonEvent.newGameButtonClicked);
    }
}
