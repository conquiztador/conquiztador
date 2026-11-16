import type { Messages } from "app/i18n";
import { createStore } from "app/ui/store";

export interface HudPlayer {
    id: string;
    name: string;
    color: number;
    isBot: boolean;
    regions: number;
    capitalHp: number;
    eliminated: boolean;
    active: boolean;
}

/**
 * Where the HUD goes, in window CSS pixels.
 * - side: a column on the right `width` px wide (landscape).
 * - top: a bar across the top `barHeight` px tall, with the player grid
 *   starting at `playersTop` under the map (portrait).
 */
export type HudLayout =
    | { kind: "side"; width: number }
    | { kind: "top"; barHeight: number; playersTop: number };

export interface MatchHudState {
    visible: boolean;
    round: number;
    rounds: number;
    /** Status line, rendered in the current language. */
    message: (m: Messages) => string;
    players: HudPlayer[];
    layout: HudLayout;
    onQuit: () => void;
}

export const matchHud = createStore<MatchHudState>({
    visible: false,
    round: 1,
    rounds: 1,
    message: () => "",
    players: [],
    layout: { kind: "side", width: 240 },
    onQuit: () => undefined,
});

/** Sizes shared by the HUD view and the map layout. */
export const HUD = {
    margin: 8,
    sideMin: 240,
    sideMax: 300,
    barHeight: 80,
    /** Height of one row in the portrait player grid. */
    playerRow: 46,
};
