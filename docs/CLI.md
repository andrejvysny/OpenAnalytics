# OpenAnalytics CLI — user guide

The `oa` CLI watches `~/.claude/projects/` on your machine and ships **metadata only** (no prompts, no file contents, no raw paths) to your OpenAnalytics server. Run it on every machine where you use Claude Code; sessions from all machines merge into one dashboard view.

---

## 1. Install

### Option A — single-binary (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/andrejvysny/OpenAnalytics/master/scripts/install.sh | sh
```

The installer detects your OS + arch, downloads the right binary from GitHub Releases, drops it in `~/.local/bin/oa`, and prints next steps. Add `~/.local/bin` to your `PATH` if it isn't already.

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

> Best practice: one API key per machine. That way you can revoke a single machine if needed and you get per-host attribution in the dashboard.

---

## 3. Log in

```bash
oa login \
  --api-url https://openanalytics.andrejvysny.sk \
  --api-key oa_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

This writes `~/.config/openanalytics/config.json` (mode 600) with your API URL, key, and the machine `host` value used to tag sessions.

Verify:

```bash
oa status
# →  api url:      https://openanalytics.andrejvysny.sk
#    api key:      oa_live_xxx…
#    host:         <your-hostname>
#    transcripts:  N total, M pending sync
```

---

## 4. Backfill existing sessions

```bash
oa import
```

Walks every `~/.claude/projects/<slug>/<uuid>.jsonl`, parses it, and pushes the aggregated session. Idempotent — re-runs deduplicate by session UUID.

Refresh the dashboard — Overview now shows your history.

---

## 5. Run continuously

For **near-realtime sync** (every new Claude Code session shows up in the dashboard within ~2s of finishing):

```bash
oa daemon
```

The daemon watches `~/.claude/projects/` with chokidar, debounces 1.5s, and POSTs to `/api/sync`. Stops cleanly on Ctrl-C.

### Run as a background service

#### macOS (launchd)

Create `~/Library/LaunchAgents/dev.openanalytics.daemon.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.openanalytics.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/YOU/.local/bin/oa</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/oa-daemon.log</string>
  <key>StandardErrorPath</key><string>/tmp/oa-daemon.log</string>
</dict>
</plist>
```

Load it:

```bash
launchctl load -w ~/Library/LaunchAgents/dev.openanalytics.daemon.plist
# To stop:
launchctl unload ~/Library/LaunchAgents/dev.openanalytics.daemon.plist
```

#### Linux (systemd user)

Create `~/.config/systemd/user/oa-daemon.service`:

```ini
[Unit]
Description=OpenAnalytics daemon

[Service]
ExecStart=%h/.local/bin/oa daemon
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

Enable:

```bash
systemctl --user daemon-reload
systemctl --user enable --now oa-daemon
journalctl --user -u oa-daemon -f       # tail logs
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

Create a separate API key per machine in the dashboard (`oa login` with that key). Sessions are natural-keyed by their UUID and scoped to your user, so the dashboard merges everything automatically. Each session keeps a `host` value so you can drill into per-machine usage.

---

## 7. Common operations

| Command                     | What it does                                                          |
| --------------------------- | --------------------------------------------------------------------- |
| `oa status`                 | Show config + pending-sync count                                      |
| `oa sync`                   | Sync new sessions once and exit                                       |
| `oa import`                 | Backfill — re-syncs every transcript (idempotent)                     |
| `oa daemon`                 | Long-running watcher                                                  |
| `oa workspace set <slug>`   | Attribute future syncs to a shared workspace (for team billing split) |
| `oa workspace ls`           | List workspaces you're a member of                                    |
| `oa project disable <slug>` | Stop syncing a specific project                                       |

Config lives at `~/.config/openanalytics/config.json`. Sync cursors (byte offsets per file) live at `~/.config/openanalytics/cursors.json`.

---

## 8. Privacy guarantees

Inspect any payload before it goes out:

```bash
oa sync --dry-run    # (planned for v0.2 — currently you can curl the parser output)
```

What gets shipped per session:

- `session_id` (UUID from the transcript filename)
- `path_hash` — FNV-1a 64-bit of the cwd (16 hex chars). **Never the raw path.**
- `started_at` / `ended_at`, `model`, `cli_version`, `host`
- Tokens: input / output / cache_read / cache_creation
- Lines added/removed, broken down by file **extension only**
- Tool call counts (`Bash: 19, Write: 47, …`)
- Prompts: count + **character length only** (never the text)
- Per-request token deltas + the model used

What never leaves your machine: prompt text, file contents, bash commands, file paths, working directory names.

---

## 9. Troubleshooting

| Symptom                                   | Fix                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `not logged in`                           | Run `oa login` again with `--api-key`                                                                                                       |
| Dashboard shows nothing after `oa import` | Check `oa status` for pending count. Run `OA_LOG=debug oa sync` to see HTTP responses.                                                      |
| `connection refused`                      | API URL wrong, or your firewall blocks 443. `curl -I https://<api-url>/health` should return 200.                                           |
| Sessions appear under a wrong project     | Project name is the last segment of `cwd`; rename in **Settings → Projects** (planned v0.2) or change your repo directory name and re-sync. |
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
