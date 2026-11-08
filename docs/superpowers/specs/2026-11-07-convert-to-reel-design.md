# Convert to Reel — Design

**Date:** 2026-11-07  
**Status:** Superseded by `2026-11-08-convert-to-reel-design-system-motion-design.md` (design-system motion happy path)

## Goal

From finished carousel slides in Create → **Carousels**, produce a vertical **kinetic-type** reel with music (and optional voiceover), using formal CTA language (**Convert to Reel**), so OPA can ship Director-style carousel→reel content quickly.

## Destination (revised)

**Motion Reels text path** (`seOpenMotionReel`, `kind: 'text'` → `/api/motion/render` → `textReel`), not Create → Reels (`animation-studio`).

**Why:** Kinetic word animation already ships in Motion Reels. Create → Reels is the multi-shot footage + voiceover timeline. Handing kinetic work into animation-studio would either drop the motion style we chose or require rebuilding kinetic there. Motion Reels already exposes music beds and a faceless/VO mode in the same surface.

**UX framing:** Button lives on Carousels; click opens the Motion Reel composer prefilled from the carousel (handoff out of the slide editor into the reel tool). Users still get music + voiceover options “like the rest of the instances,” without a dead-end Carousels-only renderer.

## User flow

1. User finishes slides in Create → Carousels (brand / design-studio-v2 stage, and Claude Studio carousel mode where the old control exists).
2. Clicks **Convert to Reel** (visible when ≥1 finished slide / usable text exists).
3. System auto-simplifies slide text slots → short kinetic lines (strongest short lines per slide; skip dense body).
4. Opens Motion Reel composer:
   - Default mode: **text** (kinetic), beats = simplified lines.
   - Music: same picker / AI bed options as today.
   - Logo / end-card handle: **on by default**, toggleable (existing handle/CTA + brand where available).
   - Voiceover: available via existing **Voiceover + footage** (faceless) tab in the same modal; script seeded from the same simplified lines when they switch.
5. User adjusts music / lines / VO, renders, downloads or finds it in Library → Motion reels.
6. **Follow-up (out of v1):** same CTA on Review for carousel posts.

## Motion

- **B — Kinetic type rebuild** from edit-graph / slide text slots (not Ken Burns on PNGs).
- Messy slides: **auto-simplify** to headline-scale lines; always open the composer (no hard block). Informational note if lines were shortened (e.g. in lead copy or a quiet status), not an error wall.
- Existing PNG `kind: 'carousel'` path remains for callers that pass slide URLs only; **Convert to Reel** from Carousels prefers text/kinetic when slots exist, falls back to carousel PNG motion only if no usable text can be extracted.

## Copy (formal)

| Place | Label |
|--------|--------|
| Primary CTA | Convert to Reel |
| Replace | “▶ Make it a Reel”, casual “Make a Reel” on this Carousels path |
| Motion modal title (carousel-origin) | Convert to Reel |
| Actions | Cancel / existing render CTAs tightened toward “Convert” / “Render” where we touch them |

Broader Create-wide button language sweep is a **follow-up**, not blocking v1.

## Technical shape

### Website

- **Carousels (`design-studio-v2.js`):** Add **Convert to Reel** on the finished-slides stage. Collect text from slide `slots` (text/list kinds); run `simplifyCarouselLines(slides)` → string lines; call `seOpenMotionReel({ kind: 'text', text/lines, name, handle?, logo default on })`.
- **Claude Studio carousel mode (`claude-studio.js`):** Rename `cs-slide-reel` to **Convert to Reel**; when slot text exists, open `kind: 'text'` with simplified lines; else keep current `kind: 'carousel'` URL handoff.
- **`motion-reels.js`:** Accept optional `lines` / `beats` array; support origin copy “Convert to Reel”; ensure logo/handle defaults on when brand handle/logo available; do not require leaving Carousels nav first (overlay is fine).

### API

- Prefer existing `textReel` / `/api/motion/render` (`kind: 'text'`).
- Auto-simplify may live client-side first (shared helper); promote to API only if agent/`make_reel` needs the same rules.
- Logo: reuse end-card / handle behavior already in compose; default on when brand provides handle or logo URL.

### Auto-simplify rules (v1)

- Per slide: prefer short title/heading slots; then first list items; drop lines > ~14 words by truncating or splitting via existing `splitBeats` behavior.
- Cap total beats (align with `textReel` max 8).
- Strip hashtags / empty / image-only slides contribute no beat (unless a caption exists).

## Out of scope (v1)

- Review-surface CTA
- Full Create → Reels (`animation-studio`) project seed for kinetic type
- Per-line prep editor UI
- Platform-wide CTA language sweep
- User-facing PNG Ken Burns as the Convert path default

## Risks

| Risk | Mitigation |
|------|------------|
| Slot-less legacy slides | Fall back to `kind: 'carousel'` PNG motion or caption text |
| Motion Reels ≠ Create → Reels naming confusion | Button says Convert to Reel; modal lead explains kinetic text + music |
| Audio UI drift | Reuse `seOpenMotionReel` options; don’t fork music/VO |
| Long carousels | Beat cap (8) + simplify |

## Success

OPA can open a finished carousel, click **Convert to Reel**, get a kinetic draft with music options (and VO via the same composer), render, and use it the same day.
