import { test, expect } from '../fixtures/base'
import { loginAsAdmin, loginAsOps } from '../utils/login'
import { attachConsoleGuard } from '../utils/console-guard'

function kickerSelect(page: import('@playwright/test').Page, label: string) {
  return page.locator(`label:has(span.kicker:has-text("${label}")) select`).first()
}

function kickerInput(page: import('@playwright/test').Page, label: string) {
  return page.locator(`label:has(span.kicker:has-text("${label}")) input`).first()
}

test('assignments page renders cleanly', async ({ page, trap: _trap }, testInfo) => {
  const guard = attachConsoleGuard(page, testInfo)
  await loginAsAdmin(page)

  await page.goto('/assignments')
  await expect(page.getByRole('heading', { name: 'Assignments' })).toBeVisible()

  await guard.assertNoErrors()
})

test('new assignment keeps assignee options eligible-only and creates without eligibility rejection', async ({ page, trap: _trap }, testInfo) => {
  const guard = attachConsoleGuard(page, testInfo)
  await loginAsAdmin(page)

  await page.goto('/assignments/new')
  await expect(page.getByText('Case Setup')).toBeVisible()

  const assigneeSelect = kickerSelect(page, 'Assigned To')
  await expect(assigneeSelect).toHaveValue('')
  const assigneeOptions = await assigneeSelect.locator('option').allTextContents()
  expect(assigneeOptions.some((text) => /\(finance\)/i.test(text))).toBeFalsy()
  expect(assigneeOptions.some((text) => /\(hr\)|\(human resources\)/i.test(text))).toBeFalsy()

  const serviceLineSelect = kickerSelect(page, 'Service Line')
  const serviceLineOptions = await serviceLineSelect.locator('option').evaluateAll((options) =>
    options.map((option) => ({
      value: option.getAttribute('value') || '',
      label: (option.textContent || '').trim(),
    })),
  )
  const preferredServiceLine = serviceLineOptions.find((option) => /valuation plot/i.test(option.label))
    || serviceLineOptions.find((option) => /valuation l&b/i.test(option.label))
    || serviceLineOptions.find((option) => option.value)
  expect(preferredServiceLine?.value).toBeTruthy()

  await kickerSelect(page, 'Case Type').selectOption('BANK')
  await serviceLineSelect.selectOption(String(preferredServiceLine?.value))
  await kickerSelect(page, 'Unit of Measurement').selectOption('SQFT')
  await kickerSelect(page, 'Bank').selectOption({ index: 1 })
  await kickerSelect(page, 'Branch').selectOption({ index: 1 })
  await kickerInput(page, 'Borrower Name').fill(`Phase86 Smoke ${Date.now()}`)

  await page.getByRole('button', { name: /create assignment/i }).click()
  await page.waitForURL(/\/assignments\/\d+/, { timeout: 20_000 })
  await expect(page.locator('.empty').filter({ hasText: /assignee_not_eligible|not eligible/i })).toHaveCount(0)

  await guard.assertNoErrors()
})

test('logout clears token and returns to login reliably', async ({ page, trap: _trap }, testInfo) => {
  const guard = attachConsoleGuard(page, testInfo)
  await loginAsOps(page)

  await page.getByRole('button', { name: /logout/i }).click()
  await page.waitForURL('**/login', { timeout: 10_000 })

  const token = await page.evaluate(() => localStorage.getItem('token'))
  const stepUpToken = await page.evaluate(() => sessionStorage.getItem('step_up_token'))
  expect(token).toBeNull()
  expect(stepUpToken).toBeNull()

  await page.goto('/assignments')
  await page.waitForURL('**/login', { timeout: 10_000 })

  await guard.assertNoErrors()
})
