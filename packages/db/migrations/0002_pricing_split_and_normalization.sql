-- Split 5m vs 1h cache writes on model_prices, add model family index.
-- Idempotent: safe to re-run.

-- 1) Rename existing single cache-write column to 5m variant if not yet renamed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'model_prices' AND column_name = 'cache_write_per_mtok'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'model_prices' AND column_name = 'cache_write_5m_per_mtok'
  ) THEN
    ALTER TABLE "model_prices" RENAME COLUMN "cache_write_per_mtok" TO "cache_write_5m_per_mtok";
  END IF;
END $$;

-- 2) Add 1h column and backfill (1h = 1.6 × 5m for all Claude 4.x models).
ALTER TABLE "model_prices"
  ADD COLUMN IF NOT EXISTS "cache_write_1h_per_mtok" numeric(12,6) NOT NULL DEFAULT '0';
UPDATE "model_prices"
  SET "cache_write_1h_per_mtok" = "cache_write_5m_per_mtok" * 1.6
  WHERE "cache_write_1h_per_mtok" = '0';

-- 3) Optional family column for normalized lookup fallback.
ALTER TABLE "model_prices" ADD COLUMN IF NOT EXISTS "model_family" varchar(64);
CREATE INDEX IF NOT EXISTS "model_prices_family_idx"
  ON "model_prices"("agent_kind", "model_family", "effective_from");

-- 4) Session/request 5m vs 1h cache split columns.
ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "cache_creation_5m_tokens" bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cache_creation_1h_tokens" bigint NOT NULL DEFAULT 0;
ALTER TABLE "requests"
  ADD COLUMN IF NOT EXISTS "cache_creation_5m_tokens" bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cache_creation_1h_tokens" bigint NOT NULL DEFAULT 0;

-- 5) Ensure personal workspaces created before the api-plan option default sensibly.
UPDATE "workspaces"
  SET "plan_kind" = 'api'
  WHERE "is_personal" = 1 AND ("plan_kind" IS NULL OR "plan_kind" = 'custom');
