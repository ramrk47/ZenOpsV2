import { expect, type Page, type TestInfo } from '@playwright/test'

type ConsoleGuardIssue = {
  kind: 'console' | 'pageerror'
  url: string
  message: string
}

export class ConsoleGuard {
  private readonly issues: ConsoleGuardIssue[] = []

  constructor(private readonly page: Page, private readonly testInfo: TestInfo) {
    this.page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      const text = msg.text().trim()
      if (!text) return
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
  }

  async assertNoErrors(context = 'Console Guard Summary'): Promise<void> {
    const summary = this.issues.length === 0
      ? 'No console.error/pageerror entries captured.'
      : this.issues.map((issue, idx) => `${idx + 1}. [${issue.kind}] ${issue.url} :: ${issue.message}`).join('\n')

    await this.testInfo.attach('console-guard-summary', {
      body: summary,
      contentType: 'text/plain',
    })

    expect(this.issues, `${context}\n${summary}`).toEqual([])
  }
}

export function attachConsoleGuard(page: Page, testInfo: TestInfo): ConsoleGuard {
  return new ConsoleGuard(page, testInfo)
}
