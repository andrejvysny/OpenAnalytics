# OpenAnalytics CLI — user guide

The `oa` CLI watches `~/.claude/projects/` on your machine and ships **metadata only** (no prompts, no file contents, no raw paths, no raw project names by default) to your OpenAnalytics server. Run it on every machine where you use Claude Code; sessions from all machines merge into one dashboard view.

---

## 1. Install

### Option A — single-binary (recommended)

```bash
curl -fsSL https://github.com/andrejvysny/OpenAnalytics/releases/latest/download/install.sh | sh
```

The installer detects your OS + arch, downloads the right binary and `SHA256SUMS` from GitHub Releases, verifies SHA256, drops it in `~/.local/bin/oa`, and prints next steps. Add `~/.local/bin` to your `PATH` if it isn't already.

> Supported: macOS arm64 + x64, Linux arm64 + x64, Windows x64.

### Option B — from source (dev)

```bash
git clone https://github.com/andrejvysny/OpenAnalytics.git
cd OpenAnalytics
bun apps/cli/src/index.ts --help
```

---

## 2. Get an API key

1. Open the dashboard: <https://openanalytics.andrejvysny.sk>
2. Sign in.
3. Go to **Settings → API keys → Create key**. Give it a name like the machine it runs on (`laptop`, `desktop`, etc.).
4. Copy the `oa_live_…` secret immediately — it's shown **once**. Lose it and you'll need to revoke + create a new one.

> Best practice: one API key per machine. That way you can revoke a single machine if needed and get per-machine attribution in the dashboard.

---

## 3. Log in

```bash
oa login \
  --api-url https://openanalytics.andrejvysny.sk \
  --api-key oa_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Optional privacy opt-ins: add `--send-hostname` to send your raw hostname, or `--send-project-name` to send raw project basenames. Both are off by default.

This writes `~/.config/openanalytics/config.json` (mode 600) with your API URL, key, random machine id, and workspace salt used for local path hashing.

Verify:

```bash
oa status
# →  api url:      https://openanalytics.andrejvysny.sk
#    api key:      oa_live_xxx…
#    machine id:   <random-id>
#    transcripts:  N total, M pending sync
```

---

## 4. Backfill existing sessions

```bash
oa import
```

Walks every `~/.claude/projects/<slug>/<uuid>.jsonl`, merges subagent transcripts, parses it, and pushes the aggregated session. Idempotent — re-runs deduplicate by session UUID.

Refresh the dashboard — Overview now shows your history.

---

## 5. Run continuously

For **near-realtime sync** (new Claude Code sessions show up in the dashboard shortly after file updates):

```bash
oa daemon
```

The daemon runs one catch-up `oa sync` on startup, then watches `~/.claude/projects/` with chokidar, debounces 1.5s, and POSTs to `/api/sync`. Stops cleanly on Ctrl-C.

### Run as a background service

#### macOS (launchd)

```bash
oa service install
oa service status
oa service uninstall   # stop/remove
```

#### Linux (systemd user)

```bash
oa service install
oa service status
journalctl --user -u oa-daemon -f       # tail logs
oa service uninstall                    # stop/remove
```

> If you want the daemon to start without you logging in: `loginctl enable-linger $USER`.

#### One-off cron alternative

If you don't need realtime:

```cron
*/15 * * * * /home/YOU/.local/bin/oa sync >/dev/null 2>&1
```

Pulls in any new session every 15 minutes.

---

## 6. Multi-machine — one user, many laptops

Create a separate API key per machine in the dashboard (`oa login` with that key). Sessions are natural-keyed by their UUID and scoped to your user, so the dashboard merges everything automatically. Each session keeps a random machine id so you can drill into per-machine usage without sending the hostname.

---

## 7. Common operations

| Command                     | What it does                                                          |
| --------------------------- | --------------------------------------------------------------------- |
| `oa status`                 | Show config + pending-sync count                                      |
| `oa sync`                   | Sync sessions changed since cursor checkpoint once and exit           |
| `oa sync --dry-run`         | Print sanitized payload without sending or advancing cursors          |
| `oa import`                 | Backfill — re-syncs every transcript (idempotent)                     |
| `oa import --dry-run`       | Print backfill payload without sending or advancing cursors           |
| `oa daemon`                 | Long-running watcher                                                  |
| `oa service install`        | Register daemon with launchd/systemd                                  |
| `oa service status`         | Show daemon service status                                            |
| `oa service uninstall`      | Stop and remove daemon service                                        |

Config lives at `~/.config/openanalytics/config.json`. Sync cursors (last processed file size per absolute path) live at `~/.config/openanalytics/cursors.json`.

---

## 8. Privacy guarantees

Inspect any payload before it goes out:

```bash
oa sync --dry-run
```

What gets shipped per session:

- `session_id` (UUID from the transcript filename)
- `path_hash` — workspace-salted HMAC of the cwd (16 hex chars). **Never the raw path.**
- `started_at` / `ended_at`, `model`, `cli_version`, random machine id (`host` field)
- Tokens: input / output / cache_read / cache_creation
- Lines added/removed, broken down by file **extension only**
- Tool call counts (`Bash: 19, Write: 47, …`)
- Prompts: count + **character length only** (never the text)
- Per-request token deltas + the model used

What never leaves your machine by default: prompt text, file contents, bash commands, file paths, working directory names, project basenames, raw hostname.

---

## 9. Troubleshooting

| Symptom                                   | Fix                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `not logged in`                           | Run `oa login` again with `--api-key`                                                                                                       |
| Dashboard shows nothing after `oa import` | Check `oa status` for pending count. Run `OA_LOG=debug oa sync` to see HTTP responses.                                                      |
| `connection refused`                      | API URL wrong, or your firewall blocks 443. `curl -I https://<api-url>/health` should return 200.                                           |
| Sessions appear under a hash-like project | Raw project names are not sent by default; rename in the dashboard or opt into project-name sending locally.                               |
| Want to start over                        | Delete `~/.config/openanalytics/cursors.json`, then `oa import`.                                                                            |

---

## 10. Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/dev.openanalytics.daemon.plist 2>/dev/null   # macOS
systemctl --user disable --now oa-daemon 2>/dev/null                                  # Linux
rm ~/.local/bin/oa
rm -rf ~/.config/openanalytics
```

Revoke the API key in the dashboard under **Settings → API keys** so it can no longer push.
