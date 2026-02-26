import {
  RESOURCE_NAMES,
  type CloudflareClient,
  type ZoneState,
  type TurnstileWidgetState,
} from './types.js';

/**
 * Create Turnstile widgets for zones that have Turnstile enabled
 */
export async function createTurnstileWidgets(
  client: CloudflareClient,
  accountId: string,
  zones: ZoneState[],
): Promise<Map<string, TurnstileWidgetState>> {
  const widgets = new Map<string, TurnstileWidgetState>();

  for (const zone of zones.filter((z) => z.turnstile.enabled)) {
    try {
      const response = await client.turnstile.widgets.create({
        account_id: accountId,
        name: RESOURCE_NAMES.TURNSTILE_WIDGET,
        domains: [zone.domain],
        mode: zone.turnstile.mode,
      });
      widgets.set(zone.domain, { siteKey: response.sitekey, secret: response.secret });
    } catch {
      // skip zones where widget creation fails
    }
  }

  return widgets;
}

/**
 * Delete all Turnstile widgets created by the bouncer
 */
export async function deleteTurnstileWidgets(
  client: CloudflareClient,
  accountId: string,
): Promise<void> {
  try {
    for await (const widget of client.turnstile.widgets.list({ account_id: accountId })) {
      if (widget.name === RESOURCE_NAMES.TURNSTILE_WIDGET) {
        await client.turnstile.widgets.delete(widget.sitekey, { account_id: accountId });
      }
    }
  } catch {
    // best-effort cleanup
  }
}
