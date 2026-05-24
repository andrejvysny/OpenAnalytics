Here is the comprehensive `SPECIFICATION.md` document based on the full exploration of Vibenalytics:

---

# SPECIFICATION.md — Vibenalytics

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Global Layout & Navigation](#2-global-layout--navigation)
3. [Overview Page](#3-overview-page)
4. [Explore Page](#4-explore-page)
5. [Analytics Page](#5-analytics-page)
6. [Projects Page](#6-projects-page)
7. [Project Detail Page](#7-project-detail-page)
8. [Plan Utilization & Shared Plan](#8-plan-utilization--shared-plan)
9. [Settings](#9-settings)
10. [Global UI Elements](#10-global-ui-elements)

---

## 1. Product Overview

**Vibenalytics** (`app.vibenalytics.dev`) is a Claude Code usage analytics dashboard. It syncs session data from the Claude Code CLI tool and presents developers with detailed breakdowns of their coding activity: cost, tokens, prompts, tool calls, code diff statistics, and language usage — at per-session, per-day, per-project, and all-time granularities. It also supports **shared plans**, allowing multiple users to track and compare their Claude Code consumption under a single billing subscription.

---

## 2. Global Layout & Navigation

### Sidebar (Left)
The collapsible left sidebar contains:

- **Logo** — Vibenalytics logo and wordmark, links to `/overview`
- **Main Navigation Links**:
  - `Overview` → `/overview`
  - `Explore` → `/explore`
  - `Analytics` → `/insights`
  - `Projects` → `/projects`
- **Shared Plan Quick Link** — Shows the name of the active shared plan (e.g., "Riso Split"), links to `/plan/{planId}`
- **Settings** — Links to `/settings`
- **Collapse** — Toggles sidebar collapsed/expanded state

### Top Bar (Header)
Persistent across all pages:
- **Breadcrumb** — Shows workspace name (user avatar + name) → current page name
- **Search** — Global search input (`Search...` placeholder); keyboard shortcut `/`
- **Streak Counter** — Displays current activity streak (e.g., `11d`); clicking opens the "Embed on GitHub" modal
- **Notifications Bell** — Opens notification dropdown with event list (e.g., "Invite accepted – [User] joined '[Plan Name]'"); "Mark all read" action
- **User Menu** — Avatar + name; dropdown includes: display name, Settings link, Sign out

### Global Actions (Overview page only)
- **Embed on GitHub** — Opens a modal providing:
  - Markdown snippet for embedding an activity SVG badge in a GitHub README
  - "Copy Markdown" button
  - Visual preview of the SVG badge (activity heatmap + all-time stats)
  - **Direct SVG URL** (`https://api.vibenalytics.dev/api/embed/{userId}.svg`)
- **Last synced [time]** — Shows timestamp of last data sync
- **Refresh** — Triggers a manual data sync

### Stop Claude Button
- A **"Stop Claude"** floating button appears globally; intended to terminate active Claude Code sessions remotely.

---

## 3. Overview Page

**Route:** `/overview`

The Overview page is the main dashboard, combining real-time and historical data in a single view.

### 3.1 Today Widget

Displays a summary of the current calendar day's Claude Code usage.

| Metric | Description |
|---|---|
| **Cost** | Total USD spent today (e.g., `$0.27`) |
| **Active sessions** | Number of active Claude Code sessions today |
| **Prompts** | Total number of prompts sent today |
| **Diff** | Lines of code added (`+N`) and deleted (`−N`) today |
| **Tools** | Total tool invocations today |
| **Top Languages** | Languages modified today with line-level diffs (e.g., TypeScript +97/−39) |

**Top 3 Projects Today** — A ranked list of today's most active projects, each showing:
- Project name (links to project detail)
- Cost, prompt count, diff (+lines/−lines)
- Horizontal progress bar (relative cost)
- "See all active projects today →" link (→ `/explore?preset=today`)

**Date display** — Shows full day name + date (e.g., "Sunday, May 24")

**"View full report →"** — Links to `/explore?preset=today`

### 3.2 Plan Utilization Widget

A compact widget in the top-right of the Overview page, showing the current billing cycle's shared plan usage.

See [Section 8](#8-plan-utilization--shared-plan) for full specification.

### 3.3 Timeline Widget

A **real-time scrolling timeline** showing Claude Code events from the last 60 minutes.

- **X-axis** — Time, scrolling from oldest (left) to `now` (right), displayed at 15-minute intervals
- **Rows** — One row per active project
- **Event blocks** — Color-coded rectangles for three event types:
  - `prompt` (orange/amber)
  - `command` (blue)
  - `compaction` (yellow)
- **Event counter** — "N events (last 60m)" displayed in the legend
- **Info tooltip** available via `?` icon next to the section title

### 3.4 Activity Heatmap Widget

A **GitHub-style contribution heatmap** showing daily activity across the full year.

- **X-axis** — Months (Jan–Dec), subdivided into weeks
- **Y-axis** — Day of week (Mon, Wed, Fri)
- **Cell color intensity** — Reflects prompt count for that day; darker = higher activity
- **Year selector** — Navigation arrows to switch year; currently shows `2026`
- **"All-time analytics →"** link to `/insights`

**All-time Summary Stats** (displayed alongside heatmap):
| Stat | Description |
|---|---|
| **Cost** | Total all-time cost (e.g., `$2.7K`) |
| **Sessions** | Total sessions (e.g., `787`) |
| **Prompts** | Total prompts (e.g., `2,943`) |
| **Active Days** | Days with at least 1 prompt (e.g., `96`) |
| **Streak** | Current consecutive active day streak (e.g., `11d`) |
| **Top Language** | Most-used language by line diff (e.g., `Markdown`) |

### 3.5 Top Projects Widget

A sortable, paginated grid of all projects with activity stats.

**Sort options:**
- Sort by Cost (default)
- Sort by Prompts
- Sort by Tools
- Sort by Sessions

**Per-project display:**
- Project name (links to project detail)
- Session count, tool call count, total cost
- Horizontal relative-size bar

**Pagination:** "Show all 87 projects" button (collapses/expands)

**"View all →"** link to `/projects`

---

## 4. Explore Page

**Route:** `/explore`

The Explore page provides **time-range-scoped analytics**, allowing users to filter all data to a specific period.

### 4.1 Date Range Selector

**Preset quick-filters (top bar):**
- Yesterday
- Today
- This week
- Last 7 days *(default)*
- This month
- Last 30 days

**Custom Date Picker** (dropdown on right):
- Two-month calendar view
- Click start date → click end date to set a custom range
- Displays selected range (e.g., "May 18, 2026 → May 24, 2026")
- "Apply" button to confirm

### 4.2 Summary Stats Bar

For the selected period:
| Metric | Description |
|---|---|
| **Cost** | Total cost in USD |
| **Sessions** | Number of sessions |
| **Prompts** | Total prompts |
| **Diff** | +lines added / −lines deleted |
| **Active days** | Days with activity in range |
| **Tokens** | Total token usage (input + output), shown as total and individually |
| **Cache Hit** | Percentage of token requests served from cache |
| **Cost/Prompt** | Average cost per prompt |

### 4.3 Token Usage Chart

- **Line/area chart** of token consumption over the selected period
- Granularity auto-adjusts (hourly/daily/weekly) based on range
- Toggle: "Daily" granularity label visible
- X-axis shows dates; Y-axis shows token counts (in millions: `400.0M`, etc.)

### 4.4 Active Projects

- Projects with at least 1 prompt in the selected period, sorted by cost
- Displays total projects count (e.g., "9 projects")
- Per-project: name, cost, diff (+/−), sessions, prompts

### 4.5 Languages

- All programming/markup languages modified during the period
- Detected from Git-style diffs
- Shows language icon, name, +lines added, −lines deleted
- Presented as a multi-column grid sorted by line volume

### 4.6 Tool Usage

- Built-in Claude Code tools ranked by invocation count
- Total call count shown (e.g., "4,820 calls")
- Tools tracked: Bash, Read, Edit, Write, WebFetch, TaskUpdate, TaskCreate, Agent, WebSearch, ToolSearch, AskUserQuestion, ExitPlanMode, TaskList, Monitor, Grep, Glob, NotebookEdit, Skill, and others
- Horizontal bar chart per tool

### 4.7 Skills

- Custom slash-command skills invoked during the period
- Ranked by usage count
- Examples: `/effort`, `/loop`, `/smve`, `/brainstorm`, `/pipeline`, `/idea`, `/schedule`

---

## 5. Analytics Page

**Route:** `/insights`

The Analytics page shows **all-time aggregate statistics** — the complete historical record since the user first connected.

### 5.1 All-Time Summary Header

- Date range shown (e.g., "All-time data · Feb 2026 - May 2026")
- Metrics: Cost, Sessions, Prompts, Diff (+/−), Active Days, Streak, Token details (Input/Output/Cache Hit/Cost per Prompt)

### 5.2 Active Projects (All-Time)

- All 87+ projects, sortable by: Cost, Prompts, Sessions
- "Show all 87 projects" expandable list
- Per-project: name, session count, prompt count, cost

### 5.3 Languages (All-Time)

- Full language breakdown across all activity
- Same format as Explore, but total line diffs since account creation
- More languages visible (Markdown, TypeScript, TypeScript React, Python, C++, PHP, HTML, Rust, Swift, YAML, JSON, MDX, IPYNB, RMD, etc.)

### 5.4 Activity by Hour

- **Bar chart** showing prompt distribution across hours of the day (00:00–23:00)
- Peak hour highlighted (e.g., "Peak: 21:00")
- Helps identify personal productivity patterns

### 5.5 Tool Usage (All-Time)

- Full all-time tool invocation counts (e.g., 95,704 total calls)
- Same tool list as Explore, with total cumulative usage

### 5.6 MCP Tools

- External Model Context Protocol tools used via Claude Code
- Ranked by invocation count (e.g., 800 total calls)
- Examples: `playwright/browser_take_screenshot`, `playwright/browser_run_code`, `plugin_figma_figma/generate_figma_design`, `ohmybyte/advance_status`, `context7/query-docs`

### 5.7 Skills (All-Time)

- All custom slash-command skills used ever
- Examples: `/effort`, `/brainstorm`, `/pipeline`, `/idea`, `/loop`, `/logic-check`, `/de-ai`, `/polish`, `/smve`, `/study-pack`

---

## 6. Projects Page

**Route:** `/projects`

### 6.1 Project List

All Claude Code projects detected from synced sessions, sorted by most recently updated.

**Per-project row displays:**
- Folder icon
- **Project name** (links to project detail)
- **Short UUID** (first 8 chars of project ID)
- **Last updated** (relative, e.g., "Updated 47m ago", "Updated 1mo ago")
- **Cost** — All-time cost
- **Sessions** — Total session count
- **Prompts** — Total prompt count
- **Tool calls** — Total tool invocation count

### 6.2 Create Group

- **"Create Group"** button — allows organizing projects into named groups (folders)
- Groups appear as separate sections in the list

---

## 7. Project Detail Page

**Route:** `/projects/{projectId}`

A per-project analytics breakdown, showing all metrics scoped to that project.

### 7.1 Project Header

- Back arrow (← Projects)
- Project name with **inline edit** (pencil icon)

### 7.2 Summary Stats

Same metrics as Explore summary for the project lifetime:
- Cost, Sessions, Prompts, Diff, Active Days
- Tokens (Input, Output, Cache Hit, Cost/Prompt)

### 7.3 Token Usage Chart

- Same area chart as Explore, but scoped to this project
- Shows token consumption over the project lifetime

### 7.4 Languages

- Languages used in this project, detected from diffs
- Multi-column grid with line-level statistics

### 7.5 Tool Usage

- Claude Code tools used within this project
- Ranked bar chart with invocation counts
- Project-level total (e.g., "14,102 calls")

### 7.6 MCP Tools

- External MCP tools used within this project
- Ranked by invocation count

### 7.7 Skills

- Slash-command skills invoked in this project
- Ranked by usage count

---

## 8. Plan Utilization & Shared Plan

This is a core feature enabling multiple users to share a single Claude subscription and track each member's relative consumption.

---

### 8.1 Plan Utilization Widget (Overview Page)

**Location:** Top-right corner of the Overview page.

A compact card that provides at-a-glance billing cycle information.

**Visual elements:**
- **Circular donut gauge** — Shows percentage of the monthly budget consumed (e.g., `66% used`). The filled arc is blue; the unfilled portion is dark gray.
- **"Shared plan" badge** — Indicates the plan type; clicking navigates to the full Plan page (`/plan/{planId}`)
- **Gear icon (⚙)** — Links directly to Plan Settings (`/settings/plan`)
- **Info icon (ℹ)** — Tooltip: *"Shows how your shared Claude plan is split between members this billing cycle."*

**Members section:**
- Header label: **Members** with total spend vs. budget (e.g., `$66.06 / $100`)
- Each member row:
  - Avatar image
  - Display name + "(you)" indicator for current user
  - **Percentage of total plan spend** (e.g., `100%`, `0%`)
  - **Dollar amount spent** (e.g., `$66.06`, `$0.00`)

**Plan metadata (bottom row):**
| Field | Example |
|---|---|
| Plan tier | `Max 5x` |
| Price | `$100/mo` |
| Current period | `Apr 26 - May 26` |
| Next billing | `May 26, 2026` |

---

### 8.2 Shared Plan Detail Page

**Route:** `/plan/{planId}`

A full-page dashboard dedicated to the shared Claude plan, providing detailed per-member usage comparison across the billing cycle.

#### 8.2.1 Plan Header

Sticky header showing the plan summary:
- **Plan name** (e.g., "Riso Split")
- **Plan tier badge** (e.g., `Max 5x`)
- **Total spent / Budget** (e.g., `$66.06 / $100`)
- **Billing period** (e.g., `Apr 26 - May 26`)
- **Days remaining** (e.g., `2d left`)
- **Member avatars** with count (e.g., "2 members")
- **Circular donut gauge** — `66% used`
- **Plan settings link** (gear icon → `/settings/plan`)

#### 8.2.2 Real-Time KPI Cards

Four metric cards showing today's aggregate across all plan members:

| Card | Description |
|---|---|
| **Prompts today** | Total prompts across all members today |
| **Cost today** | Total USD cost across all members today |
| **Sessions today** | Active sessions across all members today |
| **Prompts (hourly)** | Prompts in the last hour across all members |

#### 8.2.3 Hourly Activity Chart

- **Line chart** showing prompt activity over the course of today (00:00–23:59)
- **Per-member color coding**: each member gets a distinct color line (e.g., Andrej Vyšný = blue, Riško Šléher = red/orange)
- **Legend** shows each member's name and color
- Title: "Hourly Activity · Today"
- Enables real-time comparison of usage patterns between plan members

#### 8.2.4 Daily Cost Chart

- **Stacked/grouped bar chart** showing cost per day across the full billing period (e.g., Apr 26 – May 26)
- **Per-member color coding** — same color scheme as Hourly Activity
- **Legend** shows member names and colors
- X-axis: individual dates of billing period
- Y-axis: USD cost ($0–$8+)
- Enables identification of high-spend days and comparison of spend timing between members
- Title includes date range: e.g., "Daily Cost · Apr 26 - May 26"

#### 8.2.5 Usage Split Section

A detailed breakdown of the billing cycle's spend, split by member.

- **Section title:** "Usage Split"
- **Total label:** "Total: $66.06" (right-aligned)

**Per-member row:**
- Avatar
- Display name + "(you)" for current user
- **Dollar amount** (e.g., `$66.06`) — color-coded (green for primary user)
- **Percentage of total** (e.g., `100%`, `0%`)
- **Horizontal progress bar** — width proportional to percentage share; visually shows relative consumption

**Per-member sub-stats** (shown below each member's bar):
| Stat | Example |
|---|---|
| Prompts | `697 prompts` |
| Sessions | `198 sessions` |
| Line diff | `+101,079 / −13,843 lines` |

This section provides a complete **member-vs-member usage comparison** for the billing period, making it clear who has used how much of the shared budget.

---

### 8.3 Plan Settings Page

**Route:** `/settings/plan`

The administrative interface for configuring the shared plan.

**Section: Sharing**

- **Billing period navigation** — Previous/next period arrows
- **Plan tier** — e.g., "Claude Max 5x"
- **Monthly price** — e.g., "$100/mo"
- **Next invoice date** — e.g., "May 26, 2026"
- **Remaining days** — e.g., "2 days"
- **Edit plan** button
- **Tracking context** — "Tracking shared usage for [Team Name] since [date]"

**Members section:**
- Header: "Members" + "Total: $[amount]"
- Per-member row:
  - Avatar, display name, "(you)" indicator
  - **Role badge**: `OWNER` or `MEMBER`
  - Dollar amount + percentage for current billing period
  - Prompt count and session count
  - **Edit join date** button (for member rows) — allows adjusting when a member's tracking began

**Invite section:**
- Email address input field
- **Join date selector** — Dropdown for "Joined [date]" (e.g., "Today") — sets from which date the new member's usage is tracked
- **Invite** button (sends invitation email)

**"Switch to personal subscription"** — Button to exit shared plan and revert to individual tracking

---

## 9. Settings

**Route:** `/settings`

Settings area has a separate layout with its own left navigation.

### Navigation:
- Profile
- Teams
- Claude Plan

### 9.1 Profile Settings (`/settings/profile`)
- **Name** — Display name (read-only display)
- **Email** — Account email (read-only display)

### 9.2 Teams Settings (`/settings/teams`)
- Lists all teams/shared plans the user belongs to
- Per-team: icon, name, member count, user role badge (`OWNER` / `MEMBER`)
- Clicking a team navigates to that plan's settings

### 9.3 Claude Plan Settings (`/settings/plan`)
See [Section 8.3](#83-plan-settings-page) for full specification.

---

## 10. Global UI Elements

### 10.1 Data Metrics Definitions

Across the app, the following standard metrics appear consistently:

| Term | Definition |
|---|---|
| **Cost** | Estimated USD cost of Claude API usage (tokens × pricing) |
| **Prompts** | Number of user prompt messages sent to Claude |
| **Sessions** | Number of distinct Claude Code sessions (terminal invocations) |
| **Diff / Lines** | Lines of code added (green, `+N`) and deleted (red, `−N`) as detected from file changes |
| **Tools / Tool calls** | Number of times Claude invoked a built-in or MCP tool |
| **Active Days** | Calendar days on which at least one prompt was sent |
| **Streak** | Consecutive calendar days with at least one prompt |
| **Cache Hit %** | Percentage of input tokens served from Anthropic's prompt cache (reduces cost) |
| **Cost/Prompt** | Average USD cost per prompt (`Total Cost ÷ Total Prompts`) |
| **Tokens** | Raw token counts: Input (prompt + context tokens), Output (completion tokens) |

### 10.2 Sidebar Plan Quick-Link

The sidebar shows the name of the active shared plan (e.g., "Riso Split") as a persistent quick-access link. Clicking navigates to `/plan/{planId}`.

### 10.3 Tooltips

Section headings throughout the app include an `ℹ` info icon that, when hovered, displays a one-sentence description of what the section shows. Examples:
- Today: *"Summary of today's Claude Code usage - cost, sessions, prompts, code changes, and your most active projects"*
- Plan Utilization: *"Shows how your shared Claude plan is split between members this billing cycle."*
- Token Usage: *"Token consumption over time, split by input and output. Granularity auto-adjusts based on your date range."*
- Tool Usage: *"Built-in Claude Code tools (Read, Edit, Bash, etc.) ranked by number of invocations."*
- Skills: *"Custom skills invoked via slash commands, ranked by usage count."*
- Active Projects: *"Projects with at least one prompt in the selected period, sorted by cost."*
- Activity: *"GitHub-style heatmap showing your daily Claude Code activity. Color intensity reflects prompt count"*

### 10.4 Language Icons

Programming languages are displayed with their associated technology icons (TypeScript blue, Python yellow, PHP, Markdown, etc.) throughout the Languages sections.

### 10.5 Notifications System

- Bell icon in header with unread count indicator (orange dot)
- Dropdown shows notification list: "Invite accepted – [User] joined '[Plan]'"
- "Mark all read" button

### 10.6 Embed on GitHub

Accessible via the streak counter (`11d`) in the header from any page.

**Modal contents:**
- **Markdown snippet** — Ready-to-paste GitHub README badge using the public API endpoint
- **"Copy Markdown"** button
- **Preview** — Live SVG preview showing the activity heatmap and all-time stats
- **Direct SVG URL** — `https://api.vibenalytics.dev/api/embed/{userId}.svg`

The embedded SVG displays: activity heatmap, Prompts, Sessions, Tool calls, Active days, Streak, Cost — all attributed to "vibenalytics".

---

*Specification generated from live exploration of app.vibenalytics.dev on May 24, 2026.*