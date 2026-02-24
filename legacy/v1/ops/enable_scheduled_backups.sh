#!/usr/bin/env bash
#
# Enable Zen Ops Scheduled Backups
# Starts backup-cron and backup-dispatcher services
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

log() {
  echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $*"
}

error() {
  echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $*" >&2
  exit 1
}

# Preflight checks
if [ ! -f "docker-compose.yml" ]; then
  error "docker-compose.yml not found. Must run from repository root."
fi

log "Starting scheduled backup services..."
if ! docker compose --profile backup up -d backup-cron backup-dispatcher; then
  error "Failed to start backup services"
fi

sleep 2

log "Verifying services are running..."
if docker compose ps backup-cron | grep -q "Up"; then
  log "✓ backup-cron is running"
else
  error "backup-cron is not running"
fi

if docker compose ps backup-dispatcher | grep -q "Up"; then
  log "✓ backup-dispatcher is running"
else
  error "backup-dispatcher is not running"
fi

echo ""
echo "========================================"
echo "  ✓ SCHEDULED BACKUPS ENABLED"
echo "========================================"
echo ""
echo "Backup schedule (from crontab):"
cat deploy/backup/crontab 2>/dev/null || echo "  (crontab file not found)"
echo ""
echo "Verify backups:"
echo "  ls -lah ./deploy/backups | tail -10"
echo "  docker compose logs backup-cron"
echo ""
echo "Disable backups:"
echo "  ./ops/disable_scheduled_backups.sh"
echo ""
