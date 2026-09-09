// Portal session handling (Phase 1.1 PR E), against a mocked API.
//
// Serves ./portal.html from a tiny static server with the API constant pointed
// at a fake origin that page.route() answers. Asserts the contract the portal
// has with the API:
//   - login is POST /api/auth/login { email, password } — no client-side hashing
//   - every authenticated call carries Authorization: Bearer <token>, never
//     x-client-hash / clientHash
//   - the token is persisted under se_session; legacy se_saved_hash keys are gone
//   - reload auto-logs-in from the stored token
//   - logout POSTs /api/auth/logout and clears storage
//   - a { error: 'Unauthorized' } 401 mid-session returns to the login screen
//   - OAuth connect goes through /api/auth/oauth-start; no credential in the URL
//
// Run: npx playwright test tests/e2e/sessions.spec.js
'use strict';
const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const FAKE_API = 'https://api.sessions.test';
const PROD_API = 'https://socialengine-api-production-18e0.up.railway.app';
const TOKEN = 'ses_dGVzdA.c2ln';
const TOKEN2 = 'ses_dGVzdDI.c2lnMg';
const EMAIL = 'owner@example.com';
const PASSWORD = 'Correct-Horse-2026!';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

let server;
let base;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel === '/') rel = '/portal.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    let body = fs.readFileSync(file);
    if (rel === '/portal.html') body = Buffer.from(body.toString('utf8').split(PROD_API).join(FAKE_API));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

const clientData = (over = {}) => ({
  email: EMAIL,
  client: { contact_email: EMAIL, business_name: 'Owner Co', contact_name: 'Owner', tier: 'growth', is_paid: true, must_change_password: false, ...over },
  posts: [],
  stats: {},
});

// Mock API. Records every request so tests can assert on headers/bodies.
// Anything that is not the local static server or the fake API is aborted, so
// the headless browser never reaches the network (CDN scripts, fonts, …).
// Routes are registered on the context so OAuth popups are covered too.
async function mockApi(page, { sessionValid = () => true, onRequest } = {}) {
  const calls = [];
  const ctx = page.context();
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base) || u.startsWith(FAKE_API) || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:')) return route.fallback();
    return route.abort('blockedbyclient');
  });
  await ctx.route(`${FAKE_API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const entry = { method: req.method(), path: url.pathname, headers: req.headers(), body: req.postData() };
    calls.push(entry);
    if (onRequest) { const r = await onRequest(entry, route); if (r === 'handled') return; }
    const auth = entry.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });

    if (url.pathname === '/api/auth/login') {
      const b = JSON.parse(entry.body || '{}');
      if (b.email === EMAIL && b.password === PASSWORD) return json(200, { token: TOKEN, expires_at: new Date(Date.now() + 86400e3).toISOString(), must_change_password: false, email: EMAIL, client: clientData().client });
      return json(401, { error: 'Invalid email or password' });
    }
    if (url.pathname === '/api/auth/logout') return token ? route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }) : json(401, { error: 'Unauthorized' });
    if (url.pathname === '/api/auth/oauth-start') {
      if (!token || !sessionValid(token)) return json(401, { error: 'Unauthorized' });
      const b = JSON.parse(entry.body || '{}');
      return json(200, { url: `${FAKE_API}/api/auth/${b.platform}?start=nonce123${b.engage ? '&engage=1' : ''}`, expires_in: 60 });
    }
    if (url.pathname.startsWith('/api/auth/') && !url.pathname.startsWith('/api/auth/session')) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>oauth starter</body></html>' });
    }

    // Everything else needs a valid session.
    if (!token || !sessionValid(token)) return json(401, { error: 'Unauthorized' });
    if (url.pathname === '/api/client-data') return json(200, clientData());
    if (url.pathname === '/api/auth/session') return json(200, { ok: true, client: clientData().client, expires_at: new Date(Date.now() + 86400e3).toISOString(), legacy_credential: false });
    if (url.pathname === '/api/models') return json(200, { models: [], count: {}, requested_tier: 'growth', source: 'authenticated' });
    return json(200, { success: true, items: [], posts: [], data: [], models: [], accounts: [], products: [], threads: [], features: [] });
  });
  return calls;
}

async function login(page) {
  await page.goto(`${base}/portal.html`);
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', PASSWORD);
  await page.click('#login-btn');
  await expect(page.locator('#dashboard-view')).toHaveClass(/active/, { timeout: 15000 });
}

test('login posts the password to /api/auth/login and only ever sends a Bearer token afterwards', async ({ page }) => {
  const calls = await mockApi(page);
  await login(page);

  const loginCall = calls.find((c) => c.path === '/api/auth/login');
  expect(loginCall).toBeTruthy();
  expect(JSON.parse(loginCall.body)).toEqual({ email: EMAIL, password: PASSWORD });

  // Give the dashboard a moment to fire its follow-up requests.
  await page.waitForTimeout(1500);
  const authed = calls.filter((c) => c.path !== '/api/auth/login' && c.method !== 'OPTIONS');
  expect(authed.length).toBeGreaterThan(0);
  for (const c of authed) {
    expect(c.headers.authorization, `${c.method} ${c.path}`).toBe(`Bearer ${TOKEN}`);
    expect(c.headers['x-client-hash'], `${c.method} ${c.path}`).toBeUndefined();
    if (c.body) expect(c.body, `${c.method} ${c.path} body`).not.toMatch(/clientHash|client_hash|"hash"/);
  }
  // No magic-login, no hash anywhere on the wire.
  expect(calls.some((c) => c.path === '/api/magic-login')).toBe(false);

  const storage = await page.evaluate(() => ({ ...localStorage }));
  expect(storage.se_session).toBe(TOKEN);
  expect(storage.se_saved_email).toBe(EMAIL);
  expect(storage.se_saved_hash).toBeUndefined();
  expect(storage.se_hash).toBeUndefined();
  // Nothing hash-like exposed on window for out-of-closure scripts.
  const exposed = await page.evaluate(() => ({ h1: window.__clientHash, h2: window.clientHash, h3: window._seHash, hasSeApi: typeof window.seApi?.headers === 'function' }));
  expect(exposed).toEqual({ h1: undefined, h2: undefined, h3: undefined, hasSeApi: true });
  expect(await page.evaluate(() => window.seApi.headers())).toEqual({ Authorization: `Bearer ${TOKEN}` });
});

test('wrong password shows the generic error and stores nothing', async ({ page }) => {
  await mockApi(page);
  await page.goto(`${base}/portal.html`);
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', 'nope');
  await page.click('#login-btn');
  await expect(page.locator('#login-error')).toHaveClass(/visible/);
  await expect(page.locator('#login-error')).toContainText('Invalid credentials');
  expect(await page.evaluate(() => localStorage.getItem('se_session'))).toBeNull();
});

test('reload auto-logs-in from the stored token; a stale legacy hash is discarded', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto(`${base}/portal.html`);
  await page.evaluate(([t, e]) => {
    localStorage.setItem('se_session', t);
    localStorage.setItem('se_saved_email', e);
    localStorage.setItem('se_saved_hash', 'deadbeef'.repeat(8));
    sessionStorage.setItem('se_hash', 'deadbeef'.repeat(8));
  }, [TOKEN, EMAIL]);
  await page.reload();
  await expect(page.locator('#dashboard-view')).toHaveClass(/active/, { timeout: 15000 });
  expect(calls.some((c) => c.path === '/api/auth/login')).toBe(false);
  const cd = calls.find((c) => c.path === '/api/client-data');
  expect(cd.headers.authorization).toBe(`Bearer ${TOKEN}`);
  const storage = await page.evaluate(() => ({ ls: { ...localStorage }, ss: { ...sessionStorage } }));
  expect(storage.ls.se_saved_hash).toBeUndefined();
  expect(storage.ss.se_hash).toBeUndefined();
});

test('logout revokes server side and clears the stored session', async ({ page }) => {
  const calls = await mockApi(page);
  await login(page);
  // The first-login onboarding overlay may cover the sidebar; click the button directly.
  await page.evaluate(() => document.getElementById('dash-logout').click());
  await expect(page.locator('#portal-login-view')).not.toHaveClass(/hidden/);
  await expect.poll(() => calls.some((c) => c.path === '/api/auth/logout' && c.method === 'POST')).toBe(true);
  const lo = calls.find((c) => c.path === '/api/auth/logout');
  expect(lo.headers.authorization).toBe(`Bearer ${TOKEN}`);
  expect(await page.evaluate(() => localStorage.getItem('se_session'))).toBeNull();
});

test('a revoked session (401 Unauthorized) drops the user back to the login screen', async ({ page }) => {
  let valid = true;
  await mockApi(page, { sessionValid: () => valid });
  await login(page);
  valid = false;
  // Trigger an authenticated call through the portal's apiFetch.
  await page.evaluate(() => window.apiFetch('/api/client-data'));
  await expect(page.locator('#portal-login-view')).not.toHaveClass(/hidden/, { timeout: 10000 });
  await expect(page.locator('#dashboard-view')).not.toHaveClass(/active/);
  expect(await page.evaluate(() => localStorage.getItem('se_session'))).toBeNull();
});

test('password change adopts the new token from the response', async ({ page }) => {
  const calls = await mockApi(page, {
    onRequest: async (entry, route) => {
      if (entry.path === '/api/change-password') {
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ success: true, token: TOKEN2, expires_at: new Date(Date.now() + 86400e3).toISOString() }) });
        return 'handled';
      }
    },
  });
  await login(page);
  // Drive the settings handler directly; the UI path is exercised by the golden-path suite.
  await page.evaluate(() => {
    const ensure = (id) => { let el = document.getElementById(id); if (!el) { el = document.createElement('input'); el.id = id; document.body.appendChild(el); } return el; };
    ensure('settings-current-pw').value = 'Correct-Horse-2026!';
    ensure('settings-new-pw').value = 'Even-Better-2027!';
    ensure('settings-confirm-pw').value = 'Even-Better-2027!';
    ensure('pw-change-status');
  });
  await page.evaluate(() => window.changePassword ? window.changePassword() : (typeof changePassword === 'function' && changePassword()));
  await expect.poll(() => calls.some((c) => c.path === '/api/change-password')).toBe(true);
  const cp = calls.find((c) => c.path === '/api/change-password');
  expect(cp.headers.authorization).toBe(`Bearer ${TOKEN}`);
  expect(JSON.parse(cp.body)).toEqual({ current_password: 'Correct-Horse-2026!', new_password: 'Even-Better-2027!' });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('se_session'))).toBe(TOKEN2);
  expect(await page.evaluate(() => window.seApi.headers())).toEqual({ Authorization: `Bearer ${TOKEN2}` });
});

test('OAuth connect asks /api/auth/oauth-start and opens a URL without credentials', async ({ page, context }) => {
  const calls = await mockApi(page);
  await login(page);
  const popupPromise = context.waitForEvent('page');
  await page.evaluate(() => window.seApi.startOAuth('facebook', { engage: true }));
  const popup = await popupPromise;
  // Opened on about:blank synchronously, then pointed at the nonce URL once oauth-start answers.
  await popup.waitForURL(/\/api\/auth\/facebook/, { timeout: 10000 });
  const start = calls.find((c) => c.path === '/api/auth/oauth-start');
  expect(start.headers.authorization).toBe(`Bearer ${TOKEN}`);
  expect(JSON.parse(start.body)).toMatchObject({ platform: 'facebook', engage: true });
  const url = popup.url();
  expect(url).toContain('/api/auth/facebook?start=nonce123');
  expect(url).not.toContain(TOKEN);
  expect(url).not.toMatch(/client_hash|client_email/);
  await popup.close();
});
