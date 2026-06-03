import type { LocalUsageEvent, TokenCounts, UsageAgentKind } from '@oa/schema';

type JsonRecord = Record<string, unknown>;

export interface UsageParseOptions {
  sessionId?: string;
  timestamp?: string;
}

export function parseLocalUsageEvent(
  agentKind: UsageAgentKind,
  raw: unknown,
  opts: UsageParseOptions = {},
): LocalUsageEvent | null {
  const root = asRecord(raw);
  if (!root) return null;

  const parsed = parseTokens(agentKind, root);
  if (!parsed) return null;

  const sessionId = firstString(
    root.sessionId,
    root.session_id,
    root.conversation_id,
    opts.sessionId,
  );
  const ts = firstString(root.timestamp, root.ts, root.created_at, opts.timestamp);
  if (!sessionId || !ts) return null;

  return {
    agent_kind: agentKind,
    session_id: sessionId,
    request_id: firstString(root.requestId, root.request_id, root.id),
    ts,
    model: firstString(root.model, asRecord(root.message)?.model, asRecord(root.response)?.model),
    tokens: parsed,
  };
}

export function parseClaudeUsageEvent(
  raw: unknown,
  opts?: UsageParseOptions,
): LocalUsageEvent | null {
  return parseLocalUsageEvent('claude-code', raw, opts);
}

export function parseCodexUsageEvent(
  raw: unknown,
  opts?: UsageParseOptions,
): LocalUsageEvent | null {
  return parseLocalUsageEvent('codex', raw, opts);
}

export function parseOpenCodeUsageEvent(
  raw: unknown,
  opts?: UsageParseOptions,
): LocalUsageEvent | null {
  return parseLocalUsageEvent('opencode', raw, opts);
}

export function parseGeminiUsageEvent(
  raw: unknown,
  opts?: UsageParseOptions,
): LocalUsageEvent | null {
  return parseLocalUsageEvent('gemini', raw, opts);
}

function parseTokens(agentKind: UsageAgentKind, root: JsonRecord): TokenCounts | null {
  switch (agentKind) {
    case 'claude-code':
      return parseAnthropicLike(firstRecord(asRecord(root.message)?.usage, root.usage));
    case 'codex':
      return parseOpenAILike(firstRecord(root.usage, asRecord(root.response)?.usage));
    case 'opencode':
      return parseOpenCodeLike(firstRecord(root.usage, asRecord(root.info)?.tokens, root.tokens));
    case 'gemini':
      return parseGeminiLike(firstRecord(root.usageMetadata, root.usage_metadata, root.usage));
  }
}

function parseAnthropicLike(usage: JsonRecord | null): TokenCounts | null {
  if (!usage) return null;
  const cacheCreation = asRecord(usage.cache_creation);
  const cache5m = intValue(cacheCreation?.ephemeral_5m_input_tokens);
  const cache1h = intValue(cacheCreation?.ephemeral_1h_input_tokens);
  const legacyCacheCreation = intValue(usage.cache_creation_input_tokens);
  const splitTotal = cache5m + cache1h;
  return tokens(
    {
      input: intValue(usage.input_tokens),
      output: intValue(usage.output_tokens),
      cache_read: intValue(usage.cache_read_input_tokens),
      cache_creation: splitTotal || legacyCacheCreation,
      cache_creation_5m: splitTotal ? cache5m : legacyCacheCreation,
      cache_creation_1h: cache1h,
      reasoning: intValue(asRecord(usage.output_tokens_details)?.reasoning_tokens),
    },
    firstInt(usage.total_tokens, usage.totalTokens),
  );
}

function parseOpenAILike(usage: JsonRecord | null): TokenCounts | null {
  if (!usage) return null;
  const inputDetails = firstRecord(usage.input_tokens_details, usage.prompt_tokens_details);
  const outputDetails = firstRecord(usage.output_tokens_details, usage.completion_tokens_details);
  return tokens(
    {
      input: firstInt(usage.input_tokens, usage.prompt_tokens),
      output: firstInt(usage.output_tokens, usage.completion_tokens),
      cache_read: intValue(inputDetails?.cached_tokens),
      cache_creation: 0,
      cache_creation_5m: 0,
      cache_creation_1h: 0,
      reasoning: intValue(outputDetails?.reasoning_tokens),
    },
    firstInt(usage.total_tokens, usage.totalTokens),
  );
}

function parseOpenCodeLike(usage: JsonRecord | null): TokenCounts | null {
  if (!usage) return null;
  const cacheCreation = firstInt(
    usage.cacheWriteInputTokens,
    usage.cache_write_input_tokens,
    usage.cache_creation_input_tokens,
  );
  return tokens(
    {
      input: firstInt(
        usage.inputTokens,
        usage.input_tokens,
        usage.promptTokens,
        usage.prompt_tokens,
      ),
      output: firstInt(
        usage.outputTokens,
        usage.output_tokens,
        usage.completionTokens,
        usage.completion_tokens,
      ),
      cache_read: firstInt(usage.cacheReadInputTokens, usage.cache_read_input_tokens),
      cache_creation: cacheCreation,
      cache_creation_5m: cacheCreation,
      cache_creation_1h: 0,
      reasoning: firstInt(usage.reasoningTokens, usage.reasoning_tokens),
    },
    firstInt(usage.totalTokens, usage.total_tokens),
  );
}

function parseGeminiLike(usage: JsonRecord | null): TokenCounts | null {
  if (!usage) return null;
  return tokens(
    {
      input: firstInt(usage.promptTokenCount, usage.prompt_token_count, usage.input_tokens),
      output: firstInt(
        usage.candidatesTokenCount,
        usage.candidates_token_count,
        usage.output_tokens,
      ),
      cache_read: firstInt(usage.cachedContentTokenCount, usage.cached_content_token_count),
      cache_creation: 0,
      cache_creation_5m: 0,
      cache_creation_1h: 0,
      reasoning: firstInt(usage.thoughtsTokenCount, usage.thoughts_token_count),
    },
    firstInt(usage.totalTokenCount, usage.total_token_count, usage.total_tokens),
  );
}

// `extra_total` is the RESIDUAL of the provider's grand total beyond the known
// buckets (input/output/cache/reasoning), so downstream code can sum it additively
// without double-counting. NEVER store the raw grand total here — that overlaps the
// other buckets and inflates every total ~2x once summed.
function tokens(t: Omit<TokenCounts, 'extra_total'>, grandTotal = 0): TokenCounts | null {
  const known = t.input + t.output + t.cache_read + t.cache_creation + t.reasoning;
  const extra_total = Math.max(0, grandTotal - known);
  return known + extra_total > 0 ? { ...t, extra_total } : null;
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function firstRecord(...values: unknown[]): JsonRecord | null {
  for (const value of values) {
    const record = asRecord(value);
    if (record) return record;
  }
  return null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function firstInt(...values: unknown[]): number {
  for (const value of values) {
    const parsed = intValue(value);
    if (parsed > 0) return parsed;
  }
  return 0;
}

function intValue(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  return 0;
}
