import { eq, sql } from 'drizzle-orm';
import { schema } from '@oa/db';
import type { Session as SessionPayload } from '@oa/schema';
import type { Db } from '../db';
import { computeCost } from './pricing';

export interface IngestResult {
  accepted: number;
  ignored: number;
  failed: string[];
}

export async function ingestSessions(
  db: Db,
  userId: string,
  workspaceId: string,
  sessions: SessionPayload[],
): Promise<IngestResult> {
  let accepted = 0;
  const failed: string[] = [];

  for (const s of sessions) {
    try {
      await ingestOne(db, userId, workspaceId, s);
      accepted++;
    } catch (err) {
      console.error('[ingest] session failed', s.session_id, err);
      failed.push(s.session_id);
    }
  }
  return { accepted, ignored: failed.length, failed };
}

async function ingestOne(
  db: Db,
  userId: string,
  workspaceId: string,
  s: SessionPayload,
): Promise<void> {
  const startedAt = new Date(s.started_at);
  const endedAt = new Date(s.ended_at);
  const durationS = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
  const promptCount = s.prompts.length;
  const requestCount = s.requests.length;

  const sessionCacheCreation5m = s.tokens.cache_creation_5m ?? 0;
  const sessionCacheCreation1h = s.tokens.cache_creation_1h ?? 0;
  const sessionExtraTotal = s.tokens.extra_total ?? 0;
  const cost = await computeCost(db, {
    agentKind: s.agent_kind,
    model: s.model,
    startedAt,
    inputTokens: s.tokens.input,
    outputTokens: s.tokens.output,
    cacheReadTokens: s.tokens.cache_read,
    cacheCreationTokens: s.tokens.cache_creation,
    cacheCreation5mTokens: sessionCacheCreation5m,
    cacheCreation1hTokens: sessionCacheCreation1h,
  });
  const requestCosts = await Promise.all(
    s.requests.map((r) =>
      computeCost(db, {
        agentKind: s.agent_kind,
        model: r.model,
        startedAt: new Date(r.ts),
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cacheReadTokens: r.cache_read_tokens,
        cacheCreationTokens: r.cache_creation_tokens,
        cacheCreation5mTokens: r.cache_creation_5m_tokens ?? 0,
        cacheCreation1hTokens: r.cache_creation_1h_tokens ?? 0,
      }),
    ),
  );

  await db.transaction(async (tx) => {
    // Ownership guard: session_id is a client-supplied UUID and the PK. Without this,
    // a key holder who learns another tenant's session_id could reassign it (the upsert
    // overwrites user_id/workspace_id) and the child-row DELETEs would destroy their data.
    const [owner] = await tx
      .select({ userId: schema.sessions.userId })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, s.session_id))
      .limit(1);
    if (owner && owner.userId !== userId) {
      throw new Error(`session ${s.session_id} is owned by another user`);
    }

    const projectName = s.project_name ?? s.path_hash;
    const [project] = await tx
      .insert(schema.projects)
      .values({
        workspaceId,
        ownerUserId: userId,
        pathHash: s.path_hash,
        name: projectName,
        lastActiveAt: endedAt,
      })
      .onConflictDoUpdate({
        target: [
          schema.projects.workspaceId,
          schema.projects.ownerUserId,
          schema.projects.pathHash,
        ],
        set: {
          lastActiveAt: sql`GREATEST(${schema.projects.lastActiveAt}, ${endedAt.toISOString()}::timestamptz)`,
          name: projectName,
        },
      })
      .returning({ id: schema.projects.id });
    const projectId = project!.id;

    await tx
      .insert(schema.sessions)
      .values({
        id: s.session_id,
        workspaceId,
        userId,
        projectId,
        agentKind: s.agent_kind,
        host: s.host ?? null,
        startedAt,
        endedAt,
        durationS,
        model: s.model,
        cliVersion: s.cli_version ?? null,
        inputTokens: s.tokens.input,
        outputTokens: s.tokens.output,
        cacheReadTokens: s.tokens.cache_read,
        cacheCreationTokens: s.tokens.cache_creation,
        cacheCreation5mTokens: sessionCacheCreation5m,
        cacheCreation1hTokens: sessionCacheCreation1h,
        reasoningTokens: s.tokens.reasoning,
        extraTotalTokens: sessionExtraTotal,
        linesAdded: s.lines_added,
        linesRemoved: s.lines_removed,
        promptCount,
        requestCount,
        costUsd: cost.total.toFixed(6),
        costBreakdown: cost,
        raw: null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.sessions.id,
        set: {
          workspaceId,
          userId,
          projectId,
          agentKind: s.agent_kind,
          host: s.host ?? null,
          startedAt,
          endedAt,
          durationS,
          model: s.model,
          cliVersion: s.cli_version ?? null,
          inputTokens: s.tokens.input,
          outputTokens: s.tokens.output,
          cacheReadTokens: s.tokens.cache_read,
          cacheCreationTokens: s.tokens.cache_creation,
          cacheCreation5mTokens: sessionCacheCreation5m,
          cacheCreation1hTokens: sessionCacheCreation1h,
          reasoningTokens: s.tokens.reasoning,
          extraTotalTokens: sessionExtraTotal,
          linesAdded: s.lines_added,
          linesRemoved: s.lines_removed,
          promptCount,
          requestCount,
          costUsd: cost.total.toFixed(6),
          costBreakdown: cost,
          updatedAt: new Date(),
        },
      });

    // Replace dependent rows: simplest safe option for v1.
    await tx.delete(schema.prompts).where(eq(schema.prompts.sessionId, s.session_id));
    await tx.delete(schema.requests).where(eq(schema.requests.sessionId, s.session_id));
    await tx.delete(schema.toolUsage).where(eq(schema.toolUsage.sessionId, s.session_id));
    await tx.delete(schema.languageDiffs).where(eq(schema.languageDiffs.sessionId, s.session_id));

    if (s.prompts.length > 0) {
      await tx.insert(schema.prompts).values(
        s.prompts.map((p) => ({
          sessionId: s.session_id,
          idx: p.idx,
          ts: new Date(p.ts),
          length: p.length,
          requestCount: p.request_count,
          command: p.command ?? null,
          skills: p.skills,
        })),
      );
    }

    if (s.requests.length > 0) {
      await tx.insert(schema.requests).values(
        s.requests.map((r, idx) => {
          const tsBucket = bucketRequestTimestamp(new Date(r.ts));
          return {
            sessionId: s.session_id,
            promptIdx: r.prompt_idx,
            ts: tsBucket,
            tsBucket,
            model: r.model,
            inputTokens: r.input_tokens,
            outputTokens: r.output_tokens,
            cacheReadTokens: r.cache_read_tokens,
            cacheCreationTokens: r.cache_creation_tokens,
            cacheCreation5mTokens: r.cache_creation_5m_tokens ?? 0,
            cacheCreation1hTokens: r.cache_creation_1h_tokens ?? 0,
            reasoningTokens: r.reasoning_tokens ?? 0,
            extraTotalTokens: r.extra_total_tokens ?? 0,
            costUsd: (requestCosts[idx]?.total ?? 0).toFixed(6),
            linesAdded: r.lines_added,
            linesRemoved: r.lines_removed,
          };
        }),
      );
    }

    const toolEntries = Object.entries(s.tools);
    if (toolEntries.length > 0) {
      await tx.insert(schema.toolUsage).values(
        toolEntries.map(([tool, count]) => ({
          sessionId: s.session_id,
          tool,
          count,
        })),
      );
    }

    const langEntries = Object.entries(s.lines_by_extension);
    if (langEntries.length > 0) {
      await tx.insert(schema.languageDiffs).values(
        langEntries.map(([ext, v]) => ({
          sessionId: s.session_id,
          ext,
          added: v.added,
          removed: v.removed,
        })),
      );
    }

    // daily_stats rollup is no longer maintained; overview/explore/heatmap SUM from sessions.
  });
}

function bucketRequestTimestamp(ts: Date): Date {
  return new Date(
    Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate(), ts.getUTCHours()),
  );
}
