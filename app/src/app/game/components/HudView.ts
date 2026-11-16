import * as PIXI from "pixi.js";

import { territoriesOf } from "app/core/territory";
import { GameState, PlayerId } from "app/core/types";

import { COLORS, label, panel } from "../ui";

/** Side panel: round counter and per-player standings. */
export class HudView extends PIXI.Container {
    private round = label("", 26);
    private rows = new PIXI.Container();
    private background = new PIXI.Container();
    private legend: PIXI.Text;
    private panelWidth = 340;
    private last: [GameState, PlayerId | null] | null = null;

    constructor(private colors: Record<PlayerId, number>) {
        super();
        this.round.position.set(20, 18);
        this.rows.position.set(0, 70);
        this.addChild(this.background, this.round, this.rows);

        const legend = (this.legend = label(
            "Click a highlighted region to attack.\nCapitals need 3 wins and chain\nattacks until captured or defended.",
            14,
            COLORS.mutedText,
            { fontWeight: "normal", lineHeight: 20 }
        ));
        this.addChild(legend);
        this.resize(340, 560);
    }

    /** Sets the panel size; rows stretch to the width, legend sits at the bottom. */
    resize(width: number, height: number) {
        this.panelWidth = width;
        this.background
            .removeChildren()
            .forEach((c) => c.destroy({ children: true }));
        this.background.addChild(panel(width, height));
        this.legend.position.set(20, height - 80);
        if (this.last) this.render(...this.last);
    }

    render(state: GameState, activeId: PlayerId | null) {
        this.last = [state, activeId];
        this.round.text = `Round ${Math.max(1, state.round)} / ${
            state.config.rounds
        }`;
        this.rows
            .removeChildren()
            .forEach((c) => c.destroy({ children: true }));

        state.players.forEach((p, i) => {
            const owned = territoriesOf(state.territories, p.id);
            const capital = owned.find((t) => t.isCapital);
            const row = new PIXI.Container();
            row.position.set(12, i * 78);

            const active = p.id === activeId && !p.eliminated;
            row.addChild(
                new PIXI.Graphics()
                    .roundRect(0, 0, this.panelWidth - 24, 68, 10)
                    .fill({ color: active ? 0x2c3a55 : 0x232b3c })
                    .stroke({
                        width: active ? 3 : 1,
                        color: active ? COLORS.highlight : COLORS.panelBorder,
                    })
            );
            row.addChild(
                new PIXI.Graphics()
                    .circle(26, 34, 13)
                    .fill(this.colors[p.id])
                    .stroke({ width: 2, color: 0xffffff })
            );

            const name = label(
                `${p.name}${p.kind === "bot" ? " 🤖" : ""}`,
                20,
                p.eliminated ? COLORS.mutedText : COLORS.text
            );
            name.position.set(50, 10);
            const detail = label(
                p.eliminated
                    ? "Eliminated"
                    : `${owned.length} region${
                          owned.length === 1 ? "" : "s"
                      }  ·  Capital ${"♥".repeat(capital?.hp ?? 0)}`,
                15,
                p.eliminated ? COLORS.wrong : COLORS.mutedText,
                { fontWeight: "normal" }
            );
            detail.position.set(50, 38);
            row.addChild(name, detail);
            row.alpha = p.eliminated ? 0.6 : 1;
            this.rows.addChild(row);
        });
    }
}
