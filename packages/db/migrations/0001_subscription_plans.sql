ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "plan_kind" varchar(32) DEFAULT 'custom' NOT NULL;
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "plan_name" varchar(64);
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "monthly_price_usd" numeric(12, 2);
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "split_mode" varchar(32) DEFAULT 'usage' NOT NULL;
ALTER TABLE "workspace_members" ADD COLUMN IF NOT EXISTS "expected_share_bps" integer;
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL;

UPDATE "workspaces"
SET
  "plan_kind" = CASE
    WHEN lower(coalesce("plan_tier", '')) LIKE '%pro%' THEN 'pro'
    WHEN lower(coalesce("plan_tier", '')) LIKE '%20%' THEN 'max_20x'
    WHEN lower(coalesce("plan_tier", '')) LIKE '%5%' THEN 'max_5x'
    ELSE 'custom'
  END,
  "plan_name" = coalesce("plan_tier", "plan_name"),
  "monthly_price_usd" = coalesce("monthly_price_usd", "monthly_budget_usd"::numeric(12, 2));
