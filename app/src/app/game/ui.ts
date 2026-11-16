import * as PIXI from "pixi.js";

import { sfx } from "app/audio/sfx";

export const FONT = "Arial";

export const COLORS = {
    panel: 0x1d2433,
    panelBorder: 0x3a4660,
    text: 0xffffff,
    mutedText: 0xa8b3c7,
    neutral: 0x8a8f98,
    button: 0x2f6fd6,
    buttonHover: 0x3d80ea,
    buttonSelected: 0x32a852,
    buttonDisabled: 0x4a5163,
    correct: 0x32a852,
    wrong: 0xd64545,
    highlight: 0xffe066,
    gold: 0xf2c94c,
};

/** Distinct, colour-blind-friendly-ish player colours (index = seat). */
export const PLAYER_COLORS = [0x2f80ed, 0xeb5757, 0x27ae60, 0xf2994a, 0x9b51e0];

export function label(
    text: string,
    size = 20,
    color: number = COLORS.text,
    options: Partial<PIXI.TextStyleOptions> = {}
): PIXI.Text {
    return new PIXI.Text({
        text,
        style: {
            fontFamily: FONT,
            fontSize: size,
            fill: color,
            fontWeight: "bold",
            ...options,
        },
    });
}

export function panel(
    width: number,
    height: number,
    color: number = COLORS.panel,
    alpha = 0.95
): PIXI.Graphics {
    return new PIXI.Graphics()
        .roundRect(0, 0, width, height, 14)
        .fill({ color, alpha })
        .stroke({ width: 2, color: COLORS.panelBorder });
}

export class Button extends PIXI.Container {
    private bg = new PIXI.Graphics();
    private text: PIXI.Text;
    private _enabled = true;
    private _selected = false;
    private hovered = false;
    private overrideColor: number | null = null;

    constructor(
        content: string,
        public readonly buttonWidth = 240,
        public readonly buttonHeight = 50,
        fontSize = 20
    ) {
        super();
        this.text = label(content, fontSize, COLORS.text, {
            wordWrap: true,
            wordWrapWidth: buttonWidth - 20,
            align: "center",
        });
        this.text.anchor.set(0.5);
        this.text.position.set(buttonWidth / 2, buttonHeight / 2);
        this.addChild(this.bg, this.text);
        this.pivot.set(buttonWidth / 2, buttonHeight / 2);

        this.eventMode = "static";
        this.cursor = "pointer";
        this.on("pointerover", () => this.setHover(true));
        this.on("pointerout", () => this.setHover(false));
        this.on("pointerdown", () => this._enabled && this.scale.set(0.96));
        this.on("pointerup", () => this.scale.set(1));
        this.on("pointerupoutside", () => this.scale.set(1));
        this.redraw();
    }

    /** Registers a click handler that only fires while enabled. */
    onClick(handler: () => void): this {
        this.on("pointertap", () => {
            if (!this._enabled) return;
            sfx.click();
            handler();
        });
        return this;
    }

    set label(value: string) {
        this.text.text = value;
    }

    set enabled(value: boolean) {
        this._enabled = value;
        this.cursor = value ? "pointer" : "default";
        this.redraw();
    }

    get enabled() {
        return this._enabled;
    }

    set selected(value: boolean) {
        this._selected = value;
        this.redraw();
    }

    /** Forces a fill colour (e.g. green/red when revealing answers). */
    setColor(color: number | null) {
        this.overrideColor = color;
        this.redraw();
    }

    private setHover(value: boolean) {
        this.hovered = value;
        this.redraw();
    }

    private redraw() {
        let color = COLORS.button;
        if (this.overrideColor !== null) color = this.overrideColor;
        else if (!this._enabled) color = COLORS.buttonDisabled;
        else if (this._selected) color = COLORS.buttonSelected;
        else if (this.hovered) color = COLORS.buttonHover;

        this.bg
            .clear()
            .roundRect(0, 0, this.buttonWidth, this.buttonHeight, 10)
            .fill(color)
            .stroke({
                width: this._selected ? 3 : 2,
                color: this._selected ? COLORS.highlight : 0xcccccc,
            });
    }
}

export function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs `update(t)` with t going 0→1 over `durationMs` on the given ticker. */
export function tween(
    ticker: PIXI.Ticker,
    durationMs: number,
    update: (t: number) => void
): Promise<void> {
    return new Promise((resolve) => {
        let elapsed = 0;
        const step = (tk: PIXI.Ticker) => {
            elapsed += tk.deltaMS;
            const t = Math.min(1, elapsed / durationMs);
            update(t);
            if (t >= 1) {
                ticker.remove(step);
                resolve();
            }
        };
        ticker.add(step);
    });
}

export const easeOutBack = (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
