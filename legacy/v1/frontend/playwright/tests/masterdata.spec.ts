import { test, expect } from '../fixtures/base'
import { loginAsAdmin, loginAsAssociate, logout } from '../utils/login'

const API_URL = process.env.E2E_API_URL || 'http://localhost:8000'

async function getToken(page: import('@playwright/test').Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('token'))
  if (!token) throw new Error('Missing auth token')
  return token
}

test('admin can manage service-line policy JSON and document templates', async ({ page, trap: _trap }) => {
  const suffix = Date.now()
  const serviceLineKey = `E2E_M8_5_${suffix}`
  const serviceLineName = `E2E Service ${suffix}`
  const templateCategory = `E2E_TEMPLATE_${suffix}`

  await loginAsAdmin(page)
  await page.goto('/admin/masterdata')
  await expect(page.getByRole('heading', { name: 'Master Data' })).toBeVisible()

  await page.getByRole('button', { name: 'Service Lines', exact: true }).click()

  await page.locator('input[placeholder*="Key"]').fill(serviceLineKey)
  await page.locator('input[placeholder="Display name"]').fill(serviceLineName)
  await page.locator('input[placeholder="Sort order"]').fill('777')

  const policyTextareas = page.locator('form:has(button:has-text("Add Service Line")) textarea')
  await policyTextareas.nth(0).fill('{"requires":["NORMAL_LAND"],"optional":["BUILT_UP"],"uom_required":true,"allow_assignment_override":true}')
  await policyTextareas.nth(1).fill('{"eligible_roles":["OPS_MANAGER","ASSISTANT_VALUER"],"deny_roles":["FINANCE","HR"],"weights":{"open_assignments":2,"overdue_tasks":9,"due_soon":5,"inactive_penalty":7},"max_open_assignments_soft":6}')
  await page.getByRole('button', { name: 'Add Service Line' }).click()

  const serviceLineRow = page.locator('tbody tr', { hasText: serviceLineKey }).first()
  await expect(serviceLineRow).toBeVisible()

  const rowActiveCheckbox = serviceLineRow.locator('input[type="checkbox"]').first()
  await rowActiveCheckbox.uncheck()
  await serviceLineRow.locator('textarea').nth(1).fill('{"eligible_roles":["OPS_MANAGER"],"deny_roles":["FINANCE","HR"],"weights":{"open_assignments":1,"overdue_tasks":10,"due_soon":6,"inactive_penalty":8},"max_open_assignments_soft":4}')
  await serviceLineRow.getByRole('button', { name: 'Save' }).click()
  await expect(rowActiveCheckbox).not.toBeChecked()

  await page.getByRole('button', { name: 'Doc Templates', exact: true }).click()
  const templateForm = page.locator('form:has(button:has-text("Add Template"))').first()
  await templateForm.locator('input[placeholder*="Category"]').fill(templateCategory)
  await page.locator('label:has(span.kicker:has-text("Notes for new template")) textarea').fill('e2e template notes')
  await templateForm.getByRole('button', { name: 'Add Template' }).click()

  const templateRow = page.locator('tbody tr', { hasText: templateCategory }).first()
  await expect(templateRow).toBeVisible()
  const rowNotes = templateRow.locator('textarea').first()
  await rowNotes.fill('updated e2e template notes')
  await templateRow.getByRole('button', { name: 'Save' }).click()
  await expect(rowNotes).toHaveValue('updated e2e template notes')
})

test('associate user cannot access master data UI or API', async ({ page, request, trap }) => {
  await loginAsAssociate(page)
  await page.goto('/admin/masterdata')
  await expect(page.getByText('Access Restricted')).toBeVisible()

  const token = await getToken(page)
  const response = await request.get(`${API_URL}/api/master/service-lines`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.status()).toBe(403)

  trap.allowHttp((issue) => issue.url.includes('/api/master/service-lines') && issue.status === 403)

  await logout(page)
})
