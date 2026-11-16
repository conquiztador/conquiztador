import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { BattleOverlayView } from "app/game/components/BattleOverlayView";
import { MuteButton } from "./MuteButton";

/** Renders the React UI layer into the design-area DOM root. */
export function mountUi(root: HTMLElement): void {
    createRoot(root).render(
        <StrictMode>
            <MuteButton />
            <BattleOverlayView />
        </StrictMode>
    );
}
