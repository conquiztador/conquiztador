import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { HttpDjangoClient, NoQuestionsError } from "./django.js";

const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
});

interface Call {
    url: string;
    init?: RequestInit;
}

/** Replaces fetch with a stub that answers from `handler` and records calls. */
function stubFetch(handler: (url: URL) => { status?: number; body?: unknown }): Call[] {
    const calls: Call[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        const { status = 200, body = {} } = handler(new URL(url));
        return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
    return calls;
}

const client = () => new HttpDjangoClient("http://django", "secret");

describe("HttpDjangoClient.me", () => {
    it("maps the response and sends the token", async () => {
        const calls = stubFetch(() => ({ body: { uuid: "u1", display_name: "Ann", points: 120 } }));
        const user = await client().me("tok");
        assert.deepEqual(user, { uuid: "u1", displayName: "Ann", points: 120 });
        assert.equal(calls[0].url, "http://django/api/users/me/");
        assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Token tok");
    });

    it("returns null for 401 and 403", async () => {
        for (const status of [401, 403]) {
            stubFetch(() => ({ status }));
            assert.equal(await client().me("bad"), null);
        }
    });

    it("throws on other errors and on malformed bodies", async () => {
        stubFetch(() => ({ status: 500 }));
        await assert.rejects(client().me("t"), /500/);
        stubFetch(() => ({ body: { uuid: "u" } }));
        await assert.rejects(client().me("t"));
    });
});

const mcq = (uuid: string, answers: { text: string; is_correct: boolean }[]) => ({
    uuid,
    text: `Q ${uuid}`,
    kind: "multiple_choice",
    numeric_answer: null as number | null,
    answers,
    categories: [{ name: "History" }],
});
const numeric = (uuid: string, value: number | null) => ({
    uuid,
    text: `N ${uuid}`,
    kind: "numeric",
    numeric_answer: value,
    answers: [] as { text: string; is_correct: boolean }[],
    categories: [] as { name: string }[],
});

describe("HttpDjangoClient.deck", () => {
    it("loads both kinds with the secret header and converts them", async () => {
        const calls = stubFetch((url) => ({
            body:
                url.searchParams.get("kind") === "numeric"
                    ? [numeric("n1", 42)]
                    : [
                          mcq("m1", [
                              { text: "a", is_correct: false },
                              { text: "b", is_correct: true },
                          ]),
                      ],
        }));
        const deck = await client().deck("bg");
        assert.deepEqual(deck.mcq, [
            { id: "m1", text: "Q m1", category: "History", options: ["a", "b"], correctIndex: 1 },
        ]);
        assert.deepEqual(deck.numeric, [{ id: "n1", text: "N n1", category: undefined, correctValue: 42 }]);
        assert.equal(calls.length, 2);
        for (const c of calls) {
            const url = new URL(c.url);
            assert.equal(url.pathname, "/api/questions/deck/");
            assert.equal(url.searchParams.get("language"), "bg");
            assert.equal((c.init?.headers as Record<string, string>)["X-Game-Server-Secret"], "secret");
        }
    });

    it("skips malformed questions", async () => {
        stubFetch((url) => ({
            body:
                url.searchParams.get("kind") === "numeric"
                    ? [numeric("bad", null), numeric("ok", 0)]
                    : [
                          mcq("no-correct", [
                              { text: "a", is_correct: false },
                              { text: "b", is_correct: false },
                          ]),
                          mcq("one-option", [{ text: "a", is_correct: true }]),
                          mcq("good", [
                              { text: "a", is_correct: true },
                              { text: "b", is_correct: false },
                          ]),
                          ],
        }));
        const deck = await client().deck("en");
        assert.deepEqual(deck.mcq.map((q) => q.id), ["good"]);
        assert.deepEqual(deck.numeric.map((q) => q.id), ["ok"]);
    });

    it("throws NoQuestionsError when either kind is empty", async () => {
        stubFetch((url) => ({
            body: url.searchParams.get("kind") === "numeric" ? [] : [mcq("m", [{ text: "a", is_correct: true }, { text: "b", is_correct: false }])],
        }));
        await assert.rejects(client().deck("en"), NoQuestionsError);
    });

    it("throws on an HTTP error", async () => {
        stubFetch(() => ({ status: 403 }));
        await assert.rejects(client().deck("en"), /403/);
    });
});

describe("HttpDjangoClient.award", () => {
    it("posts the match and returns balances", async () => {
        const players = [{ user: "u1", entries: [{ reason: "victory", count: 1, amount: 200 }] }];
        const calls = stubFetch(() => ({ body: { balances: { u1: 320 } } }));
        const balances = await client().award("match-1", players);
        assert.deepEqual(balances, { u1: 320 });
        assert.equal(calls[0].init?.method, "POST");
        assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { match_id: "match-1", players });
        assert.equal((calls[0].init?.headers as Record<string, string>)["X-Game-Server-Secret"], "secret");
    });

    it("throws on an HTTP error", async () => {
        stubFetch(() => ({ status: 500 }));
        await assert.rejects(client().award("m", []), /500/);
    });
});
