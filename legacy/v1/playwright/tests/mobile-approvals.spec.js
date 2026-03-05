const { test, expect } = require('@playwright/test')

const ADMIN_EMAIL = process.env.PW_ADMIN_EMAIL || 'admin@zenops.local'
const ADMIN_PASSWORD = process.env.PW_ADMIN_PASSWORD || 'password'

async function loginWithToken(page, request) {
  const loginRes = await request.post('/api/auth/login', {
    form: { username: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })
  expect(loginRes.ok()).toBeTruthy()
  const payload = await loginRes.json()
  await page.goto('/login')
  await page.evaluate((token) => localStorage.setItem('token', token), payload.access_token)
}

test.describe('Mobile approvals smoke', () => {
  test('approvals inbox loads @mobile', async ({ page, request }) => {
    await page.setViewportSize({ width: 412, height: 915 })
    await loginWithToken(page, request)
    await page.goto('/m/approvals')

    await expect(page.locator('h1')).toContainText(/Approvals/i)
    await expect(page.locator('.m-section')).toBeVisible()
  })
})
