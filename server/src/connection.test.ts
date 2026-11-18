import { PROTOCOL_VERSION, PublicUser, ServerMessage } from "@conquiztador/core";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import WebSocket from "ws";

import { CloseCode } from "./connection.js";
import type { DjangoClient } from "./django.js";
import { GameServer, startGameServer } from "./server.js";

const ALICE: PublicUser = { uuid: "u-alice", displayName: "alice", points: 0 };

/** Fake Django: "good-token" is Alice, anything else is invalid. */
const django: DjangoClient = {
    async me(token) {
        return token === "good-token" ? ALICE : null;
    },
    async deck() {
        throw new Error("not used");
    },
    async award() {
        return {};
    },
};

/** A test client that queues incoming messages and the close event. */
class Client {
    socket: WebSocket;
    private inbox: ServerMessage[] = [];
    private waiters: ((m: ServerMessage) => void)[] = [];
    closed: Promise<number>;

    constructor(port: number) {
        this.socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        this.socket.on("message", (data) => {
            const m = JSON.parse(data.toString()) as ServerMessage;
            const w = this.waiters.shift();
            if (w) w(m);
            else this.inbox.push(m);
        });
        this.closed = new Promise((resolve) => this.socket.on("close", (code) => resolve(code)));
    }

    open() {
        return new Promise<void>((resolve) => this.socket.once("open", () => resolve()));
    }

    send(message: unknown) {
        this.socket.send(typeof message === "string" ? message : JSON.stringify(message));
    }

    next(): Promise<ServerMessage> {
        const m = this.inbox.shift();
        return m ? Promise.resolve(m) : new Promise((resolve) => this.waiters.push(resolve));
    }
}

describe("connection auth", () => {
    let server: GameServer;
    before(async () => {
        server = await startGameServer({ port: 0, django, authTimeoutMs: 300 });
    });
    after(() => server.close());

    async function connect() {
        const client = new Client(server.port);
        await client.open();
        return client;
    }

    it("welcomes a valid token and then answers pings", async () => {
        const c = await connect();
        c.send({ type: "auth", token: "good-token", protocol: PROTOCOL_VERSION });
        assert.deepEqual(await c.next(), { type: "welcome", user: ALICE });
        c.send({ type: "ping" });
        assert.deepEqual(await c.next(), { type: "pong" });
        c.socket.close();
    });

    it("rejects an invalid token and closes", async () => {
        const c = await connect();
        c.send({ type: "auth", token: "nope", protocol: PROTOCOL_VERSION });
        const m = await c.next();
        assert.equal(m.type, "error");
        assert.equal(m.type === "error" && m.code, "auth_failed");
        assert.equal(await c.closed, CloseCode.authFailed);
    });

    it("ignores everything but auth before authenticating", async () => {
        const c = await connect();
        c.send({ type: "ping" });
        const m = await c.next();
        assert.equal(m.type === "error" && m.code, "unauthenticated");
        c.socket.close();
    });

    it("reports malformed messages without closing", async () => {
        const c = await connect();
        c.send("{not json");
        assert.equal(((await c.next()) as { code: string }).code, "bad_message");
        c.send({ type: "launch-missiles" });
        assert.equal(((await c.next()) as { code: string }).code, "bad_message");
        c.send({ type: "auth", token: "good-token", protocol: PROTOCOL_VERSION });
        assert.equal((await c.next()).type, "welcome");
        c.socket.close();
    });

    it("routes match input, refusing it outside a match", async () => {
        const c = await connect();
        c.send({ type: "auth", token: "good-token", protocol: PROTOCOL_VERSION });
        assert.equal((await c.next()).type, "welcome");
        for (const message of [
            { type: "usePowerUp", kind: "fiftyFifty" },
            { type: "usePowerUp", kind: "fortify", regionId: "sofia" },
            { type: "selectRegion", regionId: "sofia" },
        ]) {
            c.send(message);
            assert.equal(((await c.next()) as { code: string }).code, "not_in_room");
        }
        c.send({ type: "usePowerUp", kind: "teleport" });
        assert.equal(((await c.next()) as { code: string }).code, "bad_message");
        c.socket.close();
    });

    it("closes on protocol mismatch", async () => {
        const c = await connect();
        c.send({ type: "auth", token: "good-token", protocol: 999 });
        assert.equal(((await c.next()) as { code: string }).code, "protocol_mismatch");
        assert.equal(await c.closed, CloseCode.protocolMismatch);
    });

    it("closes connections that never authenticate", async () => {
        const c = await connect();
        assert.equal(((await c.next()) as { code: string }).code, "auth_timeout");
        assert.equal(await c.closed, CloseCode.authTimeout);
    });

    it("drops closed connections from the registry", async () => {
        const c = await connect();
        c.socket.close();
        await c.closed;
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(server.connections.size, 0);
    });
});
