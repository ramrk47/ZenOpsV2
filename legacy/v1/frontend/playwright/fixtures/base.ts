import { test as base, expect } from '@playwright/test'

import { attachErrorTraps, type ErrorTrapCollector } from '../utils/error-traps'

type Fixtures = {
  trap: ErrorTrapCollector
}

export const test = base.extend<Fixtures>({
  trap: async ({ page }, use, testInfo) => {
    const collector = attachErrorTraps(page, testInfo)
    await use(collector)
    await collector.assertNoErrors()
  },
})

export { expect }
