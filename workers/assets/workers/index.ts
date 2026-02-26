/**
 * Worker script loader
 * Bundles are inlined at build time via Vite's ?raw imports
 */

import mainWorkerBundle from './main-worker-bundle.js?raw';
import decisionsSyncWorkerBundle from './decisions-sync-worker-bundle.js?raw';

/**
 * Get the main bouncer worker script
 * This worker handles incoming requests and applies remediations (ban, captcha)
 *
 * Source: https://github.com/crowdsecurity/cs-cloudflare-worker-bouncer
 * The bundle is copied from: pkg/cloudflare/worker/dist/main.js
 * To update: rebuild the Go repo and copy the new bundle here
 */
export function getMainWorkerScript(): string {
  return mainWorkerBundle;
}

/**
 * Get the decisions sync worker script
 * This worker syncs decisions from CrowdSec LAPI to Cloudflare KV on a cron schedule
 *
 * Source: https://github.com/crowdsecurity/cs-cloudflare-worker-bouncer
 * The bundle is copied from: pkg/cloudflare/decisions-sync-worker/dist/main.js
 * To update: rebuild the Go repo and copy the new bundle here
 */
export function getDecisionsSyncWorkerScript(): string {
  return decisionsSyncWorkerBundle;
}

export { METRICS_SQL } from './metrics-schema.js';
