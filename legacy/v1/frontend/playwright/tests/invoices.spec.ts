import fs from 'node:fs'

import { test, expect } from '../fixtures/base'
import { loginAsAdmin, loginAsFinance, logout } from '../utils/login'

const API_URL = process.env.E2E_API_URL || 'http://localhost:8000'

type InvoiceRow = {
  id: number
  invoice_number: string
  amount_due: number
  amount_paid: number
  adjustments_total: number
  base_total: number
  net_total: number
  status: string
}

type InvoiceDetail = {
  id: number
  invoice_number: string
  amount_due: number
  amount_paid: number
  adjustments_total: number
  base_total: number
  net_total: number
  payments: Array<{ id: number; confirmation_status: string; approval_id?: number | null }>
}

async function authToken(page: import('@playwright/test').Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('token'))
  if (!token) throw new Error('Missing auth token after login')
  return token
}

async function fetchInvoices(
  request: import('@playwright/test').APIRequestContext,
  token: string,
): Promise<InvoiceRow[]> {
  const response = await request.get(`${API_URL}/api/invoices?unpaid=true&page=1&page_size=20`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  return body.items as InvoiceRow[]
}

async function fetchInvoiceDetail(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  invoiceId: number,
): Promise<InvoiceDetail> {
  const response = await request.get(`${API_URL}/api/invoices/${invoiceId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as InvoiceDetail
}

async function openTargetInvoiceDrawer(page: import('@playwright/test').Page, invoiceNumber: string): Promise<void> {
  await page.goto('/invoices')
  const searchInput = page.locator('input[placeholder*="Search invoices"]').first()
  await searchInput.fill(invoiceNumber)
  await page.waitForTimeout(300)

  const row = page.locator('tbody tr', { hasText: invoiceNumber }).first()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Record Payment' }).click()
  await expect(page.getByText('Invoice details')).toBeVisible()
}

async function recordPayment(
  page: import('@playwright/test').Page,
  mode: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'OTHER',
  amount: string,
  notes = '',
): Promise<void> {
  await page.getByRole('button', { name: 'Payments', exact: true }).click()

  const paymentForm = page.locator('form:has(button:has-text("Record Payment"))').first()
  await paymentForm.locator('label:has(span.kicker:has-text("Amount")) input').fill(amount)
  await paymentForm.locator('label:has(span.kicker:has-text("Mode")) select').selectOption(mode)
  await paymentForm.locator('label:has(span.kicker:has-text("Paid At")) input').fill('')
  await paymentForm.locator('label:has(span.kicker:has-text("Reference")) input').fill(`REF-${Date.now()}`)
  await paymentForm.locator('label:has(span.kicker:has-text("Notes")) textarea').fill(notes)
  await paymentForm.getByRole('button', { name: 'Record Payment' }).click()
}

test('invoice suite covers payments/adjustments/export and approval-driven paid/due updates', async ({ page, request, trap: _trap }) => {
  await loginAsFinance(page)
  const financeToken = await authToken(page)

  await page.goto('/invoices')
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible()

  // UI create-invoice flow (supported and exercised).
  await page.getByRole('button', { name: 'New Invoice' }).click()
  await expect(page.getByRole('heading', { name: 'Create Invoice' })).toBeVisible()
  const createModal = page.locator('.modal-card:has(h3:has-text("Create Invoice"))')
  const assignmentSelect = createModal.locator('select').first()
  await assignmentSelect.selectOption({ index: 1 })
  await createModal.getByRole('button', { name: 'Create Invoice' }).click()
  await expect(page.getByText('Invoice created.')).toBeVisible()

  const invoices = await fetchInvoices(request, financeToken)
  expect(invoices.length).toBeGreaterThan(0)
  const target = invoices.find((invoice) => Number(invoice.amount_due) > 500) || invoices[0]

  const beforeAdjustment = await fetchInvoiceDetail(request, financeToken, target.id)

  await openTargetInvoiceDrawer(page, target.invoice_number)

  // Allowed payment modes succeed.
  await recordPayment(page, 'CASH', '50', 'cash test')
  await recordPayment(page, 'UPI', '60', 'upi test')
  await recordPayment(page, 'BANK_TRANSFER', '70', 'bank transfer test')

  // OTHER requires a note.
  await page.getByRole('button', { name: 'Payments', exact: true }).click()
  const paymentForm = page.locator('form:has(button:has-text("Record Payment"))').first()
  await paymentForm.locator('label:has(span.kicker:has-text("Amount")) input').fill('80')
  await paymentForm.locator('label:has(span.kicker:has-text("Mode")) select').selectOption('OTHER')
  await paymentForm.locator('label:has(span.kicker:has-text("Notes")) textarea').fill('')
  await paymentForm.getByRole('button', { name: 'Record Payment' }).click()
  await expect(page.getByText('Other offline payments require a note.')).toBeVisible()
  await paymentForm.locator('label:has(span.kicker:has-text("Notes")) textarea').fill('other payment note from e2e suite')
  await paymentForm.getByRole('button', { name: 'Record Payment' }).click()

  // Legacy CARD mode is rejected by API.
  const cardAttempt = await request.post(`${API_URL}/api/invoices/${target.id}/payments`, {
    headers: {
      Authorization: `Bearer ${financeToken}`,
      'Content-Type': 'application/json',
    },
    data: {
      amount: 25,
      mode: 'CARD',
      notes: 'card mode should fail',
    },
  })
  expect(cardAttempt.status()).toBe(400)

  // Adjustment impacts financial invariants.
  await page.getByRole('button', { name: 'Adjustments', exact: true }).click()
  const adjustmentForm = page.locator('form:has(button:has-text("Record Adjustment"))').first()
  await adjustmentForm.locator('label:has(span.kicker:has-text("Amount")) input').fill('111')
  await adjustmentForm.locator('label:has(span.kicker:has-text("Type")) select').selectOption('DISCOUNT')
  await adjustmentForm.locator('label:has(span.kicker:has-text("Issued At")) input').fill('')
  await adjustmentForm.locator('label:has(span.kicker:has-text("Reason")) input').fill('e2e discount adjustment')
  await adjustmentForm.getByRole('button', { name: 'Record Adjustment' }).click()
  await expect(page.getByText('e2e discount adjustment')).toBeVisible()

  const afterAdjustment = await fetchInvoiceDetail(request, financeToken, target.id)
  expect(Number(afterAdjustment.adjustments_total)).not.toBe(Number(beforeAdjustment.adjustments_total))
  expect(Number(afterAdjustment.net_total)).not.toBe(Number(beforeAdjustment.net_total))

  // Approve one pending payment and verify paid/due change.
  const pendingPayment = afterAdjustment.payments.find(
    (payment) => String(payment.confirmation_status).toUpperCase() === 'PENDING_CONFIRMATION' && payment.approval_id,
  )
  expect(pendingPayment?.approval_id).toBeTruthy()

  await logout(page)
  await loginAsAdmin(page)
  const adminToken = await authToken(page)
  const approveResponse = await request.post(`${API_URL}/api/approvals/${pendingPayment!.approval_id}/approve`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    data: { comment: 'approved from invoice e2e suite' },
  })
  expect(approveResponse.ok()).toBeTruthy()

  const afterApproval = await fetchInvoiceDetail(request, adminToken, target.id)
  expect(Number(afterApproval.amount_paid)).toBeGreaterThan(Number(afterAdjustment.amount_paid))
  expect(Number(afterApproval.amount_due)).toBeLessThan(Number(afterAdjustment.amount_due))

  // CSV export includes required invariant columns.
  await page.goto('/invoices')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  const download = await downloadPromise
  const downloadedPath = await download.path()
  expect(downloadedPath).toBeTruthy()
  const csv = fs.readFileSync(downloadedPath!, 'utf-8')
  const header = csv.split(/\r?\n/)[0] || ''
  expect(header).toContain('base_total')
  expect(header).toContain('adjustments_total')
  expect(header).toContain('net_total')
})
