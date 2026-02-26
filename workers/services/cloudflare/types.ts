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
  d1DatabaseId?: string;
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
  D1_DATABASE: 'CROWDSECCFBOUNCERDB',
  MAIN_WORKER: 'crowdsec-cloudflare-worker-bouncer',
  SYNC_WORKER: 'crowdsec-decisions-sync-worker',
  TURNSTILE_WIDGET: 'crowdsec-cloudflare-worker-bouncer-widget',
  BAN_TEMPLATE_KEY: 'BAN_TEMPLATE',
  TURNSTILE_CONFIG_KEY: 'TURNSTILE_CONFIG',
} as const;

// Default values
export const DEFAULTS = {
  CRON_SCHEDULE: '*/5 * * * *',
  BAN_TEMPLATE: 'Access Denied',
  DEFAULT_ACTION: 'captcha' as const,
  ACTIONS: ['ban', 'captcha'] as string[],
  TURNSTILE_CONFIG: {
    enabled: true,
    mode: 'managed' as const,
  },
} as const;

// Type for the Cloudflare client
export type CloudflareClient = Cloudflare;
