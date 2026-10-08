// Status/result shapes for the Layer 3 (IP Lists) deployment mode.

export interface IpListInfo {
  id: string;
  name: string;
  numItems: number;
}

export interface L3AccountStatus {
  accountId: string;
  accountName: string;
  workerDeployed: boolean;
  kvNamespaceId: string | null;
  d1DatabaseId: string | null;
  /** null = not checked / undetermined (e.g. no D1 database bound yet) */
  d1TableExists: boolean | null;
  lapiUrl: string | null;
  ipListPrefix: string;
  ipListBatchSize: number;
  matchingLists: IpListInfo[];
  /** Every IP-kind list on the account, regardless of name — lets the UI show what exists without a round-trip per prefix change. */
  allLists: IpListInfo[];
}

export interface ConsistencyCheckResult {
  ok: boolean;
  checks: Array<{ name: string; pass: boolean; detail?: string }>;
}
