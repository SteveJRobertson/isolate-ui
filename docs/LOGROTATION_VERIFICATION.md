# Log Rotation Verification & Monitoring Guide

This document provides operators with post-deployment validation procedures and ongoing production monitoring for log rotation on the webhook-listener service.

---

## Overview: Why Log Rotation Matters

Log rotation prevents:

- **Disk space exhaustion** — Logs filling disk without bounds
- **Performance degradation** — Large files slow down log searches and backups
- **Data loss** — Disk full conditions can crash the service or corrupt databases
- **Compliance violations** — Uncontrolled log retention may violate data retention policies

The webhook-listener uses **two complementary systems**:

1. **PM2 built-in rotation** — Automatically triggered when logs exceed 10MB
2. **pm2-logrotate plugin** — External cron-based rotation (administrative oversight)

---

## Post-Deployment Validation (One-Time Checklist)

Run this checklist **immediately after deploying the webhook-listener** to confirm log rotation is active.

### Step 1: Verify pm2-logrotate Module Installation

```bash
pm2 list
```

**Expected output:** A line showing pm2-logrotate as a running module:

```
⊙ pm2-logrotate (running)
```

**If pm2-logrotate is not listed:**

```bash
npm install -g pm2-logrotate
pm2 install pm2-logrotate
pm2 save
```

Then verify again with `pm2 list`.

### Step 2: Confirm Log File Paths

```bash
pm2 show webhook-listener | grep -E 'error_file|out_file'
```

**Expected output:**

```
error_file: /path/to/isolate-ui/logs/webhook-listener-error.log
out_file:  /path/to/isolate-ui/logs/webhook-listener-out.log
```

If paths are different or missing, verify `ecosystem.config.js` is correctly configured.

### Step 3: Check Log Directory Exists

```bash
ls -lh logs/
```

**Expected output:** Two log files exist:

```
-rw-r--r--  1 user  staff  2.3M May 23 10:15 webhook-listener-error.log
-rw-r--r--  1 user  staff  4.1M May 23 10:20 webhook-listener-out.log
```

If the directory doesn't exist, create it:

```bash
mkdir -p logs
chmod 755 logs
```

### Step 4: Verify PM2 Rotation Configuration

```bash
pm2 show webhook-listener | grep -E 'max_size|max_file'
```

**Expected output:**

```
max_size: 10M
max_file: 14
```

This confirms:

- Individual logs rotate at **10MB**
- Up to **14 rotated files** are kept (~14 days of history)

### Step 5: Monitor Active Log Growth

```bash
# Watch log sizes for 30 seconds
watch -n 5 'ls -lh logs/ | tail -3'
```

**Expected:** Log file sizes stay stable (< 10MB) or grow slowly. If any file grows past 10MB without rotating, troubleshoot (see Troubleshooting section below).

---

## Ongoing Production Monitoring

### Daily Monitoring (5 minutes)

Run daily to verify rotation is working:

```bash
# Check log file count and size
echo "=== Log Files ===" && ls -lh logs/ && echo "" && \
echo "=== Total Size ===" && du -sh logs/ && echo "" && \
echo "=== pm2-logrotate Status ===" && pm2 show pm2-logrotate 2>/dev/null | grep -E 'status|uptime'
```

**Healthy output:**

- Log files are present but individually **< 10MB**
- Total directory size stable week-to-week (e.g., 80–150MB)
- pm2-logrotate shows as "online"

**Warning signs:**

- Individual files > 10MB (rotation may have stalled)
- Total directory size growing unbounded (>500MB)
- pm2-logrotate shows as "stopped" or "errored"

### Weekly Monitoring (10 minutes)

Ensure logs are actually being rotated over time:

```bash
# Count rotated files by age
echo "=== Logs created in last 7 days ===" && \
find logs/ -type f -mtime -7 | wc -l && echo "" && \
echo "=== Logs created 7–14 days ago ===" && \
find logs/ -type f -mtime +7 -mtime -14 | wc -l && echo "" && \
echo "=== Logs older than 14 days ===" && \
find logs/ -type f -mtime +14 | wc -l
```

**Expected output:**

```
=== Logs created in last 7 days ===
4
=== Logs created 7–14 days ago ===
2
=== Logs older than 14 days ===
0
```

This confirms:

- Recent logs exist (rotation is happening)
- Older logs are being pruned (max_file=14 is enforced)
- No logs exceed the 14-day retention policy

### Monthly Archival (30 minutes)

For longer-term audit/compliance, archive logs to external storage:

```bash
# Create archive directory
ARCHIVE_DIR="logs_archive_$(date +%Y%m%d)"
mkdir -p "$ARCHIVE_DIR"

# Copy logs to archive (before they're deleted)
cp -v logs/webhook-listener-*.log.* "$ARCHIVE_DIR/"

# Compress for storage
tar -czf "${ARCHIVE_DIR}.tar.gz" "$ARCHIVE_DIR"
rm -rf "$ARCHIVE_DIR"

# Verify
ls -lh "${ARCHIVE_DIR}.tar.gz"
echo "Archive size: $(du -sh ${ARCHIVE_DIR}.tar.gz | cut -f1)"
```

Save the archive to a backup location (external drive, S3, etc.) for compliance/audit.

---

## Monitoring Disk Usage

### Check Current Disk Space

```bash
df -h /  # System disk
df -h    # All mounted disks

# Focus on logs directory
du -sh logs/
du -sh data/  # Database files
```

**Healthy state:**

- System disk > 20% free
- Logs directory < 200MB
- Database directory < 1GB

### Trend Analysis (Weekly)

Track disk usage trends to predict when logs might exceed capacity:

```bash
# Create a monitoring log (append to cron job output)
echo "$(date) | Logs: $(du -sh logs/ | cut -f1) | DB: $(du -sh data/ | cut -f1) | Free: $(df -h / | tail -1 | awk '{print $4}')"
```

Add to crontab to run daily:

```bash
0 9 * * * echo "$(date +%Y-%m-%d\ %H:%M:%S) | Logs: $(du -sh /path/to/logs | cut -f1) | DB: $(du -sh /path/to/data | cut -f1)" >> /path/to/logs_monitoring.log
```

Review weekly to detect growth patterns.

---

## Troubleshooting

### Logs Are Not Rotating (Files > 10MB)

**Symptom:** Individual log files exceed 10MB but are not being rotated.

**Check 1: Is PM2 process running?**

```bash
pm2 show webhook-listener | head -10
```

Expected: Status should be "online".

**Check 2: Is pm2-logrotate installed?**

```bash
pm2 list | grep logrotate
```

Expected: "⊙ pm2-logrotate (running)"

If missing, reinstall:

```bash
npm install -g pm2-logrotate
pm2 install pm2-logrotate
pm2 save
pm2 restart all
```

**Check 3: Check PM2 daemon logs for errors**

```bash
pm2 logs PM2
# or
cat ~/.pm2/pm2.log | tail -50
```

Look for rotation-related errors.

**Check 4: Force log rotation manually**

```bash
pm2 flush webhook-listener
```

This clears the in-memory log buffer and forces disk writes. Logs should rotate on next buffer fill.

**Check 5: Verify PM2 config is loaded**

```bash
pm2 show webhook-listener | grep -E 'max_size|max_file'
```

If `max_size` and `max_file` are not shown, the config may not have been reloaded:

```bash
pm2 delete webhook-listener
pm2 start ecosystem.config.js
pm2 save
```

### Disk Filling Up Despite Rotation

**Symptom:** Logs are rotating but disk usage keeps growing.

**Check 1: Is max_file set too high?**

Current setting: `max_file: 14` (keeps ~14 days)

If you have high webhook traffic, logs might still fill disk faster than rotation. Options:

1. Reduce `max_file` to keep fewer rotated files:

   ```javascript
   // ecosystem.config.js
   max_file: 7,  // Keep only 7 files instead of 14
   ```

2. Reduce `max_size` to rotate more frequently:

   ```javascript
   max_size: '5M',  // Rotate at 5MB instead of 10MB
   ```

3. Lower webhook verbosity (if applicable in code)

**Check 2: Are non-webhook logs also consuming space?**

```bash
find logs/ -type f -name "*.log*" ! -name "webhook-listener*" | head -10
```

If there are other log files, they may need rotation too. Add them to ecosystem.config.js or clean them manually.

**Check 3: Check database size**

```bash
du -sh data/
ls -lh data/orchestrator.db*
```

If the database is very large (> 1GB), it may be growing faster than logs. This is a separate issue—consider database maintenance (vacuum, archive old data).

### pm2-logrotate Module Crashes

**Symptom:** pm2-logrotate appears in `pm2 list` but shows as "stopped" or "errored".

**Restart the module:**

```bash
pm2 restart pm2-logrotate
pm2 logs pm2-logrotate  # Check for errors
```

**If it keeps crashing:**

```bash
pm2 uninstall pm2-logrotate
pm2 install pm2-logrotate
pm2 save
```

**Check PM2 daemon for underlying issues:**

```bash
pm2 kill         # Stop PM2 daemon
pm2 start ecosystem.config.js  # Restart
```

### Log Ownership/Permission Issues

**Symptom:** Logs exist but PM2 cannot write to them, or rotation fails with permission errors.

**Check file ownership:**

```bash
ls -l logs/
```

Expected: Files owned by the user running PM2 (usually `_www`, `nobody`, or your user account).

**If permissions are wrong:**

```bash
# Fix ownership (replace 'your_user' with the actual PM2 process user)
sudo chown your_user:staff logs/
chmod 755 logs/
chmod 644 logs/*.log*
```

**Verify PM2 process user:**

```bash
ps aux | grep webhook-listener | grep -v grep
# Check which user owns the process
```

---

## References

- **PM2 Documentation**: https://pm2.keymetrics.io/docs
- **pm2-logrotate**: https://www.npmjs.com/package/pm2-logrotate
- **Deployment Guide**: [MAC_MINI_DEPLOYMENT.md](MAC_MINI_DEPLOYMENT.md#6-log-rotation-setup)
- **PM2 Config**: [ecosystem.config.js](../ecosystem.config.js)

---

## Summary

Log rotation is critical for production stability. Use this guide to:

1. **Validate** rotation is active immediately after deployment
2. **Monitor** daily that logs are rotating correctly
3. **Trend** disk usage weekly to predict capacity issues
4. **Troubleshoot** quickly when rotation stalls

When in doubt, run the **Daily Monitoring** command above. It provides a quick health snapshot in one command.
