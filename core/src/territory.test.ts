import { describe, it, expect } from "@jest/globals";

import { BULGARIA } from "./maps/bulgaria";
import { attackableTargets, capitalCandidates, isAttackable, territoriesOf } from "./territory";
import { STANDARD_HP, Territory } from "./types";

function blank(): Record<string, Territory> {
    const owner: string | null = null;
    return Object.fromEntries(
        Object.keys(BULGARIA.regions).map((id) => [
            id,
            { regionId: id, ownerId: owner, hp: STANDARD_HP, isCapital: false, walled: false },
        ])
    );
}

describe("territory helpers", () => {
    const ids = Object.keys(BULGARIA.regions);

    it("territoriesOf returns only that player's land", () => {
        const t = blank();
        t[ids[0]].ownerId = "a";
        t[ids[1]].ownerId = "b";
        expect(territoriesOf(t, "a").map((x) => x.regionId)).toEqual([ids[0]]);
        expect(territoriesOf(t, "c")).toEqual([]);
    });

    it("attackableTargets are the unowned-by-me neighbours of my land", () => {
        const t = blank();
        const home = ids[0];
        t[home].ownerId = "a";
        const state = { map: BULGARIA, territories: t };
        const targets = attackableTargets(state, "a");
        expect(new Set(targets)).toEqual(new Set(BULGARIA.regions[home].neighbors));
        expect(targets).not.toContain(home);
    });

    it("attackableTargets has no duplicates and excludes own land", () => {
        const t = blank();
        const home = ids[0];
        const [n1] = BULGARIA.regions[home].neighbors;
        t[home].ownerId = "a";
        t[n1].ownerId = "a";
        const targets = attackableTargets({ map: BULGARIA, territories: t }, "a");
        expect(new Set(targets).size).toBe(targets.length);
        expect(targets).not.toContain(home);
        expect(targets).not.toContain(n1);
    });

    it("a player with no land has no targets, and isAttackable agrees", () => {
        const state = { map: BULGARIA, territories: blank() };
        expect(attackableTargets(state, "a")).toEqual([]);
        expect(isAttackable(state, "a", ids[0])).toBe(false);
    });

    it("isAttackable is true for neighbours of my land only", () => {
        const t = blank();
        const home = ids[0];
        t[home].ownerId = "a";
        const state = { map: BULGARIA, territories: t };
        const [n] = BULGARIA.regions[home].neighbors;
        expect(isAttackable(state, "a", n)).toBe(true);
        expect(isAttackable(state, "a", home)).toBe(false);
    });

    it("capitalCandidates offers every region on an empty map", () => {
        expect(capitalCandidates({ map: BULGARIA, territories: blank() }).sort()).toEqual([...ids].sort());
    });

    it("capitalCandidates excludes owned regions and neighbours of capitals", () => {
        const t = blank();
        const cap = ids[0];
        t[cap].ownerId = "a";
        t[cap].isCapital = true;
        const c = capitalCandidates({ map: BULGARIA, territories: t });
        expect(c).not.toContain(cap);
        for (const n of BULGARIA.regions[cap].neighbors) expect(c).not.toContain(n);
        expect(c.length).toBeGreaterThan(0);
    });

    it("capitalCandidates falls back to free regions when spacing leaves none", () => {
        const t = blank();
        // Everything free borders a capital: make one capital and own all non-neighbours.
        const cap = ids[0];
        t[cap].ownerId = "a";
        t[cap].isCapital = true;
        const near = new Set(BULGARIA.regions[cap].neighbors);
        for (const id of ids) if (id !== cap && !near.has(id)) t[id].ownerId = "b";
        const c = capitalCandidates({ map: BULGARIA, territories: t });
        expect(new Set(c)).toEqual(near);
    });
});
