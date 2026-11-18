import { describe, it, expect } from "@jest/globals";

import { BULGARIA } from "@conquiztador/core";

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

describe("bg grammar helpers", () => {
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
