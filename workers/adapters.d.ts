// Ambient declarations for this repo's "#"-prefixed conditional imports.
// package.json's "imports" field maps each specifier to a different concrete
// file per build target, keyed by Vite/esbuild's resolve conditions
// ("workerd" for the Cloudflare Worker build, "default" otherwise) — see
// package.json. These declarations let `tsc` type-check workers/app.ts
// without caring which concrete file a given build will actually resolve to.

declare module "#ws-adapter" {
	import type { Hono } from "hono";
	import type { UpgradeWebSocket } from "hono/ws";

	export function setupWs(app: Hono): {
		upgradeWebSocket: UpgradeWebSocket;
		afterListen: (server: unknown) => void;
	};
}

declare module "#fallback-handler" {
	import type { Hono } from "hono";

	/**
	 * Registers the catch-all fallthrough on `app`: renders via React Router
	 * SSR on Cloudflare, serves the pre-built static SPA (with an index.html
	 * fallback for client-side routes) on Node — see
	 * fallback-handler.{cloudflare,node}.ts. Mirrors #ws-adapter's
	 * setupWs(app) shape: registers routes/middleware directly rather than
	 * returning a single per-request handler, since the Node side needs a
	 * real middleware chain (try the static file, then fall back to
	 * index.html), not one function.
	 */
	export function setupFallback(app: Hono): void;
}
