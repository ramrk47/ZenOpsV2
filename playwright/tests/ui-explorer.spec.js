const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1';
const ADMIN_EMAIL = 'admin@zenops.local';
const ADMIN_PASSWORD = 'password';

test.describe('UI Explorer - Full App Walkthrough @explorer', () => {
  test.beforeEach(async ({ page }) => {
    // Login via UI
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"], input[name="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"], input[name="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(dashboard|assignments)?/, { timeout: 15000 });
  });

  test('Dashboard - explore widgets and stats', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');
    
    // Take screenshot
    await page.screenshot({ path: 'reports/screenshots/dashboard.png', fullPage: true });
    
    // Look for stats cards, charts, widgets
    const cards = await page.locator('.card, [class*="stat"], [class*="widget"]').count();
    console.log(`Found ${cards} dashboard cards/widgets`);
    
    // Try clicking any tabs or filters
    const tabs = page.locator('[role="tab"], .tab, [class*="tab"]');
    const tabCount = await tabs.count();
    console.log(`Found ${tabCount} tabs on dashboard`);
    
    for (let i = 0; i < Math.min(tabCount, 5); i++) {
      try {
        await tabs.nth(i).click();
        await page.waitForTimeout(500);
      } catch (e) {}
    }
  });

  test('Assignments - list, filter, and view detail', async ({ page }) => {
    await page.goto(`${BASE_URL}/assignments`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/assignments-list.png', fullPage: true });
    
    // Count assignment rows
    const rows = await page.locator('tr, [class*="assignment-row"], [class*="list-item"]').count();
    console.log(`Found ${rows} assignment rows`);
    
    // Try search if exists
    const searchInput = page.locator('input[placeholder*="search" i], input[type="search"]');
    if (await searchInput.count() > 0) {
      await searchInput.first().fill('test');
      await page.waitForTimeout(1000);
      await searchInput.first().clear();
    }
    
    // Try filters/dropdowns
    const selects = page.locator('select, [role="combobox"], [class*="select"]');
    const selectCount = await selects.count();
    console.log(`Found ${selectCount} filter dropdowns`);
    
    // Click first assignment to view detail
    const assignmentLinks = page.locator('a[href*="/assignments/"], tr[data-id], [class*="clickable"]');
    if (await assignmentLinks.count() > 0) {
      await assignmentLinks.first().click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: 'reports/screenshots/assignment-detail.png', fullPage: true });
      
      // Explore tabs in detail view
      const detailTabs = page.locator('[role="tab"], .tab, button[class*="tab"]');
      const detailTabCount = await detailTabs.count();
      console.log(`Found ${detailTabCount} tabs in assignment detail`);
      
      for (let i = 0; i < detailTabCount; i++) {
        try {
          const tabText = await detailTabs.nth(i).textContent();
          console.log(`Clicking tab: ${tabText}`);
          await detailTabs.nth(i).click();
          await page.waitForTimeout(800);
          await page.screenshot({ path: `reports/screenshots/assignment-tab-${i}.png` });
        } catch (e) {}
      }
    }
  });

  test('Invoices - list and view', async ({ page }) => {
    await page.goto(`${BASE_URL}/invoices`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/invoices-list.png', fullPage: true });
    
    // Count invoices
    const invoiceRows = await page.locator('tr, [class*="invoice"]').count();
    console.log(`Found ${invoiceRows} invoice elements`);
    
    // Click first invoice
    const invoiceLinks = page.locator('a[href*="/invoices/"], tr[data-id]');
    if (await invoiceLinks.count() > 0) {
      await invoiceLinks.first().click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: 'reports/screenshots/invoice-detail.png', fullPage: true });
    }
  });

  test('Calendar - view and navigate', async ({ page }) => {
    await page.goto(`${BASE_URL}/calendar`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/calendar.png', fullPage: true });
    
    // Try navigation buttons (prev/next month)
    const navButtons = page.locator('button[aria-label*="prev" i], button[aria-label*="next" i], [class*="nav"]');
    for (let i = 0; i < Math.min(await navButtons.count(), 4); i++) {
      try {
        await navButtons.nth(i).click();
        await page.waitForTimeout(500);
      } catch (e) {}
    }
    
    // Try view toggle (month/week/day)
    const viewToggles = page.locator('button:has-text("Month"), button:has-text("Week"), button:has-text("Day")');
    for (let i = 0; i < await viewToggles.count(); i++) {
      try {
        await viewToggles.nth(i).click();
        await page.waitForTimeout(500);
      } catch (e) {}
    }
  });

  test('Notifications - view and interact', async ({ page }) => {
    await page.goto(`${BASE_URL}/notifications`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/notifications.png', fullPage: true });
    
    const notifCount = await page.locator('[class*="notification"], [class*="notif"]').count();
    console.log(`Found ${notifCount} notification elements`);
  });

  test('Payroll - explore module', async ({ page }) => {
    await page.goto(`${BASE_URL}/payroll`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/payroll.png', fullPage: true });
    
    // Explore tabs
    const tabs = page.locator('[role="tab"], .tab, button[class*="tab"]');
    const tabCount = await tabs.count();
    console.log(`Payroll has ${tabCount} tabs`);
    
    for (let i = 0; i < tabCount; i++) {
      try {
        await tabs.nth(i).click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: `reports/screenshots/payroll-tab-${i}.png` });
      } catch (e) {}
    }
  });

  test('Analytics - view charts', async ({ page }) => {
    await page.goto(`${BASE_URL}/analytics`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/analytics.png', fullPage: true });
    
    // Look for chart elements
    const charts = await page.locator('canvas, svg, [class*="chart"], [class*="graph"]').count();
    console.log(`Found ${charts} chart elements`);
    
    // Explore tabs/sections
    const tabs = page.locator('[role="tab"], .tab');
    for (let i = 0; i < Math.min(await tabs.count(), 5); i++) {
      try {
        await tabs.nth(i).click();
        await page.waitForTimeout(800);
      } catch (e) {}
    }
  });

  test('Master Data - explore all sections', async ({ page }) => {
    await page.goto(`${BASE_URL}/master-data`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/master-data.png', fullPage: true });
    
    // Click through all tabs
    const tabs = page.locator('[role="tab"], .tab, [class*="tab"]');
    const tabCount = await tabs.count();
    console.log(`Master Data has ${tabCount} tabs`);
    
    for (let i = 0; i < tabCount; i++) {
      try {
        const tabText = await tabs.nth(i).textContent();
        console.log(`Exploring Master Data tab: ${tabText}`);
        await tabs.nth(i).click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `reports/screenshots/master-data-tab-${i}.png` });
      } catch (e) {}
    }
  });

  test('Support - view threads', async ({ page }) => {
    await page.goto(`${BASE_URL}/support`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/support.png', fullPage: true });
    
    const threads = await page.locator('[class*="thread"], [class*="ticket"], tr').count();
    console.log(`Found ${threads} support thread elements`);
  });

  test('Settings - explore all settings', async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'reports/screenshots/settings.png', fullPage: true });
    
    // Click through settings sections
    const sections = page.locator('[role="tab"], .tab, a[href*="settings"], [class*="menu-item"]');
    const sectionCount = await sections.count();
    console.log(`Settings has ${sectionCount} sections`);
    
    for (let i = 0; i < Math.min(sectionCount, 10); i++) {
      try {
        await sections.nth(i).click();
        await page.waitForTimeout(800);
      } catch (e) {}
    }
  });

  test('Navigation - click all sidebar items', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');
    
    // Find sidebar nav items
    const navItems = page.locator('nav a, [class*="sidebar"] a, [class*="nav"] a');
    const navCount = await navItems.count();
    console.log(`Found ${navCount} navigation items`);
    
    const visited = [];
    for (let i = 0; i < navCount; i++) {
      try {
        const href = await navItems.nth(i).getAttribute('href');
        if (href && !href.startsWith('http') && !visited.includes(href)) {
          visited.push(href);
          console.log(`Navigating to: ${href}`);
          await navItems.nth(i).click();
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(500);
        }
      } catch (e) {}
    }
    console.log(`Visited ${visited.length} unique pages`);
  });
});
