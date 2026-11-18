import { describe, expect, it } from "@jest/globals";

import {
    emptyInventory,
    POWER_UP_KINDS,
    PowerUpInventory,
    PowerUpKind,
} from "@conquiztador/core";

import {
    applyEffect,
    canUsePowerUp,
    NO_AIDS,
    PowerUpCheck,
    PowerUpMoment,
    QuestionAids,
    totalCharges,
} from "./powerUpRules";

const ONE_EACH: PowerUpInventory = {
    fiftyFifty: 1,
    rangeFinder: 1,
    fortify: 1,
    extraTime: 1,
    scout: 1,
};

function usable(
    moment: PowerUpMoment,
    charges: PowerUpInventory | undefined = ONE_EACH,
    pending = false
): PowerUpKind[] {
    const check: PowerUpCheck = { charges, moment, pending };
    return POWER_UP_KINDS.filter((k) => canUsePowerUp(k, check));
}

const target = (fortifiable = 3, scouted = false): PowerUpMoment => ({
    kind: "target",
    fortifiable,
    scouted,
});
const mcq = (
    aids: QuestionAids = NO_AIDS,
    answering = true
): PowerUpMoment => ({
    kind: "mcq",
    answering,
    aids,
});
const numeric = (
    aids: QuestionAids = NO_AIDS,
    answering = true
): PowerUpMoment => ({ kind: "numeric", answering, aids });

describe("canUsePowerUp", () => {
    it("allows nothing outside your turn and your questions", () => {
        expect(usable({ kind: "none" })).toEqual([]);
    });

    it("allows fortify and scout while you choose a target", () => {
        expect(usable(target())).toEqual(["fortify", "scout"]);
    });

    it("needs a region that can take a wall to fortify", () => {
        expect(usable(target(0))).toEqual(["scout"]);
    });

    it("allows scout once per turn", () => {
        expect(usable(target(3, true))).toEqual(["fortify"]);
    });

    it("allows 50/50 and extra time while answering multiple choice", () => {
        expect(usable(mcq())).toEqual(["fiftyFifty", "extraTime"]);
    });

    it("allows range finder and extra time while answering the tie-breaker", () => {
        expect(usable(numeric())).toEqual(["rangeFinder", "extraTime"]);
    });

    it("allows nothing once you answered or your time ran out", () => {
        expect(usable(mcq(NO_AIDS, false))).toEqual([]);
        expect(usable(numeric(NO_AIDS, false))).toEqual([]);
    });

    it("allows each question aid once per question", () => {
        expect(usable(mcq({ ...NO_AIDS, removed: [0, 2] }))).toEqual([
            "extraTime",
        ]);
        expect(usable(mcq({ ...NO_AIDS, bonusMs: 5000 }))).toEqual([
            "fiftyFifty",
        ]);
        expect(
            usable(numeric({ ...NO_AIDS, range: { min: 1, max: 5 } }))
        ).toEqual(["extraTime"]);
        expect(usable(numeric({ ...NO_AIDS, bonusMs: 5000 }))).toEqual([
            "rangeFinder",
        ]);
    });

    it("needs a charge", () => {
        expect(usable(target(), emptyInventory())).toEqual([]);
        expect(usable(mcq(), { ...ONE_EACH, fiftyFifty: 0 })).toEqual([
            "extraTime",
        ]);
        expect(
            canUsePowerUp("fiftyFifty", {
                charges: undefined,
                moment: mcq(),
                pending: false,
            })
        ).toBe(false);
    });

    it("blocks every use while one waits for the server", () => {
        expect(usable(target(), ONE_EACH, true)).toEqual([]);
        expect(usable(mcq(), ONE_EACH, true)).toEqual([]);
    });
});

describe("applyEffect", () => {
    it("hides the options 50/50 removed, once", () => {
        const once = applyEffect(
            NO_AIDS,
            { kind: "fiftyFifty", removed: [3, 1] },
            "mcq"
        );
        expect(once.removed).toEqual([1, 3]);
        const twice = applyEffect(
            once,
            { kind: "fiftyFifty", removed: [1, 3] },
            "mcq"
        );
        expect(twice).toBe(once);
    });

    it("keeps the range finder bracket, once", () => {
        const effect = { kind: "rangeFinder", min: 90, max: 140 } as const;
        const once = applyEffect(NO_AIDS, effect, "numeric");
        expect(once.range).toEqual({ min: 90, max: 140 });
        expect(applyEffect(once, effect, "numeric")).toBe(once);
    });

    it("adds extra time only once when the effect is re-sent", () => {
        const effect = { kind: "extraTime", bonusMs: 5000 } as const;
        const once = applyEffect(NO_AIDS, effect, "mcq");
        expect(once.bonusMs).toBe(5000);
        const again = applyEffect(once, effect, "mcq");
        expect(again).toBe(once);
        expect(again.bonusMs).toBe(5000);
    });

    it("ignores effects that don't fit the question on screen", () => {
        expect(
            applyEffect(
                NO_AIDS,
                { kind: "fiftyFifty", removed: [0] },
                "numeric"
            )
        ).toBe(NO_AIDS);
        expect(
            applyEffect(NO_AIDS, { kind: "rangeFinder", min: 1, max: 5 }, "mcq")
        ).toBe(NO_AIDS);
        expect(
            applyEffect(NO_AIDS, { kind: "scout", category: "History" }, "mcq")
        ).toBe(NO_AIDS);
        expect(
            applyEffect(
                NO_AIDS,
                { kind: "fortify", regionId: "sofia-city" },
                "mcq"
            )
        ).toBe(NO_AIDS);
    });
});

describe("totalCharges", () => {
    it("adds up every kind", () => {
        expect(totalCharges(ONE_EACH)).toBe(5);
        expect(totalCharges(undefined)).toBe(0);
    });
});
