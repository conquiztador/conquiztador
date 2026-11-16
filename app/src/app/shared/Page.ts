import * as PIXI from "pixi.js";

import Application, { AppEvent } from "../Application";
import LayerManager from "app/managers/LayerManager";

export class Page extends PIXI.Container {
    protected background: PIXI.Sprite;

    constructor(
        protected app: Application,
        protected layerManager: LayerManager
    ) {
        super();

        this.app.stage.addChild(this);

        this.addBackground();

        window.addEventListener("resize", () => {
            this.redraw();
        });
        this.app.stage.on(AppEvent.layout, () => this.layout());
    }

    /**
     * Positions the page's content for the current design size. Subclasses
     * call it once they're built; it re-runs whenever the orientation changes.
     */
    protected layout(): void {
        // Nothing to place by default.
    }

    protected addBackground(): void {
        this.background = this.createBackground();

        this.layerManager.background.attach(this.background);

        this.addChild(this.background);
    }

    protected createBackground(): PIXI.Sprite {
        const context = document.createElement("canvas").getContext("2d");
        context.canvas.width = window.innerWidth;
        context.canvas.height = window.innerHeight;

        const gradient = context.createLinearGradient(
            0,
            0,
            0,
            context.canvas.height
        );

        gradient.addColorStop(0, "#cccccc");
        gradient.addColorStop(1, "#000000");

        context.fillStyle = gradient;
        context.fillRect(0, 0, context.canvas.width, context.canvas.height);

        const texture = PIXI.Texture.from(context.canvas);

        const sprite = new PIXI.Sprite(texture);

        // The stage is scaled and offset to fit the design area; undo that
        // so the background covers the whole window.
        const stage = this.app.stage;
        sprite.scale.set(1 / stage.scale.x);
        sprite.position.set(
            -stage.position.x / stage.scale.x,
            -stage.position.y / stage.scale.y
        );

        return sprite;
    }

    protected redraw(): void {
        if (this.background) {
            this.layerManager.background.detach(this.background);
            this.background.destroy({ texture: true, textureSource: true });
            this.addBackground();
        }
    }
}
