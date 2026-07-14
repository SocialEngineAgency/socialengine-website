# SocialEngine website

Static marketing site and deployed portal entrypoint for SocialEngine.

## Golden-path portal E2E

The repo includes a Playwright suite at `tests/e2e/golden-path.spec.js` that exercises the deployed client portal at `https://www.socialengine.agency/portal.html`.

### What it covers

- Signs in with real portal credentials from environment variables only
- Walks the full paying-customer portal journey
- Verifies each requested portal area:
  - Home
  - Engage
  - Create
  - Ads
  - Coach
  - Plan
  - Calendar
  - Content
  - Inbox
  - Grow
  - Settings
- For each area, asserts:
  - the page loads without JavaScript/runtime errors
  - backend-backed content renders
  - primary CTAs are visible, enabled, and trial-clickable

### Credential requirements

Do **not** hardcode or commit credentials. Export them in your shell before running the suite:

```bash
export PORTAL_EMAIL="your-test-email@example.com"
export PORTAL_PASSWORD="your-test-password"
```

### Install dependencies

```bash
npm install
npx playwright install chromium
```

### Run the golden-path suite

```bash
npm run test:e2e:golden-path
```

### Useful variants

Run all Playwright tests:

```bash
npm run test:e2e
```

Run headed for local debugging:

```bash
npm run test:e2e:headed -- tests/e2e/golden-path.spec.js
```

### Notes on requested tab mapping

The deployed portal's implemented navigation does not expose separate sidebar items for every requested label, so the suite documents and tests these mappings against the real UI:

- `Plan` -> the plan and subscription management section inside `Settings`
- `Calendar` -> the content calendar/state within `Content`
- `Inbox` -> the inbox/filter surface within `Engage`

## Native OAuth for analytics + publishing

Instagram/Facebook connect now uses **direct native Meta OAuth** end-to-end. The
old `api/native-oauth.js` 501 stub has been removed — native OAuth is served by
the live API server (Railway), not this repo.

Live native OAuth routes (on the API server):

- `GET /api/auth/instagram` -> Meta Login (Instagram Business via Page)
- `GET /api/auth/facebook`  -> Meta Login (Facebook Page)
- `GET /api/auth/tiktok`    -> TikTok OAuth
- `GET /api/auth/meta/callback` -> unified Meta callback

Each start route reads `client_email` + `client_hash`, redirects to Meta Login,
and the callback exchanges the code for a long-lived token, resolves the Page +
IG Business account, and writes the tokens into Airtable.

Airtable fields written by the Meta callback:

- `meta_user_token`, `meta_token_expires`
- `meta_page_id`, `meta_page_token`, `meta_page_name`
- `instagram_user_id`, `instagram_handle`, `instagram_token` (when the Page has an IG Business account)
- `social_connected`, `facebook_connected`

TikTok native OAuth writes `tiktok_access_token`.

If native OAuth fails, the portal keeps the publishing connection but warns the client that Grow analytics will be limited until the native step is completed.

### Required environment variables

Configure these env vars in the backend environment before implementing the live OAuth exchanges:

- `META_APP_ID`
- `META_APP_SECRET`
- `TIKTOK_CLIENT_KEY`
- `TIKTOK_CLIENT_SECRET`

You will also need platform-specific redirect URIs that point back to your deployed backend callback handlers for the native OAuth flow.
