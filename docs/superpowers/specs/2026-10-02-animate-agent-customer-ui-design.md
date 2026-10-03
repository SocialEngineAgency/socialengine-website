# Animate agent: customer-facing UI (not technical)

**Date:** 2026-10-02  
**Status:** Implementing  
**Repos:** website `animation-studio.js`, API `anim-brief-normalize` / shot `action`

## Hard rule

Anything the customer does not need to decide on stays **off the UI** — omitted, not merely collapsed. Compiled prompts, model names, provider stacks, upscale pipeline copy, and Art Director wrap language are internal (API logs / project JSON only).

## Layout

- Right rail: scroll = short chat + brief decision card only.
- Sticky bottom: idea textarea + Send (never inside the scroll).
- Settings & refs: one disclosure; human labels only.
- Brief card: shot count + one-line titles/actions. Accept / Try again. No `rewritten_prompt` or compiled `shot.prompt` dump.
- Canvas shot cards: edit short `action` (or title). Server keeps compiled `prompt` for generation.
- Status: “Making your video…” — never FigureLabs / fal / Seedance / Kling / DreamActor / 4K upscale.
- After assemble: “Ready for review — Approve in Content Review to post.”

## Publish reminder

Animate does not publish. Rebuild final → Content Review → Approve → FB/IG/TikTok.

## Data

`normalizeAgentBrief` must persist human `action` alongside compiled `prompt` so the UI never has to show the compiler wrap.
