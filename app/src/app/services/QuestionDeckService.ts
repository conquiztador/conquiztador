import axios from "axios";
import { z } from "zod";

import { environment } from "src/environments/environment";
import { McqQuestion, NumericQuestion } from "app/core/types";
import { Language } from "app/i18n";

/** How many questions of each kind to fetch for one match. */
const DECK_SIZE = 200;

const DeckQuestionSchema = z.object({
    uuid: z.string(),
    text: z.string(),
    language: z.string(),
    kind: z.enum(["multiple_choice", "numeric"]),
    numeric_answer: z.number().nullable(),
    answers: z.array(
        z.object({
            uuid: z.string(),
            text: z.string(),
            is_correct: z.boolean(),
        })
    ),
    categories: z.array(z.object({ uuid: z.string(), name: z.string() })),
});
const DeckSchema = z.array(DeckQuestionSchema);
type DeckQuestion = z.infer<typeof DeckQuestionSchema>;

export class NoQuestionsError extends Error {}

export interface QuestionDeck {
    mcq: McqQuestion[];
    numeric: NumericQuestion[];
}

/**
 * Fetches a match's questions, with solutions, in one language from the
 * backend (`/api/questions/deck/`). The single-player engine runs in the
 * browser and needs the answers up front.
 */
export async function loadQuestionDeck(
    language: Language
): Promise<QuestionDeck> {
    const fetchKind = async (kind: DeckQuestion["kind"]) => {
        const response = await axios.get(
            `${environment.apiUrl}/questions/deck/`,
            { params: { language, kind, count: DECK_SIZE } }
        );
        return DeckSchema.parse(response.data);
    };
    const [mcqRaw, numericRaw] = await Promise.all([
        fetchKind("multiple_choice"),
        fetchKind("numeric"),
    ]);

    const mcq = mcqRaw.flatMap(toMcq);
    const numeric = numericRaw.flatMap(toNumeric);
    if (mcq.length === 0 || numeric.length === 0) throw new NoQuestionsError();
    return { mcq, numeric };
}

function toMcq(q: DeckQuestion): McqQuestion[] {
    const correctIndex = q.answers.findIndex((a) => a.is_correct);
    // Skip malformed questions rather than breaking the match.
    if (q.answers.length < 2 || correctIndex < 0) return [];
    return [
        {
            id: q.uuid,
            text: q.text,
            category: q.categories[0]?.name,
            options: q.answers.map((a) => a.text),
            correctIndex,
        },
    ];
}

function toNumeric(q: DeckQuestion): NumericQuestion[] {
    if (q.numeric_answer === null) return [];
    return [
        {
            id: q.uuid,
            text: q.text,
            category: q.categories[0]?.name,
            correctValue: q.numeric_answer,
        },
    ];
}
