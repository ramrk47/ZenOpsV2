const { test, expect } = require('@playwright/test');

test.describe('Full App Exploration', () => {
  
  test('Explore all pages and tabs', async ({ page }) => {
    const BASE = 'http://localhost';
    
    // Login
    await page.goto(`${BASE}/login`);
    await page.locator('input').first().fill('admin@zenops.local');
    await page.locator('input').nth(1).fill('password');
    await page.locator('button:has-text("Sign In")').click();
    await page.waitForTimeout(3000);
    
    console.log('=== LOGGED IN ===');
    
    const allPages = [
      { path: '/admin/dashboard', name: 'Dashboard' },
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
    
    let screenshotNum = 1;
    
    for (const pg of allPages) {
      console.log(`\n=== ${pg.name.toUpperCase()} ===`);
      
      await page.goto(`${BASE}${pg.path}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      
      if (page.url().includes('/login')) {
        console.log('  Session expired');
        continue;
      }
      
      await page.screenshot({ 
        path: `reports/screenshots/explore-${String(screenshotNum++).padStart(2,'0')}-${pg.name.toLowerCase()}.png`, 
        fullPage: true 
      });
      
      // Get page info
      const title = await page.locator('h1, h2, [class*="title"]').first().textContent().catch(() => '');
      console.log(`  Title: ${title?.substring(0, 50)}`);
      
      // Find and click all tabs
      const tabs = page.locator('[role="tab"], [role="tablist"] button, .ant-tabs-tab');
      const tabCount = await tabs.count();
      
      if (tabCount > 0) {
        console.log(`  Found ${tabCount} tabs`);
        for (let t = 0; t < Math.min(tabCount, 8); t++) {
          try {
            const tab = tabs.nth(t);
            const tabText = await tab.textContent();
            if (!tabText.includes('Delete') && !tabText.includes('Remove')) {
              await tab.click();
              await page.waitForTimeout(1500);
              await page.screenshot({ 
                path: `reports/screenshots/explore-${String(screenshotNum++).padStart(2,'0')}-${pg.name.toLowerCase()}-tab-${tabText?.replace(/\s+/g, '-').substring(0, 15) || t}.png`, 
                fullPage: true 
              });
              console.log(`    Tab: ${tabText?.substring(0, 30)}`);
            }
          } catch (e) {
            console.log(`    Tab ${t} error`);
          }
        }
      }
      
      // Try clicking first table row to open detail
      const rows = page.locator('tbody tr');
      if (await rows.count() > 0) {
        try {
          await rows.first().click();
          await page.waitForTimeout(2000);
          
          // Check if a modal/drawer/detail page opened
          const modal = page.locator('[role="dialog"], .modal, [class*="drawer"], [class*="Drawer"]');
          if (await modal.count() > 0) {
            await page.screenshot({ 
              path: `reports/screenshots/explore-${String(screenshotNum++).padStart(2,'0')}-${pg.name.toLowerCase()}-detail.png`, 
              fullPage: true 
            });
            console.log(`    Opened detail modal/drawer`);
            
            // Close modal
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
          } else if (!page.url().includes(pg.path)) {
            // Navigated to detail page
            await page.screenshot({ 
              path: `reports/screenshots/explore-${String(screenshotNum++).padStart(2,'0')}-${pg.name.toLowerCase()}-detail.png`, 
              fullPage: true 
            });
            console.log(`    Opened detail page`);
            
            // Check for tabs in detail view
            const detailTabs = page.locator('[role="tab"]');
            const detailTabCount = await detailTabs.count();
            if (detailTabCount > 0) {
              console.log(`    Detail has ${detailTabCount} tabs`);
              for (let dt = 0; dt < Math.min(detailTabCount, 6); dt++) {
                try {
                  const dtab = detailTabs.nth(dt);
                  const dtText = await dtab.textContent();
                  await dtab.click();
                  await page.waitForTimeout(1500);
                  await page.screenshot({ 
                    path: `reports/screenshots/explore-${String(screenshotNum++).padStart(2,'0')}-${pg.name.toLowerCase()}-detail-${dtText?.replace(/\s+/g, '-').substring(0, 12) || dt}.png`, 
                    fullPage: true 
                  });
                  console.log(`      Detail Tab: ${dtText?.substring(0, 25)}`);
                } catch (e) {}
              }
            }
            
            await page.goBack();
            await page.waitForTimeout(1000);
          }
        } catch (e) {
          console.log(`    Row click error: ${e.message.substring(0, 40)}`);
        }
      }
    }
    
    console.log(`\n=== EXPLORATION COMPLETE - ${screenshotNum-1} screenshots ===`);
  });
});
