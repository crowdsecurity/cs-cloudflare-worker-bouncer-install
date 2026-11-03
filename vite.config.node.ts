import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { honoDevServer } from "./workers/vite-plugin-hono-dev-server.js";

// Node (non-Cloudflare) build. SPA mode (react-router.config.ts sets
// ssr:false when BUILD_TARGET=node — see its comment): this app has no
// per-request server-rendering to do, so there's no SSR server-build or
// virtual module involved here at all, just an ordinary client build.
// `npm run build:node` runs this for the client half, then bundles
// workers/server.node.ts separately with esbuild (see package.json) — a
// plain Node entry has no need to go through Vite's build pipeline once
// nothing it imports references a Vite-only virtual module.
export default defineConfig({
	plugins: [
		tailwindcss(),
		reactRouter(),
		tsconfigPaths(),
		// Dev-server only (apply: "serve") — build:node's output is served
		// directly by server.node.ts's own @hono/node-server `serve()` call,
		// with no Vite dev server involved at all.
		{ ...honoDevServer(), apply: "serve" },
	],
});
