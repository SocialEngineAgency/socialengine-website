# QW-3 — Asset library UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the portal half of design `docs/superpowers/specs/2026-09-10-quick-wins-design.md` §8: Saved outros/music in Animate, Brand library in Settings.

**Architecture:** Pure helpers in `portal-assets.js`. Animate replaces `uploadProjectAsset` with `POST /api/assets` (saves to the library and attaches `outro_url` / `music_bed_url`). Settings → Brand mounts a library (rename via `PATCH /api/assets/:id`, delete via `DELETE`). Assemble is unchanged: it still reads the selected URL on the project.

**Tech Stack:** Node test + existing Playwright hermetic harness (`tests/e2e/helpers/portal-mock.js`). Worktree `/tmp/se-qw3` on `quick-wins/3-asset-library` from `origin/main` (`07e7d19`). Needs QW-C live (`/api/assets`) plus a small PATCH for rename.

## Global Constraints

- Isolated worktree only. Do not touch the local `quality/charity-mode` checkout.
- Copy: "Saved outros", "Upload new", "Brand library". Charity Settings tab stays "Voice"; the library heading stays "Brand library".
- `outro_url` / `music_bed_url` on the project stay the selected asset URL.
- Errors through existing typed toasts (`error`, `code`, `request_id`).
- TDD: failing tests first.

---

## File map

- Create: `portal-assets.js` — kinds, accept, label, selectedId
- Create: `tests/portal-assets.test.js`
- Create: `tests/e2e/assets.spec.js`
- Modify: `tests/e2e/helpers/portal-mock.js` — `/api/assets` + project-with-shots
- Modify: `portal.html` — Brand library mount; bump `animation-studio.js?v=`
- Modify: `animation-studio.js` — Saved outros / music dropdown + library upload
- Modify: `package.json` — include `assets.spec.js` in `test:e2e:portal`

Companion API (separate worktree `/tmp/se-qw3-api`): `PATCH /api/assets/:id` `{ name }` → persist name.

---

### Task 1: Helpers

- [x] Failing unit tests then implement `portal-assets.js`.

### Task 2: Playwright

- [x] Brand library: heading, delete, rename.
- [x] Animate: pick a saved outro on a second project without re-uploading; Upload new hits `POST /api/assets`.

### Task 3: UI

- [x] Settings → Brand library; Animate Saved outros / music.
- [x] `npm test` + `npm run test:e2e:portal` green.

### Task 4: PR + merge

CI green → squash-merge `--delete-branch` → prod portal shows Brand library (logged-out: Settings not visible; check source / hermetic).
