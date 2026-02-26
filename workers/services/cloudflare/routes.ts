import type { CloudflareClient, ZoneState } from './types.js';

/**
 * Create worker routes for all zones
 */
export async function createWorkerRoutes(
  client: CloudflareClient,
  zones: ZoneState[],
  scriptName: string,
): Promise<void> {
  for (const zone of zones) {
    for (const route of zone.routesToProtect) {
      await client.workers.routes.create({
        zone_id: zone.id,
        pattern: route,
        script: scriptName,
      });
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
