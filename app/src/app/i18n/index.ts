import { useSyncExternalStore } from "react";

import { bg } from "./bg";
import { en, Messages, Who } from "./en";

export type { Messages, Who };
export type Language = "en" | "bg";
export const LANGUAGES: Language[] = ["en", "bg"];

const DICTIONARIES: Record<Language, Messages> = { en, bg };
const LOCALES: Record<Language, string> = { en: "en-US", bg: "bg-BG" };
const STORAGE_KEY = "conquiztador.language";
const HUMAN_ID = "you";

let current: Language = initialLanguage();
const listeners = new Set<(language: Language) => void>();
applyToDocument();

/** Saved choice, else the browser's preferred language, else English. */
function initialLanguage(): Language {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && (LANGUAGES as string[]).includes(saved))
            return saved as Language;
    } catch {
        // Storage unavailable: fall through to detection.
    }
    const preferred =
        typeof navigator !== "undefined" ? navigator.languages ?? [] : [];
    return preferred.some((l) => l.toLowerCase().startsWith("bg"))
        ? "bg"
        : "en";
}

function applyToDocument() {
    if (typeof document === "undefined") return;
    document.documentElement.lang = current;
    document.title = DICTIONARIES[current].menu.title;
}

export function language(): Language {
    return current;
}

/** Messages in the current language. Read at render time, not cached. */
export function t(): Messages {
    return DICTIONARIES[current];
}

export function setLanguage(next: Language): void {
    if (next === current) return;
    current = next;
    try {
        localStorage.setItem(STORAGE_KEY, next);
    } catch {
        // Keep the in-memory choice only.
    }
    applyToDocument();
    listeners.forEach((fn) => fn(next));
}

export function nextLanguage(): Language {
    return LANGUAGES[(LANGUAGES.indexOf(current) + 1) % LANGUAGES.length];
}

export function onLanguageChange(fn: (language: Language) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** React: messages for the current language; re-renders when it changes. */
export function useMessages(): Messages {
    const lang = useSyncExternalStore(onLanguageChange, language);
    return DICTIONARIES[lang];
}

/** Locale-aware number, e.g. 384400 → "384,400" (en) / "384 400" (bg). */
export function formatNumber(n: number, options?: Intl.NumberFormatOptions) {
    return n.toLocaleString(LOCALES[current], options);
}

/** Display name for a player: "You"/"Ти" for the human, localized bots. */
export function playerName(player: { id: string; name: string }): string {
    const m = t().players;
    if (player.id === HUMAN_ID) return m.you;
    return m.bots[player.name] ?? player.name;
}

export function who(player: { id: string; name: string }): Who {
    return { name: playerName(player), you: player.id === HUMAN_ID };
}

export function regionName(id: string): string {
    return t().regions[id] ?? id;
}
