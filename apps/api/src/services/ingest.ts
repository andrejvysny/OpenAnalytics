import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@oa/db';
import type { Session as SessionPayload } from '@oa/schema';
import type { Db } from '../db';
import { computeCost } from './pricing';

export interface IngestResult {
  accepted: number;
  ignored: number;
}

export async function ingestSessions(
  db: Db,
  userId: string,
  workspaceId: string,
  sessions: SessionPayload[],
): Promise<IngestResult> {
  let accepted = 0;
  let ignored = 0;

  for (const s of sessions) {
    try {
      await ingestOne(db, userId, workspaceId, s);
      accepted++;
    } catch (err) {
      console.error('[ingest] session failed', s.session_id, err);
      ignored++;
    }
  }
  return { accepted, ignored };
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

  const cost = await computeCost(db, {
    agentKind: s.agent_kind,
    model: s.model,
    startedAt,
    inputTokens: s.tokens.input,
    outputTokens: s.tokens.output,
    cacheReadTokens: s.tokens.cache_read,
    cacheCreationTokens: s.tokens.cache_creation,
  });

  await db.transaction(async (tx) => {
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
        set: { lastActiveAt: endedAt, name: projectName },
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
        reasoningTokens: s.tokens.reasoning,
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
          reasoningTokens: s.tokens.reasoning,
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
        s.requests.map((r) => ({
          sessionId: s.session_id,
          promptIdx: r.prompt_idx,
          ts: new Date(r.ts),
          model: r.model,
          inputTokens: r.input_tokens,
          outputTokens: r.output_tokens,
          cacheReadTokens: r.cache_read_tokens,
          cacheCreationTokens: r.cache_creation_tokens,
          linesAdded: r.lines_added,
          linesRemoved: r.lines_removed,
        })),
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

    // Refresh daily_stats for this session's date (UTC for v1).
    const date = startedAt.toISOString().slice(0, 10);
    await tx
      .insert(schema.dailyStats)
      .values({
        workspaceId,
        userId,
        projectId,
        agentKind: s.agent_kind,
        date,
        prompts: promptCount,
        sessions: 1,
        costUsd: cost.total.toFixed(6),
        inputTokens: s.tokens.input,
        outputTokens: s.tokens.output,
        cacheReadTokens: s.tokens.cache_read,
        cacheCreationTokens: s.tokens.cache_creation,
        linesAdded: s.lines_added,
        linesRemoved: s.lines_removed,
      })
      .onConflictDoUpdate({
        target: [
          schema.dailyStats.workspaceId,
          schema.dailyStats.userId,
          schema.dailyStats.projectId,
          schema.dailyStats.agentKind,
          schema.dailyStats.date,
        ],
        set: {
          // Rebuild from sessions table to remain consistent under retries.
          prompts: sql`(SELECT COALESCE(SUM(prompt_count),0) FROM sessions WHERE workspace_id=${workspaceId} AND user_id=${userId} AND project_id=${projectId} AND agent_kind=${s.agent_kind} AND DATE(started_at AT TIME ZONE 'UTC')=${date})`,
          sessions: sql`(SELECT COUNT(*) FROM sessions WHERE workspace_id=${workspaceId} AND user_id=${userId} AND project_id=${projectId} AND agent_kind=${s.agent_kind} AND DATE(started_at AT TIME ZONE 'UTC')=${date})`,
          costUsd: sql`(SELECT COALESCE(SUM(cost_usd),0) FROM sessions WHERE workspace_id=${workspaceId} AND user_id=${userId} AND project_id=${projectId} AND agent_kind=${s.agent_kind} AND DATE(started_at AT TIME ZONE 'UTC')=${date})`,
          inputTokens: sql`(SELECT COALESCE(SUM(input_tokens),0) FROM sessions WHERE workspace_id=${workspaceId} AND user_id=${userId} AND project_id=${projectId} AND agent_kind=${s.agent_kind} AND DATE(started_at AT TIME ZONE 'UTC')=${date})`,
          outputTokens: sql`(SELECT COALESCE(SUM(output_tokens),0) FROM sessions WHERE workspace_id=${workspaceId} AND user_id=${userId} AND project_id=${projectId} AND agent_kind=${s.agent_kind} AND DATE(started_at AT TIME ZONE 'UTC')=${date})`,
          cacheReadTokens: sql`(SELECT COALESCE(SUM(cache_read_tokens),0) FROM sessions WHERE workspace_id=${workspaceId} AND user_id=${userId} AND project_id=${projectId} AND agent_kind=${s.agent_kind} AND DATE(started_at AT TIME ZONE 'UTC')=${date})`,
          cacheCreationTokens: sql`(SELECT COALESCE(SUM(cache_creation_tokens),0) FROM sessions WHERE workspace_id=${workspaceId} AND user_id=${userId} AND project_id=${projectId} AND agent_kind=${s.agent_kind} AND DATE(started_at AT TIME ZONE 'UTC')=${date})`,
          linesAdded: sql`(SELECT COALESCE(SUM(lines_added),0) FROM sessions WHERE workspace_id=${workspaceId} AND user_id=${userId} AND project_id=${projectId} AND agent_kind=${s.agent_kind} AND DATE(started_at AT TIME ZONE 'UTC')=${date})`,
          linesRemoved: sql`(SELECT COALESCE(SUM(lines_removed),0) FROM sessions WHERE workspace_id=${workspaceId} AND user_id=${userId} AND project_id=${projectId} AND agent_kind=${s.agent_kind} AND DATE(started_at AT TIME ZONE 'UTC')=${date})`,
        },
      });

    // Suppress unused-variable warning when block has only side effects.
    void and;
  });
}
