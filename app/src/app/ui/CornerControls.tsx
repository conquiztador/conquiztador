import { FullscreenButton } from "./FullscreenButton";
import { LanguageButton } from "./LanguageButton";
import { MuteButton } from "./MuteButton";

/** Always-visible buttons pinned to the window's top-right corner. */
export function CornerControls() {
    return (
        <div className="corner-controls">
            <LanguageButton />
            <FullscreenButton />
            <MuteButton />
        </div>
    );
}
