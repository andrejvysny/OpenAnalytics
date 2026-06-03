import type { ReactNode } from 'react';
import Link from 'next/link';

// AGPL-3.0 §13: offer the Corresponding Source to all network users. Override with
// NEXT_PUBLIC_SOURCE_URL (e.g. pin to the deployed commit) at build time.
const SOURCE_URL =
  process.env.NEXT_PUBLIC_SOURCE_URL ?? 'https://github.com/andrejvysny/OpenAnalytics';

export interface SidebarUser {
  name: string;
  email: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  isPersonal: number;
  role?: string;
  planKind?: string;
  planName?: string | null;
  monthlyPriceUsd?: number | null;
  splitMode?: string;
  billingCycleDay?: number;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function DashLayout({
  user,
  workspaces,
  children,
}: {
  user: SidebarUser;
  workspaces: Workspace[];
  children: ReactNode;
}) {
  const shared = workspaces.filter((w) => !w.isPersonal);
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">OA</div>
          <div className="brand-name">OpenAnalytics</div>
        </div>
        <nav>
          <Link href="/" className="nav-link">
            Overview
          </Link>
          <Link href="/explore" className="nav-link">
            Explore
          </Link>

          <div className="nav-section">Shared plans</div>
          {shared.length === 0 ? (
            <div className="nav-empty">No shared plans yet</div>
          ) : (
            shared.map((w) => (
              <Link key={w.id} href={`/plan/${w.id}`} className="nav-link">
                {w.name}
              </Link>
            ))
          )}

          <div className="nav-section">Settings</div>
          <Link href="/settings/plan" className="nav-link">
            My plan
          </Link>
          <Link href="/settings/workspaces" className="nav-link">
            Workspaces
          </Link>
          <Link href="/settings/api-keys" className="nav-link">
            API keys
          </Link>
        </nav>

        <div className="user-block">
          <div className="row">
            <div className="avatar">{initials(user.name)}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                className="name"
                style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {user.name}
              </div>
              <div
                className="email"
                style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {user.email}
              </div>
            </div>
          </div>
          <form action="/logout" method="post">
            <button type="submit" className="signout">
              Sign out
            </button>
          </form>
        </div>
        <a className="source-offer" href={SOURCE_URL} target="_blank" rel="noreferrer">
          Source code (AGPL-3.0)
        </a>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
