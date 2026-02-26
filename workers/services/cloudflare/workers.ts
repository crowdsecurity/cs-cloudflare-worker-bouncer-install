import { toFile } from 'cloudflare';
import {
  RESOURCE_NAMES,
  DEFAULTS,
  type CloudflareClient,
  type ZoneState,
} from './types.js';
import { isNotFoundError } from './client.js';
import { getMainWorkerScript, getDecisionsSyncWorkerScript } from '../../../workers/assets/workers/index.js';

// Type for worker bindings
type WorkerBinding =
  | { type: 'kv_namespace'; name: string; namespace_id: string }
  | { type: 'plain_text'; name: string; text: string }
  | { type: 'secret_text'; name: string; text: string }
  | { type: 'd1'; name: string; id: string };

/**
 * Upload the main bouncer worker
 */
export async function uploadMainWorker(
  client: CloudflareClient,
  accountId: string,
  scriptName: string,
  kvNamespaceId: string,
  d1DatabaseId: string | null,
  zones: ZoneState[],
): Promise<void> {

  // Build ACTIONS_BY_DOMAIN binding
  // Format: { "domain.com": { "supported_actions": ["ban", "captcha"], "default_action": "captcha" } }
  const actionsByDomain: Record<
    string,
    { supported_actions: string[]; default_action: string }
  > = {};
  for (const zone of zones) {
    actionsByDomain[zone.domain] = {
      supported_actions: zone.actions,
      default_action: zone.defaultAction,
    };
  }

  // Build bindings array
  const bindings: WorkerBinding[] = [
    {
      type: 'kv_namespace',
      name: RESOURCE_NAMES.KV_NAMESPACE,
      namespace_id: kvNamespaceId,
    },
    {
      type: 'plain_text',
      name: 'ACTIONS_BY_DOMAIN',
      text: JSON.stringify(actionsByDomain),
    },
    {
      type: 'plain_text',
      name: 'LOG_ONLY',
      text: 'false',
    },
  ];

  // Add D1 binding if database was created
  if (d1DatabaseId) {
    bindings.push({
      type: 'd1',
      name: RESOURCE_NAMES.D1_DATABASE,
      id: d1DatabaseId,
    });
  }

  // Create worker file with ES module content type
  const workerFile = await toFile(
    new Blob([getMainWorkerScript()], { type: 'application/javascript+module' }),
    'worker.js',
    { type: 'application/javascript+module' }
  );

  await client.workers.scripts.update(scriptName, {
    account_id: accountId,
    metadata: {
      main_module: 'worker.js',
      compatibility_date: '2024-01-01',
      bindings: bindings,
    },
    files: [workerFile],
  });
}

/**
 * Upload the decisions sync worker (for autonomous mode)
 */
export async function uploadDecisionsSyncWorker(
  client: CloudflareClient,
  accountId: string,
  scriptName: string,
  kvNamespaceId: string,
  lapiUrl: string,
  lapiKey: string,
  cfApiToken: string,
): Promise<void> {

  // Build bindings for sync worker
  const bindings: WorkerBinding[] = [
    {
      type: 'kv_namespace',
      name: RESOURCE_NAMES.KV_NAMESPACE,
      namespace_id: kvNamespaceId,
    },
    {
      type: 'plain_text',
      name: 'LAPI_URL',
      text: lapiUrl,
    },
    {
      type: 'secret_text',
      name: 'LAPI_KEY',
      text: lapiKey,
    },
    {
      type: 'plain_text',
      name: 'CF_ACCOUNT_ID',
      text: accountId,
    },
    {
      type: 'plain_text',
      name: 'CF_KV_NAMESPACE_ID',
      text: kvNamespaceId,
    },
    {
      type: 'secret_text',
      name: 'CF_API_TOKEN',
      text: cfApiToken,
    },
  ];

  // Create worker file with ES module content type
  const workerFile = await toFile(
    new Blob([getDecisionsSyncWorkerScript()], { type: 'application/javascript+module' }),
    'worker.js',
    { type: 'application/javascript+module' }
  );

  await client.workers.scripts.update(scriptName, {
    account_id: accountId,
    metadata: {
      main_module: 'worker.js',
      compatibility_date: '2024-01-01',
      bindings: bindings,
    },
    files: [workerFile],
  });
}

/**
 * Set up cron trigger for the sync worker
 */
export async function createCronTrigger(
  client: CloudflareClient,
  accountId: string,
  scriptName: string,
  cron: string = DEFAULTS.CRON_SCHEDULE,
): Promise<void> {

  await client.workers.scripts.schedules.update(scriptName, {
    account_id: accountId,
    body: [{ cron }],
  });
}

/**
 * Delete worker scripts
 */
export async function deleteWorkerScripts(
  client: CloudflareClient,
  accountId: string,
  scriptNames: string[],
): Promise<void> {
  for (const scriptName of scriptNames) {
    try {
      await client.workers.scripts.delete(scriptName, { account_id: accountId });
    } catch (err) {
      if (!isNotFoundError(err)) {
        throw err;
      }
    }
  }
}
