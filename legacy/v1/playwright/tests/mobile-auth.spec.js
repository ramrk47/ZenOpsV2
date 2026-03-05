const { test, expect } = require('@playwright/test')

const ADMIN_EMAIL = process.env.PW_ADMIN_EMAIL || 'admin@zenops.local'
const ADMIN_PASSWORD = process.env.PW_ADMIN_PASSWORD || 'password'

const VIEWPORTS = [
  { label: 'iphone13', width: 390, height: 844 },
  { label: 'pixel7', width: 412, height: 915 },
]

async function loginWithToken(page, request) {
  const loginRes = await request.post('/api/auth/login', {
    form: { username: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })
  expect(loginRes.ok()).toBeTruthy()
  const payload = await loginRes.json()
  expect(payload.access_token).toBeTruthy()

  await page.goto('/login')
  await page.evaluate((token) => localStorage.setItem('token', token), payload.access_token)
}

test.describe('Mobile auth smoke', () => {
  for (const viewport of VIEWPORTS) {
    test(`loads /m/home (${viewport.label}) @mobile`, async ({ page, request }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await loginWithToken(page, request)
      await page.goto('/m/home')
      await expect(page.locator('h1')).toContainText(/My Day|Zen Ops|ZenOps/i)
      await expect(page.locator('.m-tabs')).toBeVisible()
    })
  }
})
