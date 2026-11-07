/* Convert carousel slide slots → short kinetic Reel beats. Browser + node. */
(function (global) {
  'use strict';

  const MAX_BEATS = 8;
  const MAX_WORDS = 14;
  const TITLE_KEYS = ['title', 'heading', 'headline', 'hook', 'kicker', 'subtitle', 'subheading', 'cta', 'body', 'text', 'caption', 'line'];

  function wordsOf(s) {
    return String(s || '').trim().split(/\s+/).filter(Boolean);
  }

  function cleanLine(raw) {
    let s = String(raw || '')
      .replace(/#[\p{L}\p{N}_]+/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) return '';
    const words = wordsOf(s);
    if (words.length > MAX_WORDS) s = words.slice(0, MAX_WORDS).join(' ');
    return s.slice(0, 140);
  }

  function isHttps(v) {
    return typeof v === 'string' && /^https:\/\//i.test(v);
  }

  function pushUnique(out, line) {
    const c = cleanLine(line);
    if (!c) return;
    const key = c.toLowerCase();
    if (out.some((x) => x.toLowerCase() === key)) return;
    out.push(c);
  }

  /** Prefer title-like keys, then other short strings, then list items. */
  function linesFromSlots(slots) {
    const out = [];
    if (!slots || typeof slots !== 'object') return out;
    const used = new Set();

    for (const key of TITLE_KEYS) {
      if (!(key in slots)) continue;
      used.add(key);
      const v = slots[key];
      if (Array.isArray(v)) v.slice(0, 3).forEach((item) => pushUnique(out, item));
      else if (typeof v === 'string' && !isHttps(v)) pushUnique(out, v);
    }

    for (const [key, v] of Object.entries(slots)) {
      if (out.length >= MAX_BEATS) break;
      if (used.has(key)) continue;
      if (Array.isArray(v)) {
        v.slice(0, 3).forEach((item) => {
          if (out.length < MAX_BEATS) pushUnique(out, item);
        });
      } else if (typeof v === 'string' && !isHttps(v) && wordsOf(v).length <= MAX_WORDS + 6) {
        pushUnique(out, v);
      }
    }
    return out.slice(0, MAX_BEATS);
  }

  function linesFromSlides(slides) {
    const out = [];
    const list = Array.isArray(slides) ? slides : [];
    for (const slide of list) {
      if (out.length >= MAX_BEATS) break;
      if (!slide || typeof slide !== 'object') continue;
      const fromSlots = linesFromSlots(slide.slots);
      if (fromSlots.length) {
        // One strong beat per slide when possible (title first); keep a second if it's a short list lead-in.
        pushUnique(out, fromSlots[0]);
        if (fromSlots[1] && wordsOf(fromSlots[1]).length <= 8 && out.length < MAX_BEATS) {
          pushUnique(out, fromSlots[1]);
        }
        continue;
      }
      if (typeof slide.text === 'string') pushUnique(out, slide.text);
      if (typeof slide.title === 'string') pushUnique(out, slide.title);
    }
    return out.slice(0, MAX_BEATS);
  }

  function joinLines(lines) {
    return (Array.isArray(lines) ? lines : []).map((l) => String(l || '').trim()).filter(Boolean).join('\n');
  }

  const api = { linesFromSlides, linesFromSlots, joinLines, cleanLine, MAX_BEATS, MAX_WORDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.seCarouselReelLines = api;
})(typeof window !== 'undefined' ? window : globalThis);
