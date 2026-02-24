const { test, expect } = require('@playwright/test');

const ADMIN_EMAIL = 'admin@zenops.local';
const ADMIN_PASSWORD = 'password';

async function loginViaAPI(request) {
  const response = await request.post('/api/auth/login', {
    form: { username: ADMIN_EMAIL, password: ADMIN_PASSWORD }
  });
  const data = await response.json();
  return data.access_token;
}

test.describe('E2E Workflows @e2e', () => {
  let authToken;
  
  test.beforeAll(async ({ request }) => {
    authToken = await loginViaAPI(request);
  });

  test('Assignments: list and view detail', async ({ request }) => {
    const listRes = await request.get('/api/assignments', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    expect(listRes.ok()).toBeTruthy();
    const assignments = await listRes.json();
    
    if (assignments.items && assignments.items.length > 0) {
      const firstId = assignments.items[0].id;
      const detailRes = await request.get(`/api/assignments/${firstId}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      expect(detailRes.ok()).toBeTruthy();
    }
  });

  test('Notifications: list and count', async ({ request }) => {
    const countRes = await request.get('/api/notifications/unread-count', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    expect(countRes.ok()).toBeTruthy();
    
    const listRes = await request.get('/api/notifications', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    expect(listRes.ok()).toBeTruthy();
  });

  test('Invoices: list invoices', async ({ request }) => {
    const res = await request.get('/api/invoices', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    expect(res.ok()).toBeTruthy();
  });

  test('Payroll: list runs and policy', async ({ request }) => {
    const runsRes = await request.get('/api/payroll/runs', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    expect(runsRes.ok()).toBeTruthy();
    
    const policyRes = await request.get('/api/payroll/policy', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    expect(policyRes.ok()).toBeTruthy();
  });

  test('Support: list threads', async ({ request }) => {
    const res = await request.get('/api/support/threads', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    expect(res.ok()).toBeTruthy();
  });

  test('Master Data: banks and branches', async ({ request }) => {
    const banksRes = await request.get('/api/master/banks', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    expect(banksRes.ok()).toBeTruthy();
    
    const branchesRes = await request.get('/api/master/branches', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    expect(branchesRes.ok()).toBeTruthy();
  });

  test('Analytics: source intel', async ({ request }) => {
    const res = await request.get('/api/analytics/source-intel', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    expect(res.ok()).toBeTruthy();
  });
});
