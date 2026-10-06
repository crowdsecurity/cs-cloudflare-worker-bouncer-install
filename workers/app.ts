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
	findKVNamespace,
	signalKVReset,
	updateTurnstileConfig,
} from "./services/cloudflare/kv.js";
import {
	uploadMainWorker,
	uploadDecisionsSyncWorker,
	updateSyncWorkerCredentials,
	uploadL3SyncWorker,
	updateL3SyncWorkerSettings,
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
import {
	createD1Database,
	findD1Database,
	runMigration,
	checkIpListStateTableExists,
	findAndDeleteD1Database,
} from "./services/cloudflare/d1.js";
import { listAllIpLists, createIpList } from "./services/cloudflare/ip-lists.js";
import type { L3AccountStatus, ConsistencyCheckResult } from "./services/cloudflare/l3-status.js";
import { RESOURCE_NAMES, DEFAULTS, L3_BINDING_NAMES, type ZoneState, type CloudflareClient } from "./services/cloudflare/types.js";

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

/**
 * Full L3 install: wipes any existing L3 infra on this account, then creates
 * a dedicated KV namespace, activates D1 (creating + migrating if needed),
 * uploads the L3 sync worker, and sets up its cron trigger. Does NOT create
 * any Cloudflare IP List — that's a separate, explicit user action since the
 * list name/prefix choice is the user's to make.
 */
async function installL3Worker(
	client: CloudflareClient,
	accountId: string,
	crowdsecApiUrl: string,
	crowdsecApiKey: string,
	ipListPrefix: string,
	ipListBatchSize: number,
	apiToken: string,
	progress: Progress,
): Promise<void> {
	progress("Cleaning existing L3 infrastructure", "info");
	await uninstallL3Worker(client, accountId, () => {});
	progress("Existing L3 infrastructure cleaned", "success");

	progress("Creating L3 KV namespace", "info");
	const kvNamespaceId = await createKVNamespace(client, accountId, RESOURCE_NAMES.L3_KV_NAMESPACE);
	progress("L3 KV namespace created", "success");

	progress("Activating D1 database", "info");
	let d1DatabaseId = await findD1Database(client, accountId, RESOURCE_NAMES.L3_D1_DATABASE);
	if (!d1DatabaseId) d1DatabaseId = await createD1Database(client, accountId, RESOURCE_NAMES.L3_D1_DATABASE);
	await runMigration(client, accountId, d1DatabaseId);
	progress("D1 database ready", "success");

	progress("Uploading L3 sync worker", "info");
	await uploadL3SyncWorker(
		client, accountId, RESOURCE_NAMES.L3_SYNC_WORKER,
		kvNamespaceId, d1DatabaseId, crowdsecApiUrl, crowdsecApiKey, apiToken,
		ipListPrefix, ipListBatchSize,
	);
	progress("L3 sync worker uploaded", "success");

	progress("Creating cron trigger", "info");
	await createCronTrigger(client, accountId, RESOURCE_NAMES.L3_SYNC_WORKER, DEFAULTS.CRON_SCHEDULE);
	progress("Cron trigger created", "success");
}

/**
 * Uninstall the L3 worker, its dedicated KV namespace, and its D1 database.
 * Cloudflare IP Lists matching the configured prefix are deliberately left
 * untouched — they may still be referenced by a firewall rule the user
 * created manually, and deleting them here could silently break it.
 */
async function uninstallL3Worker(
	client: CloudflareClient,
	accountId: string,
	progress: Progress,
): Promise<void> {
	progress("Removing L3 worker script", "info");
	await deleteWorkerScripts(client, accountId, [RESOURCE_NAMES.L3_SYNC_WORKER]);
	progress("L3 worker script removed", "success");

	progress("Removing L3 KV namespace", "info");
	await findAndDeleteKVNamespace(client, accountId, RESOURCE_NAMES.L3_KV_NAMESPACE);
	progress("L3 KV namespace removed", "success");

	progress("Removing L3 D1 database", "info");
	await findAndDeleteD1Database(client, accountId, RESOURCE_NAMES.L3_D1_DATABASE);
	progress("L3 D1 database removed", "success");
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

	// Partial update: only fields present here are changed on the deployed
	// worker (see updateSyncWorkerCredentials — unset fields are inherited
	// unchanged from the worker's current version).
	const body = await c.req.json<{ accountId: string; lapiUrl?: string; lapiKey?: string }>();
	if (!body.accountId || (body.lapiUrl === undefined && body.lapiKey === undefined)) {
		return c.json({ error: "Missing accountId, or nothing to update (lapiUrl/lapiKey)" }, 400);
	}

	try {
		const client = createCloudflareClient(token);

		// Find the KV namespace first — needed both to pass the full binding set
		// to updateSyncWorkerCredentials and to signal a KV reset afterward.
		let kvId: string | null = null;
		for await (const ns of client.kv.namespaces.list({ account_id: body.accountId })) {
			if (ns.title === RESOURCE_NAMES.KV_NAMESPACE) { kvId = ns.id; break; }
		}
		if (!kvId) return c.json({ error: "KV namespace not found — deploy first" }, 404);

		const updated = await updateSyncWorkerCredentials(client, body.accountId, kvId, token, {
			lapiUrl: body.lapiUrl, lapiKey: body.lapiKey,
		});
		if (!updated) return c.json({ error: "Sync worker not found — deploy first" }, 404);

		await signalKVReset(client, body.accountId, kvId);

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

// ─── Layer 3 (IP Lists) endpoints ────────────────────────────────────────────

/**
 * Read the L3 sync worker's current bindings for one account. Returns null
 * if the worker isn't deployed on this account.
 */
async function readL3WorkerBindings(
	client: CloudflareClient,
	accountId: string,
): Promise<{ lapiUrl: string | null; ipListPrefix: string; ipListBatchSize: number } | null> {
	try {
		const settings = await client.workers.scripts.scriptAndVersionSettings.get(
			RESOURCE_NAMES.L3_SYNC_WORKER, { account_id: accountId },
		);
		const bindings = (settings.bindings ?? []) as Array<{ type: string; name: string; text?: string }>;
		const findText = (name: string) => bindings.find((b) => b.type === "plain_text" && b.name === name)?.text;
		return {
			lapiUrl: findText("LAPI_URL") ?? null,
			ipListPrefix: findText(L3_BINDING_NAMES.IP_LIST_PREFIX) ?? DEFAULTS.IP_LIST_PREFIX,
			ipListBatchSize: parseInt(findText(L3_BINDING_NAMES.IP_LIST_BATCH_SIZE) ?? "", 10) || DEFAULTS.IP_LIST_BATCH_SIZE,
		};
	} catch {
		return null;
	}
}

/**
 * Build the full L3AccountStatus for one account. D1/KV/IP-Lists are always
 * checked regardless of whether the sync worker itself is deployed yet —
 * D1 activation and list creation/discovery are both usable pre-install.
 * `deployed` is the caller's cheap worker-script-list check, passed in so
 * this doesn't re-issue that same scripts.list call.
 */
async function buildL3AccountStatus(
	client: CloudflareClient,
	accountId: string,
	accountName: string,
	deployed: boolean,
): Promise<L3AccountStatus> {
	const workerBindings = deployed ? await readL3WorkerBindings(client, accountId) : null;

	const kvNamespaceId = await findKVNamespace(client, accountId, RESOURCE_NAMES.L3_KV_NAMESPACE);
	const d1DatabaseId = await findD1Database(client, accountId, RESOURCE_NAMES.L3_D1_DATABASE);
	const d1TableExists = d1DatabaseId ? await checkIpListStateTableExists(client, accountId, d1DatabaseId) : null;

	const ipListPrefix = workerBindings?.ipListPrefix ?? DEFAULTS.IP_LIST_PREFIX;
	const allLists = await listAllIpLists(client, accountId);
	const matchingLists = allLists.filter((l) => l.name.startsWith(ipListPrefix));

	return {
		accountId,
		accountName,
		workerDeployed: workerBindings !== null,
		kvNamespaceId,
		d1DatabaseId,
		d1TableExists,
		lapiUrl: workerBindings?.lapiUrl ?? null,
		ipListPrefix,
		ipListBatchSize: workerBindings?.ipListBatchSize ?? DEFAULTS.IP_LIST_BATCH_SIZE,
		matchingLists,
		allLists,
	};
}

app.get("/l3-status", async (c) => {
	const token = extractToken(c.req.header("Authorization"));
	if (!token) return c.json({ error: "Missing API Token" }, 401);
	try {
		const client = createCloudflareClient(token);
		const accounts: L3AccountStatus[] = [];
		for await (const account of client.accounts.list()) {
			// Cheap check first: does this account have the L3 worker script at all?
			let deployed = false;
			try {
				for await (const script of client.workers.scripts.list({ account_id: account.id })) {
					if (script.id === RESOURCE_NAMES.L3_SYNC_WORKER) { deployed = true; break; }
				}
			} catch { /* skip */ }

			accounts.push(await buildL3AccountStatus(client, account.id, account.name, deployed));
		}
		return c.json({ accounts });
	} catch (err: unknown) {
		return c.json({ error: extractErrorMessage(err) }, 400);
	}
});

app.get("/l3-consistency-check", async (c) => {
	const token = extractToken(c.req.header("Authorization"));
	if (!token) return c.json({ error: "Missing API Token" }, 401);
	const accountId = c.req.query("accountId");
	if (!accountId) return c.json({ error: "Missing accountId" }, 400);

	try {
		const client = createCloudflareClient(token);
		let deployed = false;
		try {
			for await (const script of client.workers.scripts.list({ account_id: accountId })) {
				if (script.id === RESOURCE_NAMES.L3_SYNC_WORKER) { deployed = true; break; }
			}
		} catch { /* skip */ }
		const status = await buildL3AccountStatus(client, accountId, "", deployed);

		const checks: ConsistencyCheckResult["checks"] = [
			{
				name: "L3 sync worker deployed",
				pass: status.workerDeployed,
				detail: status.workerDeployed ? undefined : "Worker script not found — install it first",
			},
			{
				name: "KV namespace bound",
				pass: status.kvNamespaceId !== null,
				detail: status.kvNamespaceId ? undefined : "No KV namespace found for this account",
			},
			{
				name: "D1 database bound and migrated",
				pass: status.d1DatabaseId !== null && status.d1TableExists === true,
				detail: !status.d1DatabaseId
					? "D1 database not found — activate it first"
					: status.d1TableExists !== true
						? "ip_list_state table not found in the D1 database"
						: undefined,
			},
			{
				name: "At least one matching IP list exists",
				pass: status.matchingLists.length > 0,
				detail: status.matchingLists.length > 0
					? undefined
					: `No IP List found matching prefix "${status.ipListPrefix}" — create one before continuing`,
			},
		];

		const result: ConsistencyCheckResult = { ok: checks.every((ch) => ch.pass), checks };
		return c.json(result);
	} catch (err: unknown) {
		return c.json({ error: extractErrorMessage(err) }, 400);
	}
});

app.post("/l3-ip-lists", async (c) => {
	const token = extractToken(c.req.header("Authorization"));
	if (!token) return c.json({ error: "Missing API Token" }, 401);

	const body = await c.req.json<{ accountId: string; name: string }>();
	if (!body.accountId || !body.name) return c.json({ error: "Missing accountId or name" }, 400);
	if (!/^[a-z0-9_]+$/.test(body.name)) {
		return c.json({ error: "List name must contain only lowercase letters, digits and underscores" }, 400);
	}

	try {
		const client = createCloudflareClient(token);
		const list = await createIpList(client, body.accountId, body.name);
		return c.json({ ok: true, list });
	} catch (err: unknown) {
		return c.json({ error: extractErrorMessage(err) }, 400);
	}
});

app.post("/l3-activate-d1", async (c) => {
	const token = extractToken(c.req.header("Authorization"));
	if (!token) return c.json({ error: "Missing API Token" }, 401);

	const body = await c.req.json<{ accountId: string }>();
	if (!body.accountId) return c.json({ error: "Missing accountId" }, 400);

	try {
		const client = createCloudflareClient(token);
		let databaseId = await findD1Database(client, body.accountId, RESOURCE_NAMES.L3_D1_DATABASE);
		if (!databaseId) databaseId = await createD1Database(client, body.accountId, RESOURCE_NAMES.L3_D1_DATABASE);
		await runMigration(client, body.accountId, databaseId);
		return c.json({ ok: true, databaseId });
	} catch (err: unknown) {
		return c.json({ error: extractErrorMessage(err) }, 400);
	}
});

app.patch("/l3-settings", async (c) => {
	const token = extractToken(c.req.header("Authorization"));
	if (!token) return c.json({ error: "Missing API Token" }, 401);

	// Partial update: only fields present here are changed on the deployed
	// worker (see updateL3SyncWorkerSettings — unset fields are inherited
	// unchanged from the worker's current version).
	const body = await c.req.json<{
		accountId: string; lapiUrl?: string; lapiKey?: string; ipListPrefix?: string; ipListBatchSize?: number;
	}>();
	const hasChange = body.lapiUrl !== undefined || body.lapiKey !== undefined
		|| body.ipListPrefix !== undefined || body.ipListBatchSize !== undefined;
	if (!body.accountId || !hasChange) {
		return c.json({ error: "Missing accountId, or nothing to update" }, 400);
	}

	try {
		const client = createCloudflareClient(token);

		const kvId = await findKVNamespace(client, body.accountId, RESOURCE_NAMES.L3_KV_NAMESPACE);
		if (!kvId) return c.json({ error: "L3 KV namespace not found — deploy first" }, 404);

		const d1Id = await findD1Database(client, body.accountId, RESOURCE_NAMES.L3_D1_DATABASE);
		if (!d1Id) return c.json({ error: "L3 D1 database not found — deploy first" }, 404);

		const updated = await updateL3SyncWorkerSettings(client, body.accountId, kvId, d1Id, token, {
			lapiUrl: body.lapiUrl, lapiKey: body.lapiKey,
			ipListPrefix: body.ipListPrefix, ipListBatchSize: body.ipListBatchSize,
		});
		if (!updated) return c.json({ error: "L3 sync worker not found — deploy first" }, 404);

		await signalKVReset(client, body.accountId, kvId);

		return c.json({ ok: true });
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
	| { op: "uninstall_all";   token: string; accountId: string; zones: FrontendZone[] }
	| { op: "install_l3_worker";   token: string; accountId: string; crowdsecApiUrl: string; crowdsecApiKey: string; ipListPrefix: string; ipListBatchSize: number }
	| { op: "uninstall_l3_worker"; token: string; accountId: string };

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

			} else if (msg.op === "install_l3_worker") {
				const client = createCloudflareClient(msg.token);
				await installL3Worker(
					client, msg.accountId, msg.crowdsecApiUrl, msg.crowdsecApiKey,
					msg.ipListPrefix, msg.ipListBatchSize, msg.token, send,
				);

			} else if (msg.op === "uninstall_l3_worker") {
				const client = createCloudflareClient(msg.token);
				await uninstallL3Worker(client, msg.accountId, send);

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
