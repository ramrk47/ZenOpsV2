import path from 'node:path'

import { test, expect } from '../fixtures/base'
import { buildOnboardingAssociate } from '../fixtures/users'
import { loginAs, loginAsAdmin, logout } from '../utils/login'

const API_URL = process.env.E2E_API_URL || 'http://localhost:8000'
const UPLOAD_FILE = path.join(process.cwd(), 'playwright', 'fixtures', 'files', 'sample.pdf')

async function authToken(page: import('@playwright/test').Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('token'))
  if (!token) {
    throw new Error('Missing auth token after login')
  }
  return token
}

function extractIdFromUrl(url: string, segment: string): number {
  const pattern = new RegExp(`/${segment}/(\\d+)`)
  const match = url.match(pattern)
  if (!match) {
    throw new Error(`Unable to extract ${segment} id from URL: ${url}`)
  }
  return Number(match[1])
}

test('associate self-serve onboarding and cross-account interaction flow works end-to-end', async ({ page, request, trap: _trap }) => {
  const onboardingAssociate = buildOnboardingAssociate()

  await page.goto('/partner/request-access')
  await expect(page.getByRole('heading', { name: 'Associate Access Request' })).toBeVisible()
  await page.locator('input[name="company_name"]').fill(`E2E ${Date.now()} Associates`)
  await page.locator('input[name="contact_name"]').fill('Automation Associate')
  await page.locator('input[name="email"]').fill(onboardingAssociate.email)
  await page.locator('input[name="phone"]').fill('9000099999')
  await page.locator('textarea[name="message"]').fill('Phase 8.5 onboarding e2e request')
  await page.getByRole('button', { name: 'Submit Request' }).click()
  await expect(page.getByRole('heading', { name: 'Request Submitted' })).toBeVisible()

  try {
    await loginAs(page, onboardingAssociate)
  } catch (error) {
    throw new Error(
      `Onboarding login failed for ${onboardingAssociate.email}. ` +
      'Enable ASSOCIATE_AUTO_APPROVE=1 for non-production E2E runs. ' +
      `Original error: ${String(error)}`,
    )
  }

  await expect(page).toHaveURL(/\/partner$/)
  await expect(page.getByRole('heading', { name: 'Associate Console' })).toBeVisible()

  await page.goto('/partner/requests/new')
  await expect(page.getByRole('heading', { name: 'New Commission Request' })).toBeVisible()

  const serviceLineSelect = page.locator('label:has(span:has-text("Service line")) select').first()
  await expect(serviceLineSelect).toBeVisible()
  const serviceLineOptions = await serviceLineSelect.locator('option').allTextContents()
  const optionLabel = serviceLineOptions.find((label) => label.trim() && !/select service line/i.test(label))
  if (optionLabel) {
    await serviceLineSelect.selectOption({ label: optionLabel.trim() })
  }

  await page.locator('input[placeholder="Bank name"]').first().fill('E2E Bank')
  await page.locator('input[placeholder="Branch name"]').first().fill('E2E Branch')
  await page.locator('input[placeholder="Borrower name"]').fill(`E2E Borrower ${Date.now()}`)
  await page.locator('input[placeholder="Phone"]').fill('9000012345')
  await page.locator('textarea[placeholder="Property address"]').fill('E2E partner property address')
  await page.locator('input[placeholder="Land area (sqft)"]').fill('1400')
  await page.locator('input[placeholder="Built-up area (sqft)"]').first().fill('900')
  await page.locator('input[type="file"]').first().setInputFiles(UPLOAD_FILE)
  await page.getByRole('button', { name: 'Save Draft' }).click()
  await expect(page.getByText('Draft saved.')).toBeVisible()
  await page.getByRole('button', { name: 'Submit for Approval' }).click()
  await page.waitForURL(/\/partner\/requests\/\d+/, { timeout: 20_000 })

  const commissionId = extractIdFromUrl(page.url(), 'partner/requests')
  const associateToken = await authToken(page)
  const profileResponse = await request.get(`${API_URL}/api/partner/profile`, {
    headers: { Authorization: `Bearer ${associateToken}` },
  })
  expect(profileResponse.ok()).toBeTruthy()
  const profile = (await profileResponse.json()) as { id: number }
  const partnerId = Number(profile.id)
  expect(partnerId).toBeGreaterThan(0)

  await logout(page)
  await loginAsAdmin(page)
  const adminToken = await authToken(page)

  const createRequestResponse = await request.post(`${API_URL}/api/admin/partner-requests`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    data: {
      partner_id: partnerId,
      request_type: 'DOC_REQUEST',
      entity_type: 'COMMISSION_REQUEST',
      entity_id: commissionId,
      message: 'Please upload KYC ownership file',
    },
  })
  expect(createRequestResponse.status()).toBe(201)
  const createdRequest = (await createRequestResponse.json()) as { id: number }
  const internalRequestId = Number(createdRequest.id)
  expect(internalRequestId).toBeGreaterThan(0)

  const approveCommissionResponse = await request.post(`${API_URL}/api/admin/commissions/${commissionId}/approve`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    data: {},
  })
  expect(approveCommissionResponse.ok()).toBeTruthy()
  const approvedCommission = (await approveCommissionResponse.json()) as { converted_assignment_id?: number }
  const convertedAssignmentId = Number(approvedCommission.converted_assignment_id || 0)
  expect(convertedAssignmentId).toBeGreaterThan(0)

  await logout(page)
  await loginAs(page, onboardingAssociate)

  await page.goto(`/partner/requests/${commissionId}`)
  await expect(page.getByText(/Request /)).toBeVisible()
  await page.getByRole('button', { name: 'Documents', exact: true }).click()
  await page.locator('textarea[placeholder="Add a response message"]').first().fill('Uploaded KYC docs from associate portal.')
  await page.locator('input[type="file"]').first().setInputFiles(UPLOAD_FILE)
  await page.getByRole('button', { name: 'Submit Response' }).first().click()
  await expect(page.getByText('Response sent.')).toBeVisible()

  await page.goto('/admin/dashboard')
  await expect(page.getByText('Access Restricted')).toBeVisible()
  await page.goto('/assignments')
  await expect(page.getByText('Access Restricted')).toBeVisible()

  await logout(page)
  await loginAsAdmin(page)
  const adminTokenAgain = await authToken(page)

  const partnerRequestListResponse = await request.get(`${API_URL}/api/admin/partner-requests?partner_id=${partnerId}`, {
    headers: { Authorization: `Bearer ${adminTokenAgain}` },
  })
  expect(partnerRequestListResponse.ok()).toBeTruthy()
  const partnerRequests = (await partnerRequestListResponse.json()) as Array<{
    id: number
    direction: string
    request_type: string
    entity_type: string
    entity_id: number
    status: string
  }>
  const originalRequest = partnerRequests.find((item) => item.id === internalRequestId)
  expect(originalRequest?.status).toBe('RESPONDED')
  const responseRequest = partnerRequests.find((item) => (
    item.direction === 'PARTNER_TO_INTERNAL'
    && item.request_type === 'DOC_SUBMITTED'
    && item.entity_type === 'COMMISSION_REQUEST'
    && Number(item.entity_id) === commissionId
  ))
  expect(responseRequest).toBeTruthy()

  const markCompletedResponse = await request.patch(`${API_URL}/api/assignments/${convertedAssignmentId}`, {
    headers: {
      Authorization: `Bearer ${adminTokenAgain}`,
      'Content-Type': 'application/json',
    },
    data: {
      status: 'COMPLETED',
      notes: 'Completed by phase8.5 associate onboarding e2e suite',
    },
  })
  expect(markCompletedResponse.ok()).toBeTruthy()
  const completedAssignment = (await markCompletedResponse.json()) as { status: string }
  expect(completedAssignment.status).toBe('COMPLETED')
})
