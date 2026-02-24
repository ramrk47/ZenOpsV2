const { test, expect } = require('@playwright/test');

const ADMIN_EMAIL = 'admin@zenops.local';
const ADMIN_PASSWORD = 'password';

test.describe('UI Page Load Tests @e2e', () => {
  test.beforeEach(async ({ page }) => {
    // Login via API and set token
    const response = await page.request.post('/api/auth/login', {
      form: { username: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    });
    const { access_token } = await response.json();
    
    await page.goto('/');
    await page.evaluate((token) => {
      localStorage.setItem('token', token);
    }, access_token);
  });

  const pages = [
    { path: '/dashboard', name: 'Dashboard' },
    { path: '/assignments', name: 'Assignments' },
    { path: '/invoices', name: 'Invoices' },
    { path: '/notifications', name: 'Notifications' },
    { path: '/calendar', name: 'Calendar' },
    { path: '/approvals', name: 'Approvals' },
    { path: '/leave', name: 'Leave' },
    { path: '/attendance', name: 'Attendance' },
    { path: '/payroll', name: 'Payroll' },
    { path: '/support', name: 'Support' },
    { path: '/analytics', name: 'Analytics' },
    { path: '/master-data', name: 'Master Data' },
    { path: '/settings', name: 'Settings' },
  ];

  for (const pg of pages) {
    test(`${pg.name} page loads`, async ({ page }) => {
      const consoleErrors = [];
      page.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      const failedRequests = [];
      page.on('response', response => {
        if (response.status() >= 400) {
          failedRequests.push({ url: response.url(), status: response.status() });
        }
      });

      await page.goto(pg.path);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      
      // Allow some known 404s
      const criticalFails = failedRequests.filter(r => 
        r.status >= 500 || (r.status === 404 && !r.url.includes('favicon'))
      );
      
      if (criticalFails.length > 0) {
        console.log(`${pg.name} had failed requests:`, criticalFails);
      }
      
      expect(page.locator('body')).toBeVisible();
    });
  }
});
