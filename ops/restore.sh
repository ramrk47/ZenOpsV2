#!/usr/bin/env bash
#
# Zen Ops Database Restore Script
# SAFE: defaults to test mode, requires explicit confirmation for disaster recovery
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Configuration
MODE="${MODE:-test}"  # test or disaster
BACKUP_FILE="${BACKUP_FILE:-}"
CONFIRM="${CONFIRM:-}"
TEST_DB_VOLUME="zenops_restore_test_$(date +%s)"
TEST_DB_CONTAINER="zenops-restore-test-$$"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
  echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $*"
}

warn() {
  echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $*" >&2
}

error() {
  echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $*" >&2
  exit 1
}

cleanup_test() {
  if [ -n "${TEST_DB_CONTAINER:-}" ]; then
    log "Cleaning up test container..."
    docker rm -f "$TEST_DB_CONTAINER" 2>/dev/null || true
  fi
}

# Preflight checks
if [ ! -f "docker-compose.yml" ]; then
  error "docker-compose.yml not found. Must run from repository root."
fi

if [ -z "$BACKUP_FILE" ]; then
  error "BACKUP_FILE not specified. Usage: ./ops/restore.sh BACKUP_FILE=<path>"
fi

if [ ! -f "$BACKUP_FILE" ]; then
  error "Backup file not found: $BACKUP_FILE"
fi

# Load DB credentials from .env.backend
if [ -f ".env.backend" ]; then
  export $(grep -v '^#' .env.backend | grep -E '^(POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB)=' | xargs)
fi

POSTGRES_USER="${POSTGRES_USER:-zenops}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-change_me}"
POSTGRES_DB="${POSTGRES_DB:-zenops}"

log "Restore mode: $MODE"
log "Backup file: $BACKUP_FILE"

case "$MODE" in
  test)
    log "TEST MODE: Restoring to temporary database for verification"
    log "Production database will NOT be affected"
    echo ""
    
    # Create temporary DB container
    log "Creating test database container..."
    docker run -d \
      --name "$TEST_DB_CONTAINER" \
      -e POSTGRES_USER="$POSTGRES_USER" \
      -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
      -e POSTGRES_DB="$POSTGRES_DB" \
      -v "$TEST_DB_VOLUME:/var/lib/postgresql/data" \
      postgres:15-alpine

    # Wait for DB to be ready
    log "Waiting for test database to be ready..."
    sleep 5
    for i in {1..30}; do
      if docker exec "$TEST_DB_CONTAINER" pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done

    # Restore backup
    log "Restoring backup to test database..."
    if docker exec -i "$TEST_DB_CONTAINER" pg_restore \
      -U "$POSTGRES_USER" \
      -d "$POSTGRES_DB" \
      --clean --if-exists --no-owner --no-privileges \
      < "$BACKUP_FILE"; then
      log "✓ Restore successful"
    else
      warn "Restore completed with warnings (may be normal)"
    fi

    # Verify schema
    log "Verifying database schema..."
    TABLE_COUNT=$(docker exec "$TEST_DB_CONTAINER" psql \
      -U "$POSTGRES_USER" \
      -d "$POSTGRES_DB" \
      -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" | tr -d ' ')
    
    log "Tables found: $TABLE_COUNT"
    
    if [ "$TABLE_COUNT" -gt 0 ]; then
      log "✓ Database schema verified"
      echo ""
      echo "Sample tables:"
      docker exec "$TEST_DB_CONTAINER" psql \
        -U "$POSTGRES_USER" \
        -d "$POSTGRES_DB" \
        -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name LIMIT 10"
    else
      error "No tables found in restored database"
    fi

    echo ""
    echo "========================================"
    echo "  ✓ TEST RESTORE SUCCESSFUL"
    echo "========================================"
    echo "Test container: $TEST_DB_CONTAINER"
    echo "Test volume: $TEST_DB_VOLUME"
    echo ""
    echo "Connect to test DB:"
    echo "  docker exec -it $TEST_DB_CONTAINER psql -U $POSTGRES_USER -d $POSTGRES_DB"
    echo ""
    echo "Cleanup test environment:"
    echo "  docker rm -f $TEST_DB_CONTAINER"
    echo "  docker volume rm $TEST_DB_VOLUME"
    echo ""
    ;;

  disaster)
    echo ""
    echo "========================================"
    echo "  ⚠️  DISASTER RECOVERY MODE"
    echo "========================================"
    echo ""
    echo "This will:"
    echo "  1. Stop api, email-worker, frontend services"
    echo "  2. Create a new database volume with restored data"
    echo "  3. Provide manual instructions to swap volumes"
    echo ""
    echo "PRODUCTION DATABASE WILL NOT BE AUTOMATICALLY MODIFIED"
    echo "You will need to manually rename volumes to complete recovery"
    echo ""
    
    if [ "$CONFIRM" != "YES" ]; then
      error "Disaster recovery requires CONFIRM=YES"
    fi

    warn "Proceeding with disaster recovery"
    
    # Stop dependent services
    log "Stopping dependent services..."
    docker compose stop api email-worker frontend
    
    # Create new volume with timestamp
    NEW_VOLUME="postgres_data_restored_$(date +%Y%m%d_%H%M%S)"
    TEMP_CONTAINER="zenops-restore-disaster-$$"
    
    log "Creating new database volume: $NEW_VOLUME"
    docker run -d \
      --name "$TEMP_CONTAINER" \
      -e POSTGRES_USER="$POSTGRES_USER" \
      -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
      -e POSTGRES_DB="$POSTGRES_DB" \
      -v "$NEW_VOLUME:/var/lib/postgresql/data" \
      postgres:15-alpine

    # Wait for DB
    log "Waiting for database to initialize..."
    sleep 10
    for i in {1..30}; do
      if docker exec "$TEMP_CONTAINER" pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done

    # Restore
    log "Restoring backup..."
    if docker exec -i "$TEMP_CONTAINER" pg_restore \
      -U "$POSTGRES_USER" \
      -d "$POSTGRES_DB" \
      --clean --if-exists --no-owner --no-privileges \
      < "$BACKUP_FILE"; then
      log "✓ Restore successful"
    else
      warn "Restore completed with warnings"
    fi

    # Stop temp container
    docker stop "$TEMP_CONTAINER"
    docker rm "$TEMP_CONTAINER"

    echo ""
    echo "========================================"
    echo "  ✓ RESTORE TO NEW VOLUME COMPLETE"
    echo "========================================"
    echo ""
    echo "New volume created: $NEW_VOLUME"
    echo "Current production volume: postgres_data"
    echo ""
    echo "MANUAL STEPS TO COMPLETE RECOVERY:"
    echo ""
    echo "1. Backup current production volume (safety):"
    echo "   docker volume create postgres_data_backup_$(date +%Y%m%d)"
    echo "   docker run --rm -v postgres_data:/from -v postgres_data_backup_$(date +%Y%m%d):/to alpine sh -c 'cp -a /from/. /to'"
    echo ""
    echo "2. Update docker-compose.yml to use new volume:"
    echo "   Edit volumes section:"
    echo "   postgres_data:"
    echo "     external: true"
    echo "     name: $NEW_VOLUME"
    echo ""
    echo "3. Start database service:"
    echo "   docker compose up -d db"
    echo ""
    echo "4. Verify database:"
    echo "   docker compose exec db psql -U $POSTGRES_USER -d $POSTGRES_DB -c '\\dt'"
    echo ""
    echo "5. Start all services:"
    echo "   docker compose up -d"
    echo ""
    echo "6. Verify application:"
    echo "   curl http://localhost/readyz"
    echo ""
    echo "WARNING: DO NOT run 'docker compose down -v' or you will lose data"
    echo ""
    ;;

  *)
    error "Invalid MODE: $MODE. Must be 'test' or 'disaster'"
    ;;
esac
