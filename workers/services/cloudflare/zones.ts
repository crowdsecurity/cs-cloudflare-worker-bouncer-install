import {
  DEFAULTS as DefaultValues,
  RESOURCE_NAMES,
  type CloudflareClient,
  type ZoneState,
} from './types.js';

export interface ZoneProtectionStatus {
  zoneId: string;
  domain: string;
  accountId: string;
  accountName: string;
  bound: boolean;
  kvId: string | null;
  turnstileWidgetId: string | null;
  routesToProtect: string[];
  routeIds: string[];
  actions: string[];
  defaultAction: string;
  /** null = not bound / unknown; true/false = read from request_limit_fail_open */
  failOpen: boolean | null;
}

export interface AccountStatus {
  accountId: string;
  accountName: string;
  kvId: string | null;
  zones: ZoneProtectionStatus[];
}

/**
 * Detect which zones already have the CrowdSec bouncer deployed.
 * Returns per-account status including KV/D1 IDs and per-zone binding state.
 */
export async function detectProtectionStatus(
  client: CloudflareClient,
): Promise<AccountStatus[]> {
  // Collect accounts
  const accounts: Array<{ id: string; name: string }> = [];
  for await (const account of client.accounts.list()) {
    accounts.push({ id: account.id, name: account.name });
  }

  const result: AccountStatus[] = [];

  for (const account of accounts) {
    const accountName = account.name.replace(/'s Account$/, '');

    // Find KV namespace
    let kvId: string | null = null;
    try {
      for await (const ns of client.kv.namespaces.list({ account_id: account.id })) {
        if (ns.title === RESOURCE_NAMES.KV_NAMESPACE) { kvId = ns.id; break; }
      }
    } catch { /* skip */ }

    // Find Turnstile widgets (map domain → sitekey)
    const turnstileByDomain = new Map<string, string>();
    try {
      for await (const widget of client.turnstile.widgets.list({ account_id: account.id })) {
        if (widget.name === RESOURCE_NAMES.TURNSTILE_WIDGET) {
          for (const domain of (widget.domains ?? [])) {
            turnstileByDomain.set(domain, widget.sitekey);
          }
        }
      }
    } catch { /* skip */ }

    // List zones
    const zones: ZoneProtectionStatus[] = [];
    try {
      for await (const zone of client.zones.list({ account: { id: account.id } })) {
        // Check if the main bouncer route is bound to this zone
        let bound = false;
        const routesToProtect: string[] = [];
        const routeIds: string[] = [];
        let failOpen: boolean | null = null;
        try {
          for await (const route of client.workers.routes.list({ zone_id: zone.id })) {
            if (route.script === RESOURCE_NAMES.MAIN_WORKER) {
              bound = true;
              routesToProtect.push(route.pattern);
              routeIds.push(route.id);
              const fo = (route as Record<string, unknown>).request_limit_fail_open;
              if (typeof fo === 'boolean') failOpen = fo;
            }
          }
        } catch { /* skip */ }

        zones.push({
          zoneId: zone.id,
          domain: zone.name,
          accountId: account.id,
          accountName,
          bound,
          kvId,
          turnstileWidgetId: turnstileByDomain.get(zone.name) ?? null,
          routesToProtect: routesToProtect.length > 0 ? routesToProtect : [`*${zone.name}/*`],
          routeIds,
          actions: [...DefaultValues.ACTIONS],
          defaultAction: DefaultValues.DEFAULT_ACTION,
          failOpen: bound ? failOpen : null,
        });
      }
    } catch { /* skip */ }

    if (zones.length > 0) {
      result.push({ accountId: account.id, accountName, kvId, zones });
    }
  }

  return result;
}

/**
 * Discover all zones accessible with the given Cloudflare token
 * Returns zones that have A or AAAA DNS records (i.e., zones that serve web traffic)
 */
export async function discoverZones(
  client: CloudflareClient,
): Promise<ZoneState[]> {
  const zones: ZoneState[] = [];

  // List all accounts accessible with the token
  const accounts: Array<{ id: string; name: string }> = [];
  for await (const account of client.accounts.list()) {
    accounts.push({ id: account.id, name: account.name });
  }

  // List zones for each account
  for (const account of accounts) {

    try {
      // List all zones in the account
      for await (const zone of client.zones.list({ account: { id: account.id } })) {
        // Check if zone has A or AAAA records (serves web traffic)
        let hasWebRecords = false;
        try {
          for await (const record of client.dns.records.list({ zone_id: zone.id })) {
            if (record.type === 'A' || record.type === 'AAAA') {
              hasWebRecords = true;
              break;
            }
          }
        } catch (_err) {
          // If we can't list DNS records, assume the zone is usable
          hasWebRecords = true;
        }

        // Clean up account name (remove "'s Account" suffix)
        const accountName = account.name.replace(/'s Account$/, '');

        zones.push({
          id: zone.id,
          domain: zone.name,
          accountId: account.id,
          accountName: accountName,
          selected: true,
          actions: [...DefaultValues.ACTIONS],
          defaultAction: DefaultValues.DEFAULT_ACTION,
          routesToProtect: [`*${zone.name}/*`],
          turnstile: { ...DefaultValues.TURNSTILE_CONFIG },
        });
      }
    } catch (err) {
      // If we can't list zones for an account, skip it
    }
  }

  return zones;
}
