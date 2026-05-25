import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { api, apiPost, readMe } from '../../../lib/api';
import { DashLayout, type Workspace } from '../../../components/Layout';

const INTERNAL_API =
  process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Resolve the public-facing URL the CLI should hit.
// Always derived from the incoming request so any self-hosted domain works
// without baking it into the image or env. Behind a reverse proxy (Traefik /
// nginx / Caddy / Cloudflare), x-forwarded-host + x-forwarded-proto give the
// public origin. In local dev without a proxy the api lives on a different
// port than the dashboard; PUBLIC_API_URL is then a dev-only escape hatch.
// NEXT_PUBLIC_API_URL is intentionally NOT read — Next inlines it at build
// time, which would re-hardcode the CI default into every image.
async function publicApiUrl(): Promise<string> {
  const h = await headers();
  const xfHost = h.get('x-forwarded-host');
  if (xfHost) {
    const proto = h.get('x-forwarded-proto') ?? 'https';
    return `${proto}://${xfHost}`;
  }
  if (process.env.PUBLIC_API_URL) return process.env.PUBLIC_API_URL;
  const host = h.get('host');
  if (host) return `http://${host}`;
  return 'http://localhost:3001';
}

interface KeysResp {
  ok: boolean;
  keys: {
    id: string;
    prefix: string;
    name: string | null;
    createdAt: string;
    lastUsedAt: string | null;
  }[];
}

async function createKeyAction(formData: FormData) {
  'use server';
  const name = String(formData.get('name') ?? '');
  const r = await apiPost<{ ok: boolean; id: string; prefix: string; secret: string }>(
    '/api/api-keys',
    { name },
  );
  redirect(`/settings/api-keys?new=${encodeURIComponent(r.data?.secret ?? '')}`);
}

async function revokeKeyAction(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '');
  const c = await cookies();
  const sid = c.get('oa_session')?.value;
  await fetch(`${INTERNAL_API}/api/api-keys/${id}`, {
    method: 'DELETE',
    headers: sid ? { cookie: `oa_session=${sid}` } : {},
  }).catch(() => null);
  redirect('/settings/api-keys');
}

export default async function Page({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const me = await readMe();
  const publicApi = await publicApiUrl();
  if (!me) redirect('/login');
  const { new: newKey } = await searchParams;
  const wsResp = await api<{ ok: boolean; workspaces: Workspace[] }>('/api/workspaces');
  const workspaces = wsResp?.workspaces ?? [];
  const keysResp = await api<KeysResp>('/api/api-keys');
  const keys = keysResp?.keys ?? [];

  return (
    <DashLayout user={me} workspaces={workspaces}>
      <div className="page-header">
        <div>
          <h1>API keys</h1>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            Used by the <span className="code">oa</span> CLI to sync session data. Create one key
            per machine.
          </div>
        </div>
      </div>

      {newKey && (
        <div className="notice">
          <h2 style={{ marginTop: 0 }}>New key created — copy now</h2>
          <p className="muted" style={{ margin: 0 }}>
            This is the only time you'll see this secret.
          </p>
          <div className="copy-block">{newKey}</div>
          <div className="muted" style={{ marginTop: 14, fontSize: 12.5 }}>
            CLI setup:
          </div>
          <div className="copy-block">
            oa login --api-url {publicApi} --api-key {newKey}
          </div>
        </div>
      )}

      <div className="panel">
        <h2>Create new key</h2>
        <form action={createKeyAction} className="flex" style={{ gap: 10 }}>
          <input
            type="text"
            name="name"
            placeholder="key name (e.g., laptop)"
            style={{ flex: 1 }}
          />
          <button className="primary" type="submit">
            Create key
          </button>
        </form>
      </div>

      <div className="panel">
        <h2>Active keys</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Created</th>
              <th>Last used</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No keys yet — create one above.
                </td>
              </tr>
            )}
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name ?? <span className="muted">—</span>}</td>
                <td>
                  <span className="code">{k.prefix}…</span>
                </td>
                <td className="muted">{k.createdAt.slice(0, 10)}</td>
                <td className="muted">
                  {k.lastUsedAt ? k.lastUsedAt.slice(0, 19).replace('T', ' ') : 'never'}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <form action={revokeKeyAction}>
                    <input type="hidden" name="id" value={k.id} />
                    <button className="ghost" type="submit">
                      Revoke
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashLayout>
  );
}
