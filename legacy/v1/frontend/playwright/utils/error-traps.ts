import { expect, type Page, type TestInfo } from '@playwright/test'

type TrapIssue = {
  kind: 'console' | 'pageerror' | 'requestfailed' | 'http'
  url: string
  message: string
  method?: string
  status?: number
}

const IGNORED_CONSOLE_PATTERNS = [/download the react devtools/i]
const IGNORED_REQUEST_FAILURES = ['net::ERR_ABORTED']
const IGNORED_HTTP_URL_PATTERNS = [/\/favicon\.ico$/i]

export class ErrorTrapCollector {
  private readonly issues: TrapIssue[] = []
  private readonly allowedHttpPredicates: Array<(issue: TrapIssue) => boolean> = []
  private readonly ignoredConsolePatterns: RegExp[] = [...IGNORED_CONSOLE_PATTERNS]

  constructor(private readonly page: Page, private readonly testInfo: TestInfo) {
    this.page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      const text = msg.text().trim()
      if (!text) return
      if (this.ignoredConsolePatterns.some((pattern) => pattern.test(text))) return
      this.issues.push({
        kind: 'console',
        url: this.page.url(),
        message: text,
      })
    })

    this.page.on('pageerror', (error) => {
      this.issues.push({
        kind: 'pageerror',
        url: this.page.url(),
        message: String(error),
      })
    })

    this.page.on('requestfailed', (request) => {
      const failureText = request.failure()?.errorText || 'request failed'
      if (IGNORED_REQUEST_FAILURES.some((ignored) => failureText.includes(ignored))) {
        return
      }
      this.issues.push({
        kind: 'requestfailed',
        url: request.url(),
        method: request.method(),
        message: failureText,
      })
    })

    this.page.on('response', (response) => {
      const status = response.status()
      if (status < 400) return
      const issue: TrapIssue = {
        kind: 'http',
        url: response.url(),
        method: response.request().method(),
        status,
        message: `HTTP ${status}`,
      }
      if (IGNORED_HTTP_URL_PATTERNS.some((pattern) => pattern.test(issue.url))) return
      if (this.allowedHttpPredicates.some((predicate) => predicate(issue))) return
      this.issues.push(issue)
    })
  }

  allowHttp(predicate: (issue: TrapIssue) => boolean): void {
    this.allowedHttpPredicates.push(predicate)
  }

  ignoreConsole(pattern: RegExp): void {
    this.ignoredConsolePatterns.push(pattern)
  }

  getSummary(): string {
    if (this.issues.length === 0) {
      return 'No console/network/page errors captured.'
    }
    return this.issues
      .map((issue, idx) => {
        const method = issue.method ? `${issue.method} ` : ''
        const status = issue.status ? ` (${issue.status})` : ''
        return `${idx + 1}. [${issue.kind}] ${method}${issue.url}${status} :: ${issue.message}`
      })
      .join('\n')
  }

  async assertNoErrors(context = 'Network/Console Error Summary'): Promise<void> {
    const summary = this.getSummary()
    await this.testInfo.attach('network-console-summary', {
      body: summary,
      contentType: 'text/plain',
    })
    expect(this.issues, `${context}\n${summary}`).toEqual([])
  }
}

export function attachErrorTraps(page: Page, testInfo: TestInfo): ErrorTrapCollector {
  return new ErrorTrapCollector(page, testInfo)
}
