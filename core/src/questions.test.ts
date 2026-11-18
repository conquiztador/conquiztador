import { describe, it, expect } from "@jest/globals";

import { DeckQuestionProvider, QuestionDeck } from "./questions";
import { createSeededRng } from "./rng";

const DECK: QuestionDeck = {
    mcq: Array.from({ length: 4 }, (_, i) => ({
        id: `m${i}`,
        text: `Q${i}`,
        options: ["right", "w1", "w2", "w3"],
        correctIndex: 0,
    })),
    numeric: [
        { id: "n0", text: "N0", correctValue: 1 },
        { id: "n1", text: "N1", correctValue: 2 },
    ],
};

describe("DeckQuestionProvider", () => {
    it("serves every question once before repeating", () => {
        const p = new DeckQuestionProvider(DECK, createSeededRng(1));
        const ids = Array.from({ length: 4 }, () => p.nextMcq().id);
        expect(new Set(ids).size).toBe(4);
        const numeric = Array.from({ length: 2 }, () => p.nextNumeric().id);
        expect(new Set(numeric).size).toBe(2);
    });

    it("reshuffles when the deck runs out instead of failing", () => {
        const p = new DeckQuestionProvider(DECK, createSeededRng(2));
        for (let i = 0; i < 10; i++) expect(p.nextMcq().text).toMatch(/^Q\d$/);
        for (let i = 0; i < 5; i++) expect(p.nextNumeric().correctValue).toBeGreaterThan(0);
    });

    it("keeps correctIndex pointing at the right option after shuffling", () => {
        const p = new DeckQuestionProvider(DECK, createSeededRng(3));
        const positions = new Set<number>();
        for (let i = 0; i < 40; i++) {
            const q = p.nextMcq();
            expect(q.options[q.correctIndex]).toBe("right");
            expect([...q.options].sort()).toEqual(["right", "w1", "w2", "w3"]);
            positions.add(q.correctIndex);
        }
        expect(positions.size).toBeGreaterThan(1);
    });

    it("does not mutate the source deck", () => {
        const before = JSON.stringify(DECK);
        const p = new DeckQuestionProvider(DECK, createSeededRng(4));
        for (let i = 0; i < 10; i++) p.nextMcq();
        expect(JSON.stringify(DECK)).toBe(before);
    });
});
