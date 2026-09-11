# QW-1 — Nav restructure, Settings tabs, Coach layout, error surfaces, capability gating (portal)

Implements design `socialengine-api/docs/superpowers/specs/2026-09-10-quick-wins-design.md` §1 (portal half), §2 (portal half), §3, §4 with the approved defaults (labels Calendar / Inbox / Create; Brand as a Settings tab).

Repo: `socialengine-website`, branch `quick-wins/1-nav-settings-coach-errors` from `origin/main` (b28e301). Single deployable: `portal.html` + `animation-studio.js`. Tests: Playwright against a local static server with a mocked API (pattern from `tests/e2e/sessions.spec.js`), plus the prod golden path updated for the new copy.

## Facts (portal.html @ b28e301)

- Sidebar buttons 2700–2713 (`data-nav`); studios/brand are separate items. `NAV_LABELS` 5974, `pageSubtitles` 5953 (no `schedule`).
- Nav click handler 6046–6084 sets `activeNav = nav`, calls one renderer. `switchNav` 6087–6105. `rerenderCurrentPage` 5871–5884 re-dispatches on `activeNav`. Other `activeNav` reads: 3174, 3175, 3314, 4769, 5377–5380, 5465–5469, 5496, 5843, 6211, 10095, 10177 — several check `'creation-studio'`/`'video-studio'`, so `activeNav` must keep holding the *studio id* when Create is open.
- `renderVideoStudio` (6185) and `renderAnimationStudio` (animation-studio.js 2263) both write `#dash-content.innerHTML` themselves, so a Create "wrapper" cannot live inside `#dash-content`. The segmented control lives in `.dash-main` between the topbar and `#dash-content` (`#create-segments`), shown only while a studio is active.
- No `location.hash` use anywhere; `seApplyNavFromUrl` 3274 handles `?tab=create|content`.
- `renderSettingsPage` 8713–9287: one template with cards Plan hero (8755) · Account (8771) · Captions (8787) · Security (8812) · Brand Style summary (8855, CTA clicks `[data-nav=brand-voice]` at 8939) · Shopify (8947, `#settings-shopify-card`) · Instagram (8999) · TikTok (9042) · Facebook (9084) · Target Platforms (9126) · Switch Kit (9160) · Subscription & Support (9194) · Delete modal (9236) · legal footer (9260). Post-render wiring 9268–9286 by id.
- `renderBrandVoicePage(data)` 8063–8382 writes `#dash-content` directly; post-render `initVoiceWorkshop()` + `mountBrandIntelligencePanel()` by id.
- `isCharityClient` 5991 uses a **name regex**. Callers: 6026 (Brand→Voice via `innerHTML.replace`), 6033 (Fundraise nav), 8065, 4898, 11023, 14241, 14311, 14363, 14699.
- Shopify surfaces: Settings card; Studio product grid + connect prompt (12515); content-modal regen picker (3796); onboarding step (3379–3456, 3562); Brand Intelligence copy (8033); Competitor Intel default type (11024–11046).
- Coach: `renderAICoach` 9363–9905. `.chat-container{height:calc(100vh - 12rem);min-height:480px}` 1547; `.chat-messages` 1553; `.chat-input-area` 1623 (not sticky); `.chat-suggestions` wraps (1629). Free-tier notice inserted before `#chat-messages` (9493–9499). Textarea auto-grow capped at 120px (9876). Chips already hidden on send (9631).
- Error surfaces: `result.detail` 10633, `result.details` 10721; QA badge `Model: ${model}` 5202; `data.model_display || data.model` 6880; `v.model` 6992; animation-studio.js `modelLine()` 105–112 renders `Model: <endpoint>`; `animFetch` 114–119 drops `request_id`; 2194 leaks "Check Atlas API key on the server".
- Poll toasts: 5305 "Calendar still loading — try View in calendar again" fires from a wait loop (not a user outcome) → remove. `startRegenPoll` toasts (5445 timeout, 5463 complete) and settings toggles (8687, 8709) are outcomes of a user action → keep.
- `showToast(msg, type)` 5783 builds DOM with `textContent`.
- Tests: `tests/e2e/sessions.spec.js` has the static-server + `mockApi` harness (61–103); `golden-path.spec.js` asserts "Content Studio" (160, 178), Create via `nav:'video-studio'` (71), Plan/Settings via one settings page (124–290). CI runs only `npm test` + `test:e2e:sessions`.

## Decisions

- **Create wrapper location**: `#create-segments` strip in `.dash-main` (outside `#dash-content`), toggled by the nav handler. `activeNav` stays `'creation-studio'` / `'animation-studio'` so every existing `activeNav` check keeps working; the sidebar highlight is `create`. Segment remembered in `localStorage['se_create_segment']`.
- **Hash is the single source of truth for sub-state**: `#settings/<brand|account|connections|billing>` and `#create/<video|animate>`. Renderers read the hash; tab/segment clicks write it with `history.replaceState`; other nav items clear it; `hashchange` re-routes; `seApplyNavFromUrl` honours it on load.
- **Settings default tab = Brand** (first in the approved order Brand · Account · Connections · Billing). Charity label "Voice".
- Section → tab: Brand = full Brand Voice page (mounted lazily into `#settings-brand-panel` via `renderBrandVoicePage(data, target)`); Account = Account, Captions, Security, Target Platforms; Connections = Shopify (capability-gated), Instagram, TikTok, Facebook; Billing = Plan hero, Switch Kit, Subscription & Support. Delete-account modal + legal footer stay global. The **Brand Style summary card is dropped** — it duplicated the Brand tab's archetype hero one scroll away (recorded here so it is not a silent removal).
- Capability gating rule: catalog surfaces (product pickers, regen picker, Studio grid) need `caps.commerce === 'shopify'`; *connect* prompts (Settings card, onboarding step, Studio connect CTA) are hidden for `caps.charity` (charity gets one line "Sell merchandise? Connect a Shopify store" that reveals the card). Until QW-B is live `getCaps()` derives the same object from `client_type` / `charity_mission` / `shopify_domain`; the name regex is deleted.
- Coach: `#dash-content` gets `dash-content--chat` while Coach is active → `height: calc(100dvh - var(--dash-header-h))`, `--dash-header-h` measured from `.dash-topbar` with a `ResizeObserver`. `.chat-page` flex column; `.chat-messages` only scroller; free-tier notice becomes a one-line header pill; chips one row `overflow-x:auto`; textarea cap 6 rows (≈ 8.5rem).
- `showToast(msg, type, { ref })` renders an optional muted `Ref req_…`. `animFetch` errors carry `request_id`; Animate error toasts pass it through.

## Tasks

### T1 — Test harness + failing nav spec
- [ ] `tests/e2e/helpers/portal-mock.js`: extract static server (`PROD_API → FAKE_API` rewrite), `mockApi(page, { clientData, onRequest })`, `login(page)`; `clientData()` accepts `capabilities` override.
- [ ] `tests/e2e/nav.spec.js` (local, mocked): sidebar labels + order for a commerce client (`Home, Content Review, Calendar, Create, Ads, Inbox, Analytics, Intel, Coach, All Tools, Settings`; no Fundraise, no Brand/Studio/Animate); charity client shows Fundraise and Settings tab "Voice"; every item clicks without console/page errors at 1280×720 and 390×844; Create shows segmented control and Video & Post → "Marketing Studio", Animate → Animation Studio root; `switchNav('animation-studio')` highlights Create + Animate segment; `switchNav('brand-voice')` → Settings with Brand panel + hash `#settings/brand`; `#settings/billing` deep link on load opens Billing ("Current Plan"); Content page H2 "Content Review"; breadcrumb "Calendar" for schedule.
- [ ] `tests/e2e/coach.spec.js`: composer `#chat-input` bounding box inside viewport on load and after 20 appended messages at both viewports; `#chat-messages` is the scroller (`scrollHeight > clientHeight` while `document.scrollingElement.scrollHeight <= innerHeight + 1`).
- [ ] `tests/e2e/errors.spec.js`: inbox AI-reply failure `{error, code, request_id, detail:'LEAK'}` → toast text contains the sentence and `req_` but not `LEAK`; QA badge title has no `Model:`; charity client sees no "Shopify Store" card in Connections; commerce client does.
- [ ] `package.json` scripts `test:e2e:portal`; `.github/workflows/ci.yml` job `portal-nav` running it.

### T2 — Sidebar + routing
- [ ] Markup 2700–2713 → target sidebar; `#create-segments` strip after `.dash-topbar`; CSS for `.create-seg`.
- [ ] `NAV_LABELS` (+`schedule: 'Calendar'`, `create: 'Create'`, `inbox: 'Inbox'`), `pageSubtitles` (+`schedule`, `create`).
- [ ] `renderCreatePage(segment?)`, `setCreateSegment`, hash helpers (`readHash`, `writeHash`, `clearHash`), `hashchange` listener, `seApplyNavFromUrl` hash support.
- [ ] Nav click handler: `create` branch; strip toggle; hash clear for non-sub-state pages; `switchNav` aliases for `creation-studio|video-studio|animation-studio|brand-voice`.
- [ ] `rerenderCurrentPage`: `brand-voice` → settings; studios → `renderCreatePage`.
- [ ] Content page H2 → "Content Review" (7055).

### T3 — Settings tabs + Brand
- [ ] `renderBrandVoicePage(data, target)`.
- [ ] `renderSettingsPage`: tab strip, `<section data-settings-panel>` wrappers, `openSettingsTab(tab)`, lazy Brand mount, hash write; Brand Style card removed; `[data-nav=brand-voice]` click sites (8365, 8369, 8621, 8635, 8939…) → `switchNav('brand-voice')`.
- [ ] Charity label "Voice".

### T4 — Capabilities
- [ ] `getCaps(data)`, `showIf(cond, el)`; `isCharityClient` → `getCaps(data).charity`; delete name regex.
- [ ] Settings Shopify card gated; Studio connect prompt (12515) gated on `!caps.charity`; product grid/regen picker only when `commerce==='shopify'`; onboarding Shopify step skipped for charity (3379–3456, 3562); BIS copy (8033); Intel default type (11024).
- [ ] Fundraise nav via `caps.fundraise`; Brand→Voice via label data.

### T5 — Coach layout
- [ ] CSS: `.dash-content--chat`, `.chat-page`, `.chat-container` (flex:1, height auto), `.chat-suggestions` one row, `.chat-input{max-height:8.5rem}`; `--dash-header-h` ResizeObserver.
- [ ] `renderAICoach`: wrap in `.chat-page`; free-tier pill in header; auto-grow cap 6 rows; scroll on send/reply (already `scrollToBottom`).
- [ ] Nav handler toggles `dash-content--chat`.

### T6 — Error surfaces + alert hygiene
- [ ] `showToast(msg, type, { ref })`; drop `|| result.detail` / `|| result.details`; pass `request_id`.
- [ ] QA badge title without `Model:`; 6880 `model_display` only; 6992 drop `v.model`.
- [ ] animation-studio.js: `modelLine` without model endpoint; `animFetch` attaches `request_id`/`code`; `toast(msg,type,ref)`; error toasts pass `e.request_id`; 2194 copy → customer sentence; 1928 → "Music generation isn't enabled on this account."
- [ ] Remove 5305 wait-loop toast.

### T7 — Golden path + wrap-up
- [ ] `golden-path.spec.js`: Create → `nav:'create'` + segment; Calendar → `nav:'schedule'` ("Content Calendar"); Content copy "Content Review"; Settings split into Account / Connections / Billing via `settingsTab`; `navigateToTab` supports `settingsTab` / `segment`.
- [ ] Bump `animation-studio.js?v=` cache-buster.
- [ ] All specs green locally (`npm run test:e2e:portal`, `npm run test:e2e:sessions`, `npm test`); PR; CI; merge; prod check with Playwright (mock-free smoke: labels present, no console errors).
