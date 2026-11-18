import { describe, it, expect } from "@jest/globals";

import { createSeededRng, gaussian, pick, randomInt, shuffle } from "./rng";

describe("rng", () => {
    it("seeded rng is deterministic and within [0, 1)", () => {
        const a = createSeededRng(7);
        const b = createSeededRng(7);
        for (let i = 0; i < 100; i++) {
            const v = a();
            expect(v).toBe(b());
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });

    it("different seeds give different sequences", () => {
        expect(createSeededRng(1)()).not.toBe(createSeededRng(2)());
    });

    it("randomInt covers the inclusive range and nothing outside it", () => {
        const rng = createSeededRng(3);
        const seen = new Set<number>();
        for (let i = 0; i < 500; i++) seen.add(randomInt(rng, 2, 5));
        expect([...seen].sort()).toEqual([2, 3, 4, 5]);
    });

    it("pick returns an element of the list", () => {
        const rng = createSeededRng(4);
        const items = ["a", "b", "c"];
        for (let i = 0; i < 50; i++) expect(items).toContain(pick(rng, items));
    });

    it("shuffle is a permutation and does not mutate its input", () => {
        const input = [1, 2, 3, 4, 5, 6];
        const out = shuffle(createSeededRng(5), input);
        expect(input).toEqual([1, 2, 3, 4, 5, 6]);
        expect([...out].sort()).toEqual(input);
    });

    it("gaussian has roughly zero mean and unit variance", () => {
        const rng = createSeededRng(6);
        const n = 5000;
        const xs = Array.from({ length: n }, () => gaussian(rng));
        const mean = xs.reduce((s, x) => s + x, 0) / n;
        const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
        expect(Math.abs(mean)).toBeLessThan(0.1);
        expect(Math.abs(variance - 1)).toBeLessThan(0.15);
        expect(xs.every(Number.isFinite)).toBe(true);
    });
});
