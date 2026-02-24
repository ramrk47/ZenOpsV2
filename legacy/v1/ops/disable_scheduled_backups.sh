#!/usr/bin/env bash
#
# Disable Zen Ops Scheduled Backups
# Stops backup-cron and backup-dispatcher services
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

log "Stopping scheduled backup services..."
docker compose --profile backup stop backup-cron backup-dispatcher

log "✓ Scheduled backups disabled"
echo ""
echo "Manual backups still available:"
echo "  ./ops/backup_now.sh"
echo ""
echo "Re-enable:"
echo "  ./ops/enable_scheduled_backups.sh"
echo ""
