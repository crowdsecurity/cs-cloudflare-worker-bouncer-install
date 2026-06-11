import {
  RESOURCE_NAMES,
  DEFAULTS,
  type CloudflareClient,
  type TurnstileWidgetState,
} from './types.js';
import { isNotFoundError } from './client.js';

/**
 * Create a KV namespace for the bouncer
 */
export async function createKVNamespace(
  client: CloudflareClient,
  accountId: string,
): Promise<string> {
  const response = await client.kv.namespaces.create({
    account_id: accountId,
    title: RESOURCE_NAMES.KV_NAMESPACE,
  });
  return response.id;
}

/**
 * Write the ban template to KV
 */
export async function writeBanTemplate(
  client: CloudflareClient,
  accountId: string,
  namespaceId: string,
  template: string = DEFAULTS.BAN_TEMPLATE,
): Promise<void> {
  await client.kv.namespaces.values.update(
    namespaceId,
    RESOURCE_NAMES.BAN_TEMPLATE_KEY,
    {
      account_id: accountId,
      value: template,
      metadata: JSON.stringify({}),
    }
  );
}

/**
 * Write Turnstile configuration to KV
 */
export async function writeTurnstileConfig(
  client: CloudflareClient,
  accountId: string,
  namespaceId: string,
  widgets: Map<string, TurnstileWidgetState>,
): Promise<void> {
  if (widgets.size === 0) return;

  const config: Record<string, { site_key: string; secret: string }> = {};
  for (const [domain, widget] of widgets) {
    config[domain] = { site_key: widget.siteKey, secret: widget.secret };
  }

  await client.kv.namespaces.values.update(
    namespaceId,
    RESOURCE_NAMES.TURNSTILE_CONFIG_KEY,
    {
      account_id: accountId,
      value: JSON.stringify(config),
      metadata: JSON.stringify({}),
    }
  );
}

type TurnstileKVConfig = Record<string, { site_key: string; secret: string }>;

/**
 * Read the current TURNSTILE_CONFIG from KV. Returns an empty object if absent.
 */
export async function readTurnstileConfig(
  client: CloudflareClient,
  accountId: string,
  namespaceId: string,
): Promise<TurnstileKVConfig> {
  try {
    const res = await client.kv.namespaces.values.get(
      namespaceId,
      RESOURCE_NAMES.TURNSTILE_CONFIG_KEY,
      { account_id: accountId },
    );
    const text = typeof res === 'string' ? res : await (res as Response).text();
    return JSON.parse(text) as TurnstileKVConfig;
  } catch {
    return {};
  }
}

/**
 * Merge updates into the existing TURNSTILE_CONFIG in KV.
 * Pass null as the widget value for a domain to remove it.
 */
export async function updateTurnstileConfig(
  client: CloudflareClient,
  accountId: string,
  namespaceId: string,
  updates: Map<string, { site_key: string; secret: string } | null>,
): Promise<void> {
  const current = await readTurnstileConfig(client, accountId, namespaceId);

  for (const [domain, widget] of updates) {
    if (widget === null) {
      delete current[domain];
    } else {
      current[domain] = widget;
    }
  }

  await client.kv.namespaces.values.update(
    namespaceId,
    RESOURCE_NAMES.TURNSTILE_CONFIG_KEY,
    {
      account_id: accountId,
      value: JSON.stringify(current),
      metadata: JSON.stringify({}),
    },
  );
}

/**
 * Signal the sync worker to reset KV decisions on its next cron run.
 * Sets RESET=true and clears WARMED_UP so the worker re-fetches all decisions
 * from LAPI from scratch. BAN_TEMPLATE and TURNSTILE_CONFIG are preserved by
 * the worker during reset.
 */
export async function signalKVReset(
  client: CloudflareClient,
  accountId: string,
  namespaceId: string,
): Promise<void> {
  await client.kv.namespaces.values.update(namespaceId, 'RESET', {
    account_id: accountId,
    value: 'true',
    metadata: JSON.stringify({}),
  });
  await client.kv.namespaces.values.update(namespaceId, 'WARMED_UP', {
    account_id: accountId,
    value: 'false',
    metadata: JSON.stringify({}),
  });
}

/**
 * Find and delete the bouncer's KV namespace
 */
export async function findAndDeleteKVNamespace(
  client: CloudflareClient,
  accountId: string,
): Promise<void> {
  try {
    for await (const ns of client.kv.namespaces.list({ account_id: accountId })) {
      if (ns.title === RESOURCE_NAMES.KV_NAMESPACE) {
        await client.kv.namespaces.delete(ns.id, { account_id: accountId });
      }
    }
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }
}
