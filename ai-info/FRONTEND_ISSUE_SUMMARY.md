# Frontend Not Updating - Image Caching Issue

## Problem
After rebuilding frontend with Documents V2 code:
- Docker build completed successfully
- New image created (timestamp: 2026-02-08T07:09:04)
- **BUT**: Old bundle `index-0dbbcc5e.js` still being served
- Container crashing on startup

## Root Cause
The frontend build is being cached somewhere - possibly:
1. Docker image layers cached (we cleared with `--no-cache`)  
2. Container volume mount overriding image files
3. Build output not being copied to image

## Quick Fix Needed
Try manual build inside running container OR check docker-compose.yml for volume mounts:

```bash
# Check for volume mounts
cd /Users/dr.156/zen-ops
grep -A5 "frontend:" docker-compose.yml | grep volumes

# If there's a volume mount to frontend/dist, that's the issue!
```

## Alternative: Use worktree version
The Documents V2 code is working in the copilot-worktree. We could:
1. Copy just the built frontend assets from worktree
2. Mount them into the zen-ops frontend container  
3. Test there first

## Status
- ✅ Code exists: DocumentPreviewDrawerV2.jsx (520 lines)
- ✅ AssignmentDetail integrated
- ✅ Backend endpoints working (preview, review, comments)
- ✅ Database seeded with test data
- ❌ Frontend not deploying new build

Need to investigate docker-compose.yml frontend service configuration.
