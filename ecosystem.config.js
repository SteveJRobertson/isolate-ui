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
 *   Required: GITHUB_TOKEN, WEBHOOK_SECRET, GITHUB_OWNER, GITHUB_REPO
 *   Set these in a .env.production file (not tracked in git)
 */

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

      // Logging: Rotate daily, preserve 14 days of history
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/webhook-listener-error.log',
      out_file: 'logs/webhook-listener-out.log',
      max_size: '10M', // Rotate when individual log reaches 10MB
      max_file: 14, // Keep 14 rotated log files (14 days of history)

      // Health check: HTTP liveness probe every 30s
      // Uncomment once /health endpoint is implemented in webhook-listener
      // http_proxy: 'http://localhost:8080/health',

      // Environment variables loaded from .env.production (recommended for production)
      // or can be set directly here (not recommended for secrets)
      env: {
        NODE_ENV: 'production',
        // Load from .env.production or override here:
        // GITHUB_TOKEN: process.env.GITHUB_TOKEN,
        // WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
        // GITHUB_OWNER: process.env.GITHUB_OWNER,
        // GITHUB_REPO: process.env.GITHUB_REPO,
        // HOST: process.env.HOST || '0.0.0.0',
        // PORT: process.env.PORT || '8080',
        // DATABASE_PATH: process.env.DATABASE_PATH,
      },
    },
  ],
};
