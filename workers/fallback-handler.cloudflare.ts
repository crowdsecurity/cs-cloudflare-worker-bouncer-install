import type { Hono } from "hono";
import { createRequestHandler } from "react-router";

/**
 * Renders via React Router SSR, same as app.ts's fallthrough route did
 * before it was extracted here. No loadContext is passed — nothing in
 * app/ reads context.cloudflare (confirmed: entry.server.tsx's
 * _loadContext param is unused, routes/home.tsx's loader destructures but
 * never uses it), and omitting it keeps this call identical in spirit to
 * the Node build's static-file fallback, which has no load context either.
 */
export function setupFallback(app: Hono) {
	app.get("*", (c) => {
		const requestHandler = createRequestHandler(
			() => import("virtual:react-router/server-build"),
			import.meta.env.MODE,
		);
		return requestHandler(c.req.raw);
	});
}
