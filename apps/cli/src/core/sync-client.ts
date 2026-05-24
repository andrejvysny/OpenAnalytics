import type { Session, SyncRequest } from '@oa/schema';

export interface SyncOptions {
  apiUrl: string;
  apiKey: string;
  workspaceId: string | null;
}

export async function postSync(
  opts: SyncOptions,
  sessions: Session[],
  attempt = 1,
): Promise<{ accepted: number; ignored: number }> {
  const body: SyncRequest = { workspace_id: opts.workspaceId, sessions };
  const res = await fetch(`${opts.apiUrl}/api/sync`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.apiKey}`,
      'content-type': 'application/json',
      'x-oa-cli-version': '0.1.0',
    },
    body: JSON.stringify(body),
  });
  if (res.status === 200) {
    return (await res.json()) as { accepted: number; ignored: number };
  }
  if (res.status >= 500 && attempt < 6) {
    const delay = Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
    await new Promise((r) => setTimeout(r, delay));
    return postSync(opts, sessions, attempt + 1);
  }
  const text = await res.text().catch(() => '');
  throw new Error(`sync failed: ${res.status} ${text}`);
}
