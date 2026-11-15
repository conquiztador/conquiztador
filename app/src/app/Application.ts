import * as PIXI from "pixi.js";

/** The fixed resolution the game is designed for. */
export const DESIGN_WIDTH = 1280;
export const DESIGN_HEIGHT = 768;

export default class Application extends PIXI.Application {
    /** Center of the design area, in stage coordinates. */
    public get center(): PIXI.Point {
        return new PIXI.Point(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
    }

    public get designWidth(): number {
        return DESIGN_WIDTH;
    }

    public get designHeight(): number {
        return DESIGN_HEIGHT;
    }

    /**
     * Initializes the renderer and attaches the canvas to the page.
     * Must be awaited before any other service uses the application.
     */
    async setup(): Promise<void> {
        await this.init({
            width: window.innerWidth,
            height: window.innerHeight,
            antialias: true,
            resizeTo: window,
        });

        document.body.style.margin = "0";
        document.body.style.overflow = "hidden";
        this.canvas.style.display = "block";
        document.body.appendChild(this.canvas);

        this.fitStage();
        window.addEventListener("resize", () => this.fitStage());
    }

    /**
     * Scales the stage so the design area fits the window while keeping
     * its aspect ratio, and centers it (letterboxing the remainder).
     */
    private fitStage(): void {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const scale = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);

        this.stage.scale.set(scale);
        this.stage.position.set(
            (width - DESIGN_WIDTH * scale) / 2,
            (height - DESIGN_HEIGHT * scale) / 2
        );
    }
}
