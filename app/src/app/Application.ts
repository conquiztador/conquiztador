import * as PIXI from "pixi.js";

export type Orientation = "landscape" | "portrait";

/** The fixed resolutions the game is designed for, one per orientation. */
export const DESIGN_SIZES: Record<
    Orientation,
    { width: number; height: number }
> = {
    landscape: { width: 1280, height: 768 },
    portrait: { width: 720, height: 1280 },
};

export const AppEvent = {
    /** Emitted on the stage after every resize (orientation may have changed). */
    layout: "layout",
} as const;

export default class Application extends PIXI.Application {
    /**
     * DOM layer above the canvas, sized to the design area and scaled with
     * the stage, so HTML UI can use the same coordinates as the stage.
     */
    public readonly uiRoot: HTMLDivElement = document.createElement("div");

    /**
     * Unscaled DOM layer covering the whole window, for UI that should stay
     * at a readable size in real CSS pixels (HUD, mute button).
     */
    public readonly screenRoot: HTMLDivElement = document.createElement("div");

    private _orientation: Orientation = "landscape";

    public get orientation(): Orientation {
        return this._orientation;
    }

    public get isPortrait(): boolean {
        return this._orientation === "portrait";
    }

    public get designWidth(): number {
        return DESIGN_SIZES[this._orientation].width;
    }

    public get designHeight(): number {
        return DESIGN_SIZES[this._orientation].height;
    }

    /** Center of the design area, in stage coordinates. */
    public get center(): PIXI.Point {
        return new PIXI.Point(this.designWidth / 2, this.designHeight / 2);
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
            // Render at the device's pixel density so text is sharp on phones.
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
        });

        document.body.style.margin = "0";
        document.body.style.overflow = "hidden";
        this.canvas.style.display = "block";
        document.body.appendChild(this.canvas);

        this.screenRoot.id = "screen-root";
        document.body.appendChild(this.screenRoot);
        this.uiRoot.id = "ui-root";
        document.body.appendChild(this.uiRoot);

        this.fitStage();
        window.addEventListener("resize", () => this.fitStage());
    }

    /**
     * Picks the orientation whose design area fits the window at the larger
     * scale, then scales and centers the stage (letterboxing the remainder).
     */
    private fitStage(): void {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const scaleFor = (o: Orientation) =>
            Math.min(
                width / DESIGN_SIZES[o].width,
                height / DESIGN_SIZES[o].height
            );
        const orientation: Orientation =
            scaleFor("portrait") > scaleFor("landscape")
                ? "portrait"
                : "landscape";
        this._orientation = orientation;

        const scale = scaleFor(orientation);
        const x = (width - this.designWidth * scale) / 2;
        const y = (height - this.designHeight * scale) / 2;

        this.stage.scale.set(scale);
        this.stage.position.set(x, y);

        const ui = this.uiRoot.style;
        ui.width = `${this.designWidth}px`;
        ui.height = `${this.designHeight}px`;
        ui.transform = `translate(${x}px, ${y}px) scale(${scale})`;
        this.uiRoot.dataset.orientation = orientation;

        this.stage.emit(AppEvent.layout, orientation);
    }

    /** Converts window (CSS pixel) coordinates to stage coordinates. */
    public screenToStage(x: number, y: number): PIXI.Point {
        const s = this.stage.scale.x;
        return new PIXI.Point(
            (x - this.stage.position.x) / s,
            (y - this.stage.position.y) / s
        );
    }
}
