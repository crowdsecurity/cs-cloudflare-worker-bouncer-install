import type Cloudflare from 'cloudflare';

// Zone information (compatible with existing ZoneInfo interface)
export interface ZoneInfo {
  id: string;
  domain: string;
  accountId: string;
  accountName: string;
  actions: string[];
  defaultAction: string;
  selected: boolean;
}

// Extended zone state with additional configuration
export interface ZoneState extends ZoneInfo {
  routesToProtect: string[];
  turnstile: TurnstileConfig;
}

// Turnstile configuration per zone
export interface TurnstileConfig {
  enabled: boolean;
  mode: 'managed' | 'non-interactive' | 'invisible';
}

// Turnstile widget state after creation
export interface TurnstileWidgetState {
  siteKey: string;
  secret: string;
}

// Account state in session
export interface AccountState {
  id: string;
  name: string;
  zones: ZoneState[];
}

// Deployment state tracking
export interface DeploymentState {
  kvNamespaceId?: string;
  workerScriptName: string;
  decisionsSyncScriptName: string;
  turnstileWidgets: Map<string, TurnstileWidgetState>;
}

// Session state (replaces YAML config)
export interface SessionState {
  cloudflareToken: string;
  crowdsecLapiUrl: string;
  crowdsecLapiKey: string;
  accounts: AccountState[];
  deploymentState: DeploymentState;
}

// Constants for Cloudflare resource names
export const RESOURCE_NAMES = {
  KV_NAMESPACE: 'CROWDSECCFBOUNCERNS',
  AE_DATASET: 'CROWDSECCFBOUNCER_AE',
  MAIN_WORKER: 'crowdsec-cloudflare-worker-bouncer',
  SYNC_WORKER: 'crowdsec-decisions-sync-worker',
  TURNSTILE_WIDGET: 'crowdsec-cloudflare-worker-bouncer-widget',
  BAN_TEMPLATE_KEY: 'BAN_TEMPLATE',
  TURNSTILE_CONFIG_KEY: 'TURNSTILE_CONFIG',

  // Layer 3 (IP Lists) resources — independent from the Layer 7 stack above
  L3_SYNC_WORKER: 'crowdsec-decisions-l3-sync-worker',
  L3_KV_NAMESPACE: 'CROWDSECCFBOUNCERNS-L3',
  L3_D1_DATABASE: 'crowdsec-bouncer',
} as const;

// JS binding variable names the L3 sync worker bundle expects (hardcoded in
// its code, not configurable). The KV binding intentionally shares its name
// with the L7 worker's KV binding — they're different Cloudflare resources
// bound to two different worker scripts, so there's no collision.
export const L3_BINDING_NAMES = {
  KV_BINDING: 'CROWDSECCFBOUNCERNS',
  D1_BINDING: 'LIST_STATE_DB',
  SYNC_MODE_FLAG: 'SYNC_TO_LIST_NOT_KV',
  IP_LIST_PREFIX: 'IP_LIST_PREFIX',
  IP_LIST_BATCH_SIZE: 'IP_LIST_BATCH_SIZE',
} as const;

// Default values
export const DEFAULTS = {
  CRON_SCHEDULE: '*/1 * * * *',
  BAN_TEMPLATE: 'Access Denied',
  DEFAULT_ACTION: 'captcha' as const,
  ACTIONS: ['ban', 'captcha'] as string[],
  TURNSTILE_CONFIG: {
    enabled: true,
    mode: 'managed' as const,
  },

  // Layer 3 defaults (installer UI defaults — the worker's own internal
  // fallback for batch size, 1000, only applies if the binding is absent)
  IP_LIST_PREFIX: 'crowdsec_',
  IP_LIST_BATCH_SIZE: 10000,
} as const;

// Type for the Cloudflare client
export type CloudflareClient = Cloudflare;
