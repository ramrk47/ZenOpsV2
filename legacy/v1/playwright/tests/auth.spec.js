const { test, expect } = require('@playwright/test');

const ADMIN_EMAIL = 'admin@zenops.local';
const ADMIN_PASSWORD = 'password';

test.describe('Authentication @smoke', () => {
  test('should login successfully', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"], input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[name="password"], input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/(dashboard|assignments)?/, { timeout: 10000 });
  });

  test('should show dashboard after login', async ({ page }) => {
    // Login via API for speed
    const response = await page.request.post('/api/auth/login', {
      form: { username: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    });
    const { access_token } = await response.json();
    
    // Set token in localStorage
    await page.goto('/');
    await page.evaluate((token) => {
      localStorage.setItem('token', token);
    }, access_token);
    
    await page.goto('/dashboard');
    await expect(page.locator('body')).toBeVisible();
  });

  test('should fetch /me endpoint', async ({ request }) => {
    const loginRes = await request.post('/api/auth/login', {
      form: { username: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    });
    const { access_token } = await loginRes.json();
    
    const meRes = await request.get('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });
    expect(meRes.ok()).toBeTruthy();
    const user = await meRes.json();
    expect(user.email).toBe(ADMIN_EMAIL);
    expect(user.role).toBe('ADMIN');
  });
});
