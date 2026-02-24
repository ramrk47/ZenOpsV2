const fs = require('fs');
const path = require('path');

const destructivePattern = /delete|remove|purge|drop|destroy|deactivate|disable/i;
const skipPattern = /logout|sign out/i;

function nowStamp() {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, '-');
}

function ensureDir(p) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

function createRunContext(diagDir) {
  ensureDir(diagDir);
  const actionLogPath = path.join(diagDir, 'action_log.json');
  const ctx = {
    diagDir,
    actionLogPath,
    actions: [],
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    responseErrors: [],
  };
  return ctx;
}

function attachPageListeners(page, ctx) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      ctx.consoleErrors.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location(),
        time: new Date().toISOString(),
      });
    }
  });

  page.on('pageerror', (err) => {
    ctx.pageErrors.push({
      message: err.message,
      stack: err.stack,
      time: new Date().toISOString(),
    });
  });

  page.on('requestfailed', (req) => {
    ctx.requestFailures.push({
      url: req.url(),
      method: req.method(),
      failure: req.failure(),
      time: new Date().toISOString(),
    });
  });

  page.on('response', (resp) => {
    const status = resp.status();
    if (status >= 400) {
      ctx.responseErrors.push({
        url: resp.url(),
        status,
        time: new Date().toISOString(),
      });
    }
  });
}

async function captureScreenshot(page, ctx, step, pageName, action) {
  const fileName = `${String(step).padStart(3, '0')}-${pageName}-${action}.png`;
  const filePath = path.join('reports', 'screenshots', fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function safeClick(page, element, label, ctx, step, pageName) {
  const text = (await element.textContent().catch(() => '')) || '';
  const aria = (await element.getAttribute('aria-label').catch(() => '')) || '';
  const combined = `${text} ${aria}`.trim();

  if (skipPattern.test(combined)) {
    ctx.actions.push({
      type: 'skip',
      reason: 'session',
      label,
      text: combined,
      time: new Date().toISOString(),
    });
    return { skipped: true, reason: 'session' };
  }

  if (destructivePattern.test(combined)) {
    ctx.actions.push({
      type: 'skip',
      reason: 'destructive',
      label,
      text: combined,
      time: new Date().toISOString(),
    });
    return { skipped: true, reason: 'destructive' };
  }

  const isVisible = await element.isVisible().catch(() => false);
  if (!isVisible) {
    ctx.actions.push({
      type: 'skip',
      reason: 'hidden',
      label,
      text: combined,
      time: new Date().toISOString(),
    });
    return { skipped: true, reason: 'hidden' };
  }

  const isEnabled = await element.isEnabled().catch(() => true);
  const ariaDisabled = await element.getAttribute('aria-disabled').catch(() => null);
  if (!isEnabled || ariaDisabled === 'true') {
    ctx.actions.push({
      type: 'skip',
      reason: 'disabled',
      label,
      text: combined,
      time: new Date().toISOString(),
    });
    return { skipped: true, reason: 'disabled' };
  }

  try {
    await element.click({ force: true, timeout: 5000 });
    await page.waitForTimeout(500);
    const screenshotPath = await captureScreenshot(page, ctx, step, pageName, `click-${label}`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    ctx.actions.push({
      type: 'click',
      label,
      text: combined,
      screenshot: screenshotPath,
      time: new Date().toISOString(),
    });
    return { skipped: false };
  } catch (err) {
    ctx.actions.push({
      type: 'error',
      label,
      text: combined,
      error: err.message,
      time: new Date().toISOString(),
    });
    return { skipped: false, error: err.message };
  }
}

async function hoverAndCapture(page, element, label, ctx, step, pageName) {
  try {
    await element.hover({ timeout: 2000 });
    await page.waitForTimeout(200);
    const tooltip = page.locator('[role="tooltip"], .tooltip, [class*="tooltip"]');
    if (await tooltip.count() > 0) {
      const screenshotPath = await captureScreenshot(page, ctx, step, pageName, `tooltip-${label}`);
      ctx.actions.push({
        type: 'tooltip',
        label,
        screenshot: screenshotPath,
        time: new Date().toISOString(),
      });
    }
  } catch (err) {
    ctx.actions.push({
      type: 'hover-error',
      label,
      error: err.message,
      time: new Date().toISOString(),
    });
  }
}

async function flushLogs(ctx) {
  const payload = {
    actions: ctx.actions,
    consoleErrors: ctx.consoleErrors,
    pageErrors: ctx.pageErrors,
    requestFailures: ctx.requestFailures,
    responseErrors: ctx.responseErrors,
  };
  let existing = null;
  if (fs.existsSync(ctx.actionLogPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(ctx.actionLogPath, 'utf-8'));
    } catch (err) {
      existing = null;
    }
  }
  if (existing) {
    const merged = {
      actions: [...(existing.actions || []), ...payload.actions],
      consoleErrors: [...(existing.consoleErrors || []), ...payload.consoleErrors],
      pageErrors: [...(existing.pageErrors || []), ...payload.pageErrors],
      requestFailures: [...(existing.requestFailures || []), ...payload.requestFailures],
      responseErrors: [...(existing.responseErrors || []), ...payload.responseErrors],
    };
    fs.writeFileSync(ctx.actionLogPath, JSON.stringify(merged, null, 2));
  } else {
    fs.writeFileSync(ctx.actionLogPath, JSON.stringify(payload, null, 2));
  }
}

module.exports = {
  nowStamp,
  ensureDir,
  createRunContext,
  attachPageListeners,
  captureScreenshot,
  safeClick,
  hoverAndCapture,
  flushLogs,
};
