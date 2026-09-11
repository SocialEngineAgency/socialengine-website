// Shared harness for hermetic portal specs: serves the repo over a local static
// server with the production API origin rewritten to a fake host, and mocks that
// host on the browser context. Every other request is aborted so nothing reaches
// the network (fonts, CDN scripts, analytics).
//
// Usage:
//   const { startStatic, mockApi, login, clientData } = require('./helpers/portal-mock');
//   let srv; test.beforeAll(async () => { srv = await startStatic(); });
//   test.afterAll(() => srv.close());
//   const calls = await mockApi(page, srv.base, { data: clientData({ capabilities: {...} }) });
//   await login(page, srv.base);
const { expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const FAKE_API = 'https://api.portal.test';
const PROD_API = 'https://socialengine-api-production-18e0.up.railway.app';
const TOKEN = 'ses_dGVzdA.c2ln';
const EMAIL = 'owner@example.com';
const PASSWORD = 'Correct-Horse-2026!';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

async function startStatic() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel === '/') rel = '/portal.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    let body = fs.readFileSync(file);
    if (/\.(html|js)$/.test(rel)) body = Buffer.from(body.toString('utf8').split(PROD_API).join(FAKE_API));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}

const COMMERCE_CAPS = { type: 'commerce', commerce: 'shopify', charity: false, fundraise: false, video_credits: 4, features: { ads: true, intel: true, inbox: true, video: true, brand_voice: true, coach: true } };
const CHARITY_CAPS = { type: 'charity', commerce: 'none', charity: true, fundraise: true, video_credits: 4, features: { ads: true, intel: true, inbox: true, video: true, brand_voice: true, coach: true } };

function clientData({ client = {}, capabilities = COMMERCE_CAPS, ...rest } = {}) {
  const base = { contact_email: EMAIL, business_name: 'Owner Co', contact_name: 'Owner', tier: 'growth', is_paid: true, must_change_password: false, video_credits: 4 };
  if (capabilities.commerce === 'shopify') base.shopify_domain = 'owner-co.myshopify.com';
  if (capabilities.charity) { base.client_type = 'charity'; base.charity_mission = 'Ending hunger'; }
  return { email: EMAIL, client: { ...base, ...client }, capabilities, posts: [], content: [], stats: {}, brand_voice: null, profile: null, ...rest };
}

function cors(extra = {}) {
  return { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', ...extra };
}

// Mock API. `data` is the /api/client-data payload. `onRequest(entry, route, json)`
// may fulfil a request itself and return 'handled'.
async function mockApi(page, base, { data = clientData(), onRequest } = {}) {
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
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: cors(), body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors() });
    if (onRequest) { const r = await onRequest(entry, route, json); if (r === 'handled') return; }
    const auth = entry.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

    if (url.pathname === '/api/auth/login') {
      const b = JSON.parse(entry.body || '{}');
      if (b.email === EMAIL && b.password === PASSWORD) return json(200, { token: TOKEN, expires_at: new Date(Date.now() + 86400e3).toISOString(), must_change_password: false, email: EMAIL, client: data.client });
      return json(401, { error: 'Invalid email or password' });
    }
    if (url.pathname === '/api/auth/logout') return route.fulfill({ status: 204, headers: cors() });
    if (url.pathname.startsWith('/api/auth/') && !url.pathname.startsWith('/api/auth/session')) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>oauth starter</body></html>' });
    }
    if (!token) return json(401, { error: 'Unauthorized' });
    if (url.pathname === '/api/client-data') return json(200, data);
    if (url.pathname === '/api/auth/session') return json(200, { ok: true, client: data.client, expires_at: new Date(Date.now() + 86400e3).toISOString(), legacy_credential: false });
    if (url.pathname === '/api/models') return json(200, { models: [], count: {}, requested_tier: 'growth', source: 'authenticated' });
    if (url.pathname === '/api/onboarding/state') return json(200, { completed: true, step: 5 });
    if (url.pathname === '/api/archive-post') {
      const b = JSON.parse(entry.body || '{}');
      const post = (data.content || []).find((p) => p.id === b.postId);
      if (!post) return json(404, { error: 'Post not found', code: 'NOT_FOUND' });
      if (/^published$/i.test(String(post.status || '')) || post._live) {
        return json(409, { error: 'Published posts are removed from the calendar, not archived.', code: 'PUBLISHED' });
      }
      const from = post.status;
      post.archived_from = from;
      post.status = 'Archived';
      post.archived_at = new Date().toISOString();
      return json(200, { success: true, post: { id: post.id, status: 'Archived', archived_from: from, archived_at: post.archived_at } });
    }
    if (url.pathname === '/api/unarchive-post') {
      const b = JSON.parse(entry.body || '{}');
      const post = (data.content || []).find((p) => p.id === b.postId);
      if (!post) return json(404, { error: 'Post not found', code: 'NOT_FOUND' });
      if (String(post.status || '') !== 'Archived') return json(409, { error: "That post isn't archived.", code: 'NOT_ARCHIVED' });
      const back = String(post.archived_from || '').trim() || 'Ready for Review';
      post.status = back;
      post.archived_from = '';
      post.archived_at = '';
      return json(200, { success: true, post: { id: post.id, status: back, archived_from: '', archived_at: '' } });
    }
    if (url.pathname === '/api/animation/meta') {
      return json(200, { modes: [{ id: 'video', label: 'Video' }], looks: [{ id: 'stylized', label: 'Stylized' }], providers: {}, default_motion_mode: 'auto', default_i2v_model: 'seedance' });
    }
    if (url.pathname === '/api/animation/projects' && req.method() === 'POST') {
      return json(200, { project: { id: 'proj_test', status: 'draft', mode: 'video', look: 'stylized' } });
    }
    if (url.pathname === '/api/animation/projects' && req.method() === 'GET') {
      return json(200, { projects: [], purged: 0 });
    }
    const settingsMatch = url.pathname.match(/^\/api\/animation\/projects\/([^/]+)\/settings$/);
    if (settingsMatch && req.method() === 'POST') {
      return json(200, { project: { id: settingsMatch[1], status: 'draft', mode: 'video', look: 'stylized' } });
    }
    const briefMatch = url.pathname.match(/^\/api\/animation\/projects\/([^/]+)\/brief$/);
    if (briefMatch && req.method() === 'POST') {
      const b = JSON.parse(entry.body || '{}');
      const rewritten = 'optimized ' + String(b.vo_script || b.prompt || 'brief');
      return json(200, { project: { id: briefMatch[1], status: 'brief_ready', user_prompt: b.prompt || '', vo_script: b.vo_script || '', agent_brief: { rewritten_prompt: rewritten } } });
    }
    return json(200, { success: true, items: [], posts: [], data: [], models: [], accounts: [], products: [], threads: [], features: [], projects: [], total: 0, messages: [], history: [] });
  });
  return calls;
}

async function login(page, base) {
  await page.goto(`${base}/portal.html`);
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', PASSWORD);
  await page.click('#login-btn');
  await expect(page.locator('#dashboard-view')).toHaveClass(/active/, { timeout: 15000 });
  await expect(page.locator('#dash-user-email')).toHaveText(EMAIL, { timeout: 15000 });
}

// Collects console errors + uncaught exceptions. Call before login.
function watchErrors(page, ignore = [/favicon/i, /blockedbyclient/i, /net::ERR_/i, /Failed to load resource/i]) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !ignore.some((re) => re.test(m.text()))) errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

module.exports = { startStatic, mockApi, login, clientData, watchErrors, FAKE_API, PROD_API, TOKEN, EMAIL, PASSWORD, COMMERCE_CAPS, CHARITY_CAPS };
