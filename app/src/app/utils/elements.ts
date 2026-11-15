import * as PIXI from "pixi.js";

export function createButton(content: string): PIXI.Graphics {
    const graphics = new PIXI.Graphics()
        .roundRect(0, 0, 300, 50, 10)
        .fill(0x32a852)
        .stroke({ width: 2, color: 0xcccccc });
    graphics.pivot.set(graphics.width / 2, graphics.height / 2);

    graphics.eventMode = "static";
    graphics.cursor = "pointer";

    const text = new PIXI.Text({
        text: content,
        style: {
            fontFamily: "Arial",
            fontWeight: "bold",
            fontSize: 24,
            fill: 0xffffff,
            align: "left",
        },
    });

    text.pivot.set(text.width / 2, text.height / 2);
    text.position.copyFrom(graphics.pivot);

    graphics.addChild(text);

    graphics.on("pointerdown", () => {
        graphics.scale.set(0.95);
    });

    graphics.on("pointerupoutside", () => {
        graphics.scale.set(1);
    });

    graphics.on("pointerup", () => {
        graphics.scale.set(1);
    });

    return graphics;
}
