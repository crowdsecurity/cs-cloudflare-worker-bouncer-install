import { Hono } from "hono";
import { upgradeWebSocket } from "hono/cloudflare-workers";
import { createRequestHandler } from "react-router";
import { createCloudflareClient, extractErrorMessage } from "./services/cloudflare/client.js";
import { detectProtectionStatus } from "./services/cloudflare/zones.js";
import {
	createKVNamespace,
	writeBanTemplate,
	writeTurnstileConfig,
	findAndDeleteKVNamespace,
} from "./services/cloudflare/kv.js";
import { createD1Database, findAndDeleteD1Database } from "./services/cloudflare/d1.js";
import {
	uploadMainWorker,
	uploadDecisionsSyncWorker,
	createCronTrigger,
	deleteWorkerScripts,
} from "./services/cloudflare/workers.js";
import { createWorkerRoutes, deleteWorkerRoutes } from "./services/cloudflare/routes.js";
import { createTurnstileWidgets, deleteTurnstileWidgets } from "./services/cloudflare/turnstile.js";
import { RESOURCE_NAMES, DEFAULTS, type ZoneState, type CloudflareClient } from "./services/cloudflare/types.js";

const app = new Hono();

function extractToken(authHeader: string | undefined): string | null {
	return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

// ─── Progress helpers ─────────────────────────────────────────────────────────

type Progress = (step: string, status: "info" | "success" | "error") => void;

// ─── Operation functions ──────────────────────────────────────────────────────

/**
 * Full install: wipes any existing infra, then creates KV, D1, both workers,
 * cron trigger, Turnstile, and routes for all provided zones.
 */
async function installWorkers(
	client: CloudflareClient,
	accountId: string,
	zones: ZoneState[],
	crowdsecApiUrl: string,
	crowdsecApiKey: string,
	apiToken: string,
	progress: Progress,
): Promise<void> {
	progress("Cleaning existing infrastructure", "info");
	await deleteTurnstileWidgets(client, accountId);
	await deleteWorkerRoutes(client, zones, RESOURCE_NAMES.MAIN_WORKER);
	await deleteWorkerScripts(client, accountId, [RESOURCE_NAMES.MAIN_WORKER, RESOURCE_NAMES.SYNC_WORKER]);
	await findAndDeleteKVNamespace(client, accountId);
	await findAndDeleteD1Database(client, accountId);
	progress("Existing infrastructure cleaned", "success");

	progress("Creating KV namespace", "info");
	const kvNamespaceId = await createKVNamespace(client, accountId);
	progress("KV namespace created", "success");

	progress("Creating D1 database", "info");
	const d1DatabaseId = await createD1Database(client, accountId);
	progress("D1 database created", "success");

	progress("Writing ban template", "info");
	await writeBanTemplate(client, accountId, kvNamespaceId, DEFAULTS.BAN_TEMPLATE);
	progress("Ban template written", "success");

	progress("Uploading main worker", "info");
	await uploadMainWorker(client, accountId, RESOURCE_NAMES.MAIN_WORKER, kvNamespaceId, d1DatabaseId, zones);
	progress("Main worker uploaded", "success");

	progress("Creating worker routes", "info");
	await createWorkerRoutes(client, zones, RESOURCE_NAMES.MAIN_WORKER);
	progress("Worker routes created", "success");

	progress("Uploading decisions sync worker", "info");
	await uploadDecisionsSyncWorker(
		client, accountId, RESOURCE_NAMES.SYNC_WORKER,
		kvNamespaceId, crowdsecApiUrl, crowdsecApiKey, apiToken,
	);
	progress("Decisions sync worker uploaded", "success");

	progress("Creating cron trigger", "info");
	await createCronTrigger(client, accountId, RESOURCE_NAMES.SYNC_WORKER, DEFAULTS.CRON_SCHEDULE);
	progress("Cron trigger created", "success");

	progress("Creating Turnstile widgets", "info");
	const widgets = await createTurnstileWidgets(client, accountId, zones);
	if (widgets.size > 0) {
		await writeTurnstileConfig(client, accountId, kvNamespaceId, widgets);
	}
	progress("Turnstile widgets created", "success");
}

/**
 * Bind zone: adds a worker route for a single zone to the existing main worker.
 * Does not touch KV, D1, or the worker scripts themselves.
 */
async function bindZone(
	client: CloudflareClient,
	zone: ZoneState,
	progress: Progress,
): Promise<void> {
	progress(`Binding ${zone.domain} to main worker`, "info");
	await deleteWorkerRoutes(client, [zone], RESOURCE_NAMES.MAIN_WORKER);
	await createWorkerRoutes(client, [zone], RESOURCE_NAMES.MAIN_WORKER);
	progress(`${zone.domain} bound`, "success");
}

/**
 * Unbind zone: removes the worker route for a single zone.
 * Workers, KV, and D1 are left intact.
 */
async function unbindZone(
	client: CloudflareClient,
	zone: ZoneState,
	progress: Progress,
): Promise<void> {
	progress(`Removing route for ${zone.domain}`, "info");
	await deleteWorkerRoutes(client, [zone], RESOURCE_NAMES.MAIN_WORKER);
	progress(`${zone.domain} unbound`, "success");
}

/**
 * Uninstall all: removes every CrowdSec resource from an account.
 */
async function uninstallAll(
	client: CloudflareClient,
	accountId: string,
	allZones: ZoneState[],
	progress: Progress,
): Promise<void> {
	progress("Removing Turnstile widgets", "info");
	await deleteTurnstileWidgets(client, accountId);
	progress("Turnstile widgets removed", "success");

	progress("Removing worker routes", "info");
	await deleteWorkerRoutes(client, allZones, RESOURCE_NAMES.MAIN_WORKER);
	progress("Worker routes removed", "success");

	progress("Removing worker scripts", "info");
	await deleteWorkerScripts(client, accountId, [RESOURCE_NAMES.MAIN_WORKER, RESOURCE_NAMES.SYNC_WORKER]);
	progress("Worker scripts removed", "success");

	progress("Removing KV namespace", "info");
	await findAndDeleteKVNamespace(client, accountId);
	progress("KV namespace removed", "success");

	progress("Removing D1 database", "info");
	await findAndDeleteD1Database(client, accountId);
	progress("D1 database removed", "success");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toZoneState(z: {
	zoneId: string; domain: string; accountId: string; accountName: string;
	actions: string[]; defaultAction: string; routesToProtect: string[];
}): ZoneState {
	return {
		id: z.zoneId, domain: z.domain, accountId: z.accountId, accountName: z.accountName,
		actions: z.actions, defaultAction: z.defaultAction, selected: true,
		routesToProtect: z.routesToProtect,
		turnstile: { enabled: false, mode: "managed" },
	};
}

// ─── HTTP endpoints ───────────────────────────────────────────────────────────

app.get("/verify-token", async (c) => {
	const token = extractToken(c.req.header("Authorization"));
	if (!token) return c.json({ error: "Missing API Token" }, 401);
	try {
		const client = createCloudflareClient(token);
		const result = await client.user.tokens.verify();
		if (result.status !== "active") return c.json({ valid: false, error: "Token is not active" });
		return c.json({ valid: true });
	} catch (err: unknown) {
		return c.json({ valid: false, error: extractErrorMessage(err) });
	}
});

app.get("/workers", async (c) => {
	const token = extractToken(c.req.header("Authorization"));
	if (!token) return c.json({ error: "Missing API Token" }, 401);
	try {
		const client = createCloudflareClient(token);
		const names: string[] = [];
		for await (const account of client.accounts.list()) {
			try {
				for await (const script of client.workers.scripts.list({ account_id: account.id })) {
					if (script.id?.startsWith("crowdsec")) names.push(script.id);
				}
			} catch { /* skip */ }
		}
		return c.json({ workers: names });
	} catch (err: unknown) {
		return c.json({ error: extractErrorMessage(err) }, 400);
	}
});

app.get("/status", async (c) => {
	const token = extractToken(c.req.header("Authorization"));
	if (!token) return c.json({ error: "Missing API Token" }, 401);
	try {
		const client = createCloudflareClient(token);
		const accounts = await detectProtectionStatus(client);
		return c.json({ accounts });
	} catch (err: unknown) {
		return c.json({ error: extractErrorMessage(err) }, 400);
	}
});

app.get("/worker-settings", async (c) => {
	const token = extractToken(c.req.header("Authorization"));
	if (!token) return c.json({ error: "Missing API Token" }, 401);
	try {
		const client = createCloudflareClient(token);
		for await (const account of client.accounts.list()) {
			try {
				const settings = await client.workers.scripts.scriptAndVersionSettings.get(
					RESOURCE_NAMES.SYNC_WORKER, { account_id: account.id },
				);
				const bindings = (settings.bindings ?? []) as Array<{ type: string; name: string; text?: string }>;
				const lapiUrl = bindings.find((b) => b.type === "plain_text" && b.name === "LAPI_URL")?.text ?? null;
				if (lapiUrl) return c.json({ lapiUrl });
			} catch { /* not deployed on this account */ }
		}
		return c.json({ lapiUrl: null });
	} catch (err: unknown) {
		return c.json({ error: extractErrorMessage(err) }, 400);
	}
});

// ─── WebSocket — streaming progress ──────────────────────────────────────────

type FrontendZone = Parameters<typeof toZoneState>[0];

type WsMessage =
	| { op: "install_workers"; token: string; accountId: string; zones: FrontendZone[]; crowdsecApiUrl: string; crowdsecApiKey: string }
	| { op: "bind_zone";       token: string; zone: FrontendZone }
	| { op: "unbind_zone";     token: string; zone: FrontendZone }
	| { op: "uninstall_all";   token: string; accountId: string; zones: FrontendZone[] };

app.get("/ws", upgradeWebSocket(() => ({
	async onMessage(event, ws) {
		let msg: WsMessage;
		try {
			msg = JSON.parse(event.data as string) as WsMessage;
		} catch {
			ws.send(JSON.stringify({ type: "done", success: false, error: "Invalid JSON" }));
			return;
		}

		const send: Progress = (step, status) =>
			ws.send(JSON.stringify({ type: "progress", step, status }));

		try {
			if (msg.op === "install_workers") {
				const client = createCloudflareClient(msg.token);
				const zones = msg.zones.map(toZoneState);
				await installWorkers(client, msg.accountId, zones, msg.crowdsecApiUrl, msg.crowdsecApiKey, msg.token, send);

			} else if (msg.op === "bind_zone") {
				const client = createCloudflareClient(msg.token);
				await bindZone(client, toZoneState(msg.zone), send);

			} else if (msg.op === "unbind_zone") {
				const client = createCloudflareClient(msg.token);
				await unbindZone(client, toZoneState(msg.zone), send);

			} else if (msg.op === "uninstall_all") {
				const client = createCloudflareClient(msg.token);
				const zones = msg.zones.map(toZoneState);
				await uninstallAll(client, msg.accountId, zones, send);

			} else {
				ws.send(JSON.stringify({ type: "done", success: false, error: "Unknown operation" }));
				return;
			}
			ws.send(JSON.stringify({ type: "done", success: true }));
		} catch (err: unknown) {
			ws.send(JSON.stringify({ type: "done", success: false, error: extractErrorMessage(err) }));
		}
	},
})));

// ─── React Router fallthrough ─────────────────────────────────────────────────

app.get("*", (c) => {
	const requestHandler = createRequestHandler(
		() => import("virtual:react-router/server-build"),
		import.meta.env.MODE,
	);
	return requestHandler(c.req.raw, {
		cloudflare: { env: c.env, ctx: c.executionCtx },
	});
});

export default app;
