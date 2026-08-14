/**
 * Animation Studio — canvas-first OiiOii-style UX
 * Left: timeline / asset canvas  |  Right: agent chat + mode/look dropdowns
 */
(function () {
  'use strict';

  let _meta = null;
  let _project = null;
  let _recent = []; // project list for home screen
  let _pollTimer = null;
  let _busy = false;
  let _captionStudioOpen = false;
  let _captionPreviewRaf = 0;
  let _recentLoading = false;
  let _refs = []; // [{ url, title, role: 'character'|'style'|'scene' }]
  const REF_ROLES = [
    { id: 'character', label: 'Char' },
    { id: 'style', label: 'Style' },
    { id: 'scene', label: 'Scene' },
  ];

  function defaultRefRole() {
    const charCount = _refs.filter((r) => r.role === 'character').length;
    // Multi-cast projects need 2+ Char tags — don't auto-steal the 2nd upload as Style.
    if (charCount < 2) return 'character';
    if (!_refs.some((r) => r.role === 'style')) return 'style';
    return 'scene';
  }

  function refsPayload() {
    return _refs.map((r) => ({
      url: r.url,
      role: REF_ROLES.some((x) => x.id === r.role) ? r.role : 'character',
      title: r.title || undefined,
    }));
  }

  function apiBase() {
    return (typeof window.API !== 'undefined' && window.API) || window._seAPI || '';
  }
  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-client-email': window.clientEmail || window.__clientEmail || '',
      'x-client-hash': window.clientHash || window.__clientHash || '',
    };
  }
  function authHeadersMultipart() {
    return {
      'x-client-email': window.clientEmail || window.__clientEmail || '',
      'x-client-hash': window.clientHash || window.__clientHash || '',
    };
  }
  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'info');
  }
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  /** Atlas / Aliyun OSS hotlink-blocks portal Referers — route through API proxy. */
  function mediaSrc(url) {
    if (!url) return '';
    if (/\/api\/media(\/|-fetch)/i.test(url)) return url;
    if (/(aliyuncs\.com|higgsfield\.ai)/i.test(url)) {
      return `${apiBase()}/api/media-fetch?url=${encodeURIComponent(url)}`;
    }
    return url;
  }

  function tileMedia(url, alt, status) {
    const busy = !url && ['generating', 'pending', 'developing', 'assembling'].includes(status);
    if (busy) {
      return `<div class="anim-tile__ph anim-tile__ph--gen" aria-busy="true">
        <span class="anim-tile__gen-label">${esc(status === 'assembling' ? 'Creating' : 'Generating')}</span>
      </div>`;
    }
    if (!url) {
      if (status === 'draft') {
        return `<div class="anim-tile__ph">No clip yet</div>`;
      }
      return `<div class="anim-tile__ph ${status === 'failed' ? 'anim-tile__ph--fail' : ''}">${esc(status === 'failed' ? 'Failed' : (status || '…'))}</div>`;
    }
    const src = mediaSrc(url);
    return `<img class="anim-media" src="${esc(src)}" alt="${esc(alt || '')}" loading="lazy" data-fallback="1" />`;
  }

  function projectHasCharacterRef(p) {
    if (!p) return false;
    if (p.model_plan?.character_ref) return true;
    if (p.character_ref_url) return true;
    return (p.references || []).some((r) => r.role === 'character' && r.url);
  }

  function projectHasStyleRef(p) {
    if (!p) return false;
    if (p.model_plan?.style_ref) return true;
    if (p.style_ref_url) return true;
    return (p.references || []).some((r) => r.role === 'style' && r.url)
      || ((p.reference_urls || []).length > 1 && !(p.references || []).length);
  }

  function modelLine(p) {
    if (!p?.model_plan?.imageEndpoint && !projectHasCharacterRef(p)) return '';
    const ep = p.model_plan?.imageEndpoint || 'unknown';
    const short = ep.split('/').slice(-2).join('/');
    const char = projectHasCharacterRef(p) ? ' · identity from Character ref' : ' · no Character ref';
    const style = projectHasStyleRef(p) ? ' · Style ref for look' : '';
    return `<div class="anim-model-line">Model: ${esc(short)}${char}${style}</div>`;
  }

  async function animFetch(path, opts) {
    const resp = await fetch(apiBase() + path, Object.assign({}, opts || {}, { headers: authHeaders() }));
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || resp.statusText);
    return data;
  }

  function stopPoll() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = null;
  }

  function projectHasBusyScenes(p) {
    return (p?.scenes || []).some((s) => s.status === 'generating' || s.status === 'pending');
  }

  /** Avoid remounting <video> on every poll tick (causes READY shots to spin). */
  function projectUiFingerprint(p) {
    if (!p) return '';
    const scenes = (p.scenes || []).map((s) => [
      s.id, s.order || 0, s.status, s.video_url || '', s.keyframe_url || '', s.error || '', s.motion || '',
      s.active_take_id || '', (s.takes || []).length, s.prompt || '', s.title || '',
    ]);
    return JSON.stringify([
      p.id, p.status, p.error || '', p.final_url || '', p.final_pre_caption_url || '',
      p.final_assembled_at || '', p.active_final_id || '',
      p.caption_burn_error || '', p.last_burned_caption_style?.preset_id || '',
      p.last_burned_caption_style?.burned_at || '', p.last_assemble_summary || '',
      (p.final_history || []).length, _captionStudioOpen ? 1 : 0, scenes,
    ]);
  }
  let _canvasFp = '';
  let _pastFinalsOpen = false;
  /** Local shot prompt edits — survive poll remounts until regenerate. */
  const _shotPromptDrafts = Object.create(null);
  /** Caption style draft — survives canvas remounts so Rebuild burns what you picked. */
  let _captionStyleDraft = null;

  function formatTakeTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function sceneTakes(scene) {
    return Array.isArray(scene?.takes) ? scene.takes : [];
  }

  function activeTakeIndex(scene) {
    const takes = sceneTakes(scene);
    if (!takes.length) return -1;
    if (scene.active_take_id) {
      const i = takes.findIndex((t) => t.id === scene.active_take_id);
      if (i >= 0) return i;
    }
    if (scene.video_url) {
      const i = takes.findIndex((t) => t.video_url === scene.video_url);
      if (i >= 0) return i;
    }
    return takes.length - 1;
  }

  function takeNavHtml(scene) {
    if (!scene?.video_url) return '';
    const takes = sceneTakes(scene);
    const N = Math.max(1, takes.length);
    const idx = takes.length ? Math.max(0, activeTakeIndex(scene)) : 0;
    const n = idx + 1;
    return `
      <div class="anim-take-nav" data-scene="${esc(scene.id)}">
        <button type="button" class="anim-take-nav__btn anim-take-prev" data-scene="${esc(scene.id)}" ${takes.length < 2 || idx <= 0 ? 'disabled' : ''} aria-label="Previous take">‹</button>
        <span class="anim-take-nav__label">${n}/${N}</span>
        <button type="button" class="anim-take-nav__btn anim-take-next" data-scene="${esc(scene.id)}" ${takes.length < 2 || idx >= N - 1 ? 'disabled' : ''} aria-label="Next take">›</button>
        <button type="button" class="anim-btn anim-btn--ghost anim-expand-btn" data-expand="shot" data-scene="${esc(scene.id)}" style="padding:4px 8px;font-size:0.65rem;width:auto;">Expand</button>
      </div>`;
  }

  function closeExpandModal() {
    document.getElementById('anim-expand-modal')?.remove();
  }

  function openExpandModal({ url, title, kind, sceneId, takeId, finalId, canUse }) {
    closeExpandModal();
    if (!url) return;
    const root = document.getElementById('dash-content')
      || document.getElementById('animation-studio-root')
      || document.querySelector('.anim-shell')?.parentElement
      || document.body;
    if (!root) return;
    const useLabel = kind === 'final' ? 'Use this final' : 'Use this take';
    const modal = document.createElement('div');
    modal.id = 'anim-expand-modal';
    modal.className = 'anim-expand';
    modal.innerHTML = `
      <div class="anim-expand__backdrop" data-close="1"></div>
      <div class="anim-expand__panel" role="dialog" aria-modal="true" aria-label="${esc(title || 'Preview')}">
        <div class="anim-expand__top">
          <div class="anim-expand__title">${esc(title || 'Preview')}</div>
          <button type="button" class="anim-btn anim-btn--ghost anim-expand__close" data-close="1" style="width:auto;padding:6px 10px;">✕</button>
        </div>
        <video class="anim-expand__video" src="${esc(mediaSrc(url))}" controls autoplay playsinline></video>
        <div class="anim-expand__actions">
          ${canUse ? `<button type="button" class="anim-btn" id="anim-expand-use">${esc(useLabel)}</button>` : ''}
        </div>
      </div>`;
    root.appendChild(modal);
    modal.querySelectorAll('[data-close]').forEach((el) => {
      el.addEventListener('click', closeExpandModal);
    });
    const onKey = (e) => {
      if (e.key === 'Escape') {
        closeExpandModal();
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);
    document.getElementById('anim-expand-use')?.addEventListener('click', async () => {
      try {
        if (kind === 'final' && finalId) await selectFinal(finalId);
        else if (kind === 'shot' && sceneId && takeId) await selectTake(sceneId, takeId);
        closeExpandModal();
      } catch (e) {
        toast(e.message || 'Could not restore', 'error');
      }
    });
  }

  function startPoll(opts = {}) {
    stopPoll();
    const onIdle = typeof opts.onIdle === 'function' ? opts.onIdle : null;
    _pollTimer = setInterval(async () => {
      if (!_project?.id) return;
      try {
        const data = await animFetch(`/api/animation/projects/${_project.id}`);
        _project = data.project;
        const fp = projectUiFingerprint(_project);
        const activePrompt = document.activeElement?.classList?.contains('anim-shot__prompt-edit')
          ? document.activeElement
          : null;
        const focusSceneId = activePrompt?.dataset?.scene || null;
        if (fp !== _canvasFp) {
          // Never stamp fingerprint without rendering — that permanently hides
          // new videos if the user had a shot prompt focused when regen finished.
          _canvasFp = fp;
          renderCanvas();
          renderChat();
          if (focusSceneId) {
            const ta = document.querySelector(`.anim-shot__prompt-edit[data-scene="${focusSceneId}"]`);
            if (ta && !ta.disabled) {
              const len = ta.value.length;
              ta.focus();
              try { ta.setSelectionRange(len, len); } catch (_) {}
            }
          }
        }
        const projectBusy = ['developing', 'generating', 'assembling'].includes(_project.status);
        if (projectBusy || projectHasBusyScenes(_project)) {
          /* keep polling */
        } else {
          stopPoll();
          if (onIdle) {
            try { onIdle(); } catch (_) {}
          }
        }
      } catch (_) {}
    }, 3000);
  }

  function modeOptions() {
    return (_meta?.modes || []).map((m) =>
      `<option value="${esc(m.id)}" ${(_project?.mode || 'video') === m.id ? 'selected' : ''}>${esc(m.label)}</option>`
    ).join('');
  }
  function lookOptions() {
    return (_meta?.looks || [
      { id: 'realistic', label: 'Realistic' },
      { id: 'stylized', label: 'Stylized' },
      { id: 'cartoon', label: 'Cartoon / animated' },
    ]).map((l) =>
      `<option value="${esc(l.id)}" ${(_project?.look || 'stylized') === l.id ? 'selected' : ''}>${esc(l.label)}</option>`
    ).join('');
  }

  function currentMotionMode() {
    return _project?.motion_mode || _meta?.default_motion_mode || 'auto';
  }

  function motionOptions() {
    const modes = _meta?.motion_modes || [
      { id: 'auto', label: 'Auto (DreamActor)' },
      { id: 'drive', label: 'Upload drive' },
      { id: 'kling', label: 'I2V only' },
    ];
    const cur = currentMotionMode();
    return modes.map((m) =>
      `<option value="${esc(m.id)}" ${cur === m.id ? 'selected' : ''}>${esc(m.label)}</option>`
    ).join('');
  }

  function currentI2vModel() {
    return _project?.pipeline?.i2v_model || _meta?.default_i2v_model || 'seedance';
  }

  function i2vOptions() {
    const models = _meta?.i2v_models || [
      { id: 'seedance', label: 'Seedance 2.0' },
      { id: 'kling', label: 'Kling' },
      { id: 'auto', label: 'Auto (Seedance→Kling)' },
    ];
    const cur = currentI2vModel();
    return models.map((m) =>
      `<option value="${esc(m.id)}" ${cur === m.id ? 'selected' : ''}>${esc(m.label)}</option>`
    ).join('');
  }

  function templateOptions(selected) {
    const tpls = _meta?.motion_templates || [
      { id: 'hold', label: 'Hold' },
      { id: 'gentle-pan', label: 'Gentle pan' },
      { id: 'push-in', label: 'Push in' },
      { id: 'parallax-lite', label: 'Parallax lite' },
    ];
    const cur = selected || _project?.motion_template_id || '';
    return `<option value="">Template (optional)</option>` + tpls.map((t) =>
      `<option value="${esc(t.id)}" ${cur === t.id ? 'selected' : ''}>${esc(t.label)}</option>`
    ).join('');
  }

  function motionHint() {
    const id = document.getElementById('anim-motion')?.value || currentMotionMode();
    const hit = (_meta?.motion_modes || []).find((m) => m.id === id);
    if (hit?.hint) return hit.hint;
    if (id === 'drive') return 'Upload a driving video for motion — DreamActor maps your locked character onto it.';
    if (id === 'kling') return 'I2V only (no DreamActor) — uses Seedance/Kling from the I2V select.';
    return 'Seedream keyframe → Seedance motion (spatial-stable) → DreamActor identity.';
  }

  function assembleFlags() {
    const a = _project?.pipeline?.assemble || {};
    return {
      vo: a.vo !== false,
      captions: a.captions !== false,
      music: a.music !== false,
      outro: a.outro !== false,
    };
  }

  function captionPresets() {
    return Array.isArray(_meta?.caption_presets) ? _meta.caption_presets : [];
  }

  function normalizeCaptionStyle(input) {
    const presets = captionPresets();
    const fallback = _meta?.default_caption_style || presets[0]?.style || {
      mode: 'karaoke', preset_id: 'bold-pop', font_family: 'Inter', font_size: 52, font_weight: 800,
      color: '#FFFFFF', highlight_color: '#FFE14D', outline_color: '#000000', outline_width: 4,
      shadow: { x: 0, y: 3, blur: 0, color: 'rgba(0,0,0,0.65)' },
      background: { enabled: false, color: 'rgba(0,0,0,0.45)', padding: 12, radius: 10 },
      position: { y_pct: 78, align: 'center' }, animation: 'pop', words_per_line: 4, text_case: 'as_is',
    };
    const s = input && typeof input === 'object' ? { ...fallback, ...input } : { ...fallback };
    if (!['karaoke', 'phrase', 'static'].includes(s.mode)) s.mode = 'karaoke';
    if (!['none', 'pop', 'fade', 'bounce'].includes(s.animation)) s.animation = 'pop';
    if (!['as_is', 'upper', 'title'].includes(s.text_case)) s.text_case = 'as_is';
    s.words_per_line = Math.max(1, Math.min(10, Number(s.words_per_line) || 3));
    s.font_size = Math.max(16, Math.min(96, Number(s.font_size) || 42));
    s.max_width_pct = Math.max(40, Math.min(96, Number(s.max_width_pct) || 78));
    s.letter_spacing = Math.max(0, Math.min(6, Number(s.letter_spacing) || 0));
    s.position = s.position || { y_pct: 74, align: 'center' };
    s.shadow = s.shadow || fallback.shadow;
    s.background = s.background || fallback.background;
    return s;
  }

  function applyCaptionCase(text, textCase) {
    const t = String(text || '');
    if (textCase === 'upper') return t.toUpperCase();
    if (textCase === 'title') return t.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    return t;
  }

  function estimatePhraseCues(text, durationSec) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const dur = Math.max(2, Number(durationSec) || 8);
    const each = dur / words.length;
    return words.map((w, i) => ({
      i, text: w, start: i * each, end: Math.min(dur, (i + 1) * each),
    }));
  }

  function captionCuesForPreview() {
    if (Array.isArray(_project?.caption_cues) && _project.caption_cues.length) return _project.caption_cues;
    const text = document.getElementById('anim-caption-text')?.value
      || _project?.caption_text
      || document.getElementById('anim-vo-script')?.value
      || _project?.vo_script
      || _project?.agent_brief?.caption
      || '';
    return estimatePhraseCues(text, 8);
  }

  function captionLayoutAtTime(cues, style, t) {
    const s = normalizeCaptionStyle(style);
    const list = Array.isArray(cues) ? cues : [];
    const n = s.words_per_line || 4;
    if (s.mode === 'static' || !list.length) {
      const text = applyCaptionCase(
        list.map((c) => c.text).join(' ')
          || document.getElementById('anim-caption-text')?.value
          || _project?.caption_text
          || '',
        s.text_case
      );
      return { words: text ? [{ text, active: false }] : [], activeIndex: -1 };
    }
    // Find active chunk containing t
    let chunkStart = 0;
    while (chunkStart < list.length) {
      const chunk = list.slice(chunkStart, chunkStart + n);
      const start = chunk[0].start;
      const end = chunk[chunk.length - 1].end;
      if (t >= start && t <= end + 0.05) {
        let activeIndex = -1;
        const words = chunk.map((w, i) => {
          const active = t >= w.start && t < w.end + 0.02;
          if (active) activeIndex = i;
          return { text: applyCaptionCase(w.text, s.text_case), active: s.mode === 'karaoke' ? active : false };
        });
        // If between words in karaoke, highlight nearest spoken
        if (s.mode === 'karaoke' && activeIndex < 0) {
          for (let i = chunk.length - 1; i >= 0; i--) {
            if (t >= chunk[i].start) { words[i].active = true; activeIndex = i; break; }
          }
        }
        return { words, activeIndex };
      }
      if (t < start) break;
      chunkStart += n;
    }
    return { words: [], activeIndex: -1 };
  }

  function readCaptionStyleFromDom() {
    const base = normalizeCaptionStyle(_captionStyleDraft || _project?.caption_style);
    if (!document.getElementById('anim-cap-mode')) {
      return _captionStyleDraft ? normalizeCaptionStyle(_captionStyleDraft) : base;
    }
    const num = (id, fallback) => {
      const raw = document.getElementById(id)?.value;
      if (raw == null || raw === '') return fallback;
      const n = Number(raw);
      return Number.isFinite(n) ? n : fallback;
    };
    const presetId = document.getElementById('anim-cap-preset')?.value || base.preset_id;
    const next = normalizeCaptionStyle({
      ...base,
      preset_id: presetId,
      mode: document.getElementById('anim-cap-mode')?.value || base.mode,
      font_size: num('anim-cap-size', base.font_size),
      color: document.getElementById('anim-cap-color')?.value || base.color,
      highlight_color: document.getElementById('anim-cap-highlight')?.value || base.highlight_color,
      outline_color: document.getElementById('anim-cap-outline')?.value || base.outline_color,
      outline_width: num('anim-cap-outline-w', base.outline_width ?? 0),
      position: {
        y_pct: num('anim-cap-y', base.position?.y_pct || 74),
        align: 'center',
      },
      animation: document.getElementById('anim-cap-anim')?.value || base.animation,
      words_per_line: num('anim-cap-wpl', base.words_per_line || 3),
      text_case: document.getElementById('anim-cap-case')?.value || base.text_case,
      max_width_pct: num('anim-cap-width', base.max_width_pct || 78),
      background: {
        ...(base.background || {}),
        enabled: !!document.getElementById('anim-cap-box')?.checked,
        padding: num('anim-cap-pad', base.background?.padding ?? 8),
        radius: num('anim-cap-radius', base.background?.radius ?? 8),
      },
    });
    _captionStyleDraft = next;
    return next;
  }

  function currentCaptionStyle() {
    if (document.getElementById('anim-cap-mode')) return readCaptionStyleFromDom();
    if (_captionStyleDraft) return normalizeCaptionStyle(_captionStyleDraft);
    return normalizeCaptionStyle(_project?.caption_style || _meta?.default_caption_style);
  }

  function paintCaptionOverlay(t) {
    const stage = document.getElementById('anim-cap-overlay');
    if (!stage) return;
    // Live overlay is edit-preview only. After Rebuild, captions are burned into
    // the Final — leaving the overlay on stacks a second caption on top.
    if (!_captionStudioOpen) {
      stage.innerHTML = '';
      stage.hidden = true;
      stage.setAttribute('aria-hidden', 'true');
      return;
    }
    stage.hidden = false;
    stage.setAttribute('aria-hidden', 'false');
    const style = readCaptionStyleFromDom();
    const layout = captionLayoutAtTime(captionCuesForPreview(), style, t);
    const y = style.position?.y_pct ?? 74;
    const outline = Math.max(0, style.outline_width || 0);
    const widthPct = style.max_width_pct || 78;
    const pad = style.background?.padding ?? 8;
    const rad = style.background?.radius ?? 8;
    const box = style.background?.enabled
      ? `background:${style.background.color};padding:${Math.max(2, Math.round(pad * 0.55))}px ${Math.max(6, Math.round(pad * 0.9))}px;border-radius:${rad >= 200 ? 999 : Math.round(rad * 0.55)}px;`
      : '';
    // Preview is ~280px wide vs 1080 design; scale font ~0.38 so Size slider feels true.
    const previewPx = Math.max(11, Math.round((style.font_size || 42) * 0.38));
    stage.style.top = `${y}%`;
    stage.style.width = `${widthPct}%`;
    stage.style.transform = 'translate(-50%, -50%)';
    const sizeLabel = document.getElementById('anim-cap-size-val');
    if (sizeLabel) sizeLabel.textContent = String(style.font_size || 42);
    const widthLabel = document.getElementById('anim-cap-width-val');
    if (widthLabel) widthLabel.textContent = `${widthPct}%`;
    stage.innerHTML = layout.words.length
      ? `<span class="anim-cap-line" style="${box}font-size:${previewPx}px;font-weight:${style.font_weight || 800};color:${style.color};letter-spacing:${(style.letter_spacing || 0) * 0.4}px;-webkit-text-stroke:${outline ? Math.max(0.6, outline * 0.3) : 0}px ${style.outline_color};paint-order:stroke fill;text-shadow:${style.background?.enabled ? 'none' : `0 ${style.shadow?.y || 2}px ${style.shadow?.blur || 0}px ${style.shadow?.color || 'rgba(0,0,0,0.55)'}`};">${
        layout.words.map((w) => `<span class="anim-cap-word${w.active ? ' is-active' : ''}" style="${w.active ? `color:${style.highlight_color};` : ''}">${esc(w.text)}</span>`).join(' ')
      }</span>`
      : '';
  }

  function bindCaptionPreview() {
    const vid = document.querySelector('.anim-final__video');
    const stage = document.getElementById('anim-cap-overlay');
    if (!vid || !stage) return;
    const tick = () => {
      paintCaptionOverlay(vid.currentTime || 0);
      if (!vid.paused && !vid.ended) _captionPreviewRaf = requestAnimationFrame(tick);
    };
    const kick = () => {
      cancelAnimationFrame(_captionPreviewRaf);
      paintCaptionOverlay(vid.currentTime || 0);
      if (!vid.paused) _captionPreviewRaf = requestAnimationFrame(tick);
    };
    vid.addEventListener('timeupdate', () => paintCaptionOverlay(vid.currentTime || 0));
    vid.addEventListener('play', kick);
    vid.addEventListener('seeked', kick);
    vid.addEventListener('pause', () => {
      cancelAnimationFrame(_captionPreviewRaf);
      paintCaptionOverlay(vid.currentTime || 0);
    });
    paintCaptionOverlay(vid.currentTime || 0);
  }

  function renderCaptionStudioPanel(p) {
    const style = normalizeCaptionStyle(_captionStyleDraft || p.caption_style || _meta?.default_caption_style);
    const presets = captionPresets();
    const cuesN = Array.isArray(p.caption_cues) ? p.caption_cues.length : 0;
    const size = style.font_size || 42;
    const widthPct = style.max_width_pct || 78;
    return `
      <div class="anim-cap-studio" id="anim-cap-studio" ${_captionStudioOpen ? '' : 'hidden'}>
        <div class="anim-cap-studio__head">
          <strong>Caption Studio</strong>
          <button type="button" class="anim-btn anim-btn--ghost" id="anim-cap-close" style="width:auto;padding:4px 8px;font-size:0.65rem;">Close</button>
        </div>
        <div style="font-size:0.62rem;color:rgba(255,255,255,0.4);margin-bottom:8px;line-height:1.35;">
          Live preview on Final · ${cuesN ? `${cuesN} word cues from VO` : 'Estimated timing until Rebuild (VO + Captions)'}
        </div>
        <div class="anim-row" style="margin:0 0 8px;">
          <select id="anim-cap-mode" class="anim-select" title="Mode">
            ${['karaoke', 'phrase', 'static'].map((m) => `<option value="${m}" ${style.mode === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
          <select id="anim-cap-preset" class="anim-select" title="Preset">
            ${(presets.length ? presets : [{ id: style.preset_id || 'reels-classic', label: 'Reels Classic' }]).map((pr) =>
              `<option value="${esc(pr.id)}" ${style.preset_id === pr.id ? 'selected' : ''}>${esc(pr.label || pr.id)}</option>`).join('')}
          </select>
        </div>
        <div class="anim-cap-quick">
          <div class="anim-cap-chips" id="anim-cap-size-chips">
            <span class="anim-cap-chips__label">Size</span>
            ${[[28, 'S'], [36, 'M'], [42, 'L'], [54, 'XL']].map(([v, lab]) =>
              `<button type="button" class="anim-cap-chip${Number(size) === v ? ' is-on' : ''}" data-cap-size="${v}">${lab}</button>`).join('')}
          </div>
          <label class="anim-cap-slider">Font size <strong id="anim-cap-size-val">${size}</strong>
            <input id="anim-cap-size" type="range" min="18" max="72" value="${size}" />
          </label>
          <label class="anim-cap-slider">Caption width <strong id="anim-cap-width-val">${widthPct}%</strong>
            <input id="anim-cap-width" type="range" min="45" max="94" value="${widthPct}" />
          </label>
          <label class="anim-cap-slider">Vertical <strong>${style.position?.y_pct || 74}%</strong>
            <input id="anim-cap-y" type="range" min="50" max="92" value="${style.position?.y_pct || 74}" />
          </label>
          <div class="anim-cap-inline">
            <label>Words/line <input id="anim-cap-wpl" type="number" min="1" max="8" value="${style.words_per_line || 3}" /></label>
            <label class="anim-cap-check"><input type="checkbox" id="anim-cap-box" ${style.background?.enabled ? 'checked' : ''}/> Box</label>
            <label>Pad <input id="anim-cap-pad" type="number" min="0" max="24" value="${style.background?.padding ?? 8}" /></label>
            <label>Radius <input id="anim-cap-radius" type="number" min="0" max="999" value="${style.background?.radius ?? 8}" /></label>
          </div>
        </div>
        <details class="anim-cap-advanced" open>
          <summary>Colors &amp; extras</summary>
          <div class="anim-cap-grid">
            <label>Outline <input id="anim-cap-outline-w" type="number" min="0" max="10" value="${style.outline_width || 0}" style="width:64px;" /></label>
            <label>Fill <input id="anim-cap-color" type="color" value="${(style.color || '#FFFFFF').slice(0, 7)}" /></label>
            <label>Highlight <input id="anim-cap-highlight" type="color" value="${(style.highlight_color || '#FFE566').slice(0, 7)}" /></label>
            <label>Outline color <input id="anim-cap-outline" type="color" value="${(style.outline_color || '#000000').slice(0, 7)}" /></label>
            <label>Anim
              <select id="anim-cap-anim" class="anim-select" style="width:auto;">
                ${['none', 'pop', 'fade', 'bounce'].map((a) => `<option value="${a}" ${style.animation === a ? 'selected' : ''}>${a}</option>`).join('')}
              </select>
            </label>
            <label>Case
              <select id="anim-cap-case" class="anim-select" style="width:auto;">
                ${['as_is', 'upper', 'title'].map((c) => `<option value="${c}" ${style.text_case === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </label>
          </div>
        </details>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
          <button type="button" class="anim-btn anim-btn--ghost" id="anim-cap-save" style="width:auto;padding:6px 10px;font-size:0.68rem;">Save style</button>
          <span style="font-size:0.62rem;color:rgba(255,255,255,0.38);align-self:center;">Shrink width / pad to tighten the box · Rebuild to burn</span>
        </div>
      </div>`;
  }

  async function syncMotionSettings() {
    if (!_project?.id) return;
    const motion_mode = document.getElementById('anim-motion')?.value || currentMotionMode();
    const i2v_model = document.getElementById('anim-i2v')?.value || currentI2vModel();
    const motion_template_id = document.getElementById('anim-template')?.value || null;
    const body = {
      motion_mode,
      i2v_model,
      motion_template_id: motion_template_id || null,
      driving_video_url: _project.driving_video_url || null,
      identity_source: 'upload',
      music_bed_url: _project.music_bed_url || null,
      outro_url: _project.outro_url || null,
    };
    if (document.getElementById('anim-flag-vo')) {
      body.assemble = assembleFlagsFromDom();
    }
    if (document.getElementById('anim-vo-script')) {
      body.vo_script = document.getElementById('anim-vo-script').value;
    }
    if (document.getElementById('anim-caption-text')) {
      body.caption_text = document.getElementById('anim-caption-text').value;
    }
    if (document.getElementById('anim-cap-mode') || _project.caption_style || _captionStyleDraft) {
      body.caption_style = currentCaptionStyle();
    }
    if (document.getElementById('anim-music-prompt')) {
      body.music_prompt = document.getElementById('anim-music-prompt').value;
    }
    if (document.getElementById('anim-music-length')) {
      body.music_length_ms = Number(document.getElementById('anim-music-length').value) || 30000;
    }
    if (document.getElementById('anim-music-volume')) {
      body.music_volume = Math.max(0, Math.min(1, Number(document.getElementById('anim-music-volume').value) / 100));
    }
    if (document.getElementById('anim-vo-volume')) {
      body.vo_volume = Math.max(0, Math.min(1, Number(document.getElementById('anim-vo-volume').value) / 100));
    }
    try {
      const data = await animFetch(`/api/animation/projects/${_project.id}/settings`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      _project = data.project;
    } catch (e) {
      toast(e.message || 'Could not save motion settings', 'error');
    }
  }

  function assembleLooksStuck(p) {
    if (!p || p.status !== 'assembling') return false;
    const started = Date.parse(p.assembling_started_at || '') || 0;
    if (!started) return true; // legacy / interrupted job with no timestamp
    return (Date.now() - started) > 90 * 1000;
  }

  function assembleFlagsFromDom() {
    if (!document.getElementById('anim-flag-vo')) return assembleFlags();
    return {
      vo: !!document.getElementById('anim-flag-vo')?.checked,
      captions: !!document.getElementById('anim-flag-captions')?.checked,
      music: !!document.getElementById('anim-flag-music')?.checked,
      outro: !!document.getElementById('anim-flag-outro')?.checked,
    };
  }

  async function uploadDrivingVideo(file) {
    if (!file) return;
    if (!file.type.startsWith('video/')) return toast('Please upload a video (mp4/mov)', 'error');
    if (file.size > 80 * 1024 * 1024) return toast('Driving video must be under 80MB', 'error');
    toast('Uploading driving video…', 'info');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('video', file);
      const res = await fetch(`${apiBase()}/api/studio/upload-video`, {
        method: 'POST',
        headers: authHeadersMultipart(),
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
      if (!_project?.id) {
        const created = await animFetch('/api/animation/projects', {
          method: 'POST',
          body: JSON.stringify({
            mode: document.getElementById('anim-mode')?.value || 'video',
            look: document.getElementById('anim-look')?.value || 'stylized',
            motion_mode: 'drive',
            driving_video_url: data.url,
          }),
        });
        _project = created.project;
      } else {
        _project.driving_video_url = data.url;
        _project.motion_mode = 'drive';
        const sel = document.getElementById('anim-motion');
        if (sel) sel.value = 'drive';
        await syncMotionSettings();
      }
      renderDriveControls();
      toast('Driving video attached', 'success');
    } catch (e) {
      toast(e.message || 'Driving video upload failed', 'error');
    }
  }

  function renderDriveControls() {
    const wrap = document.getElementById('anim-drive-wrap');
    if (!wrap) return;
    const mode = document.getElementById('anim-motion')?.value || currentMotionMode();
    wrap.hidden = mode !== 'drive';
    const status = document.getElementById('anim-drive-status');
    if (status) {
      const url = _project?.driving_video_url;
      status.textContent = url ? 'Driving video ready' : 'No driving video yet';
      status.style.color = url ? '#86EFAC' : 'rgba(255,255,255,0.4)';
    }
    const hint = document.getElementById('anim-motion-hint');
    if (hint) hint.textContent = motionHint();
  }

  function statusBadge(status) {
    const colors = {
      brief: '#94A3B8',
      brief_ready: '#A78BFA',
      developing: '#FBBF24',
      generating: '#FBBF24',
      character_review: '#F472B6',
      assembling: '#38BDF8',
      ready: '#34D399',
      failed: '#F87171',
      pending: '#64748B',
      draft: '#94A3B8',
    };
    const c = colors[status] || '#94A3B8';
    return `<span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:${c}22;border:1px solid ${c}55;color:${c};font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${esc(status || 'idle')}</span>`;
  }

  const ANIM_MAX_SCENES_UI = 6;

  function projectHasUsableCharLock(p) {
    if (!p) return false;
    if (projectHasCharacterRef(p)) return true;
    if (p.character_pack?.locked) return true;
    if (p.character_pack?.hero_url) return true;
    return (p.character_pack?.views || []).some((v) => v && v.url);
  }

  function addSceneDisabledReason(p) {
    if (!p) return 'Open a project first';
    if (!projectHasUsableCharLock(p)) return 'Approve character lock first';
    if ((p.scenes || []).length >= ANIM_MAX_SCENES_UI) return `Timeline capped at ${ANIM_MAX_SCENES_UI} shots`;
    if (p.status === 'assembling') return 'Wait for Final assemble to finish';
    if (projectHasBusyScenes(p)) return 'Wait for shots to finish generating';
    return '';
  }

  function projectTitle(p) {
    return p?.agent_brief?.title || p?.user_prompt?.slice(0, 48) || 'Untitled project';
  }

  function projectMediaExpired(p) {
    if (!p) return false;
    if (p.media_expired) return true;
    // Summaries omit character_pack — trust media_expired from the API.
    // Full projects: only "expired" when every media URL is dead ephemeral.
    const urls = [];
    for (const v of p.character_pack?.views || []) if (v?.url) urls.push(v.url);
    for (const r of p.references || []) if (r?.url) urls.push(r.url);
    for (const u of p.reference_urls || []) if (u) urls.push(u);
    if (p.character_ref_url) urls.push(p.character_ref_url);
    if (p.final_url) urls.push(p.final_url);
    for (const s of p.scenes || []) {
      if (s?.keyframe_url) urls.push(s.keyframe_url);
      if (s?.video_url) urls.push(s.video_url);
    }
    if (!urls.length) return false;
    const ephemeral = (u) => /\/api\/media\/[a-f0-9]+/i.test(String(u || ''));
    const durable = urls.some((u) => !ephemeral(u));
    if (durable) return false;
    return urls.every(ephemeral);
  }

  function projectNeedsCharReupload(p) {
    if (!p) return false;
    if (p.needs_char_reupload) return true;
    if (projectMediaExpired(p)) return false;
    const views = p.character_pack?.views || [];
    if (!views.length) return false;
    return views.every((v) => !v.url || /\/api\/media\/[a-f0-9]+/i.test(String(v.url)));
  }

  async function refreshRecent({ silent } = {}) {
    _recentLoading = true;
    try {
      const list = await animFetch('/api/animation/projects');
      _recent = list.projects || [];
      if (!silent && list.purged > 0) {
        toast(`Removed ${list.purged} expired project${list.purged === 1 ? '' : 's'} (old links from a server restart)`, 'info');
      }
    } catch (e) {
      // Keep prior cache on failure so a slow/flaky list doesn't wipe the home screen.
      if (!_recent.length) {
        _recent = [];
        if (!silent) toast(e.message || 'Could not load recent projects', 'error');
      }
    } finally {
      _recentLoading = false;
    }
  }

  async function deleteProject(id, { silent } = {}) {
    if (!id) return;
    try {
      const data = await animFetch(`/api/animation/projects/${id}`, { method: 'DELETE' });
      _recent = data.projects || _recent.filter((p) => p.id !== id);
      if (_project?.id === id) {
        _project = null;
        _refs = [];
        stopPoll();
      }
      if (!silent) toast('Expired project removed', 'success');
      renderCanvas();
      renderChat();
      renderRefs();
    } catch (e) {
      if (!silent) toast(e.message || 'Could not delete project', 'error');
    }
  }

  async function openProject(id) {
    if (!id || _busy) return;
    try {
      const data = await animFetch(`/api/animation/projects/${id}`);
      _project = data.project;
      if (projectMediaExpired(_project)) {
        await deleteProject(_project.id, { silent: true });
        toast('That project’s images expired after a server restart. Start a new one and re-upload refs.', 'error');
        return;
      }
      if (projectNeedsCharReupload(_project)) {
        toast('Char sheet links died after a restart — re-upload Char refs. Shots/Finals on CDN are still here.', 'warning');
      }
      _refs = (_project.references || []).map((r) => ({
        url: r.url,
        title: r.title || 'Ref',
        role: r.role || 'character',
      }));
      if (!_refs.length && _project.reference_urls?.length) {
        _refs = _project.reference_urls.map((url, i) => ({
          url,
          title: 'Ref',
          role: i === 0 ? 'character' : i === 1 ? 'style' : 'scene',
        }));
      }
      if (!_refs.length && _project.character_ref_url) {
        _refs = [{ url: _project.character_ref_url, title: 'Ref', role: 'character' }];
      }
      // Drop dead ephemeral refs from the chip strip so broken thumbnails don't stick around.
      _refs = _refs.filter((r) => r.url && !/\/api\/media\/[a-f0-9]+/i.test(String(r.url)));
      renderCanvas();
      renderChat();
      renderRefs();
      if (['developing', 'generating', 'assembling'].includes(_project.status) || projectHasBusyScenes(_project)) {
        startPoll();
      }
      else stopPoll();
      toast(`Opened ${projectTitle(_project)}`, 'success');
    } catch (e) {
      await refreshRecent();
      _project = null;
      renderCanvas();
      renderChat();
      renderRefs();
      toast(e.message || 'Could not open project', 'error');
    }
  }

  function renderCanvas() {
    const el = document.getElementById('anim-canvas-body');
    if (!el) return;
    _canvasFp = projectUiFingerprint(_project);
    const p = _project;
    if (!p) {
      // Show every saved project. Fully expired ones can still be deleted from the row;
      // do not hide the list just because Char sheets need a re-upload.
      const listed = _recent.filter((rp) => !projectMediaExpired(rp));
      const recentHtml = _recentLoading ? `
        <div class="anim-placeholder-row" style="margin-top:22px;max-width:420px;margin-left:auto;margin-right:auto;">Loading recent projects…</div>`
        : listed.length ? `
        <div class="anim-recent">
          <div class="anim-section__label">Recent projects</div>
          <div class="anim-recent__list">
            ${listed.slice(0, 12).map((rp) => `
              <div class="anim-recent__row">
                <button type="button" class="anim-recent__item" data-open-project="${esc(rp.id)}">
                  <span class="anim-recent__title">${esc(projectTitle(rp))}</span>
                  <span class="anim-recent__meta">${statusBadge(rp.status)}${projectNeedsCharReupload(rp) ? ' <span class="anim-recent__mode">re-upload Char</span>' : ''} <span class="anim-recent__mode">${esc(rp.mode || '')}</span></span>
                </button>
                <button type="button" class="anim-btn anim-btn--ghost anim-recent__del" data-del-project="${esc(rp.id)}" title="Delete project">✕</button>
              </div>`).join('')}
          </div>
        </div>` : `
        <div class="anim-placeholder-row" style="margin-top:22px;max-width:420px;margin-left:auto;margin-right:auto;">No saved projects yet — send a prompt to start one. Generated images now persist on CDN across refreshes.</div>`;
      el.innerHTML = `
        <div class="anim-empty">
          <div class="anim-empty__title">Animation canvas</div>
          <div class="anim-empty__desc">Pick a mode, describe what you want, and Claude will rewrite it into a production brief. Accept to generate character views, scenes, and shots here.</div>
          <div class="anim-empty__hint">Tip: tag refs as <strong>Char</strong> + <strong>Style</strong>, then run. Uploads must land on CDN (not ephemeral links).</div>
        </div>
        ${recentHtml}`;
      el.querySelectorAll('[data-open-project]').forEach((btn) => {
        btn.addEventListener('click', () => openProject(btn.dataset.openProject));
      });
      el.querySelectorAll('[data-del-project]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteProject(btn.dataset.delProject);
        });
      });
      return;
    }

    const views = p.character_pack?.views || [];
    const plannedViews = (!views.length && ['developing', 'generating', 'assembling'].includes(p.status) && p.agent_brief?.multi_view_plan?.length)
      ? p.agent_brief.multi_view_plan.slice(0, 6).map((label) => ({ label, url: null, status: 'generating' }))
      : views;
    const scenes = (p.scenes || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const brief = p.agent_brief;

    el.innerHTML = `
      <div class="anim-canvas-top">
        <div>
          <div style="font-size:0.72rem;color:rgba(255,255,255,0.4);margin-bottom:4px;">Project</div>
          <div style="font-weight:700;font-size:1rem;color:#F8FAFC;">${esc(brief?.title || 'Untitled')}</div>
        </div>
        ${statusBadge(p.status)}
      </div>

      <div class="anim-section">
        <div class="anim-section__label">Character / asset lock ${p.character_pack?.locked ? '· Locked' : ''}${(p.character_pack?.cast || []).length > 1 ? ` · Cast ${(p.character_pack.cast || []).length}` : ''}</div>
        ${modelLine(p)}
        ${plannedViews.length ? `
        <div class="anim-strip">
          ${plannedViews.map((v) => `
            <div class="anim-tile">
              ${tileMedia(v.url, v.character_name || v.label, v.status || p.status)}
              <div class="anim-tile__cap">${esc(v.character_name || v.label)}${v.model ? `<span class="anim-tile__model">${esc(String(v.model).split('/').pop())}</span>` : ''}</div>
            </div>`).join('')}
        </div>
        <div class="anim-expired-banner" id="anim-expired-banner" hidden>
          <div>${projectNeedsCharReupload(p) && !projectMediaExpired(p)
            ? 'Char sheet links died after a server restart, but your shots/Finals on CDN are still here. Re-upload Char refs to keep regenerating.'
            : 'Images expired after a server restart (old ephemeral links). Delete this project, re-upload refs (tag Char + Style), and run again — new runs persist on CDN.'}</div>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
            ${projectMediaExpired(p) ? `<button type="button" class="anim-btn" id="anim-delete-expired" style="width:auto;">Delete expired project</button>` : ''}
            <button type="button" class="anim-btn anim-btn--ghost" id="anim-new-from-expired" style="width:auto;">New project</button>
          </div>
        </div>
        ${p.status === 'character_review' ? `
        <div class="anim-lock-banner">
          <div>Review the sheet. If identity looks right, approve the lock — shots will not generate until you do.</div>
          <button type="button" class="anim-btn" id="anim-approve-character" style="width:auto;margin-top:10px;">Approve character lock</button>
        </div>` : ''}
        ` : (p.references || []).length || (p.reference_urls || []).length || _refs.length ? `
        <div class="anim-strip">
          ${(p.reference_urls?.length ? p.reference_urls : _refs.map((r) => r.url)).map((url, i) => `
            <div class="anim-tile">
              ${tileMedia(url, `Ref ${i + 1}`, 'ready')}
              <div class="anim-tile__cap">Ref ${i + 1}</div>
            </div>`).join('')}
        </div>
        <div class="anim-placeholder-row" style="margin-top:10px;">Your references are attached — multi-view sheets generate after you accept the brief.</div>` : `
        <div class="anim-placeholder-row">Add reference images in the chat panel, then accept the brief to generate multi-view sheets.</div>`}
      </div>

      <div class="anim-section">
        <div class="anim-section__label">Timeline</div>
        <div class="anim-timeline">
          ${scenes.length ? (() => {
            const timelineBusy = projectHasBusyScenes(p) || p.status === 'assembling';
            const addReason = addSceneDisabledReason(p);
            return `${scenes.map((s, idx) => {
              const regenLabel = s.status === 'generating'
                ? 'Generating…'
                : (s.video_url || (s.takes || []).length) ? 'Regenerate' : 'Generate';
              return `
            <div class="anim-shot" data-scene="${esc(s.id)}">
              <div class="anim-shot__media">
                ${s.status === 'generating'
                  ? (s.keyframe_url
                    ? `<div class="anim-shot__updating">${tileMedia(s.keyframe_url, s.title || '', 'ready')}<div class="anim-shot__updating-badge">Updating…</div></div>`
                    : tileMedia(null, '', 'generating'))
                  : s.video_url
                    ? `<video class="anim-shot__video" src="${esc(mediaSrc(s.video_url))}${s.active_take_id ? `${/\?/.test(mediaSrc(s.video_url)) ? '&' : '?'}take=${encodeURIComponent(s.active_take_id)}` : ''}" poster="${esc(mediaSrc(s.keyframe_url || ''))}" muted loop playsinline controls preload="metadata" data-expand="shot" data-scene="${esc(s.id)}"></video>`
                    : s.keyframe_url
                      ? tileMedia(s.keyframe_url, s.title || '', s.status)
                      : tileMedia(null, '', s.status || 'draft')}
                ${takeNavHtml(s)}
              </div>
              <div class="anim-shot__meta">
                <div class="anim-shot__title">${esc(s.title || s.id)} ${statusBadge(s.status)}</div>
                <label class="anim-shot__prompt-label">Shot prompt</label>
                <textarea class="anim-shot__prompt-edit" data-scene="${esc(s.id)}" rows="3" ${s.status === 'generating' ? 'disabled' : ''} placeholder="Describe this shot, or tap Suggest…">${esc(_shotPromptDrafts[s.id] != null ? _shotPromptDrafts[s.id] : (s.prompt || ''))}</textarea>
                ${s.motion ? `<div style="font-size:0.65rem;color:rgba(167,139,250,0.9);margin:4px 0;">Motion: ${esc(s.motion)}${s.i2v_model ? ` · ${esc(s.i2v_model)}` : ''}${s.model_video ? ` · ${esc(String(s.model_video).split('/').pop())}` : ''}</div>` : ''}
                ${s.motion_warning ? `<div style="font-size:0.62rem;color:#FCD34D;margin:2px 0 6px;line-height:1.35;">${esc(s.motion_warning)}</div>` : ''}
                ${s.persist_warning ? `<div style="font-size:0.62rem;color:#FCD34D;margin:2px 0 6px;line-height:1.35;">${esc(s.persist_warning)}</div>` : ''}
                ${s.error ? `<div style="font-size:0.62rem;color:#FCA5A5;margin:2px 0 6px;line-height:1.35;">${esc(s.error)}</div>` : ''}
                <div class="anim-shot__overrides">
                  <select class="anim-select anim-shot-i2v" data-scene="${esc(s.id)}" title="I2V model" style="font-size:0.65rem;padding:4px 6px;">
                    <option value="">I2V: inherit</option>
                    <option value="seedance" ${s.i2v_model === 'seedance' ? 'selected' : ''}>Seedance</option>
                    <option value="kling" ${s.i2v_model === 'kling' ? 'selected' : ''}>Kling</option>
                    <option value="auto" ${s.i2v_model === 'auto' ? 'selected' : ''}>Auto</option>
                  </select>
                  <select class="anim-select anim-shot-template" data-scene="${esc(s.id)}" title="Motion template" style="font-size:0.65rem;padding:4px 6px;">
                    ${templateOptions(s.motion_template_id)}
                  </select>
                </div>
                <div class="anim-shot__actions">
                  <button type="button" class="anim-btn anim-btn--ghost anim-shot-move" data-scene="${esc(s.id)}" data-delta="-1" ${timelineBusy || idx === 0 ? 'disabled' : ''} title="Move earlier" aria-label="Move shot earlier">↑</button>
                  <button type="button" class="anim-btn anim-btn--ghost anim-shot-move" data-scene="${esc(s.id)}" data-delta="1" ${timelineBusy || idx === scenes.length - 1 ? 'disabled' : ''} title="Move later" aria-label="Move shot later">↓</button>
                  <button type="button" class="anim-btn anim-btn--ghost anim-shot-suggest" data-scene="${esc(s.id)}" ${s.status === 'generating' || timelineBusy ? 'disabled' : ''}>Suggest</button>
                  <button type="button" class="anim-btn anim-btn--ghost anim-regen" data-scene="${esc(s.id)}" ${s.status === 'generating' ? 'disabled' : ''}>${regenLabel}</button>
                </div>
              </div>
            </div>`;
            }).join('')}
            <div class="anim-add-scene-wrap">
              <button type="button" class="anim-btn anim-btn--ghost" id="anim-add-scene" ${addReason ? 'disabled' : ''} title="${esc(addReason || 'Append a blank shot')}" style="width:100%;">+ Add scene</button>
              ${addReason ? `<div class="anim-add-scene-hint">${esc(addReason)}</div>` : ''}
            </div>`;
          })() : `
            <div class="anim-placeholder-row">${p.status === 'character_review'
              ? 'Shots wait until you Approve character lock.'
              : brief?.shots?.length
              ? `Ready to generate ${brief.shots.length} shots — accept the brief, then approve the character lock.`
              : 'Shot cards will land on this timeline.'}</div>
            ${brief?.shots?.length ? `<div class="anim-timeline anim-timeline--ghost">${brief.shots.map((s) => `
              <div class="anim-shot anim-shot--ghost"><div class="anim-shot__media">${
                ['developing', 'generating', 'assembling'].includes(p.status)
                  ? tileMedia(null, '', 'generating')
                  : `<div class="anim-tile__ph">${esc(s.title || s.id)}</div>`
              }</div></div>`).join('')}</div>` : ''}
          `}
        </div>
      </div>

      ${(() => {
        if (p.status === 'character_review') return '';
        const readyShotUrls = (p.scenes || [])
          .filter((s) => s.video_url && s.status === 'ready')
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .map((s) => s.video_url);
        const front = (p.character_pack?.views || []).find((v) => v.label === 'front' && v.url)?.url
          || (p.character_pack?.views || []).find((v) => v.url)?.url
          || p.character_ref_url
          || p.character_pack?.hero_url
          || '';
        const finalUrl = p.final_url;
        const previewBaseUrl = (_captionStudioOpen && p.final_pre_caption_url)
          ? p.final_pre_caption_url
          : finalUrl;
        const finalCacheBust = (() => {
          const parts = [
            p.final_assembled_at,
            p.last_burned_caption_style?.preset_id,
            p.last_burned_caption_style?.font_size,
            p.last_burned_caption_style?.burned_at,
          ].filter(Boolean).join('-');
          if (!parts || !previewBaseUrl) return '';
          return `${/\?/.test(mediaSrc(previewBaseUrl || '')) ? '&' : '?'}v=${encodeURIComponent(parts)}`;
        })();
        const isCharPlaceholder = !!(finalUrl && front && finalUrl === front)
          || !!(finalUrl && p.character_ref_url && finalUrl === p.character_ref_url);
        const source = Array.isArray(p.final_source_urls) ? p.final_source_urls : [];
        const stale = readyShotUrls.length > 0 && (
          !finalUrl
          || isCharPlaceholder
          || source.length !== readyShotUrls.length
          || source.some((u, i) => u !== readyShotUrls[i])
        );
        const showPlayer = finalUrl && !isCharPlaceholder;
        const history = Array.isArray(p.final_history) ? p.final_history : [];
        const pastFinals = history.filter((f) => f.id !== p.active_final_id && f.video_url !== finalUrl);
        // Prefer showing non-active history; if active not tagged, hide only the last (= current)
        const pastList = pastFinals.length
          ? pastFinals
          : (history.length >= 2 ? history.slice(0, -1) : []);
        if (!showPlayer && !readyShotUrls.length && !pastList.length) return '';
        return `
      <div class="anim-section">
        <div class="anim-section__label">Final</div>
        <div class="anim-final">
          ${showPlayer
            ? (/\.(mp4|webm|mov)(\?|$)/i.test(finalUrl) || readyShotUrls.length
              ? `<div class="anim-final__stage">
                  <video class="anim-final__video" src="${esc(mediaSrc(previewBaseUrl))}${esc(finalCacheBust)}" controls playsinline></video>
                  <div class="anim-cap-overlay" id="anim-cap-overlay" hidden aria-hidden="true"></div>
                </div>
                ${_captionStudioOpen && p.final_pre_caption_url
                  ? `<div style="font-size:0.68rem;color:rgba(167,139,250,0.95);margin:6px 0 0;line-height:1.35;">Caption Studio preview — live style on a clean master. Close studio or Rebuild to see the burned Final.</div>`
                  : (_captionStudioOpen
                    ? `<div style="font-size:0.68rem;color:#FCD34D;margin:6px 0 0;line-height:1.35;">Rebuild Final once to unlock clean caption preview (avoids stacking on an older burn).</div>`
                    : '')}`
              : `<img class="anim-media" src="${esc(mediaSrc(finalUrl))}" alt="Final" style="max-width:280px;border-radius:12px;" data-fallback="1" />`)
            : `<div class="anim-placeholder-row">${readyShotUrls.length
              ? `Ready to stitch ${readyShotUrls.length} shot${readyShotUrls.length === 1 ? '' : 's'} into the Final reel.`
              : 'Final reel appears after shots are ready.'}</div>`}
          ${stale ? `<div style="font-size:0.68rem;color:#FCD34D;margin:6px 0 4px;line-height:1.35;">Final is out of date — stitch the current timeline shots.</div>` : ''}
          ${p.persist_warning ? `<div style="font-size:0.68rem;color:#FCD34D;margin:6px 0 4px;line-height:1.35;">${esc(p.persist_warning)}</div>` : ''}
          ${p.caption_burn_error
            ? `<div style="font-size:0.68rem;color:#FCA5A5;margin:6px 0 4px;line-height:1.35;">Caption burn failed — ${esc(p.caption_burn_error)}. Rebuild again (check Captions is on).</div>`
            : (p.last_burned_caption_style
              ? `<div style="font-size:0.68rem;color:rgba(167,139,250,0.95);margin:6px 0 4px;line-height:1.35;">Burned captions: ${esc(p.last_burned_caption_style.preset_id || 'custom')} · ${esc(String(p.last_burned_caption_style.mode || ''))} · ${esc(String(p.last_burned_caption_style.font_size || ''))}px${p.last_burned_caption_style.background ? ' · box' : ''}</div>`
              : '')}
          ${readyShotUrls.length ? `
          <div class="anim-assemble-panel">
            <div class="anim-assemble-flags">
              ${(() => { const f = assembleFlags(); return `
              <label><input type="checkbox" id="anim-flag-vo" ${f.vo ? 'checked' : ''}/> VO</label>
              <label><input type="checkbox" id="anim-flag-captions" ${f.captions ? 'checked' : ''}/> Captions</label>
              <label><input type="checkbox" id="anim-flag-music" ${f.music ? 'checked' : ''}/> Music</label>
              <label><input type="checkbox" id="anim-flag-outro" ${f.outro ? 'checked' : ''}/> Outro</label>`; })()}
            </div>
            <textarea id="anim-vo-script" class="anim-brief-edit" style="min-height:56px;margin-top:8px;" placeholder="VO script (used when VO is on)…">${esc(p.vo_script || p.agent_brief?.caption || '')}</textarea>
            <div class="anim-vol-row" style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-top:8px;">
              <label class="anim-vol" style="display:flex;align-items:center;gap:8px;font-size:0.72rem;color:rgba(255,255,255,0.72);">
                VO vol
                <input type="range" id="anim-vo-volume" min="0" max="100" step="1" value="${Math.round((p.vo_volume == null ? 1 : Number(p.vo_volume)) * 100)}" style="width:120px;" />
                <span id="anim-vo-volume-val">${Math.round((p.vo_volume == null ? 1 : Number(p.vo_volume)) * 100)}%</span>
              </label>
              <label class="anim-vol" style="display:flex;align-items:center;gap:8px;font-size:0.72rem;color:rgba(255,255,255,0.72);">
                Music vol
                <input type="range" id="anim-music-volume" min="0" max="100" step="1" value="${Math.round((p.music_volume == null ? 0.18 : Number(p.music_volume)) * 100)}" style="width:120px;" />
                <span id="anim-music-volume-val">${Math.round((p.music_volume == null ? 0.18 : Number(p.music_volume)) * 100)}%</span>
              </label>
            </div>
            <input type="text" id="anim-caption-text" class="anim-ref-url" style="width:100%;margin-top:6px;" placeholder="Caption / static text (VO script drives timed words)…" value="${esc(p.caption_text || p.agent_brief?.caption || p.agent_brief?.title || '')}" />
            ${renderCaptionStudioPanel(p)}
            <textarea id="anim-music-prompt" class="anim-brief-edit" style="min-height:44px;margin-top:8px;" placeholder="Music bed prompt (e.g. warm lo-fi instrumental, soft pulse, no vocals)…">${esc(p.music_prompt || '')}</textarea>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;align-items:center;">
              <select id="anim-music-length" class="anim-select" style="width:auto;min-width:96px;font-size:0.68rem;" title="Music length">
                ${[15, 30, 45, 60].map((s) => {
                  const ms = s * 1000;
                  const cur = Number(p.music_length_ms) || 30000;
                  return `<option value="${ms}" ${cur === ms ? 'selected' : ''}>${s}s</option>`;
                }).join('')}
              </select>
              <button type="button" class="anim-btn anim-btn--ghost" id="anim-music-generate" style="width:auto;padding:6px 10px;font-size:0.68rem;" ${!(_meta?.providers?.elevenlabs_configured) ? 'disabled title="Needs ELEVENLABS_API_KEY"' : ''}>${p.music_bed_url ? 'Regen music' : 'Generate music'}</button>
              <input type="file" id="anim-music-file" accept="audio/*,video/*" hidden />
              <input type="file" id="anim-outro-file" accept="video/*" hidden />
              <button type="button" class="anim-btn anim-btn--ghost" id="anim-music-upload" style="width:auto;padding:6px 10px;font-size:0.68rem;">${p.music_bed_url ? 'Music ✓' : 'Upload music'}</button>
              <button type="button" class="anim-btn anim-btn--ghost" id="anim-outro-upload" style="width:auto;padding:6px 10px;font-size:0.68rem;">${p.outro_url ? 'Outro ✓' : 'Upload outro'}</button>
              ${p.music_bed_url ? `<button type="button" class="anim-btn anim-btn--ghost" id="anim-music-clear" style="width:auto;padding:6px 8px;font-size:0.65rem;">Clear music</button>` : ''}
              ${p.outro_url ? `<button type="button" class="anim-btn anim-btn--ghost" id="anim-outro-clear" style="width:auto;padding:6px 8px;font-size:0.65rem;">Clear outro</button>` : ''}
            </div>
            ${assembleFlags().outro && !p.outro_url ? `<div style="font-size:0.68rem;color:#FCD34D;margin:6px 0 0;line-height:1.35;">Outro is on, but no clip is attached — upload an outro before Rebuild.</div>` : ''}
            <div style="font-size:0.62rem;color:rgba(255,255,255,0.38);margin-top:4px;line-height:1.35;">Generate or upload a bed, then Rebuild final. ElevenLabs Music supports 3s–10min; pick 30–60s for typical reels.</div>
          </div>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
            ${showPlayer ? `<button type="button" class="anim-btn anim-btn--ghost" id="anim-expand-final" style="width:auto;">Expand</button>` : ''}
            ${readyShotUrls.length ? `<button type="button" class="anim-btn anim-btn--ghost" id="anim-cap-open" style="width:auto;">${_captionStudioOpen ? 'Caption Studio ✓' : 'Edit captions'}</button>` : ''}
            ${readyShotUrls.length ? (() => {
              const stuck = assembleLooksStuck(p);
              const genBusy = (p.scenes || []).some((s) => s.status === 'generating');
              const disabled = genBusy || (p.status === 'assembling' && !stuck);
              const label = p.status === 'assembling'
                ? (stuck ? 'Retry assemble' : 'Assembling…')
                : 'Rebuild final';
              return `<button type="button" class="anim-btn" id="anim-rebuild-final" ${disabled ? 'disabled' : ''}>${label}</button>${
                p.status === 'assembling' && stuck
                  ? `<div style="font-size:0.68rem;color:#FCD34D;margin:6px 0 0;line-height:1.35;">Rebuild looks stuck — tap Retry assemble.</div>`
                  : ''
              }`;
            })() : ''}
            ${p.content_record_id && !p.persist_warning ? `<button type="button" class="anim-btn anim-btn--ghost" id="anim-open-review">Open in Content Review</button>` : ''}
            ${p.content_record_id && p.persist_warning ? `<button type="button" class="anim-btn anim-btn--ghost" id="anim-open-review" title="Final may not be durable">Open in Content Review</button>` : ''}
          </div>
        </div>
        ${pastList.length ? `
        <details class="anim-past-finals" ${ _pastFinalsOpen ? 'open' : '' }>
          <summary class="anim-past-finals__summary">Past finals (${pastList.length})</summary>
          <div class="anim-past-finals__strip">
            ${pastList.slice().reverse().map((f) => `
              <button type="button" class="anim-past-final" data-final-id="${esc(f.id)}" title="${esc(formatTakeTime(f.created_at))}">
                <div class="anim-past-final__thumb">▶</div>
                <div class="anim-past-final__meta">
                  <div class="anim-past-final__title">Final · ${esc(formatTakeTime(f.created_at) || 'earlier')}</div>
                  <div class="anim-past-final__sub">${esc(String(f.shot_count || (f.source_urls || []).length || '?'))} shots</div>
                </div>
              </button>`).join('')}
          </div>
        </details>` : ''}
      </div>`;
      })()}
      ${p.error ? `<div class="anim-error">${esc(p.error)}</div>` : ''}
    `;

    el.querySelectorAll('.anim-shot__prompt-edit').forEach((ta) => {
      ta.addEventListener('input', () => {
        _shotPromptDrafts[ta.dataset.scene] = ta.value;
      });
    });
    el.querySelectorAll('.anim-regen').forEach((btn) => {
      btn.addEventListener('click', () => regenScene(btn.dataset.scene));
    });
    el.querySelectorAll('.anim-shot-suggest').forEach((btn) => {
      btn.addEventListener('click', () => suggestScene(btn.dataset.scene));
    });
    el.querySelectorAll('.anim-shot-move').forEach((btn) => {
      btn.addEventListener('click', () => moveScene(btn.dataset.scene, Number(btn.dataset.delta) || 0));
    });
    document.getElementById('anim-add-scene')?.addEventListener('click', () => addScene());
    document.getElementById('anim-music-upload')?.addEventListener('click', () => document.getElementById('anim-music-file')?.click());
    document.getElementById('anim-outro-upload')?.addEventListener('click', () => document.getElementById('anim-outro-file')?.click());
    document.getElementById('anim-music-generate')?.addEventListener('click', () => generateMusicBed());
    const bindVol = (id, labelId, projectKey) => {
      const el = document.getElementById(id);
      const lab = document.getElementById(labelId);
      if (!el) return;
      el.addEventListener('input', () => {
        if (lab) lab.textContent = `${el.value}%`;
        if (_project) _project[projectKey] = Math.max(0, Math.min(1, Number(el.value) / 100));
      });
      el.addEventListener('change', () => { syncMotionSettings(); });
    };
    bindVol('anim-music-volume', 'anim-music-volume-val', 'music_volume');
    bindVol('anim-vo-volume', 'anim-vo-volume-val', 'vo_volume');
    document.getElementById('anim-cap-open')?.addEventListener('click', () => {
      _captionStudioOpen = !_captionStudioOpen;
      _canvasFp = '';
      renderCanvas();
      const btn = document.getElementById('anim-cap-open');
      if (btn) btn.textContent = _captionStudioOpen ? 'Caption Studio ✓' : 'Edit captions';
      if (_captionStudioOpen) {
        const flag = document.getElementById('anim-flag-captions');
        if (flag) flag.checked = true;
      }
    });
    document.getElementById('anim-cap-close')?.addEventListener('click', () => {
      _captionStudioOpen = false;
      _canvasFp = '';
      renderCanvas();
      const btn = document.getElementById('anim-cap-open');
      if (btn) btn.textContent = 'Edit captions';
    });
    document.getElementById('anim-cap-save')?.addEventListener('click', async () => {
      if (!_project) return;
      const style = currentCaptionStyle();
      _captionStyleDraft = style;
      _project.caption_style = style;
      const flag = document.getElementById('anim-flag-captions');
      if (flag) flag.checked = true;
      await syncMotionSettings();
      toast(`Caption style saved (${style.preset_id || 'custom'}) — Rebuild final to burn`, 'success');
      paintCaptionOverlay(document.querySelector('.anim-final__video')?.currentTime || 0);
    });
    const applyPresetFields = (st) => {
      const set = (id, val, prop = 'value') => {
        const el = document.getElementById(id);
        if (el) el[prop] = val;
      };
      set('anim-cap-mode', st.mode);
      set('anim-cap-size', st.font_size);
      set('anim-cap-width', st.max_width_pct || 78);
      set('anim-cap-y', st.position.y_pct);
      set('anim-cap-wpl', st.words_per_line);
      set('anim-cap-outline-w', st.outline_width ?? 0);
      set('anim-cap-color', (st.color || '#FFFFFF').slice(0, 7));
      set('anim-cap-highlight', (st.highlight_color || '#FFE566').slice(0, 7));
      set('anim-cap-outline', (st.outline_color || '#000000').slice(0, 7));
      set('anim-cap-anim', st.animation);
      set('anim-cap-case', st.text_case);
      set('anim-cap-pad', st.background?.padding ?? 8);
      set('anim-cap-radius', st.background?.radius ?? 8);
      set('anim-cap-box', !!st.background?.enabled, 'checked');
      const presetEl = document.getElementById('anim-cap-preset');
      if (presetEl && st.preset_id) presetEl.value = st.preset_id;
      document.querySelectorAll('.anim-cap-chip[data-cap-size]').forEach((b) => {
        b.classList.toggle('is-on', Number(b.dataset.capSize) === Number(st.font_size));
      });
      const sizeLabel = document.getElementById('anim-cap-size-val');
      if (sizeLabel) sizeLabel.textContent = String(st.font_size || 42);
      const widthLabel = document.getElementById('anim-cap-width-val');
      if (widthLabel) widthLabel.textContent = `${st.max_width_pct || 78}%`;
    };
    document.getElementById('anim-cap-preset')?.addEventListener('change', async () => {
      const id = document.getElementById('anim-cap-preset')?.value;
      const preset = captionPresets().find((p) => p.id === id);
      if (preset?.style) {
        const style = normalizeCaptionStyle({ ...preset.style, preset_id: id });
        _captionStyleDraft = style;
        _project.caption_style = style;
        applyPresetFields(style);
        const flag = document.getElementById('anim-flag-captions');
        if (flag) flag.checked = true;
        await syncMotionSettings();
        toast(`Preset “${preset.label || id}” applied — Rebuild final to burn`, 'success');
      }
      paintCaptionOverlay(document.querySelector('.anim-final__video')?.currentTime || 0);
    });
    document.querySelectorAll('.anim-cap-chip[data-cap-size]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const size = Number(btn.dataset.capSize);
        const el = document.getElementById('anim-cap-size');
        if (el) el.value = String(size);
        document.querySelectorAll('.anim-cap-chip[data-cap-size]').forEach((b) => b.classList.toggle('is-on', b === btn));
        _captionStyleDraft = currentCaptionStyle();
        paintCaptionOverlay(document.querySelector('.anim-final__video')?.currentTime || 0);
      });
    });
    [
      'anim-cap-mode', 'anim-cap-size', 'anim-cap-width', 'anim-cap-y', 'anim-cap-wpl', 'anim-cap-outline-w',
      'anim-cap-color', 'anim-cap-highlight', 'anim-cap-outline', 'anim-cap-anim', 'anim-cap-case',
      'anim-cap-box', 'anim-cap-pad', 'anim-cap-radius',
      'anim-caption-text', 'anim-vo-script',
    ].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', () => {
        _captionStyleDraft = currentCaptionStyle();
        paintCaptionOverlay(document.querySelector('.anim-final__video')?.currentTime || 0);
      });
      document.getElementById(id)?.addEventListener('change', () => {
        _captionStyleDraft = currentCaptionStyle();
        paintCaptionOverlay(document.querySelector('.anim-final__video')?.currentTime || 0);
      });
    });
    bindCaptionPreview();
    document.getElementById('anim-music-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (file) await uploadProjectAsset(file, 'music');
      e.target.value = '';
    });
    document.getElementById('anim-outro-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (file) await uploadProjectAsset(file, 'outro');
      e.target.value = '';
    });
    document.getElementById('anim-music-clear')?.addEventListener('click', async () => {
      if (!_project) return;
      _project.music_bed_url = null;
      await syncMotionSettings();
      renderCanvas();
    });
    document.getElementById('anim-outro-clear')?.addEventListener('click', async () => {
      if (!_project) return;
      _project.outro_url = null;
      await syncMotionSettings();
      renderCanvas();
    });
    ['anim-flag-vo', 'anim-flag-captions', 'anim-flag-music', 'anim-flag-outro'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => {
        if (_project) {
          _project.pipeline = _project.pipeline || {};
          _project.pipeline.assemble = assembleFlagsFromDom();
        }
      });
    });
    el.querySelectorAll('.anim-take-prev').forEach((btn) => {
      btn.addEventListener('click', () => stepTake(btn.dataset.scene, -1));
    });
    el.querySelectorAll('.anim-take-next').forEach((btn) => {
      btn.addEventListener('click', () => stepTake(btn.dataset.scene, 1));
    });
    el.querySelectorAll('.anim-expand-btn').forEach((btn) => {
      btn.addEventListener('click', () => expandShot(btn.dataset.scene));
    });
    el.querySelectorAll('.anim-shot__video').forEach((vid) => {
      vid.addEventListener('dblclick', () => expandShot(vid.dataset.scene));
    });
    document.getElementById('anim-expand-final')?.addEventListener('click', () => {
      if (!_project?.final_url) return;
      openExpandModal({
        url: _project.final_url,
        title: 'Final reel',
        kind: 'final',
        finalId: _project.active_final_id || null,
        canUse: false,
      });
    });
    el.querySelector('.anim-past-finals')?.addEventListener('toggle', (e) => {
      _pastFinalsOpen = !!e.target.open;
    });
    el.querySelectorAll('.anim-past-final').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.finalId;
        const entry = (_project?.final_history || []).find((f) => f.id === id);
        if (!entry) return;
        openExpandModal({
          url: entry.video_url,
          title: `Past final · ${formatTakeTime(entry.created_at)}`,
          kind: 'final',
          finalId: entry.id,
          canUse: entry.id !== _project.active_final_id && entry.video_url !== _project.final_url,
        });
      });
    });
    let expiredCount = 0;
    const showExpiredBanner = () => {
      const banner = document.getElementById('anim-expired-banner');
      if (banner) banner.hidden = false;
    };
    if (projectMediaExpired(p)) showExpiredBanner();
    else if (projectNeedsCharReupload(p)) showExpiredBanner();
    el.querySelectorAll('img.anim-media[data-fallback]').forEach((img) => {
      img.addEventListener('error', () => {
        expiredCount += 1;
        const ph = document.createElement('div');
        ph.className = 'anim-tile__ph anim-tile__ph--fail';
        ph.textContent = 'Expired';
        img.replaceWith(ph);
        if (expiredCount >= 1) showExpiredBanner();
      }, { once: true });
    });
    document.getElementById('anim-delete-expired')?.addEventListener('click', () => {
      if (_project?.id) deleteProject(_project.id);
    });
    document.getElementById('anim-new-from-expired')?.addEventListener('click', () => newProject());
    document.getElementById('anim-approve-character')?.addEventListener('click', approveCharacter);
    document.getElementById('anim-rebuild-final')?.addEventListener('click', rebuildFinal);
    document.getElementById('anim-open-review')?.addEventListener('click', () => {
      document.querySelector('[data-nav="content"]')?.click();
    });
  }

  function renderChat() {
    const logEl = document.getElementById('anim-chat-log');
    if (!logEl) return;
    const chat = _project?.chat || [];
    const brief = _project?.agent_brief;
    logEl.innerHTML = chat.map((m) => {
      const isAgent = m.role === 'agent' || m.role === 'system';
      return `<div class="anim-msg ${isAgent ? 'anim-msg--agent' : 'anim-msg--user'}">
        <div class="anim-msg__role">${esc(m.role === 'agent' ? 'Claude · Art Director' : m.role)}</div>
        <div class="anim-msg__text">${esc(m.text)}</div>
      </div>`;
    }).join('') || `<div class="anim-msg anim-msg--agent"><div class="anim-msg__role">Claude · Art Director</div><div class="anim-msg__text">Tell me what to make. I’ll rewrite it into an optimized brief for ${esc(_project?.mode || 'video')} mode — then you accept or edit before anything generates.</div></div>`;

    const actions = document.getElementById('anim-brief-actions');
    if (actions) {
      if (_project?.status === 'brief_ready' && brief) {
        const optimized = String(brief.rewritten_prompt || '').trim()
          || (brief.shots || []).map((s, i) => `${i + 1}. ${s.title || `Shot ${i + 1}`}: ${s.prompt || ''}`).join('\n\n');
        const looksRaw = (() => {
          const a = optimized.toLowerCase().replace(/\s+/g, ' ');
          const b = String(_project.user_prompt || '').toLowerCase().replace(/\s+/g, ' ');
          if (!optimized) return true;
          if (!b) return false;
          return a === b || (b.length > 60 && a.includes(b) && a.length < b.length * 1.25);
        })();
        actions.innerHTML = `
          <div class="anim-brief-card">
            <div class="anim-brief-card__title">Optimized brief</div>
            ${looksRaw
              ? `<div style="font-size:0.68rem;color:#FCD34D;margin:0 0 8px;line-height:1.35;">This still looks like your raw draft — tap <strong>Re-brief</strong> to run Claude again (it will rewrite automatically).</div>`
              : (brief._rewritten_repaired
                ? `<div style="font-size:0.68rem;color:rgba(167,139,250,0.95);margin:0 0 8px;line-height:1.35;">Recovered from shot plan — tap Re-brief if you want a fuller Art Director rewrite.</div>`
                : '')}
            <textarea id="anim-brief-edit" class="anim-brief-edit">${esc(optimized)}</textarea>
            <div class="anim-brief-shots">${(brief.shots || []).map((s, i) =>
              `<div class="anim-brief-shot"><strong>${i + 1}. ${esc(s.title)}</strong> — ${esc((s.prompt || '').slice(0, 80))}…</div>`
            ).join('')}</div>
            <div class="anim-brief-btns">
              <button type="button" class="anim-btn" id="anim-accept">Accept & generate</button>
              <button type="button" class="anim-btn anim-btn--ghost" id="anim-rebrief">Re-brief</button>
            </div>
          </div>`;
        document.getElementById('anim-accept')?.addEventListener('click', acceptBrief);
        document.getElementById('anim-rebrief')?.addEventListener('click', () => {
          rebriefProject();
        });
      } else if (_project?.status === 'character_review') {
        actions.innerHTML = `
          <div class="anim-brief-card">
            <div class="anim-brief-card__title">Character lock</div>
            <div class="anim-brief-shot">Check the canvas views. Approve only if face/hair/outfit match your Character reference.</div>
            <div class="anim-brief-btns">
              <button type="button" class="anim-btn" id="anim-accept-character">Approve character lock</button>
            </div>
          </div>`;
        document.getElementById('anim-accept-character')?.addEventListener('click', approveCharacter);
      } else if (['developing', 'generating', 'assembling'].includes(_project?.status)) {
        actions.innerHTML = `<div class="anim-working">Generating — canvas updates live…</div>`;
      } else {
        actions.innerHTML = '';
      }
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  async function ensureProject() {
    if (_project?.id) return _project;
    const mode = document.getElementById('anim-mode')?.value || 'video';
    const look = document.getElementById('anim-look')?.value || 'stylized';
    const motion_mode = document.getElementById('anim-motion')?.value || currentMotionMode();
    const references = refsPayload();
    const data = await animFetch('/api/animation/projects', {
      method: 'POST',
      body: JSON.stringify({
        mode,
        look,
        motion_mode,
        driving_video_url: _project?.driving_video_url || null,
        references,
        reference_urls: references.map((r) => r.url),
        character_ref_url: references.find((r) => r.role === 'character')?.url || null,
      }),
    });
    _project = data.project;
    return _project;
  }

  async function rebriefProject() {
    if (_busy) return;
    const ta = document.getElementById('anim-prompt');
    const prior = String(_project?.user_prompt || '').trim();
    if (ta && !String(ta.value || '').trim() && prior) ta.value = prior;
    const prompt = String(ta?.value || prior || '').trim();
    if (!prompt) return toast('Enter a prompt to re-brief', 'error');
    if (ta) ta.value = prompt;
    toast('Re-briefing with Claude Art Director…', 'info');
    await sendPrompt();
  }

  async function sendPrompt() {
    if (_busy) return;
    const ta = document.getElementById('anim-prompt');
    const prompt = (ta?.value || '').trim();
    if (!prompt) return toast('Enter a prompt', 'error');
    if (_refs.length && !_refs.some((r) => r.role === 'character')) {
      return toast('Tag one reference as Character (identity)', 'error');
    }
    _busy = true;
    try {
      await ensureProject();
      const mode = document.getElementById('anim-mode')?.value || 'video';
      const look = document.getElementById('anim-look')?.value || 'stylized';
      const motion_mode = document.getElementById('anim-motion')?.value || currentMotionMode();
      const references = refsPayload();
      _project.mode = mode;
      _project.look = look;
      _project.motion_mode = motion_mode;
      await syncMotionSettings();
      toast('Claude is rewriting your brief…', 'info');
      const data = await animFetch(`/api/animation/projects/${_project.id}/brief`, {
        method: 'POST',
        body: JSON.stringify({
          prompt,
          mode,
          look,
          references,
          reference_urls: references.map((r) => r.url),
          character_ref_url: references.find((r) => r.role === 'character')?.url || null,
          force_rewrite: true,
        }),
      });
      _project = data.project;
      if (ta) ta.value = '';
      renderCanvas();
      renderChat();
      const rewritten = String(_project?.agent_brief?.rewritten_prompt || '').trim();
      const userP = String(_project?.user_prompt || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const opt = rewritten.toLowerCase().replace(/\s+/g, ' ');
      const stillRaw = !rewritten
        || (userP && (opt === userP || (userP.length > 60 && opt.includes(userP) && opt.length < userP.length * 1.25)));
      if (stillRaw) {
        toast('Brief still looks unoptimized — try Re-brief once more', 'error');
      } else {
        toast('Optimized brief ready — review, then Accept & generate', 'success');
      }
    } catch (e) {
      toast(e.message || 'Brief failed', 'error');
    } finally {
      _busy = false;
    }
  }

  async function acceptBrief() {
    if (_busy || !_project?.id) return;
    _busy = true;
    try {
      const edited = document.getElementById('anim-brief-edit')?.value;
      const agent_brief = { ...(_project.agent_brief || {}) };
      if (edited) agent_brief.rewritten_prompt = edited;
      const data = await animFetch(`/api/animation/projects/${_project.id}/approve-brief`, {
        method: 'POST',
        body: JSON.stringify({ agent_brief }),
      });
      _project = data.project;
      renderCanvas();
      renderChat();
      startPoll();
      toast('Generating character sheet…', 'success');
    } catch (e) {
      toast(e.message || 'Approve failed', 'error');
    } finally {
      _busy = false;
    }
  }

  async function approveCharacter() {
    if (_busy || !_project?.id) return;
    const motion_mode = document.getElementById('anim-motion')?.value || currentMotionMode();
    if (motion_mode === 'drive' && !_project.driving_video_url) {
      return toast('Upload a driving video first (or switch motion to Auto / Kling only)', 'error');
    }
    _busy = true;
    try {
      await syncMotionSettings();
      const data = await animFetch(`/api/animation/projects/${_project.id}/approve-character`, {
        method: 'POST',
        body: JSON.stringify({
          motion_mode,
          driving_video_url: _project.driving_video_url || null,
        }),
      });
      _project = data.project;
      renderCanvas();
      renderChat();
      if (data.started) {
        startPoll();
        toast('Character locked — generating shots…', 'success');
      } else {
        stopPoll();
        toast('Character lock saved', 'success');
      }
    } catch (e) {
      toast(e.message || 'Character approve failed', 'error');
    } finally {
      _busy = false;
    }
  }

  async function addScene() {
    if (!_project?.id || _busy) return;
    const reason = addSceneDisabledReason(_project);
    if (reason) return toast(reason, 'info');
    _busy = true;
    try {
      const data = await animFetch(`/api/animation/projects/${_project.id}/scenes`, {
        method: 'POST',
        body: '{}',
      });
      _project = data.project;
      const newId = data.scene?.id;
      if (newId) _shotPromptDrafts[newId] = '';
      _canvasFp = '';
      renderCanvas();
      toast('Blank shot added — write a prompt or tap Suggest', 'success');
      if (newId) {
        const ta = document.querySelector(`.anim-shot__prompt-edit[data-scene="${newId}"]`);
        ta?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        ta?.focus();
      }
    } catch (e) {
      toast(e.message || 'Add scene failed', 'error');
    } finally {
      _busy = false;
    }
  }

  async function suggestScene(sceneId, { force = false } = {}) {
    if (!_project?.id || !sceneId || _busy) return;
    const scene = (_project.scenes || []).find((s) => s.id === sceneId);
    if (!scene) return;
    if (scene.status === 'generating' || projectHasBusyScenes(_project) || _project.status === 'assembling') {
      return toast('Wait for shots to finish before suggesting', 'info');
    }
    const shotCard = document.querySelector(`.anim-shot[data-scene="${sceneId}"]`);
    const localPrompt = (shotCard?.querySelector('.anim-shot__prompt-edit')?.value
      || _shotPromptDrafts[sceneId]
      || scene.prompt
      || '').trim();
    if (localPrompt && !force) {
      const ok = window.confirm('Replace current prompt with AI draft?');
      if (!ok) return;
      return suggestScene(sceneId, { force: true });
    }
    const btn = shotCard?.querySelector('.anim-shot-suggest');
    const ta = shotCard?.querySelector('.anim-shot__prompt-edit');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Suggesting…';
    }
    if (ta) ta.disabled = true;
    _busy = true;
    try {
      const resp = await fetch(`${apiBase()}/api/animation/projects/${_project.id}/scenes/${sceneId}/suggest`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ force: !!force }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.status === 409 && data.needs_confirm) {
        const ok = window.confirm('Replace current prompt with AI draft?');
        if (!ok) return;
        return suggestScene(sceneId, { force: true });
      }
      if (!resp.ok) throw new Error(data.error || resp.statusText);
      _project = data.project;
      const prompt = data.scene?.prompt || data.suggestion?.prompt || '';
      _shotPromptDrafts[sceneId] = prompt;
      _canvasFp = '';
      renderCanvas();
      toast('Draft prompt ready — edit or Generate', 'success');
      document.querySelector(`.anim-shot__prompt-edit[data-scene="${sceneId}"]`)?.focus();
    } catch (e) {
      toast(e.message || 'Suggest failed', 'error');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Suggest';
      }
      if (ta) ta.disabled = false;
    } finally {
      _busy = false;
    }
  }

  async function moveScene(sceneId, delta) {
    if (!_project?.id || !sceneId || !delta || _busy) return;
    if (projectHasBusyScenes(_project) || _project.status === 'assembling') {
      return toast('Wait for shots to finish before reordering', 'info');
    }
    const ordered = [...(_project.scenes || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    const i = ordered.findIndex((s) => s.id === sceneId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    const prev = ordered.map((s) => ({ id: s.id, order: s.order, title: s.title }));
    const ids = ordered.map((s) => s.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    ids.forEach((id, idx) => {
      const scene = (_project.scenes || []).find((s) => s.id === id);
      if (!scene) return;
      scene.order = idx + 1;
      if (/^Shot\s+\d+$/i.test(String(scene.title || '').trim())) scene.title = `Shot ${idx + 1}`;
    });
    _project.scenes = [...(_project.scenes || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    _project.final_source_urls = null;
    _canvasFp = '';
    renderCanvas();
    _busy = true;
    try {
      const data = await animFetch(`/api/animation/projects/${_project.id}/scenes/reorder`, {
        method: 'POST',
        body: JSON.stringify({ scene_ids: ids }),
      });
      _project = data.project;
      _canvasFp = '';
      renderCanvas();
    } catch (e) {
      prev.forEach((p) => {
        const scene = (_project.scenes || []).find((s) => s.id === p.id);
        if (!scene) return;
        scene.order = p.order;
        scene.title = p.title;
      });
      _project.scenes = [...(_project.scenes || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
      _canvasFp = '';
      renderCanvas();
      toast(e.message || 'Reorder failed', 'error');
    } finally {
      _busy = false;
    }
  }

  async function regenScene(sceneId) {
    if (!_project?.id || !sceneId || _busy) return;
    const scene = (_project.scenes || []).find((s) => s.id === sceneId);
    if (scene?.status === 'generating') return toast('This shot is already generating — hang tight', 'info');
    const shotCard = document.querySelector(`.anim-shot[data-scene="${sceneId}"]`);
    const promptEdit = (shotCard?.querySelector('.anim-shot__prompt-edit')?.value
      || _shotPromptDrafts[sceneId]
      || scene?.prompt
      || '').trim();
    if (!promptEdit) return toast('Shot prompt can’t be empty', 'error');
    _busy = true;
    try {
      toast('Regenerating shot (compose → I2V → DreamActor)…', 'info');
      const references = refsPayload();
      const shotI2v = shotCard?.querySelector('.anim-shot-i2v')?.value || '';
      const shotTpl = shotCard?.querySelector('.anim-shot-template')?.value || '';
      _shotPromptDrafts[sceneId] = promptEdit;
      const data = await animFetch(`/api/animation/projects/${_project.id}/scenes/${sceneId}/regenerate`, {
        method: 'POST',
        body: JSON.stringify({
          prompt: promptEdit,
          motion_mode: document.getElementById('anim-motion')?.value || currentMotionMode(),
          i2v_model: shotI2v || currentI2vModel(),
          motion_template_id: shotTpl || null,
          references,
          reference_urls: references.map((r) => r.url),
          character_ref_url: references.find((r) => r.role === 'character')?.url || null,
        }),
      });
      _project = data.project;
      // Keep draft in sync with what we sent (server now has it on the scene).
      const updated = (_project.scenes || []).find((s) => s.id === sceneId);
      if (updated?.prompt) _shotPromptDrafts[sceneId] = updated.prompt;
      renderCanvas();
      startPoll();
      toast(data.started ? 'Shot regenerating — canvas will update when ready' : 'Shot updated', 'success');
    } catch (e) {
      toast(e.message || 'Regen failed', 'error');
      // Refresh so a stuck GENERATING can clear / show the real error
      try {
        const data = await animFetch(`/api/animation/projects/${_project.id}`);
        _project = data.project;
        renderCanvas();
      } catch (_) {}
    } finally {
      _busy = false;
    }
  }

  async function uploadProjectAsset(file, kind) {
    if (!_project?.id || !file) return;
    toast(`Uploading ${kind}…`, 'info');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('video', file);
      const endpoint = file.type.startsWith('audio/')
        ? `${apiBase()}/api/studio/upload-video`
        : `${apiBase()}/api/studio/upload-video`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: authHeadersMultipart(),
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
      if (kind === 'music') _project.music_bed_url = data.url;
      if (kind === 'outro') _project.outro_url = data.url;
      await syncMotionSettings();
      renderCanvas();
      toast(`${kind === 'music' ? 'Music bed' : 'Outro'} attached`, 'success');
    } catch (e) {
      toast(e.message || 'Upload failed', 'error');
    }
  }

  async function generateMusicBed() {
    if (!_project?.id || _busy) return;
    if (!_meta?.providers?.elevenlabs_configured) {
      return toast('Music generation needs ELEVENLABS_API_KEY on the API', 'error');
    }
    const prompt = String(document.getElementById('anim-music-prompt')?.value || '').trim();
    if (!prompt) return toast('Describe the music bed first', 'error');
    const lengthMs = Number(document.getElementById('anim-music-length')?.value) || 30000;
    _busy = true;
    const btn = document.getElementById('anim-music-generate');
    if (btn) btn.disabled = true;
    try {
      toast(`Generating ${Math.round(lengthMs / 1000)}s instrumental bed…`, 'info');
      const data = await animFetch(`/api/animation/projects/${_project.id}/generate-music`, {
        method: 'POST',
        body: JSON.stringify({
          music_prompt: prompt,
          music_length_ms: lengthMs,
          instrumental: true,
        }),
      });
      _project = data.project || _project;
      if (data.music_bed_url) _project.music_bed_url = data.music_bed_url;
      renderCanvas();
      toast(`Music bed ready (${Math.round((data.length_ms || lengthMs) / 1000)}s) — Rebuild final to mix it in`, 'success');
    } catch (e) {
      toast(e.message || 'Music generation failed', 'error');
    } finally {
      _busy = false;
      if (btn) btn.disabled = false;
    }
  }

  async function rebuildFinal() {
    if (!_project?.id || _busy) return;
    if ((_project.scenes || []).some((s) => s.status === 'generating' || s.status === 'pending')) {
      return toast('Wait for shots to finish before rebuilding Final', 'info');
    }
    if (_project.status === 'assembling' && !assembleLooksStuck(_project)) {
      startPoll();
      return toast('Final is already assembling — hanging tight…', 'info');
    }
    const ready = (_project.scenes || []).filter((s) => s.video_url && s.status === 'ready');
    if (!ready.length) return toast('No ready shot videos to stitch', 'error');
    const flags = assembleFlagsFromDom();
    if (flags.outro && !_project.outro_url) {
      return toast('Outro is checked but no clip is uploaded — Upload outro, then Rebuild', 'error');
    }
    // Capture style BEFORE closing studio / remounting — draft survives remounts.
    const style = currentCaptionStyle();
    _captionStyleDraft = style;
    _project.caption_style = style;
    // Respect the Captions checkbox. (Previously always forced on, so you could never
    // Rebuild a clean Final after Caption Studio.)
    // Opening Caption Studio + Rebuild still implies burn if the box is checked.
    const flagEl = document.getElementById('anim-flag-captions');
    if (flagEl) flags.captions = !!flagEl.checked;
    // Close studio so Final shows the burned (or clean) file, not overlay-on-burn doubles.
    _captionStudioOpen = false;
    const forceRetry = assembleLooksStuck(_project) || _project.status === 'assembling';
    _busy = true;
    const projectId = _project.id;
    const prevSummary = _project.last_assemble_summary || '';
    try {
      await syncMotionSettings();
      const clipHint = flags.outro && _project.outro_url
        ? `${ready.length} shots + outro`
        : `${ready.length} shots`;
      const capHint = flags.captions ? `${style.preset_id || 'custom'} captions` : 'no captions';
      toast(
        forceRetry
          ? `Retrying Final (${clipHint}, ${capHint})…`
          : `Building Final (${clipHint}, ${capHint})…`,
        'info'
      );
      const data = await animFetch(`/api/animation/projects/${projectId}/assemble`, {
        method: 'POST',
        body: JSON.stringify({
          create_content: !_project.content_record_id,
          force: forceRetry,
          assemble: flags,
          caption_style: style,
          caption_text: document.getElementById('anim-caption-text')?.value
            || _project.caption_text
            || '',
          vo_script: document.getElementById('anim-vo-script')?.value
            || _project.vo_script
            || '',
          music_volume: document.getElementById('anim-music-volume')
            ? Math.max(0, Math.min(1, Number(document.getElementById('anim-music-volume').value) / 100))
            : (_project.music_volume ?? 0.18),
          vo_volume: document.getElementById('anim-vo-volume')
            ? Math.max(0, Math.min(1, Number(document.getElementById('anim-vo-volume').value) / 100))
            : (_project.vo_volume ?? 1),
        }),
      });
      // Keep the open project — never bounce to Home while assemble runs.
      _project = data.project || _project;
      _project.status = _project.status || 'assembling';
      renderCanvas();
      renderChat();
      startPoll({
        onIdle: () => {
          if (!_project || _project.id !== projectId) return;
          const notes = Array.isArray(_project.last_assemble_warnings) ? _project.last_assemble_warnings : [];
          const summary = _project.last_assemble_summary || '';
          const burnFailed = notes.some((n) => /captions failed/i.test(String(n)))
            || !!_project.caption_burn_error
            || /captionsFAILED/i.test(summary);
          if (burnFailed) {
            toast(_project.caption_burn_error
              ? `Caption burn failed: ${_project.caption_burn_error}`
              : (notes.find((n) => /caption/i.test(String(n))) || 'Caption burn failed — Final may not show your new style'), 'error');
          } else if (notes.length) toast(notes.join(' · '), 'info');
          else if (summary && summary !== prevSummary) toast(summary.replace(/^Final reel updated from /, 'Final ready · '), 'success');
          else toast('Final updated', 'success');
        },
      });
      if (data.started || data.already) {
        toast(`Assembling ${clipHint} — canvas will update when ready`, 'success');
      } else if (data.final_url) {
        _project.final_url = data.final_url;
        renderCanvas();
        toast('Final updated', 'success');
      }
    } catch (e) {
      toast(e.message || 'Assemble failed', 'error');
      try {
        const data = await animFetch(`/api/animation/projects/${projectId}`);
        _project = data.project;
        renderCanvas();
        if (_project?.status === 'assembling') startPoll();
      } catch (_) {
        // Stay on the project view even if refresh fails.
        if (_project) {
          _project.status = 'assembling';
          renderCanvas();
          startPoll();
        }
      }
    } finally {
      _busy = false;
    }
  }

  async function selectTake(sceneId, takeId) {
    if (!_project?.id || !sceneId || !takeId) return;
    const data = await animFetch(`/api/animation/projects/${_project.id}/scenes/${sceneId}/select-take`, {
      method: 'POST',
      body: JSON.stringify({ take_id: takeId }),
    });
    _project = data.project;
    _canvasFp = '';
    renderCanvas();
    toast('Take restored — rebuild Final if you want the reel to match', 'success');
  }

  async function stepTake(sceneId, delta) {
    if (!_project?.id || _busy) return;
    const scene = (_project.scenes || []).find((s) => s.id === sceneId);
    if (!scene) return;
    const takes = sceneTakes(scene);
    if (takes.length < 2) return;
    const idx = activeTakeIndex(scene);
    const next = idx + delta;
    if (next < 0 || next >= takes.length) return;
    _busy = true;
    try {
      await selectTake(sceneId, takes[next].id);
    } catch (e) {
      toast(e.message || 'Could not switch take', 'error');
    } finally {
      _busy = false;
    }
  }

  function expandShot(sceneId) {
    const scene = (_project?.scenes || []).find((s) => s.id === sceneId);
    if (!scene?.video_url) return;
    const takes = sceneTakes(scene);
    const idx = activeTakeIndex(scene);
    const take = idx >= 0 ? takes[idx] : null;
    openExpandModal({
      url: scene.video_url,
      title: `${scene.title || scene.id}${takes.length ? ` · take ${idx + 1}/${takes.length}` : ''}`,
      kind: 'shot',
      sceneId: scene.id,
      takeId: take?.id || scene.active_take_id || null,
      canUse: false,
    });
  }

  async function selectFinal(finalId) {
    if (!_project?.id || !finalId || _busy) return;
    _busy = true;
    try {
      const data = await animFetch(`/api/animation/projects/${_project.id}/select-final`, {
        method: 'POST',
        body: JSON.stringify({ final_id: finalId }),
      });
      _project = data.project;
      _canvasFp = '';
      renderCanvas();
      toast('Past Final restored as current', 'success');
    } catch (e) {
      toast(e.message || 'Could not restore Final', 'error');
      throw e;
    } finally {
      _busy = false;
    }
  }

  function renderRefs() {
    const box = document.getElementById('anim-refs');
    if (!box) return;
    if (!_refs.length) {
      box.innerHTML = `<div class="anim-refs-empty">Add refs and tag roles: Character = identity (tag EACH person as Char), Style = art look, Scene = setting</div>`;
      return;
    }
    box.innerHTML = _refs.map((r, i) => `
      <div class="anim-ref-card">
        <div class="anim-ref-chip" title="${esc(r.title || r.url)}">
          <img src="${esc(mediaSrc(r.url))}" alt="" />
          <button type="button" class="anim-ref-x" data-i="${i}" aria-label="Remove">×</button>
        </div>
        <select class="anim-ref-role" data-i="${i}" title="Reference role">
          ${REF_ROLES.map((role) =>
            `<option value="${role.id}" ${r.role === role.id ? 'selected' : ''}>${role.label}</option>`
          ).join('')}
        </select>
      </div>`).join('');
    box.querySelectorAll('.anim-ref-x').forEach((btn) => {
      btn.addEventListener('click', () => {
        _refs.splice(Number(btn.dataset.i), 1);
        renderRefs();
      });
    });
    box.querySelectorAll('.anim-ref-role').forEach((sel) => {
      sel.addEventListener('change', () => {
        const i = Number(sel.dataset.i);
        if (_refs[i]) _refs[i].role = sel.value;
      });
    });
  }

  async function uploadRefFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Please upload an image', 'error');
    if (file.size > 10 * 1024 * 1024) return toast('Image must be under 10MB', 'error');
    if (_refs.length >= 8) return toast('Max 8 reference images', 'error');
    toast('Uploading reference…', 'info');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('image', file);
      const res = await fetch(`${apiBase()}/api/studio/upload-image`, {
        method: 'POST',
        headers: authHeadersMultipart(),
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
      if (data.durable === false || /\/api\/media\//i.test(String(data.url))) {
        throw new Error('Upload did not persist to CDN. Check Atlas API key on the server, then retry.');
      }
      const role = defaultRefRole();
      _refs.push({ url: data.url, title: file.name || 'Upload', role });
      renderRefs();
      toast(`Added as ${role}`, 'success');
    } catch (e) {
      toast(e.message || 'Upload failed', 'error');
    }
  }

  function addRefUrl() {
    const input = document.getElementById('anim-ref-url');
    const raw = (input?.value || '').trim();
    if (!raw) return toast('Paste an image URL first', 'error');
    if (!/^https?:\/\//i.test(raw)) return toast('URL must start with http(s)://', 'error');
    if (_refs.length >= 8) return toast('Max 8 reference images', 'error');
    if (_refs.some((r) => r.url === raw)) return toast('Already attached', 'info');
    const role = defaultRefRole();
    _refs.push({ url: raw, title: 'URL', role });
    if (input) input.value = '';
    renderRefs();
    toast(`Added as ${role}`, 'success');
  }

  async function goHome() {
    stopPoll();
    _project = null;
    _refs = [];
    _recentLoading = true;
    renderCanvas();
    renderChat();
    renderRefs();
    await refreshRecent();
    renderCanvas();
    const actions = document.getElementById('anim-brief-actions');
    if (actions) actions.innerHTML = '';
    const ta = document.getElementById('anim-prompt');
    if (ta) {
      ta.value = '';
      ta.focus();
    }
  }

  async function newProject() {
    // Back to the first Animate screen — do not create a server project until Send.
    goHome();
    toast('Ready for a new idea', 'info');
  }

  window.renderAnimationStudio = async function renderAnimationStudio(data) {
    window.__clientData = data || window.__clientData || window.clientData;
    window.__clientEmail = window.clientEmail || window.__clientEmail || '';
    window.__clientHash = window.clientHash || window.__clientHash || '';
    window.API = typeof API !== 'undefined' ? API : window._seAPI;

    const root = document.getElementById('dash-content');
    if (!root) return;

    // If Animate is already mounted with an open project, don't wipe the canvas
    // (nav re-entry / parent re-render used to bounce Rebuild → Home).
    if (
      _project?.id
      && root.querySelector('.anim-shell')
      && document.getElementById('anim-canvas-body')
    ) {
      if (!_meta) {
        try { _meta = await animFetch('/api/animation/meta'); } catch (_) {}
      }
      if (['developing', 'generating', 'assembling'].includes(_project.status) || projectHasBusyScenes(_project)) {
        startPoll();
      }
      return;
    }

    // Kick project list immediately (don't wait on meta) — home felt empty for ~30s otherwise.
    const recentPromise = (!_project || !_recent.length)
      ? ((_recentLoading = true), refreshRecent({ silent: true }))
      : Promise.resolve();

    if (!_meta) {
      let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          _meta = await animFetch('/api/animation/meta');
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          // Railway edge 502s often surface as "Failed to fetch" (no CORS on the proxy error).
          if (attempt < 3) await new Promise((r) => setTimeout(r, 700 * attempt));
        }
      }
      if (!_meta) {
        root.innerHTML = `<div style="padding:40px;max-width:520px;">
          <div style="color:#F87171;font-weight:700;margin-bottom:8px;">Animation Studio API unavailable</div>
          <div style="color:rgba(255,255,255,0.65);font-size:0.85rem;line-height:1.45;margin-bottom:14px;">${esc(lastErr?.message || 'Failed to fetch')} — usually the API is restarting after a deploy. Wait ~30s and retry.</div>
          <button type="button" class="anim-btn" id="anim-api-retry" style="width:auto;padding:10px 16px;">Retry</button>
        </div>`;
        document.getElementById('anim-api-retry')?.addEventListener('click', () => {
          _meta = null;
          window.renderAnimationStudio(window.__clientData || window.clientData);
        });
        return;
      }
    }

    root.innerHTML = `
      <style>
        .anim-shell { display:grid; grid-template-columns: 1fr minmax(320px,380px); gap:0; height:calc(100vh - 120px); min-height:560px; border:1px solid rgba(255,255,255,0.08); border-radius:16px; overflow:hidden; background:#0B1220; }
        .anim-canvas { display:flex; flex-direction:column; min-width:0; min-height:0; height:100%; border-right:1px solid rgba(255,255,255,0.08); background:radial-gradient(1200px 600px at 10% 0%, rgba(124,58,237,0.12), transparent 55%), #0B1220; }
        .anim-canvas-header { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid rgba(255,255,255,0.06); flex-shrink:0; }
        .anim-canvas-header h2 { margin:0; font-size:1.05rem; color:#F8FAFC; font-weight:700; }
        .anim-canvas-body { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; padding:18px 18px 40px; -webkit-overflow-scrolling:touch; }
        .anim-chat { display:flex; flex-direction:column; min-width:0; min-height:0; height:100%; overflow:hidden; background:#0F172A; }
        .anim-chat-header { padding:14px 16px; border-bottom:1px solid rgba(255,255,255,0.06); flex-shrink:0; }
        .anim-chat-header h3 { margin:0 0 4px; font-size:0.95rem; color:#E2E8F0; }
        .anim-chat-header p { margin:0; font-size:0.72rem; color:rgba(255,255,255,0.4); }
        /* One scroll region for log + brief + compose (compose used to be pinned and clipped). */
        .anim-chat-body { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; display:flex; flex-direction:column; }
        .anim-chat-log { flex:0 0 auto; padding:14px 16px; display:flex; flex-direction:column; gap:12px; }
        .anim-chat-compose { padding:12px 14px 16px; border-top:1px solid rgba(255,255,255,0.06); flex:0 0 auto; }
        .anim-row { display:flex; gap:8px; margin-bottom:8px; }
        .anim-select { flex:1; background:#1E293B; border:1px solid rgba(255,255,255,0.1); color:#E2E8F0; border-radius:8px; padding:8px 10px; font-size:0.78rem; font-family:inherit; }
        .anim-prompt { width:100%; min-height:72px; resize:vertical; background:#1E293B; border:1px solid rgba(255,255,255,0.1); color:#F8FAFC; border-radius:10px; padding:10px 12px; font-size:0.85rem; font-family:inherit; margin-bottom:8px; }
        .anim-refs { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:8px; min-height:28px; }
        .anim-refs-empty { font-size:0.7rem; color:rgba(255,255,255,0.3); padding:4px 0; line-height:1.4; }
        .anim-ref-card { display:flex; flex-direction:column; gap:4px; width:72px; }
        .anim-ref-chip { position:relative; width:72px; height:72px; border-radius:8px; overflow:hidden; border:1px solid rgba(167,139,250,0.45); }
        .anim-ref-chip img { width:100%; height:100%; object-fit:cover; display:block; }
        .anim-ref-x { position:absolute; top:2px; right:2px; width:18px; height:18px; border:none; border-radius:50%; background:rgba(0,0,0,0.7); color:#fff; font-size:12px; line-height:1; cursor:pointer; padding:0; }
        .anim-ref-role { width:100%; background:#1E293B; border:1px solid rgba(255,255,255,0.12); color:#E2E8F0; border-radius:6px; padding:3px 4px; font-size:0.62rem; font-family:inherit; }
        .anim-ref-tools { display:flex; gap:6px; margin-bottom:8px; align-items:center; }
        .anim-model-line { font-size:0.68rem; color:rgba(167,139,250,0.85); margin:-4px 0 10px; }
        .anim-tile__model { display:block; font-size:0.58rem; color:rgba(255,255,255,0.35); margin-top:2px; }
        .anim-lock-banner { margin-top:12px; padding:12px 14px; border-radius:12px; background:rgba(244,114,182,0.1); border:1px solid rgba(244,114,182,0.35); color:#F9A8D4; font-size:0.78rem; line-height:1.4; }
        .anim-expired-banner { margin-top:12px; padding:12px 14px; border-radius:12px; background:rgba(251,191,36,0.1); border:1px solid rgba(251,191,36,0.35); color:#FCD34D; font-size:0.78rem; line-height:1.4; }
        .anim-ref-url { flex:1; background:#1E293B; border:1px solid rgba(255,255,255,0.1); color:#E2E8F0; border-radius:8px; padding:7px 9px; font-size:0.72rem; font-family:inherit; }
        .anim-btn { width:100%; padding:10px 14px; border:none; border-radius:10px; background:linear-gradient(135deg,#7C3AED,#5B21B6); color:#fff; font-weight:700; font-size:0.82rem; cursor:pointer; font-family:inherit; }
        .anim-btn:disabled { opacity:0.5; cursor:not-allowed; }
        .anim-btn--ghost { background:transparent; border:1px solid rgba(255,255,255,0.15); color:#CBD5E1; width:auto; }
        .anim-msg { padding:10px 12px; border-radius:12px; max-width:100%; }
        .anim-msg--user { background:rgba(124,58,237,0.18); border:1px solid rgba(124,58,237,0.3); align-self:flex-end; }
        .anim-msg--agent { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); }
        .anim-msg__role { font-size:0.65rem; font-weight:700; color:#A78BFA; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.04em; }
        .anim-msg__text { font-size:0.82rem; color:#E2E8F0; line-height:1.45; white-space:pre-wrap; }
        .anim-empty { max-width:420px; margin:8vh auto 0; text-align:center; }
        .anim-empty__title { font-size:1.35rem; font-weight:800; color:#F8FAFC; margin-bottom:8px; }
        .anim-empty__desc { font-size:0.88rem; color:rgba(255,255,255,0.55); line-height:1.5; margin-bottom:12px; }
        .anim-empty__hint { font-size:0.75rem; color:rgba(167,139,250,0.85); }
        .anim-recent { max-width:520px; margin:28px auto 0; text-align:left; }
        .anim-recent__list { display:flex; flex-direction:column; gap:8px; }
        .anim-recent__row { display:flex; align-items:stretch; gap:6px; }
        .anim-recent__item { display:flex; align-items:center; justify-content:space-between; gap:12px; flex:1; text-align:left; padding:12px 14px; border-radius:12px; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.03); color:#E2E8F0; cursor:pointer; font-family:inherit; }
        .anim-recent__item:hover { border-color:rgba(167,139,250,0.45); background:rgba(124,58,237,0.12); }
        .anim-recent__del { width:auto !important; padding:0 12px !important; font-size:0.85rem !important; opacity:0.55; }
        .anim-recent__del:hover { opacity:1; color:#FCA5A5 !important; }
        .anim-recent__title { font-size:0.85rem; font-weight:650; color:#F8FAFC; }
        .anim-recent__meta { display:flex; align-items:center; gap:8px; flex-shrink:0; }
        .anim-recent__mode { font-size:0.65rem; color:rgba(255,255,255,0.4); text-transform:uppercase; letter-spacing:0.04em; }
        .anim-canvas-top { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; }
        .anim-section { margin-bottom:22px; }
        .anim-section__label { font-size:0.68rem; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:rgba(255,255,255,0.35); margin-bottom:10px; }
        .anim-strip { display:flex; gap:10px; overflow-x:auto; padding-bottom:4px; }
        .anim-tile { width:110px; flex:0 0 auto; }
        .anim-tile img, .anim-shot__media img, .anim-shot__media video { width:100%; aspect-ratio:1; object-fit:cover; border-radius:10px; background:#1E293B; display:block; }
        .anim-shot__media video { aspect-ratio:9/16; max-height:220px; }
        .anim-shot__updating { position:relative; }
        .anim-shot__updating-badge { position:absolute; left:6px; bottom:6px; z-index:2; font-size:0.62rem; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:#F8FAFC; background:rgba(124,58,237,0.85); border:1px solid rgba(196,181,253,0.5); padding:3px 7px; border-radius:999px; }
        .anim-tile__ph { width:100%; aspect-ratio:1; border-radius:10px; background:rgba(255,255,255,0.04); border:1px dashed rgba(255,255,255,0.12); display:flex; align-items:center; justify-content:center; color:rgba(255,255,255,0.35); font-size:0.7rem; }
        .anim-tile__ph--gen { border:none; position:relative; overflow:hidden; color:#F8FAFC; font-size:0.72rem; font-weight:700; letter-spacing:0.04em; text-transform:uppercase;
          background: linear-gradient(120deg, #1E293B 0%, #312E81 35%, #7C3AED 55%, #1E293B 100%);
          background-size: 220% 220%;
          animation: animShimmer 2.4s ease-in-out infinite; }
        .anim-tile__ph--gen::after { content:''; position:absolute; inset:0; background:linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.18) 50%, transparent 60%); background-size:200% 100%; animation: animSheen 1.8s linear infinite; pointer-events:none; }
        .anim-tile__gen-label { position:relative; z-index:1; text-shadow:0 1px 8px rgba(0,0,0,0.45); }
        .anim-tile__ph--fail { border-style:solid; border-color:rgba(248,113,113,0.35); color:#FCA5A5; background:rgba(248,113,113,0.08); }
        @keyframes animShimmer { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
        @keyframes animSheen { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        .anim-tile__cap { margin-top:6px; font-size:0.68rem; color:rgba(255,255,255,0.5); text-align:center; }
        .anim-timeline { display:flex; flex-direction:column; gap:12px; }
        .anim-timeline--ghost { flex-direction:row; margin-top:10px; }
        .anim-shot { display:grid; grid-template-columns:120px 1fr; gap:12px; padding:12px; border-radius:14px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); }
        .anim-shot--ghost { grid-template-columns:1fr; width:100px; }
        .anim-shot__title { display:flex; align-items:center; gap:8px; font-size:0.85rem; font-weight:700; color:#F1F5F9; margin-bottom:6px; }
        .anim-shot__prompt { font-size:0.75rem; color:rgba(255,255,255,0.45); line-height:1.4; margin-bottom:8px; }
        .anim-shot__prompt-label { display:block; font-size:0.62rem; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:rgba(255,255,255,0.4); margin:0 0 4px; }
        .anim-shot__prompt-edit { width:100%; min-height:64px; resize:vertical; box-sizing:border-box; background:#0F172A; border:1px solid rgba(255,255,255,0.14); color:#F1F5F9; border-radius:8px; padding:8px 10px; font-size:0.75rem; line-height:1.4; font-family:inherit; margin-bottom:8px; }
        .anim-shot__prompt-edit:focus { outline:none; border-color:rgba(167,139,250,0.65); }
        .anim-shot__prompt-edit:disabled { opacity:0.55; cursor:not-allowed; }
        .anim-shot__overrides { display:flex; flex-wrap:wrap; gap:6px; margin:6px 0 8px; }
        .anim-shot__actions { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
        .anim-shot__actions .anim-btn { width:auto; padding:6px 10px; font-size:0.72rem; }
        .anim-add-scene-wrap { margin-top:4px; }
        .anim-add-scene-hint { margin-top:6px; font-size:0.68rem; color:rgba(148,163,184,0.95); line-height:1.35; }
        .anim-assemble-panel { width:100%; margin-top:8px; padding:10px; border-radius:10px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.02); }
        .anim-assemble-flags { display:flex; flex-wrap:wrap; gap:12px; font-size:0.72rem; color:#CBD5E1; }
        .anim-assemble-flags label { display:inline-flex; align-items:center; gap:5px; cursor:pointer; }
        .anim-final__stage { position:relative; width:280px; max-width:100%; border-radius:12px; overflow:hidden; background:#000; }
        .anim-final__video { display:block; width:100%; max-width:280px; border-radius:12px; background:#000; }
        .anim-cap-overlay { position:absolute; left:50%; width:78%; pointer-events:none; z-index:2; text-align:center; }
        .anim-cap-line { display:inline-block; line-height:1.12; letter-spacing:0.01em; max-width:100%; }
        .anim-cap-word { display:inline; margin:0 0.08em; transition: color 80ms linear, transform 120ms ease; }
        .anim-cap-word.is-active { transform: scale(1.05); }
        .anim-cap-studio { margin-top:10px; padding:10px; border-radius:10px; border:1px solid rgba(167,139,250,0.35); background:rgba(124,58,237,0.08); }
        .anim-cap-studio__head { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; color:#E9D5FF; font-size:0.78rem; }
        .anim-cap-quick { display:flex; flex-direction:column; gap:8px; margin-bottom:8px; }
        .anim-cap-chips { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
        .anim-cap-chips__label { font-size:0.62rem; color:rgba(255,255,255,0.45); margin-right:2px; }
        .anim-cap-chip { border:1px solid rgba(255,255,255,0.16); background:rgba(255,255,255,0.04); color:#E2E8F0; border-radius:999px; padding:3px 9px; font-size:0.65rem; cursor:pointer; font-family:inherit; }
        .anim-cap-chip.is-on { border-color:rgba(196,181,253,0.7); background:rgba(124,58,237,0.35); color:#F8FAFC; }
        .anim-cap-slider { display:flex; flex-direction:column; gap:3px; font-size:0.65rem; color:rgba(255,255,255,0.55); }
        .anim-cap-slider strong { color:#E9D5FF; font-variant-numeric:tabular-nums; }
        .anim-cap-slider input[type="range"] { width:100%; }
        .anim-cap-inline { display:flex; flex-wrap:wrap; gap:8px 10px; align-items:center; font-size:0.65rem; color:rgba(255,255,255,0.55); }
        .anim-cap-inline label { display:inline-flex; align-items:center; gap:4px; }
        .anim-cap-inline input[type="number"] { width:56px; background:#0F172A; border:1px solid rgba(255,255,255,0.14); color:#F8FAFC; border-radius:6px; padding:4px 6px; font-size:0.68rem; font-family:inherit; }
        .anim-cap-check { cursor:pointer; }
        .anim-cap-advanced { margin-top:6px; font-size:0.72rem; color:#CBD5E1; }
        .anim-cap-advanced summary { cursor:pointer; color:#C4B5FD; margin-bottom:8px; }
        .anim-cap-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px 10px; }
        .anim-cap-grid label { display:flex; flex-direction:column; gap:4px; font-size:0.65rem; color:rgba(255,255,255,0.55); }
        .anim-cap-grid input[type="range"] { width:100%; }
        .anim-cap-grid input[type="color"] { width:100%; height:28px; border:none; background:transparent; padding:0; }
        .anim-placeholder-row { font-size:0.8rem; color:rgba(255,255,255,0.4); padding:14px; border:1px dashed rgba(255,255,255,0.1); border-radius:12px; }
        .anim-brief-card { margin-top:8px; padding:12px; border-radius:12px; background:rgba(124,58,237,0.1); border:1px solid rgba(124,58,237,0.28); }
        .anim-brief-card__title { font-size:0.72rem; font-weight:700; color:#C4B5FD; margin-bottom:8px; text-transform:uppercase; }
        .anim-brief-edit { width:100%; min-height:90px; background:#0F172A; border:1px solid rgba(255,255,255,0.1); color:#F8FAFC; border-radius:8px; padding:8px; font-size:0.78rem; font-family:inherit; margin-bottom:8px; }
        .anim-brief-shot { font-size:0.72rem; color:rgba(255,255,255,0.55); margin-bottom:4px; }
        .anim-brief-btns { display:flex; gap:8px; margin-top:10px; }
        .anim-brief-btns .anim-btn { width:auto; flex:1; }
        .anim-working { font-size:0.78rem; color:#FBBF24; padding:8px 0; }
        .anim-error { margin-top:12px; padding:10px 12px; border-radius:10px; background:rgba(248,113,113,0.1); border:1px solid rgba(248,113,113,0.3); color:#FCA5A5; font-size:0.78rem; }
        .anim-final { display:flex; flex-direction:column; gap:12px; align-items:flex-start; }
        .anim-take-nav { display:flex; align-items:center; gap:6px; margin-top:8px; flex-wrap:wrap; }
        .anim-take-nav__btn { width:28px; height:28px; border-radius:8px; border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.06); color:#E2E8F0; cursor:pointer; font-size:1rem; line-height:1; }
        .anim-take-nav__btn:disabled { opacity:0.35; cursor:not-allowed; }
        .anim-take-nav__label { font-size:0.68rem; color:rgba(255,255,255,0.55); min-width:2.4em; text-align:center; font-variant-numeric:tabular-nums; }
        .anim-past-finals { margin-top:14px; border-radius:12px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.02); padding:8px 10px; }
        .anim-past-finals__summary { cursor:pointer; font-size:0.72rem; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:rgba(255,255,255,0.4); list-style:none; }
        .anim-past-finals__summary::-webkit-details-marker { display:none; }
        .anim-past-finals__strip { display:flex; gap:8px; overflow-x:auto; padding:10px 0 4px; }
        .anim-past-final { display:flex; align-items:center; gap:8px; flex:0 0 auto; min-width:160px; text-align:left; padding:8px 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.1); background:rgba(15,23,42,0.65); color:#E2E8F0; cursor:pointer; font-family:inherit; }
        .anim-past-final:hover { border-color:rgba(167,139,250,0.45); }
        .anim-past-final__thumb { width:36px; height:48px; border-radius:6px; background:#1E293B; display:flex; align-items:center; justify-content:center; color:#A78BFA; font-size:0.75rem; flex-shrink:0; }
        .anim-past-final__title { font-size:0.72rem; font-weight:650; color:#F8FAFC; }
        .anim-past-final__sub { font-size:0.62rem; color:rgba(255,255,255,0.4); margin-top:2px; }
        .anim-expand { position:fixed; inset:0; z-index:10050; display:flex; align-items:center; justify-content:center; padding:24px; }
        .anim-expand__backdrop { position:absolute; inset:0; background:rgba(2,6,23,0.82); }
        .anim-expand__panel { position:relative; z-index:1; width:min(420px, 92vw); max-height:92vh; display:flex; flex-direction:column; gap:12px; background:#0F172A; border:1px solid rgba(255,255,255,0.12); border-radius:16px; padding:14px; box-shadow:0 24px 80px rgba(0,0,0,0.55); }
        .anim-expand__top { display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .anim-expand__title { font-size:0.85rem; font-weight:700; color:#F8FAFC; }
        .anim-expand__video { width:100%; max-height:70vh; border-radius:12px; background:#000; aspect-ratio:9/16; object-fit:contain; }
        .anim-expand__actions { display:flex; gap:8px; justify-content:flex-end; }
        @media (max-width: 960px) {
          .anim-shell { grid-template-columns:1fr; height:auto; }
          .anim-canvas { border-right:none; border-bottom:1px solid rgba(255,255,255,0.08); min-height:50vh; }
          .anim-chat { min-height:50vh; }
        }
      </style>
      <div class="anim-shell">
        <section class="anim-canvas">
          <div class="anim-canvas-header">
            <h2>Animation Studio</h2>
            <div style="display:flex;gap:8px;align-items:center;">
              <button type="button" class="anim-btn anim-btn--ghost" id="anim-home" style="padding:7px 12px;font-size:0.72rem;" title="Back to start">Home</button>
              <button type="button" class="anim-btn anim-btn--ghost" id="anim-new" style="padding:7px 12px;font-size:0.72rem;">New project</button>
            </div>
          </div>
          <div class="anim-canvas-body" id="anim-canvas-body"></div>
        </section>
        <aside class="anim-chat">
          <div class="anim-chat-header">
            <h3>AI Agent</h3>
            <p>Claude rewrites → you approve → canvas fills</p>
          </div>
          <div class="anim-chat-body">
            <div class="anim-chat-log" id="anim-chat-log"></div>
            <div id="anim-brief-actions" style="padding:0 14px;"></div>
            <div class="anim-chat-compose">
              <div class="anim-row">
                <select id="anim-mode" class="anim-select" title="Mode">${modeOptions()}</select>
                <select id="anim-look" class="anim-select" title="Look">${lookOptions()}</select>
              </div>
              <div class="anim-row" style="margin-top:8px;">
                <select id="anim-motion" class="anim-select" title="Motion" style="flex:1;">${motionOptions()}</select>
                <select id="anim-i2v" class="anim-select" title="I2V model" style="flex:1;">${i2vOptions()}</select>
              </div>
              <div class="anim-row" style="margin-top:8px;">
                <select id="anim-template" class="anim-select" title="Motion template" style="flex:1;">${templateOptions()}</select>
              </div>
              <div id="anim-motion-hint" style="font-size:0.68rem;color:rgba(255,255,255,0.4);line-height:1.4;margin:6px 0 8px;">${esc(motionHint())}</div>
              <div id="anim-drive-wrap" hidden style="margin-bottom:10px;">
                <input type="file" id="anim-drive-file" accept="video/*" hidden />
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                  <button type="button" class="anim-btn anim-btn--ghost" id="anim-drive-upload" style="padding:7px 10px;font-size:0.72rem;width:auto;">Upload driving video</button>
                  <span id="anim-drive-status" style="font-size:0.68rem;color:rgba(255,255,255,0.4);">No driving video yet</span>
                </div>
                ${_project?.driving_video_url ? `<video src="${esc(mediaSrc(_project.driving_video_url))}" muted playsinline controls style="margin-top:8px;width:100%;max-height:120px;border-radius:8px;background:#000;"></video>` : ''}
              </div>
              ${!(_meta?.providers?.fal_configured) ? `<div style="font-size:0.65rem;color:#FCD34D;margin:-2px 0 10px;line-height:1.35;">DreamActor needs FAL_KEY on the API — without it, Auto falls back to Kling only.</div>` : ''}
              <div style="font-size:0.65rem;color:rgba(167,139,250,0.85);line-height:1.4;margin:0 0 10px;">Char = identity. Scene = environment. fal stack: Seedream compose → Seedance (Kling fallback) → DreamActor.</div>
              ${!(_meta?.providers?.elevenlabs_configured) ? `<div style="font-size:0.65rem;color:#FCD34D;margin:0 0 10px;line-height:1.35;">VO + Generate music need ELEVENLABS_API_KEY — captions / upload music / outro still work.</div>` : ''}
              <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin:0 0 6px;">References <span style="font-weight:500;text-transform:none;letter-spacing:0;opacity:0.7;">— tag every person as Char · Scene for setting · Style optional</span></div>
              <div class="anim-refs" id="anim-refs"></div>
              <div class="anim-ref-tools">
                <input type="file" id="anim-ref-file" accept="image/*" multiple hidden />
                <button type="button" class="anim-btn anim-btn--ghost" id="anim-ref-upload" style="padding:7px 10px;font-size:0.72rem;width:auto;white-space:nowrap;">Upload</button>
                <input type="url" id="anim-ref-url" class="anim-ref-url" placeholder="Paste image URL…" />
                <button type="button" class="anim-btn anim-btn--ghost" id="anim-ref-add-url" style="padding:7px 10px;font-size:0.72rem;width:auto;">Add</button>
              </div>
              <textarea id="anim-prompt" class="anim-prompt" placeholder="Describe a character, scene, product, or full video idea…"></textarea>
              <button type="button" class="anim-btn" id="anim-send">Send to Claude</button>
            </div>
          </div>
        </aside>
      </div>
    `;

    document.getElementById('anim-send')?.addEventListener('click', sendPrompt);
    document.getElementById('anim-new')?.addEventListener('click', newProject);
    document.getElementById('anim-home')?.addEventListener('click', goHome);
    document.getElementById('anim-ref-upload')?.addEventListener('click', () => document.getElementById('anim-ref-file')?.click());
    document.getElementById('anim-ref-file')?.addEventListener('change', async (e) => {
      const files = [...(e.target.files || [])];
      for (const f of files) await uploadRefFile(f);
      e.target.value = '';
    });
    document.getElementById('anim-ref-add-url')?.addEventListener('click', addRefUrl);
    document.getElementById('anim-ref-url')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addRefUrl(); }
    });
    document.getElementById('anim-prompt')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendPrompt();
    });
    document.getElementById('anim-motion')?.addEventListener('change', async () => {
      if (_project) _project.motion_mode = document.getElementById('anim-motion').value;
      renderDriveControls();
      if (_project?.id) await syncMotionSettings();
    });
    document.getElementById('anim-i2v')?.addEventListener('change', async () => {
      if (_project) {
        _project.pipeline = _project.pipeline || {};
        _project.pipeline.i2v_model = document.getElementById('anim-i2v').value;
      }
      if (_project?.id) await syncMotionSettings();
    });
    document.getElementById('anim-template')?.addEventListener('change', async () => {
      if (_project) _project.motion_template_id = document.getElementById('anim-template').value || null;
      if (_project?.id) await syncMotionSettings();
    });
    document.getElementById('anim-drive-upload')?.addEventListener('click', () => document.getElementById('anim-drive-file')?.click());
    document.getElementById('anim-drive-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (file) await uploadDrivingVideo(file);
      e.target.value = '';
    });
    renderDriveControls();
    // Restore refs from resumed project (prefer role-tagged references)
    if (!_refs.length) {
      if (_project?.references?.length) {
        _refs = _project.references.map((r) => ({
          url: r.url,
          title: r.title || 'Ref',
          role: r.role || 'character',
        }));
      } else if (_project?.reference_urls?.length) {
        _refs = _project.reference_urls.map((url, i) => ({
          url,
          title: 'Ref',
          role: i === 0 ? 'character' : i === 1 ? 'style' : 'scene',
        }));
      } else if (_project?.character_ref_url) {
        _refs = [{ url: _project.character_ref_url, title: 'Ref', role: 'character' }];
      }
    }
    renderRefs();

    // Paint shell immediately (loading / cached recent), then settle when list returns.
    if (!_project) {
      renderCanvas();
      renderChat();
    }

    await recentPromise;

    // Auto-resume in-flight work; never reopen projects with dead ephemeral media.
    if (_project && projectMediaExpired(_project)) {
      const deadId = _project.id;
      _project = null;
      _refs = [];
      stopPoll();
      if (!_recent.length) await refreshRecent({ silent: true });
      if (deadId) await deleteProject(deadId, { silent: true });
    } else if (!_project) {
      const inflight = _recent.find((p) =>
        !projectMediaExpired(p)
        && ['developing', 'generating', 'assembling', 'brief_ready', 'character_review'].includes(p.status)
      );
      if (inflight) {
        // Summaries aren't full projects — open the real record.
        try {
          const data = await animFetch(`/api/animation/projects/${inflight.id}`);
          _project = data.project;
        } catch (_) {
          _project = null;
        }
      }
    }
    renderCanvas();
    renderChat();
    if (_project && (['developing', 'generating', 'assembling'].includes(_project.status) || projectHasBusyScenes(_project))) {
      startPoll();
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };
})();
