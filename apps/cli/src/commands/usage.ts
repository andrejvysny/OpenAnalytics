import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';

const AGENTS = ['claude', 'codex', 'opencode', 'gemini', 'all'] as const;
type AgentOption = (typeof AGENTS)[number];
type SupportedAgent = 'claude' | 'codex' | 'opencode' | 'gemini';
type UsageRange = 'daily' | 'monthly';

interface UsageCommandOpts {
  agent?: string;
  json?: boolean;
  breakdown?: boolean;
}

interface UsageEvent {
  agent: SupportedAgent;
  ts: string;
  period: string;
  model: string | null;
  messageId?: string;
  requestId?: string;
  isSidechain: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  extraTotalTokens: number;
  cost: number;
  hasSpeed: boolean;
}

interface UsageRow {
  period: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  extraTotalTokens: number;
  totalCost: number;
  modelsUsed: string[];
  modelBreakdowns: ModelBreakdown[];
}

interface ModelBreakdown {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
}

export function runUsage(range: UsageRange, opts: UsageCommandOpts = {}): void {
  const agent = parseAgent(opts.agent);
  const agents = expandAgents(agent);
  const events = collectUsageEvents(agents, range);
  const rows = aggregateRows(events, range);
  const key = range === 'daily' ? 'daily' : 'monthly';

  if (opts.json === true) {
    console.log(
      JSON.stringify(
        {
          [key]: rows.map((row) => rowJson(row, range, opts.breakdown === true)),
          totals: totalsJson(rows),
        },
        null,
        2,
      ),
    );
    return;
  }

  printUsageTable(rows, range, opts.breakdown === true, agents);
}

const PERIOD_W = 12;
const NUM_W = 14;

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function usageTableRow(
  period: string,
  r: Omit<ModelBreakdown, 'modelName'>,
  total: number,
): string {
  return (
    period.padEnd(PERIOD_W) +
    fmtInt(r.inputTokens).padStart(NUM_W) +
    fmtInt(r.outputTokens).padStart(NUM_W) +
    fmtInt(r.cacheReadTokens).padStart(NUM_W) +
    fmtInt(r.cacheCreationTokens).padStart(NUM_W) +
    fmtInt(total).padStart(NUM_W + 2) +
    fmtCost(r.cost).padStart(12)
  );
}

function printUsageTable(
  rows: UsageRow[],
  range: UsageRange,
  breakdown: boolean,
  agents: SupportedAgent[],
): void {
  if (rows.length === 0) {
    console.log('No local usage found.');
    return;
  }
  const label = range === 'daily' ? 'Date' : 'Month';
  const header =
    label.padEnd(PERIOD_W) +
    'Input'.padStart(NUM_W) +
    'Output'.padStart(NUM_W) +
    'Cache R'.padStart(NUM_W) +
    'Cache W'.padStart(NUM_W) +
    'Total'.padStart(NUM_W + 2) +
    'Cost'.padStart(12);
  console.log(header);
  console.log('─'.repeat(header.length));

  for (const row of rows) {
    console.log(usageTableRow(row.period, { ...row, cost: row.totalCost }, totalTokens(row)));
    if (breakdown) {
      for (const b of row.modelBreakdowns) {
        const bTotal = b.inputTokens + b.outputTokens + b.cacheReadTokens + b.cacheCreationTokens;
        console.log(usageTableRow(`  ${b.modelName}`.slice(0, PERIOD_W), b, bTotal));
      }
    }
  }

  const t = totalsJson(rows);
  console.log('─'.repeat(header.length));
  console.log(
    usageTableRow(
      'TOTAL',
      {
        inputTokens: t.inputTokens,
        outputTokens: t.outputTokens,
        cacheReadTokens: t.cacheReadTokens,
        cacheCreationTokens: t.cacheCreationTokens,
        cost: t.totalCost,
      },
      t.totalTokens,
    ),
  );
  if (agents.some((a) => a !== 'claude')) {
    console.log(
      '\nNote: cost reflects Claude transcript costs only; other agents counted by tokens.',
    );
  }
}

function parseAgent(value: string | undefined): AgentOption {
  const agent = value ?? 'claude';
  if (AGENTS.includes(agent as AgentOption)) return agent as AgentOption;
  throw new Error(`invalid --agent "${agent}". Expected one of: ${AGENTS.join(', ')}`);
}

function expandAgents(agent: AgentOption): SupportedAgent[] {
  if (agent === 'all') return ['claude', 'codex', 'opencode', 'gemini'];
  return [agent];
}

function collectUsageEvents(agents: SupportedAgent[], range: UsageRange): UsageEvent[] {
  const events: UsageEvent[] = [];
  if (agents.includes('claude')) events.push(...dedupeClaudeEvents(loadClaudeEvents(range)));
  if (agents.includes('codex')) events.push(...loadCodexEvents(range));
  if (agents.includes('opencode')) events.push(...loadOpenCodeEvents(range));
  if (agents.includes('gemini')) events.push(...loadGeminiEvents(range));
  return events;
}

function aggregateRows(events: UsageEvent[], range: UsageRange): UsageRow[] {
  const groups = new Map<string, UsageRow>();
  for (const event of events) {
    const row = groups.get(event.period) ?? emptyRow(event.period);
    addEvent(row, event);
    groups.set(event.period, row);
  }
  return [...groups.values()].sort((a, b) => a.period.localeCompare(b.period));
}

function rowJson(
  row: UsageRow,
  range: UsageRange,
  includeBreakdown: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    [range === 'daily' ? 'date' : 'month']: row.period,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    cacheReadTokens: row.cacheReadTokens,
    totalTokens: totalTokens(row),
    totalCost: row.totalCost,
    modelsUsed: row.modelsUsed,
  };
  if (includeBreakdown) out.modelBreakdowns = row.modelBreakdowns;
  return out;
}

interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  totalCost: number;
}

function totalsJson(rows: UsageRow[]): UsageTotals {
  const total = emptyRow('total');
  for (const row of rows) {
    total.inputTokens += row.inputTokens;
    total.outputTokens += row.outputTokens;
    total.cacheCreationTokens += row.cacheCreationTokens;
    total.cacheReadTokens += row.cacheReadTokens;
    total.extraTotalTokens += row.extraTotalTokens;
    total.totalCost += row.totalCost;
  }
  return {
    inputTokens: total.inputTokens,
    outputTokens: total.outputTokens,
    cacheCreationTokens: total.cacheCreationTokens,
    cacheReadTokens: total.cacheReadTokens,
    totalTokens: totalTokens(total),
    totalCost: total.totalCost,
  };
}

function emptyRow(period: string): UsageRow {
  return {
    period,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    extraTotalTokens: 0,
    totalCost: 0,
    modelsUsed: [],
    modelBreakdowns: [],
  };
}

function addEvent(row: UsageRow, event: UsageEvent): void {
  row.inputTokens += event.inputTokens;
  row.outputTokens += event.outputTokens;
  row.cacheCreationTokens += event.cacheCreationTokens;
  row.cacheReadTokens += event.cacheReadTokens;
  row.extraTotalTokens += event.extraTotalTokens;
  row.totalCost += event.cost;
  if (event.model && !row.modelsUsed.includes(event.model)) row.modelsUsed.push(event.model);
  if (!event.model) return;
  let breakdown = row.modelBreakdowns.find((item) => item.modelName === event.model);
  if (!breakdown) {
    breakdown = {
      modelName: event.model,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cost: 0,
    };
    row.modelBreakdowns.push(breakdown);
  }
  breakdown.inputTokens += event.inputTokens;
  breakdown.outputTokens += event.outputTokens;
  breakdown.cacheCreationTokens += event.cacheCreationTokens;
  breakdown.cacheReadTokens += event.cacheReadTokens;
  breakdown.cost += event.cost;
  row.modelBreakdowns.sort((a, b) => b.cost - a.cost || a.modelName.localeCompare(b.modelName));
}

function totalTokens(row: UsageRow): number {
  return (
    row.inputTokens +
    row.outputTokens +
    row.cacheCreationTokens +
    row.cacheReadTokens +
    row.extraTotalTokens
  );
}

function loadClaudeEvents(range: UsageRange): UsageEvent[] {
  const out: UsageEvent[] = [];
  for (const file of claudeUsageFiles()) {
    let lines: string[];
    try {
      lines = readFileSync(file, 'utf8').split(/\r?\n/);
    } catch {
      continue;
    }
    for (const line of lines) {
      if (!line.includes('"usage":{') && !line.includes('"usage": {')) continue;
      const value = parseJsonRecord(line);
      const event = value ? claudeEventFromLine(value, range) : null;
      if (event) out.push(event);
    }
  }
  return out;
}

function claudeEventFromLine(value: JsonRecord, range: UsageRange): UsageEvent | null {
  const entry = normalizeClaudeLine(value);
  if (!entry) return null;
  if (!isValidSemverPrefix(asString(entry.version)) && entry.version !== undefined) return null;
  const ts = asString(entry.timestamp);
  const message = asRecord(entry.message);
  const usage = asRecord(message?.usage);
  if (!ts || !usage) return null;
  const cacheCreation = asRecord(usage.cache_creation);
  const cache5m = intValue(cacheCreation?.ephemeral_5m_input_tokens);
  const cache1h = intValue(cacheCreation?.ephemeral_1h_input_tokens);
  const legacyCacheCreation = intValue(usage.cache_creation_input_tokens);
  const splitTotal = cache5m + cache1h;
  const model = asString(message?.model);
  const event: UsageEvent = {
    agent: 'claude',
    ts,
    period: periodFromTimestamp(ts, range),
    model: !model || model === '<synthetic>' ? null : model,
    messageId: asString(message?.id),
    requestId: asString(entry.requestId) ?? asString(entry.request_id),
    isSidechain: entry.isSidechain === true,
    inputTokens: intValue(usage.input_tokens),
    outputTokens: intValue(usage.output_tokens),
    cacheCreationTokens: splitTotal || legacyCacheCreation,
    cacheReadTokens: intValue(usage.cache_read_input_tokens),
    extraTotalTokens: 0,
    cost: numberValue(entry.costUSD),
    hasSpeed: usage.speed !== undefined,
  };
  return eventTokenTotal(event) > 0 ? event : null;
}

function normalizeClaudeLine(value: JsonRecord): JsonRecord | null {
  const directMessage = asRecord(value.message);
  if (directMessage && asRecord(directMessage.usage)) return value;
  const nested = asRecord(asRecord(value.data)?.message);
  const nestedMessage = asRecord(nested?.message);
  if (!nested || !nestedMessage || !asRecord(nestedMessage.usage)) return null;
  return {
    timestamp: nested.timestamp,
    message: nestedMessage,
    costUSD: nested.costUSD,
    requestId: nested.requestId,
    isSidechain: nested.isSidechain,
  };
}

function dedupeClaudeEvents(events: UsageEvent[]): UsageEvent[] {
  const deduped: UsageEvent[] = [];
  for (const event of events) {
    const existingIndex = findClaudeDuplicate(deduped, event);
    if (existingIndex === -1) {
      deduped.push(event);
      continue;
    }
    const existing = deduped[existingIndex];
    if (
      existing &&
      event.messageId &&
      existing.messageId === event.messageId &&
      existing.requestId === event.requestId
    ) {
      // Claude Code can append several partial records for the same request as
      // a subagent streams tool calls. Treat equal prompt/cache counts with a
      // larger output as a more complete replacement.
      if (samePromptAndCache(existing, event) && event.outputTokens > existing.outputTokens) {
        deduped[existingIndex] = event;
        continue;
      }
    }
    if (existing && shouldReplaceClaudeDuplicate(event, existing)) deduped[existingIndex] = event;
  }
  return deduped;
}

function samePromptAndCache(a: UsageEvent, b: UsageEvent): boolean {
  return (
    a.inputTokens === b.inputTokens &&
    a.cacheCreationTokens === b.cacheCreationTokens &&
    a.cacheReadTokens === b.cacheReadTokens
  );
}

function findClaudeDuplicate(events: UsageEvent[], event: UsageEvent): number {
  if (!event.messageId) return -1;
  const exact = events.findIndex(
    (candidate) =>
      candidate.messageId === event.messageId && candidate.requestId === event.requestId,
  );
  if (exact !== -1) return exact;
  return events.findIndex(
    (candidate) =>
      candidate.messageId === event.messageId && (event.isSidechain || candidate.isSidechain),
  );
}

function shouldReplaceClaudeDuplicate(candidate: UsageEvent, existing: UsageEvent): boolean {
  if (candidate.isSidechain !== existing.isSidechain) return existing.isSidechain;
  const candidateTotal = eventTokenTotal(candidate);
  const existingTotal = eventTokenTotal(existing);
  if (candidateTotal !== existingTotal) return candidateTotal > existingTotal;
  if (candidate.hasSpeed !== existing.hasSpeed) return candidate.hasSpeed;
  return false;
}

function loadCodexEvents(range: UsageRange): UsageEvent[] {
  const out: UsageEvent[] = [];
  for (const file of recursiveFiles(codexRoots(), ['.jsonl'])) {
    const sessionId = file.slice(file.lastIndexOf('/') + 1, -'.jsonl'.length) || 'unknown';
    let lines: string[];
    try {
      lines = readFileSync(file, 'utf8').split(/\r?\n/);
    } catch {
      continue;
    }
    for (const line of lines) {
      if (!line.includes('usage') && !line.includes('token_usage')) continue;
      const root = parseJsonRecord(line);
      const event = root ? codexEventFromRecord(root, sessionId, fileTimestamp(file), range) : null;
      if (event) out.push(event);
    }
  }
  return out;
}

function codexEventFromRecord(
  root: JsonRecord,
  sessionId: string,
  fallbackTs: string,
  range: UsageRange,
): UsageEvent | null {
  const payload = asRecord(root.payload);
  const info = asRecord(payload?.info);
  const usage = firstRecord(
    info?.last_token_usage,
    root.usage,
    asRecord(root.data)?.usage,
    asRecord(root.result)?.usage,
    asRecord(root.response)?.usage,
  );
  if (!usage) return null;
  const rawInput = firstInt(usage.input_tokens, usage.prompt_tokens, usage.input);
  const cached = Math.min(
    rawInput,
    firstInt(usage.cached_input_tokens, usage.cache_read_input_tokens, usage.cached_tokens),
  );
  const output = firstInt(usage.output_tokens, usage.completion_tokens, usage.output);
  const reasoning = firstInt(usage.reasoning_output_tokens, usage.reasoning_tokens);
  const total = firstInt(usage.total_tokens, usage.total) || rawInput + output + reasoning;
  const ts = firstString(root.timestamp, root.created_at, root.createdAt) ?? fallbackTs;
  const model = firstString(
    payload?.model,
    payload?.model_name,
    info?.model,
    info?.model_name,
    root.model,
    asRecord(root.response)?.model,
  );
  const event: UsageEvent = {
    agent: 'codex',
    ts,
    period: periodFromTimestamp(ts, range),
    model: model ?? 'gpt-5',
    messageId: undefined,
    requestId: sessionId,
    isSidechain: false,
    inputTokens: rawInput - cached,
    outputTokens: output,
    cacheCreationTokens: 0,
    cacheReadTokens: cached,
    extraTotalTokens: Math.max(0, total - (rawInput + output + reasoning)),
    cost: 0,
    hasSpeed: false,
  };
  return eventTokenTotal(event) + reasoning > 0 ? event : null;
}

function loadOpenCodeEvents(range: UsageRange): UsageEvent[] {
  const out: UsageEvent[] = [];
  for (const file of recursiveFiles(
    openCodeRoots().map((root) => join(root, 'storage', 'message')),
    ['.json'],
  )) {
    const root = parseJsonRecordSafe(file);
    const event = root ? openCodeEventFromRecord(root, range) : null;
    if (event) out.push(event);
  }
  return out;
}

function openCodeEventFromRecord(root: JsonRecord, range: UsageRange): UsageEvent | null {
  const tokens = asRecord(root.tokens);
  if (!tokens) return null;
  const cache = asRecord(tokens.cache);
  const model = asString(root.modelID);
  const provider = asString(root.providerID);
  if (!model || !provider) return null;
  const tsMillis = intValue(asRecord(root.time)?.created);
  const ts = new Date(tsMillis || 0).toISOString();
  const input = intValue(tokens.input);
  let output = intValue(tokens.output);
  const cacheCreation = intValue(cache?.write);
  const cacheRead = intValue(cache?.read);
  const declaredTotal = intValue(tokens.total);
  let extra = Math.max(0, declaredTotal - (input + output + cacheCreation + cacheRead));
  if (extra > 0 && output === 0) {
    output = extra;
    extra = 0;
  }
  const event: UsageEvent = {
    agent: 'opencode',
    ts,
    period: periodFromTimestamp(ts, range),
    model: `${provider}/${model}`,
    messageId: asString(root.id),
    requestId: asString(root.sessionID),
    isSidechain: false,
    inputTokens: input,
    outputTokens: output,
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead,
    extraTotalTokens: extra,
    cost: numberValue(root.cost),
    hasSpeed: false,
  };
  return eventTokenTotal(event) > 0 ? event : null;
}

function loadGeminiEvents(range: UsageRange): UsageEvent[] {
  const out: UsageEvent[] = [];
  for (const file of recursiveFiles(geminiRoots(), ['.json', '.jsonl'])) {
    if (extname(file) === '.jsonl') {
      let currentModel: string | undefined;
      let currentSession = file.slice(file.lastIndexOf('/') + 1, -'.jsonl'.length) || 'unknown';
      let lines: string[];
      try {
        lines = readFileSync(file, 'utf8').split(/\r?\n/);
      } catch {
        continue;
      }
      for (const line of lines) {
        const root = parseJsonRecord(line);
        if (!root) continue;
        currentModel = asString(root.model) ?? currentModel;
        currentSession = asString(root.sessionId) ?? asString(root.session_id) ?? currentSession;
        const event = geminiEventFromRecord(
          root,
          currentSession,
          currentModel,
          fileTimestamp(file),
          range,
        );
        if (event) out.push(event);
      }
    } else {
      const root = parseJsonRecordSafe(file);
      const event = root
        ? geminiEventFromRecord(
            root,
            asString(root.sessionId) ?? asString(root.session_id) ?? 'unknown',
            asString(root.model),
            fileTimestamp(file),
            range,
          )
        : null;
      if (event) out.push(event);
    }
  }
  return out;
}

function geminiEventFromRecord(
  root: JsonRecord,
  sessionId: string,
  modelHint: string | undefined,
  fallbackTs: string,
  range: UsageRange,
): UsageEvent | null {
  const stats = firstRecord(
    root.tokens,
    root.stats,
    asRecord(root.result)?.stats,
    root.usageMetadata,
  );
  if (!stats) return null;
  const model = asString(root.model) ?? modelHint;
  if (!model) return null;
  const input = firstInt(
    stats.input,
    stats.prompt,
    stats.input_tokens,
    stats.prompt_tokens,
    stats.promptTokenCount,
  );
  const output = firstInt(
    stats.output,
    stats.candidates,
    stats.output_tokens,
    stats.candidates_tokens,
    stats.candidatesTokenCount,
  );
  const cacheRead = firstInt(stats.cached, stats.cached_tokens, stats.cachedContentTokenCount);
  const thoughts = firstInt(
    stats.thoughts,
    stats.reasoning,
    stats.thoughts_tokens,
    stats.reasoning_tokens,
    stats.thoughtsTokenCount,
  );
  const tool = firstInt(stats.tool, stats.tool_tokens);
  const total = firstInt(stats.total, stats.total_tokens, stats.totalTokenCount);
  const ts = firstString(root.timestamp, root.created_at) ?? fallbackTs;
  const visibleTotal = input + tool + output + cacheRead;
  const event: UsageEvent = {
    agent: 'gemini',
    ts,
    period: periodFromTimestamp(ts, range),
    model,
    messageId: asString(root.id),
    requestId: sessionId,
    isSidechain: false,
    inputTokens: input + tool,
    outputTokens: output,
    cacheCreationTokens: 0,
    cacheReadTokens: cacheRead,
    extraTotalTokens: Math.max(0, total - visibleTotal),
    cost: 0,
    hasSpeed: false,
  };
  return eventTokenTotal(event) + thoughts > 0 ? event : null;
}

function claudeUsageFiles(): string[] {
  const roots = claudeConfigDirs().map((dir) => join(dir, 'projects'));
  return recursiveFiles(roots, ['.jsonl']).sort();
}

function claudeConfigDirs(): string[] {
  const envValue = process.env.CLAUDE_CONFIG_DIR;
  if (envValue) {
    return envValue
      .split(',')
      .map((part) => normalizeClaudeConfigPath(expandHome(part.trim())))
      .filter((part) => part.length > 0 && existsSync(join(part, 'projects')))
      .filter(unique);
  }
  const xdg =
    process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.length > 0
      ? process.env.XDG_CONFIG_HOME
      : join(homedir(), '.config');
  return [join(xdg, 'claude'), join(homedir(), '.claude')].filter(
    (dir, index, all) => existsSync(join(dir, 'projects')) && all.indexOf(dir) === index,
  );
}

function normalizeClaudeConfigPath(path: string): string {
  return path.endsWith('/projects') ? dirname(path) : path;
}

function codexRoots(): string[] {
  const envValue = process.env.CODEX_HOME;
  const roots = envValue
    ? envValue.split(',').map((part) => expandHome(part.trim()))
    : [join(homedir(), '.codex')];
  return roots
    .filter((root) => root.length > 0 && existsSync(root))
    .map((root) => (existsSync(join(root, 'sessions')) ? join(root, 'sessions') : root))
    .filter(unique);
}

function openCodeRoots(): string[] {
  const envValue = process.env.OPENCODE_DATA_DIR;
  const roots = envValue
    ? envValue.split(',').map((part) => expandHome(part.trim()))
    : [join(homedir(), '.local', 'share', 'opencode')];
  return roots.filter((root) => root.length > 0 && existsSync(root)).filter(unique);
}

function geminiRoots(): string[] {
  const envValue = process.env.GEMINI_DATA_DIR;
  const roots = envValue
    ? envValue.split(',').map((part) => expandHome(part.trim()))
    : [join(homedir(), '.gemini', 'tmp')];
  return roots.filter((root) => root.length > 0 && existsSync(root)).filter(unique);
}

function recursiveFiles(roots: string[], extensions: string[]): string[] {
  const out: string[] = [];
  for (const root of roots) collectFiles(root, extensions, out);
  return out.sort().filter(unique);
}

function collectFiles(dir: string, extensions: string[], out: string[]): void {
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
      if (st.isDirectory()) collectFiles(path, extensions, out);
      if (st.isFile() && extensions.includes(extname(path))) out.push(path);
    } catch {
      // ignore
    }
  }
}

function periodFromTimestamp(ts: string, range: UsageRange): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return range === 'daily' ? ts.slice(0, 10) : ts.slice(0, 7);
  // Bucket in UTC to match the server/dashboard (which group by DATE(... AT TIME ZONE 'UTC')).
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  if (range === 'monthly') return `${year}-${month}`;
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fileTimestamp(path: string): string {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

function eventTokenTotal(event: UsageEvent): number {
  return (
    event.inputTokens +
    event.outputTokens +
    event.cacheCreationTokens +
    event.cacheReadTokens +
    event.extraTotalTokens
  );
}

type JsonRecord = Record<string, unknown>;

function parseJsonRecord(line: string): JsonRecord | null {
  try {
    return asRecord(JSON.parse(line));
  } catch {
    return null;
  }
}

function parseJsonRecordSafe(path: string): JsonRecord | null {
  try {
    return asRecord(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null;
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const parsed = asString(value);
    if (parsed) return parsed;
  }
  return undefined;
}

function firstRecord(...values: unknown[]): JsonRecord | null {
  for (const value of values) {
    const record = asRecord(value);
    if (record) return record;
  }
  return null;
}

function intValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.trunc(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return 0;
}

function firstInt(...values: unknown[]): number {
  for (const value of values) {
    const parsed = intValue(value);
    if (parsed > 0) return parsed;
  }
  return 0;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function isValidSemverPrefix(version: string | undefined): boolean {
  return version === undefined || /^\d+\.\d+\.\d+/.test(version);
}

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return resolve(path);
}

function unique<T>(value: T, index: number, array: T[]): boolean {
  return array.indexOf(value) === index;
}
