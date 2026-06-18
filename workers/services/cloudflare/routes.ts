import type { CloudflareClient, ZoneState } from './types.js';

/**
 * Create worker routes for all zones.
 * Sets request_limit_fail_open=true so traffic falls through on Worker CPU
 * limit instead of being blocked — this is the recommended setting.
 */
export async function createWorkerRoutes(
  client: CloudflareClient,
  zones: ZoneState[],
  scriptName: string,
): Promise<void> {
  for (const zone of zones) {
    for (const route of zone.routesToProtect) {
      await (client.workers.routes.create as (body: object) => Promise<unknown>)({
        zone_id: zone.id,
        pattern: route,
        script: scriptName,
        request_limit_fail_open: true,
      });
    }
  }
}

/**
 * Set request_limit_fail_open on all bouncer routes for the given zones.
 * Uses PUT on each route so we don't re-create them.
 */
export async function setFailOpen(
  client: CloudflareClient,
  zones: Array<{ id: string; routesToProtect: string[] }>,
  scriptName: string,
  failOpen: boolean,
): Promise<void> {
  for (const zone of zones) {
    for await (const route of client.workers.routes.list({ zone_id: zone.id })) {
      if (route.script === scriptName) {
        await (client.workers.routes.update as (id: string, body: object) => Promise<unknown>)(
          route.id,
          { zone_id: zone.id, pattern: route.pattern, script: route.script, request_limit_fail_open: failOpen },
        );
      }
    }
  }
}

/**
 * Delete worker routes for all zones that are bound to the bouncer script
 */
export async function deleteWorkerRoutes(
  client: CloudflareClient,
  zones: ZoneState[],
  scriptName: string,
): Promise<void> {
  for (const zone of zones) {
    try {
      for await (const route of client.workers.routes.list({ zone_id: zone.id })) {
        if (route.script === scriptName) {
          await client.workers.routes.delete(route.id, { zone_id: zone.id });
        }
      }
    } catch {
      // skip zones we can't list routes for
    }
  }
}
