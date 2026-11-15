import * as PIXI from "pixi.js";
import { Service } from "typedi";

@Service()
export default class Application extends PIXI.Application {
    public get center(): PIXI.Point {
        const x = this.screen.width / 2;
        const y = this.screen.height / 2;

        return new PIXI.Point(x, y);
    }

    /**
     * Initializes the renderer and attaches the canvas to the page.
     * Must be awaited before any other service uses the application.
     */
    async setup(): Promise<void> {
        await this.init({
            width: 1280,
            height: 768,
            antialias: true,
            resizeTo: window,
        });

        document.body.appendChild(this.canvas);
    }
}
