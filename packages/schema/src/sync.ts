import { z } from 'zod';
import { Session } from './session.js';

export const SyncRequest = z.object({
  workspace_id: z.string().nullable(),
  sessions: z.array(Session).max(200),
});
export type SyncRequest = z.infer<typeof SyncRequest>;

// Server-side view of the same payload: only the envelope is validated up front so a
// single schema-invalid session can't 400 (and wedge) the whole batch. The API parses
// each element with `Session` individually and reports the bad ones in `failed`.
export const SyncRequestEnvelope = z.object({
  workspace_id: z.string().nullable(),
  sessions: z.array(z.unknown()).min(1).max(200),
});
export type SyncRequestEnvelope = z.infer<typeof SyncRequestEnvelope>;

export const SyncResponse = z.object({
  ok: z.literal(true),
  accepted: z.number().int().nonnegative(),
  ignored: z.number().int().nonnegative(),
  // session_ids that failed to ingest (malformed / ownership conflict). Lets the
  // CLI quarantine poison-pill sessions instead of stalling all future syncs.
  failed: z.array(z.string()).default([]),
});
export type SyncResponse = z.infer<typeof SyncResponse>;
