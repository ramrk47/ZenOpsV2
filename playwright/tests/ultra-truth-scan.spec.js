const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  nowStamp,
  ensureDir,
  createRunContext,
  attachPageListeners,
  captureScreenshot,
  safeClick,
  hoverAndCapture,
  flushLogs,
} = require('./_harness');

const BASE_URL = 'http://localhost';
const ADMIN_EMAIL = 'admin@zenops.local';
const ADMIN_PASSWORD = 'password';
const QA_PREFIX = `QA_TEST_${nowStamp()}`;

const NAV_ITEMS = [
  'Notifications', 'Approvals', 'Overdue', 'Payments',
  'My Day', 'Assignments', 'Requests', 'Calendar', 'Invoices', 'New Assignment',
  'Control Tower', 'Open Queue', 'Workload', 'Analytics',
  'Payroll Runs', 'Employees', 'Reports',
  'Activity', 'Email Deliveries', 'Attendance',
  'Support Inbox', 'System Config', 'Partner Requests', 'Personnel', 'Master Data', 'Company Accts', 'Backups',
];

const NAV_FALLBACKS = {
  'Assignments': '/assignments',
  'Calendar': '/calendar',
  'Invoices': '/invoices',
  'Notifications': '/notifications',
  'New Assignment': '/assignments',
  'Payroll Runs': '/admin/payroll',
  'Employees': '/admin/payroll/employees',
  'Reports': '/admin/payroll/reports',
  'Analytics': '/admin/analytics',
  'Master Data': '/admin/masterdata',
  'Backups': '/admin/backups',
  'Support Inbox': '/admin/support',
  'Company Accts': '/admin/company-accts',
  'Partner Requests': '/admin/partner-requests',
  'System Config': '/admin/system-config',
  'Personnel': '/admin/personnel',
  'Activity': '/admin/activity',
  'Email Deliveries': '/admin/email-deliveries',
  'Attendance': '/admin/attendance',
  'Control Tower': '/admin/control-tower',
  'Open Queue': '/admin/open-queue',
  'Workload': '/admin/workload',
  'Approvals': '/admin/approvals',
};

function sanitizeLabel(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function login(page, ctx) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await captureScreenshot(page, ctx, 1, 'login', 'loaded');
  await page.locator('input').first().fill(ADMIN_EMAIL);
  await page.locator('input').nth(1).fill(ADMIN_PASSWORD);
  await captureScreenshot(page, ctx, 2, 'login', 'filled');
  await page.locator('button:has-text("Sign In")').click();
  await page.waitForTimeout(3000);
  await captureScreenshot(page, ctx, 3, 'login', 'submitted');
  expect(page.url()).not.toContain('/login');
}

async function logout(page, ctx, step) {
  const logoutBtn = page.locator('button:has-text("Logout"), a:has-text("Logout")').first();
  if (await logoutBtn.count() > 0) {
    await logoutBtn.click({ force: true });
    await page.waitForTimeout(2000);
    await captureScreenshot(page, ctx, step, 'logout', 'after');
    expect(page.url()).toContain('/login');
  }
}

async function explorePage(page, ctx, pageName, startStep) {
  let step = startStep;
  await captureScreenshot(page, ctx, step++, pageName, 'entry');

  const clickables = page.locator('button, [role="button"], [role="tab"], a, [role="menuitem"], [role="option"]');
  const count = await clickables.count();
  const maxActions = Math.min(count, 15);

  for (let i = 0; i < maxActions; i++) {
    const el = clickables.nth(i);
    const label = sanitizeLabel((await el.textContent().catch(() => '')) || `item-${i}`);

    await hoverAndCapture(page, el, label, ctx, step++, pageName);
    await safeClick(page, el, label, ctx, step++, pageName);
  }

  return step;
}

async function goViaNav(page, ctx, label, step) {
  try {
    const nav = page.locator(`a:has-text("${label}"), button:has-text("${label}")`).first();
    if (await nav.count() > 0) {
      await nav.click({ force: true });
      await page.waitForTimeout(1500);
      await captureScreenshot(page, ctx, step, 'nav', sanitizeLabel(label));
      return true;
    }
  } catch (err) {
    ctx.actions.push({ type: 'nav-error', label, error: err.message, time: new Date().toISOString() });
  }
  const fallback = NAV_FALLBACKS[label];
  if (fallback) {
    await page.goto(`${BASE_URL}${fallback}`);
    await page.waitForTimeout(1500);
    await captureScreenshot(page, ctx, step, 'nav-fallback', sanitizeLabel(label));
    return true;
  }
  return false;
}

async function ensureAssignmentDetail(page, ctx, step) {
  await page.goto(`${BASE_URL}/assignments`);
  await page.waitForTimeout(2000);
  await captureScreenshot(page, ctx, step++, 'assignments', 'list');
  const firstLink = page.locator('tbody tr a').first();
  if (await firstLink.count() > 0) {
    await firstLink.click({ force: true });
  } else {
    await page.locator('tbody tr').first().click({ force: true });
  }
  await page.waitForTimeout(2000);
  await captureScreenshot(page, ctx, step++, 'assignments', 'detail');
  return step;
}

async function exploreAssignmentTabs(page, ctx, step) {
  const tabButtons = page.locator('.tab-button, [role="tab"]');
  const tabCount = await tabButtons.count();
  for (let i = 0; i < tabCount; i++) {
    const tab = tabButtons.nth(i);
    const tabText = (await tab.textContent().catch(() => `tab-${i}`)) || `tab-${i}`;
    await tab.click({ force: true });
    await page.waitForTimeout(1500);
    await captureScreenshot(page, ctx, step++, 'assignment-tab', sanitizeLabel(tabText));
  }
  return step;
}

async function documentWorkflow(page, ctx, step) {
  const docTab = page.locator('button:has-text("Documents")').first();
  if (await docTab.count() > 0) {
    await docTab.click({ force: true });
    await page.waitForTimeout(1500);
    await captureScreenshot(page, ctx, step++, 'documents', 'tab');

    const rows = await page.locator('tbody tr').count();
    if (rows > 0) {
      await page.locator('tbody tr').first().click({ force: true });
      await page.waitForTimeout(1500);
      await captureScreenshot(page, ctx, step++, 'documents', 'preview');

      const internalTab = page.locator('button:has-text("Internal")').first();
      if (await internalTab.count() > 0) {
        await internalTab.click({ force: true });
      }

      const commentBox = page.locator('textarea, [contenteditable="true"]').first();
      if (await commentBox.count() > 0) {
        await commentBox.fill(`QA_TEST comment ${nowStamp()}`);
        await captureScreenshot(page, ctx, step++, 'documents', 'comment-filled');
      }

      const postBtn = page.locator('button:has-text("Post")').first();
      if (await postBtn.count() > 0 && await postBtn.isEnabled()) {
        await postBtn.click({ force: true });
        await page.waitForTimeout(1000);
        await captureScreenshot(page, ctx, step++, 'documents', 'comment-posted');
      }

      const resolveBtn = page.locator('button:has-text("Resolve"), button:has-text("Mark Reviewed")').first();
      if (await resolveBtn.count() > 0 && await resolveBtn.isEnabled()) {
        await resolveBtn.click({ force: true });
        await page.waitForTimeout(1000);
        await captureScreenshot(page, ctx, step++, 'documents', 'resolved');
      }

      const downloadBtn = page.locator('button:has-text("Download"), a:has-text("Download")').first();
      if (await downloadBtn.count() > 0) {
        await captureScreenshot(page, ctx, step++, 'documents', 'download-visible');
      }

      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    }

    const uploadBtn = page.locator('button:has-text("Upload")').first();
    if (await uploadBtn.count() > 0) {
      await captureScreenshot(page, ctx, step++, 'documents', 'upload-btn');
    }
  }
  return step;
}

async function templateWorkflow(page, ctx, step) {
  await page.goto(`${BASE_URL}/admin/masterdata`);
  await page.waitForTimeout(2000);
  await captureScreenshot(page, ctx, step++, 'master-data', 'entry');

  const templateTab = page.locator('button:has-text("Doc Templates"), button:has-text("File Templates")').first();
  if (await templateTab.count() > 0) {
    await templateTab.click({ force: true });
    await page.waitForTimeout(1500);
    await captureScreenshot(page, ctx, step++, 'master-data', 'templates');

    const bankFilter = page.locator('select:has-text("Bank"), [placeholder*="Bank"], [aria-label*="Bank"]').first();
    if (await bankFilter.count() === 0) {
      ctx.actions.push({
        type: 'issue',
        severity: 'S1',
        area: 'Templates',
        message: 'Bank filter missing in templates tab',
        time: new Date().toISOString(),
      });
    }
  }

  await page.goto(`${BASE_URL}/assignments`);
  await page.waitForTimeout(2000);
  const firstLink = page.locator('tbody tr a').first();
  if (await firstLink.count() > 0) {
    await firstLink.click({ force: true });
  } else {
    await page.locator('tbody tr').first().click({ force: true });
  }
  await page.waitForTimeout(2000);
  await captureScreenshot(page, ctx, step++, 'assignment', 'detail');

  const docsTab = page.locator('button:has-text("Documents")').first();
  if (await docsTab.count() > 0) {
    await docsTab.click({ force: true });
    await page.waitForTimeout(1500);
    await captureScreenshot(page, ctx, step++, 'assignment', 'documents');
  }

  const addFromTemplate = page.locator('button:has-text("Template"), button:has-text("Add from Template")').first();
  if (await addFromTemplate.count() > 0) {
    await addFromTemplate.click({ force: true });
    await page.waitForTimeout(1500);
    await captureScreenshot(page, ctx, step++, 'assignment', 'template-modal');
  }

  return step;
}

async function supportInboxFlow(page, ctx, step) {
  await page.goto(`${BASE_URL}/admin/support`);
  await page.waitForTimeout(2000);
  await captureScreenshot(page, ctx, step++, 'support', 'inbox');

  const newBtn = page.locator('button:has-text("New"), button:has-text("Create")').first();
  if (await newBtn.count() > 0) {
    await newBtn.click({ force: true });
    await page.waitForTimeout(1500);
    await captureScreenshot(page, ctx, step++, 'support', 'new-thread');
  }

  return step;
}

async function payrollFlow(page, ctx, step) {
  const payrollPages = [
    { name: 'payroll-runs', url: '/admin/payroll' },
    { name: 'payroll-employees', url: '/admin/payroll/employees' },
    { name: 'payroll-reports', url: '/admin/payroll/reports' },
  ];
  for (const pageInfo of payrollPages) {
    await page.goto(`${BASE_URL}${pageInfo.url}`);
    await page.waitForTimeout(2000);
    await captureScreenshot(page, ctx, step++, 'payroll', pageInfo.name);
  }

  await page.goto(`${BASE_URL}/admin/payroll/runs/3`);
  await page.waitForTimeout(2000);
  await captureScreenshot(page, ctx, step++, 'payroll', 'run-detail');

  const tabs = ['Overview', 'Line Items', 'Payslips', 'Attendance Summary', 'Audit Log', 'Exports'];
  for (const tab of tabs) {
    const btn = page.locator(`button:has-text("${tab}")`).first();
    if (await btn.count() > 0) {
      await btn.click({ force: true });
      await page.waitForTimeout(1200);
      await captureScreenshot(page, ctx, step++, 'payroll-run', sanitizeLabel(tab));
    }
  }

  return step;
}

async function reviewAuditFlow(page, ctx, step) {
  const reviewPages = [
    { name: 'approvals', url: '/admin/approvals' },
    { name: 'activity', url: '/admin/activity' },
    { name: 'email-deliveries', url: '/admin/email-deliveries' },
    { name: 'attendance', url: '/admin/attendance' },
  ];
  for (const item of reviewPages) {
    await page.goto(`${BASE_URL}${item.url}`);
    await page.waitForTimeout(2000);
    await captureScreenshot(page, ctx, step++, 'review', item.name);
  }
  return step;
}

async function backupsFlow(page, ctx, step) {
  await page.goto(`${BASE_URL}/admin/backups`);
  await page.waitForTimeout(2000);
  await captureScreenshot(page, ctx, step++, 'backups', 'page');
  return step;
}

test.describe('Ultra Truth Scan', () => {
  test.setTimeout(720000);

  test('Explore entire app and workflows', async ({ page }) => {
    let diagDir = fs.existsSync('/tmp/diag_dir.txt')
      ? fs.readFileSync('/tmp/diag_dir.txt', 'utf-8').trim()
      : path.join('ops', 'diagnostics', nowStamp());

    if (!path.isAbsolute(diagDir)) {
      diagDir = path.join(process.cwd(), '..', diagDir);
    }

    ensureDir(diagDir);
    const ctx = createRunContext(diagDir);
    attachPageListeners(page, ctx);

    await login(page, ctx);
    await flushLogs(ctx);

    let step = 4;

    try {
      for (const label of NAV_ITEMS) {
        const ok = await goViaNav(page, ctx, label, step++);
        if (ok) {
          step = await explorePage(page, ctx, sanitizeLabel(label), step);
        }
      }

      step = await ensureAssignmentDetail(page, ctx, step);
      step = await exploreAssignmentTabs(page, ctx, step);
      step = await documentWorkflow(page, ctx, step);
      step = await templateWorkflow(page, ctx, step);
      step = await supportInboxFlow(page, ctx, step);
      step = await payrollFlow(page, ctx, step);
      step = await reviewAuditFlow(page, ctx, step);
      step = await backupsFlow(page, ctx, step);

      await logout(page, ctx, step++);
    } finally {
      await flushLogs(ctx);
    }
  });
});
