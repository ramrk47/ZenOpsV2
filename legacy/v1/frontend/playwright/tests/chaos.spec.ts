import { test, expect } from '../fixtures/base'
import { loginAsAdmin } from '../utils/login'

const API_URL = process.env.E2E_API_URL || 'http://localhost:8000'

async function authToken(page: import('@playwright/test').Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('token'))
  if (!token) {
    throw new Error('Missing auth token after login')
  }
  return token
}

function pickRandomIds(ids: number[], count: number): number[] {
  const copy = [...ids]
  for (let idx = copy.length - 1; idx > 0; idx -= 1) {
    const swapIndex = Math.floor(Math.random() * (idx + 1))
    const tmp = copy[idx]
    copy[idx] = copy[swapIndex]
    copy[swapIndex] = tmp
  }
  return copy.slice(0, Math.min(count, copy.length))
}

test('chaos suite: random assignment edits persist and rapid navigation stays healthy', async ({ page, request, trap: _trap }) => {
  await loginAsAdmin(page)
  const token = await authToken(page)

  const assignmentsResponse = await request.get(`${API_URL}/api/assignments?limit=60`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(assignmentsResponse.ok()).toBeTruthy()
  const assignments = (await assignmentsResponse.json()) as Array<{ id: number }>
  const assignmentIds = assignments
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id) && id > 0)

  expect(assignmentIds.length).toBeGreaterThan(0)
  const targetIds = pickRandomIds(assignmentIds, 10)
  expect(targetIds.length).toBeGreaterThan(0)

  for (const [index, assignmentId] of targetIds.entries()) {
    await page.goto(`/assignments/${assignmentId}`)
    await expect(page.getByText(/Assignment /)).toBeVisible()

    const borrowerInput = page.locator('label:has(span.kicker:has-text("Borrower Name")) input').first()
    await expect(borrowerInput).toBeVisible()
    const updatedBorrower = `Chaos Borrower ${assignmentId}-${index}-${Date.now()}`
    await borrowerInput.fill(updatedBorrower)
    await page.getByRole('button', { name: 'Save Overview' }).click()
    await expect(page.getByText('Assignment updated.')).toBeVisible()
    await page.reload()
    await expect(borrowerInput).toHaveValue(updatedBorrower)
  }

  const rapidRoutes = [
    '/assignments',
    '/calendar',
    '/invoices',
    '/requests',
    '/notifications',
    '/admin/dashboard',
    '/admin/approvals',
    '/admin/personnel',
  ]
  for (let iteration = 0; iteration < 2; iteration += 1) {
    for (const route of rapidRoutes) {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      await expect(page).not.toHaveURL(/\/login$/)
    }
  }
})
