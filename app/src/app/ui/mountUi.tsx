import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { BattleOverlayView } from "app/game/components/BattleOverlayView";
import { MatchHudView } from "app/game/components/MatchHudView";
import { PowerUpToast } from "app/game/components/PowerUpBar";
import { MultiplayerView } from "app/multiplayer/MultiplayerView";
import { LobbyView } from "app/settings/LobbyView";
import { CornerControls } from "./CornerControls";

/**
 * Renders the React UI: design-space UI (scaled with the stage) into
 * `designRoot`, and readable real-pixel UI into `screenRoot`.
 */
export function mountUi(
    designRoot: HTMLElement,
    screenRoot: HTMLElement
): void {
    createRoot(designRoot).render(
        <StrictMode>
            <BattleOverlayView />
        </StrictMode>
    );
    createRoot(screenRoot).render(
        <StrictMode>
            <MatchHudView />
            <PowerUpToast />
            <LobbyView />
            <MultiplayerView />
            <CornerControls />
        </StrictMode>
    );
}
