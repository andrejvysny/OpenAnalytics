import { z } from 'zod';
import { TokenCounts } from './session.js';

export const UsageAgentKind = z.enum(['claude-code', 'codex', 'opencode', 'gemini']);
export type UsageAgentKind = z.infer<typeof UsageAgentKind>;

export const LocalUsageEvent = z.object({
  agent_kind: UsageAgentKind,
  session_id: z.string().min(1),
  request_id: z.string().min(1).optional(),
  ts: z.string().datetime(),
  model: z.string().min(1).optional(),
  tokens: TokenCounts,
});
export type LocalUsageEvent = z.infer<typeof LocalUsageEvent>;
