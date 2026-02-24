const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1';
const ADMIN_EMAIL = 'admin@zenops.local';
const ADMIN_PASSWORD = 'password';

test.describe('Real Browser Walkthrough @real', () => {
  
  test('Browse entire app with proper login', async ({ page }) => {
    console.log('=== STARTING REAL BROWSE ===');
    
    // 1. Go to login page
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('domcontentloaded');
    await page.screenshot({ path: 'reports/screenshots/real-01-login.png', fullPage: true });
    console.log('Login page loaded');
    
    // 2. Fill login form - find the actual inputs
    const emailInput = page.locator('input').first();
    const passwordInput = page.locator('input').nth(1);
    
    await emailInput.fill(ADMIN_EMAIL);
    await passwordInput.fill(ADMIN_PASSWORD);
    await page.screenshot({ path: 'reports/screenshots/real-02-login-filled.png', fullPage: true });
    console.log('Credentials filled');
    
    // 3. Click Sign In button
    const signInBtn = page.locator('button:has-text("Sign In"), button:has-text("Login"), button[type="submit"]');
    await signInBtn.click();
    console.log('Clicked Sign In');
    
    // 4. Wait for navigation or token storage
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'reports/screenshots/real-03-after-login.png', fullPage: true });
    console.log('After login click, URL:', page.url());
    
    // Check if we're still on login (error case)
    if (page.url().includes('/login')) {
      console.log('Still on login page - checking for errors');
      const errorText = await page.locator('[class*="error"], [class*="alert"], [role="alert"]').textContent().catch(() => 'none');
      console.log('Error message:', errorText);
      
      // Try alternative login method - use API to get token then set in localStorage
      console.log('Attempting API-based login...');
      const response = await page.request.post(`${BASE_URL}/api/auth/login`, {
        form: { username: ADMIN_EMAIL, password: ADMIN_PASSWORD }
      });
      const data = await response.json();
      console.log('API login response:', data.access_token ? 'Got token' : 'No token');
      
      if (data.access_token) {
        await page.evaluate((token) => {
          localStorage.setItem('token', token);
          localStorage.setItem('access_token', token);
        }, data.access_token);
        console.log('Token saved to localStorage');
        
        await page.goto(`${BASE_URL}/dashboard`);
        await page.waitForLoadState('networkidle');
      }
    }
    
    await page.screenshot({ path: 'reports/screenshots/real-04-dashboard.png', fullPage: true });
    console.log('Dashboard URL:', page.url());
    
    // Get page content structure
    const bodyHTML = await page.locator('body').innerHTML();
    console.log('Page has sidebar:', bodyHTML.includes('sidebar') || bodyHTML.includes('Sidebar') || bodyHTML.includes('nav'));
    
    // 5. Browse each major page
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
      { path: '/master-data', name: 'Master Data' },
      { path: '/notifications', name: 'Notifications' },
      { path: '/settings', name: 'Settings' },
    ];
    
    for (const pg of pages) {
      console.log(`\n=== BROWSING: ${pg.name} ===`);
      await page.goto(`${BASE_URL}${pg.path}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
      
      // Check if redirected to login
      if (page.url().includes('/login')) {
        console.log(`${pg.name}: Redirected to login - need to re-auth`);
        continue;
      }
      
      await page.screenshot({ path: `reports/screenshots/real-${pg.name.toLowerCase().replace(' ', '-')}.png`, fullPage: true });
      
      // Describe what we see
      const h1Text = await page.locator('h1, h2, [class*="title"]').first().textContent().catch(() => 'N/A');
      console.log(`${pg.name} title: ${h1Text}`);
      
      // Count main elements
      const tables = await page.locator('table, [class*="table"]').count();
      const cards = await page.locator('[class*="card"], [class*="Card"]').count();
      const buttons = await page.locator('button').count();
      console.log(`${pg.name} has: ${tables} tables, ${cards} cards, ${buttons} buttons`);
      
      // Try clicking tabs if any
      const tabs = page.locator('[role="tab"], button[class*="tab"], [class*="Tab"]');
      const tabCount = await tabs.count();
      if (tabCount > 0) {
        console.log(`${pg.name} has ${tabCount} tabs, clicking through...`);
        for (let i = 0; i < Math.min(tabCount, 5); i++) {
          try {
            const tabText = await tabs.nth(i).textContent();
            await tabs.nth(i).click();
            await page.waitForTimeout(800);
            console.log(`  Clicked tab: ${tabText}`);
            await page.screenshot({ path: `reports/screenshots/real-${pg.name.toLowerCase().replace(' ', '-')}-tab${i+1}.png` });
          } catch (e) {
            console.log(`  Tab ${i} failed: ${e.message.substring(0, 50)}`);
          }
        }
      }
    }
    
    console.log('\n=== BROWSE COMPLETE ===');
  });
});
