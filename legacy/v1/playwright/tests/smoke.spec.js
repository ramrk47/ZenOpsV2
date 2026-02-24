const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@zenops.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'password';
let accessToken = '';

async function loginForToken(request) {
  const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
    form: { username: ADMIN_EMAIL, password: ADMIN_PASSWORD }
  });
  if (!loginRes.ok()) {
    const body = await loginRes.text();
    throw new Error(`E2E login failed (${loginRes.status()}): ${body}`);
  }
  const payload = await loginRes.json();
  if (!payload?.access_token) {
    throw new Error('E2E login returned no access_token');
  }
  return payload.access_token;
}

test.describe('Smoke Tests @smoke', () => {
  test.beforeAll(async ({ request }) => {
    accessToken = await loginForToken(request);
  });

  test('API: login and fetch me', async ({ request }) => {
    const meRes = await request.get(`${BASE_URL}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    expect(meRes.ok()).toBeTruthy();
    const user = await meRes.json();
    expect(user.email).toBe(ADMIN_EMAIL);
  });

  test('API: assignments endpoint', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/assignments`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    expect(res.ok()).toBeTruthy();
  });

  test('API: dashboard overview', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/dashboard/overview`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    expect(res.ok()).toBeTruthy();
  });

  test('API: notifications', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/notifications`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    expect(res.ok()).toBeTruthy();
  });

  test('API: payroll endpoints', async ({ request }) => {
    const runsRes = await request.get(`${BASE_URL}/api/payroll/runs`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    expect(runsRes.ok()).toBeTruthy();
    
    const policyRes = await request.get(`${BASE_URL}/api/payroll/policy`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    expect(policyRes.ok()).toBeTruthy();
  });

  test('API: support threads', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/support/threads`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    expect(res.ok()).toBeTruthy();
  });

  test('UI: login page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await expect(page.locator('body')).toBeVisible();
  });

  test('UI: dashboard after login', async ({ page }) => {
    // Login via UI
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"], input[name="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"], input[name="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    
    // Wait for redirect
    await page.waitForURL(/\/(dashboard|assignments)?/, { timeout: 10000 });
    await expect(page.locator('body')).toBeVisible();
  });
});
