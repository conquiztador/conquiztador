import { useSyncExternalStore } from "react";

/** Minimal external store: imperative game code writes, React reads. */
export function createStore<T>(initial: T) {
    let state = initial;
    const listeners = new Set<() => void>();
    const subscribe = (fn: () => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
    };
    return {
        get: () => state,
        set(patch: T | ((prev: T) => T)) {
            state =
                typeof patch === "function"
                    ? (patch as (prev: T) => T)(state)
                    : patch;
            listeners.forEach((fn) => fn());
        },
        use: () => useSyncExternalStore(subscribe, () => state),
    };
}

/** 0xrrggbb → "#rrggbb" for sharing the Pixi palette with CSS. */
export const css = (color: number) => `#${color.toString(16).padStart(6, "0")}`;
