import { QuestionProvider } from "app/core/GameEngine";
import { Rng, shuffle } from "app/core/rng";
import { McqQuestion, NumericQuestion } from "app/core/types";

import { LOCAL_MCQ, LOCAL_NUMERIC } from "./localQuestions";

/**
 * Serves questions from the bundled set, shuffling options and avoiding
 * repeats until the deck runs out. Stand-in until the game talks to the
 * backend (which now supports numeric questions too).
 */
export class LocalQuestionProvider implements QuestionProvider {
    private mcqDeck: McqQuestion[] = [];
    private numericDeck: NumericQuestion[] = [];

    constructor(
        private readonly rng: Rng = Math.random,
        private readonly mcq: McqQuestion[] = LOCAL_MCQ,
        private readonly numeric: NumericQuestion[] = LOCAL_NUMERIC
    ) {}

    nextMcq(): McqQuestion {
        if (this.mcqDeck.length === 0)
            this.mcqDeck = shuffle(this.rng, this.mcq);
        const q = this.mcqDeck.pop();
        const order = shuffle(
            this.rng,
            q.options.map((_, i) => i)
        );
        return {
            ...q,
            options: order.map((i) => q.options[i]),
            correctIndex: order.indexOf(q.correctIndex),
        };
    }

    nextNumeric(): NumericQuestion {
        if (this.numericDeck.length === 0) {
            this.numericDeck = shuffle(this.rng, this.numeric);
        }
        return { ...this.numericDeck.pop() };
    }
}
