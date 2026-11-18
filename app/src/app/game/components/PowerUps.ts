import type { PowerUpInventory, PowerUpKind } from "@conquiztador/core";
import type { Messages } from "app/i18n";
import { createStore } from "app/ui/store";

/**
 * Power-up state for the HUD bar, the battle aid buttons and the toast.
 * The match screen writes it; the views compute which buttons are enabled
 * with `canUsePowerUp` (powerUpRules.ts).
 */
export interface PowerUpViewState {
    /** Kinds in play this match (empty: power-ups are off). */
    enabled: PowerUpKind[];
    /** The local player's charges (null when not playing, e.g. spectating). */
    charges: PowerUpInventory | null;
    /** Set while you hold the target prompt. */
    target: { fortifiable: number; scouted: boolean } | null;
    /** Choosing a region to fortify on the map. */
    fortifying: boolean;
    /** A use is waiting for the server's answer. */
    pending: PowerUpKind | null;
    /** What Scout revealed, shown until the battle starts. */
    scouted: { category: string | null } | null;
    onUse: (kind: PowerUpKind) => void;
}

export const powerUpStore = createStore<PowerUpViewState>({
    enabled: [],
    charges: null,
    target: null,
    fortifying: false,
    pending: null,
    scouted: null,
    onUse: () => undefined,
});

/** A short message over the match ("Krum used 50/50"). */
export const toastStore = createStore<{
    text: ((m: Messages) => string) | null;
    /** Bumped per toast so the view replays its entry animation. */
    id: number;
}>({ text: null, id: 0 });

const TOAST_MS = 2600;

export function showToast(text: (m: Messages) => string) {
    const id = toastStore.get().id + 1;
    toastStore.set({ text, id });
    setTimeout(() => {
        if (toastStore.get().id === id) toastStore.set({ text: null, id });
    }, TOAST_MS);
}

export function clearToast() {
    toastStore.set((s) => ({ text: null, id: s.id + 1 }));
}
