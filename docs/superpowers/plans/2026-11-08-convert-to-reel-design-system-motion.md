# Convert to Reel — Design-system motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert to Reel animates brand carousel patterns (design system) into a vertical Motion reel with optional Direction overrides, matching the carers-reel quality bar.

**Architecture:** API adds `kind: 'design'` → `designReel` HyperFrames composition from `composeSlide`/design-system tokens + GSAP slot entrances; Direction parses to palette/motion overrides. Website Convert handoff passes `{ pattern, slots }` slides + opens design-mode composer with Direction + music.

**Tech Stack:** Node (socialengine-api `lib/motion`, `lib/design`), vanilla JS portal (`motion-reels.js`, `design-studio-v2.js`, `claude-studio.js`), Playwright e2e, node:test.

## Global Constraints

- CTA / modal: **Convert to Reel**; primary button **Convert**
- Happy path: `kind: 'design'` — not `textReel`; PNG `carousel` only as fallback
- Direction: optional ≤300 chars; structured overrides only (palette + calmer|default|punchier)
- Scene cap ≈8–10; hold ≈3.5–6s by density
- Formal copy per spec `2026-11-08-convert-to-reel-design-system-motion-design.md`
- Ship website + API together

---

### Task 1: Direction parser (API)

**Files:**
- Create: `lib/motion/direction.js`
- Test: `tests/motion-direction.test.js`

**Produces:** `parseDirection(text) → { palette: { bg?, accent?, primary?, surface?, ink? }, motion: 'calmer'|'default'|'punchier' }`; `applyDirectionColors(colors, palette)`.

- [ ] **Step 1:** Failing tests for empty, “pink and green backgrounds”, hex colours, calmer/punchier
- [ ] **Step 2:** Implement parser (named colours + `#RRGGBB` + motion keywords)
- [ ] **Step 3:** Tests pass; commit

### Task 2: `designReel` composition (API)

**Files:**
- Modify: `lib/motion/compose.js` (add `designReel`, wire `reelSpec`)
- Modify: `lib/design/system.js` if needed (`composeSlideInner` or export helpers)
- Test: `tests/motion.test.js` (extend)

**Produces:** `designReel({ system, slides, motion, cta, handle, musicUrl, musicLengthSec }) → { html, duration, width, height }`

- [ ] **Step 1:** Failing test — segment bars, animated `data-slot`, end card, no Ken Burns PNG path
- [ ] **Step 2:** Implement designReel (shared tokens CSS, fillSlots/frame per scene, letterbox into 1080×1920, GSAP entrances)
- [ ] **Step 3:** Tests pass; commit

### Task 3: `/api/motion/render` kind `design` (API)

**Files:**
- Modify: `server.js` motion render route
- Test: `tests/routes-faceless-render.test.js` or new `tests/routes-motion-design.test.js`

**Produces:** Accept `kind: 'design'`, load active design system via `pickStyle`, apply Direction, queue job.

- [ ] **Step 1:** Failing route test with seeded `design_system`
- [ ] **Step 2:** Wire render + error codes (`DESIGN_NO_SYSTEM`, bad slides)
- [ ] **Step 3:** Tests pass; commit; open API PR

### Task 4: Motion composer design mode + Direction (website)

**Files:**
- Modify: `motion-reels.js`
- Modify: `design-studio-v2.js`, `claude-studio.js`
- Modify: `portal.html` cache-bust
- Test: `tests/e2e/design-studio-v2.spec.js`, `tests/e2e/motion-reels.spec.js`

**Produces:** Convert opens `kind: 'design'` with slides; Direction textarea; Convert posts design payload; PNG fallback when no patterns.

- [ ] **Step 1:** Failing e2e — Convert seeds design scenes + direction field
- [ ] **Step 2:** Implement handoff + UI
- [ ] **Step 3:** CI green; open website PR; merge both; confirm production

---
