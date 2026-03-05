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

test.describe('Mobile create draft smoke', () => {
  test('wizard renders and step navigation works @mobile', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginWithToken(page, request)
    await page.goto('/m/create')

    await expect(page.locator('h1')).toContainText(/Create Assignment|Continue Draft/i)
    await expect(page.locator('text=Step 1')).toBeVisible()

    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.locator('text=Step 2')).toBeVisible()

    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.locator('text=Step 3')).toBeVisible()
  })
})
