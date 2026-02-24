const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1';
const ADMIN_EMAIL = 'admin@zenops.local';
const ADMIN_PASSWORD = 'password';

test.describe('Browse App @browse', () => {
  
  test('Full app walkthrough', async ({ page, request }) => {
    console.log('=== LOGIN VIA API ===');
    
    // Get token via API
    const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
      form: { username: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    });
    const { access_token } = await loginRes.json();
    console.log('Got access token');
    
    // Navigate to app and set token in localStorage before page loads
    await page.goto(`${BASE_URL}/login`);
    await page.evaluate((token) => {
      localStorage.setItem('token', token);
    }, access_token);
    
    // Now navigate to dashboard
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'reports/screenshots/browse-01-dashboard.png', fullPage: true });
    console.log('Dashboard URL:', page.url());
    
    // If still on login, the token isn't being accepted - just continue
    if (!page.url().includes('/login')) {
      console.log('Successfully authenticated!');
    } else {
      console.log('Token not accepted, trying direct navigation with auth header...');
    }
    
    // Define pages to browse
    const pages = [
      { path: '/dashboard', name: 'Dashboard' },
      { path: '/assignments', name: 'Assignments' },
      { path: '/invoices', name: 'Invoices' },
      { path: '/calendar', name: 'Calendar' },
      { path: '/approvals', name: 'Approvals' },
      { path: '/leave', name: 'Leave' },
      { path: '/attendance', name: 'Attendance' },
      { path: '/payroll', name: 'Payroll' },
      { path: '/support', name: 'Support' },
      { path: '/analytics', name: 'Analytics' },
      { path: '/master-data', name: 'MasterData' },
      { path: '/notifications', name: 'Notifications' },
      { path: '/settings', name: 'Settings' },
    ];
    
    for (let i = 0; i < pages.length; i++) {
      const pg = pages[i];
      console.log(`\n=== ${i+1}. ${pg.name.toUpperCase()} ===`);
      
      // Re-set token before each navigation
      await page.evaluate((token) => {
        localStorage.setItem('token', token);
      }, access_token);
      
      await page.goto(`${BASE_URL}${pg.path}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);
      
      const currentUrl = page.url();
      const isOnPage = !currentUrl.includes('/login');
      
      if (isOnPage) {
        await page.screenshot({ path: `reports/screenshots/browse-${String(i+2).padStart(2,'0')}-${pg.name.toLowerCase()}.png`, fullPage: true });
        
        // Get page info
        const title = await page.locator('h1, h2').first().textContent().catch(() => 'N/A');
        const buttonCount = await page.locator('button').count();
        const tableCount = await page.locator('table').count();
        const tabCount = await page.locator('[role="tab"]').count();
        
        console.log(`  Title: ${title?.substring(0, 50)}`);
        console.log(`  Elements: ${buttonCount} buttons, ${tableCount} tables, ${tabCount} tabs`);
        
        // Click through tabs if any
        if (tabCount > 0) {
          for (let t = 0; t < Math.min(tabCount, 5); t++) {
            try {
              const tab = page.locator('[role="tab"]').nth(t);
              const tabText = await tab.textContent();
              await tab.click();
              await page.waitForTimeout(1000);
              await page.screenshot({ path: `reports/screenshots/browse-${String(i+2).padStart(2,'0')}-${pg.name.toLowerCase()}-tab${t+1}.png` });
              console.log(`  Clicked tab: ${tabText}`);
            } catch (e) {
              console.log(`  Tab ${t} click failed`);
            }
          }
        }
        
        // Try clicking first row in table
        if (tableCount > 0) {
          const firstRow = page.locator('tbody tr').first();
          if (await firstRow.count() > 0) {
            try {
              await firstRow.click();
              await page.waitForTimeout(1500);
              await page.screenshot({ path: `reports/screenshots/browse-${String(i+2).padStart(2,'0')}-${pg.name.toLowerCase()}-detail.png`, fullPage: true });
              console.log(`  Clicked first row, opened detail`);
              await page.goBack();
              await page.waitForTimeout(500);
            } catch (e) {
              console.log(`  Row click failed: ${e.message.substring(0, 50)}`);
            }
          }
        }
      } else {
        console.log(`  Redirected to login`);
      }
    }
    
    console.log('\n=== BROWSE COMPLETE ===');
  });
});
