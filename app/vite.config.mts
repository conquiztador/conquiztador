import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const HOST = "conquiztador.local";

export default defineConfig(({ mode }) => ({
    plugins: [react()],
    resolve: {
        tsconfigPaths: true,
        alias:
            mode === "production"
                ? [
                      {
                          find: /^src\/environments\/environment$/,
                          replacement: fileURLToPath(
                              new URL(
                                  "./src/environments/environment.prod.ts",
                                  import.meta.url
                              )
                          ),
                      },
                  ]
                : [],
    },
    server: {
        // Listen on all interfaces so devices on the local network can
        // connect via http://<lan-ip>:8080. Locally, nginx serves it on
        // port 80 as conquiztador.local (see example-nginx.conf).
        host: true,
        port: 8080,
        strictPort: true,
        // IPs and localhost are always allowed; named hosts must be listed.
        allowedHosts: [HOST],
        open: `http://${HOST}/`,
        // Forward API calls to Django, so devices hitting Vite directly
        // (http://<lan-ip>:8080) reach the backend too.
        proxy: {
            "/api": "http://127.0.0.1:8000",
        },
        // No HMR host/port override: the client reconnects to whichever
        // host served the page (nginx proxies the WebSocket upgrade).
    },
    build: {
        sourcemap: true,
    },
}));
