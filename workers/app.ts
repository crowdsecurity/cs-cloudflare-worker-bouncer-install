import { Hono } from "hono";
import { createRequestHandler } from "react-router";
import { createCloudflareClient, extractErrorMessage } from "./services/cloudflare/client.js";
import { discoverZones } from "./services/cloudflare/zones.js";
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

async function cleanupInfrastructure(
	client: CloudflareClient,
	accountId: string,
	zones: ZoneState[],
): Promise<void> {
	await deleteTurnstileWidgets(client, accountId);
	await deleteWorkerRoutes(client, zones, RESOURCE_NAMES.MAIN_WORKER);
	await deleteWorkerScripts(client, accountId, [RESOURCE_NAMES.MAIN_WORKER, RESOURCE_NAMES.SYNC_WORKER]);
	await findAndDeleteKVNamespace(client, accountId);
	await findAndDeleteD1Database(client, accountId);
}

app.get("/zones", async (c) => {
	const token = extractToken(c.req.header("Authorization"));
	if (!token) return c.json({ error: "Missing API key" }, 401);

	try {
		const client = createCloudflareClient(token);
		const zones = await discoverZones(client);
		return c.json({ zones });
	} catch (err: unknown) {
		return c.json({ error: extractErrorMessage(err) }, 400);
	}
});

app.post("/configure", async (c) => {
	const token = extractToken(c.req.header("Authorization"));
	if (!token) return c.json({ error: "Missing API key" }, 401);

	const body = await c.req.json<{
		zones: Array<Pick<ZoneState, "id" | "domain" | "accountId" | "accountName" | "actions" | "defaultAction" | "routesToProtect" | "turnstile">>;
		crowdsecApiUrl: string;
		crowdsecApiKey: string;
	}>();

	if (!Array.isArray(body.zones) || body.zones.length === 0 || !body.crowdsecApiUrl || !body.crowdsecApiKey) {
		return c.json({ error: "Invalid payload" }, 400);
	}

	const client = createCloudflareClient(token);

	// Group zones by account
	const zonesByAccount = new Map<string, ZoneState[]>();
	for (const zone of body.zones) {
		const list = zonesByAccount.get(zone.accountId) ?? [];
		list.push({ ...zone, selected: true });
		zonesByAccount.set(zone.accountId, list);
	}

	try {
		for (const [accountId, zones] of zonesByAccount) {
			// 1. Clean up existing infrastructure (idempotent)
			await cleanupInfrastructure(client, accountId, zones);

			// 2. Create KV namespace
			const kvNamespaceId = await createKVNamespace(client, accountId);

			// 3. Create D1 database (optional, for metrics)
			const d1DatabaseId = await createD1Database(client, accountId);

			// 4. Write ban template
			await writeBanTemplate(client, accountId, kvNamespaceId, DEFAULTS.BAN_TEMPLATE);

			// 5. Upload main worker
			await uploadMainWorker(client, accountId, RESOURCE_NAMES.MAIN_WORKER, kvNamespaceId, d1DatabaseId, zones);

			// 6. Create worker routes
			await createWorkerRoutes(client, zones, RESOURCE_NAMES.MAIN_WORKER);

			// 7. Upload decisions sync worker
			await uploadDecisionsSyncWorker(
				client, accountId, RESOURCE_NAMES.SYNC_WORKER,
				kvNamespaceId, body.crowdsecApiUrl, body.crowdsecApiKey, token,
			);

			// 8. Create cron trigger for sync worker
			await createCronTrigger(client, accountId, RESOURCE_NAMES.SYNC_WORKER, DEFAULTS.CRON_SCHEDULE);

			// 9. Create Turnstile widgets and write config to KV
			const widgets = await createTurnstileWidgets(client, accountId, zones);
			if (widgets.size > 0) {
				await writeTurnstileConfig(client, accountId, kvNamespaceId, widgets);
			}
		}

		return c.json({ ok: true });
	} catch (err: unknown) {
		return c.json({ error: extractErrorMessage(err) }, 500);
	}
});

app.post("/clean", async (c) => {
	const token = extractToken(c.req.header("Authorization"));
	if (!token) return c.json({ error: "Missing API key" }, 401);

	const body = await c.req.json<{
		zones: Array<Pick<ZoneState, "id" | "domain" | "accountId" | "accountName" | "actions" | "defaultAction" | "routesToProtect" | "turnstile">>;
	}>();

	if (!Array.isArray(body.zones) || body.zones.length === 0) {
		return c.json({ error: "Invalid payload" }, 400);
	}

	const client = createCloudflareClient(token);

	// Group zones by account
	const zonesByAccount = new Map<string, ZoneState[]>();
	for (const zone of body.zones) {
		const list = zonesByAccount.get(zone.accountId) ?? [];
		list.push({ ...zone, selected: true });
		zonesByAccount.set(zone.accountId, list);
	}

	try {
		for (const [accountId, zones] of zonesByAccount) {
			await cleanupInfrastructure(client, accountId, zones);
		}
		return c.json({ ok: true });
	} catch (err: unknown) {
		return c.json({ error: extractErrorMessage(err) }, 500);
	}
});

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
