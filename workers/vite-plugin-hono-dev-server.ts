import type { Plugin, ViteDevServer } from "vite";
import { getRequestListener } from "@hono/node-server";

/**
 * Dev-only: installs the Hono app (workers/app.ts, same file used in
 * production) as Connect middleware ahead of React Router's own dev
 * middleware. Without this, nothing routes requests to Hono's API routes in
 * dev — @react-router/dev's Vite plugin sets appType "custom" itself
 * whenever SSR is on, so there's no competing default middleware to
 * override, but nothing installs app.fetch either, so e.g. /verify-token
 * falls straight through to React Router's route matcher and 404s.
 *
 * app.ts's own `app.get("*", ...)` already calls into React Router's SSR
 * handler for anything it doesn't otherwise match, so every request is
 * handed to Hono here — never partially delegated back to Vite's `next()`.
 *
 * Production (build:node) doesn't need this: server.node.ts's
 * @hono/node-server `serve()` call *is* the whole HTTP server there, with
 * no Vite dev server in the picture at all.
 */
export function honoDevServer(): Plugin {
	return {
		name: "hono-dev-server",
		configureServer: {
			order: "pre",
			handler(server: ViteDevServer) {
				return () => {
					server.middlewares.use(async (req, res, next) => {
						try {
							const mod = await server.ssrLoadModule("/workers/app.ts");
							const app = (mod as { default: { fetch: unknown } }).default;
							const listener = getRequestListener(app.fetch as never);
							await listener(req, res);
						} catch (err) {
							next(err);
						}
					});
				};
			},
		},
	};
}
