import { ClientMessage, ErrorCode, GameRuleError, PROTOCOL_VERSION, PublicUser, ServerMessage } from "@conquiztador/core";
import type { WebSocket } from "ws";

import type { DjangoClient } from "./django.js";
import { Lobby, Member, RoomError } from "./rooms.js";

/** Close codes (4000–4999 are free for applications). */
export const CloseCode = {
    authFailed: 4001,
    authTimeout: 4002,
    protocolMismatch: 4003,
    /** The same user connected again elsewhere. */
    replaced: 4004,
} as const;

/**
 * One client connection. Starts unauthenticated: the first message must be
 * `auth` with a valid Django token, otherwise nothing else is accepted.
 */
export class Connection implements Member {
    user: PublicUser | null = null;
    private authTimer: NodeJS.Timeout;
    private authenticating = false;

    constructor(
        private readonly socket: WebSocket,
        private readonly django: DjangoClient,
        private readonly lobby: Lobby,
        authTimeoutMs: number
    ) {
        this.authTimer = setTimeout(() => {
            if (!this.user) this.fail("auth_timeout", "Authentication timed out", CloseCode.authTimeout);
        }, authTimeoutMs);
        socket.on("message", (data, isBinary) => {
            if (isBinary) return this.error("bad_message", "Binary messages are not supported");
            void this.receive(data.toString());
        });
        socket.on("close", () => {
            clearTimeout(this.authTimer);
            if (this.user) this.lobby.disconnect(this);
        });
    }

    send(message: ServerMessage): void {
        if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(message));
    }

    private async receive(raw: string): Promise<void> {
        let json: unknown;
        try {
            json = JSON.parse(raw);
        } catch {
            return this.error("bad_message", "Invalid JSON");
        }
        // Report a protocol mismatch clearly instead of a generic shape error.
        if (
            typeof json === "object" && json !== null &&
            (json as { type?: unknown }).type === "auth" &&
            (json as { protocol?: unknown }).protocol !== PROTOCOL_VERSION
        ) {
            return this.fail("protocol_mismatch", `Server speaks protocol ${PROTOCOL_VERSION}`, CloseCode.protocolMismatch);
        }
        const parsed = ClientMessage.safeParse(json);
        if (!parsed.success) return this.error("bad_message", "Unknown or malformed message");
        const message = parsed.data;

        if (message.type === "auth") return this.authenticate(message.token);
        if (!this.user) return this.error("unauthenticated", "Send auth first");

        try {
            await this.dispatch(message);
        } catch (e) {
            if (e instanceof RoomError) return this.error(e.code, e.message);
            if (e instanceof GameRuleError) return this.error("invalid", e.message);
            console.error("message handling failed", e);
            this.error("internal", "Something went wrong");
        }
    }

    private async dispatch(message: ClientMessage): Promise<void> {
        const lobby = this.lobby;
        switch (message.type) {
            case "ping":
                return this.send({ type: "pong" });
            case "watchRooms":
                return lobby.watch(this);
            case "unwatchRooms":
                return lobby.unwatch(this);
            case "createRoom":
                await lobby.create(this, message);
                return;
            case "joinRoom":
                await lobby.join(this, message.roomId, message.password);
                return;
            case "leaveRoom":
                return lobby.leave(this);
            case "updateSettings":
                return lobby.updateSettings(this, message.settings);
            case "setSeat":
                return lobby.setSeat(this, message.index, message.seat);
            case "lockRoom":
                return lobby.lock(this);
            case "unlockRoom":
                return lobby.unlock(this);
            case "startSolo":
                await lobby.startSolo(this, message.settings);
                return;
            case "selectRegion":
                return lobby.matchOf(this).selectRegion(this.user.uuid, message.regionId);
            case "answer":
                return lobby.matchOf(this).answer(this.user.uuid, message.value);
        }
    }

    /** Closes this connection because the user connected elsewhere. */
    replace(): void {
        this.fail("replaced", "You connected from another window", CloseCode.replaced);
    }

    private async authenticate(token: string): Promise<void> {
        if (this.user || this.authenticating) return this.error("bad_message", "Already authenticated");
        this.authenticating = true;
        try {
            const user = await this.django.me(token);
            if (!user) return this.fail("auth_failed", "Invalid token", CloseCode.authFailed);
            if (this.socket.readyState !== this.socket.OPEN) return;
            this.user = user;
            clearTimeout(this.authTimer);
            this.send({ type: "welcome", user });
            const previous = this.lobby.connect(this);
            if (previous instanceof Connection) previous.replace();
        } catch (e) {
            console.error("auth: Django unavailable", e);
            this.fail("internal", "Accounts service unavailable", CloseCode.authFailed);
        } finally {
            this.authenticating = false;
        }
    }

    private error(code: ErrorCode, message: string): void {
        this.send({ type: "error", code, message });
    }

    /** Send an error and close the connection. */
    private fail(code: ErrorCode, message: string, closeCode: number): void {
        this.error(code, message);
        this.socket.close(closeCode, code);
    }
}
