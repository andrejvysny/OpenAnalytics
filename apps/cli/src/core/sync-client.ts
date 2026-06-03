import type { Session, SyncRequest } from '@oa/schema';
import { VERSION } from '../version';

export interface SyncOptions {
  apiUrl: string;
  apiKey: string;
  workspaceId: string | null;
}

export async function fetchWorkspaceSalt(opts: SyncOptions): Promise<string> {
  const url = new URL(`${opts.apiUrl}/api/sync/salt`);
  if (opts.workspaceId) url.searchParams.set('workspace_id', opts.workspaceId);
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${opts.apiKey}`,
      'x-oa-cli-version': VERSION,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`salt fetch failed: ${res.status} ${text}`);
  }
  const body = (await res.json()) as { salt?: unknown };
  if (typeof body.salt !== 'string' || body.salt.length === 0) {
    throw new Error('salt fetch failed: invalid response');
  }
  return body.salt;
}

export interface SyncResult {
  accepted: number;
  ignored: number;
  failed: string[];
}

export async function postSync(
  opts: SyncOptions,
  sessions: Session[],
  attempt = 1,
): Promise<SyncResult> {
  const body: SyncRequest = { workspace_id: opts.workspaceId, sessions };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(`${opts.apiUrl}/api/sync`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${opts.apiKey}`,
        'content-type': 'application/json',
        'x-oa-cli-version': VERSION,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (attempt < 6) {
      await backoff(attempt);
      return postSync(opts, sessions, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  if (res.status === 200) {
    const j = (await res.json()) as { accepted: number; ignored: number; failed?: string[] };
    return { accepted: j.accepted, ignored: j.ignored, failed: j.failed ?? [] };
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 6) {
    await backoff(attempt);
    return postSync(opts, sessions, attempt + 1);
  }
  const text = await res.text().catch(() => '');
  throw new Error(`sync failed: ${res.status} ${text}`);
}

async function backoff(attempt: number): Promise<void> {
  const delay = Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
  await new Promise((resolve) => setTimeout(resolve, delay));
}
