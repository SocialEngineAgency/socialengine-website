# Convert to Reel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From Create → Carousels, **Convert to Reel** opens Motion Reels kinetic text mode with auto-simplified slide lines, music/VO available, formal copy — shippable today.

**Architecture:** Shared client helper extracts/simplifies text from carousel slide slots → `seOpenMotionReel({ kind: 'text', lines, name, origin: 'carousel' })`. Carousels (design-studio-v2) and Claude Studio carousel mode both call it. Motion modal titles/CTAs use Convert to Reel when `origin === 'carousel'`. PNG `kind: 'carousel'` remains fallback when no text.

**Tech Stack:** Vanilla JS (website), existing `/api/motion/render` + `textReel`, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-07-convert-to-reel-design.md`

## Global Constraints

- CTA label: **Convert to Reel** (no “Make it a Reel” on this path)
- Prefer kinetic `kind: 'text'`; fallback `kind: 'carousel'` only if no usable lines
- No hard block toast; always open composer when slides exist
- Do not seed Create → Reels (`animation-studio`) in v1
- Reuse Motion Reels music / faceless VO UI

---

### Task 1: Simplify helper + unit tests

**Files:**
- Create: `carousel-reel-lines.js`
- Create: `tests/carousel-reel-lines.test.js`
- Modify: `portal.html` (script tag near motion-reels / design-studio-v2)

**Interfaces:**
- Produces: `window.seCarouselReelLines = { linesFromSlides(slides): string[], joinLines(lines): string }`

- [ ] **Step 1:** Write failing tests for title/list extraction, wordy truncation, max 8 beats, empty slides
- [ ] **Step 2:** Implement helper
- [ ] **Step 3:** Run tests; commit

### Task 2: Carousels result CTA

**Files:**
- Modify: `design-studio-v2.js` (`showResult` header actions)
- Test: `tests/e2e/design-studio-v2.spec.js` (or new convert-to-reel spec)

- [ ] **Step 1:** Add **Convert to Reel** button beside Download / Add to queue
- [ ] **Step 2:** On click → lines from `result.slides`; if lines, `seOpenMotionReel({ kind:'text', lines: join, name, origin:'carousel' })`; else PNG carousel kind with slide URLs
- [ ] **Step 3:** E2E hermetic: mock slides with slots, click, assert modal title / lines textarea
- [ ] **Step 4:** Commit

### Task 3: Claude Studio rename + text preference

**Files:**
- Modify: `claude-studio.js` (`cs-slide-reel` label + click handler)

- [ ] **Step 1:** Label → Convert to Reel; drop ▶
- [ ] **Step 2:** Prefer text lines from current slides/slots when available; else existing URL carousel handoff
- [ ] **Step 3:** Commit

### Task 4: Motion Reels origin copy

**Files:**
- Modify: `motion-reels.js`
- Modify: `tests/e2e/motion-reels.spec.js` if needed

- [ ] **Step 1:** If `opts.origin === 'carousel'` (or `opts.convert`), title/lead = Convert to Reel framing; primary button **Convert** or keep Make the Reel → prefer **Convert**
- [ ] **Step 2:** Accept `opts.lines` as string or string[]; prefill `#mr-lines` without forcing suggestBeats when lines already set
- [ ] **Step 3:** Commit

### Task 5: Ship

- [ ] **Step 1:** Push branch, open PR, wait CI green, merge
- [ ] **Step 2:** Confirm production has Convert to Reel on Carousels
- [ ] **Step 3:** Remove `tmp-convert-to-reel-examples.html` if still present
