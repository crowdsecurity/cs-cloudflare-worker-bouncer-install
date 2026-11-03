import { upgradeWebSocket as cfUpgradeWebSocket } from "hono/cloudflare-workers";
import type { Hono } from "hono";

/**
 * Cloudflare Workers has no "after listen" moment — the runtime handles the
 * HTTP→WebSocket upgrade natively, so there's nothing to wire up beyond the
 * import itself.
 */
export function setupWs(_app: Hono) {
	return {
		upgradeWebSocket: cfUpgradeWebSocket,
		afterListen: (_server: unknown) => {},
	};
}
