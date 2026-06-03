import { readdirSync, statSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Session } from '@oa/schema';
import { parseTranscript } from '@oa/parser/adapters/claude-code';
import { projectsDir } from './config';
import type { ParserPrivacyOptions } from './privacy';

export interface DiscoveredFile {
  path: string;
  sessionId: string;
  size: number;
  // Latest mtime across the parent transcript and its subagent files (ms).
  mtimeMs: number;
  subagentPaths: string[];
}

// Find top-level Claude Code transcripts under ~/.claude/projects/<slug>/<uuid>.jsonl
// and attach child subagent transcripts from <slug>/<uuid>/subagents/**/*.jsonl.
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
        const subagentPaths = findSubagentFiles(slugDir, sessionId);
        let subagentSize = 0;
        let mtimeMs = st.mtimeMs;
        for (const sp of subagentPaths) {
          const sst = statSync(sp);
          subagentSize += sst.size;
          if (sst.mtimeMs > mtimeMs) mtimeMs = sst.mtimeMs;
        }
        out.push({
          path: fullPath,
          sessionId,
          size: st.size + subagentSize,
          mtimeMs,
          subagentPaths,
        });
      } catch {
        // ignore
      }
    }
  }
  return out;
}

export function parseFile(file: DiscoveredFile, privacy: ParserPrivacyOptions): Session | null {
  const fallbackCwd = slugToCwd(dirname(file.path));
  try {
    const content = readFileSync(file.path, 'utf8');
    const session = parseTranscript(file.sessionId, content, {
      hashPath: privacy.hashPath,
      includeProjectName: privacy.includeProjectName,
      fallbackCwd,
    });
    for (const subagentPath of file.subagentPaths) {
      // Per-subagent guard: a single bad subagent file must not drop the parent.
      try {
        const subagentId = subagentPath.slice(subagentPath.lastIndexOf('/') + 1, -'.jsonl'.length);
        const subagent = parseTranscript(subagentId, readFileSync(subagentPath, 'utf8'), {
          hashPath: privacy.hashPath,
          includeProjectName: false,
          fallbackCwd,
        });
        mergeSubagent(session, subagent, subagentPath);
      } catch (err) {
        console.warn(`[scan] subagent skipped ${subagentPath}: ${(err as Error).message}`);
      }
    }
    session.host = privacy.reportedHost;
    return session;
  } catch (err) {
    console.error(`[scan] failed to parse ${file.sessionId}:`, (err as Error).message);
    return null;
  }
}

// Reconstruct the project cwd from the slug directory name. Claude Code stores
// transcripts at ~/.claude/projects/<slug>/<uuid>.jsonl where <slug> is the
// project absolute path with every `/` replaced by `-`. Inverse is lossy when
// the original path contained literal hyphens, but that's also Claude's own
// ambiguity — we match its convention.
function slugToCwd(slugDir: string): string | undefined {
  const slug = slugDir.slice(slugDir.lastIndexOf('/') + 1);
  if (!slug.startsWith('-')) return undefined;
  return slug.replace(/-/g, '/');
}

function findSubagentFiles(slugDir: string, sessionId: string): string[] {
  const root = join(slugDir, sessionId, 'subagents');
  const out: string[] = [];
  collectJsonl(root, out);
  return out.filter((path) => {
    const name = path.slice(path.lastIndexOf('/') + 1, -'.jsonl'.length);
    return !name.startsWith('agent-acompact');
  });
}

function collectJsonl(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    try {
      const st = statSync(path);
      if (st.isDirectory()) collectJsonl(path, out);
      if (st.isFile() && entry.endsWith('.jsonl')) out.push(path);
    } catch {
      // ignore
    }
  }
}

export function mergeSubagent(parent: Session, child: Session, path: string): void {
  parent.tokens.input += child.tokens.input;
  parent.tokens.output += child.tokens.output;
  parent.tokens.cache_read += child.tokens.cache_read;
  parent.tokens.cache_creation += child.tokens.cache_creation;
  // Without these, the subagent's cache writes are silently zero-priced because
  // computeCost prefers the 5m/1h split over the legacy total when both are present.
  parent.tokens.cache_creation_5m += child.tokens.cache_creation_5m;
  parent.tokens.cache_creation_1h += child.tokens.cache_creation_1h;
  parent.tokens.reasoning += child.tokens.reasoning;
  parent.tokens.extra_total += child.tokens.extra_total;
  // Append the subagent's request rows so request-level aggregates (plan split,
  // per-request billing) reconcile with the session totals above — otherwise the
  // plan page (request-based) would undercount vs overview (session-based).
  // Re-attribute them to the parent's most recent prompt (the spawning prompt) so
  // they don't introduce phantom prompt indices into the prompt count.
  const subPromptIdx = Math.max(parent.prompts.length - 1, 0);
  for (const r of child.requests) {
    parent.requests.push({ ...r, prompt_idx: subPromptIdx });
  }
  parent.lines_added += child.lines_added;
  parent.lines_removed += child.lines_removed;
  for (const [ext, diff] of Object.entries(child.lines_by_extension)) {
    const current = parent.lines_by_extension[ext] ?? { added: 0, removed: 0 };
    current.added += diff.added;
    current.removed += diff.removed;
    parent.lines_by_extension[ext] = current;
  }
  for (const [tool, count] of Object.entries(child.tools)) {
    parent.tools[tool] = (parent.tools[tool] ?? 0) + count;
  }
  const kind = path.includes('/subagents/') ? 'claude-code-subagent' : 'subagent';
  parent.subagents[kind] = (parent.subagents[kind] ?? 0) + 1;
}
