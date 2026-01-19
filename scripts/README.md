# Deployment Scripts

Quick reference for managing your Face Detection Labeler on a VPS.

## Scripts Overview

| Script | Purpose |
|--------|---------|
| `deploy.sh` | Initial VPS setup and installation |
| `start-services.sh` | Start both services with PM2 |
| `stop-services.sh` | Stop both services |
| `restart-services.sh` | Restart both services |
| `status.sh` | Check service health and view logs |
| `update.sh` | Pull latest code and restart |

## Quick Commands

### First Time Setup
```bash
# On your VPS
curl -fsSL https://raw.githubusercontent.com/boltzmann-brain/bsky-face-labeller/main/scripts/deploy.sh -o deploy.sh
chmod +x deploy.sh
./deploy.sh
```

### Daily Operations
```bash
# Start services
./scripts/start-services.sh

# Check status
./scripts/status.sh

# View logs
pm2 logs

# Restart services
./scripts/restart-services.sh

# Stop services
./scripts/stop-services.sh

# Update from GitHub
./scripts/update.sh
```

## Service Management (PM2)

```bash
# View all processes
pm2 status

# View logs (live)
pm2 logs

# View logs for specific service
pm2 logs labeler
pm2 logs python-service

# Restart specific service
pm2 restart labeler
pm2 restart python-service

# Stop all
pm2 stop all

# Delete from PM2
pm2 delete labeler python-service

# Monitor CPU/Memory
pm2 monit
```

## Debugging

```bash
# Check if Python service is healthy
curl http://localhost:5001/health

# Check labeler service
curl http://localhost:4100

# View metrics
curl http://localhost:4101/metrics

# Check recent successful labels
pm2 logs labeler | grep "Successfully labeled"

# Check for errors
pm2 logs --err
```

## Common Tasks

### View what people are loaded
```bash
curl -s http://localhost:5001/health | python3 -m json.tool
```

### Check processing queue status
```bash
curl -s http://localhost:4101/metrics | grep queue
```

### Find a specific log entry
```bash
pm2 logs labeler --lines 1000 | grep "trump"
```

### Clear PM2 logs
```bash
pm2 flush
```

## See Also

- Full deployment guide: `DEPLOYMENT.md`
- Application README: `README.md`
- Environment configuration: `.env.example`
