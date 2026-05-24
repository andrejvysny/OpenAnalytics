import type { Prompt, Request, Session } from '@oa/schema';
import { fnv1aHex } from '../../hash.js';
import { diffForToolUse } from './diff.js';
import type { RawAssistant, RawCommon, RawContentBlock, RawEvent, RawUser } from './types.js';

export interface AggregatorState {
  session_id: string;
  path_hash: string | null;
  project_name: string | null;
  cli_version: string | null;
  model: string | null;
  started_at: string | null;
  ended_at: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  reasoning_tokens: number;
  lines_added: number;
  lines_removed: number;
  lines_by_extension: Map<string, { added: number; removed: number }>;
  tools: Map<string, number>;
  // Ordered list of distinct promptIds (top-level user messages with string content).
  prompt_ids: string[];
  prompts: Map<string, Prompt>;
  requests: Request[];
  subagents: Map<string, number>;
  hashPath: (path: string) => string;
  includeProjectName: boolean;
}

export interface AggregatorOptions {
  hashPath?: (path: string) => string;
  includeProjectName?: boolean;
}

export function newState(session_id: string, opts: AggregatorOptions = {}): AggregatorState {
  return {
    session_id,
    path_hash: null,
    project_name: null,
    cli_version: null,
    model: null,
    started_at: null,
    ended_at: null,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    reasoning_tokens: 0,
    lines_added: 0,
    lines_removed: 0,
    lines_by_extension: new Map(),
    tools: new Map(),
    prompt_ids: [],
    prompts: new Map(),
    requests: [],
    subagents: new Map(),
    hashPath: opts.hashPath ?? fnv1aHex,
    includeProjectName: opts.includeProjectName === true,
  };
}

function bumpTs(state: AggregatorState, ts: string | undefined) {
  if (!ts) return;
  if (!state.started_at || ts < state.started_at) state.started_at = ts;
  if (!state.ended_at || ts > state.ended_at) state.ended_at = ts;
}

function ensurePath(state: AggregatorState, cwd: string | undefined) {
  if (state.path_hash || !cwd) return;
  state.path_hash = state.hashPath(cwd);
  if (!state.includeProjectName) return;
  const trimmed = cwd.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  state.project_name = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function bumpDiff(state: AggregatorState, added: number, removed: number, ext: string | null) {
  state.lines_added += added;
  state.lines_removed += removed;
  if (ext) {
    const entry = state.lines_by_extension.get(ext) ?? { added: 0, removed: 0 };
    entry.added += added;
    entry.removed += removed;
    state.lines_by_extension.set(ext, entry);
  }
}

function handleAssistant(state: AggregatorState, ev: RawAssistant) {
  bumpTs(state, ev.timestamp);
  ensurePath(state, ev.cwd);
  if (ev.version && !state.cli_version) state.cli_version = ev.version;
  const msg = ev.message;
  if (msg.model) state.model = msg.model;

  const u = msg.usage;
  let req_input = 0;
  let req_output = 0;
  let req_cache_r = 0;
  let req_cache_c = 0;
  if (u) {
    req_input = u.input_tokens ?? 0;
    req_output = u.output_tokens ?? 0;
    req_cache_r = u.cache_read_input_tokens ?? 0;
    req_cache_c = u.cache_creation_input_tokens ?? 0;
    state.input_tokens += req_input;
    state.output_tokens += req_output;
    state.cache_read_tokens += req_cache_r;
    state.cache_creation_tokens += req_cache_c;
  }

  let req_added = 0;
  let req_removed = 0;
  const blocks: RawContentBlock[] = Array.isArray(msg.content) ? msg.content : [];
  for (const b of blocks) {
    if (b.type === 'tool_use' && b.name) {
      state.tools.set(b.name, (state.tools.get(b.name) ?? 0) + 1);
      const d = diffForToolUse(b.name, b.input);
      if (d) {
        bumpDiff(state, d.added, d.removed, d.ext);
        req_added += d.added;
        req_removed += d.removed;
      }
    }
  }

  // Attach request to its prompt (last seen prompt index, or -1 if none yet).
  const prompt_idx = state.prompt_ids.length - 1;
  state.requests.push({
    prompt_idx: Math.max(prompt_idx, 0),
    ts: ev.timestamp ?? state.ended_at ?? new Date(0).toISOString(),
    model: msg.model ?? 'unknown',
    input_tokens: req_input,
    output_tokens: req_output,
    cache_read_tokens: req_cache_r,
    cache_creation_tokens: req_cache_c,
    lines_added: req_added,
    lines_removed: req_removed,
  });

  if (prompt_idx >= 0) {
    const pid = state.prompt_ids[prompt_idx]!;
    const p = state.prompts.get(pid);
    if (p) p.request_count += 1;
  }
}

function handleUser(state: AggregatorState, ev: RawUser) {
  bumpTs(state, ev.timestamp);
  ensurePath(state, ev.cwd);
  const isSidechain = ev.isSidechain === true;
  const promptId = ev.promptId;
  const content = ev.message?.content;
  // Only count top-level (non-sidechain) string-content user messages as real prompts.
  if (isSidechain || !promptId || typeof content !== 'string') return;
  if (state.prompts.has(promptId)) return;

  const idx = state.prompt_ids.length;
  state.prompt_ids.push(promptId);
  state.prompts.set(promptId, {
    idx,
    ts: ev.timestamp ?? new Date(0).toISOString(),
    length: content.length,
    request_count: 0,
    command: null,
    skills: [],
  });
}

export function applyLine(state: AggregatorState, rawLine: string): void {
  const trimmed = rawLine.trim();
  if (!trimmed) return;
  let ev: RawEvent;
  try {
    ev = JSON.parse(trimmed) as RawEvent;
  } catch {
    return;
  }
  if (ev.sessionId && ev.sessionId !== state.session_id) return;

  switch (ev.type) {
    case 'assistant':
      handleAssistant(state, ev as RawAssistant);
      break;
    case 'user':
      handleUser(state, ev as RawUser);
      break;
    default: {
      const c = ev as RawCommon;
      bumpTs(state, c.timestamp);
      ensurePath(state, c.cwd);
      if (c.version && !state.cli_version) state.cli_version = c.version;
      break;
    }
  }
}

export class AggregatorIncompleteError extends Error {
  constructor(missing: string) {
    super(`aggregator state incomplete: missing ${missing}`);
  }
}

export function finalize(state: AggregatorState): Session {
  if (!state.path_hash) throw new AggregatorIncompleteError('path_hash (cwd never observed)');
  if (!state.started_at || !state.ended_at) throw new AggregatorIncompleteError('timestamps');

  const lines_by_extension: Record<string, { added: number; removed: number }> = {};
  for (const [k, v] of state.lines_by_extension) lines_by_extension[k] = v;

  const tools: Record<string, number> = {};
  for (const [k, v] of state.tools) tools[k] = v;

  const subagents: Record<string, number> = {};
  for (const [k, v] of state.subagents) subagents[k] = v;

  const prompts = state.prompt_ids.map((pid) => state.prompts.get(pid)!);

  return {
    agent_kind: 'claude-code',
    session_id: state.session_id,
    path_hash: state.path_hash,
    project_name: state.project_name ?? undefined,
    started_at: state.started_at,
    ended_at: state.ended_at,
    model: state.model ?? 'unknown',
    cli_version: state.cli_version ?? undefined,
    tokens: {
      input: state.input_tokens,
      output: state.output_tokens,
      cache_read: state.cache_read_tokens,
      cache_creation: state.cache_creation_tokens,
      reasoning: state.reasoning_tokens,
    },
    lines_added: state.lines_added,
    lines_removed: state.lines_removed,
    lines_by_extension,
    tools,
    prompts,
    requests: state.requests,
    subagents,
  };
}
