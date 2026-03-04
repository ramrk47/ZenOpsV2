import { test, expect } from '../fixtures/base'
import { loginAsAdmin, loginAsFieldValuer, logout } from '../utils/login'

const API_URL = process.env.E2E_API_URL || 'http://localhost:8000'

async function getAuthToken(page: import('@playwright/test').Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('token'))
  if (!token) throw new Error('Missing auth token in localStorage after login')
  return token
}

async function createDraftViaApi(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  borrowerSuffix: string,
): Promise<void> {
  const mineResponse = await request.get(`${API_URL}/api/assignments?mine=true&limit=1`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(mineResponse.ok()).toBeTruthy()
  const mineAssignments = (await mineResponse.json()) as Array<Record<string, unknown>>
  expect(mineAssignments.length).toBeGreaterThan(0)
  const base = mineAssignments[0]

  const payload = {
    case_type: 'BANK',
    service_line: String(base.service_line || 'VALUATION'),
    service_line_id: Number(base.service_line_id || 0) || null,
    uom: String(base.uom || 'SQFT'),
    bank_id: Number(base.bank_id || 0),
    branch_id: Number(base.branch_id || 0),
    property_type_id: Number(base.property_type_id || 0) || null,
    property_subtype_id: Number(base.property_subtype_id || 0) || null,
    borrower_name: `Field Draft ${borrowerSuffix}`,
    phone: '9000022222',
    address: 'Draft approval test payload',
    land_area: 1234,
    builtup_area: 800,
    status: 'PENDING',
    assigned_to_user_id: Number(base.assigned_to_user_id || 0) || null,
    assignee_user_ids: Number(base.assigned_to_user_id || 0) ? [Number(base.assigned_to_user_id)] : [],
  }

  const response = await request.post(`${API_URL}/api/assignments/drafts`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: payload,
  })
  expect(response.status()).toBe(201)
}

async function switchApprovalType(page: import('@playwright/test').Page, label: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${label}`, 'i') }).first().click()
  await page.waitForLoadState('networkidle')
}

async function switchStatus(page: import('@playwright/test').Page, status: 'Pending' | 'Approved' | 'Rejected'): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${status}$`, 'i') }).click()
  await page.waitForLoadState('networkidle')
}

async function clickFirstRowAction(page: import('@playwright/test').Page, action: 'Approve' | 'Reject' | 'Open'): Promise<void> {
  const firstRow = page.locator('tbody tr').first()
  await expect(firstRow).toBeVisible()
  await firstRow.getByRole('button', { name: action }).click()
}

test('admin approvals suite handles draft/doc/payment approvals with reason persistence', async ({ page, request, trap: _trap }) => {
  await loginAsFieldValuer(page)
  const fieldToken = await getAuthToken(page)
  await createDraftViaApi(request, fieldToken, `${Date.now()}-A`)
  await createDraftViaApi(request, fieldToken, `${Date.now()}-B`)

  await logout(page)
  await loginAsAdmin(page)

  await page.goto('/admin/approvals')
  await expect(page.getByRole('heading', { name: 'Requests' })).toBeVisible()

  await switchApprovalType(page, 'Draft Assignments')
  await switchStatus(page, 'Pending')

  const rejectReason = 'Rejected by e2e approvals suite'
  page.once('dialog', (dialog) => dialog.accept(rejectReason))
  await clickFirstRowAction(page, 'Reject')

  await switchStatus(page, 'Rejected')
  await clickFirstRowAction(page, 'Open')
  await expect(page.getByText('Decision Reason:')).toBeVisible()
  await expect(page.getByText(rejectReason)).toBeVisible()

  await switchStatus(page, 'Pending')
  await clickFirstRowAction(page, 'Approve')
  await switchStatus(page, 'Approved')
  await clickFirstRowAction(page, 'Open')
  await expect(page.getByText(/Request #/)).toBeVisible()

  await switchApprovalType(page, 'Final Document Review')
  await switchStatus(page, 'Pending')
  await clickFirstRowAction(page, 'Approve')
  await switchStatus(page, 'Approved')
  await expect(page.locator('tbody tr').first()).toBeVisible()

  await switchApprovalType(page, 'Payment Confirmation')
  await switchStatus(page, 'Pending')
  await clickFirstRowAction(page, 'Approve')
  await switchStatus(page, 'Approved')
  await expect(page.locator('tbody tr').first()).toBeVisible()

})

test('non-admin users cannot access approvals inbox', async ({ page, trap: _trap }) => {
  await loginAsFieldValuer(page)
  await page.goto('/admin/approvals')
  await expect(page.getByText('Access Restricted')).toBeVisible()
})
