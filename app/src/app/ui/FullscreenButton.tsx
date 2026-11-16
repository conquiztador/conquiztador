import { useEffect, useSyncExternalStore } from "react";

import { useMessages } from "app/i18n";

const subscribe = (fn: () => void) => {
    document.addEventListener("fullscreenchange", fn);
    return () => document.removeEventListener("fullscreenchange", fn);
};
const isFullscreen = () => document.fullscreenElement !== null;

function toggleFullscreen() {
    if (document.fullscreenElement) {
        void document.exitFullscreen();
    } else {
        // Rejected if not triggered by a user gesture; nothing to do then.
        document.documentElement
            .requestFullscreen({ navigationUI: "hide" })
            .catch((): void => undefined);
    }
}

/**
 * Enter/exit fullscreen; "F" toggles it too. Hidden where the browser
 * doesn't allow page fullscreen (e.g. Safari on iPhone).
 */
export function FullscreenButton() {
    const fullscreen = useSyncExternalStore(subscribe, isFullscreen);
    const m = useMessages().controls;

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() !== "f") return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.target instanceof HTMLInputElement) return;
            toggleFullscreen();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    if (!document.fullscreenEnabled) return null;

    return (
        <button
            className="corner-button"
            title={`${fullscreen ? m.exitFullscreen : m.fullscreen} (F)`}
            aria-label={fullscreen ? m.exitFullscreen : m.fullscreen}
            onClick={toggleFullscreen}
        >
            <svg
                viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                {fullscreen ? (
                    // corners pointing inward
                    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                ) : (
                    // corners pointing outward
                    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
                )}
            </svg>
        </button>
    );
}
