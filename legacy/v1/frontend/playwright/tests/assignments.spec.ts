import path from 'node:path'

import { test, expect } from '../fixtures/base'
import { loginAsAdmin, loginAsFieldValuer } from '../utils/login'

const API_URL = process.env.E2E_API_URL || 'http://localhost:8000'
const UPLOAD_FILE = path.join(process.cwd(), 'playwright', 'fixtures', 'files', 'sample.pdf')

type CreateSpec = {
  serviceLineLabel: string
  borrowerName: string
  uom?: string
  needsSurveyRow?: boolean
  needsOtherDescription?: boolean
}

function kickerSelect(page: import('@playwright/test').Page, label: string) {
  return page.locator(`label:has(span.kicker:has-text("${label}")) select`).first()
}

function kickerInput(page: import('@playwright/test').Page, label: string) {
  return page.locator(`label:has(span.kicker:has-text("${label}")) input`).first()
}

async function createAssignmentFromUi(page: import('@playwright/test').Page, spec: CreateSpec): Promise<number> {
  await page.goto('/assignments/new')
  await expect(page.getByText('Case Setup')).toBeVisible()

  await kickerSelect(page, 'Case Type').selectOption('BANK')
  await kickerSelect(page, 'Service Line').selectOption({ label: spec.serviceLineLabel })
  await kickerSelect(page, 'Unit of Measurement').selectOption(spec.uom || 'SQFT')

  await kickerSelect(page, 'Bank').selectOption({ index: 1 })
  await kickerSelect(page, 'Branch').selectOption({ index: 1 })

  await kickerInput(page, 'Borrower Name').fill(spec.borrowerName)
  await page.locator('input[placeholder="Optional"]').fill('9999999999')

  const landArea = page.locator('input[placeholder="Land area"]').first()
  if (await landArea.isVisible().catch(() => false)) {
    await landArea.fill('1250')
  }

  if (spec.needsSurveyRow) {
    await page.locator('input[placeholder="Survey no"]').first().fill(`SR-${Date.now()}`)
  }

  if (spec.needsOtherDescription) {
    await page.locator('input[placeholder="Describe the service"]').fill('E2E other service description')
  }

  await page.getByRole('button', { name: /create assignment/i }).click()
  await page.waitForURL(/\/assignments\/\d+/, { timeout: 20_000 })

  const match = page.url().match(/\/assignments\/(\d+)/)
  if (!match) {
    throw new Error(`expected assignment detail URL, got ${page.url()}`)
  }
  return Number(match[1])
}

test('admin core assignment lifecycle covers create/edit/task/message/docs/final/delete', async ({ page, trap: _trap }) => {
  await loginAsAdmin(page)

  const createSpecs: CreateSpec[] = [
    { serviceLineLabel: 'Valuation Plot', borrowerName: `E2E Plot ${Date.now()}` },
    { serviceLineLabel: 'Valuation L&B', borrowerName: `E2E L&B ${Date.now()}` },
    { serviceLineLabel: 'Valuation Agri', borrowerName: `E2E Agri ${Date.now()}`, uom: 'ACRE_GUNTA_AANA', needsSurveyRow: true },
    { serviceLineLabel: 'Project Report', borrowerName: `E2E Project ${Date.now()}` },
    { serviceLineLabel: 'Others', borrowerName: `E2E Others ${Date.now()}`, needsOtherDescription: true },
  ]

  const createdIds: number[] = []
  for (const spec of createSpecs) {
    const assignmentId = await createAssignmentFromUi(page, spec)
    createdIds.push(assignmentId)
  }

  const targetId = createdIds[0]
  await page.goto(`/assignments/${targetId}`)
  await expect(page.getByText(/Assignment\s+/)).toBeVisible()

  await kickerInput(page, 'Borrower Name').fill('E2E Updated Borrower Name')
  await page.getByRole('button', { name: 'Save Overview' }).click()
  await expect(page.getByText('Assignment updated.')).toBeVisible()

  await page.getByRole('button', { name: 'Tasks', exact: true }).click()
  const taskForm = page.locator('form:has(button:has-text("Create Task"))').first()
  await taskForm.locator('input').first().fill('E2E task follow-up')
  await taskForm.locator('textarea').fill('Task from Phase 8.5 core workflow suite')
  await taskForm.getByRole('button', { name: 'Create Task' }).click()
  await expect(page.getByText('Task created.')).toBeVisible()

  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  await page.locator('textarea[placeholder*="Type a message"]').fill('E2E chat message from core workflow suite')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText('E2E chat message from core workflow suite')).toBeVisible()

  await page.getByRole('button', { name: 'Documents', exact: true }).click()
  const uploadForm = page.locator('form:has(button:has-text("Upload Document"))').first()
  await uploadForm.locator('input[type="file"]').setInputFiles(UPLOAD_FILE)
  await uploadForm.locator('select').first().selectOption({ index: 1 })
  await uploadForm.getByRole('button', { name: 'Upload Document' }).click()
  await expect(page.getByText(/Document uploaded/)).toBeVisible()

  const markFinal = page.getByRole('button', { name: /Mark Final/i }).first()
  await markFinal.click()
  await expect(page.getByText('Final document submitted for approval.')).toBeVisible()

  await page.getByRole('button', { name: 'Approvals', exact: true }).click()
  await expect(page.getByText(/Final Doc Review|FINAL_DOC_REVIEW/i)).toBeVisible()

  await page.getByRole('button', { name: 'Overview', exact: true }).click()
  page.once('dialog', (dialog) => dialog.accept('E2E cleanup delete'))
  await page.getByRole('button', { name: 'Delete / Request Delete' }).click()
  await expect(page.getByText(/Assignment deleted\.|Deletion approval requested\./)).toBeVisible()
})

test('field valuer can only submit draft assignments and is blocked from admin masterdata', async ({ page, request, trap }) => {
  await loginAsFieldValuer(page)

  const token = await page.evaluate(() => localStorage.getItem('token'))
  expect(token).toBeTruthy()

  const mineResponse = await request.get(`${API_URL}/api/assignments?mine=true&limit=1`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(mineResponse.ok()).toBeTruthy()
  const mineAssignments = (await mineResponse.json()) as Array<Record<string, unknown>>
  expect(mineAssignments.length).toBeGreaterThan(0)
  const firstAssignment = mineAssignments[0]

  const forbiddenPayload = {
    case_type: 'DIRECT_CLIENT',
    service_line: String(firstAssignment.service_line || 'VALUATION'),
    service_line_id: Number(firstAssignment.service_line_id || 0) || null,
    uom: 'SQFT',
    valuer_client_name: 'Field Valuer Direct Client',
    borrower_name: `Forbidden Permanent ${Date.now()}`,
    phone: '9000011111',
    address: 'Field valuer forbidden create attempt',
    land_area: 1500,
    builtup_area: 900,
    status: 'PENDING',
  }

  const forbiddenCreate = await request.post(`${API_URL}/api/assignments`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: forbiddenPayload,
  })

  trap.allowHttp((issue) => issue.url.includes('/api/assignments') && issue.status === forbiddenCreate.status())
  expect(forbiddenCreate.status()).toBe(403)

  await page.goto('/assignments/new')
  await expect(page.getByText('Case Setup')).toBeVisible()

  await kickerSelect(page, 'Service Line').selectOption({ index: 1 })
  await kickerSelect(page, 'Unit of Measurement').selectOption('SQFT')
  await kickerSelect(page, 'Bank').selectOption({ index: 1 })
  await kickerSelect(page, 'Branch').selectOption({ index: 1 })
  await kickerInput(page, 'Borrower Name').fill(`Field Draft ${Date.now()}`)

  await page.getByRole('button', { name: 'Submit Draft' }).click()
  const draftNotice = page.getByText(/Draft submitted for approval\. Temporary code:/)
  await expect(draftNotice).toBeVisible()
  await expect(draftNotice).toContainText(/DRAFT-\d{8}-\d{4}/)

  await page.goto('/admin/masterdata')
  await expect(page.getByText('Access Restricted')).toBeVisible()
})
