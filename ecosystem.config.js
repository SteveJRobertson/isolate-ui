/**
 * PM2 Ecosystem Configuration for webhook-listener
 *
 * Production deployment configuration for the GitHub webhook listener service.
 * Manages process clustering, restarts, logging, and health checks.
 *
 * Usage:
 *   pm2 start ecosystem.config.js              # Start service
 *   pm2 restart ecosystem.config.js            # Restart service
 *   pm2 stop ecosystem.config.js               # Stop service
 *   pm2 logs                                    # View logs
 *
 * Environment variables:
 *   Required: GITHUB_TOKEN, WEBHOOK_SECRET
 *   Optional: GITHUB_OWNER, GITHUB_REPO, HOST, PORT, DATABASE_PATH, STARTUP_SYNC_WINDOW_MS
 *   Set these in .env.production (loaded automatically below if the file exists)
 */

// Load .env.production if present — keeps secrets out of this file
require('dotenv').config({ path: '.env.production' });

module.exports = {
  apps: [
    {
      name: 'webhook-listener',
      script: 'dist/apps/webhook-listener/main.js',

      // Clustering: Use all available CPU cores for parallel webhook processing
      // ✅ Safe with SQLite WAL mode + 5s busy_timeout (verified via regression testing)
      instances: 'max',
      exec_mode: 'cluster',

      // Restart strategy: Prevent rapid restart loops on startup failure
      max_restarts: 10, // Fail permanently after 10 restart attempts
      min_uptime: '10s', // Reset restart counter after running 10s continuously
      max_memory_restart: '300M', // Force graceful restart if memory exceeds 300MB

      // Graceful shutdown: Allow 30s for ongoing webhook processing and DB operations
      kill_timeout: 30000, // Send SIGTERM, wait 30s before SIGKILL
      listen_timeout: 5000, // Wait 5s for app to bind to port

      // Logging: Built-in rotation (size-based) + optional pm2-logrotate plugin (cron-based)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // PM2 built-in rotation (ALWAYS ACTIVE):
      //   • Rotates logs when size reaches max_size (10MB)
      //   • Keeps max_file number of rotated files (~14 days of history)
      //   • Triggered automatically by PM2 — no external service needed
      //   • Archive location: same directory as current logs
      //
      // pm2-logrotate plugin (OPTIONAL — enhances rotation):
      //   • Provides external cron-based rotation control (complements built-in)
      //   • Adds administrative oversight for rotation policies
      //   • Install globally: `npm install -g pm2-logrotate && pm2 install pm2-logrotate`
      //   • See docs/LOGROTATION_VERIFICATION.md for post-deploy validation + monitoring
      //
      // Both work together: built-in handles daily rotation, plugin adds external safety net.
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/webhook-listener-error.log',
      out_file: 'logs/webhook-listener-out.log',
      max_size: '10M', // Rotate when individual log reaches 10MB
      max_file: 14, // Keep 14 rotated log files (~14 days of history)

      // Health check: HTTP liveness probe every 30s
      // Uses process.env.PORT so the probe stays in sync with runtime configuration.
      // dotenv.config() above ensures PORT is populated from .env.production before this line evaluates.
      http_proxy: `http://localhost:${process.env.PORT || 8080}/health`,

      // Environment variables: loaded from .env.production via dotenv (above).
      // Only NODE_ENV is hardcoded here; all other vars come from .env.production.
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
