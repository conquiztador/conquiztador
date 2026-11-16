import * as PIXI from "pixi.js";

import { GameState, PlayerId, RegionId } from "app/core/types";
import {
    BULGARIA_SHAPES,
    BULGARIA_SHAPE_SIZE,
} from "app/core/maps/bulgariaShapes";

import { COLORS, easeOutBack, label, tween } from "../ui";

export const MapEvent = {
    regionSelected: "regionSelected",
} as const;

interface RegionView {
    id: RegionId;
    shape: PIXI.Graphics;
    points: number[];
    centroid: PIXI.Point;
    name: PIXI.Text;
    badge: PIXI.Container;
}

type MapState = Pick<GameState, "territories" | "players" | "map">;

function centroid(points: number[]): PIXI.Point {
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < points.length; i += 2) {
        const x0 = points[i];
        const y0 = points[i + 1];
        const x1 = points[(i + 2) % points.length];
        const y1 = points[(i + 3) % points.length];
        const cross = x0 * y1 - x1 * y0;
        area += cross;
        cx += (x0 + x1) * cross;
        cy += (y0 + y1) * cross;
    }
    area /= 2;
    return new PIXI.Point(cx / (6 * area), cy / (6 * area));
}

function lighten(color: number, amount: number): number {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    const f = (c: number) => Math.round(c + (255 - c) * amount);
    return (f(r) << 16) | (f(g) << 8) | f(b);
}

/** Small nudges so labels don't overlap in the crowded south-west. */
const LABEL_OFFSETS: Record<RegionId, [number, number]> = {
    "sofia-city": [0, 0],
    "sofia-province": [10, 22],
    pernik: [-4, 4],
};

/**
 * Renders the territory map. Emits `MapEvent.regionSelected` with the
 * region id when a selectable region is clicked.
 */
export class MapView extends PIXI.Container {
    private regions = new Map<RegionId, RegionView>();
    private selectable = new Set<RegionId>();
    private hovered: RegionId | null = null;
    private focus: RegionId | null = null;
    private state: MapState | null = null;
    private colors: Record<PlayerId, number> = {};
    private pulse = 0;
    private highlightLayer = new PIXI.Graphics();
    private effectLayer = new PIXI.Container();
    private labelScale = 1;

    constructor(private ticker: PIXI.Ticker, public readonly mapScale = 1) {
        super();
        const shapeLayer = new PIXI.Container();
        const labelLayer = new PIXI.Container();
        this.addChild(
            shapeLayer,
            this.effectLayer,
            this.highlightLayer,
            labelLayer
        );

        for (const [id, raw] of Object.entries(BULGARIA_SHAPES)) {
            const points = raw.map((v) => v * mapScale);
            const shape = new PIXI.Graphics();
            shape.eventMode = "static";
            shape.hitArea = new PIXI.Polygon(points);
            shape.on("pointerover", () => this.setHovered(id));
            shape.on("pointerout", () => this.setHovered(null));
            shape.on("pointertap", () => {
                if (this.selectable.has(id)) {
                    this.emit(MapEvent.regionSelected, id);
                }
            });
            shapeLayer.addChild(shape);

            const c = centroid(points);
            const [ox, oy] = LABEL_OFFSETS[id] ?? [0, 0];
            c.set(c.x + ox, c.y + oy);

            const name = label("", 11, COLORS.text, {
                stroke: { color: 0x000000, width: 3 },
            });
            name.anchor.set(0.5, 0);
            name.position.set(c.x, c.y + 8);

            const badge = new PIXI.Container();
            badge.position.copyFrom(c);
            labelLayer.addChild(name, badge);

            this.regions.set(id, {
                id,
                shape,
                points,
                centroid: c,
                name,
                badge,
            });
        }

        this.ticker.add(this.animate, this);
    }

    get mapWidth() {
        return BULGARIA_SHAPE_SIZE.width * this.mapScale;
    }

    get mapHeight() {
        return BULGARIA_SHAPE_SIZE.height * this.mapScale;
    }

    regionCenter(id: RegionId): PIXI.Point {
        return this.regions.get(id).centroid.clone();
    }

    setPlayerColors(colors: Record<PlayerId, number>) {
        this.colors = colors;
    }

    /** Re-renders ownership, capitals and walls from game state. */
    render(state: MapState) {
        this.state = state;
        for (const view of this.regions.values()) {
            this.drawRegion(view);
            this.drawBadge(view);
            view.name.text = state.map.regions[view.id].name;
        }
    }

    setSelectable(ids: RegionId[]) {
        this.selectable = new Set(ids);
        for (const view of this.regions.values()) {
            view.shape.cursor = this.selectable.has(view.id)
                ? "pointer"
                : "default";
        }
        this.redrawAll();
    }

    /**
     * Animates a region being claimed: the new colour floods outward from the
     * region's centre with a shockwave ring, then `apply` swaps in the real
     * state (in the same frame, so nothing flickers) and the badge pops in.
     */
    async claim(id: RegionId, color: number, apply: () => void) {
        const view = this.regions.get(id);
        const { x, y } = view.centroid;
        let radius = 0;
        for (let i = 0; i < view.points.length; i += 2)
            radius = Math.max(
                radius,
                Math.hypot(view.points[i] - x, view.points[i + 1] - y)
            );
        radius += 4;

        const fill = new PIXI.Graphics()
            .poly(view.points)
            .fill({ color })
            .stroke({ width: 1.5, color: 0x1a1a1a, alpha: 0.9 });
        const mask = new PIXI.Graphics();
        fill.mask = mask;
        const ring = new PIXI.Graphics();
        this.effectLayer.addChild(fill, mask, ring);

        await tween(this.ticker, 700, (t) => {
            const eased = 1 - (1 - t) ** 3;
            mask.clear()
                .circle(x, y, radius * eased)
                .fill(0xffffff);
            ring.clear()
                .circle(x, y, radius * (0.3 + 1.1 * eased))
                .stroke({ width: 4, color: lighten(color, 0.5), alpha: 1 - t });
        });

        apply();
        fill.destroy();
        mask.destroy();
        ring.destroy();

        view.badge.scale.set(0);
        await tween(this.ticker, 350, (t) =>
            view.badge.scale.set(easeOutBack(t) * this.labelScale)
        );
    }

    /**
     * Scales region names and badges (around their anchor points) so they
     * stay legible when the map itself is drawn small.
     */
    setLabelScale(scale: number) {
        this.labelScale = scale;
        for (const view of this.regions.values()) {
            view.name.scale.set(scale);
            view.badge.scale.set(scale);
            view.name.position.set(
                view.centroid.x,
                view.centroid.y + 8 * scale
            );
        }
    }

    setFocus(id: RegionId | null) {
        this.focus = id;
    }

    private setHovered(id: RegionId | null) {
        const previous = this.hovered;
        this.hovered = id;
        for (const r of [previous, id]) {
            if (r && this.regions.has(r)) this.drawRegion(this.regions.get(r));
        }
    }

    private redrawAll() {
        if (!this.state) return;
        for (const view of this.regions.values()) this.drawRegion(view);
    }

    private ownerColor(id: RegionId): number {
        const owner = this.state?.territories[id].ownerId;
        return owner ? this.colors[owner] ?? COLORS.neutral : COLORS.neutral;
    }

    private drawRegion(view: RegionView) {
        if (!this.state) return;
        let color = this.ownerColor(view.id);
        const isSelectable = this.selectable.has(view.id);
        if (isSelectable && this.hovered === view.id)
            color = lighten(color, 0.35);

        view.shape
            .clear()
            .poly(view.points)
            .fill({
                color,
                alpha: this.selectable.size && !isSelectable ? 0.55 : 1,
            })
            .stroke({ width: 1.5, color: 0x1a1a1a, alpha: 0.9 });
    }

    private drawBadge(view: RegionView) {
        view.badge.removeChildren().forEach((c) => c.destroy());
        const t = this.state.territories[view.id];

        if (t.isCapital) {
            const castle = new PIXI.Graphics()
                // simple castle silhouette
                .rect(-9, -6, 18, 10)
                .rect(-9, -10, 4, 4)
                .rect(-2, -10, 4, 4)
                .rect(5, -10, 4, 4)
                .fill(COLORS.gold)
                .stroke({ width: 1.5, color: 0x000000 });
            castle.position.set(0, -6);
            view.badge.addChild(castle);

            // HP pips
            for (let i = 0; i < 3; i++) {
                const pip = new PIXI.Graphics()
                    .circle(0, 0, 3.5)
                    .fill(i < t.hp ? COLORS.wrong : 0x333333)
                    .stroke({ width: 1, color: 0xffffff });
                pip.position.set(-9 + i * 9, 3);
                view.badge.addChild(pip);
            }
        }

        if (t.walled) {
            const wall = new PIXI.Graphics()
                .roundRect(-12, -22, 24, 7, 2)
                .fill(0xb5651d)
                .stroke({ width: 1, color: 0x000000 });
            view.badge.addChild(wall);
        }
    }

    private animate(ticker: PIXI.Ticker) {
        this.pulse += ticker.deltaMS / 1000;
        const g = this.highlightLayer.clear();
        const alpha = 0.55 + 0.45 * Math.sin(this.pulse * 5);

        for (const id of this.selectable) {
            g.poly(this.regions.get(id).points).stroke({
                width: 3,
                color: COLORS.highlight,
                alpha,
            });
        }
        if (this.focus) {
            g.poly(this.regions.get(this.focus).points).stroke({
                width: 4,
                color: 0xffffff,
                alpha: 0.6 + 0.4 * Math.sin(this.pulse * 8),
            });
        }
    }

    destroy(options?: PIXI.DestroyOptions) {
        this.ticker.remove(this.animate, this);
        super.destroy(options);
    }
}
