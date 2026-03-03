import fs from 'node:fs'
import path from 'node:path'

import { test, expect } from '../fixtures/base'
import { loginAsAdmin } from '../utils/login'

const PRIMARY_ROUTES = [
  '/admin/dashboard',
  '/account',
  '/assignments',
  '/assignments/new',
  '/calendar',
  '/notifications',
  '/invoices',
  '/requests',
  '/admin/open-queue',
  '/admin/workload',
  '/admin/approvals',
  '/admin/activity',
  '/admin/backups',
  '/admin/analytics',
  '/admin/personnel',
  '/admin/masterdata',
  '/admin/company',
  '/admin/notification-deliveries',
  '/admin/attendance',
  '/admin/partner-requests',
  '/admin/billing-monitor',
  '/admin/payroll',
  '/admin/support',
  '/admin/system-config',
]

const DESTRUCTIVE_KEYWORDS = ['delete', 'remove', 'void', 'reject', 'reset', 'disable', 'archive']
const BLOCKED_KEYWORDS = ['logout', 'sign out']

function isDestructiveText(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return false
  return DESTRUCTIVE_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

function isBlockedText(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return false
  return BLOCKED_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

function normalizePath(rawUrl: string, baseURL: string): string {
  const resolved = new URL(rawUrl, baseURL)
  return `${resolved.pathname}${resolved.search}`
}

test('dom crawler clicks every visible control safely', async ({ page, trap: _trap }) => {
  const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173'
  const destructiveMode = process.env.E2E_DESTRUCTIVE === '1'

  await loginAsAdmin(page)

  const queue = [...PRIMARY_ROUTES]
  const seenRoutes = new Set<string>()
  const visitedRoutes = new Set<string>()
  const clicked: Array<{ url: string; element: string }> = []
  const failures: Array<{ url: string; selector: string; reason: string }> = []

  async function collectInternalLinks(): Promise<string[]> {
    const links = await page.locator('a[href]').elementHandles()
    const discovered: string[] = []
    for (const link of links) {
      const href = await link.getAttribute('href')
      if (!href) continue
      if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue
      const normalized = normalizePath(href, baseURL)
      if (!normalized.startsWith('/')) continue
      discovered.push(normalized)
    }
    return discovered
  }

  async function crawlCurrentPage(route: string): Promise<void> {
    const handles = await page.locator('a[href], button, [role="button"]').elementHandles()

    for (const handle of handles) {
      const visible = await handle.isVisible().catch(() => false)
      if (!visible) continue

      const disabled = await handle.evaluate((el) => {
        const html = el as HTMLElement & { disabled?: boolean }
        return Boolean(html.disabled) || el.getAttribute('aria-disabled') === 'true'
      }).catch(() => true)
      if (disabled) continue

      const descriptor = await handle.evaluate((el) => {
        const role = el.getAttribute('role') || el.tagName.toLowerCase()
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120)
        const href = el.getAttribute('href') || ''
        const id = el.id ? `#${el.id}` : ''
        const dataTestId = el.getAttribute('data-testid') ? `[data-testid="${el.getAttribute('data-testid')}"]` : ''
        const target = el.getAttribute('target') || ''
        return {
          role,
          text,
          href,
          selector: `${el.tagName.toLowerCase()}${id}${dataTestId}`,
          target,
        }
      }).catch(() => null)
      if (!descriptor) continue

      if (isBlockedText(descriptor.text)) continue
      if (!destructiveMode && isDestructiveText(descriptor.text)) continue
      if (descriptor.target === '_blank') continue

      if (descriptor.href) {
        const resolved = new URL(descriptor.href, baseURL)
        if (resolved.origin !== new URL(baseURL).origin) continue
      }

      try {
        await handle.scrollIntoViewIfNeeded().catch(() => undefined)
        await handle.click({ timeout: 7000 })
        await page.waitForLoadState('networkidle', { timeout: 7000 }).catch(() => undefined)
        await page.waitForTimeout(120)

        const url = normalizePath(page.url(), baseURL)
        const title = await page.title().catch(() => '')
        if (/404|not\s+found/i.test(title) || url.includes('/404')) {
          throw new Error(`navigated to not-found route (${url})`)
        }

        clicked.push({
          url,
          element: `${descriptor.selector} :: ${descriptor.text || descriptor.role}`,
        })
      } catch (error) {
        failures.push({
          url: normalizePath(page.url(), baseURL),
          selector: `${descriptor.selector} :: ${descriptor.text || descriptor.role}`,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const discoveredLinks = await collectInternalLinks()
    for (const discovered of discoveredLinks) {
      if (!seenRoutes.has(discovered)) {
        seenRoutes.add(discovered)
        queue.push(discovered)
      }
    }

    // Restore route after deep clicks so we can continue scanning in a deterministic way.
    await page.goto(route)
    await page.waitForLoadState('domcontentloaded')
  }

  while (queue.length > 0 && visitedRoutes.size < 120) {
    const route = queue.shift()!
    const normalizedRoute = normalizePath(route, baseURL)
    if (visitedRoutes.has(normalizedRoute)) continue
    visitedRoutes.add(normalizedRoute)

    await page.goto(normalizedRoute)
    await page.waitForLoadState('domcontentloaded')

    await crawlCurrentPage(normalizedRoute)
  }

  const report = {
    generated_at: new Date().toISOString(),
    destructive_mode: destructiveMode,
    visited_routes: Array.from(visitedRoutes),
    buttons_clicked: clicked,
    failures,
  }

  const reportPath = path.join(process.cwd(), 'playwright', 'test-results', 'dom-crawler-report.json')
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')

  expect(failures, `DOM crawler reported actionable failures:\n${JSON.stringify(failures, null, 2)}`).toEqual([])
  expect(visitedRoutes.size).toBeGreaterThan(10)
  expect(clicked.length).toBeGreaterThan(10)
})
