const { test, expect } = require('@playwright/test')

test('clicking first ledger row opens drawer', async ({ page }) => {
  await page.goto('/login')

  await page.fill('input[type="email"]', process.env.E2E_EMAIL || 'admin@zenops.local')
  await page.fill('input[type="password"]', process.env.E2E_PASSWORD || 'password')
  await page.click('button[type="submit"]')

  await page.waitForURL(/\/(account|admin\/dashboard)(\?.*)?$/, { timeout: 30000 })
  await page.goto('/invoices')

  await page.waitForSelector('table.ledger-table tbody tr', { timeout: 30000 })
  await page.locator('table.ledger-table tbody tr').first().click()

  await expect(page.locator('.drawer-panel')).toBeVisible()
})
