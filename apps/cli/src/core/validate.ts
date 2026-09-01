import { Session } from '@oa/schema';

// Pre-flight check against the wire contract the API enforces per session. Returns
// null when the session is valid, else a short "<field>: <reason>" description of the
// first schema issue. Sessions that fail here would be rejected server-side anyway;
// catching them locally lets sync skip (and permanently cursor past) the bad file
// instead of resending the same poison-pill batch on every run.
export function sessionIssue(session: unknown): string | null {
  const parsed = Session.safeParse(session);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  if (!issue) return 'invalid session';
  const path = issue.path.join('.') || '<root>';
  return `${path}: ${issue.message}`;
}
