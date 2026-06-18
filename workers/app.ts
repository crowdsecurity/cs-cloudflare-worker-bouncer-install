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
	signalKVReset,
	updateTurnstileConfig,
} from "./services/cloudflare/kv.js";
import {
	uploadMainWorker,
	uploadDecisionsSyncWorker,
	updateSyncWorkerCredentials,
	createCronTrigger,
	deleteWorkerScripts,
} from "./services/cloudflare/workers.js";
import { createWorkerRoutes, deleteWorkerRoutes, setFailOpen } from "./services/cloudflare/routes.js";
import {
	createTurnstileWidgets,
	deleteTurnstileWidgets,
	createTurnstileWidgetForDomain,
	deleteTurnstileWidgetForDomain,
} from "./services/cloudflare/turnstile.js";
import { RESOURCE_NAMES, DEFAULTS, type ZoneState, type CloudflareClient } from "./services/cloudflare/types.js";

const app = new Hono();

function extractToken(authHeader: string | undefined): string | null {
	return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

// ─── Progress helpers ─────────────────────────────────────────────────────────

type Progress = (step: string, status: "info" | "success" | "error") => void;

// ─── Operation functions ──────────────────────────────────────────────────────

/**
 * Full install: wipes any existing infra, then creates KV, both workers,
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
	await uninstallAll(client, accountId, zones, () => {});
	progress("Existing infrastructure cleaned", "success");

	progress("Creating KV namespace", "info");
	const kvNamespaceId = await createKVNamespace(client, accountId);
	progress("KV namespace created", "success");

	progress("Writing ban template", "info");
	await writeBanTemplate(client, accountId, kvNamespaceId, DEFAULTS.BAN_TEMPLATE);
	progress("Ban template written", "success");

	progress("Uploading main worker", "info");
	await uploadMainWorker(client, accountId, RESOURCE_NAMES.MAIN_WORKER, kvNamespaceId, zones);
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
 * Does not touch KV or the worker scripts themselves.
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
 * Workers and KV are left intact.
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

	//Removing resources from previous versions of the installer, just in case.
	await cleanupLegacyD1(client, accountId, progress);
}

/**
 * One-time migration shim: deletes the legacy CROWDSECCFBOUNCERDB D1 database
 * if it still exists from a previous install. Logs a warning if the token
 * lacks D1:Edit permission but does not abort the uninstall.
 */
async function cleanupLegacyD1(
	client: CloudflareClient,
	accountId: string,
	progress: Progress,
): Promise<void> {
	const LEGACY_D1_NAME = "CROWDSECCFBOUNCERDB";
	try {
		for await (const db of client.d1.database.list({ account_id: accountId })) {
			if (db.name === LEGACY_D1_NAME && db.uuid) {
				progress(`Removing legacy D1 database ${LEGACY_D1_NAME}`, "info");
				await client.d1.database.delete(db.uuid, { account_id: accountId });
				progress(`Legacy D1 database ${LEGACY_D1_NAME} removed`, "success");
				return;
			}
		}
	} catch {
		progress(`Could not remove legacy D1 database ${LEGACY_D1_NAME} — delete it manually via the dashboard`, "info");
	}
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

app.patch("/crowdsec-credentials", async (c) => {
	const token = extractToken(c.req.header("Authorization"));
	if (!token) return c.json({ error: "Missing API Token" }, 401);

	const body = await c.req.json<{ lapiUrl: string; lapiKey: string; accountId: string }>();
	if (!body.lapiUrl || !body.lapiKey || !body.accountId) {
		return c.json({ error: "Missing lapiUrl, lapiKey or accountId" }, 400);
	}

	try {
		const client = createCloudflareClient(token);

		const updated = await updateSyncWorkerCredentials(client, body.accountId, body.lapiUrl, body.lapiKey);
		if (!updated) return c.json({ error: "Sync worker not found — deploy first" }, 404);

		// Find the KV namespace and signal a reset so the sync worker re-fetches
		// all decisions from the new LAPI on its next cron run.
		let kvId: string | null = null;
		for await (const ns of client.kv.namespaces.list({ account_id: body.accountId })) {
			if (ns.title === RESOURCE_NAMES.KV_NAMESPACE) { kvId = ns.id; break; }
		}
		if (kvId) await signalKVReset(client, body.accountId, kvId);

		return c.json({ ok: true });
	} catch (err: unknown) {
		return c.json({ error: extractErrorMessage(err) }, 400);
	}
});

app.patch("/turnstile-config", async (c) => {
	const token = extractToken(c.req.header("Authorization"));
	if (!token) return c.json({ error: "Missing API Token" }, 401);

	const body = await c.req.json<{
		accountId: string;
		zones: Array<{ domain: string; mode: "managed" | "non-interactive" | "invisible" | "disabled" }>;
	}>();
	if (!body.accountId || !Array.isArray(body.zones) || body.zones.length === 0) {
		return c.json({ error: "Missing accountId or zones" }, 400);
	}

	try {
		const client = createCloudflareClient(token);

		// Find KV namespace
		let kvId: string | null = null;
		for await (const ns of client.kv.namespaces.list({ account_id: body.accountId })) {
			if (ns.title === RESOURCE_NAMES.KV_NAMESPACE) { kvId = ns.id; break; }
		}
		if (!kvId) return c.json({ error: "KV namespace not found — deploy first" }, 404);

		// Process each zone: create or delete widget, build KV update map
		const kvUpdates = new Map<string, { site_key: string; secret: string } | null>();
		const errors: string[] = [];

		for (const zone of body.zones) {
			if (zone.mode === "disabled") {
				await deleteTurnstileWidgetForDomain(client, body.accountId, zone.domain);
				kvUpdates.set(zone.domain, null);
			} else {
				const widget = await createTurnstileWidgetForDomain(client, body.accountId, zone.domain, zone.mode);
				if (widget) {
					kvUpdates.set(zone.domain, { site_key: widget.siteKey, secret: widget.secret });
				} else {
					errors.push(zone.domain);
				}
			}
		}

		await updateTurnstileConfig(client, body.accountId, kvId, kvUpdates);

		return c.json({ ok: true, ...(errors.length > 0 && { failed: errors }) });
	} catch (err: unknown) {
		return c.json({ error: extractErrorMessage(err) }, 400);
	}
});

app.patch("/fail-open", async (c) => {
	const token = extractToken(c.req.header("Authorization"));
	if (!token) return c.json({ error: "Missing API Token" }, 401);

	const body = await c.req.json<{
		failOpen: boolean;
		zones: Array<{ zoneId: string; routesToProtect: string[] }>;
	}>();
	if (typeof body.failOpen !== "boolean" || !Array.isArray(body.zones) || body.zones.length === 0) {
		return c.json({ error: "Missing failOpen or zones" }, 400);
	}

	try {
		const client = createCloudflareClient(token);
		await setFailOpen(
			client,
			body.zones.map((z) => ({ id: z.zoneId, routesToProtect: z.routesToProtect })),
			RESOURCE_NAMES.MAIN_WORKER,
			body.failOpen,
		);
		return c.json({ ok: true });
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
