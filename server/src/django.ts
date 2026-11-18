import { McqQuestion, NumericQuestion, PublicUser, QuestionDeck, QuestionLanguage } from "@conquiztador/core";
import { z } from "zod";

/** Shape of Django's `GET /api/users/me/`. */
const MeResponse = z.object({
    uuid: z.string(),
    display_name: z.string(),
    points: z.number().int(),
});

const DeckQuestion = z.object({
    uuid: z.string(),
    text: z.string(),
    kind: z.enum(["multiple_choice", "numeric"]),
    numeric_answer: z.number().nullable(),
    answers: z.array(z.object({ text: z.string(), is_correct: z.boolean() })),
    categories: z.array(z.object({ name: z.string() })),
});
type DeckQuestion = z.infer<typeof DeckQuestion>;

/** How many questions of each kind one match loads. */
export const DECK_SIZE = 200;

export class NoQuestionsError extends Error {}

/**
 * What the game server needs from Django. An interface so tests (and later
 * steps) can substitute a fake without a running backend.
 */
export interface DjangoClient {
    /** The user a REST token belongs to, or null if the token is invalid. */
    me(token: string): Promise<PublicUser | null>;
    /** A match's questions, with solutions. Throws NoQuestionsError if empty. */
    deck(language: QuestionLanguage): Promise<QuestionDeck>;
    /** Saves a match's points; returns the new balances by user uuid. */
    award(matchId: string, players: AwardPlayer[]): Promise<Record<string, number>>;
}

export interface AwardPlayer {
    user: string;
    entries: { reason: string; count: number; amount: number }[];
}

export class HttpDjangoClient implements DjangoClient {
    constructor(
        private readonly baseUrl: string,
        private readonly gameServerSecret: string
    ) {}

    async me(token: string): Promise<PublicUser | null> {
        const response = await fetch(`${this.baseUrl}/api/users/me/`, {
            headers: { Authorization: `Token ${token}`, Accept: "application/json" },
        });
        if (response.status === 401 || response.status === 403) return null;
        if (!response.ok) throw new Error(`Django /users/me/ returned ${response.status}`);
        const body = MeResponse.parse(await response.json());
        return { uuid: body.uuid, displayName: body.display_name, points: body.points };
    }

    async deck(language: QuestionLanguage): Promise<QuestionDeck> {
        const fetchKind = async (kind: DeckQuestion["kind"]) => {
            const params = new URLSearchParams({ language, kind, count: String(DECK_SIZE) });
            const response = await fetch(`${this.baseUrl}/api/questions/deck/?${params}`, {
                headers: { ...this.serverHeaders(), Accept: "application/json" },
            });
            if (!response.ok) throw new Error(`Django /questions/deck/ returned ${response.status}`);
            return z.array(DeckQuestion).parse(await response.json());
        };
        const [mcq, numeric] = await Promise.all([fetchKind("multiple_choice"), fetchKind("numeric")]);
        const deck = { mcq: mcq.flatMap(toMcq), numeric: numeric.flatMap(toNumeric) };
        if (deck.mcq.length === 0 || deck.numeric.length === 0) throw new NoQuestionsError(language);
        return deck;
    }

    async award(matchId: string, players: AwardPlayer[]): Promise<Record<string, number>> {
        const response = await fetch(`${this.baseUrl}/api/points/award/`, {
            method: "POST",
            headers: { ...this.serverHeaders(), "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ match_id: matchId, players }),
        });
        if (!response.ok) throw new Error(`Django /points/award/ returned ${response.status}`);
        return z.object({ balances: z.record(z.string(), z.number()) }).parse(await response.json()).balances;
    }

    /** Headers for game-server-only endpoints (deck, points). */
    protected serverHeaders(): Record<string, string> {
        return { "X-Game-Server-Secret": this.gameServerSecret };
    }
}

function toMcq(q: DeckQuestion): McqQuestion[] {
    const correctIndex = q.answers.findIndex((a) => a.is_correct);
    // Skip malformed questions rather than breaking a match.
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
    return [{ id: q.uuid, text: q.text, category: q.categories[0]?.name, correctValue: q.numeric_answer }];
}
