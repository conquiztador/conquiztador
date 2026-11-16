import { language, nextLanguage, setLanguage, useMessages } from "app/i18n";

/**
 * Shows the current language code; tapping switches to the next language.
 * Text updates live everywhere, including mid-match. A running match keeps
 * its question deck; the next match loads questions in the new language.
 */
export function LanguageButton() {
    const m = useMessages();
    return (
        <button
            className="corner-button language-button"
            title={m.switchLanguage}
            aria-label={m.switchLanguage}
            onClick={() => setLanguage(nextLanguage())}
        >
            {language().toUpperCase()}
        </button>
    );
}
