import { describe, it, expect } from "@jest/globals";

import { BULGARIA, POWER_UP_KINDS, POWER_UP_MODES } from "@conquiztador/core";

import { bg } from "./bg";
import { en } from "./en";

const BOT_NAMES = ["Asparuh", "Krum", "Simeon", "Samuil"];

describe.each([
    ["en", en],
    ["bg", bg],
])("%s messages", (_, messages) => {
    it("name every region on the map", () => {
        for (const id of Object.keys(BULGARIA.regions)) {
            expect(messages.regions[id]).toBeTruthy();
        }
    });

    it("name every bot", () => {
        for (const name of BOT_NAMES) {
            expect(messages.players.bots[name]).toBeTruthy();
        }
    });
});

/** Every key path in a dictionary ("powerUps.names.scout"…). */
function keyPaths(value: unknown, prefix = ""): string[] {
    if (!value || typeof value !== "object") return [prefix];
    return Object.entries(value).flatMap(([k, v]) =>
        keyPaths(v, prefix ? `${prefix}.${k}` : k)
    );
}

describe("language parity", () => {
    it("has the same keys in every language", () => {
        // Region and bot names are checked against the map above.
        const skip = (p: string) =>
            p.startsWith("regions.") || p.startsWith("players.bots.");
        expect(
            keyPaths(bg)
                .filter((p) => !skip(p))
                .sort()
        ).toEqual(
            keyPaths(en)
                .filter((p) => !skip(p))
                .sort()
        );
    });

    it.each([
        ["en", en],
        ["bg", bg],
    ])("%s names every power-up and supply mode", (_, messages) => {
        for (const kind of POWER_UP_KINDS) {
            expect(messages.powerUps.names[kind]).toBeTruthy();
            expect(messages.powerUps.aName[kind]).toBeTruthy();
            expect(messages.powerUps.descriptions[kind]).toBeTruthy();
        }
        for (const mode of POWER_UP_MODES) {
            expect(messages.powerUps.modes[mode]).toBeTruthy();
            expect(messages.powerUps.modeHints[mode]).toBeTruthy();
        }
    });
});

describe("bg grammar helpers", () => {
    it("conjugates power-up news for the player vs. others", () => {
        expect(bg.powerUps.used({ name: "Ти", you: true }, "50/50")).toBe(
            "Използваш „50/50“"
        );
        expect(
            bg.powerUps.earned(
                { name: "Крум", you: false },
                bg.powerUps.aName.scout
            )
        ).toBe("Крум печели „Разузнаване“");
        expect(
            en.powerUps.earned(
                { name: "Ivan", you: false },
                en.powerUps.aName.scout
            )
        ).toBe("Ivan earned a Scout");
    });

    it("uses the count form for shields", () => {
        expect(bg.status.capitalHit(1)).toBe("Удар по столицата! Остава 1 щит");
        expect(bg.status.capitalHit(2)).toBe(
            "Удар по столицата! Остават 2 щита"
        );
    });

    it("conjugates for the player vs. others", () => {
        const region = bg.regions.plovdiv;
        expect(bg.status.conquers({ name: "Ти", you: true }, region)).toBe(
            "Превземаш Пловдив!"
        );
        expect(bg.status.conquers({ name: "Крум", you: false }, region)).toBe(
            "Крум превзема Пловдив!"
        );
    });
});
