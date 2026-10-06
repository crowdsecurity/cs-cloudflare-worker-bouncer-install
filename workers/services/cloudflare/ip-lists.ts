import { type CloudflareClient } from './types.js';
import { type IpListInfo } from './l3-status.js';

/**
 * List every Cloudflare IP List ("kind: ip") on the account, regardless of
 * name — used to show the user what already exists (e.g. to pick a prefix
 * that matches nothing by accident).
 */
export async function listAllIpLists(
  client: CloudflareClient,
  accountId: string,
): Promise<IpListInfo[]> {
  const lists: IpListInfo[] = [];
  for await (const list of client.rules.lists.list({ account_id: accountId })) {
    if (list.kind === 'ip') {
      lists.push({ id: list.id, name: list.name, numItems: list.num_items });
    }
  }
  return lists;
}

/**
 * Create a new Cloudflare IP List.
 */
export async function createIpList(
  client: CloudflareClient,
  accountId: string,
  name: string,
): Promise<IpListInfo> {
  const list = await client.rules.lists.create({
    account_id: accountId,
    kind: 'ip',
    name,
  });
  return { id: list.id, name: list.name, numItems: list.num_items };
}
