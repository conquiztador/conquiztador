import { QuestionProvider } from "app/core/GameEngine";
import { Rng, shuffle } from "app/core/rng";
import { McqQuestion, NumericQuestion } from "app/core/types";
import { QuestionDeck } from "app/services/QuestionDeckService";

/**
 * Serves a match's pre-loaded questions, shuffling options and avoiding
 * repeats until the deck runs out (then reshuffling).
 */
export class DeckQuestionProvider implements QuestionProvider {
    private mcqDeck: McqQuestion[] = [];
    private numericDeck: NumericQuestion[] = [];

    constructor(
        private readonly deck: QuestionDeck,
        private readonly rng: Rng = Math.random
    ) {}

    nextMcq(): McqQuestion {
        if (this.mcqDeck.length === 0)
            this.mcqDeck = shuffle(this.rng, this.deck.mcq);
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
        if (this.numericDeck.length === 0)
            this.numericDeck = shuffle(this.rng, this.deck.numeric);
        return { ...this.numericDeck.pop() };
    }
}
