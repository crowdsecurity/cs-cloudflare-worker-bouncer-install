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
  | { type: 'analytics_engine'; name: string; dataset: string }
  | { type: 'plain_text'; name: string; text: string }
  | { type: 'secret_text'; name: string; text: string };

/**
 * Upload the main bouncer worker
 */
export async function uploadMainWorker(
  client: CloudflareClient,
  accountId: string,
  scriptName: string,
  kvNamespaceId: string,
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
      type: 'analytics_engine',
      name: RESOURCE_NAMES.AE_DATASET,
      dataset: RESOURCE_NAMES.AE_DATASET,
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

  const workerFile = await toFile(
    new Blob([getMainWorkerScript()], { type: 'application/javascript+module' }),
    'worker.js',
    { type: 'application/javascript+module' }
  );

  const upload = (b: WorkerBinding[]) => client.workers.scripts.update(scriptName, {
    account_id: accountId,
    metadata: { main_module: 'worker.js', compatibility_date: '2024-01-01', bindings: b },
    files: [workerFile],
  });

  try {
    await upload(bindings);
  } catch (err) {
    // Analytics Engine may not be enabled on this account. Retry without the
    // AE binding — metrics will be silently skipped by the worker (it guards
    // with `if (!env.CROWDSECCFBOUNCER_AE) return`).
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes('analytics')) throw err;
    await upload(bindings.filter((b) => b.type !== 'analytics_engine'));
  }
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
 * Update LAPI_URL and LAPI_KEY on an already-deployed sync worker without
 * re-uploading the script. Returns false if the worker does not exist.
 */
export async function updateSyncWorkerCredentials(
  client: CloudflareClient,
  accountId: string,
  lapiUrl: string,
  lapiKey: string,
): Promise<boolean> {
  try {
    await client.workers.scripts.scriptAndVersionSettings.edit(RESOURCE_NAMES.SYNC_WORKER, {
      account_id: accountId,
      settings: {
        bindings: [
          { type: 'plain_text', name: 'LAPI_URL', text: lapiUrl },
          { type: 'secret_text', name: 'LAPI_KEY', text: lapiKey },
        ],
      },
    });
    return true;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throw err;
  }
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

export interface CrowdsecWorkerInfo {
  name: string;
  createdOn: string | null;
  modifiedOn: string | null;
}

/**
 * List all workers whose name starts with "crowdsec" across all accounts
 */
export async function listCrowdsecWorkers(
  client: CloudflareClient,
): Promise<CrowdsecWorkerInfo[]> {
  const result: CrowdsecWorkerInfo[] = [];
  for await (const account of client.accounts.list()) {
    try {
      for await (const script of client.workers.scripts.list({ account_id: account.id })) {
        if (script.id?.startsWith('crowdsec')) {
          result.push({
            name: script.id,
            createdOn: script.created_on ?? null,
            modifiedOn: script.modified_on ?? null,
          });
        }
      }
    } catch { /* skip accounts we can't access */ }
  }
  return result;
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
