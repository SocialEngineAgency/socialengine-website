# QW-2 — Content Review Refresh + Archive, Animate VO-first

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the website half of design `socialengine-api/docs/superpowers/specs/2026-09-10-quick-wins-design.md` §5 (Animate VO-first) and §6 (Content Review Refresh + Archive).

**Architecture:** Portal-only. Archive/unarchive and `vo_script` brief already live on the API (QW-B). Content Review hides `Archived` from every default bucket, adds Refresh + Archive/Restore, and re-fetches `/api/client-data` instead of toasting when a user-started regen/video job finishes. Animate adds a Voiceover / Describe segmented control above the compose textarea; VO is default and remembered per client in `localStorage`.

**Tech Stack:** `portal.html`, `animation-studio.js`, Playwright hermetic harness (`tests/e2e/helpers/portal-mock.js`). Worktree `/tmp/se-web-qw2` on `quick-wins/2-review-archive-vo` from `origin/main` (`66b8f13`).

## Global Constraints

- Do not implement in the local website checkout. Only `/tmp/se-web-qw2`.
- Archive never touches Published or `_live` social posts. Calendar delete/archive stays as-is.
- `/api/client-data` still returns archived rows — portal filters them.
- Copy is exact: Refresh; Archive; Restore; Archived; Voiceover script; Describe a video; VO placeholder `Write or paste the voiceover. We'll build the shots around it.`
- VO Send → `POST /brief { vo_script, prompt: null }`. Describe path unchanged (`prompt`).
- Last-used Animate entry mode: `localStorage['se_anim_entry:' + email]`, default `vo`.
- Remix session (`__SE_ANIM_REMIX_SESSION`) always sends via the VO path.
- Cache-bust `animation-studio.js?v=20260910-qw2`.
- TDD: failing Playwright first. No production code before RED.

---

## File map

- Create: `tests/e2e/content.spec.js`
- Create: `tests/e2e/animate.spec.js`
- Modify: `tests/e2e/helpers/portal-mock.js` — archive + animation default handlers
- Modify: `package.json` — add the two specs to `test:e2e:portal`
- Modify: `.github/workflows/ci.yml` — portal-ui comment
- Modify: `portal.html` — Refresh, Archive/Restore, hide Archived, job-complete refresh
- Modify: `animation-studio.js` — entry segmented control + `vo_script` brief
- Create: this plan

---

### Task 1: Failing Playwright specs + mock handlers

**Files:**
- Create: `tests/e2e/content.spec.js`
- Create: `tests/e2e/animate.spec.js`
- Modify: `tests/e2e/helpers/portal-mock.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `startStatic`, `mockApi`, `login`, `clientData`, `EMAIL` from `portal-mock.js`
- Produces: RED tests that require `#content-refresh`, `.studio-card__archive-btn`, `.studio-filter[data-filter="archived"]`, `.studio-card__restore-btn`, `#anim-entry-mode`, VO placeholder, and `/brief` body `{ vo_script, prompt: null }`

- [ ] **Step 1: Extend the mock so archive and animation routes are stateful**

In `mockApi`, after the `/api/onboarding/state` branch, add:

```javascript
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
    const briefMatch = url.pathname.match(/^\/api\/animation\/projects\/([^/]+)\/brief$/);
    if (briefMatch && req.method() === 'POST') {
      const b = JSON.parse(entry.body || '{}');
      const rewritten = 'optimized ' + String(b.vo_script || b.prompt || 'brief');
      return json(200, { project: { id: briefMatch[1], status: 'brief_ready', user_prompt: b.prompt || '', vo_script: b.vo_script || '', agent_brief: { rewritten_prompt: rewritten } } });
    }
```

`clientData` already accepts `content` via `...rest`.

- [ ] **Step 2: Write `tests/e2e/content.spec.js`**

```javascript
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const POSTS = [
  { id: 'recPending1', status: 'Ready for Review', platform: 'instagram', full_post_text: 'Pending caption for review' },
  { id: 'recPub1', status: 'Published', platform: 'instagram', full_post_text: 'Already live on Instagram' },
  { id: 'recArch1', status: 'Archived', archived_from: 'Ready for Review', platform: 'instagram', full_post_text: 'Old archived draft' },
];

async function openContent(page, extra = {}) {
  const data = clientData({ content: POSTS.map((p) => ({ ...p })), ...extra });
  const calls = await mockApi(page, srv.base, { data });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="content"]');
  await expect(page.locator('#dash-content h2').first()).toHaveText(/Content Review/);
  return { data, calls };
}

test('Archived is hidden from All; Archived filter + Restore returns it', async ({ page }) => {
  await openContent(page);
  await expect(page.locator('.studio-card[data-post-id="recPending1"]')).toBeVisible();
  await expect(page.locator('.studio-card[data-post-id="recArch1"]')).toHaveCount(0);
  await expect(page.locator('#studio-count-all')).toHaveText('2');
  await page.click('.studio-filter[data-filter="archived"]');
  await expect(page.locator('.studio-card[data-post-id="recArch1"]')).toBeVisible();
  await expect(page.locator('.studio-card[data-post-id="recPending1"]')).toHaveCount(0);
  await page.click('.studio-card[data-post-id="recArch1"] .studio-card__restore-btn');
  await expect(page.locator('.studio-card[data-post-id="recArch1"]')).toHaveCount(0);
  await page.click('.studio-filter[data-filter="all"]');
  await expect(page.locator('.studio-card[data-post-id="recArch1"]')).toBeVisible();
});

test('Archive on a non-Published card removes it from All and shows it under Archived', async ({ page }) => {
  const { calls } = await openContent(page);
  await expect(page.locator('.studio-card[data-post-id="recPub1"] .studio-card__archive-btn')).toHaveCount(0);
  await page.click('.studio-card[data-post-id="recPending1"] .studio-card__archive-btn');
  await expect(page.locator('.studio-card[data-post-id="recPending1"]')).toHaveCount(0);
  const archived = calls.filter((c) => c.path === '/api/archive-post');
  expect(archived).toHaveLength(1);
  expect(JSON.parse(archived[0].body).postId).toBe('recPending1');
  await page.click('.studio-filter[data-filter="archived"]');
  await expect(page.locator('.studio-card[data-post-id="recPending1"]')).toBeVisible();
  await expect(page.locator('.studio-card[data-post-id="recPending1"] .studio-card__restore-btn')).toBeVisible();
});

test('Refresh re-fetches client-data, keeps the active filter, and is disabled in flight', async ({ page }) => {
  const data = clientData({ content: POSTS.map((p) => ({ ...p })) });
  let clientDataHits = 0;
  await mockApi(page, srv.base, {
    data,
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/client-data') {
        clientDataHits += 1;
        if (clientDataHits > 1) {
          data.content = [...data.content, { id: 'recNew1', status: 'Ready for Review', platform: 'instagram', full_post_text: 'Just generated' }];
        }
        json(200, data);
        return 'handled';
      }
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="content"]');
  await page.click('.studio-filter[data-filter="pending"]');
  await expect(page.locator('.studio-filter[data-filter="pending"]')).toHaveClass(/active/);
  const btn = page.locator('#content-refresh');
  await expect(btn).toBeEnabled();
  await btn.click();
  await expect(page.locator('.studio-card[data-post-id="recNew1"]')).toBeVisible();
  await expect(page.locator('.studio-filter[data-filter="pending"]')).toHaveClass(/active/);
  await expect(page.locator('.studio-card[data-post-id="recArch1"]')).toHaveCount(0);
});
```

- [ ] **Step 3: Write `tests/e2e/animate.spec.js`**

```javascript
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, EMAIL } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

async function openAnimate(page) {
  const calls = await mockApi(page, srv.base, { data: clientData() });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('#create-segments [data-segment="animation-studio"]');
  await expect(page.locator('#dash-content .anim-shell')).toBeVisible({ timeout: 15000 });
  return calls;
}

test('VO is the default entry; Send posts vo_script with prompt null', async ({ page }) => {
  const calls = await openAnimate(page);
  const vo = page.locator('#anim-entry-mode [data-entry="vo"]');
  const desc = page.locator('#anim-entry-mode [data-entry="prompt"]');
  await expect(vo).toHaveClass(/active/);
  await expect(page.locator('#anim-prompt')).toHaveAttribute('placeholder', "Write or paste the voiceover. We'll build the shots around it.");
  await page.fill('#anim-prompt', 'Warm hello. This week only, twenty percent off the silk set.');
  await page.click('#anim-send');
  await expect.poll(() => calls.some((c) => c.path.includes('/brief'))).toBeTruthy();
  const brief = calls.find((c) => c.path.endsWith('/brief'));
  const body = JSON.parse(brief.body);
  expect(body.vo_script).toMatch(/Warm hello/);
  expect(body.prompt).toBeNull();
});

test('Describe a video keeps the old prompt path and is remembered per client', async ({ page }) => {
  const calls = await openAnimate(page);
  await page.click('#anim-entry-mode [data-entry="prompt"]');
  await expect(page.locator('#anim-prompt')).toHaveAttribute('placeholder', /Describe a character/);
  expect(await page.evaluate((email) => localStorage.getItem('se_anim_entry:' + email), EMAIL)).toBe('prompt');
  await page.fill('#anim-prompt', 'A woman walks through a sunlit loft holding the silk robe.');
  await page.click('#anim-send');
  await expect.poll(() => calls.some((c) => c.path.includes('/brief'))).toBeTruthy();
  const body = JSON.parse(calls.find((c) => c.path.endsWith('/brief')).body);
  expect(body.prompt).toMatch(/sunlit loft/);
  expect(body.vo_script).toBeFalsy();

  await page.click('.dash-nav-item[data-nav="dashboard"]');
  await page.click('.dash-nav-item[data-nav="create"]');
  await expect(page.locator('#create-segments [data-segment="animation-studio"]')).toHaveClass(/active/);
  await expect(page.locator('#anim-entry-mode [data-entry="prompt"]')).toHaveClass(/active/);
});

test('remix session sends via the VO path', async ({ page }) => {
  const calls = await mockApi(page, srv.base, { data: clientData() });
  await login(page, srv.base);
  await page.evaluate(() => {
    window.__SE_ANIM_REMIX_SESSION = {
      referenceUrl: 'https://cdn.example.com/still.jpg',
      prompt: 'Hook: the silk set you keep meaning to try.',
      target_seconds: 24,
      format_template_id: 'remix-24s',
    };
  });
  await page.evaluate(() => window.switchNav('animation-studio'));
  await expect(page.locator('#dash-content .anim-shell')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => calls.some((c) => c.path.includes('/brief'))).toBeTruthy();
  const body = JSON.parse(calls.find((c) => c.path.endsWith('/brief')).body);
  expect(body.vo_script).toMatch(/silk set/);
  expect(body.prompt).toBeNull();
});
```

- [ ] **Step 4: Point CI at the new specs**

`package.json` script `test:e2e:portal`:

```
playwright test tests/e2e/nav.spec.js tests/e2e/coach.spec.js tests/e2e/errors.spec.js tests/e2e/content.spec.js tests/e2e/animate.spec.js
```

- [ ] **Step 5: Run the new specs and confirm they fail for missing UI, not harness bugs**

```
cd /tmp/se-web-qw2 && npx playwright test tests/e2e/content.spec.js tests/e2e/animate.spec.js
```

Expected: FAIL — `#content-refresh` / `.studio-card__archive-btn` / `#anim-entry-mode` not found. If they fail on login or Animate mount, fix the mock first and re-run until the failure is the missing product.

- [ ] **Step 6: Commit the RED tests**

```
git add tests/e2e/content.spec.js tests/e2e/animate.spec.js tests/e2e/helpers/portal-mock.js package.json docs/superpowers/plans/2026-09-10-qw-2-review-archive-vo.md
git commit -m "test: QW-2 failing specs for Content Review archive and Animate VO-first"
```

---

### Task 2: Content Review Refresh + Archive

**Files:**
- Modify: `portal.html` — helpers near `renderContentPage` (~7248), cards (~5212), list (~5339), modal (~3876 / 4070), `startRegenPoll` (~5542), `updateGenComplete` (~7169), video-regen complete (~5785), `studioFilterByType` (~12765), `switchStudioView` (~7460)

**Interfaces:**
- Consumes: `POST /api/archive-post { postId }`, `POST /api/unarchive-post { postId }` → `{ success, post: { id, status, archived_from, archived_at } }`
- Produces: `window.refreshContentReview()`, `window.studioArchive(postId, btn)`, `window.studioRestore(postId, btn)`, `window._studioFilter`

- [ ] **Step 1: Shared helpers (place just above `renderContentPage`)**

```javascript
    function isArchivedPost(p) {
      return /^archived$/i.test(String(p?.status || ''));
    }
    function isLivePublishedPost(p) {
      return !!p?._live || /^published$/i.test(String(p?.status || ''));
    }
    function liveContentPosts(posts) {
      return (posts || []).filter((p) => !isArchivedPost(p));
    }
    function applyStudioStatusFilter(f, posts) {
      const all = posts || [];
      if (f === 'archived') return all.filter(isArchivedPost);
      const live = liveContentPosts(all);
      if (f === 'pending') return live.filter((p) => ['Pending','Draft','Ready for Review','Regenerating','Generating','QA Failed'].includes(p.status));
      if (f === 'approved') return live.filter((p) => p.status === 'Approved' || p.status === 'Scheduled');
      if (f === 'published') return live.filter((p) => isLivePublishedPost(p));
      if (f === 'video') return live.filter((p) => (p.content_type || '').includes('reel') || (p.post_label || '').includes('reel') || p.video_url || p._live);
      if (f === 'rejected') return live.filter((p) => p.status === 'Rejected');
      return live;
    }
```

`renderContentPage` must:
- Compute buckets from `liveContentPosts(posts)` (pending/approved/published/videos/rejected) and `archived = posts.filter(isArchivedPost)`.
- Header right: Refresh button before Create Video:

```html
<button type="button" id="content-refresh" class="studio-view-btn" style="display:flex;align-items:center;gap:6px;padding:6px 12px;">
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
  Refresh
</button>
```

- Always render `<button class="studio-filter" data-filter="archived">Archived <span class="studio-filter__count">${archived.length}</span></button>`.
- `#studio-count-all` = live length, not `posts.length`.
- After painting, restore `window._studioFilter` onto the matching `.studio-filter` and render `applyStudioStatusFilter`.
- Click handler sets `window._studioFilter = f` then renders through `applyStudioStatusFilter`.
- Wire `#content-refresh` → `refreshContentReview()`.

```javascript
    window.refreshContentReview = async function refreshContentReview() {
      const btn = document.getElementById('content-refresh');
      if (btn?.disabled) return;
      if (btn) btn.disabled = true;
      const scroller = document.getElementById('dash-content');
      const y = scroller ? scroller.scrollTop : 0;
      const keep = window._studioFilter || 'all';
      try {
        const res = await apiFetch(`${API}/api/client-data`, { headers: authHeaders() });
        if (!res.ok) { showToast('Could not refresh. Try again.'); return; }
        clientData = await res.json();
        if (activeNav === 'content') {
          renderContentPage(clientData);
          if (scroller) scroller.scrollTop = y;
        }
      } catch {
        showToast('Could not refresh. Try again.');
      } finally {
        const b = document.getElementById('content-refresh');
        if (b) b.disabled = false;
      }
    };
```

`renderContentPage` must re-apply `keep` via `_studioFilter` so Refresh does not need a second `.click()`.

- [ ] **Step 2: Archive / Restore actions**

```javascript
    window.studioArchive = async function(postId, btn) {
      if (btn) btn.disabled = true;
      try {
        const res = await apiFetch(`${API}/api/archive-post`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ postId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showToast(data.error || 'Could not archive', 'error', data.request_id); return; }
        const post = (clientData?.content || []).find((p) => p.id === postId);
        if (post) {
          post.archived_from = data.post?.archived_from || post.status;
          post.status = 'Archived';
          post.archived_at = data.post?.archived_at || new Date().toISOString();
        }
        if (document.getElementById('studio-modal')?.classList.contains('active')) closeStudioModal();
        if (activeNav === 'content') renderContentPage(clientData);
      } catch {
        showToast('Could not archive', 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    };
    window.studioRestore = async function(postId, btn) {
      if (btn) btn.disabled = true;
      try {
        const res = await apiFetch(`${API}/api/unarchive-post`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ postId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showToast(data.error || 'Could not restore', 'error', data.request_id); return; }
        const post = (clientData?.content || []).find((p) => p.id === postId);
        if (post) {
          post.status = data.post?.status || post.archived_from || 'Ready for Review';
          post.archived_from = '';
          post.archived_at = '';
        }
        if (document.getElementById('studio-modal')?.classList.contains('active')) closeStudioModal();
        if (activeNav === 'content') renderContentPage(clientData);
      } catch {
        showToast('Could not restore', 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    };
```

Cards (`renderStudioCard` / `renderStudioListItem`):
- Add `data-post-id="${post.id}"`.
- If `isArchivedPost(post)`: show Restore (`studio-card__restore-btn`).
- Else if `!isLivePublishedPost(post)`: show Archive (`studio-card__archive-btn`) on pending, approved, rejected, regenerating, and in the modal. Replace the modal's Content Review "Delete post" (`_deleteCalPost`) with Archive. Calendar keep `_deleteCalPost`.
- Published / `_live`: no Archive.

- [ ] **Step 3: Job-complete refresh instead of toast**

In `startRegenPoll`, when status leaves `Regenerating`: clear the timer, assign `clientData = freshData`, call `refreshContentReview` path (or `renderContentPage` if already holding fresh data). **Do not** toast `Regeneration complete`. Timeout toast may stay.

In video-regen complete (~5785) and `updateGenComplete` (~7191): keep in-place player swap; drop the "ready" toast; if `activeNav === 'content'` re-render from a fresh `/api/client-data` via `refreshContentReview()`.

- [ ] **Step 4: Hide archived in the other Content filters**

`switchStudioView` and `studioFilterByType` must run through `applyStudioStatusFilter` / `liveContentPosts` so type/group/view switches cannot surface Archived unless `_studioFilter === 'archived'`.

- [ ] **Step 5: Run content spec**

```
npx playwright test tests/e2e/content.spec.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```
git add portal.html
git commit -m "feat: Content Review Refresh, Archive, and Restore"
```

---

### Task 3: Animate VO-first

**Files:**
- Modify: `animation-studio.js` — compose markup (~2538), `sendPrompt` (~1615), `applyAnimRemixSessionIfAny` (~2255), `goHome` (~2228)
- Modify: `portal.html` — `<script src="./animation-studio.js?v=20260910-qw2">`

**Interfaces:**
- Consumes: QW-B `POST /brief` accepting `{ vo_script, prompt: null }`
- Produces: `#anim-entry-mode` with `[data-entry="vo"|"prompt"]`; `localStorage['se_anim_entry:' + email]`

- [ ] **Step 1: Entry mode helpers + markup**

```javascript
  function animEntryKey() {
    const email = String(window.__clientEmail || window.clientEmail || '').trim().toLowerCase();
    return 'se_anim_entry:' + (email || 'anon');
  }
  function readAnimEntry() {
    try { return localStorage.getItem(animEntryKey()) === 'prompt' ? 'prompt' : 'vo'; }
    catch { return 'vo'; }
  }
  function writeAnimEntry(mode) {
    try { localStorage.setItem(animEntryKey(), mode === 'prompt' ? 'prompt' : 'vo'); } catch (_) {}
  }
  function applyAnimEntryUI(mode) {
    const vo = mode !== 'prompt';
    document.querySelectorAll('#anim-entry-mode [data-entry]').forEach((b) => {
      const on = b.dataset.entry === (vo ? 'vo' : 'prompt');
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const ta = document.getElementById('anim-prompt');
    if (ta) ta.placeholder = vo
      ? "Write or paste the voiceover. We'll build the shots around it."
      : 'Describe a character, scene, product, or full video idea…';
  }
```

Insert above the textarea:

```html
<div id="anim-entry-mode" class="anim-entry-mode" role="tablist" aria-label="Animate input">
  <button type="button" class="anim-entry-seg active" role="tab" data-entry="vo" aria-selected="true">Voiceover script</button>
  <button type="button" class="anim-entry-seg" role="tab" data-entry="prompt" aria-selected="false">Describe a video</button>
</div>
<textarea id="anim-prompt" class="anim-prompt" placeholder="Write or paste the voiceover. We'll build the shots around it."></textarea>
```

CSS (in the existing `<style>` block):

```css
.anim-entry-mode { display:flex; gap:6px; margin:0 0 8px; }
.anim-entry-seg { flex:1; padding:7px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.1); background:transparent; color:rgba(255,255,255,0.55); font-size:0.72rem; font-weight:600; cursor:pointer; font-family:inherit; }
.anim-entry-seg.active { background:rgba(124,58,237,0.2); border-color:rgba(124,58,237,0.45); color:#E9D5FF; }
```

After mount: `applyAnimEntryUI(readAnimEntry())` and click listeners that `writeAnimEntry` + `applyAnimEntryUI`.

- [ ] **Step 2: `sendPrompt` respects the segment**

```javascript
    const entry = document.querySelector('#anim-entry-mode [data-entry].active')?.dataset.entry || readAnimEntry();
    const text = (ta?.value || '').trim();
    if (!text) return toast(entry === 'vo' ? 'Enter a voiceover script' : 'Enter a prompt', 'error');
    // ...ensureProject, refs check unchanged...
    const briefBody = {
      mode, look, references,
      reference_urls: references.map((r) => r.url),
      character_ref_url: references.find((r) => r.role === 'character')?.url || null,
      force_rewrite: true,
      format_template_id: _pendingFormatTemplateId || undefined,
    };
    if (entry === 'vo') { briefBody.vo_script = text; briefBody.prompt = null; }
    else { briefBody.prompt = text; }
```

- [ ] **Step 3: Remix always VO**

At the top of `applyAnimRemixSessionIfAny`, `writeAnimEntry('vo'); applyAnimEntryUI('vo');` then fill the textarea and `sendPrompt()`.

`goHome` / `newProject` must not reset the remembered segment.

- [ ] **Step 4: Cache-bust**

`portal.html` line 15: `animation-studio.js?v=20260910-qw2`.

- [ ] **Step 5: Run animate + content + existing portal specs**

```
npx playwright test tests/e2e/animate.spec.js tests/e2e/content.spec.js
npm run test:e2e:portal
npm run test:e2e:sessions
npm test
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```
git add animation-studio.js portal.html
git commit -m "feat: Animate VO-first entry remembered per client"
```

---

### Task 4: PR, CI, squash-merge

- [ ] Push `quick-wins/2-review-archive-vo` and open a PR against `main`.
- [ ] Wait for `smoke`, `portal-sessions`, `portal-ui`.
- [ ] Squash-merge `--delete-branch`.
- [ ] Prod check: `https://socialengine.agency/portal.html` — Content Review shows Refresh; Animate shows Voiceover script (login required for the live path; hermetic e2e is the contract).

---

## Self-review

1. Spec coverage: §6 Refresh + Archive + hide Archived + Restore + job-complete refresh = Task 2. §5 VO default + Describe path + per-client memory + remix via script = Task 3. Playwright archive round-trip + VO brief body = Task 1.
2. No placeholders.
3. Names: `_studioFilter`, `refreshContentReview`, `studioArchive`, `studioRestore`, `se_anim_entry:` + email, `data-entry=vo|prompt`.
