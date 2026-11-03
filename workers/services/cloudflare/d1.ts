import { RESOURCE_NAMES, type CloudflareClient } from './types.js';
import { isNotFoundError } from './client.js';

export const MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS ip_list_state (
		ip TEXT PRIMARY KEY,
		action TEXT NOT NULL,
		until TEXT,
		list_action TEXT NOT NULL,
		list_id TEXT,
		item_id TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_ip_list_state_list_action ON ip_list_state(list_action);
	CREATE INDEX IF NOT EXISTS idx_ip_list_state_list_id ON ip_list_state(list_id);`;

/**
 * Create the D1 database used by the Layer 3 sync worker. Returns its uuid.
 */
export async function createD1Database(
  client: CloudflareClient,
  accountId: string,
  name: string = RESOURCE_NAMES.L3_D1_DATABASE,
): Promise<string> {
  const db = await client.d1.database.create({ account_id: accountId, name });
  if (!db.uuid) throw new Error(`D1 database "${name}" was created but returned no uuid`);
  return db.uuid;
}

/**
 * Find the Layer 3 D1 database by name. Returns its uuid, or null if absent.
 */
export async function findD1Database(
  client: CloudflareClient,
  accountId: string,
  name: string = RESOURCE_NAMES.L3_D1_DATABASE,
): Promise<string | null> {
  for await (const db of client.d1.database.list({ account_id: accountId, name })) {
    if (db.name === name && db.uuid) return db.uuid;
  }
  return null;
}

/**
 * Run the ip_list_state schema migration against the given D1 database.
 * Safe to re-run (CREATE TABLE/INDEX IF NOT EXISTS).
 */
export async function runMigration(
  client: CloudflareClient,
  accountId: string,
  databaseId: string,
): Promise<void> {
  const result = await client.d1.database.query(databaseId, {
    account_id: accountId,
    sql: MIGRATION_SQL,
  });
  // query() returns a paginated result set; draining it lets the SDK
  // actually issue/complete the request even though DDL returns no rows.
  for await (const _ of result) { /* no-op */ }
}

/**
 * Check whether the ip_list_state table already exists in the given D1 database.
 */
export async function checkIpListStateTableExists(
  client: CloudflareClient,
  accountId: string,
  databaseId: string,
): Promise<boolean> {
  const result = await client.d1.database.query(databaseId, {
    account_id: accountId,
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='ip_list_state'",
  });
  for await (const page of result) {
    if ((page.results?.length ?? 0) > 0) return true;
  }
  return false;
}

/**
 * Find and delete the Layer 3 D1 database, if it exists.
 */
export async function findAndDeleteD1Database(
  client: CloudflareClient,
  accountId: string,
  name: string = RESOURCE_NAMES.L3_D1_DATABASE,
): Promise<void> {
  try {
    const databaseId = await findD1Database(client, accountId, name);
    if (databaseId) {
      await client.d1.database.delete(databaseId, { account_id: accountId });
    }
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }
}
