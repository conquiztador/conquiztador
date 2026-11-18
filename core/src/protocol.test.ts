import { describe, it, expect } from "@jest/globals";

import {
    ClientMessage,
    POINT_VALUES,
    PROTOCOL_VERSION,
    RoomSettings,
    SoloSettings,
    pointsTotal,
} from "./protocol";

const powerUps = { mode: "oneEach", kinds: ["fiftyFifty", "fortify"] };
const settings = { rounds: 5, placement: "draft", seats: 3, language: "en", powerUps };

describe("ClientMessage", () => {
    it("accepts valid messages of each kind", () => {
        const valid = [
            { type: "auth", token: "abc", protocol: PROTOCOL_VERSION },
            { type: "ping" },
            { type: "watchRooms" },
            { type: "unwatchRooms" },
            { type: "createRoom", name: " Room ", settings },
            { type: "joinRoom", roomId: "r1" },
            { type: "leaveRoom" },
            { type: "updateSettings", settings: { rounds: 7 } },
            { type: "setSeat", index: 1, seat: { kind: "bot", difficulty: "EASY" } },
            { type: "setSeat", index: 0, seat: { kind: "open" } },
            { type: "lockRoom" },
            { type: "unlockRoom" },
            { type: "selectRegion", regionId: "sofia" },
            { type: "answer", value: 2 },
            { type: "usePowerUp", kind: "fiftyFifty" },
            { type: "usePowerUp", kind: "fortify", regionId: "sofia" },
            {
                type: "startSolo",
                settings: { rounds: 3, placement: "random", language: "bg", powerUps, bots: ["EASY"] },
            },
        ];
        for (const m of valid) expect(ClientMessage.safeParse(m).success).toBe(true);
    });

    it("rejects unknown types and non-objects", () => {
        expect(ClientMessage.safeParse({ type: "nope" }).success).toBe(false);
        expect(ClientMessage.safeParse({}).success).toBe(false);
        expect(ClientMessage.safeParse("ping").success).toBe(false);
        expect(ClientMessage.safeParse(null).success).toBe(false);
    });

    it("rejects the wrong protocol version and empty or oversized tokens", () => {
        expect(ClientMessage.safeParse({ type: "auth", token: "t", protocol: 999 }).success).toBe(false);
        expect(ClientMessage.safeParse({ type: "auth", token: "", protocol: 1 }).success).toBe(false);
        expect(
            ClientMessage.safeParse({ type: "auth", token: "x".repeat(201), protocol: 1 }).success
        ).toBe(false);
    });

    it("rejects bad room names", () => {
        for (const name of ["", "   ", "x".repeat(41)])
            expect(ClientMessage.safeParse({ type: "createRoom", name, settings }).success).toBe(false);
    });

    it("trims room names", () => {
        const r = ClientMessage.parse({ type: "createRoom", name: "  Hi  ", settings });
        expect(r.type === "createRoom" && r.name).toBe("Hi");
    });

    it("rejects out-of-range seats, indices and non-finite answers", () => {
        expect(RoomSettings.safeParse({ ...settings, seats: 1 }).success).toBe(false);
        expect(RoomSettings.safeParse({ ...settings, seats: 6 }).success).toBe(false);
        expect(RoomSettings.safeParse({ ...settings, rounds: 0 }).success).toBe(false);
        expect(RoomSettings.safeParse({ ...settings, rounds: 16 }).success).toBe(false);
        expect(RoomSettings.safeParse({ ...settings, rounds: 2.5 }).success).toBe(false);
        expect(RoomSettings.safeParse({ ...settings, language: "fr" }).success).toBe(false);
        expect(
            ClientMessage.safeParse({ type: "setSeat", index: 5, seat: { kind: "open" } }).success
        ).toBe(false);
        expect(ClientMessage.safeParse({ type: "answer", value: Infinity }).success).toBe(false);
        expect(ClientMessage.safeParse({ type: "answer", value: "1" }).success).toBe(false);
    });

    it("limits solo opponents to 1-4 known difficulties", () => {
        const base = { rounds: 3, placement: "draft", language: "en", powerUps };
        expect(SoloSettings.safeParse({ ...base, bots: [] }).success).toBe(false);
        expect(SoloSettings.safeParse({ ...base, bots: Array(5).fill("EASY") }).success).toBe(false);
        expect(SoloSettings.safeParse({ ...base, bots: ["impossible"] }).success).toBe(false);
        expect(SoloSettings.safeParse({ ...base, bots: Array(4).fill("EASY") }).success).toBe(true);
    });
});

describe("custom rounds and power-up settings", () => {
    it("allows any whole number of rounds from 1 to 15", () => {
        for (const rounds of [1, 4, 10, 15])
            expect(RoomSettings.safeParse({ ...settings, rounds }).success).toBe(true);
    });

    it("accepts every power-up mode", () => {
        for (const mode of ["none", "oneEach", "random", "reward", "catchUp"])
            expect(RoomSettings.safeParse({ ...settings, powerUps: { mode, kinds: ["scout"] } }).success).toBe(true);
    });

    it("needs at least one kind unless power-ups are off", () => {
        expect(RoomSettings.safeParse({ ...settings, powerUps: { mode: "none", kinds: [] } }).success).toBe(true);
        expect(RoomSettings.safeParse({ ...settings, powerUps: { mode: "random", kinds: [] } }).success).toBe(false);
    });

    it("rejects unknown power-up kinds and modes", () => {
        expect(RoomSettings.safeParse({ ...settings, powerUps: { mode: "oneEach", kinds: ["nuke"] } }).success).toBe(false);
        expect(RoomSettings.safeParse({ ...settings, powerUps: { mode: "always", kinds: ["scout"] } }).success).toBe(false);
        expect(ClientMessage.safeParse({ type: "usePowerUp", kind: "nuke" }).success).toBe(false);
    });

    it("requires power-up settings on rooms and solo games", () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { powerUps: _, ...without } = settings;
        expect(RoomSettings.safeParse(without).success).toBe(false);
    });
});

describe("pointsTotal", () => {
    it("is zero for an empty tally", () => {
        expect(pointsTotal({})).toBe(0);
    });

    it("multiplies each event by its value and sums", () => {
        expect(pointsTotal({ correct_answer: 3, victory: 1, capital_captured: 2 })).toBe(
            3 * POINT_VALUES.correct_answer + POINT_VALUES.victory + 2 * POINT_VALUES.capital_captured
        );
    });
});
