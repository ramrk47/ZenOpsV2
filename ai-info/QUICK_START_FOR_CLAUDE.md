# 🚀 QUICK START FOR CLAUDE DESKTOP

## First Things First

```bash
# 1. Navigate to correct directory
cd /Users/dr.156/zen-ops

# 2. Verify you're in the right place
pwd
# Should show: /Users/dr.156/zen-ops

# 3. Check git status
git status
# Should show: On branch ai/work, 5 commits ahead

# 4. Check current containers
docker compose ps
```

---

## �� Fix API Startup (5 minutes)

**Problem:** API won't start because migrate container fails

**Quickest Fix:**

```bash
# 1. Edit docker-compose.yml
# Find the "api:" section and remove these lines:
#     migrate:
#       condition: service_completed_successfully

# 2. Restart API
docker compose up -d api

# 3. Test
curl http://localhost:8000/readyz
# Should return: {"status":"ready"}

# 4. Test templates API
./test_templates_api.sh
```

---

## 🧹 Clean Up Docker (10 minutes)

```bash
# 1. See current mess
docker images | grep -E "zen-ops|copilot"

# 2. Stop everything
docker compose down
cd /Users/dr.156/.claude-worktrees/zen-ops/naughty-chatterjee.worktrees/copilot-worktree-2026-02-08T02-39-09
docker compose down 2>/dev/null

# 3. Remove worktree images
docker ps -a | grep "copilot-worktree" | awk '{print $1}' | xargs docker rm -f 2>/dev/null
docker images | grep "copilot-worktree" | awk '{print $3}' | xargs docker rmi -f 2>/dev/null

# 4. Clean up
docker image prune -f
docker builder prune -f

# 5. Rebuild from scratch in main directory only
cd /Users/dr.156/zen-ops
docker compose build
docker compose up -d

# 6. Verify cleanup
docker images | grep -E "zen-ops|copilot"
# Should only show zen-ops images
```

---

## 🗑️ Remove Git Worktree (2 minutes)

```bash
# 1. Check for worktrees
cd /Users/dr.156/zen-ops
git worktree list

# 2. Check if worktree has uncommitted changes
cd /Users/dr.156/.claude-worktrees/zen-ops/naughty-chatterjee.worktrees/copilot-worktree-2026-02-08T02-39-09
git status
# If clean, safe to delete

# 3. Remove worktree
cd /Users/dr.156/zen-ops
git worktree remove /Users/dr.156/.claude-worktrees/zen-ops/naughty-chatterjee.worktrees/copilot-worktree-2026-02-08T02-39-09

# Or just delete the directory
rm -rf /Users/dr.156/.claude-worktrees/zen-ops/
```

---

## ✅ Verify Everything Works

```bash
cd /Users/dr.156/zen-ops

# 1. API is running
curl http://localhost:8000/readyz

# 2. Database is accessible
docker compose exec -T db psql -U zenops -d zenops -c "\d document_templates"

# 3. Test templates API
./test_templates_api.sh

# 4. Check frontend
curl -s http://localhost/ | grep -o "index-[a-f0-9]*.js"
# Should show: index-3dd09a52.js

# 5. Login works
curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@zenops.local&password=admin" | jq -r '.access_token' | head -c 20
```

---

## 📋 What to Do Next

**Once everything is working:**

1. **Implement Master Data UI** (2 hours)
   - Create `frontend/src/pages/MasterData/DocumentTemplates.jsx`
   - Create `frontend/src/components/DocumentTemplateUploadModal.jsx`
   - Create `frontend/src/api/documentTemplates.js`

2. **Add Assignment Integration** (1 hour)
   - Modify `frontend/src/pages/AssignmentDetail.jsx`
   - Add "Available Templates" section
   - Wire up add-from-template flow

3. **Test Everything** (1 hour)
   - Upload templates
   - Test filters
   - Test permissions
   - Test assignment integration

---

## 🆘 If Something Goes Wrong

**API won't start:**
```bash
docker compose logs api --tail 50
# Look for error messages
```

**Can't connect to database:**
```bash
docker compose ps
# Check if db container is healthy
docker compose logs db --tail 30
```

**Frontend shows old code:**
```bash
cd /Users/dr.156/zen-ops/frontend
npm run build
docker cp dist/index.html zen-ops-frontend-1:/usr/share/nginx/html/
docker cp dist/assets/. zen-ops-frontend-1:/usr/share/nginx/html/assets/
docker compose restart reverse-proxy
```

**Wrong directory:**
```bash
pwd
# If not /Users/dr.156/zen-ops, run:
cd /Users/dr.156/zen-ops
```

---

## 📞 Need More Details?

See: `HANDOFF_TO_CLAUDE_DESKTOP.md`

---

**Total time to get started:** ~17 minutes  
**Total time to complete Documents V3:** ~5 hours
