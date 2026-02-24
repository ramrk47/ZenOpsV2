#!/bin/bash
# Rebuild and restart Docker containers after frontend changes

echo "🔨 Rebuilding frontend container..."
docker compose build frontend

echo "🔄 Restarting containers..."
docker compose up -d

echo "✅ Checking container health..."
docker compose ps

echo ""
echo "🌐 Frontend should be available at: http://localhost:5173"
echo "🔧 API should be available at: http://localhost:8000"
echo ""
echo "To view logs: docker compose logs -f frontend"
