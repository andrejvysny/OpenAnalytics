import type { Session, SyncRequest } from '@oa/schema';
import { VERSION } from '../version';

export interface SyncOptions {
  apiUrl: string;
  apiKey: string;
  workspaceId: string | null;
}

const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 6;

// Shared timeout + exponential-backoff retry: aborts after TIMEOUT_MS, retries
// on network error or 429/5xx (up to MAX_ATTEMPTS), leaves other statuses to the caller.
async function fetchWithRetry(url: string | URL, init: RequestInit, attempt = 1): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (attempt < MAX_ATTEMPTS) {
      await backoff(attempt);
      return fetchWithRetry(url, init, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
    await backoff(attempt);
    return fetchWithRetry(url, init, attempt + 1);
  }
  return res;
}

async function backoff(attempt: number): Promise<void> {
  const delay = Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

export async function fetchWorkspaceSalt(opts: SyncOptions): Promise<string> {
  const url = new URL(`${opts.apiUrl}/api/sync/salt`);
  if (opts.workspaceId) url.searchParams.set('workspace_id', opts.workspaceId);
  const res = await fetchWithRetry(url, {
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

export async function postSync(opts: SyncOptions, sessions: Session[]): Promise<SyncResult> {
  const body: SyncRequest = { workspace_id: opts.workspaceId, sessions };
  const res = await fetchWithRetry(`${opts.apiUrl}/api/sync`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.apiKey}`,
      'content-type': 'application/json',
      'x-oa-cli-version': VERSION,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 200) {
    const j = (await res.json()) as { accepted: number; ignored: number; failed?: string[] };
    return { accepted: j.accepted, ignored: j.ignored, failed: j.failed ?? [] };
  }
  const text = await res.text().catch(() => '');
  throw new Error(`sync failed: ${res.status} ${text}`);
}
