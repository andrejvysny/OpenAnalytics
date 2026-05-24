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
      }),
    ),
  );

  await db.transaction(async (tx) => {
    const [previous] = await tx
      .select({
        workspaceId: schema.sessions.workspaceId,
        userId: schema.sessions.userId,
        projectId: schema.sessions.projectId,
        agentKind: schema.sessions.agentKind,
        startedAt: schema.sessions.startedAt,
      })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, s.session_id))
      .limit(1);

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
          lastActiveAt: sql`GREATEST(${schema.projects.lastActiveAt}, ${endedAt})`,
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
        s.requests.map((r, idx) => ({
          sessionId: s.session_id,
          promptIdx: r.prompt_idx,
          ts: new Date(r.ts),
          model: r.model,
          inputTokens: r.input_tokens,
          outputTokens: r.output_tokens,
          cacheReadTokens: r.cache_read_tokens,
          cacheCreationTokens: r.cache_creation_tokens,
          costUsd: (requestCosts[idx]?.total ?? 0).toFixed(6),
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

    const refreshDaily = async (key: {
      workspaceId: string;
      userId: string;
      projectId: string;
      agentKind: string;
      date: string;
    }) => {
      await tx
        .insert(schema.dailyStats)
        .values({
          ...key,
          prompts: 0,
          sessions: 0,
          costUsd: '0',
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          linesAdded: 0,
          linesRemoved: 0,
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
            prompts: sql`(SELECT COALESCE(SUM(prompt_count),0) FROM sessions WHERE workspace_id=${key.workspaceId} AND user_id=${key.userId} AND project_id=${key.projectId} AND agent_kind=${key.agentKind} AND DATE(started_at AT TIME ZONE 'UTC')=${key.date})`,
            sessions: sql`(SELECT COUNT(*) FROM sessions WHERE workspace_id=${key.workspaceId} AND user_id=${key.userId} AND project_id=${key.projectId} AND agent_kind=${key.agentKind} AND DATE(started_at AT TIME ZONE 'UTC')=${key.date})`,
            costUsd: sql`(SELECT COALESCE(SUM(cost_usd),0) FROM sessions WHERE workspace_id=${key.workspaceId} AND user_id=${key.userId} AND project_id=${key.projectId} AND agent_kind=${key.agentKind} AND DATE(started_at AT TIME ZONE 'UTC')=${key.date})`,
            inputTokens: sql`(SELECT COALESCE(SUM(input_tokens),0) FROM sessions WHERE workspace_id=${key.workspaceId} AND user_id=${key.userId} AND project_id=${key.projectId} AND agent_kind=${key.agentKind} AND DATE(started_at AT TIME ZONE 'UTC')=${key.date})`,
            outputTokens: sql`(SELECT COALESCE(SUM(output_tokens),0) FROM sessions WHERE workspace_id=${key.workspaceId} AND user_id=${key.userId} AND project_id=${key.projectId} AND agent_kind=${key.agentKind} AND DATE(started_at AT TIME ZONE 'UTC')=${key.date})`,
            cacheReadTokens: sql`(SELECT COALESCE(SUM(cache_read_tokens),0) FROM sessions WHERE workspace_id=${key.workspaceId} AND user_id=${key.userId} AND project_id=${key.projectId} AND agent_kind=${key.agentKind} AND DATE(started_at AT TIME ZONE 'UTC')=${key.date})`,
            cacheCreationTokens: sql`(SELECT COALESCE(SUM(cache_creation_tokens),0) FROM sessions WHERE workspace_id=${key.workspaceId} AND user_id=${key.userId} AND project_id=${key.projectId} AND agent_kind=${key.agentKind} AND DATE(started_at AT TIME ZONE 'UTC')=${key.date})`,
            linesAdded: sql`(SELECT COALESCE(SUM(lines_added),0) FROM sessions WHERE workspace_id=${key.workspaceId} AND user_id=${key.userId} AND project_id=${key.projectId} AND agent_kind=${key.agentKind} AND DATE(started_at AT TIME ZONE 'UTC')=${key.date})`,
            linesRemoved: sql`(SELECT COALESCE(SUM(lines_removed),0) FROM sessions WHERE workspace_id=${key.workspaceId} AND user_id=${key.userId} AND project_id=${key.projectId} AND agent_kind=${key.agentKind} AND DATE(started_at AT TIME ZONE 'UTC')=${key.date})`,
          },
        });
      await tx.delete(schema.dailyStats).where(and(
          eq(schema.dailyStats.workspaceId, key.workspaceId),
          eq(schema.dailyStats.userId, key.userId),
          eq(schema.dailyStats.projectId, key.projectId),
          eq(schema.dailyStats.agentKind, key.agentKind),
          eq(schema.dailyStats.date, key.date),
          sql`${schema.dailyStats.sessions}=0`,
        ),
      );
    };

    await refreshDaily({
      workspaceId,
      userId,
      projectId,
      agentKind: s.agent_kind,
      date: startedAt.toISOString().slice(0, 10),
    });
    if (previous) {
      await refreshDaily({
        workspaceId: previous.workspaceId,
        userId: previous.userId,
        projectId: previous.projectId,
        agentKind: previous.agentKind,
        date: previous.startedAt.toISOString().slice(0, 10),
      });
    }

    // Suppress unused-variable warning when block has only side effects.
    void and;
  });
}
