import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadConfig } from "./config.js";

describe("loadConfig", () => {
    it("uses development defaults", () => {
        const c = loadConfig({});
        assert.equal(c.port, 8090);
        assert.equal(c.djangoUrl, "http://127.0.0.1:8000");
        assert.equal(c.gameServerSecret, "dev-game-server-secret");
        assert.equal(c.authTimeoutMs, 10_000);
    });

    it("reads overrides and strips a trailing slash from the Django URL", () => {
        const c = loadConfig({
            PORT: "9000",
            DJANGO_URL: "http://api.example/",
            GAME_SERVER_SECRET: "s3cret",
            AUTH_TIMEOUT_MS: "250",
        });
        assert.equal(c.port, 9000);
        assert.equal(c.djangoUrl, "http://api.example");
        assert.equal(c.gameServerSecret, "s3cret");
        assert.equal(c.authTimeoutMs, 250);
    });

    it("refuses to start in production without a secret", () => {
        assert.throws(() => loadConfig({ NODE_ENV: "production" }), /GAME_SERVER_SECRET/);
        assert.throws(() => loadConfig({ NODE_ENV: "production", GAME_SERVER_SECRET: "" }), /GAME_SERVER_SECRET/);
    });

    it("accepts a secret in production", () => {
        assert.equal(loadConfig({ NODE_ENV: "production", GAME_SERVER_SECRET: "x" }).gameServerSecret, "x");
    });
});
