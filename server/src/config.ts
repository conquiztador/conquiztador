/** Game-server settings, from the environment with development defaults. */
export interface Config {
    port: number;
    /** Base URL of the Django backend, without a trailing slash. */
    djangoUrl: string;
    /** Shared secret for game-server-only Django endpoints. */
    gameServerSecret: string;
    /** Close connections that haven't authenticated within this time. */
    authTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const production = env.NODE_ENV === "production";
    const secret = env.GAME_SERVER_SECRET ?? (production ? "" : "dev-game-server-secret");
    if (!secret) throw new Error("GAME_SERVER_SECRET must be set in production");
    return {
        port: Number(env.PORT ?? 8090),
        djangoUrl: (env.DJANGO_URL ?? "http://127.0.0.1:8000").replace(/\/$/, ""),
        gameServerSecret: secret,
        authTimeoutMs: Number(env.AUTH_TIMEOUT_MS ?? 10_000),
    };
}
