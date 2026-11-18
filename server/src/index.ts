import { loadConfig } from "./config.js";
import { HttpDjangoClient } from "./django.js";
import { startGameServer } from "./server.js";

const config = loadConfig();
const server = await startGameServer({
    port: config.port,
    django: new HttpDjangoClient(config.djangoUrl, config.gameServerSecret),
    authTimeoutMs: config.authTimeoutMs,
});
console.log(`Game server listening on :${server.port} (ws path /ws, Django ${config.djangoUrl})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => void server.close().then(() => process.exit(0)));
}
