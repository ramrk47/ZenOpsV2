import { expect, type Page } from '@playwright/test'

import { USERS, type E2EUser } from '../fixtures/users'

async function waitForPostLogin(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  const mfaHeading = page.getByText(/Two-Factor Authentication|Use Backup Code/i)
  if (await mfaHeading.isVisible().catch(() => false)) {
    throw new Error('E2E seed user has MFA enabled; expected password-only login users for automation')
  }
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 })
}

export async function loginAs(page: Page, user: E2EUser): Promise<void> {
  await page.goto('/login')
  await expect(page.locator('#email')).toBeVisible()
  await page.locator('#email').fill(user.email)
  await page.locator('#password').fill(user.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await waitForPostLogin(page)
}

export async function logout(page: Page): Promise<void> {
  const logoutButton = page.getByRole('button', { name: /logout/i })
  if (await logoutButton.isVisible().catch(() => false)) {
    await logoutButton.click()
  } else {
    await page.evaluate(() => {
      localStorage.removeItem('token')
      sessionStorage.removeItem('step_up_token')
    })
    await page.goto('/login')
  }
  await page.waitForURL('**/login', { timeout: 10_000 })
}

export async function loginAsAdmin(page: Page): Promise<void> {
  await loginAs(page, USERS.admin)
}

export async function loginAsOps(page: Page): Promise<void> {
  await loginAs(page, USERS.ops)
}

export async function loginAsFieldValuer(page: Page): Promise<void> {
  await loginAs(page, USERS.field)
}

export async function loginAsFinance(page: Page): Promise<void> {
  await loginAs(page, USERS.finance)
}

export async function loginAsAssociate(page: Page): Promise<void> {
  await loginAs(page, USERS.associate)
}
