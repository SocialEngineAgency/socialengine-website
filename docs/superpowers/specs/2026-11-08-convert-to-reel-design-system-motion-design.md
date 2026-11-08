# Convert to Reel — Design-system motion

**Date:** 2026-11-08  
**Status:** Approved for spec (goal / technical shape / UI+motion)  
**Supersedes:** `2026-11-07-convert-to-reel-design.md` (textReel / PNG slideshow paths as the Convert happy path)

**Reference:** OPA carers reel in Review (`…/s/c2d7f4a2ac163f844b263962.mp4`) — Claude Design–quality multi-scene brand film (segment bars, ghost numbers, mixed type, logo end card). That is the quality bar, not Motion `textReel` or Ken Burns on slide PNGs.

## Goal

From finished carousel slides in Create → **Carousels**, **Convert to Reel** produces a vertical reel that **animates the brand design system layouts** (same patterns/slots/colours/fonts used for still carousels), so the reel is clearly better than the carousel and matches the carers-reel bar — not a slideshow and not a generic kinetic text reel.

## Approach (chosen)

**Animate the carousel design system** (option 1). Rejected:

- Brand-skinned `textReel` — faster, still reads like Make a Reel; fails the reference bar.
- Hand-off only to freeform Claude Design animate — highest fidelity chance, but splits tools, slower loop, Convert becomes a different product surface.

## User flow

1. User finishes slides in Create → Carousels (design-studio-v2; Claude Studio carousel mode where Convert exists).
2. Clicks **Convert to Reel** (visible when ≥1 finished slide with pattern/slots, or fallback assets).
3. Opens Motion composer in **design** mode (carousel origin):
   - Scene list derived from slides (pattern label + editable key slot copy).
   - Optional **Direction** prompt (free text) for look/feel overrides on this reel only.
   - Brand palette / fonts / logo defaults on (Direction can override colours / energy).
   - Music: same picker / AI bed as Motion Reels today.
4. User adjusts direction / music / scene copy if needed → **Convert** → render → Library → Motion reels.
5. **Out of v1:** Review-surface CTA; Voiceover + footage tab on this path (v1.1 if it slows ship); carousel designer redesign.

## Technical shape

### Happy path — `kind: 'design'` (name locked in implementation plan)

**Website**

- `design-studio-v2.js` / `claude-studio.js` **Convert to Reel** passes:
  - `origin: 'carousel'`
  - `kind: 'design'`
  - `slides: [{ pattern, slots, style? }]` (strip image-only noise for editable lines; keep image slot URLs for layout)
  - brand hints available client-side (handle, cta) plus server loads full design system
- Composer UI: scene list + **Direction** textarea + music + Convert; lead copy per table below. Not a free-text chrome dump into `#mr-lines`.
- Direction field: optional, maxlength ~300; placeholder e.g. `e.g. pink and green backgrounds, calmer motion`.
- Pass `direction` string on render when non-empty.
- Cache-bust portal scripts on ship.

**API**

- New HyperFrames composition (e.g. `designReel` in `lib/motion/compose.js`) registered on `/api/motion/render` for `kind: 'design'`.
- For each slide, reuse design-system slide composition (`composeSlide` / pattern HTML + tokens from `lib/design/system.js`): real colours, fonts, frame (page/total/logo), slot structure.
- **Direction (v1):** optional `direction` string. Before compose, parse into structured overrides applied on top of the brand system for **this job only** — primarily palette (`bg` / `surface` / `ink` / `accent` / `primary`), plus coarse motion energy (`calmer` | `default` | `punchier`). Layouts, patterns, and slide copy stay unless the user edits scenes. Empty direction → pure brand system.
- Parsing: small structured extract (cheap model or rules+hex) → `{ palette?, motion? }`; ignore requests that would invent new layouts, rewrite all copy, or swap the design system. Do not turn Direction into freeform Claude Design invent.
- GSAP timeline per scene animates `data-slot` (and list children) in; soft exit; no Ken Burns on finished PNGs as the happy path.
- Shared chrome: Instagram-style **segment progress bars**; ghost page numbers from frame; end card with logo + CTA/handle (defaults on when brand provides them).
- Timing: hold ≈3.5–6s by density (lists longer); cap scenes ≈8–10 to match Motion limits; Direction `calmer`/`punchier` may nudge hold ±15% and entrance ease.
- Music: same `music_url` / AI music plumbing as existing kinds.

### Fallback

- If pattern/slots unavailable: existing PNG `kind: 'carousel'` (`carouselReel`), with composer note: *Using slide images instead — layouts weren’t available to animate.*
- Do **not** use plain `textReel` as the Convert happy path.

### Auto-clean of scene copy

- Prefer title/heading/list content slots; drop section-label chrome that duplicates kickers (e.g. raw `EARLY SIGNS` / `OPA · …` when a better headline exists).
- Cap beats/scenes; shorten overflow via existing slot limits where possible.
- Always open composer when any usable slide exists (no hard block).

## Copy (formal)

| Place | Text |
|--------|------|
| Primary CTA | Convert to Reel |
| Modal title (carousel origin) | Convert to Reel |
| Lead | Your carousel layouts animate as branded scenes — type moves in on the real design system, with music. |
| Primary action | Convert |
| Direction label | Direction (optional) |
| Direction placeholder | e.g. pink and green backgrounds, calmer motion |
| Fallback note | Using slide images instead — layouts weren’t available to animate. |

## Motion (v1)

- One scene per carousel slide, in order.
- Enter: slot text/lists stagger (pop/rise); rules draw; ghost page number soft-fades.
- Hold: readable duration; ambient only (no PNG Ken Burns).
- Top: segment bars advance per scene.
- Exit: short dissolve into next scene.
- End: logo + CTA/handle card from brand.
- Music: existing Motion music options.

## Out of scope (v1)

- Review-surface Convert CTA
- Voiceover + footage on the design Convert path (follow-up)
- Carousel designer UX redesign
- Platform-wide CTA language sweep
- Freeform Claude Design invent as the Convert engine (Direction is overrides only, not a redesign agent)
- Direction that rewrites slide copy or swaps patterns (user edits scenes for copy)

## Risks

| Risk | Mitigation |
|------|------------|
| Pattern HTML built for stills, not motion | Animate via `data-slot` hooks; keep pattern DOM stable; test on OPA system |
| Font host / design fonts vs Motion font map | Reuse design-system font links inside composition shell |
| Image slots / art URLs missing | Compose with placeholders or skip art slot animation; still animate type |
| Long carousels | Scene cap 8–10; readable holds |
| Regress to textReel/PNG as default | Explicit `kind: 'design'` from Convert; e2e asserts design payload |
| Direction becomes unbounded redesign | Structured overrides only (palette + motion energy); ignore layout/copy invent |

## Success

OPA can finish a Carousels job, click **Convert to Reel**, get a branded multi-scene reel (segment bars, design-system type motion, logo end card, music) that sits next to the carers reference without looking like a slideshow or generic Make a Reel — same day.

## Implementation note

Website + API both change. Spec lives here; implementation plan should split tasks across `socialengine-website` and `socialengine-api` with coordinated ship.
