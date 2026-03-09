import { test, expect } from '../fixtures/base'
import { loginAsAssociate } from '../utils/login'

const tutorialMode = String(process.env.E2E_TUTORIAL_POLICY || 'demo').trim().toLowerCase()

async function startAssociateTour(page: import('@playwright/test').Page, buttonName: RegExp | string) {
  await page.locator('.demo-modal').getByRole('button', { name: buttonName }).click()
  await expect(page).toHaveURL(/\/m\/home$/)
  await expect(page.getByRole('heading', { name: 'Welcome To Mobile Home' })).toBeVisible()
  await expect(page.locator('[data-tour-id="demo-mission-panel"]')).toBeVisible()
}

test.describe('tutorial policy: demo', () => {
  test.skip(tutorialMode !== 'demo', 'Run this suite with E2E_TUTORIAL_POLICY=demo')

  test('auto-opens onboarding and advances through the first three associate steps', async ({ page, trap: _trap }) => {
    await loginAsAssociate(page)

    await expect(page.locator('.demo-modal').getByRole('heading', { name: 'Start A Guided Tour' })).toBeVisible()
    await startAssociateTour(page, 'Start 5-minute tour')

    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page).toHaveURL(/\/m\/request\/new/)
    await expect(page.getByRole('heading', { name: 'Open The Associate Request Composer' })).toBeVisible()

    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByRole('heading', { name: 'Save Or Submit With Intent' })).toBeVisible()

    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page).toHaveURL(/\/m\/assignments/)
    await expect(page.getByRole('heading', { name: 'Track Active Requests' })).toBeVisible()
    await expect(page.locator('[data-tour-id="mobile-assignments-list"]')).toBeVisible()
  })
})

test.describe('tutorial policy: main', () => {
  test.skip(tutorialMode !== 'main', 'Run this suite with E2E_TUTORIAL_POLICY=main')

  test('shows a one-time prompt, respects dismissal, and supports manual restart', async ({ page, trap: _trap }) => {
    await loginAsAssociate(page)

    await expect(page.locator('.demo-modal').getByRole('heading', { name: 'Want A 3-minute Tour?' })).toBeVisible()
    await page.getByRole('button', { name: 'Not now' }).click()
    await expect(page.locator('.demo-modal')).toHaveCount(0)

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('.demo-modal')).toHaveCount(0)

    const launcher = page.locator('.tutorial-launcher').first()
    await expect(launcher).toBeVisible()
    await launcher.getByRole('button', { name: 'Start guided tour' }).click()

    await expect(page.locator('.demo-modal').getByRole('heading', { name: 'Want A 3-minute Tour?' })).toBeVisible()
    await startAssociateTour(page, 'Start guided tour')

    await page.getByRole('button', { name: 'Pause' }).click()
    await expect(page.getByRole('heading', { name: 'Welcome To Mobile Home' })).toBeHidden()
  })
})
