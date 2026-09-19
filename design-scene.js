'use strict';

const KINDS = new Set(['rect', 'text', 'image', 'logo', 'group']);
const ROLES = new Set(['hook', 'fact', 'visual', 'cta', 'other']);
const ASPECTS = {
  '9:16': { w: 1080, h: 1920 },
  '4:5': { w: 1080, h: 1350 },
  '1:1': { w: 1080, h: 1080 },
};

function clampNum(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function hexColor(value, fallback) {
  const raw = String(value || '').trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw) ? raw : fallback;
}

function httpUrl(value) {
  const raw = String(value || '').trim();
  return /^https:\/\//i.test(raw) ? raw : '';
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeObject(raw, index) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const kind = KINDS.has(String(s.kind || '').toLowerCase()) ? String(s.kind).toLowerCase() : 'rect';
  const locked = kind === 'logo' || s.locked === true;
  const unique = s.unique === false || locked || kind === 'rect' ? false : true;
  return {
    id: String(s.id || `obj-${index + 1}`).slice(0, 80),
    kind,
    slot: String(s.slot || '').trim().slice(0, 40) || null,
    unique,
    locked,
    hidden: s.hidden === true,
    x: clampNum(s.x, 0, -2000, 4000),
    y: clampNum(s.y, 0, -2000, 4000),
    w: clampNum(s.w, kind === 'text' ? 400 : 120, 1, 4000),
    h: clampNum(s.h, kind === 'text' ? 80 : 80, 1, 4000),
    fill: hexColor(s.fill, kind === 'text' ? '#1B1B1B' : ''),
    stroke: hexColor(s.stroke, ''),
    text: String(s.text || '').slice(0, 500),
    fontSize: clampNum(s.fontSize, 32, 10, 200),
    fontWeight: clampNum(s.fontWeight, kind === 'text' ? 700 : 400, 100, 900),
    fontFamily: String(s.fontFamily || 'Arial, Helvetica, sans-serif').slice(0, 80),
    href: httpUrl(s.href || s.url),
    opacity: clampNum(s.opacity, 1, 0, 1),
  };
}

function normalizeSlide(raw, index) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const objects = (Array.isArray(s.objects) ? s.objects : []).map(normalizeObject).filter(Boolean);
  if (!objects.length) return null;
  const role = ROLES.has(String(s.role || '').toLowerCase()) ? String(s.role).toLowerCase() : 'other';
  return {
    index: index + 1,
    role,
    objects,
  };
}

function normalizeDesignScene(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const aspect = ASPECTS[src.aspect] ? src.aspect : '9:16';
  const size = ASPECTS[aspect];
  const slides = (Array.isArray(src.slides) ? src.slides : []).map(normalizeSlide).filter(Boolean).slice(0, 10);
  const logoUrl = httpUrl(src.logo && (src.logo.url || src.logo.href));
  return {
    type: 'design_scene',
    version: 1,
    name: String(src.name || 'Carousel format').replace(/\s+/g, ' ').trim().slice(0, 80),
    aspect,
    canvas: { w: size.w, h: size.h },
    palette: {
      bg: hexColor(src.palette && src.palette.bg, '#FFFFFF'),
      fg: hexColor(src.palette && src.palette.fg, '#1B1B1B'),
      accent: hexColor(src.palette && src.palette.accent, '#5B2C6F'),
      muted: hexColor(src.palette && src.palette.muted, '#6B7280'),
    },
    logo: {
      url: logoUrl,
      x: clampNum(src.logo && src.logo.x, 40, 0, size.w),
      y: clampNum(src.logo && src.logo.y, 36, 0, size.h),
      w: clampNum(src.logo && src.logo.w, 120, 8, 600),
      h: clampNum(src.logo && src.logo.h, 36, 8, 400),
      locked: true,
    },
    slides,
  };
}

function cloneScene(scene) {
  return JSON.parse(JSON.stringify(normalizeDesignScene(scene)));
}

function mapObjects(scene, fn) {
  const next = cloneScene(scene);
  next.slides = next.slides.map((slide) => ({
    ...slide,
    objects: slide.objects.map(fn).filter(Boolean),
  }));
  return next;
}

function stripUniqueSlots(scene) {
  return mapObjects(scene, (obj) => {
    if (obj.locked || !obj.unique) return obj;
    if (obj.kind === 'text') return { ...obj, text: '' };
    if (obj.kind === 'image' || obj.kind === 'group') return { ...obj, href: '', text: '' };
    return obj;
  });
}

function hideObject(scene, objectId) {
  const id = String(objectId || '');
  return mapObjects(scene, (obj) => (obj.id === id ? { ...obj, hidden: true } : obj));
}

function removeObject(scene, objectId) {
  const id = String(objectId || '');
  return mapObjects(scene, (obj) => (obj.id === id ? null : obj));
}

function fillSlots(scene, values = {}) {
  const map = values && typeof values === 'object' ? values : {};
  return mapObjects(scene, (obj) => {
    if (!obj.slot || map[obj.slot] == null) return obj;
    const value = String(map[obj.slot]);
    if (obj.kind === 'text' || obj.kind === 'group') return { ...obj, text: value.slice(0, 500), hidden: false };
    if (obj.kind === 'image' && /^https:\/\//i.test(value)) return { ...obj, href: value, hidden: false };
    return obj;
  });
}

function objectSvg(obj) {
  if (!obj || obj.hidden) return '';
  const common = `data-object-id="${escapeXml(obj.id)}" data-slot="${escapeXml(obj.slot || '')}"`;
  if (obj.kind === 'rect' || obj.kind === 'group') {
    const fill = obj.fill || 'none';
    const stroke = obj.stroke ? ` stroke="${escapeXml(obj.stroke)}"` : '';
    return `<rect ${common} x="${obj.x}" y="${obj.y}" width="${obj.w}" height="${obj.h}" fill="${escapeXml(fill)}"${stroke} opacity="${obj.opacity}"/>`;
  }
  if (obj.kind === 'text') {
    const text = escapeXml(obj.text);
    if (!text) {
      return `<rect ${common} x="${obj.x}" y="${obj.y}" width="${obj.w}" height="${obj.h}" fill="none" stroke="rgba(0,0,0,0.08)"/>`;
    }
    return `<text ${common} x="${obj.x}" y="${obj.y + obj.fontSize}" width="${obj.w}" fill="${escapeXml(obj.fill || '#1B1B1B')}" font-size="${obj.fontSize}" font-weight="${obj.fontWeight}" font-family="${escapeXml(obj.fontFamily)}">${text}</text>`;
  }
  if ((obj.kind === 'image' || obj.kind === 'logo') && obj.href) {
    return `<image ${common} href="${escapeXml(obj.href)}" x="${obj.x}" y="${obj.y}" width="${obj.w}" height="${obj.h}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  return '';
}

function slideToSvg(scene, index) {
  const normalized = normalizeDesignScene(scene);
  const slide = normalized.slides.find((s) => Number(s.index) === Number(index)) || normalized.slides[0];
  if (!slide) return '';
  const { w, h } = normalized.canvas;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect x="0" y="0" width="${w}" height="${h}" fill="${escapeXml(normalized.palette.bg)}"/>`,
  ];
  if (normalized.logo.url && !slide.objects.some((o) => o.kind === 'logo')) {
    parts.push(`<image data-object-id="logo" href="${escapeXml(normalized.logo.url)}" x="${normalized.logo.x}" y="${normalized.logo.y}" width="${normalized.logo.w}" height="${normalized.logo.h}" preserveAspectRatio="xMidYMid meet"/>`);
  }
  for (const obj of slide.objects) parts.push(objectSvg(obj));
  parts.push('</svg>');
  return parts.filter(Boolean).join('');
}

function sceneFromSlideImages(urls, { name = 'Carousel format', aspect = '9:16' } = {}) {
  const hrefs = (Array.isArray(urls) ? urls : [])
    .map((u) => httpUrl(u))
    .filter(Boolean)
    .slice(0, 10);
  if (hrefs.length < 2) return null;
  const size = ASPECTS[aspect] || ASPECTS['9:16'];
  return normalizeDesignScene({
    name,
    aspect: ASPECTS[aspect] ? aspect : '9:16',
    slides: hrefs.map((href, i) => ({
      index: i + 1,
      role: i === 0 ? 'hook' : (i === hrefs.length - 1 ? 'cta' : 'fact'),
      objects: [{
        id: `slide-${i + 1}-art`,
        kind: 'image',
        slot: 'art',
        unique: false,
        locked: false,
        x: 0,
        y: 0,
        w: size.w,
        h: size.h,
        href,
      }],
    })),
  });
}

function applySceneCoachEdit(scene, message) {
  const t = String(message || '').toLowerCase();
  if (!/\b(hide|remove|drop|delete)\b/.test(t)) return normalizeDesignScene(scene);
  let next = normalizeDesignScene(scene);
  for (const slide of next.slides) {
    for (const obj of slide.objects) {
      const labels = [obj.id, obj.slot].filter(Boolean).map((v) => String(v).toLowerCase().replace(/-/g, ' '));
      if (labels.some((label) => label && t.includes(label))) {
        next = hideObject(next, obj.id);
      }
    }
  }
  return next;
}

async function extractDesignScene({ complete, raw, slideUrls } = {}) {
  if (raw) return stripUniqueSlots(normalizeDesignScene(raw));
  const fallback = () => sceneFromSlideImages(slideUrls);
  if (typeof complete === 'function') {
    try {
      const text = await complete();
      const scene = parseDesignSceneJson(text);
      if (scene && scene.slides && scene.slides.length >= 2) return stripUniqueSlots(scene);
    } catch (_) { /* use the uploaded slides */ }
  }
  const fromSlides = fallback();
  if (fromSlides) return fromSlides;
  const err = new Error('Could not extract a carousel template');
  err.code = 'SCENE_EXTRACT_FAILED';
  throw err;
}

async function fillDesignScene({ scene, complete, values } = {}) {
  if (values && typeof values === 'object') return fillSlots(scene, values);
  if (typeof complete !== 'function') return normalizeDesignScene(scene);
  const text = await complete();
  try {
    const start = String(text || '').indexOf('{');
    const end = String(text || '').lastIndexOf('}');
    const parsed = JSON.parse(String(text || '').slice(start, end + 1));
    return fillSlots(scene, parsed.slots || parsed);
  } catch {
    return normalizeDesignScene(scene);
  }
}

function parseDesignSceneJson(text) {
  const src = String(text || '');
  const start = src.indexOf('{');
  const end = src.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return normalizeDesignScene(JSON.parse(src.slice(start, end + 1)));
  } catch {
    return null;
  }
}

const designSceneApi = {
  normalizeDesignScene,
  stripUniqueSlots,
  hideObject,
  removeObject,
  fillSlots,
  slideToSvg,
  parseDesignSceneJson,
  applySceneCoachEdit,
  extractDesignScene,
  fillDesignScene,
  sceneFromSlideImages,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = designSceneApi;
}
if (typeof window !== 'undefined') {
  window.designSceneApi = designSceneApi;
}
