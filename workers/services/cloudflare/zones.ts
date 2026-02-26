import {
  DEFAULTS as DefaultValues,
  type CloudflareClient,
  type ZoneState,
} from './types.js';

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
