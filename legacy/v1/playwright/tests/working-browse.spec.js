const { test, expect } = require('@playwright/test');

test.describe('Working Browse', () => {
  
  test('Browse app using localhost', async ({ page }) => {
    // Use localhost instead of 127.0.0.1 to match API calls
    const BASE = 'http://localhost';
    
    // Enable request logging
    page.on('request', req => {
      if (req.url().includes('/api/auth')) {
        console.log('Request:', req.method(), req.url());
      }
    });
    
    page.on('response', res => {
      if (res.url().includes('/api/auth')) {
        console.log('Response:', res.status(), res.url());
      }
    });
    
    // Go to login
    await page.goto(`${BASE}/login`);
    await page.waitForLoadState('domcontentloaded');
    await page.screenshot({ path: 'reports/screenshots/w-01-login.png' });
    
    // Fill form
    const emailInput = page.locator('input').first();
    const passwordInput = page.locator('input').nth(1);
    
    await emailInput.fill('admin@zenops.local');
    await passwordInput.fill('password');
    await page.screenshot({ path: 'reports/screenshots/w-02-filled.png' });
    
    // Click Sign In
    await page.locator('button:has-text("Sign In")').click();
    
    // Wait for navigation
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'reports/screenshots/w-03-after-login.png' });
    
    console.log('URL after login:', page.url());
    
    // Check if login succeeded
    const token = await page.evaluate(() => localStorage.getItem('token'));
    console.log('Token stored:', token ? 'Yes' : 'No');
    
    if (token) {
      console.log('=== LOGIN SUCCESSFUL - BROWSING ===');
      
      // Browse each page
      const pagesToVisit = [
        { path: '/dashboard', name: 'Dashboard' },
        { path: '/assignments', name: 'Assignments' },
        { path: '/invoices', name: 'Invoices' },
        { path: '/calendar', name: 'Calendar' },
        { path: '/payroll', name: 'Payroll' },
        { path: '/analytics', name: 'Analytics' },
        { path: '/master-data', name: 'Master Data' },
      ];
      
      for (let i = 0; i < pagesToVisit.length; i++) {
        const pg = pagesToVisit[i];
        console.log(`\n=== ${pg.name} ===`);
        
        await page.goto(`${BASE}${pg.path}`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1500);
        
        if (!page.url().includes('/login')) {
          await page.screenshot({ 
            path: `reports/screenshots/w-${String(i+4).padStart(2,'0')}-${pg.name.toLowerCase().replace(' ', '-')}.png`, 
            fullPage: true 
          });
          
          // Get page stats
          const h1 = await page.locator('h1, h2').first().textContent().catch(() => '');
          const buttons = await page.locator('button').count();
          const tables = await page.locator('table').count();
          console.log(`  Title: ${h1.substring(0, 40)}`);
          console.log(`  Elements: ${buttons} buttons, ${tables} tables`);
          
          // Click through tabs if available
          const tabs = page.locator('[role="tab"]');
          const tabCount = await tabs.count();
          if (tabCount > 0) {
            console.log(`  Found ${tabCount} tabs`);
            for (let t = 0; t < Math.min(tabCount, 4); t++) {
              try {
                const tabText = await tabs.nth(t).textContent();
                await tabs.nth(t).click();
                await page.waitForTimeout(1000);
                await page.screenshot({ 
                  path: `reports/screenshots/w-${String(i+4).padStart(2,'0')}-${pg.name.toLowerCase().replace(' ', '-')}-tab${t+1}.png` 
                });
                console.log(`    Tab ${t+1}: ${tabText}`);
              } catch (e) {}
            }
          }
          
          // Click first table row if exists
          const firstRow = page.locator('tbody tr').first();
          if (await firstRow.count() > 0) {
            try {
              await firstRow.click();
              await page.waitForTimeout(1500);
              await page.screenshot({ 
                path: `reports/screenshots/w-${String(i+4).padStart(2,'0')}-${pg.name.toLowerCase().replace(' ', '-')}-detail.png`, 
                fullPage: true 
              });
              console.log('    Clicked first row - opened detail');
              await page.goBack();
            } catch (e) {}
          }
        }
      }
    }
    
    console.log('\n=== BROWSE COMPLETE ===');
  });
});
