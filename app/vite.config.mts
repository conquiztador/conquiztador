import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const HOST = "conquiztador.local";

export default defineConfig(({ mode }) => ({
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
        // The dev server listens on 8080; nginx serves it on port 80
        // (see example-nginx.conf), so open the URL without a port.
        host: "127.0.0.1",
        port: 8080,
        strictPort: true,
        allowedHosts: [HOST],
        open: `http://${HOST}/`,
        hmr: { host: HOST, clientPort: 80 },
    },
    build: {
        sourcemap: true,
    },
}));
