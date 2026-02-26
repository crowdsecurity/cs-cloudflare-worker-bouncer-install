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
