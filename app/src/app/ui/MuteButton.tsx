import { useEffect, useSyncExternalStore } from "react";

import { isMuted, onMuteChange, setMuted } from "app/audio/sfx";

/** Speaker toggle in the corner controls; "M" toggles it too. */
export function MuteButton() {
    const muted = useSyncExternalStore(onMuteChange, isMuted);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() !== "m") return;
            if (e.target instanceof HTMLInputElement) return;
            setMuted(!isMuted());
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    return (
        <button
            className="corner-button"
            title={muted ? "Unmute (M)" : "Mute (M)"}
            aria-label={muted ? "Unmute" : "Mute"}
            onClick={() => setMuted(!muted)}
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
                <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
                {muted ? (
                    <path d="M17 9l5 6M22 9l-5 6" />
                ) : (
                    <>
                        <path d="M16.5 9.5a3.5 3.5 0 0 1 0 5" />
                        <path d="M19 7a7 7 0 0 1 0 10" />
                    </>
                )}
            </svg>
        </button>
    );
}
