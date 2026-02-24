# ZenOps Playwright Test Suite

Automated E2E and smoke tests for ZenOps.

## Prerequisites

- Node.js 18+
- Docker (running ZenOps stack)

## Setup

```bash
cd playwright
npm install
npx playwright install chromium
```

## Running Tests

### Start the stack first
```bash
docker compose up -d
```

### Run all tests
```bash
npm test
# or
npx playwright test
```

### Run smoke tests only
```bash
npm run test:smoke
# or
npx playwright test --grep @smoke
```

### Run E2E tests
```bash
npm run test:e2e
# or
npx playwright test --grep @e2e
```

### Run a single test file
```bash
npx playwright test tests/auth.spec.js
```

### Run with UI (interactive mode)
```bash
npm run test:ui
```

### View test report
```bash
npm run report
```

## Test Structure

- `tests/smoke.spec.js` - Core API and UI smoke tests
- `tests/auth.spec.js` - Authentication flow tests
- `tests/api-smoke.spec.js` - Comprehensive API endpoint tests
- `tests/workflows.spec.js` - E2E workflow tests
- `tests/ui-pages.spec.js` - Page load tests for all main pages

## Artifacts

Test artifacts are saved to:
- `reports/html/` - HTML test report
- `reports/results.json` - JSON results
- `reports/test-results/` - Screenshots, videos, traces

## Test Credentials

Tests use seeded admin account:
- Email: `admin@zenops.local`
- Password: `password`

## CI/CD

Tests are configured for CI with:
- Retries: 2 (CI) / 1 (local)
- Traces: on first retry
- Videos: on first retry
- Screenshots: on failure


## Truth Scan (Chaos Monkey)

### Start stack
```bash
docker compose up -d
```

### Run truth scan
```bash
cd playwright
npx playwright test tests/ultra-truth-scan.spec.js --timeout=300000 --reporter=list
```

### View report
```bash
npx playwright show-report reports/html
```

Artifacts:
- Screenshots: `playwright/reports/screenshots/`
- HTML report: `playwright/reports/html/`
- Diagnostics: `ops/diagnostics/<timestamp>/`
