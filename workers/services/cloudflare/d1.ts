import { RESOURCE_NAMES, type CloudflareClient } from './types.js';
import { isNotFoundError } from './client.js';
import { METRICS_SQL } from '../../../workers/assets/workers/index.js';

/**
 * Create a D1 database for metrics storage
 * Returns the database ID if successful, null if creation failed (non-critical)
 */
export async function createD1Database(
  client: CloudflareClient,
  accountId: string,
): Promise<string | null> {
  const response = await client.d1.database.create({
    account_id: accountId,
    name: RESOURCE_NAMES.D1_DATABASE,
  });

  const databaseId = response.uuid;
  if (!databaseId) {
    throw new Error('D1 database created but no UUID returned');
  }

  await client.d1.database.query(databaseId, {
    account_id: accountId,
    sql: METRICS_SQL,
  });

  return databaseId;
}

/**
 * Find and delete the bouncer's D1 database
 */
export async function findAndDeleteD1Database(
  client: CloudflareClient,
  accountId: string,
): Promise<void> {
  try {
    for await (const db of client.d1.database.list({ account_id: accountId })) {
      if (db.name === RESOURCE_NAMES.D1_DATABASE && db.uuid) {
        await client.d1.database.delete(db.uuid, { account_id: accountId });
      }
    }
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }
}
