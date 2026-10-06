/// <reference types="node" />
import type { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFile } from "node:fs/promises";

// Relative to the current working directory the process was started from
// (serveStatic's own documented convention) — npm scripts always run from
// the project root, so this assumes `start:node` is launched from there.
const CLIENT_DIR = "build-node/client";

/**
 * Serves the pre-built static SPA. Real files (JS/CSS/etc.) are served
 * as-is; anything else (client-side routes) falls back to index.html so
 * React Router's browser-side router can take over — this app has no
 * server-rendering to do on Node (see fallback-handler.cloudflare.ts's
 * comment: nothing reads per-request data in a loader).
 */
export function setupFallback(app: Hono) {
	app.use("*", serveStatic({ root: CLIENT_DIR }));
	app.get("*", async (c) => {
		const html = await readFile(`${CLIENT_DIR}/index.html`, "utf-8");
		return c.html(html);
	});
}
