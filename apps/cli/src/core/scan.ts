import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import type { Session } from '@oa/schema';
import { parseTranscript } from '@oa/parser/adapters/claude-code';
import { projectsDir } from './config';

export interface DiscoveredFile {
  path: string;
  sessionId: string;
  size: number;
}

// Find all top-level Claude Code transcripts under ~/.claude/projects/<slug>/<uuid>.jsonl.
// Subagent transcripts (under <uuid>/subagents/*.jsonl) are deferred to a future phase.
export function discoverTranscripts(): DiscoveredFile[] {
  const root = projectsDir();
  const out: DiscoveredFile[] = [];
  let slugs: string[];
  try {
    slugs = readdirSync(root);
  } catch {
    return out;
  }
  for (const slug of slugs) {
    const slugDir = join(root, slug);
    let entries: string[];
    try {
      entries = readdirSync(slugDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const fullPath = join(slugDir, entry);
      try {
        const st = statSync(fullPath);
        if (!st.isFile()) continue;
        const sessionId = entry.slice(0, -'.jsonl'.length);
        out.push({ path: fullPath, sessionId, size: st.size });
      } catch {
        // ignore
      }
    }
  }
  return out;
}

export function parseFile(file: DiscoveredFile, host?: string): Session | null {
  try {
    const content = readFileSync(file.path, 'utf8');
    const session = parseTranscript(file.sessionId, content);
    session.host = host ?? hostname();
    return session;
  } catch (err) {
    console.error(`[scan] failed to parse ${file.sessionId}:`, (err as Error).message);
    return null;
  }
}
