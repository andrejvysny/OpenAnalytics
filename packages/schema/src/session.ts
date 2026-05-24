import { z } from 'zod';

export const AgentKind = z.enum(['claude-code']);
export type AgentKind = z.infer<typeof AgentKind>;

export const TokenCounts = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cache_read: z.number().int().nonnegative(),
  cache_creation: z.number().int().nonnegative(),
  reasoning: z.number().int().nonnegative().default(0),
});
export type TokenCounts = z.infer<typeof TokenCounts>;

export const LineDiff = z.object({
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
});

export const Prompt = z.object({
  idx: z.number().int().nonnegative(),
  ts: z.string().datetime(),
  length: z.number().int().nonnegative(),
  request_count: z.number().int().nonnegative(),
  command: z.string().nullable().optional(),
  skills: z.array(z.string()).default([]),
});
export type Prompt = z.infer<typeof Prompt>;

export const Request = z.object({
  prompt_idx: z.number().int().nonnegative(),
  ts: z.string().datetime(),
  model: z.string(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative(),
  cache_creation_tokens: z.number().int().nonnegative(),
  lines_added: z.number().int().nonnegative(),
  lines_removed: z.number().int().nonnegative(),
});
export type Request = z.infer<typeof Request>;

export const Session = z.object({
  agent_kind: AgentKind,
  session_id: z.string().uuid(),
  path_hash: z.string().regex(/^[a-f0-9]{16}$/),
  project_name: z.string().max(255).optional(),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime(),
  model: z.string(),
  cli_version: z.string().optional(),
  host: z.string().max(255).optional(),
  tokens: TokenCounts,
  lines_added: z.number().int().nonnegative(),
  lines_removed: z.number().int().nonnegative(),
  lines_by_extension: z.record(z.string(), LineDiff).default({}),
  tools: z.record(z.string(), z.number().int().nonnegative()).default({}),
  prompts: z.array(Prompt).default([]),
  requests: z.array(Request).default([]),
  subagents: z.record(z.string(), z.number().int().nonnegative()).default({}),
});
export type Session = z.infer<typeof Session>;
