const { test, expect } = require('@playwright/test');

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@zenops.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'password';

let authToken;

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/login', {
    form: { username: ADMIN_EMAIL, password: ADMIN_PASSWORD }
  });
  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`E2E login failed (${response.status()}): ${body}`);
  }
  const data = await response.json();
  if (!data?.access_token) {
    throw new Error('E2E login returned no access_token');
  }
  authToken = data.access_token;
});

const endpoints = [
  { method: 'GET', path: '/api/auth/me', name: 'auth-me' },
  { method: 'GET', path: '/api/dashboard/overview', name: 'dashboard' },
  { method: 'GET', path: '/api/assignments', name: 'assignments' },
  { method: 'GET', path: '/api/assignments/summary', name: 'assignments-summary' },
  { method: 'GET', path: '/api/notifications', name: 'notifications' },
  { method: 'GET', path: '/api/approvals', name: 'approvals' },
  { method: 'GET', path: '/api/approvals/inbox', name: 'approvals-inbox' },
  { method: 'GET', path: '/api/invoices', name: 'invoices' },
  { method: 'GET', path: '/api/leave', name: 'leave' },
  { method: 'GET', path: '/api/calendar/events', name: 'calendar' },
  { method: 'GET', path: '/api/activity', name: 'activity' },
  { method: 'GET', path: '/api/tasks/my', name: 'tasks' },
  { method: 'GET', path: '/api/master/banks', name: 'banks' },
  { method: 'GET', path: '/api/master/branches', name: 'branches' },
  { method: 'GET', path: '/api/master/clients', name: 'clients' },
  { method: 'GET', path: '/api/master/document-templates', name: 'doc-templates' },
  { method: 'GET', path: '/api/analytics/source-intel', name: 'analytics' },
  { method: 'GET', path: '/api/payroll/runs', name: 'payroll-runs' },
  { method: 'GET', path: '/api/payroll/payslips', name: 'payslips' },
  { method: 'GET', path: '/api/payroll/policy', name: 'payroll-policy' },
  { method: 'GET', path: '/api/support/threads', name: 'support' },
  { method: 'GET', path: '/api/attendance', name: 'attendance' },
  { method: 'GET', path: '/api/backups', name: 'backups' },
];

test.describe('API Smoke Tests @smoke @e2e', () => {
  for (const ep of endpoints) {
    test(`${ep.name}: ${ep.method} ${ep.path}`, async ({ request }) => {
      const response = await request[ep.method.toLowerCase()](ep.path, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      expect(response.status()).toBeLessThan(400);
    });
  }
});
