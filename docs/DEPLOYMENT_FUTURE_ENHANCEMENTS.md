# Deployment & Operations — Future Enhancements

This document tracks optional improvements identified during Mac Mini deployment guide review (May 2026). These are **not blocking** for initial deployment but improve operational observability and resilience.

---

## Priority: HIGH ⚠️

### Health Check Endpoint (`/health`)

**Status:** Not yet implemented  
**Location:** `apps/webhook-listener/src/routes/`  
**Scope:** Add a simple HTTP health probe endpoint

**Why:** Critical for remote (Mac Mini) deployments with PM2 clustering. Enables:

- Automatic detection of zombie processes (listening but unresponsive)
- PM2 HTTP liveness probes every 30 seconds
- Automatic restart without manual SSH intervention
- Observability of instance health in PM2 monitoring

**Urgency:** Implement **before full production use**, but can test initial workflow without it.

**Implementation:**

Create `apps/webhook-listener/src/routes/health.ts`:

```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function registerHealthRoute(fastify: FastifyInstance) {
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({ status: 'ok', timestamp: new Date().toISOString() });
  });
}
```

Register in `apps/webhook-listener/src/main.ts`:

```typescript
import { registerHealthRoute } from './routes/health';

// ... after fastify setup ...
await registerHealthRoute(fastify);
```

Enable in `ecosystem.config.js`:

```javascript
{
  http_proxy: 'http://localhost:8080/health',  // PM2 checks every 30s
}
```

**Effort:** ~15 minutes  
**Testing:** `curl http://localhost:8080/health` should return `{"status":"ok","timestamp":"..."}`  
**Blocked By:** Nothing — can be implemented anytime

---

## Priority: Low

### Node.js Version Enforcement

**Status:** Not enforced in package.json  
**Scope:** Add `engines` field to lock Node.js version

**Why:** Prevents developers/CI from accidentally using unsupported Node versions.

**Implementation:**

Add to `package.json`:

```json
{
  "engines": {
    "node": ">=20.0.0",
    "pnpm": "10.30.3"
  }
}
```

**Effort:** ~2 minutes  
**Testing:** `npm install` on Node 18.x should fail with version mismatch  
**Blocked By:** Nothing — can be implemented anytime

---

### Database Backup Automation

**Status:** Manual via cron recommended, no automated backup script  
**Scope:** Create automated backup script for SQLite data directory

**Why:** Reduces human error, ensures regular backups without manual intervention.

**Implementation:**

Create `scripts/backup-database.sh`:

```bash
#!/bin/bash

BACKUP_DIR="${BACKUP_ROOT:-/backups/isolate-ui}"
DATA_DIR="$(pwd)/data"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"
cp -r "$DATA_DIR/orchestrator.db"* "$BACKUP_DIR/orchestrator.db.$TIMESTAMP"
echo "Backup completed: $BACKUP_DIR/orchestrator.db.$TIMESTAMP"

# Keep only last 7 days
find "$BACKUP_DIR" -name "orchestrator.db.*" -mtime +7 -delete
```

Add cron job via `pm2`:

```bash
# In ecosystem.config.js
{
  cron_restart: '0 2 * * *',  // Daily at 2 AM
  exec_mode: 'cluster',
}
```

Or manual cron:

```bash
0 2 * * * /path/to/isolate-ui/scripts/backup-database.sh
```

**Effort:** ~20 minutes  
**Testing:** Run manually, verify backups created and old ones pruned  
**Blocked By:** Nothing — can be implemented anytime

---

## Current Deployment Status

✅ **Ready to Deploy:**

- [x] Persona validation (automatic)
- [x] HMAC signature verification (automatic)
- [x] SQLite database schema (auto-created)
- [x] PM2 clustering + WAL mode (verified safe)
- [x] Startup sync replay (automatic)

⏳ **Optional Enhancements (for better observability):**

- [ ] Health check endpoint — adds PM2 zombie detection
- [ ] Node.js version enforcement — prevents version mismatches
- [ ] Backup automation — ensures regular database backups

---

## Deployment Timeline Recommendation

**Phase 1 (Now):** Deploy & test workflow

- Cluster mode enabled (with dedup-based mitigation for race condition)
- Monitor for cursor regression and API quota anomalies
- Test end-to-end workflow on Mac Mini
- Follow [docs/MAC_MINI_DEPLOYMENT.md](MAC_MINI_DEPLOYMENT.md) §1-11

**Phase 1.5 (Within 1 week, BEFORE full production):** Implement safety features (~30 min)

- **Health check endpoint** (§4 of MAC_MINI_DEPLOYMENT.md) — enables PM2 zombie detection (~15 min)
- **Advisory lock for startup sync** (§12 of MAC_MINI_DEPLOYMENT.md) — eliminates cursor regression risk (~20 min)
- Run 24+ hours of testing with both features enabled
- Verify GitHub API quota remains stable and predictable
- Required before going fully live on remote Mac Mini

**Phase 2 (1-2 weeks after Phase 1.5):** Optional operational improvements

- Backup automation script (`scripts/backup-database.sh`)
- Off-site backup strategy (e.g., daily copies to cloud storage)
- Can be deferred indefinitely if workflow is stable

**Phase 3 (Later):** Optional code improvements

- Node.js version enforcement in package.json (`engines` field)
- Can be deferred indefinitely

---

## Notes

- All critical features for deployment are already implemented (personas validation, HMAC verification, database schema, WAL mode)
- Startup sync race condition identified but mitigated by deliveries dedup table (prevents data loss but wastes API quota)
- Advisory lock implementation in Phase 1.5 prevents quota waste and cursor regression
- Phase 1.5 features are required before full production use but can be implemented in parallel with shakedown testing
- Deployment can proceed to Phase 1 immediately
