import { describe, expect, it } from "@jest/globals";

import { ALL_POWER_UPS, Difficulty, POWER_UP_KINDS } from "@conquiztador/core";

import {
    DEFAULT_LOBBY,
    isPresetRounds,
    parseRounds,
    powerUpProblem,
    sanitizeLobby,
    sanitizePowerUps,
    toggleKind,
    withMode,
} from "./matchSettings";

describe("parseRounds", () => {
    it("accepts whole numbers from 1 to 15", () => {
        expect(parseRounds("1")).toBe(1);
        expect(parseRounds(" 9 ")).toBe(9);
        expect(parseRounds("15")).toBe(15);
    });

    it("rejects anything else", () => {
        for (const text of ["", "0", "16", "-3", "2.5", "1e1", "abc", "5x"])
            expect(parseRounds(text)).toBeNull();
    });
});

describe("isPresetRounds", () => {
    it("knows the presets", () => {
        expect([3, 5, 7].every(isPresetRounds)).toBe(true);
        expect(isPresetRounds(4)).toBe(false);
    });
});

describe("power-up settings", () => {
    it("needs at least one kind unless power-ups are off", () => {
        expect(powerUpProblem({ mode: "oneEach", kinds: [] })).toBe("kinds");
        expect(powerUpProblem({ mode: "reward", kinds: ["scout"] })).toBeNull();
        expect(powerUpProblem({ mode: "none", kinds: [] })).toBeNull();
    });

    it("keeps kinds while off and restores all if none were chosen", () => {
        const off = withMode({ mode: "oneEach", kinds: ["scout"] }, "none");
        expect(off).toEqual({ mode: "none", kinds: ["scout"] });
        expect(withMode(off, "random")).toEqual({
            mode: "random",
            kinds: ["scout"],
        });
        expect(withMode({ mode: "none", kinds: [] }, "catchUp")).toEqual({
            mode: "catchUp",
            kinds: [...POWER_UP_KINDS],
        });
    });

    it("toggles kinds in canonical order", () => {
        const s = toggleKind({ mode: "oneEach", kinds: ["scout"] }, "fortify");
        expect(s.kinds).toEqual(["fortify", "scout"]);
        expect(toggleKind(s, "scout").kinds).toEqual(["fortify"]);
        expect(toggleKind(toggleKind(s, "scout"), "fortify").kinds).toEqual([]);
    });

    it("falls back to all power-ups for invalid stored values", () => {
        expect(sanitizePowerUps(undefined)).toEqual(ALL_POWER_UPS);
        expect(sanitizePowerUps({ mode: "bogus", kinds: [] })).toEqual(
            ALL_POWER_UPS
        );
        expect(sanitizePowerUps({ mode: "random", kinds: [] })).toEqual(
            ALL_POWER_UPS
        );
        expect(
            sanitizePowerUps({ mode: "reward", kinds: ["scout", "fiftyFifty"] })
        ).toEqual({ mode: "reward", kinds: ["fiftyFifty", "scout"] });
    });
});

describe("sanitizeLobby", () => {
    it("uses defaults for nothing stored", () => {
        expect(sanitizeLobby(null)).toEqual(DEFAULT_LOBBY);
        expect(sanitizeLobby("garbage")).toEqual(DEFAULT_LOBBY);
    });

    it("keeps old saved settings and adds power-ups", () => {
        expect(
            sanitizeLobby({
                opponents: 3,
                difficulty: Difficulty.Hard,
                rounds: 7,
                placement: "random",
            })
        ).toEqual({
            opponents: 3,
            difficulty: Difficulty.Hard,
            rounds: 7,
            placement: "random",
            powerUps: ALL_POWER_UPS,
        });
    });

    it("replaces invalid fields only", () => {
        const s = sanitizeLobby({
            opponents: 9,
            difficulty: "SUPER",
            rounds: 40,
            placement: "draft",
            powerUps: { mode: "none", kinds: [] },
        });
        expect(s).toEqual({
            ...DEFAULT_LOBBY,
            powerUps: { mode: "none", kinds: [] },
        });
    });

    it("keeps custom round counts", () => {
        expect(sanitizeLobby({ rounds: 12 }).rounds).toBe(12);
    });
});
