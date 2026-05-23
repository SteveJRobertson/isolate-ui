# Webhook Listener Deployment Guide (Mac Mini)

This guide provides manual instructions for deploying the `webhook-listener` application to a Mac Mini, running it continuously with **PM2**, and exposing it to GitHub Webhooks using **Tailscale Funnel**.

## Prerequisites (Mac Mini)

### Required Software Versions

1.  **Node.js 20.x or 22.x** (20.x+ compatible, 22.x preferred)

    ```bash
    node --version  # must output v20.x.x or v22.x.x
    ```

    **Why**: The project is tested on Node.js 22.x in CI and uses `better-sqlite3` (third-party package, not Node's built-in sqlite module). Node.js 20.x is fully compatible but not as extensively tested. Use Node.js 22.x if available, fall back to 20.x if needed.

    If needed, update via Homebrew:

    ```bash
    # Install Node 22 (preferred)
    brew install node@22
    brew link node@22 --overwrite

    # Or Node 20 if 22 is unavailable
    brew install node@20
    brew link node@20 --overwrite
    ```

2.  **pnpm 10.30.3** (exact version enforced by `package.json`)

    ```bash
    pnpm --version  # must output 10.30.3
    ```

    Install or update globally:

    ```bash
    npm install -g pnpm@10.30.3
    ```

3.  **PM2** (for process management and clustering)

    ```bash
    npm install -g pm2
    pm2 --version  # verify installation
    ```

4.  **Tailscale** (for secure network exposure)
    - Install from [tailscale.com](https://tailscale.com/download/mac)
    - Log in: `tailscale login`
    - Verify Funnel is enabled in your tailnet ACLs

⚠️ **Important:** Verify versions before proceeding. Mismatched versions will cause build or runtime failures.

## 1. Application Setup & Build

### 1.1 Clone Repository

```bash
git clone https://github.com/SteveJRobertson/isolate-ui.git
cd isolate-ui
```

### 1.2 Install Dependencies

```bash
pnpm install
```

**Important:** The `prepare` script runs automatically after install and regenerates design tokens + Panda CSS utilities:

```bash
# This happens automatically during pnpm install
"prepare": "husky && node libs/shared/tokens/build.mjs && pnpm exec panda codegen"
```

✓ **Verify post-install:** Check that `styled-system/` directory exists:

```bash
ls styled-system/
# Should output: helpers.mjs, styles.css, css/, jsx/, patterns/, recipes/, tokens/, types/
```

If the `styled-system/` directory is missing or empty, the build will fail. Re-run `pnpm install` if needed.

### 1.3 Build for Production

```bash
# Build with production configuration (removes source maps)
pnpm nx build webhook-listener --configuration=production

# Optional: Create pruned lockfile for smaller deployment footprint
pnpm nx prune webhook-listener
```

Output location: `dist/apps/webhook-listener/`

### 1.4 Create Data Directory

```bash
mkdir -p data
# SQLite database will be auto-created here on first startup
```

## 2. Environment Variables Setup

### Required Variables

| Variable         | Description                                                | Example                                        |
| ---------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| `GITHUB_TOKEN`   | GitHub Personal Access Token (PAT) with `repo` scope       | `ghp_xxxx...`                                  |
| `WEBHOOK_SECRET` | HMAC secret for GitHub webhook verification (min 32 chars) | Auto-generated, set in GitHub webhook settings |
| `GITHUB_OWNER`   | Repository owner                                           | `SteveJRobertson`                              |
| `GITHUB_REPO`    | Repository name                                            | `isolate-ui`                                   |

### Optional Variables

| Variable                 | Description                                           | Default                  | When to Use                              |
| ------------------------ | ----------------------------------------------------- | ------------------------ | ---------------------------------------- |
| `ANTHROPIC_API_KEY`      | Anthropic API key for Claude-based agents             | —                        | If orchestrator uses Claude LLM          |
| `OPENAI_API_KEY`         | OpenAI API key for GPT-based agents                   | —                        | If orchestrator uses GPT LLM             |
| `HOST`                   | Server bind address                                   | `0.0.0.0`                | Keep as-is for Tailscale exposure        |
| `PORT`                   | Server listen port                                    | `8080`                   | Change only if port conflicts            |
| `DATABASE_PATH`          | SQLite database file path                             | `./data/orchestrator.db` | Keep relative path for portability       |
| `STARTUP_SYNC_WINDOW_MS` | Lookback window for missed GitHub commands on startup | `3600000` (1 hour)       | Increase if server is offline >1hr       |
| `LANGCHAIN_TRACING_V2`   | Enable LangChain debug tracing                        | `'false'`                | Set to `'true'` for debugging            |
| `LANGCHAIN_API_KEY`      | LangChain API key (pairs with LANGCHAIN_TRACING_V2)   | —                        | Only if LANGCHAIN_TRACING_V2 is `'true'` |

## 3. PM2 Configuration

Create an `ecosystem.config.js` file in the repository root:

```javascript
module.exports = {
  apps: [
    {
      name: 'isolate-ui-webhook-listener',
      script: 'dist/apps/webhook-listener/main.js',

      // Clustering: Use all available CPU cores for better throughput
      // ✅ Safe with SQLite WAL mode + 5s busy_timeout (verified via regression testing)
      instances: 'max',
      exec_mode: 'cluster',

      // Restart strategy: Prevent rapid restart loops on startup failure
      max_restarts: 10, // Fail after 10 restart attempts
      min_uptime: '10s', // Minimum uptime before restart counter resets
      max_memory_restart: '300M', // Force restart if memory exceeds 300MB

      // Graceful shutdown: Allow 30s for ongoing requests & checkpoint saves
      kill_timeout: 30000, // Send SIGTERM, wait 30s for graceful shutdown
      listen_timeout: 5000, // Wait 5s for app to listen on port

      // Logging: Rotate daily, keep 14 days of history
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_size: '10M', // Rotate when log reaches 10MB
      max_file: 14, // Keep 14 rotated log files (14 days)

      // Health check: PM2 HTTP probe every 30s (webhook-listener must return 200 from /health)
      // Uncomment once /health endpoint is implemented
      // http_proxy: 'http://localhost:8080/health',
      // cron_restart: '0 0 * * *',  // Daily restart at midnight (optional)

      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '8080',

        // REQUIRED: Set these before starting
        GITHUB_TOKEN: 'YOUR_GITHUB_PERSONAL_ACCESS_TOKEN',
        WEBHOOK_SECRET: 'YOUR_WEBHOOK_SECRET_MIN_32_CHARS',
        GITHUB_OWNER: 'SteveJRobertson',
        GITHUB_REPO: 'isolate-ui',

        // Database persistence (relative to project root after build)
        DATABASE_PATH: './data/orchestrator.db',

        // OPTIONAL: Add if needed
        // ANTHROPIC_API_KEY: 'sk-ant-...',
        // OPENAI_API_KEY: 'sk-...',
        // STARTUP_SYNC_WINDOW_MS: '3600000',
        // LANGCHAIN_TRACING_V2: 'false',
      },
    },
  ],
};
```

⚠️ **SECURITY WARNING:** Never commit `ecosystem.config.js` with real tokens. Use a `.env` file approach instead (recommended for production).

### Alternative: Environment File Approach (Recommended for Production)

For production deployments, use a separate `.env.production` file:

```bash
# .env.production (not tracked in git)
NODE_ENV=production
GITHUB_TOKEN=ghp_xxxx...
WEBHOOK_SECRET=your-secret-min-32-chars
GITHUB_OWNER=SteveJRobertson
GITHUB_REPO=isolate-ui
DATABASE_PATH=./data/orchestrator.db
HOST=0.0.0.0
PORT=8080
```

Then load in `ecosystem.config.js` via `dotenv`:

```javascript
require('dotenv').config({ path: '.env.production' });

module.exports = {
  apps: [
    {
      name: 'isolate-ui-webhook-listener',
      script: 'dist/apps/webhook-listener/main.js',
      instances: 'max',
      exec_mode: 'cluster',
      // ... other config ...
      env: {
        NODE_ENV: process.env.NODE_ENV,
        GITHUB_TOKEN: process.env.GITHUB_TOKEN,
        // ... etc ...
      },
    },
  ],
};
```

### Start the Service

```bash
# Start with clustering enabled (uses all CPU cores)
pm2 start ecosystem.config.js

# Save PM2 process list for recovery after reboot
pm2 save

# Configure PM2 to auto-start on Mac Mini reboot (macOS-specific)
pm2 startup darwin
# Follow the prompt to complete the installation
```

### Verify Service is Running

```bash
pm2 status                               # Show all processes
pm2 logs isolate-ui-webhook-listener    # Tail logs (Ctrl+C to exit)
pm2 monit                                # Real-time monitoring (Ctrl+C to exit)
pm2 show isolate-ui-webhook-listener    # Show process details
```

## 4. Health Check Endpoint (Optional but Recommended)

For PM2 to automatically detect and restart zombie processes, add a `/health` endpoint to the webhook-listener:

**File:** `apps/webhook-listener/src/routes/health.ts`

```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function registerHealthRoute(fastify: FastifyInstance) {
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({ status: 'ok', timestamp: new Date().toISOString() });
  });
}
```

Then register in `main.ts`:

```typescript
import { registerHealthRoute } from './routes/health';

// ... after fastify setup ...
await registerHealthRoute(fastify);
```

Once deployed, enable PM2 health check in `ecosystem.config.js`:

```javascript
{
  // ... app config ...
  http_proxy: 'http://localhost:8080/health',  // PM2 checks every 30s
}
```

If health check fails 3 times in a row, PM2 will automatically restart the process.

## 5. Network Exposure (Tailscale Funnel)

Expose the local port `8080` to the internet using Tailscale Funnel:

```bash
tailscale funnel 8080
```

Tailscale will output a public URL (e.g., `https://your-mac-mini.tailnet-name.ts.net`). Note this URL.

## 6. Log Rotation Setup (pm2-logrotate Plugin — REQUIRED)

Log rotation prevents disk space from filling with large log files and is critical for production stability.

### Why pm2-logrotate is Required

**Important:** PM2's `max_size` and `max_file` settings in `ecosystem.config.js` are **ineffective without pm2-logrotate**. Without this plugin installed, logs will grow unbounded and fill disk, crashing the service.

The `max_size: '10M'` and `max_file: 14` values in this config are **placeholders only** — they become active only when pm2-logrotate is installed and running.

### Installation

Install the pm2-logrotate plugin globally on the Mac Mini:

```bash
npm install -g pm2-logrotate
pm2 install pm2-logrotate
pm2 save  # Persist the plugin in PM2 startup
```

**Verify installation:**

```bash
pm2 list  # Should show pm2-logrotate in the module list
```

Output should include a line like:

```
⊙ pm2-logrotate (running)
```

### Configuration

**Single source of truth:** Log rotation settings are defined in `ecosystem.config.js`:

```javascript
max_size: '10M',   // Rotate when individual log reaches 10MB
max_file: 14,      // Keep 14 rotated files (~14 days of history)
```

Once pm2-logrotate is installed, it automatically uses these `max_size` and `max_file` values. **Do not use `pm2 conf` to override these settings** — keep all rotation configuration in `ecosystem.config.js` for consistency across deployments.

To adjust rotation limits (e.g., rotate more frequently or keep fewer files):

1. Edit `ecosystem.config.js` and change `max_size` or `max_file`
2. Restart: `pm2 restart ecosystem.config.js`
3. Verify: `pm2 show webhook-listener | grep -E 'max_size|max_file'`

### Post-Deployment Validation

After deploying with PM2, run this checklist to verify pm2-logrotate is installed and working:

```bash
# 1. Confirm pm2-logrotate module is installed and running
pm2 list | grep logrotate
# Expected: "⊙ pm2-logrotate (running)"
# If NOT present, rotation is NOT working — see Troubleshooting below

# 2. Show webhook-listener process details and rotation settings
pm2 show webhook-listener | grep -E 'status|error_file|out_file|max_size|max_file'
# Expected:
#   status: online
#   error_file: .../logs/webhook-listener-error.log
#   out_file: .../logs/webhook-listener-out.log
#   max_size: 10M
#   max_file: 14

# 3. List existing logs and verify they're < 10MB
ls -lh logs/webhook-listener-*.log
# Expected: Files < 10MB (will rotate when they reach 10MB)

# 4. Check recent log entries from the webhook-listener process
pm2 logs webhook-listener
# Expected: Recent logs from the running process (no errors)
```

### Ongoing Monitoring & Troubleshooting

See [docs/LOGROTATION_VERIFICATION.md](LOGROTATION_VERIFICATION.md) for:

- Daily/weekly monitoring checklists
- Commands to monitor log rotation in production
- Troubleshooting if logs aren't rotating as expected
- Disk usage tracking over time

## 7. GitHub Webhook Configuration

1.  Go to your GitHub repository -> **Settings** -> **Webhooks** -> **Add webhook**.
2.  **Payload URL**: `https://your-mac-mini.tailnet-name.ts.net/webhook`
3.  **Content type**: `application/json`
4.  **Secret**: Paste the same `WEBHOOK_SECRET` from your `ecosystem.config.js` or `.env.production`
5.  **Events**: Select:
    - "Issue comments"
    - "Pull requests"
    - "Issues"
6.  **Active**: Check the box to enable
7.  Save the webhook.

## 8. Database Initialization & Startup Sync ✅ (Already Implemented)

### Auto-Initialization

On first startup, the webhook-listener automatically creates the SQLite database with all required tables (schema auto-creation, no migrations needed):

- **`checkpoints`** — LangGraph state snapshots per thread (implemented in ai-orchestrator)
- **`checkpoint_writes`** — Channel data for each checkpoint, with version tracking
- **`deliveries`** — GitHub webhook delivery IDs (deduplication, prevents replay attacks)
- **`webhook_sync`** — Cursor for startup replay of missed commands

**Implementation Details:**

- Database initialization: `libs/ai-orchestrator/src/persistence/langgraph-saver.ts`
- Webhook schema: `apps/webhook-listener/src/db/schema.ts`
- Uses `CREATE TABLE IF NOT EXISTS` for safe idempotent initialization
- Automatic migration: `task_id` column is auto-added to `checkpoint_writes` if missing (backward compatible)

**Verify database was created:**

```bash
ls -la data/orchestrator.db
# Should show file size > 0, created timestamp recent

# Inspect schema
sqlite3 data/orchestrator.db ".tables"
# Should output: checkpoint_writes  checkpoints  deliveries  webhook_sync
```

### Startup Sync Behavior

Every time the webhook-listener starts, it:

1. Queries the `webhook_sync` table for `last_sync_time` cursor
2. Fetches missed GitHub comments since that time (default: 1 hour lookback)
3. Re-processes commands from authorized users only
4. Updates the cursor to current time
5. Logs summary: "Startup sync complete: processed N missed commands"

This ensures commands posted while the server was offline are not lost.

**Override the lookback window** (if server is offline >1 hour):

```javascript
// In ecosystem.config.js env:
STARTUP_SYNC_WINDOW_MS: '7200000'; // 2 hours instead of default 1 hour
```

## 8. AI Orchestrator Validation ✅ (Already Implemented)

### Critical Startup Validation

The webhook-listener automatically validates that all 6 AI personas are defined in `AGENTS.md` before accepting any webhook payloads. **If any persona is missing, the server will fail to start with a clear error message.**

**Implementation Details:**

- Validation occurs in `libs/ai-orchestrator/src/config/agent-parser.ts` at startup
- Fail-fast behavior: throws immediately before SQLite connection opens
- No manual validation needed — happens automatically

Required personas (must exist as `@isolate-<id>` in [AGENTS.md](AGENTS.md)):

- `@isolate-po` — Product Owner
- `@isolate-architect` — Architect
- `@isolate-dev` — Developer
- `@isolate-a11y` — Accessibility Specialist
- `@isolate-qa` — QA Engineer
- `@isolate-docs` — Documentation

**Verify personas exist before deployment:**

```bash
# Check if all 6 personas are defined
grep -o '@isolate-[a-z]*' AGENTS.md | sort -u

# Should output:
# @isolate-a11y
# @isolate-architect
# @isolate-dev
# @isolate-docs
# @isolate-po
# @isolate-qa
```

If fewer than 6 personas appear, the server startup will fail with:

```
Error: Missing required persona: @isolate-<name>
```

## 9. Enhanced Verification & Testing

### Pre-Deployment Checklist

Before starting the service, verify:

```bash
# 1. Node.js version (must be 22.x.x)
node --version

# 2. pnpm version (must be 10.30.3)
pnpm --version

# 3. Design tokens generated (styled-system/ directory exists)
ls styled-system/ | head -5

# 4. Build output exists
ls dist/apps/webhook-listener/main.js

# 5. SQLite database will be created on startup (data/ directory exists)
ls -la data/

# 6. All 6 personas defined
grep -o '@isolate-[a-z]*' AGENTS.md | sort -u | wc -l
# Should output: 6

# 7. Required env vars set in ecosystem.config.js
grep -E 'GITHUB_TOKEN|WEBHOOK_SECRET' ecosystem.config.js
```

### Startup Verification

```bash
# Start the service
pm2 start ecosystem.config.js

# Wait 3-5 seconds for startup
sleep 5

# Check process status
pm2 status isolate-ui-webhook-listener
# Status should be 'online' (not 'stopped' or 'errored')

# Check logs for startup messages
pm2 logs isolate-ui-webhook-listener | head -50
# Should contain:
#   - "Fastify server listening on 0.0.0.0:8080"
#   - "Startup sync complete" or "No missed commands"
#   - No error messages about missing personas

# Verify database was created
ls -la data/orchestrator.db

# Check current memory usage
pm2 monit  # Press Ctrl+C to exit
```

### Post-Deployment Testing

1. **GitHub Webhook Ping Test**
   - Go to repository Settings → Webhooks
   - Click on your webhook
   - Scroll to "Recent Deliveries"
   - Click the first delivery (usually a `ping` event)
   - Should show Response Status: `200`
   - PM2 logs should show corresponding entry

2. **Health Check (if implemented)**

   ```bash
   curl http://localhost:8080/health
   # Should return: {"status":"ok","timestamp":"2026-05-16T..."}
   ```

3. **End-to-End Test**
   - Create a test issue in the GitHub repository
   - Comment with `/query test message`
   - Watch PM2 logs in real-time:
     ```bash
     pm2 logs isolate-ui-webhook-listener --lines 100
     ```
   - Should see webhook payload processing, AI orchestrator invocation, and response posting

## 10. Troubleshooting & Error Recovery

### Common Startup Issues

| Issue                                               | Cause                                | Solution                                                                    |
| --------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------- | -------------- |
| `Error: Missing required persona: @isolate-po`      | `AGENTS.md` incomplete               | Add missing persona definition to AGENTS.md                                 |
| `Error: GITHUB_TOKEN is required`                   | Env var not set                      | Set GITHUB_TOKEN in ecosystem.config.js or .env.production                  |
| `Error: EADDRINUSE: address already in use :::8080` | Port 8080 already in use             | Change PORT in env config or kill existing process: `lsof -ti:8080          | xargs kill -9` |
| `Port 8080 listening but responds to no requests`   | Fastify failed to initialize         | Check PM2 logs for initialization errors; check for GITHUB_TOKEN validation |
| `SQLite database locked error`                      | Multiple instances accessing same DB | Ensure only one webhook-listener instance is running: `pm2 list`            |

### Crash / Restart Recovery

If the webhook-listener crashes:

1. **PM2 automatically restarts it** (configured with `max_restarts: 10`)
2. **Startup sync replays missed commands** (within `STARTUP_SYNC_WINDOW_MS` window)
3. **Deliveries table deduplicates** — if a GitHub webhook is retried multiple times, only processed once

✓ **No manual intervention needed** — Designed for resilience.

### Viewing Detailed Logs

```bash
# Real-time logs (Ctrl+C to exit)
pm2 logs isolate-ui-webhook-listener

# Last 100 lines
pm2 logs isolate-ui-webhook-listener --lines 100

# Error logs only
pm2 logs isolate-ui-webhook-listener --err

# Both stdout and stderr
pm2 logs isolate-ui-webhook-listener --both
```

### Restarting the Service

```bash
# Restart (graceful: SIGTERM, wait 30s, then SIGKILL)
pm2 restart isolate-ui-webhook-listener

# Stop all instances and delete from PM2 list
pm2 delete isolate-ui-webhook-listener
pm2 save

# Restart after changes
pm2 start ecosystem.config.js
pm2 save
```

## 11. Data Persistence & Backup Strategy

### SQLite Database Location

Default: `./data/orchestrator.db` (relative to project root)

Alternative: Set `DATABASE_PATH` environment variable:

```bash
DATABASE_PATH=/var/lib/isolate-ui/orchestrator.db
```

### WAL Files

SQLite automatically creates Write-Ahead Logging (WAL) files:

- `data/orchestrator.db-wal` — Active transaction log
- `data/orchestrator.db-shm` — Shared memory for concurrent readers

**Keep these files with the main database file during backups.**

### Backup Recommendations

1. **Daily backup of `./data/` directory**

   ```bash
   # Via cron (runs daily at 2 AM)
   0 2 * * * cp -r /path/to/isolate-ui/data /backups/isolate-ui-data-$(date +%Y%m%d).bak
   ```

2. **Monitor disk usage**

   ```bash
   du -sh data/
   # Database typically < 50MB for normal usage
   ```

3. **Restore from backup**

   ```bash
   # Stop the service first
   pm2 stop isolate-ui-webhook-listener

   # Restore database
   cp -r /backups/isolate-ui-data-<date>.bak/* data/

   # Restart
   pm2 start ecosystem.config.js
   ```

### Single Point of Failure Mitigation

The SQLite database is the single point of failure. Consider:

1. **Backup frequency**: Daily minimum, hourly if critical
2. **Off-site backups**: Copy backups to another machine/cloud storage
3. **Monitoring**: Set up alerts if database file is not being updated
4. **Recovery time**: Keep recent backups (7-14 days) for quick recovery

## 11. Startup Sync Race Condition (PM2 Clustering) ⚠️

### Identified Issue

When multiple PM2 instances start simultaneously, there is an unprotected race condition in the startup sync logic:

**Problem Scenario:**

- Instance A and Instance B both start
- Both read the same `webhook_sync` cursor (e.g., `2026-05-15T14:30:00Z`)
- Both fetch missed GitHub comments since that time
- Instance A finishes GitHub API call at `2026-05-15T14:30:15Z` (faster)
- Instance B finishes at `2026-05-15T14:29:50Z` (slower, earlier timestamp)
- Instance B's cursor write happens last → **cursor regresses** to earlier time
- Next restart rescans wider window → **wasted GitHub API quota**

**Implementation:** `apps/webhook-listener/src/sync/startup.ts` (lines 42-87)

### Mitigation (Current)

✅ **Command deduplication is safe**: The `deliveries` table uses `INSERT OR IGNORE`, preventing actual duplicate command execution even if both instances process the same comments.

⚠️ **Efficiency is compromised**: Cursor regression causes:

- Wasted GitHub API quota (redundant comment fetches)
- Unpredictable cursor movement in logs
- Cannot reliably predict startup window coverage

### Severity Assessment

**Data Integrity:** ✅ Safe (dedup table prevents duplicates)  
**Operational Efficiency:** ⚠️ Medium concern (quota waste)  
**Blocking Deployment:** ❌ No (existing mitigation prevents data loss)

### Recommendations

**Phase 1 (Now):** Deploy with monitoring

- Monitor PM2 logs for cursor regression patterns
- Track GitHub API quota usage (should stay consistent)
- Monitor for unexpected "processing duplicate command" logs (would indicate race condition not caught by dedup)

**Phase 2 (Later):** Implement permanent fix

- See [PM2_STARTUP_SYNC_RACE_CONDITION.md](PM2_STARTUP_SYNC_RACE_CONDITION.md) for detailed mitigation options
- Options: (1) Database transaction wrapping, (2) SELECT ... FOR UPDATE locking, (3) Distributed consensus via leader election

### Monitoring Post-Deployment

```bash
# Watch for cursor regression
pm2 logs isolate-ui-webhook-listener | grep -i cursor

# Expected: cursor always moves forward (increasing timestamps)
# Warning sign: cursor jumps backward in logs

# Check GitHub API quota
# Stable quota usage per day = good
# Erratic spikes = potential cursor regression
```

## 12. Production Checklist

Before going live:

- [ ] Node.js 20.x+ installed and verified (22.x preferred)
- [ ] pnpm 10.30.3 installed and verified
- [ ] `pnpm install` ran successfully and `styled-system/` directory exists
- [ ] `pnpm nx build webhook-listener --configuration=production` completed without errors
- [ ] All 6 personas defined in AGENTS.md
- [ ] `ecosystem.config.js` or `.env.production` created with all required vars (GITHUB_TOKEN, WEBHOOK_SECRET)
- [ ] `data/` directory created
- [ ] `pm2 start ecosystem.config.js` started successfully
- [ ] `pm2 status` shows process as 'online'
- [ ] PM2 logs show "Fastify server listening..." and "Startup sync complete"
- [ ] SQLite database file created: `ls -la data/orchestrator.db`
- [ ] `pm2 save` executed to persist process list
- [ ] `pm2 startup darwin` configured for auto-start on reboot
- [ ] Tailscale Funnel configured: `tailscale funnel 8080`
- [ ] GitHub webhook configured with Payload URL and Secret
- [ ] GitHub webhook 'ping' test successful (green checkmark in Recent Deliveries)
- [ ] Backup strategy for `data/` directory in place
- [ ] Health check endpoint implemented and `/health` returns 200 (**HIGH PRIORITY** for remote deployment)
- [ ] Monitoring plan established for startup sync cursor behavior (watch for regression)
- [ ] GitHub API quota tracking enabled (baseline quota established)

## Common Commands Reference

```bash
# Monitoring
pm2 status                              # Process status
pm2 logs isolate-ui-webhook-listener   # View logs
pm2 monit                               # Real-time monitoring
pm2 show isolate-ui-webhook-listener   # Detailed process info

# Management
pm2 restart isolate-ui-webhook-listener  # Restart process
pm2 stop isolate-ui-webhook-listener     # Stop process
pm2 start ecosystem.config.js            # Start from config
pm2 delete isolate-ui-webhook-listener   # Remove from PM2

# Persistence
pm2 save                                # Save process list
pm2 startup darwin                      # Configure auto-start on reboot
pm2 unstartup darwin                    # Remove auto-start

# Database
sqlite3 data/orchestrator.db ".tables" # List tables
sqlite3 data/orchestrator.db "SELECT COUNT(*) FROM deliveries;"  # Check dedup table

# Deployment
pnpm install                            # Install dependencies
pnpm nx build webhook-listener --configuration=production  # Build
grep -o '@isolate-[a-z]*' AGENTS.md | sort -u | wc -l  # Validate personas
```
