const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1';
const ADMIN_EMAIL = 'admin@zenops.local';
const ADMIN_PASSWORD = 'password';

test.describe('Interactive Browse @browse', () => {
  
  test('Full app walkthrough with screenshots', async ({ page }) => {
    const consoleErrors = [];
    const networkErrors = [];
    
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    
    page.on('response', response => {
      if (response.status() >= 400) {
        networkErrors.push({ url: response.url(), status: response.status() });
      }
    });

    // 1. LOGIN
    console.log('=== STEP 1: LOGIN ===');
    await page.goto(`${BASE_URL}/login`);
    await page.screenshot({ path: 'reports/screenshots/01-login-page.png', fullPage: true });
    
    await page.fill('input[type="email"], input[name="email"], input[placeholder*="mail" i]', ADMIN_EMAIL);
    await page.fill('input[type="password"], input[name="password"]', ADMIN_PASSWORD);
    await page.screenshot({ path: 'reports/screenshots/02-login-filled.png', fullPage: true });
    
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(dashboard|assignments)?/, { timeout: 15000 });
    console.log('Logged in successfully, current URL:', page.url());

    // 2. DASHBOARD
    console.log('=== STEP 2: DASHBOARD ===');
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/03-dashboard.png', fullPage: true });
    
    // Get all visible text to understand the page
    const dashboardTitle = await page.locator('h1, h2, [class*="title"]').first().textContent().catch(() => 'N/A');
    console.log('Dashboard title:', dashboardTitle);

    // 3. ASSIGNMENTS
    console.log('=== STEP 3: ASSIGNMENTS ===');
    await page.goto(`${BASE_URL}/assignments`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/04-assignments.png', fullPage: true });
    
    // Try to click on first table row or card
    const firstRow = page.locator('tbody tr, [class*="ant-table-row"], [class*="MuiTableRow"]').first();
    if (await firstRow.count() > 0) {
      console.log('Found assignment row, clicking...');
      await firstRow.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: 'reports/screenshots/05-assignment-detail.png', fullPage: true });
      
      // Try to find and click tabs
      const tabList = page.locator('[role="tablist"] [role="tab"], .ant-tabs-tab, [class*="MuiTab"]');
      const tabCount = await tabList.count();
      console.log(`Found ${tabCount} tabs in assignment detail`);
      
      for (let i = 0; i < Math.min(tabCount, 6); i++) {
        const tabText = await tabList.nth(i).textContent();
        console.log(`Clicking tab ${i+1}: ${tabText}`);
        await tabList.nth(i).click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `reports/screenshots/05-assignment-tab-${i+1}-${tabText?.replace(/\s+/g, '-').substring(0, 20) || i}.png` });
      }
      
      // Go back to list
      await page.goto(`${BASE_URL}/assignments`);
    }

    // 4. INVOICES  
    console.log('=== STEP 4: INVOICES ===');
    await page.goto(`${BASE_URL}/invoices`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/06-invoices.png', fullPage: true });
    
    // Click first invoice
    const invoiceRow = page.locator('tbody tr, [class*="invoice"]').first();
    if (await invoiceRow.count() > 0) {
      await invoiceRow.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: 'reports/screenshots/07-invoice-detail.png', fullPage: true });
      await page.goBack();
    }

    // 5. CALENDAR
    console.log('=== STEP 5: CALENDAR ===');
    await page.goto(`${BASE_URL}/calendar`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/08-calendar.png', fullPage: true });

    // 6. APPROVALS
    console.log('=== STEP 6: APPROVALS ===');
    await page.goto(`${BASE_URL}/approvals`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/09-approvals.png', fullPage: true });

    // 7. LEAVE
    console.log('=== STEP 7: LEAVE ===');
    await page.goto(`${BASE_URL}/leave`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/10-leave.png', fullPage: true });

    // 8. ATTENDANCE
    console.log('=== STEP 8: ATTENDANCE ===');
    await page.goto(`${BASE_URL}/attendance`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/11-attendance.png', fullPage: true });

    // 9. PAYROLL
    console.log('=== STEP 9: PAYROLL ===');
    await page.goto(`${BASE_URL}/payroll`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/12-payroll.png', fullPage: true });
    
    // Explore payroll tabs
    const payrollTabs = page.locator('[role="tablist"] [role="tab"], .ant-tabs-tab');
    const payrollTabCount = await payrollTabs.count();
    console.log(`Found ${payrollTabCount} payroll tabs`);
    for (let i = 0; i < payrollTabCount; i++) {
      const tabText = await payrollTabs.nth(i).textContent();
      console.log(`Clicking payroll tab: ${tabText}`);
      await payrollTabs.nth(i).click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `reports/screenshots/12-payroll-tab-${i+1}.png` });
    }

    // 10. SUPPORT
    console.log('=== STEP 10: SUPPORT ===');
    await page.goto(`${BASE_URL}/support`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/13-support.png', fullPage: true });

    // 11. ANALYTICS
    console.log('=== STEP 11: ANALYTICS ===');
    await page.goto(`${BASE_URL}/analytics`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/14-analytics.png', fullPage: true });
    
    // Explore analytics sections
    const analyticsTabs = page.locator('[role="tablist"] [role="tab"], .ant-tabs-tab');
    const analyticsTabCount = await analyticsTabs.count();
    for (let i = 0; i < analyticsTabCount; i++) {
      await analyticsTabs.nth(i).click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `reports/screenshots/14-analytics-tab-${i+1}.png` });
    }

    // 12. MASTER DATA
    console.log('=== STEP 12: MASTER DATA ===');
    await page.goto(`${BASE_URL}/master-data`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/15-master-data.png', fullPage: true });
    
    // Explore all master data tabs
    const masterTabs = page.locator('[role="tablist"] [role="tab"], .ant-tabs-tab');
    const masterTabCount = await masterTabs.count();
    console.log(`Found ${masterTabCount} master data tabs`);
    for (let i = 0; i < masterTabCount; i++) {
      const tabText = await masterTabs.nth(i).textContent();
      console.log(`Clicking master data tab: ${tabText}`);
      await masterTabs.nth(i).click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `reports/screenshots/15-master-tab-${i+1}-${tabText?.replace(/\s+/g, '-').substring(0, 15) || i}.png` });
    }

    // 13. NOTIFICATIONS
    console.log('=== STEP 13: NOTIFICATIONS ===');
    await page.goto(`${BASE_URL}/notifications`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/16-notifications.png', fullPage: true });

    // 14. SETTINGS
    console.log('=== STEP 14: SETTINGS ===');
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/17-settings.png', fullPage: true });
    
    // Explore settings sections
    const settingsTabs = page.locator('[role="tablist"] [role="tab"], .ant-tabs-tab, [class*="menu"] a');
    const settingsTabCount = await settingsTabs.count();
    for (let i = 0; i < Math.min(settingsTabCount, 8); i++) {
      try {
        await settingsTabs.nth(i).click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: `reports/screenshots/17-settings-section-${i+1}.png` });
      } catch (e) {}
    }

    // 15. Try opening modals/drawers
    console.log('=== STEP 15: EXPLORE MODALS ===');
    await page.goto(`${BASE_URL}/assignments`);
    await page.waitForLoadState('networkidle');
    
    // Look for "New" or "Add" or "Create" buttons
    const addButtons = page.locator('button:has-text("New"), button:has-text("Add"), button:has-text("Create"), [class*="primary"]');
    const addCount = await addButtons.count();
    console.log(`Found ${addCount} add/create buttons`);
    
    if (addCount > 0) {
      await addButtons.first().click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'reports/screenshots/18-modal-drawer.png', fullPage: true });
      
      // Close modal by pressing Escape or clicking close button
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // Summary
    console.log('\n=== BROWSE SUMMARY ===');
    console.log(`Console errors: ${consoleErrors.length}`);
    console.log(`Network errors: ${networkErrors.length}`);
    
    if (consoleErrors.length > 0) {
      console.log('Console errors:');
      consoleErrors.slice(0, 5).forEach(e => console.log(`  - ${e.substring(0, 100)}`));
    }
    
    if (networkErrors.length > 0) {
      console.log('Network errors:');
      networkErrors.slice(0, 5).forEach(e => console.log(`  - ${e.status} ${e.url.substring(0, 80)}`));
    }
    
    expect(consoleErrors.filter(e => !e.includes('favicon')).length).toBeLessThan(10);
  });
});
