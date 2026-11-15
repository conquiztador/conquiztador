import { Service } from "typedi";
import * as PIXI from "pixi.js";

import Application from "../Application";
import LayerManager from "app/managers/LayerManager";

@Service()
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

        return new PIXI.Sprite(texture);
    }

    protected redraw(): void {
        if (this.background) {
            this.layerManager.background.detach(this.background);
            this.background.destroy({ texture: true, textureSource: true });
            this.addBackground();
        }
    }
}
