import { z } from 'zod';
import { Session } from './session.js';

export const SyncRequest = z.object({
  workspace_id: z.string().nullable(),
  sessions: z.array(Session).max(200),
});
export type SyncRequest = z.infer<typeof SyncRequest>;

export const SyncResponse = z.object({
  ok: z.literal(true),
  accepted: z.number().int().nonnegative(),
  ignored: z.number().int().nonnegative(),
  // session_ids that failed to ingest (malformed / ownership conflict). Lets the
  // CLI quarantine poison-pill sessions instead of stalling all future syncs.
  failed: z.array(z.string()).default([]),
});
export type SyncResponse = z.infer<typeof SyncResponse>;
