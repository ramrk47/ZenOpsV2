const { test, expect } = require('@playwright/test');

test.describe('Manual Browse', () => {
  
  test('Login via UI and browse', async ({ page }) => {
    // Go to login
    await page.goto('http://127.0.0.1/login');
    await page.waitForLoadState('domcontentloaded');
    
    // Take initial screenshot
    await page.screenshot({ path: 'reports/screenshots/m-01-login.png' });
    
    // Find ALL inputs on the page
    const allInputs = page.locator('input');
    const inputCount = await allInputs.count();
    console.log(`Found ${inputCount} input fields`);
    
    // Fill the email field (first input)
    if (inputCount >= 2) {
      await allInputs.nth(0).click();
      await allInputs.nth(0).fill('admin@zenops.local');
      await page.waitForTimeout(300);
      
      await allInputs.nth(1).click(); 
      await allInputs.nth(1).fill('password');
      await page.waitForTimeout(300);
    }
    
    await page.screenshot({ path: 'reports/screenshots/m-02-filled.png' });
    
    // Find and click submit button
    const submitBtn = page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Login")');
    const btnCount = await submitBtn.count();
    console.log(`Found ${btnCount} submit buttons`);
    
    if (btnCount > 0) {
      await submitBtn.first().click();
      console.log('Clicked submit button');
    }
    
    // Wait for response
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'reports/screenshots/m-03-after-submit.png' });
    
    console.log('Current URL after login:', page.url());
    
    // Check localStorage
    const token = await page.evaluate(() => localStorage.getItem('token'));
    console.log('Token in localStorage:', token ? 'Yes' : 'No');
    
    // If we're authenticated, browse pages
    if (token || !page.url().includes('/login')) {
      console.log('=== AUTHENTICATED - BROWSING ===');
      
      const pages = [
        '/dashboard',
        '/assignments', 
        '/invoices',
        '/calendar',
        '/payroll',
        '/analytics',
        '/master-data',
        '/settings'
      ];
      
      for (let i = 0; i < pages.length; i++) {
        await page.goto(`http://127.0.0.1${pages[i]}`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);
        
        if (!page.url().includes('/login')) {
          await page.screenshot({ 
            path: `reports/screenshots/m-${String(i+4).padStart(2,'0')}-${pages[i].slice(1) || 'dashboard'}.png`, 
            fullPage: true 
          });
          console.log(`Captured: ${pages[i]}`);
          
          // Try clicking first tab if exists
          const tab = page.locator('[role="tab"]').first();
          if (await tab.count() > 0) {
            await tab.click().catch(() => {});
            await page.waitForTimeout(500);
          }
        } else {
          console.log(`${pages[i]}: redirected to login`);
        }
      }
    } else {
      console.log('NOT AUTHENTICATED - checking error message');
      const errorMsg = await page.locator('[class*="error"], [class*="alert"], .text-red').textContent().catch(() => 'none');
      console.log('Error message:', errorMsg);
    }
  });
});
