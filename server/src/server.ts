import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";

import { Connection } from "./connection.js";
import type { DjangoClient } from "./django.js";
import { Lobby, LobbyOptions } from "./rooms.js";

export interface GameServerOptions {
    port: number;
    django: DjangoClient;
    authTimeoutMs: number;
    lobby?: LobbyOptions;
}

export interface GameServer {
    /** The port actually bound (useful with port 0 in tests). */
    port: number;
    connections: Set<Connection>;
    lobby: Lobby;
    close(): Promise<void>;
}

/** HTTP server with a WebSocket endpoint at /ws and a health check at /health. */
export async function startGameServer(options: GameServerOptions): Promise<GameServer> {
    const http: Server = createServer((req, res) => {
        if (req.url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        res.writeHead(404).end();
    });
    const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: 64 * 1024 });
    const connections = new Set<Connection>();
    const lobby = new Lobby({ django: options.django, ...options.lobby });

    wss.on("connection", (socket) => {
        const connection = new Connection(socket, options.django, lobby, options.authTimeoutMs);
        connections.add(connection);
        socket.on("close", () => connections.delete(connection));
    });

    await new Promise<void>((resolve) => http.listen(options.port, resolve));
    return {
        port: (http.address() as AddressInfo).port,
        connections,
        lobby,
        close: () =>
            new Promise<void>((resolve) => {
                for (const client of wss.clients) client.terminate();
                wss.close(() => http.close(() => resolve()));
            }),
    };
}
