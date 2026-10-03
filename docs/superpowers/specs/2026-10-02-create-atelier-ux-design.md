# Create Atelier UX

**Status:** Approved — implementing studio-by-studio  
**Date:** 2026-10-02  
**Surface:** Portal Create (Video · Post · Animate)

## Goal

Make Create feel like a premium design atelier: simple on the surface, deep when opened. Adding features must not require new chrome — only new inspector sections or drawers.

## Principles

1. **Stage first** — preview/canvas owns the viewport.
2. **One primary CTA** per mode for the novice path.
3. **Progressive disclosure** — advanced controls closed by default.
4. **Shared shell** — Video / Post / Animate swap panels inside one layout system.
5. **Extensible inspector** — sections are a registry (`id`, `title`, `studio[]`, `defaultOpen`).

## Navigation

- Kill nested **Video & Post | Animate** and in-studio **Video | Post** pills.
- Mode strip: three equal typographic modes — **Video · Post · Animate**.
- Hash: `#create/video` | `#create/post` | `#create/animate`.
- `activeNav`: `creation-studio` | `design-studio` | `animation-studio` (sidebar highlight stays `create`).

## Shared shell

```
┌─ Mode strip: Video · Post · Animate ──────────────── credits ─┐
│ ┌ Essentials ┐  ┌──────── Stage ────────┐  ┌ Inspector/Agent ┐ │
│ │ ref/prompt │  │ preview / canvas      │  │ sections+drawers│ │
│ │ primary CTA│  │                       │  │                 │ │
│ └────────────┘  └───────────────────────┘  └─────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

## Studio order

1. **Hub + shell** (this PR) — mode strip + routing
2. **Post** (this PR) — atelier left essentials + stage + inspector drawers
3. **Video** (next) — upload/generate into same shell
4. **Animate** (next) — agent as right panel; settings already progressive

## Post atelier (v1 of B)

- Left: Reference, Brief, primary **Generate** — New / Save / Archive / Delete as quiet icon row
- Center: preview stage (unchanged generate/queue behavior)
- Right / drawers (collapsed by default): Carousel, Style & aspect, Saved, Advanced URL, Workspace chip
- Remove `#cs-back-video` dual toggle; mode strip switches studios

## Non-goals (this PR)

- New generation models
- Full Animate / Video interior rebuild
- Purple glow card spam
- Changing Coach workspace

## Verification

- Create opens with three modes; no nested toggles
- Video / Post / Animate each load correct studio; hash + localStorage persist
- Coach → Design still opens Post mode
- Post: Generate / Queue / Redesign carousel still work
- Mobile: mode strip wraps; stage remains usable
