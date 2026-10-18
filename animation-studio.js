/**
 * Animation Studio — canvas-first OiiOii-style UX
 * Left: timeline / asset canvas  |  Right: agent chat + mode/look dropdowns
 */
(function () {
  'use strict';

  let _meta = null;
  let _project = null;
  let _recent = []; // project list for home screen
  let _kits = []; // story kit summaries (Build a Story)
  let _pollTimer = null;
  let _busy = false;
  let _briefing = false;
  let _captionStudioOpen = false;
  let _assembleTab = 'vo'; // vo | captions | music | outro
  let _captionPreviewRaf = 0;
  let _recentLoading = false;
  let _library = [];
  let _refs = []; // [{ url, title, role: 'character'|'item'|'setting'|'style'|'scene' }]
  let _pendingFormatTemplateId = null;
  let _pendingStylePackId = null;
  let _pendingOutroUrl = null;
  let _pendingMusicUrl = null;
  const REF_ROLES = [
    { id: 'character', label: 'Char' },
    { id: 'item', label: 'Item' },
    { id: 'setting', label: 'Setting' },
    { id: 'scene', label: 'Scene' },
    { id: 'style', label: 'Style' },
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
  // Session headers come from the portal (window.seApi, set up in portal.html);
  // this script never sees a credential.
  function seHeaders() {
    return (window.seApi && typeof window.seApi.headers === 'function') ? window.seApi.headers() : {};
  }
  function authHeaders() {
    return Object.assign({ 'Content-Type': 'application/json' }, seHeaders());
  }
  function authHeadersMultipart() {
    return seHeaders();
  }
  // toast(msg, type, ref) — `ref` is the API request_id carried on errors thrown
  // by animFetch, shown as a muted line for support (design §1).
  function toast(msg, type, ref) {
    if (typeof showToast === 'function') showToast(msg, type || 'info', ref ? { ref } : undefined);
  }
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  /** Short customer-facing shot line — never compiled Art Director wrap. */
  // A shot's own control, found by its data-scene (the new look moves controls out of the card).
  function shotControl(sceneId, cls) {
    const id = String(sceneId || '').replace(/["\\]/g, '\\$&');
    return document.querySelector(`${cls}[data-scene="${id}"]`);
  }

  function customerShotLine(s) {
    if (!s) return '';
    const action = String(s.action || '').trim();
    if (action && !/ONE cinematic still/i.test(action)) return action;
    const title = String(s.title || '').trim();
    if (title) return title;
    const prompt = String(s.prompt || '').trim();
    if (!prompt) return '';
    if (/ONE cinematic still/i.test(prompt)) {
      const m = prompt.match(/Action:\s*([^.]*)/i);
      if (m && m[1].trim()) return m[1].trim();
      return 'Shot';
    }
    return prompt;
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
        <span class="anim-tile__gen-label">${esc(status === 'assembling' ? 'Finishing…' : 'Making…')}</span>
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
    const char = projectHasCharacterRef(p) ? 'Identity from Character ref' : 'No Character ref';
    const style = projectHasStyleRef(p) ? ' · Style ref for look' : '';
    return `<div class="anim-model-line">${char}${style}</div>`;
  }

  async function animFetch(path, opts) {
    const resp = await fetch(apiBase() + path, Object.assign({}, opts || {}, { headers: authHeaders() }));
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw apiError(data, resp);
    return data;
  }
  // Error carrying the API contract fields ({ error, code, request_id }) so the
  // catch sites can show the sentence and the reference, never raw detail.
  function apiError(data, resp, fallback) {
    const err = new Error((data && data.error) || fallback || (resp && resp.statusText) || 'Request failed');
    err.code = data && data.code;
    err.request_id = data && data.request_id;
    err.status = resp && resp.status;
    return err;
  }

  function stopPoll() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = null;
  }

  function projectHasBusyScenes(p) {
    return (p?.scenes || []).some((s) => s.status === 'generating' || s.status === 'pending');
  }

  /** A shot check (after each render) is still running: keep polling so its result shows. */
  function projectChecking(p) {
    return (p?.scenes || []).some((s) => {
      const c = s && s.check;
      if (!c || c.status !== 'checking') return false;
      const t = Date.parse(c.started_at || '');
      return Number.isFinite(t) && Date.now() - t < 3 * 60 * 1000;
    });
  }

  /** The shot check's result for the clip the shot shows now (older takes' checks don't count). */
  function shotCheck(s) {
    const c = s && s.check;
    if (!c || !s.video_url || (c.video_url && c.video_url !== s.video_url)) return null;
    return c;
  }

  /** Avoid remounting <video> on every poll tick (causes READY shots to spin). */
  function projectUiFingerprint(p) {
    if (!p) return '';
    const scenes = (p.scenes || []).map((s) => [
      s.id, s.order || 0, s.status, s.video_url || '', s.keyframe_url || '', s.error || '', s.motion || '',
      s.active_take_id || '', (s.takes || []).length, s.prompt || '', s.title || '',
      (s.check && s.check.status) || '', (s.check && s.check.video_url) || '',
    ]);
    return JSON.stringify([
      p.id, p.status, p.error || '', p.final_url || '', p.final_pre_caption_url || '',
      p.final_assembled_at || '', p.active_final_id || '',
      p.caption_burn_error || '', p.last_burned_caption_style?.preset_id || '',
      p.last_burned_caption_style?.burned_at || '', p.last_assemble_summary || '',
      (p.final_history || []).length, _captionStudioOpen ? 1 : 0, scenes,
      (p.chat || []).length, p.editing_started_at || '', p.vo_script || '',
      p.caption_script || '', p.captions_out_of_date ? 1 : 0,
      JSON.stringify(p.story_brief || p.agent_brief?.story_brief || null),
    ]);
  }
  let _canvasFp = '';
  let _pastFinalsOpen = false;
  /** Local shot prompt edits — survive poll remounts until regenerate. */
  const _shotPromptDrafts = Object.create(null);
  /** Caption style draft — survives canvas remounts so Rebuild burns what you picked. */
  let _captionStyleDraft = null;
  /** Unsaved voiceover words, change request and caption words, per project: they survive
   *  every redraw (polls, checks landing) until they are saved. */
  let _voDraft = null;
  let _voDirDraft = null;
  let _capDraft = null;
  const draftFor = (d, p) => (d && p && d.pid === p.id ? d.text : null);
  /** The voiceover as saved, and as the box shows it (an unsaved edit wins). */
  function voSaved(p) { return String((p && (p.vo_script || p.agent_brief?.vo_script)) || ''); }
  function voText(p) { const d = draftFor(_voDraft, p); return d != null ? d : voSaved(p); }
  function voDirty(p) { const d = draftFor(_voDraft, p); return d != null && d.trim() !== voSaved(p).trim(); }
  /** The caption words: the client's own when set, else the voice's words. */
  function capSaved(p) { return String((p && p.caption_source === 'client' && p.caption_script) || ''); }
  function capText(p) { const d = draftFor(_capDraft, p); return d != null ? d : (capSaved(p) || String((p && p.caption_script) || '') || voText(p)); }
  function capDirty(p) { const d = draftFor(_capDraft, p); return d != null && d.trim() !== (capSaved(p) || voText(p)).trim(); }
  /** Composer story choice (type + why) — sent with Write shots. */
  let _storyDraft = { story_type: '', motivator: '', barrier: '', benefit: '', message: '' };
  /** Arc edits on the canvas — survive poll remounts until saved. */
  let _storyArcDraft = null;
  const ANIM_STORY_TYPES_FALLBACK = [
    { id: 'tutorial', label: 'Tutorial / how-to' }, { id: 'qa', label: 'Q&A' }, { id: 'listicle', label: 'Listicle' },
    { id: 'pov', label: 'POV' }, { id: 'types_of', label: 'Types of…' }, { id: 'bts', label: 'Behind the scenes' },
    { id: 'town_hall', label: 'Town hall / update' }, { id: 'before_after', label: 'Before & after' }, { id: 'facts_list', label: 'Facts list' },
  ];
  function animStoryTypes() {
    const list = window.__clientData?.story_types;
    return Array.isArray(list) && list.length ? list : ANIM_STORY_TYPES_FALLBACK;
  }
  function animStoryTypeLabel(id) {
    return animStoryTypes().find((t) => t.id === id)?.label || '';
  }
  function animStoryBriefFromDraft() {
    const d = _storyDraft || {};
    return {
      story_type: d.story_type === 'auto' ? '' : (d.story_type || ''),
      motivator: d.motivator || '',
      barrier: d.barrier || '',
      benefit: d.benefit || '',
      message: d.message || '',
    };
  }
  function renderStoryComposer() {
    const d = _storyDraft || {};
    const opts = animStoryTypes().map((t) => `<option value="${esc(t.id)}" ${d.story_type === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('');
    const field = (key, label, ph) => `<label class="anim-story__field"><span>${label}</span><input type="text" data-story-why="${key}" maxlength="${key === 'message' ? 200 : 300}" placeholder="${ph}" value="${esc(d[key] || '')}" /></label>`;
    const ws = window.__clientData?.brand_worksheet;
    const nudge = ws && !ws.complete
      ? `<button type="button" class="anim-story__nudge" id="anim-story-worksheet">Brand worksheet not finished — scripts will sound generic. Fill it in (2 min)</button>`
      : '';
    return `<div class="anim-story" id="anim-story">
      <select id="anim-story-type" class="anim-select" title="Story type (Meta storytelling formats)">
        <option value="" ${d.story_type ? '' : 'selected'} disabled>Story type…</option>
        <option value="auto" ${d.story_type === 'auto' ? 'selected' : ''}>Let AI pick</option>
        ${opts}
      </select>
      <details class="anim-story__why">
        <summary>Why this post? <em>optional</em></summary>
        ${field('motivator', 'Audience wants…', 'to feel part of something')}
        ${field('barrier', 'What stops them…', 'thinks they are not a runner')}
        ${field('benefit', 'What they get…', 'a reason to start and a team behind them')}
        ${field('message', 'One message', 'Every mile counts — start with one')}
      </details>
      ${nudge}
    </div>`;
  }
  function bindStoryComposer() {
    const root = document.getElementById('anim-story');
    if (!root) return;
    root.querySelector('#anim-story-type')?.addEventListener('change', (e) => {
      _storyDraft = Object.assign({}, _storyDraft, { story_type: e.target.value });
    });
    root.querySelectorAll('[data-story-why]').forEach((inp) => {
      inp.addEventListener('input', () => {
        _storyDraft = Object.assign({}, _storyDraft, { [inp.dataset.storyWhy]: inp.value });
      });
    });
    root.querySelector('#anim-story-worksheet')?.addEventListener('click', () => {
      if (typeof window.switchNav === 'function') window.switchNav('brand-voice');
    });
  }
  function renderStoryArcSection(p) {
    const sb = p?.story_brief || p?.agent_brief?.story_brief;
    if (!p?.agent_brief || !sb) return '';
    const arc = Object.assign({}, sb.arc || {}, _storyArcDraft && _storyArcDraft.id === p.id ? _storyArcDraft.arc : {});
    const typeLabel = animStoryTypeLabel(sb.story_type);
    const row = (key, label, ph) => `<label class="anim-arc__row"><span>${label}</span><textarea rows="2" data-arc="${key}" maxlength="${key === 'middle' ? 500 : 240}" placeholder="${ph}">${esc(arc[key] || '')}</textarea></label>`;
    return `<div class="anim-section" data-nl="arc">
      <div class="anim-section__label">Story${typeLabel ? ` · ${esc(typeLabel)}` : ''}${sb.message ? ` · <span style="text-transform:none;letter-spacing:0;color:rgba(255,255,255,0.55);">${esc(sb.message)}</span>` : ''}</div>
      <div class="anim-arc">
        ${row('hook', 'Hook (first 1–3s)', 'What stops the scroll')}
        ${row('middle', 'Middle', 'The proof or the turn')}
        ${row('payoff', 'Pay-off', 'The feeling or result')}
        ${row('cta', 'One ask', 'The single CTA')}
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
        <button type="button" class="anim-btn anim-btn--ghost" id="anim-arc-save" style="width:auto;padding:5px 12px;font-size:0.7rem;">Save story</button>
        <span style="font-size:0.62rem;color:rgba(255,255,255,0.4);">The voiceover writer and caption follow this arc.</span>
      </div>
    </div>`;
  }
  function bindStoryArcSection(el) {
    const p = _project;
    if (!p || !el) return;
    el.querySelectorAll('[data-arc]').forEach((ta) => {
      ta.addEventListener('input', () => {
        const base = _storyArcDraft && _storyArcDraft.id === p.id ? _storyArcDraft.arc : {};
        _storyArcDraft = { id: p.id, arc: Object.assign({}, base, { [ta.dataset.arc]: ta.value }) };
      });
    });
    el.querySelector('#anim-arc-save')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const sb = p.story_brief || p.agent_brief?.story_brief || {};
      const arc = Object.assign({}, sb.arc || {}, _storyArcDraft && _storyArcDraft.id === p.id ? _storyArcDraft.arc : {});
      btn.disabled = true;
      try {
        const data = await animFetch(`/api/animation/projects/${p.id}/story-brief`, {
          method: 'POST',
          body: JSON.stringify({ story_brief: Object.assign({}, sb, { arc }) }),
        });
        _project = data.project;
        _storyArcDraft = null;
        toast('Story saved', 'success');
      } catch (err) {
        toast(err.message || 'Could not save story', 'error', err.request_id);
      } finally {
        btn.disabled = false;
      }
    });
  }
  const ANIM_LAST_OPEN_LS = 'se_anim_last_project';
  const VO_PLACEHOLDER = "Write or paste the voiceover. We'll build the shots around it.";
  const PROMPT_PLACEHOLDER = 'Describe a character, scene, product, or full video idea…';

  function animEntryKey() {
    const email = String(window.__clientEmail || window.clientEmail || '').trim().toLowerCase();
    return 'se_anim_entry:' + (email || 'anon');
  }
  function readAnimEntry() {
    // The new look leads with the prompt, so a first visit starts on "Describe a video".
    try {
      const v = localStorage.getItem(animEntryKey());
      return v === 'prompt' || v === 'vo' ? v : (nlOn() ? 'prompt' : 'vo');
    } catch { return nlOn() ? 'prompt' : 'vo'; }
  }
  function writeAnimEntry(mode) {
    try { localStorage.setItem(animEntryKey(), mode === 'prompt' ? 'prompt' : 'vo'); } catch (_) { /* private mode */ }
  }
  function applyAnimEntryUI(mode) {
    const vo = mode !== 'prompt';
    document.querySelectorAll('#anim-entry-mode [data-entry]').forEach((b) => {
      const on = b.dataset.entry === (vo ? 'vo' : 'prompt');
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const ta = document.getElementById('anim-prompt');
    if (ta) ta.placeholder = vo ? VO_PLACEHOLDER : PROMPT_PLACEHOLDER;
  }

  function rememberOpenProject(id) {
    try {
      if (id) localStorage.setItem(ANIM_LAST_OPEN_LS, String(id));
      else localStorage.removeItem(ANIM_LAST_OPEN_LS);
    } catch (_) { /* private mode */ }
  }

  function lastOpenProjectId() {
    try { return String(localStorage.getItem(ANIM_LAST_OPEN_LS) || '').trim(); }
    catch { return ''; }
  }

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
        toast(e.message || 'Could not restore', 'error', e.request_id);
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
        if (projectBusy || projectHasBusyScenes(_project) || projectChecking(_project)) {
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
      { id: 'auto', label: 'Auto' },
      { id: 'drive', label: 'Driving video' },
      { id: 'kling', label: 'From still' },
    ];
    const cur = currentMotionMode();
    return modes.map((m) =>
      `<option value="${esc(m.id)}" ${cur === m.id ? 'selected' : ''}>${esc(m.label)}</option>`
    ).join('');
  }

  function currentI2vModel() {
    return _project?.pipeline?.i2v_model || _meta?.default_i2v_model || 'seedance';
  }

  function resetComposeDefaults() {
    const modeEl = document.getElementById('anim-mode');
    if (modeEl) modeEl.value = 'video';
    const lookEl = document.getElementById('anim-look');
    if (lookEl) lookEl.value = 'stylized';
    const motionEl = document.getElementById('anim-motion');
    if (motionEl) motionEl.value = _meta?.default_motion_mode || 'auto';
    const i2vEl = document.getElementById('anim-i2v');
    if (i2vEl) i2vEl.value = _meta?.default_i2v_model || 'seedance';
    const tplEl = document.getElementById('anim-template');
    if (tplEl) tplEl.value = '';
    const hint = document.getElementById('anim-motion-hint');
    if (hint) hint.textContent = motionHint();
  }

  function i2vOptions() {
    const models = _meta?.i2v_models || [
      { id: 'seedance', label: 'Smooth motion' },
      { id: 'kling', label: 'Kling' },
      { id: 'auto', label: 'Auto' },
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
    if (id === 'drive') return 'Upload a short driving video — we map your character onto that motion.';
    if (id === 'kling') return 'Motion from the still only (no driving video).';
    return 'We build each still, then add natural motion while keeping the same person.';
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

  function defaultOutroUrl(library, current) {
    if (current) return current;
    const list = (library || []).filter((a) => a && a.kind === 'outro' && /^https?:\/\//i.test(a.url || ''));
    return list[0]?.url || '';
  }

  async function maybeAttachDefaultOutro() {
    if (!_project?.id) return;
    if (!assembleFlags().outro || _project.outro_url) return;
    const url = defaultOutroUrl(_library, _pendingOutroUrl || '');
    if (!url) return;
    _project.outro_url = url;
    await syncMotionSettings();
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
      position: { y_pct: 62, align: 'center' }, animation: 'pop', words_per_line: 4, text_case: 'as_is',
    };
    const s = input && typeof input === 'object' ? { ...fallback, ...input } : { ...fallback };
    if (!['karaoke', 'phrase', 'static'].includes(s.mode)) s.mode = 'karaoke';
    if (!['none', 'pop', 'fade', 'bounce'].includes(s.animation)) s.animation = 'pop';
    if (!['as_is', 'upper', 'title'].includes(s.text_case)) s.text_case = 'as_is';
    s.words_per_line = Math.max(1, Math.min(10, Number(s.words_per_line) || 3));
    s.font_size = Math.max(16, Math.min(96, Number(s.font_size) || 42));
    s.max_width_pct = Math.max(40, Math.min(96, Number(s.max_width_pct) || 78));
    s.letter_spacing = Math.max(0, Math.min(6, Number(s.letter_spacing) || 0));
    s.position = s.position || { y_pct: 62, align: 'center' };
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
    if (Array.isArray(_project?.caption_words) && _project.caption_words.length) return _project.caption_words;
    if (Array.isArray(_project?.caption_cues) && _project.caption_cues.length) return _project.caption_cues;
    // On-video words follow spoken VO only — never the social/post caption.
    const text = document.getElementById('anim-vo-script')?.value
      || _project?.vo_script
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
          || document.getElementById('anim-vo-script')?.value
          || _project?.vo_script
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
        y_pct: num('anim-cap-y', base.position?.y_pct || 62),
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

  // Meta Reels/Stories: keep the bottom 35% clear of text.
  const CAPTION_SAFE_MAX_Y = 65;

  function paintCaptionOverlay(t) {
    const stage = document.getElementById('anim-cap-overlay');
    if (!stage) return;
    // Live overlay is edit-preview only. After Rebuild, captions are burned into
    // the Final — leaving the overlay on stacks a second caption on top.
    const safeZone = document.getElementById('anim-safe-zone');
    if (!_captionStudioOpen) {
      stage.innerHTML = '';
      stage.hidden = true;
      stage.setAttribute('aria-hidden', 'true');
      if (safeZone) safeZone.hidden = true;
      return;
    }
    stage.hidden = false;
    stage.setAttribute('aria-hidden', 'false');
    if (safeZone) safeZone.hidden = false;
    const style = readCaptionStyleFromDom();
    const layout = captionLayoutAtTime(captionCuesForPreview(), style, t);
    const y = style.position?.y_pct ?? 62;
    const yLabel = document.getElementById('anim-cap-y-val');
    if (yLabel) yLabel.textContent = `${y}%`;
    const unsafe = y > CAPTION_SAFE_MAX_Y;
    const warn = document.getElementById('anim-cap-safe-warn');
    if (warn) warn.hidden = !unsafe;
    if (safeZone) safeZone.classList.toggle('is-violated', unsafe);
    const outline = Math.max(0, style.outline_width || 0);
    const widthPct = style.max_width_pct || 78;
    const pad = style.background?.padding ?? 8;
    const rad = style.background?.radius ?? 8;
    const box = style.background?.enabled
      ? `background:${style.background.color};padding:${Math.max(2, Math.round(pad * 0.55))}px ${Math.max(6, Math.round(pad * 0.9))}px;border-radius:${rad >= 200 ? 999 : Math.round(rad * 0.55)}px;`
      : '';
    // Preview is ~280px wide vs 1080 design; scale font ~0.38 so Size slider feels true.
    const previewPx = Math.max(11, Math.round((style.font_size || 42) * 0.38));
    // Burn uses ASS \an2: y_pct is the caption's bottom edge, not its centre.
    stage.style.top = `${y}%`;
    stage.style.width = `${widthPct}%`;
    stage.style.transform = 'translate(-50%, -100%)';
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
          <label class="anim-cap-slider">Vertical <strong id="anim-cap-y-val">${style.position?.y_pct || 62}%</strong>
            <input id="anim-cap-y" type="range" min="50" max="92" value="${style.position?.y_pct || 62}" />
          </label>
          <div id="anim-cap-safe-warn" class="anim-cap-safe-warn" ${(style.position?.y_pct || 62) > CAPTION_SAFE_MAX_Y ? '' : 'hidden'}>
            Captions sit in the bottom 35% — Reels/Stories buttons and the caption cover this area. Keep Vertical at ${CAPTION_SAFE_MAX_Y}% or less.
          </div>
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
    if (document.getElementById('anim-vo-direction')) {
      body.vo_direction = document.getElementById('anim-vo-direction').value;
    }
    // Clear legacy on-video caption_text (removed UI box — burn uses VO script).
    body.caption_text = '';
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
      if (data.project) _project = data.project;
      // The words in the boxes went with it: they are saved now.
      if (_voDraft && _voDraft.pid === _project.id && !voDirty(_project)) _voDraft = null;
    } catch (e) {
      toast(e.message || 'Could not save motion settings', 'error', e.request_id);
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
      const res = await fetch(`${apiBase()}/api/studio/upload-video`, {
        method: 'POST',
        headers: authHeadersMultipart(),
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw apiError(data, res, 'Upload failed');
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
      toast(e.message || 'Driving video upload failed', 'error', e.request_id);
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
      story: '#94A3B8',
    };
    const c = colors[status] || '#94A3B8';
    if (nlOn()) {
      // New look: a quiet pill in plain words.
      const words = { story: 'Draft', draft: 'Draft', brief: 'Draft', brief_ready: 'Plan ready', developing: 'Making', generating: 'Making', assembling: 'Finishing', character_review: 'Check cast', ready: 'Ready', failed: 'Failed', pending: 'Waiting' };
      const tone = status === 'ready' ? 'ok' : status === 'failed' ? 'bad' : ['developing', 'generating', 'assembling'].includes(status) ? 'gen' : 'todo';
      return `<span class="nl-spill nl-spill--${tone}">${esc(words[status] || status || 'Draft')}</span>`;
    }
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

  function savedShotsAllowed(p) {
    if (!p) return false;
    if (['briefing', 'developing', 'character_review'].includes(p.status)) return false;
    return true;
  }

  function savedShotsHtml({ disabled } = {}) {
    const helpers = assetHelpers();
    const shots = helpers.filterKind(_library, 'shot');
    if (!shots.length) return '';
    return `
      <div class="anim-saved-shots" id="anim-saved-shots">
        <div class="anim-section__label">Saved shots</div>
        <p class="anim-saved-shots__hint">Add a clip as-is, or a recipe you can regenerate. This video’s character lock does not rewrite an old clip.</p>
        <div class="anim-saved-shots__row">
          ${shots.map((a) => {
            const clip = String((a.recipe && a.recipe.video_url) || a.url || '');
            const isClip = /\.(mp4|webm|mov)(\?|$)/i.test(clip);
            const thumb = (a.recipe && a.recipe.keyframe_url) || a.url;
            return `
              <button type="button" class="anim-saved-shot" data-saved-shot="${esc(a.id)}" ${disabled ? 'disabled' : ''} title="${esc(helpers.labelOf(a))}">
                ${isClip
                  ? `<video src="${esc(mediaSrc(clip))}" muted preload="metadata"></video>`
                  : `<img src="${esc(mediaSrc(thumb))}" alt="" />`}
                <span>${esc(helpers.labelOf(a))}</span>
              </button>`;
          }).join('')}
        </div>
      </div>`;
  }

  /** Second line of a recent project in the new look: how it was made and how long. */
  function nlRecentSub(p) {
    const kit = p.workflow === 'story' ? _kits.find((k) => k.id === p.kit_id) : null;
    const how = p.workflow === 'story' ? (kit ? `Story · ${kit.title}` : 'Story') : 'Prompt';
    const n = p.workflow === 'story' && !p.scene_count ? p.story_scene_count : p.scene_count;
    return n ? `${how} · ${n} ${p.workflow === 'story' ? 'scene' : 'shot'}${n === 1 ? '' : 's'}` : how;
  }

  function projectTitle(p) {
    return p?.agent_brief?.title || p?.story_title || p?.story?.title || p?.user_prompt?.slice(0, 48) || (p?.workflow === 'story' ? 'Untitled story' : 'Untitled project');
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

  function assetHelpers() {
    return window.SEAssets || {
      filterKind: (list, kind) => (list || []).filter((a) => a && a.kind === kind),
      labelOf: (a) => (a && a.name) || (a && a.kind) || 'Asset',
      selectedId: (list, url) => ((list || []).find((a) => a && a.url === url) || {}).id || '',
      selectedUrl: (list, id) => ((list || []).find((a) => a && a.id === id) || {}).url || '',
      acceptFor: (kind) => (kind === 'music' ? 'audio/*,video/*' : kind === 'logo' ? 'image/*' : 'video/*'),
    };
  }

  async function refreshLibrary({ silent } = {}) {
    try {
      const data = await animFetch('/api/assets');
      _library = Array.isArray(data.assets) ? data.assets : [];
    } catch (e) {
      if (!silent) toast(e.message || 'Could not load the library', 'error', e.request_id);
    }
    await maybeAttachDefaultOutro();
  }

  function renderSavedPicker(kind, selectedUrl) {
    const helpers = assetHelpers();
    const list = helpers.filterKind(_library, kind);
    const sel = helpers.selectedId(list, selectedUrl);
    const heading = kind === 'music' ? 'Library' : 'Library';
    const preview = selectedUrl
      ? (kind === 'music'
        ? `<audio class="anim-lib-preview" id="anim-${kind}-preview" src="${esc(mediaSrc(selectedUrl))}" controls preload="metadata"></audio>`
        : `<video class="anim-lib-preview" id="anim-${kind}-preview" src="${esc(mediaSrc(selectedUrl))}" muted playsinline preload="metadata" title="Preview"></video>`)
      : '';
    return `
      <div class="anim-asset-row">
        <select id="anim-${kind}-pick" class="anim-select anim-asset-row__pick" title="${esc(selectedUrl || heading)}">
          <option value="">None — choose or upload</option>
          ${list.map((a) => `<option value="${esc(a.id)}" ${a.id === sel ? 'selected' : ''} title="${esc(a.url || '')}">${esc(helpers.labelOf(a))}</option>`).join('')}
        </select>
        <input type="file" id="anim-${kind}-file" accept="${esc(helpers.acceptFor(kind))}" hidden />
        <button type="button" class="anim-btn anim-btn--ghost" id="anim-${kind}-upload">Upload</button>
      </div>
      ${preview ? `<div class="anim-asset-row__preview">${preview}</div>` : ''}
    `;
  }

  async function refreshRecent({ silent } = {}) {
    _recentLoading = true;
    try {
      const list = await animFetch('/api/animation/projects');
      _recent = list.projects || [];
      _kits = Array.isArray(list.kits) ? list.kits : _kits;
      if (!silent && list.purged > 0) {
        toast(`Removed ${list.purged} expired project${list.purged === 1 ? '' : 's'} (old links from a server restart)`, 'info');
      }
    } catch (e) {
      // Keep prior cache on failure so a slow/flaky list doesn't wipe the home screen.
      if (!_recent.length) {
        _recent = [];
        if (!silent) toast(e.message || 'Could not load recent projects', 'error', e.request_id);
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
        rememberOpenProject('');
      }
      if (!silent) toast('Expired project removed', 'success');
      renderCanvas();
      renderChat();
      renderRefs();
    } catch (e) {
      if (!silent) toast(e.message || 'Could not delete project', 'error', e.request_id);
    }
  }

  async function openProject(id) {
    if (!id || _busy) return;
    try {
      const data = await animFetch(`/api/animation/projects/${id}`);
      // A story reel that has not been made yet opens in Build a Story, not the board.
      if (window.SEStory && nlOn() && window.SEStory.claims(data.project)) {
        window.SEStory.openReel(data.project);
        return;
      }
      _project = data.project;
      if (projectMediaExpired(_project)) {
        toast('Some media links expired after a restart — re-upload Char refs. Project was kept.', 'warning');
        // Do NOT auto-delete. Prior behavior wiped multi-hour projects.
      } else if (projectNeedsCharReupload(_project)) {
        toast('Character refs need a re-upload after a restart. Your shots and finals are still here.', 'warning');
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
      await maybeAttachDefaultOutro();
      renderCanvas();
      renderChat();
      renderRefs();
      if (['developing', 'generating', 'assembling'].includes(_project.status) || projectHasBusyScenes(_project) || projectChecking(_project)) {
        startPoll();
      }
      else stopPoll();
      toast(`Opened ${projectTitle(_project)}`, 'success');
      rememberOpenProject(_project.id);
    } catch (e) {
      await refreshRecent();
      _project = null;
      renderCanvas();
      renderChat();
      renderRefs();
      toast(e.message || 'Could not open project', 'error', e.request_id);
    }
  }

  // New look: where the project is, as steps (Brief › Character › Shots › Final). Painted by
  // paintStepsNL() into the canvas header so it survives canvas re-renders.
  function animStepsNL(p) {
    const scenes = (p && p.scenes) || [];
    const shotsDone = scenes.length > 0 && scenes.every((sc) => sc.video_url || sc.status === 'ready' || sc.status === 'done');
    const steps = [
      ['Brief', !!(p && p.agent_brief)],
      ['Character', !!(p && p.character_pack && (p.character_pack.locked || (p.character_pack.views || []).some((v) => v.url)))],
      ['Shots', shotsDone],
      ['Final', !!(p && p.final_url)],
    ];
    const now = steps.findIndex((x) => !x[1]);
    return steps.map(([label, done], i) => `${label}|${done ? 'done' : i === now ? 'now' : 'todo'}`).join(',');
  }
  function paintStepsNL() {
    const head = document.querySelector('.anim-canvas-header');
    const body = document.getElementById('anim-canvas-body');
    if (!head || !body) return;
    let bar = head.querySelector('.nl-steps');
    const spec = _project ? (body.dataset.nlSteps || '') : '';
    if (!spec) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('ol');
      bar.className = 'nl-steps';
      bar.setAttribute('aria-label', 'Steps');
      const after = head.querySelector('.nl-sbar');
      head.insertBefore(bar, after ? after.nextSibling : (head.children[1] || null));
    }
    bar.innerHTML = spec.split(',').map((x, i) => {
      const [label, st] = x.split('|');
      return `<li class="nl-step nl-step--${st}"${st === 'now' ? ' aria-current="step"' : ''}><span class="nl-step__n">${st === 'done' ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : i + 1}</span>${esc(label)}</li>`;
    }).join('');
  }


  // ── New look: the Animate board ──
  // The studio renders exactly as before. In the new look its pieces, with their listeners,
  // are moved into the board layout: a brief card, tall shot cards with a selected-shot bar,
  // the ask bar, timeline tracks, and a Sound and finish column. The composer moves once;
  // canvas pieces are re-placed after every renderCanvas.
  let _nlSelShot = null;
  let _nlTl = null; // timeline being edited: { pid, order: [ids], trims: {id: {in,out}|null}, removed: Set, durs: {id: sec}, sel }
  let _nlSavedOpen = false;
  let _nlArcOpen = false;
  let _nlMoreOpen = false;
  let _nlLastPid = null;
  /** The client chose "New shot plan" on a finished reel: show the brief writer again. */
  let _nlPlanMode = false;
  /** Cast and settings section open (folded by default). */
  let _nlCastOpen = false;
  /** An edit message is with the editor (waiting for its reply). */
  let _nlEditPending = false;
  const _nlLaneOpen = new Set();
  const NL_I = {
    mic: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5.5 11a6.5 6.5 0 0 0 13 0 M12 17.5V21',
    cc: 'M4 6h16v12H4z M10 10.5a2 2 0 1 0 0 3 M16 10.5a2 2 0 1 0 0 3',
    music: 'M9 18V6l10-2v12 M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z M19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
    flag: 'M5 21V4 M5 4h11l-2 4 2 4H5',
    lock: 'M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    chev: 'M6 9l6 6 6-6',
    spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
    check: 'M5 12.5l4.2 4.2L19 7',
    film: 'M4 5h16v14H4z M8 5v14 M16 5v14 M4 9.5h4 M4 14.5h4 M16 9.5h4 M16 14.5h4',
    info: 'M12 8h.01 M11 12h1v5h1 M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z',
    send: 'M5 12h13 M13 6l6 6-6 6',
    image: 'M4 5h16v14H4z M9 10.5a1.5 1.5 0 1 0 0-.01 M20 15l-5-5-9 9',
    x: 'M6 6l12 12 M18 6L6 18',
    left: 'M15 6l-6 6 6 6',
    right: 'M9 6l6 6-6 6',
    play: 'M8 5.5v13l10.5-6.5z',
    warn: 'M12 4.5l8.5 15h-17z M12 10v4 M12 16.8h.01',
    stop: 'M7 7h10v10H7z',
  };
  const nlSvg = (d, size = 13, sw = 1.9) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  function nlOn() { return document.documentElement.classList.contains('nl'); }
  function nlClipSecs(s) { return Number(s && s.video_sec) > 0 ? Number(s.video_sec) : Math.min(8, Math.max(4, Number(s && s.duration_target) || 5)); }
  /** Seconds a shot plays for, after any timeline trim. */
  function nlShotSecs(s, trim) {
    const base = nlClipSecs(s);
    const t = trim !== undefined ? trim : (s && s.trim);
    if (!t) return base;
    const a = Math.max(0, Number(t.in) || 0);
    const b = t.out == null ? base : Math.min(base, Number(t.out));
    return Math.max(0.5, b - a);
  }
  function nlClock(sec) { const t = Math.max(0, Math.round(sec)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
  function nlScenes() { return ((_project && _project.scenes) || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)); }
  function nlShotState(s) {
    const st = String((s && s.status) || '').toLowerCase();
    if (st === 'generating') return { key: 'gen', label: s && s.check && s.check.status === 'redoing' ? 'Redoing' : 'Rendering' };
    if (st === 'failed' || (s && s.error)) return { key: 'bad', label: 'Failed' };
    if ((s && s.video_url) || st === 'ready' || st === 'done') {
      // Ready shots carry the shot check's result: checking, checked, or one to look at.
      const c = shotCheck(s);
      if (c && c.status === 'checking') return { key: 'ok', flag: 'chk', label: 'Checking' };
      if (c && c.status === 'flagged') return { key: 'ok', flag: 'warn', label: 'Flagged', note: c.summary || '' };
      if (c && c.status === 'minor') return { key: 'ok', flag: 'minor', label: 'Checked', note: c.summary || '' };
      if (c && c.status === 'pass') return { key: 'ok', flag: 'pass', label: 'Checked' };
      return { key: 'ok', label: 'Ready' };
    }
    return { key: 'todo', label: 'Not made yet' };
  }

  function nlAnimRoot() {
    const shell = document.querySelector('.anim-shell');
    const canvas = shell && shell.querySelector('.anim-canvas');
    if (!canvas) return null;
    let root = canvas.querySelector(':scope > .nl-anim');
    if (root) return root;
    root = document.createElement('div');
    root.className = 'nl-anim';
    root.innerHTML = `
      <div class="nl-anim__main">
        <div data-slot="err"></div>
        <section class="nl-aask nl-ahero" aria-labelledby="nl-ahero-t">
          <div class="nl-ahero__h">
            <h2 class="nl-ahero__t" id="nl-ahero-t">Describe your video</h2>
            <p class="nl-ahero__s" data-slot="hero-sub">One idea is enough. It becomes a set of shots, and nothing renders until you accept them.</p>
          </div>
          <div class="nl-ahero__box">
            <div data-slot="prompt"></div>
            <div class="nl-ahero__bar">
              <button type="button" class="nl-abtn nl-abtn--icon nl-aref" data-nl-cast aria-expanded="false" title="Add a character, product or place photo">${nlSvg(NL_I.image, 15)}<span class="nl-aref__l">Reference</span><span class="nl-aref__n" data-slot="ref-count" hidden></span></button>
              <div data-slot="entry"></div>
              <div data-slot="look" class="nl-alook"></div>
              <label data-slot="length" class="nl-alen" title="How long the reel should be"><span>Length</span><select id="anim-length" aria-label="Reel length"><option value="15">15s</option><option value="30">30s</option><option value="45">45s</option></select></label>
              <div data-slot="story" class="nl-astory"></div>
              <span class="nl-grow"></span>
              <button type="button" class="nl-alink" data-nl-plan hidden>New shot plan</button>
              <span data-slot="packs"></span><span data-slot="send"></span>
            </div>
          </div>
          <div class="nl-ahero__ideas" data-slot="ideas" hidden></div>
          <div class="nl-ahero__ideas nl-ahero__edits" data-slot="edits" hidden></div>
          <div data-slot="log" class="nl-aask__log"></div>
          <div data-slot="actions"></div>
          <span data-slot="tokens" class="nl-aask__tokens" hidden></span>
        </section>
        <section class="nl-acard nl-abrief" aria-label="Cast and settings">
          <div class="nl-abrief__row">
            <button type="button" class="nl-abrief__toggle" data-nl-brief aria-expanded="false" aria-controls="nl-abrief-body">
              ${nlSvg(NL_I.chev, 13, 2)}<span class="nl-abrief__t">Cast and settings</span><span class="nl-abrief__sum" data-slot="brief-sum"></span>
            </button>
            <span class="nl-acast__lock" data-slot="lock"></span>
            <span class="nl-grow"></span>
            <button type="button" class="nl-abtn nl-abtn--dash" data-nl-drive hidden>Driving video</button>
            <button type="button" class="nl-abtn" data-nl-more aria-expanded="false">More settings</button>
          </div>
          <div class="nl-abrief__body" id="nl-abrief-body" hidden>
            <div data-slot="more" class="nl-abrief__more" hidden></div>
            <div data-slot="drive"></div>
            <div class="nl-acast">
              <div class="nl-afield__l">Cast and places</div>
              <div data-slot="cast" class="nl-acast__row"></div>
            </div>
            <div data-slot="why"></div>
            <div data-slot="char"></div>
            <div data-slot="arc"></div>
          </div>
        </section>
        <section class="nl-acard nl-ashots" aria-labelledby="nl-shots-title">
          <div class="nl-acard__h">
            <h2 id="nl-shots-title">Shots <span class="nl-acard__meta" data-slot="shots-meta"></span></h2>
            <span class="nl-acard__tools"><button type="button" class="nl-abtn" data-nl-saved hidden aria-expanded="false">Saved shots</button></span>
          </div>
          <div data-slot="saved" class="nl-asaved" hidden></div>
          <div data-slot="shots" class="nl-ashots__grid"></div>
          <div data-slot="shotbar"></div>
        </section>
        <section class="nl-acard nl-atl" aria-labelledby="nl-tl-title" data-slot="tl" hidden></section>
        <div data-slot="home" class="nl-ahome"></div>
      </div>
      <aside class="nl-anim__side" aria-label="Sound and finish">
        <div data-slot="lanes" class="nl-alanes"></div>
        <section class="nl-afinal" aria-labelledby="nl-final-title" data-slot="final"></section>
      </aside>`;
    canvas.appendChild(root);
    shell.classList.add('nl-anim-on');
    nlAdoptComposer(root);
    if (window.SEStory) {
      try { window.SEStory.attach(root, nlStoryHost()); } catch (e) { console.warn('[animate] story builder', e); }
    }
    return root;
  }

  // Move the chat-side controls into the board once. Nodes keep their ids and listeners.
  function nlAdoptComposer(root) {
    const slot = (n) => root.querySelector(`[data-slot="${n}"]`);
    const put = (name, node) => { if (node && slot(name)) slot(name).appendChild(node); };
    put('entry', document.getElementById('anim-entry-mode'));
    const entryEl = document.getElementById('anim-entry-mode');
    const promptBtn = entryEl && entryEl.querySelector('[data-entry="prompt"]');
    if (promptBtn && entryEl.firstElementChild !== promptBtn) entryEl.insertBefore(promptBtn, entryEl.firstElementChild);
    put('story', document.getElementById('anim-story-type'));
    const storySel = document.getElementById('anim-story-type');
    if (storySel && !(_storyDraft && _storyDraft.story_type)) {
      _storyDraft = Object.assign({}, _storyDraft, { story_type: 'auto' });
      storySel.value = 'auto';
    }
    put('why', document.getElementById('anim-story'));
    const len = document.getElementById('anim-length');
    if (len) {
      try { const v = localStorage.getItem(NL_LEN_LS); if (['15', '30', '45'].includes(v)) len.value = v; } catch (_) { /* private mode */ }
      len.addEventListener('change', () => { try { localStorage.setItem(NL_LEN_LS, len.value); } catch (_) { /* private mode */ } });
    }
    const look = document.getElementById('anim-look');
    if (look) {
      const lookSlot = slot('look');
      lookSlot.appendChild(look);
      if (look.options.length && look.options.length <= 4) {
        look.classList.add('nl-sr');
        look.tabIndex = -1;
        const seg = document.createElement('div');
        seg.className = 'nl-aseg';
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', 'Look');
        const paint = () => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === look.value ? 'true' : 'false'));
        seg.innerHTML = [...look.options].map((o) => `<button type="button" data-v="${esc(o.value)}">${esc(String(o.textContent || '').replace(/ \/ animated$/i, ''))}</button>`).join('');
        seg.addEventListener('click', (e) => {
          const b = e.target.closest('button[data-v]');
          if (!b) return;
          look.value = b.dataset.v;
          look.dispatchEvent(new Event('change', { bubbles: true }));
          paint();
        });
        look.addEventListener('change', paint);
        lookSlot.appendChild(seg);
        paint();
      }
    }
    put('cast', document.getElementById('anim-refs'));
    put('cast', document.querySelector('.anim-ref-tools'));
    put('drive', document.getElementById('anim-drive-wrap'));
    const settings = document.querySelector('.anim-chat-settings');
    if (settings) {
      settings.open = true;
      settings.querySelectorAll('.anim-chat-settings__body > div').forEach((d) => {
        if (String(d.textContent || '').trim() === 'References') d.hidden = true;
      });
      put('more', settings);
    }
    put('log', document.getElementById('anim-chat-log'));
    put('actions', document.getElementById('anim-brief-actions'));
    put('prompt', document.getElementById('anim-prompt'));
    put('packs', document.getElementById('anim-pending-packs'));
    put('send', document.getElementById('anim-send'));

    slot('entry').addEventListener('click', () => setTimeout(() => { nlTokens(slot('tokens')); nlHeroState(root); }, 0));
    document.getElementById('anim-look')?.addEventListener('change', () => { nlTokens(slot('tokens')); nlBriefSummary(root); });
    document.getElementById('anim-story-type')?.addEventListener('change', () => nlBriefSummary(root));
    const more = root.querySelector('[data-nl-more]');
    const moreSlot = slot('more');
    const paintMore = () => { moreSlot.hidden = !_nlMoreOpen; more.setAttribute('aria-expanded', _nlMoreOpen ? 'true' : 'false'); };
    more.addEventListener('click', () => { _nlMoreOpen = !_nlMoreOpen; paintMore(); });
    paintMore();

    const motion = document.getElementById('anim-motion');
    const drive = root.querySelector('[data-nl-drive]');
    if (motion && [...motion.options].some((o) => o.value === 'drive')) {
      drive.hidden = false;
      drive.addEventListener('click', () => {
        if (motion.value !== 'drive') {
          motion.value = 'drive';
          motion.dispatchEvent(new Event('change', { bubbles: true }));
          toast('Driving video is on. Upload the clip to copy its motion.', 'info');
        } else {
          document.getElementById('anim-drive-file')?.click();
        }
      });
    }

    // Cast and settings fold away; the Reference button in the prompt bar opens them.
    const briefBtn = root.querySelector('[data-nl-brief]');
    const briefBody = root.querySelector('.nl-abrief__body');
    const castBtn = root.querySelector('[data-nl-cast]');
    const paintBrief = () => {
      briefBody.hidden = !_nlCastOpen;
      briefBtn.setAttribute('aria-expanded', _nlCastOpen ? 'true' : 'false');
      castBtn.setAttribute('aria-expanded', _nlCastOpen ? 'true' : 'false');
      root.classList.toggle('nl-abrief-open', _nlCastOpen);
    };
    briefBtn.addEventListener('click', () => { _nlCastOpen = !_nlCastOpen; paintBrief(); });
    castBtn.addEventListener('click', () => {
      _nlCastOpen = true;
      paintBrief();
      const card = root.querySelector('.nl-abrief');
      card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTimeout(() => card?.querySelector('.anim-ref-tools button, .anim-ref-tools input')?.focus({ preventScroll: true }), 250);
    });
    paintBrief();

    // On a finished reel the prompt is a chat with the editor: Send and Enter go to /edit.
    slot('send').addEventListener('click', (e) => {
      if (!nlEditorMode() || !e.target.closest('#anim-send')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      nlSendEdit();
    }, true);
    slot('prompt').addEventListener('keydown', (e) => {
      if (!nlEditorMode() || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      nlSendEdit();
    }, true);
    root.querySelector('[data-nl-plan]').addEventListener('click', () => {
      _nlPlanMode = nlEditorMode();
      nlHeroState(root);
      renderChat();
      document.getElementById('anim-prompt')?.focus();
    });
    slot('edits').addEventListener('click', (e) => {
      const b = e.target.closest('[data-edit-idea]');
      const ta = document.getElementById('anim-prompt');
      if (!b || !ta) return;
      ta.value = b.dataset.editIdea;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      nlHeroState(root);
    });

    const ideas = slot('ideas');
    ideas.innerHTML = `<span class="nl-ahero__try">Try</span>${NL_IDEAS.map((t, i) => `<button type="button" class="nl-aidea" data-idea="${i}">${esc(t)}</button>`).join('')}`;
    ideas.addEventListener('click', (e) => {
      const b = e.target.closest('[data-idea]');
      const ta = document.getElementById('anim-prompt');
      if (!b || !ta) return;
      const toPrompt = document.querySelector('#anim-entry-mode [data-entry="prompt"]');
      if (toPrompt && !toPrompt.classList.contains('active')) toPrompt.click();
      ta.value = NL_IDEAS[Number(b.dataset.idea)] || '';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      nlHeroState(root);
    });
    document.getElementById('anim-prompt')?.addEventListener('input', () => nlHeroState(root));

    const saved = root.querySelector('[data-nl-saved]');
    saved.addEventListener('click', () => {
      _nlSavedOpen = !_nlSavedOpen;
      slot('saved').hidden = !_nlSavedOpen;
      saved.setAttribute('aria-expanded', _nlSavedOpen ? 'true' : 'false');
    });

    // The project pill in the header goes back to the project list (the Home button's job).
    const head = document.querySelector('.anim-canvas-header');
    if (head && !head.querySelector('.nl-aproj')) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'nl-aproj';
      pill.title = 'All projects';
      pill.hidden = true;
      pill.addEventListener('click', () => document.getElementById('anim-home')?.click());
      const tools = document.getElementById('anim-new')?.parentElement;
      if (tools) tools.insertBefore(pill, tools.firstChild);
    }
  }

  function nlAnimLayout(fromCanvas) {
    if (!nlOn()) return;
    const root = nlAnimRoot();
    if (!root) return;
    const slot = (n) => root.querySelector(`[data-slot="${n}"]`);
    const p = _project;
    root.classList.toggle('is-home', !p);
    const pid = p ? String(p.id || '') : '';
    if (pid !== _nlLastPid) {
      _nlLastPid = pid;
      for (let el = root.parentElement; el; el = el.parentElement) if (el.scrollTop) el.scrollTop = 0;
      if (window.scrollY) window.scrollTo(0, 0);
    }
    const body = document.getElementById('anim-canvas-body');

    if (fromCanvas && body) {
      ['err', 'char', 'arc', 'shots', 'shotbar', 'saved', 'lanes', 'final', 'home'].forEach((n) => { const s = slot(n); if (s) s.textContent = ''; });
      const kids = [...body.children];
      if (!p) {
        kids.forEach((k) => slot('home').appendChild(k));
      } else {
        kids.forEach((k) => {
          const tag = k.getAttribute('data-nl');
          if (k.classList.contains('anim-canvas-top')) { k.remove(); return; }
          if (tag === 'char') { nlChar(k, slot('char')); return; }
          if (tag === 'arc') { nlArc(k, slot('arc')); return; }
          if (tag === 'shots') { nlShots(k, root); return; }
          if (tag === 'final') { nlFinal(k, root); return; }
          slot('err').appendChild(k);
        });
      }
      body.textContent = '';
    }

    if (p) {
      if (!slot('final').childElementCount) nlFinal(null, root);
      if (!slot('lanes').childElementCount) nlLanes(null, root);
    }
    nlTimeline(slot('tl'));
    // An open project shows the length it was planned at.
    const lenSel = document.getElementById('anim-length');
    if (lenSel && p && [15, 30, 45].includes(Number(p.length_seconds))) lenSel.value = String(p.length_seconds);
    nlHeaderPill();
    nlTokens(slot('tokens'));
    nlBriefSummary(root);
    nlHeroState(root);
    nlLock(slot('lock'));
    const savedBtn = root.querySelector('[data-nl-saved]');
    if (savedBtn) {
      savedBtn.hidden = !slot('saved').childElementCount;
      slot('saved').hidden = savedBtn.hidden || !_nlSavedOpen;
    }
    if (window.SEStory) {
      try { window.SEStory.onLayout(); } catch (e) { console.warn('[animate] story builder', e); }
    }
  }

  /** What Build a Story (story-builder.js) needs from the studio. */
  function nlStoryHost() {
    return {
      fetch: animFetch,
      toast,
      esc,
      mediaSrc,
      title: projectTitle,
      project: () => _project,
      recent: () => _recent,
      kits: () => _kits,
      goHome,
      goStoryboard: () => { if (typeof window.switchNav === 'function') window.switchNav('storyboard'); },
      openProject: (id) => openProject(id),
      showProject: (p) => {
        _project = p;
        _refs = (p.references || []).map((r) => ({ url: r.url, title: r.title || 'Ref', role: r.role || 'character' }));
        rememberOpenProject(p.id);
        renderCanvas();
        renderChat();
        renderRefs();
        if (['developing', 'generating', 'assembling'].includes(p.status) || projectHasBusyScenes(p) || projectChecking(p)) startPoll();
        refreshRecent({ silent: true });
      },
      uploadImage: async (file) => {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`${apiBase()}/api/studio/upload-image`, { method: 'POST', headers: authHeadersMultipart(), body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) throw apiError(data, res, 'Upload failed');
        if (data.durable === false || /\/api\/media\//i.test(String(data.url))) throw new Error("Upload didn't finish saving. Try again in a moment.");
        return data.url;
      },
    };
  }

  /** One line under "Cast and settings": photos, look and story, so it can stay folded. */
  function nlBriefSummary(root) {
    const sum = root.querySelector('[data-slot="brief-sum"]');
    const count = root.querySelector('[data-slot="ref-count"]');
    const refs = Array.isArray(_refs) ? _refs : [];
    const roleName = { character: 'character', item: 'product', setting: 'group', scene: 'place', style: 'style' };
    const roles = [...new Set(refs.map((r) => roleName[r.role] || 'photo'))];
    const look = document.getElementById('anim-look');
    const lookLabel = look ? String(look.options[look.selectedIndex]?.textContent || '').replace(/ \/ animated$/i, '') : '';
    const story = document.getElementById('anim-story-type');
    const storyLabel = story && story.value ? String(story.options[story.selectedIndex]?.textContent || '') : '';
    const bits = [
      refs.length ? `${refs.length} photo${refs.length === 1 ? '' : 's'} (${roles.join(', ')})` : 'No reference photos',
      lookLabel,
      storyLabel ? `Story: ${storyLabel}` : '',
    ].filter(Boolean);
    if (sum) sum.textContent = bits.join(' · ');
    if (count) { count.hidden = !refs.length; count.textContent = String(refs.length); }
  }

  /** A finished reel the client can talk to: final built, a shot ready, no plan waiting. */
  function nlEditorMode() {
    const p = _project;
    if (!p || _nlPlanMode || !p.final_url) return false;
    if (['brief_ready', 'briefing', 'character_review'].includes(String(p.status || ''))) return false;
    return nlScenes().some((x) => x.video_url && x.status === 'ready');
  }
  function nlEditWorking() {
    const p = _project;
    if (!p) return false;
    return !!p.editing_started_at || p.status === 'assembling' || nlScenes().some((x) => x.status === 'generating' || x.status === 'pending');
  }

  /** The conversation, new look: your messages, the editor's replies with what it changed,
   *  each shot plan folded into one row, and system events as quiet status lines. */
  function nlThreadHtml(chat, brief) {
    const list = Array.isArray(chat) ? chat : [];
    const lastPlan = (() => { for (let i = list.length - 1; i >= 0; i--) if (list[i].role === 'agent' && list[i].kind !== 'edit') return i; return -1; })();
    const lastEdit = (() => { for (let i = list.length - 1; i >= 0; i--) if (list[i].role === 'agent' && list[i].kind === 'edit') return i; return -1; })();
    const working = nlEditWorking();
    const seenIdea = { v: false };
    let planShown = false;
    const rows = list.map((m, i) => {
      const role = String(m.role || '').toLowerCase();
      const text = String(m.text || '').trim();
      if (!text && !(m.changes || []).length) return '';
      if (role === 'user') {
        const label = m.kind !== 'edit' && !seenIdea.v ? '<div class="nl-tmsg__l">Your idea</div>' : '';
        if (m.kind !== 'edit') seenIdea.v = true;
        return `<div class="nl-tmsg nl-tmsg--me">${label}<div class="nl-tmsg__b">${esc(text)}</div></div>`;
      }
      if (role === 'agent' && m.kind !== 'edit' && i === lastPlan && nlPlanEditable()) {
        planShown = true;
        return nlPlanCardHtml(brief, { art: text });
      }
      if (role === 'agent' && m.kind !== 'edit') {
        const shots = i === lastPlan && Array.isArray(brief?.shots) ? brief.shots : [];
        const shotRows = shots.map((x, k) => `<li><span>${k + 1}</span><div>${esc(customerShotLine(x) || x.title || `Shot ${k + 1}`)}${x.vo_line ? `<q class="nl-tplan__vo">${esc(x.vo_line)}</q>` : ''}</div></li>`).join('');
        return `<details class="nl-tplan">
            <summary><span class="nl-tplan__i">${nlSvg(NL_I.film, 14)}</span><span class="nl-tplan__t">Shot plan</span>${shots.length ? `<span class="nl-tplan__m">${shots.length} shot${shots.length === 1 ? '' : 's'}</span>` : ''}<span class="nl-grow"></span><span class="nl-tplan__more">Show</span>${nlSvg(NL_I.chev, 12, 2)}</summary>
            <div class="nl-tplan__body">${shotRows ? `<ol class="nl-tplan__shots">${shotRows}</ol>` : ''}<div class="nl-tplan__h">Art direction</div><p>${esc(text)}</p></div>
          </details>`;
      }
      if (role === 'agent') {
        const live = i === lastEdit && working;
        const chips = (m.changes || []).map((c) => `<span class="nl-tchip${live ? ' is-live' : ''}">${live ? '<i class="nl-tspin" aria-hidden="true"></i>' : nlSvg(NL_I.check, 11, 2.4)}${esc(c)}</span>`).join('');
        return `<div class="nl-tmsg nl-tmsg--ai"><span class="nl-tav">${nlSvg(NL_I.spark, 12)}</span><div class="nl-tmsg__c"><div class="nl-tmsg__b">${esc(text)}</div>${chips ? `<div class="nl-tchips">${chips}</div>` : ''}${live ? '<div class="nl-tmsg__s">Working on it. The final rebuilds by itself.</div>' : ''}</div></div>`;
      }
      const kind = m.kind === 'final' || /^Final reel (ready|updated)/i.test(text) ? 'ok'
        : m.kind === 'vo_audit' ? 'vo'
          : m.kind === 'shot_check' ? (/redone and checked/i.test(text) ? 'ok' : 'warn')
            : 'info';
      const icon = kind === 'ok' ? NL_I.check : kind === 'vo' ? NL_I.mic : kind === 'warn' ? NL_I.warn : NL_I.info;
      const shown = text.replace(/^Final reel updated from (\d+) shots?[^.]*\./i, 'Final reel updated from $1 shots.');
      return `<div class="nl-tsys nl-tsys--${kind}">${nlSvg(icon, 12, 2)}<span>${esc(shown)}</span></div>`;
    }).filter(Boolean);
    // A plan waiting for Accept is always shown, even when the thread has no plan message.
    if (!planShown && nlPlanEditable()) rows.push(nlPlanCardHtml(brief || {}));
    if (_nlEditPending) rows.push('<div class="nl-tmsg nl-tmsg--ai is-typing"><span class="nl-tav">' + nlSvg(NL_I.spark, 12) + '</span><div class="nl-tmsg__c"><div class="nl-tmsg__b"><i></i><i></i><i></i></div></div></div>');
    return rows.join('');
  }

  /** Change ideas that fit this reel, shown until the first edit. */
  function nlEditIdeas() {
    const p = _project || {};
    const a = (p.pipeline && p.pipeline.assemble) || {};
    const out = [];
    if (nlScenes().length) out.push('Redo shot 1 with a warmer, closer framing');
    if (a.vo !== false && p.vo_script) out.push('Make the voiceover shorter and warmer');
    if (a.music !== false) out.push('Swap in more upbeat music');
    if (a.outro !== false && p.outro_url) out.push('Leave off the end card');
    else if (a.captions !== false) out.push('Turn the captions off');
    return out.slice(0, 4);
  }

  async function nlSendEdit() {
    const ta = document.getElementById('anim-prompt');
    const message = String(ta?.value || '').trim();
    if (!message || !_project?.id || _nlEditPending) return;
    if (nlEditWorking()) { toast('Still working on the last change. Send this when it finishes.', 'info'); return; }
    _nlEditPending = true;
    const before = (_project.chat || []).slice();
    _project.chat = before.concat([{ role: 'user', kind: 'edit', text: message, ts: new Date().toISOString() }]);
    ta.value = '';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    renderChat();
    const root = nlAnimRoot();
    if (root) nlHeroState(root);
    try {
      const data = await animFetch(`/api/animation/projects/${_project.id}/edit`, { method: 'POST', body: JSON.stringify({ message }) });
      _nlEditPending = false;
      if (data.project) _project = data.project;
      _canvasFp = projectUiFingerprint(_project);
      renderCanvas();
      renderChat();
      if (nlEditWorking()) startPoll();
    } catch (e) {
      _nlEditPending = false;
      _project.chat = before;
      if (ta && !ta.value) ta.value = message;
      renderChat();
      toast(e.message || 'The editor could not take that change', 'error', e.request_id);
    }
    if (root) nlHeroState(root);
  }

  // ── New look: the shot plan, editable before it renders ──
  // Add a shot written in the same style, remove or reorder, change one by hand, or ask
  // the AI to change it ("she holds the leaflet in her right hand"). Products tagged in
  // Cast and settings can be put in a shot so its first frame keeps them exact.
  const _nlPlan = { open: null, busy: null, adding: false, addText: '', undo: null, note: null, collapsed: false, drafts: Object.create(null) };
  const NL_PLAN_MAX = 6;
  const NL_LEN_LS = 'se_anim_length';
  function nlPlanReset() {
    _nlPlan.open = null; _nlPlan.busy = null; _nlPlan.adding = false; _nlPlan.addText = ''; _nlPlan.undo = null; _nlPlan.note = null; _nlPlan.collapsed = false;
    Object.keys(_nlPlan.drafts).forEach((k) => { delete _nlPlan.drafts[k]; });
  }
  function nlPlanItems() {
    return ((_project && _project.references) || []).filter((r) => r && r.role === 'item' && /^https:\/\//i.test(String(r.url || '')))
      .slice(0, 6).map((r, i) => ({ url: r.url, name: String(r.title || '').trim() || `Product ${i + 1}` }));
  }
  function nlPlanSnapshot(shots) {
    return (shots || []).map((x) => ({ id: x.id, action: customerShotLine(x), vo_line: x.vo_line || '', duration_target: x.duration_target, seconds_manual: !!x.seconds_manual, items: (x.items || []).slice() }));
  }
  function nlPlanEditable() {
    return !!(_project && _project.status === 'brief_ready' && _project.agent_brief && !_briefing);
  }
  function nlPlanCardHtml(brief, { art = '' } = {}) {
    const shots = brief.shots || [];
    const items = nlPlanItems();
    const total = shots.reduce((n, x) => n + (Number(x.duration_target) || 5), 0);
    const target = Number(_project && _project.length_seconds) || 0;
    const under = target && total < target - 4 ? target - total : 0;
    const busy = (id) => _nlPlan.busy === id;
    const rows = shots.map((x, i) => {
      const id = String(x.id);
      const open = _nlPlan.open && _nlPlan.open.id === id ? _nlPlan.open.mode : '';
      const d = _nlPlan.drafts[id] || {};
      const shotItems = items.filter((it) => (x.items || []).includes(it.url));
      const note = _nlPlan.note && _nlPlan.note.id === id ? _nlPlan.note : null;
      const editor = open === 'ai' ? `<div class="nl-plan__ed">
          <label class="nl-slabel" for="nl-plan-ask-${esc(id)}">What should change in shot ${i + 1}?</label>
          <div class="nl-plan__ask">
            <input id="nl-plan-ask-${esc(id)}" class="nl-sinput" data-plan-ask="${esc(id)}" maxlength="600" value="${esc(d.ask || '')}" placeholder="${items.length ? `She holds the ${esc(items[0].name)} in her right hand` : 'Make it a close up of her face, smiling'}" ${busy(id) ? 'disabled' : ''}>
            <button type="button" class="nl-sbtn nl-sbtn--primary" data-plan-ask-go="${esc(id)}" ${busy(id) ? 'disabled' : ''}>${busy(id) ? '<i class="nl-sspin"></i>Changing' : `${nlSvg(NL_I.spark, 13)}Change`}</button>
            <button type="button" class="nl-sbtn" data-plan-close ${busy(id) ? 'disabled' : ''}>Cancel</button>
          </div>
          <p class="nl-snote">The shot is rewritten in the same style. The spoken line stays unless you ask to change it.${items.length ? '' : ' To show your real product, add its photo in Cast and settings and tag it Item.'}</p>
        </div>` : open === 'edit' ? `<div class="nl-plan__ed">
          <label class="nl-slabel" for="nl-plan-what-${esc(id)}">What we see</label>
          <textarea id="nl-plan-what-${esc(id)}" class="nl-sinput nl-sarea" rows="4" maxlength="1500" data-plan-what="${esc(id)}">${esc(d.action != null ? d.action : customerShotLine(x))}</textarea>
          <label class="nl-slabel" for="nl-plan-vo-${esc(id)}">What is said</label>
          <input id="nl-plan-vo-${esc(id)}" class="nl-sinput" maxlength="400" data-plan-vo="${esc(id)}" value="${esc(d.vo_line != null ? d.vo_line : x.vo_line || '')}" placeholder="No voiceover in this shot">
          <div class="nl-plan__edrow">
            <div><div class="nl-slabel">Length</div>
              <div class="nl-sstep" role="group" aria-label="Shot length">
                <button type="button" data-plan-sec="-1" aria-label="Shorter">−</button>
                <output>${esc(String(d.duration_target || x.duration_target || 5))}s</output>
                <button type="button" data-plan-sec="1" aria-label="Longer">+</button>
              </div>
              ${(d.seconds_manual != null ? d.seconds_manual : x.seconds_manual) ? '<button type="button" class="nl-slink" data-plan-sec-auto>Fit to the line</button>' : ''}
            </div>
            ${items.length ? `<div><div class="nl-slabel">Products in this shot</div><div class="nl-plan__chips">${items.map((it) => {
              const on = (d.items || x.items || []).includes(it.url);
              return `<button type="button" class="nl-plan__chip" data-plan-item="${esc(it.url)}" aria-pressed="${on}">${on ? nlSvg(NL_I.check, 11, 2.4) : ''}${esc(it.name)}</button>`;
            }).join('')}</div></div>` : ''}
          </div>
          <div class="nl-srow">
            <button type="button" class="nl-sbtn nl-sbtn--primary" data-plan-save="${esc(id)}" ${busy(id) ? 'disabled' : ''}>${busy(id) ? '<i class="nl-sspin"></i>Saving' : 'Save'}</button>
            <button type="button" class="nl-sbtn" data-plan-close>Cancel</button>
          </div>
        </div>` : '';
      return `<li class="nl-plan__row${open ? ' is-open' : ''}${note ? ' is-new' : ''}" data-plan-row="${esc(id)}">
        <div class="nl-plan__main">
          <span class="nl-plan__n">${i + 1}</span>
          <div class="nl-plan__body">
            <div class="nl-plan__meta"><span class="nl-smono">${esc(String(x.duration_target || 5))}s</span>${shotItems.map((it) => `<span class="nl-plan__tag">${esc(it.name)}</span>`).join('')}</div>
            <p class="nl-plan__what">${esc(customerShotLine(x) || x.title || `Shot ${i + 1}`)}</p>
            ${x.vo_line ? `<q class="nl-plan__vo">${esc(x.vo_line)}</q>` : '<span class="nl-plan__novo">No voiceover in this shot</span>'}
            ${note ? `<div class="nl-plan__note">${nlSvg(NL_I.check, 12, 2.4)}<span>${esc(note.text)}</span></div>` : ''}
          </div>
          <div class="nl-plan__acts" role="group" aria-label="Shot ${i + 1}">
            <button type="button" class="nl-plan__btn" data-plan-ai="${esc(id)}" aria-expanded="${open === 'ai'}">${nlSvg(NL_I.spark, 12)}Change</button>
            <button type="button" class="nl-plan__btn" data-plan-edit="${esc(id)}" aria-expanded="${open === 'edit'}">Edit</button>
            <button type="button" class="nl-plan__ico" data-plan-move="-1" data-id="${esc(id)}" ${i === 0 ? 'disabled' : ''} aria-label="Move shot ${i + 1} up">${nlSvg('M12 19V5 M6 11l6-6 6 6', 13)}</button>
            <button type="button" class="nl-plan__ico" data-plan-move="1" data-id="${esc(id)}" ${i === shots.length - 1 ? 'disabled' : ''} aria-label="Move shot ${i + 1} down">${nlSvg('M12 5v14 M6 13l6 6 6-6', 13)}</button>
            <button type="button" class="nl-plan__ico" data-plan-rm="${esc(id)}" ${shots.length <= 1 ? 'disabled' : ''} aria-label="Remove shot ${i + 1}">${nlSvg(NL_I.x, 13)}</button>
          </div>
        </div>
        ${editor}
      </li>`;
    }).join('');
    const full = shots.length >= NL_PLAN_MAX;
    const adding = _nlPlan.adding ? `<div class="nl-plan__add">
        <label class="nl-slabel" for="nl-plan-add">What should the new shot show? <em>optional</em></label>
        <div class="nl-plan__ask">
          <input id="nl-plan-add" class="nl-sinput" data-plan-add-text maxlength="600" value="${esc(_nlPlan.addText)}" placeholder="Leave empty and the AI adds what the story is missing" ${_nlPlan.busy === 'add' ? 'disabled' : ''}>
          <button type="button" class="nl-sbtn nl-sbtn--primary" data-plan-add-go ${_nlPlan.busy === 'add' ? 'disabled' : ''}>${_nlPlan.busy === 'add' ? '<i class="nl-sspin"></i>Writing' : `${nlSvg(NL_I.spark, 13)}Add shot`}</button>
          <button type="button" class="nl-sbtn" data-plan-add-cancel ${_nlPlan.busy === 'add' ? 'disabled' : ''}>Cancel</button>
        </div>
      </div>` : '';
    const count = `${shots.length} shot${shots.length === 1 ? '' : 's'}`;
    return `<details class="nl-tplan nl-tplan--edit" data-nl-plan-details ${_nlPlan.collapsed ? '' : 'open'}>
      <summary>
        <span class="nl-tplan__i">${nlSvg(NL_I.film, 14)}</span><span class="nl-tplan__t">Shot plan</span>
        <span class="nl-tplan__m">${count} · ${nlClock(total)}</span>
        ${under ? `<span class="nl-schip nl-schip--warn"><i></i>${under}s under your ${target}s</span>` : ''}
        <span class="nl-grow"></span>
        <span class="nl-tplan__wait">Nothing renders until you accept</span>
        <button type="button" class="nl-sbtn nl-sbtn--primary nl-sbtn--sm nl-tplan__go" data-plan-accept>Accept &amp; generate</button>
        ${nlSvg(NL_I.chev, 12, 2)}
      </summary>
      <div class="nl-plan" aria-label="Shot plan">
        ${_nlPlan.undo ? `<div class="nl-plan__undo">${esc(_nlPlan.undo.label)}<button type="button" class="nl-slink" data-plan-undo>Undo</button></div>` : ''}
        <ol class="nl-plan__list">${rows}</ol>
        ${adding}
        <div class="nl-plan__f">
          <button type="button" class="nl-sbtn nl-sbtn--primary" id="anim-accept">Accept &amp; generate · ${count}</button>
          <button type="button" class="nl-sbtn" data-plan-add ${full || _nlPlan.adding ? 'disabled' : ''} ${full ? `title="A reel holds up to ${NL_PLAN_MAX} shots"` : ''}>${nlSvg('M12 5v14 M5 12h14', 13)}Add shot</button>
          <span class="nl-grow"></span>
          <button type="button" class="nl-sbtn" id="anim-rebrief">Try again</button>
        </div>
        ${art ? `<details class="nl-plan__art"><summary>Art direction</summary><p>${esc(art)}</p></details>` : ''}
      </div>
    </details>`;
  }
  function nlPlanBind(el) {
    if (el.dataset.planBound) return;
    el.dataset.planBound = '1';
    el.addEventListener('click', nlPlanClick);
    el.addEventListener('input', nlPlanInput);
    el.addEventListener('toggle', (e) => {
      if (e.target && e.target.matches && e.target.matches('[data-nl-plan-details]')) _nlPlan.collapsed = !e.target.open;
    }, true);
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      const ask = e.target.closest('[data-plan-ask]');
      if (ask) { e.preventDefault(); nlPlanAsk(ask.dataset.planAsk); return; }
      if (e.target.closest('[data-plan-add-text]')) { e.preventDefault(); nlPlanAdd(); }
    });
  }
  function nlPlanRepaint(focusSel) {
    renderChat();
    if (focusSel) setTimeout(() => { const f = document.querySelector(focusSel); if (f) { f.focus(); try { f.setSelectionRange(f.value.length, f.value.length); } catch (_) {} } }, 0);
  }
  async function nlPlanSend(path, method, body, { busy = null, undo = null } = {}) {
    if (!_project || !_project.id) return null;
    const before = nlPlanSnapshot(_project.agent_brief && _project.agent_brief.shots);
    _nlPlan.busy = busy;
    renderChat();
    try {
      const data = await animFetch(`/api/animation/projects/${_project.id}/${path}`, { method, body: JSON.stringify(body || {}) });
      if (data.project) _project = data.project;
      _nlPlan.undo = undo ? { label: undo, shots: before } : null;
      return data;
    } catch (e) {
      toast(e.message || 'Could not change the plan', 'error', e.request_id);
      return null;
    } finally {
      _nlPlan.busy = null;
      renderChat();
    }
  }
  async function nlPlanPut(shots, undoLabel) {
    return nlPlanSend('plan', 'PUT', { shots }, { busy: 'put', undo: undoLabel });
  }
  async function nlPlanAsk(id) {
    const d = _nlPlan.drafts[id] || {};
    const instruction = String(d.ask || '').trim();
    if (!instruction) { toast('Say what should change', 'error'); return; }
    const n = (_project.agent_brief.shots || []).findIndex((x) => String(x.id) === id) + 1;
    const data = await nlPlanSend('plan/rewrite', 'POST', { shot_id: id, instruction }, { busy: id, undo: `Shot ${n} changed.` });
    if (!data) return;
    delete _nlPlan.drafts[id];
    _nlPlan.open = null;
    _nlPlan.note = { id, text: data.note || 'Shot changed' };
    renderChat();
  }
  async function nlPlanAdd() {
    const data = await nlPlanSend('plan/add', 'POST', { instruction: String(_nlPlan.addText || '').trim() }, { busy: 'add', undo: 'Shot added.' });
    if (!data) return;
    _nlPlan.adding = false;
    _nlPlan.addText = '';
    _nlPlan.note = { id: String(data.shot_id || ''), text: `Added as shot ${data.position || ''}. ${data.note || ''}`.trim() };
    if (_nlPlan.undo) _nlPlan.undo.label = `Shot ${data.position || ''} added.`;
    renderChat();
  }
  function nlPlanClick(e) {
    const t = e.target;
    const q = (sel) => t.closest(sel);
    if (q('[data-plan-accept], #anim-accept')) { e.preventDefault(); if (nlPlanEditable()) acceptBrief(); return; }
    if (q('#anim-rebrief')) { e.preventDefault(); if (nlPlanEditable()) rebriefProject(); return; }
    if (!q('.nl-tplan--edit')) return;
    const shots = nlPlanSnapshot(_project && _project.agent_brief && _project.agent_brief.shots);
    let b;
    if ((b = q('[data-plan-ai]'))) {
      const id = b.dataset.planAi;
      _nlPlan.open = _nlPlan.open && _nlPlan.open.id === id && _nlPlan.open.mode === 'ai' ? null : { id, mode: 'ai' };
      nlPlanRepaint(`[data-plan-ask="${CSS.escape(id)}"]`);
      return;
    }
    if ((b = q('[data-plan-edit]'))) {
      const id = b.dataset.planEdit;
      const shot = shots.find((x) => x.id === id);
      if (_nlPlan.open && _nlPlan.open.id === id && _nlPlan.open.mode === 'edit') { _nlPlan.open = null; delete _nlPlan.drafts[id]; }
      else { _nlPlan.open = { id, mode: 'edit' }; _nlPlan.drafts[id] = Object.assign({}, shot); }
      nlPlanRepaint(`[data-plan-what="${CSS.escape(id)}"]`);
      return;
    }
    if (q('[data-plan-close]')) { if (_nlPlan.open) delete _nlPlan.drafts[_nlPlan.open.id]; _nlPlan.open = null; renderChat(); return; }
    if ((b = q('[data-plan-ask-go]'))) { nlPlanAsk(b.dataset.planAskGo); return; }
    if ((b = q('[data-plan-sec]')) && _nlPlan.open) {
      const d = _nlPlan.drafts[_nlPlan.open.id];
      d.duration_target = Math.max(4, Math.min(8, (Number(d.duration_target) || 5) + Number(b.dataset.planSec)));
      d.seconds_manual = true;
      renderChat();
      return;
    }
    if (q('[data-plan-sec-auto]') && _nlPlan.open) { _nlPlan.drafts[_nlPlan.open.id].seconds_manual = false; renderChat(); return; }
    if ((b = q('[data-plan-item]')) && _nlPlan.open) {
      const d = _nlPlan.drafts[_nlPlan.open.id];
      const list = (d.items || []).slice();
      const at = list.indexOf(b.dataset.planItem);
      if (at >= 0) list.splice(at, 1); else list.push(b.dataset.planItem);
      d.items = list.slice(0, 3);
      renderChat();
      return;
    }
    if ((b = q('[data-plan-save]'))) {
      const id = b.dataset.planSave;
      const d = _nlPlan.drafts[id];
      if (!d || !String(d.action || '').trim()) { toast('Say what we see in this shot', 'error'); return; }
      const n = shots.findIndex((x) => x.id === id) + 1;
      const next = shots.map((x) => (x.id === id ? Object.assign({}, x, d) : { id: x.id }));
      nlPlanPut(next, `Shot ${n} edited.`).then((data) => {
        if (!data) return;
        delete _nlPlan.drafts[id];
        _nlPlan.open = null;
        _nlPlan.note = null;
        renderChat();
      });
      return;
    }
    if ((b = q('[data-plan-move]'))) {
      const id = b.dataset.id;
      const i = shots.findIndex((x) => x.id === id);
      const j = i + Number(b.dataset.planMove);
      if (i < 0 || j < 0 || j >= shots.length) return;
      const order = shots.map((x) => ({ id: x.id }));
      const [m] = order.splice(i, 1);
      order.splice(j, 0, m);
      nlPlanPut(order, `Shot ${i + 1} moved.`);
      return;
    }
    if ((b = q('[data-plan-rm]'))) {
      const id = b.dataset.planRm;
      const n = shots.findIndex((x) => x.id === id) + 1;
      if (_nlPlan.open && _nlPlan.open.id === id) _nlPlan.open = null;
      nlPlanPut(shots.filter((x) => x.id !== id).map((x) => ({ id: x.id })), `Shot ${n} removed.`);
      return;
    }
    if (q('[data-plan-undo]') && _nlPlan.undo) {
      const prev = _nlPlan.undo.shots;
      _nlPlan.note = null;
      nlPlanPut(prev, null);
      return;
    }
    if (q('[data-plan-add]')) { _nlPlan.adding = true; nlPlanRepaint('[data-plan-add-text]'); return; }
    if (q('[data-plan-add-cancel]')) { _nlPlan.adding = false; _nlPlan.addText = ''; renderChat(); return; }
    if (q('[data-plan-add-go]')) { nlPlanAdd(); }
  }
  function nlPlanInput(e) {
    const t = e.target;
    if (t.matches('[data-plan-ask]')) { (_nlPlan.drafts[t.dataset.planAsk] = _nlPlan.drafts[t.dataset.planAsk] || {}).ask = t.value; return; }
    if (t.matches('[data-plan-what]')) { _nlPlan.drafts[t.dataset.planWhat].action = t.value; return; }
    if (t.matches('[data-plan-vo]')) { _nlPlan.drafts[t.dataset.planVo].vo_line = t.value; return; }
    if (t.matches('[data-plan-add-text]')) { _nlPlan.addText = t.value; }
  }

  const NL_IDEAS = [
    'One tip our customers always ask about',
    'Behind the scenes as the team gets ready',
    'A customer problem, our fix, the happy result',
  ];

  function nlHeroState(root) {
    const t = root.querySelector('#nl-ahero-t');
    const sub = root.querySelector('[data-slot="hero-sub"]');
    const ideas = root.querySelector('[data-slot="ideas"]');
    if (!t) return;
    const hasShots = nlScenes().length > 0;
    const editing = nlEditorMode();
    const hero = root.querySelector('.nl-ahero');
    hero?.classList.toggle('nl-ahero--chat', editing);
    const ta0 = document.getElementById('anim-prompt');
    const send0 = document.getElementById('anim-send');
    const edits = root.querySelector('[data-slot="edits"]');
    const back = root.querySelector('[data-nl-plan]');
    if (back) {
      back.hidden = !(editing || (_nlPlanMode && _project?.final_url));
      back.textContent = editing ? 'New shot plan' : 'Back to editing';
    }
    if (editing) {
      const lenHide = root.querySelector('[data-slot="length"]');
      if (lenHide) lenHide.hidden = true;
      t.textContent = 'Edit your reel';
      if (sub) sub.textContent = 'Ask for any change to a shot, the voiceover, music, captions or the end card. The final rebuilds by itself.';
      hero?.classList.remove('nl-ahero--edit');
      root.classList.toggle('nl-anim--shots', hasShots);
      if (ta0) ta0.placeholder = 'Ask for a change, like "make shot 2 a close up" or "warmer music"';
      if (send0 && !send0.disabled) send0.textContent = 'Send';
      if (send0) send0.disabled = _nlEditPending;
      if (ideas) ideas.hidden = true;
      if (edits) {
        const hasEdit = (_project?.chat || []).some((m) => m.kind === 'edit');
        const list = nlEditIdeas();
        edits.hidden = hasEdit || _nlEditPending || !list.length || !!(ta0 && ta0.value.trim());
        if (!edits.hidden && edits.dataset.sig !== list.join('|')) {
          edits.dataset.sig = list.join('|');
          edits.innerHTML = list.map((x) => `<button type="button" class="nl-aidea" data-edit-idea="${esc(x)}">${esc(x)}</button>`).join('');
        }
      }
      return;
    }
    if (edits) edits.hidden = true;
    const lenSlot = root.querySelector('[data-slot="length"]');
    if (lenSlot) lenSlot.hidden = (document.querySelector('#anim-entry-mode [data-entry].active')?.dataset.entry || readAnimEntry()) !== 'prompt';
    if (send0 && (send0.textContent === 'Send')) send0.textContent = 'Write shots';
    if (ta0 && /^Ask for a change/.test(ta0.placeholder)) {
      ta0.placeholder = readAnimEntry() === 'prompt' ? PROMPT_PLACEHOLDER : VO_PLACEHOLDER;
    }
    t.textContent = hasShots ? 'Rework the idea' : 'Describe your video';
    if (sub) sub.textContent = hasShots
      ? 'Write a new idea or script for a fresh shot plan. To tweak one shot, select it below.'
      : ((document.querySelector('#anim-entry-mode [data-entry].active')?.dataset.entry || readAnimEntry()) === 'vo'
        ? 'Paste your script. Its lines set how many shots there are, how long each runs and what each one shows.'
        : 'One idea is enough. The voiceover is written first, then a shot for each line. Nothing renders until you accept.');
    root.querySelector('.nl-ahero')?.classList.toggle('nl-ahero--edit', hasShots);
    root.classList.toggle('nl-anim--shots', hasShots);
    const ta = document.getElementById('anim-prompt');
    const pending = !!document.querySelector('#anim-brief-actions .anim-brief-card, #anim-brief-actions button');
    if (ideas) ideas.hidden = hasShots || pending || !!(ta && ta.value.trim());
  }

  function nlHeaderPill() {
    const pill = document.querySelector('.anim-canvas-header .nl-aproj');
    if (!pill) return;
    const p = _project;
    pill.hidden = !p;
    if (!p) return;
    const title = p.agent_brief?.title || projectTitle(p) || 'Untitled';
    pill.innerHTML = `<span class="nl-aproj__l">Project</span><span class="nl-aproj__t">${esc(title)}</span>${nlSvg(NL_I.chev, 12, 2)}`;
  }

  function nlTokens(el) {
    if (!el) return;
    const entry = document.querySelector('#anim-entry-mode [data-entry].active')?.dataset.entry || readAnimEntry();
    const look = document.getElementById('anim-look');
    const lookLabel = look ? String(look.options[look.selectedIndex]?.textContent || '').replace(/ \/ animated$/i, '') : '';
    const scenes = nlScenes();
    const secs = scenes.reduce((n, s) => n + nlShotSecs(s), 0);
    const toks = [entry === 'prompt' ? 'From an idea' : 'From voiceover'];
    if (scenes.length) toks.push(`${nlClock(secs)} · ${scenes.length} shot${scenes.length === 1 ? '' : 's'}`);
    if (lookLabel) toks.push(lookLabel);
    el.innerHTML = toks.map((t) => `<span class="nl-atok">${esc(t)}</span>`).join('');
  }

  function nlLock(el) {
    if (!el) return;
    const pack = _project?.character_pack;
    if (!pack?.locked) { el.innerHTML = ''; return; }
    const names = (pack.cast || []).map((c) => c && (c.name || c.character_name)).filter(Boolean);
    const who = names.length ? names.slice(0, 3).join(', ') : 'Your character';
    el.innerHTML = `${nlSvg(NL_I.lock, 12, 2)}${esc(who)} locked across every shot`;
  }

  function nlChar(sec, into) {
    const label = sec.querySelector('.anim-section__label');
    if (label) label.textContent = label.textContent.replace('Character / asset lock', 'Character sheet');
    sec.classList.add('nl-achar');
    into.appendChild(sec);
  }

  function nlArc(sec, into) {
    const label = sec.querySelector('.anim-section__label');
    const d = document.createElement('details');
    d.className = 'nl-aarc';
    d.open = _nlArcOpen;
    d.addEventListener('toggle', () => { _nlArcOpen = d.open; });
    const sum = document.createElement('summary');
    sum.innerHTML = label ? label.innerHTML : 'Story';
    if (label) label.remove();
    d.appendChild(sum);
    d.appendChild(sec);
    into.appendChild(d);
  }

  function nlShots(sec, root) {
    const slot = (n) => root.querySelector(`[data-slot="${n}"]`);
    const grid = slot('shots');
    const bar = slot('shotbar');
    const scenes = nlScenes();
    const byId = new Map(scenes.map((s) => [s.id, s]));
    const savedBox = sec.querySelector('.anim-saved-shots');
    if (savedBox) slot('saved').appendChild(savedBox);
    const tl = sec.querySelector(':scope > .anim-timeline') || sec;
    [...tl.children].forEach((k) => grid.appendChild(k));
    const secs = scenes.reduce((n, s) => n + nlShotSecs(s), 0);
    slot('shots-meta').textContent = scenes.length ? `${scenes.length} shot${scenes.length === 1 ? '' : 's'} · ${secs} s` : '';

    const cards = [...grid.querySelectorAll('.anim-shot[data-scene]')].filter((c) => !c.classList.contains('anim-shot--ghost'));
    if (!cards.some((c) => c.dataset.scene === _nlSelShot)) _nlSelShot = cards[0]?.dataset.scene || null;
    cards.forEach((card, i) => {
      const s = byId.get(card.dataset.scene) || {};
      const st = nlShotState(s);
      const media = card.querySelector('.anim-shot__media');
      if (media) {
        const num = document.createElement('span');
        num.className = 'nl-shot__num';
        num.textContent = `${i + 1} · ${nlShotSecs(s)} s`;
        media.appendChild(num);
        if (st.key === 'gen') {
          const ov = document.createElement('div');
          ov.className = 'nl-shot__gen';
          ov.innerHTML = '<span>Rendering</span><i></i>';
          media.appendChild(ov);
        }
      }
      const takes = sceneTakes(s);
      const foot = document.createElement('div');
      foot.className = 'nl-shot__foot';
      foot.innerHTML = `<span class="nl-shot__st"${st.flag ? ` data-check="${st.flag}"` : ''}><i class="nl-shot__dot nl-shot__dot--${st.flag || st.key}"></i>${esc(st.label)}</span><span class="nl-shot__takes">${takes.length > 1 ? `Take ${Math.max(0, activeTakeIndex(s)) + 1} of ${takes.length}` : (s.video_url ? 'Take 1' : '')}</span>`;
      const what = document.createElement('p');
      what.className = 'nl-shot__what';
      what.textContent = _shotPromptDrafts[s.id] != null ? _shotPromptDrafts[s.id] : customerShotLine(s);
      card.appendChild(foot);
      if (st.note) {
        // What the shot check saw, in plain words.
        const note = document.createElement('p');
        note.className = `nl-shot__chk nl-shot__chk--${st.flag}`;
        note.innerHTML = `${nlSvg(st.flag === 'warn' ? NL_I.warn : NL_I.info, 11, 2)}<span>${esc(st.note)}</span>`;
        card.appendChild(note);
      }
      card.appendChild(what);
      card.setAttribute('aria-label', `Shot ${i + 1}, ${nlShotSecs(s)} seconds, ${st.label}${st.note ? `: ${st.note}` : ''}`);
      card.dataset.nlIndex = String(i + 1);
      card.tabIndex = 0;
      const vid = card.querySelector('video.anim-shot__video');
      if (vid) {
        // Tall cards play on hover; double-click still opens the big player.
        vid.controls = false;
        vid.addEventListener('mouseenter', () => { const r = vid.play(); if (r && r.catch) r.catch(() => {}); });
        vid.addEventListener('mouseleave', () => { try { vid.pause(); } catch (_) {} });
      }
      const select = () => nlSelectShot(card.dataset.scene, root);
      card.addEventListener('click', (e) => {
        if (e.target.closest('button, select, textarea, input, a')) return;
        select();
      });
      card.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); select(); }
      });
    });
    bar.textContent = '';
    if (_nlSelShot) nlSelectShot(_nlSelShot, root);
    sec.remove();
  }

  /** What the shot check looked at and what it found, for the selected shot. */
  function nlCheckDetails(s) {
    const c = shotCheck(s);
    if (!c) return null;
    const el = document.createElement('div');
    el.className = `nl-shotchk nl-shotchk--${c.status}`;
    if (c.status === 'checking') { el.innerHTML = `<i class="nl-shot__dot nl-shot__dot--chk"></i><span>Checking this shot now.</span>`; return el; }
    if (c.status === 'redoing') { el.innerHTML = `<i class="nl-shot__dot nl-shot__dot--gen"></i><span>Redoing this shot after its check.</span>`; return el; }
    if (c.status === 'skipped') { el.innerHTML = `<i class="nl-shot__dot"></i><span>This shot could not be checked.</span>`; return el; }
    // Plain words, no vendor names: what was looked at, not who looked.
    const who = [`Looked at ${c.frames || 'its'} frames for faces, hands, text and the plan`];
    if (c.motion_input) who.push(`watched the movement${c.motion_input === 'frames' ? ' frame by frame' : ''}`);
    const verdict = c.status === 'pass' ? 'Looks right.' : c.status === 'minor' ? 'Small things only.' : 'Needs a look.';
    const kinds = { face: 'Face', limbs: 'Hands and limbs', text: 'Text', morph: 'Morphing', motion: 'Movement', identity: 'Character', product: 'Product', action: 'Plan', other: 'Glitch' };
    const probs = (c.problems || []).slice(0, 4).map((p) => `<li><b>${esc(kinds[p.kind] || 'Note')}</b> ${esc(p.note || '')}</li>`).join('');
    el.innerHTML = `<div class="nl-shotchk__h"><i class="nl-shot__dot nl-shot__dot--${c.status === 'flagged' ? 'warn' : 'pass'}"></i><span><b>${esc(verdict)}</b> ${esc(who.join(', and '))}.</span></div>
      ${probs ? `<ul class="nl-shotchk__list">${probs}</ul>` : ''}
      ${c.motion_error ? '<p class="nl-shotchk__err">The movement check did not run this time.</p>' : ''}`;
    return el;
  }

  function nlSelectShot(id, root) {
    const bar = root.querySelector('[data-slot="shotbar"]');
    const grid = root.querySelector('[data-slot="shots"]');
    if (!bar || !grid) return;
    // Put the previous shot's controls back in its card.
    const prev = bar.querySelector('.anim-shot__meta');
    if (prev) {
      const home = grid.querySelector(`.anim-shot[data-scene="${CSS.escape(prev.dataset.nlScene || '')}"]`);
      if (home) home.insertBefore(prev, home.querySelector('.nl-shot__foot'));
      else prev.remove();
    }
    bar.textContent = '';
    _nlSelShot = id;
    root.querySelectorAll('.nl-atl__b--shot[data-scene]').forEach((b) => b.classList.toggle('is-sel', b.dataset.scene === id));
    const card = grid.querySelector(`.anim-shot[data-scene="${CSS.escape(id)}"]`);
    grid.querySelectorAll('.anim-shot').forEach((c) => c.classList.toggle('is-sel', c === card));
    if (!card) return;
    const meta = card.querySelector('.anim-shot__meta');
    if (!meta) return;
    meta.dataset.nlScene = id;
    const box = document.createElement('div');
    box.className = 'nl-shotbar';
    box.setAttribute('aria-label', `Shot ${card.dataset.nlIndex || ''} settings`);
    const h = document.createElement('div');
    h.className = 'nl-shotbar__h';
    h.textContent = `Shot ${card.dataset.nlIndex || ''} · What happens`;
    box.appendChild(h);
    const chk = nlCheckDetails(nlScenes().find((x) => x.id === id));
    if (chk) box.appendChild(chk);
    box.appendChild(meta);
    bar.appendChild(box);
    const ta = meta.querySelector('.anim-shot__prompt-edit');
    if (ta && !ta.dataset.nlBound) {
      ta.dataset.nlBound = '1';
      ta.addEventListener('input', () => {
        const what = card.querySelector('.nl-shot__what');
        if (what) what.textContent = ta.value;
      });
    }
  }

  function nlLaneDefs(p) {
    const f = assembleFlags();
    const vo = String(p.vo_script || p.agent_brief?.vo_script || '').trim();
    const cap = p.last_burned_caption_style || p.caption_style;
    return [
      { key: 'vo', title: 'Voiceover', icon: NL_I.mic, flag: 'anim-flag-vo', on: f.vo, ready: !!p.vo_script,
        state: p.vo_script ? 'Ready' : 'Not written',
        sum: vo ? `“${vo.length > 110 ? vo.slice(0, 108).trim() + '…' : vo}”` : 'Write the script, or let AI write one from your shots.' },
      { key: 'captions', title: 'Captions', icon: NL_I.cc, flag: 'anim-flag-captions', on: f.captions, ready: !!p.last_burned_caption_style,
        state: p.captions_out_of_date ? 'Check words' : (p.last_burned_caption_style ? 'Styled' : 'Style it'),
        sum: `${p.caption_source === 'client' && p.caption_script ? 'Your own words, timed to the voiceover.' : 'Word by word, timed to the voiceover.'}${cap && cap.preset_id ? ` Style: ${cap.preset_id}.` : ''}` },
      { key: 'music', title: 'Music', icon: NL_I.music, flag: 'anim-flag-music', on: f.music, ready: !!p.music_bed_url,
        state: p.music_bed_url ? 'Ready' : 'Not added',
        sum: p.music_prompt ? String(p.music_prompt) : (p.music_bed_url ? 'Music bed attached. It sits under the voice.' : 'Make a bed from a prompt, or pick or upload one.') },
      { key: 'outro', title: 'End card', icon: NL_I.flag, flag: 'anim-flag-outro', on: f.outro, ready: !!p.outro_url,
        state: p.outro_url ? 'Ready' : 'None',
        sum: p.outro_url ? 'Your end card plays after the last shot.' : 'Pick a saved end card or upload one.' },
    ];
  }

  function nlLanes(panel, root) {
    const into = root.querySelector('[data-slot="lanes"]');
    const p = _project;
    if (!into || !p) return;
    into.textContent = '';
    if (!panel) {
      const note = document.createElement('p');
      note.className = 'nl-alanes__note';
      note.textContent = 'Voiceover, captions, music and the end card open here once a shot is ready.';
      into.appendChild(note);
    }
    nlLaneDefs(p).forEach((d) => {
      const lane = panel && panel.querySelector(`.anim-lane[data-lane="${d.key}"]`);
      const layer = panel && document.getElementById(d.flag)?.closest('.anim-layer');
      const open = !!lane && (_nlLaneOpen.has(d.key) || (d.key === 'captions' && _captionStudioOpen));
      const sec = document.createElement('section');
      sec.className = `nl-lane${d.ready ? ' is-ready' : ''}${open ? ' is-open' : ''}${d.on ? '' : ' is-off'}${lane ? '' : ' is-locked'}`;
      sec.setAttribute('aria-label', d.title);
      sec.innerHTML = `
        <div class="nl-lane__h">
          <span class="nl-lane__ic">${nlSvg(d.icon)}</span>
          <h2 class="nl-lane__t">${esc(d.title)}</h2>
          <span class="nl-lane__state">${esc(d.on ? d.state : 'Off')}</span>
          <span class="nl-lane__sw"></span>
          ${lane ? `<button type="button" class="nl-lane__edit" aria-expanded="${open ? 'true' : 'false'}">${open ? 'Done' : 'Edit'}</button>` : ''}
        </div>
        <p class="nl-lane__sum">${esc(d.sum)}</p>
        <div class="nl-lane__body"></div>`;
      if (layer) {
        layer.title = `Include ${d.title.toLowerCase()} in the final`;
        sec.querySelector('.nl-lane__sw').appendChild(layer);
        const cb = layer.querySelector('input');
        cb?.addEventListener('change', () => {
          sec.classList.toggle('is-off', !cb.checked);
          sec.querySelector('.nl-lane__state').textContent = cb.checked ? d.state : 'Off';
        });
      }
      if (lane) {
        lane.hidden = false;
        sec.querySelector('.nl-lane__body').appendChild(lane);
        const btn = sec.querySelector('.nl-lane__edit');
        btn.addEventListener('click', () => {
          const now = !sec.classList.contains('is-open');
          sec.classList.toggle('is-open', now);
          btn.textContent = now ? 'Done' : 'Edit';
          btn.setAttribute('aria-expanded', now ? 'true' : 'false');
          if (now) _nlLaneOpen.add(d.key); else _nlLaneOpen.delete(d.key);
        });
      }
      into.appendChild(sec);
    });
  }

  function nlFinal(sec, root) {
    const into = root.querySelector('[data-slot="final"]');
    const p = _project;
    if (!into || !p) return;
    into.textContent = '';
    const scenes = nlScenes();
    const secs = scenes.reduce((n, s) => n + nlShotSecs(s), 0);
    const ready = scenes.filter((s) => nlShotState(s).key === 'ok').length;
    const segs = scenes.map((s) => `<i class="nl-afinal__seg nl-afinal__seg--${nlShotState(s).key}"></i>`).join('');
    const head = document.createElement('div');
    head.className = 'nl-afinal__top';
    head.innerHTML = `
      <div class="nl-afinal__h"><h2 id="nl-final-title">Final video</h2><span>9:16${secs ? ` · ${nlClock(secs)}` : ''}</span></div>
      ${scenes.length ? `<div class="nl-afinal__bar" aria-label="${ready} of ${scenes.length} shots ready">${segs}</div><span class="nl-afinal__count">${ready} of ${scenes.length} shot${scenes.length === 1 ? '' : 's'} ready</span>` : ''}`;
    into.appendChild(head);
    const fin = sec && sec.querySelector('.anim-final');
    if (!fin) {
      const ph = document.createElement('p');
      ph.className = 'nl-afinal__ph';
      ph.textContent = 'Your final video appears here once the shots are ready.';
      into.appendChild(ph);
      if (sec) sec.remove();
      return;
    }
    const panel = fin.querySelector('.anim-assemble-panel');
    nlLanes(panel, root);
    if (panel) panel.remove();
    const btns = document.getElementById('anim-rebuild-final')?.parentElement
      || document.getElementById('anim-expand-final')?.parentElement
      || document.getElementById('anim-open-review')?.parentElement;
    if (btns) btns.classList.add('nl-afinal__btns');
    [...fin.children].forEach((k) => into.appendChild(k));
    const past = sec.querySelector('.anim-past-finals');
    if (past) into.appendChild(past);
    sec.remove();
  }

  /* ── Audio on the timeline: where the voice and the bed sit, as the final is mixed ── */

  const NL_TL_MAX = { voStart: 10, musicStart: 30, musicIn: 300, fade: 5 };
  const nlR1 = (n) => Math.round(Number(n) * 10) / 10;

  /** The audio settings the final is mixed with (same defaults as the server). */
  function nlAudioOf(p) {
    const a = (p && p.pipeline && p.pipeline.assemble) || {};
    const sec = (v, max) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? nlR1(Math.min(max, x)) : 0; };
    const vol = (v, d) => { const x = Number(v); return v == null || v === '' || !Number.isFinite(x) ? d : Math.round(Math.max(0, Math.min(1, x)) * 100) / 100; };
    const voOn = a.vo !== false;
    return {
      vo: { on: voOn, start: sec(p && p.vo_start_sec, NL_TL_MAX.voStart), volume: vol(p && p.vo_volume, 1), script: String((p && (p.vo_script || p.agent_brief?.vo_script)) || '').trim() },
      music: {
        on: a.music !== false,
        start: sec(p && p.music_start_sec, NL_TL_MAX.musicStart),
        in: sec(p && p.music_in_sec, NL_TL_MAX.musicIn),
        volume: vol(p && p.music_volume, voOn ? 0.18 : 0.28),
        fade_in: sec(p && p.music_fade_in_sec, NL_TL_MAX.fade),
        fade_out: sec(p && p.music_fade_out_sec, NL_TL_MAX.fade),
        loop: !!(p && p.music_loop === true),
      },
      captions: { on: a.captions !== false, text: p && p.caption_source === 'client' ? String(p.caption_script || '') : '' },
    };
  }

  /** Seconds of speech: the recording when the words match it, else an estimate. */
  function nlVoSecs(p, script, probed) {
    const same = String(script || '').trim() === String(p.vo_script || '').trim();
    if (same) {
      if (probed > 0) return probed;
      const cues = Array.isArray(p.caption_cues) ? p.caption_cues : [];
      const end = cues.reduce((m, c) => Math.max(m, Number(c && c.end) || 0), 0);
      if (end > 0) return end;
      if (Number(p.vo_audit && p.vo_audit.spoken_sec) > 0) return Number(p.vo_audit.spoken_sec);
    }
    const words = String(script || '').trim().split(/\s+/).filter(Boolean).length;
    const wps = Number(p.vo_pace_wps) > 1 ? Number(p.vo_pace_wps) : 2.5;
    return words ? words / wps : 0;
  }

  /** Caption lines, timed from the voice's own start: real word timings when they match. */
  function nlCapChunks(p, script, voSecs, { voice = false } = {}) {
    const per = Math.max(1, Math.min(10, Number((p.last_burned_caption_style || p.caption_style || {}).words_per_line) || 4));
    const same = String(script || '').trim() === String(p.vo_script || '').trim();
    const timed = !voice && Array.isArray(p.caption_words) && p.caption_words.length ? p.caption_words : p.caption_cues;
    const cues = same && Array.isArray(timed) ? timed.filter((c) => c && c.text) : [];
    const out = [];
    if (cues.length) {
      for (let i = 0; i < cues.length; i += per) {
        const g = cues.slice(i, i + per);
        out.push({ text: g.map((c) => c.text).join(' '), a: Number(g[0].start) || 0, b: Number(g[g.length - 1].end) || 0 });
      }
    } else {
      const words = String(script || '').split(/\s+/).filter(Boolean);
      const n = Math.ceil(words.length / per);
      const span = Math.max(0.6, voSecs) / Math.max(1, n);
      for (let i = 0; i < n; i++) out.push({ text: words.slice(i * per, (i + 1) * per).join(' '), a: i * span, b: (i + 1) * span - 0.12 });
    }
    return out.slice(0, 60);
  }

  /** Where the music bed plays on a timeline of `total` seconds. */
  function nlMusicSpan(m, songSecs, total) {
    const a = Math.min(m.start, Math.max(0, total - 0.5));
    const left = songSecs > 0 ? Math.max(0.5, songSecs - m.in) : Infinity;
    const b = m.loop || !Number.isFinite(left) ? total : Math.min(total, a + left);
    return { a, b, short: !m.loop && Number.isFinite(left) && a + left < total - 0.3 };
  }

  /** Open one of the Voiceover / Captions / Music panels and bring it into view. */
  function nlOpenLane(title) {
    const sec = [...document.querySelectorAll('.nl-lane')].find((s) => s.getAttribute('aria-label') === title);
    if (!sec) return;
    const btn = sec.querySelector('.nl-lane__edit');
    if (btn && !sec.classList.contains('is-open')) btn.click();
    sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function nlTimeline(el) {
    if (!el) return;
    const p = _project;
    const scenes = nlScenes();
    if (!p || !scenes.length) { el.hidden = true; el.textContent = ''; _nlTl = null; nlTlStop(); return; }
    el.hidden = false;
    if (_nlTl && _nlTl.pid === p.id) { nlTimelineEditor(el); return; }
    _nlTl = null;
    nlTlStop();
    const f = assembleFlags();
    const au = nlAudioOf(p);
    const shotSecs = scenes.reduce((n, s) => n + nlShotSecs(s), 0);
    const endSecs = p.outro_url && f.outro ? 2 : 0;
    const total = shotSecs + endSecs;
    const pct = (x) => `${((Math.max(0, Math.min(total, x)) / total) * 100).toFixed(2)}%`;
    const blk = (from, to, text, cls, scene) => `<span class="nl-atl__b ${cls || ''}"${scene ? ` data-scene="${esc(scene)}"` : ''} style="left:${pct(from)};width:${pct(Math.min(total, to) - from)}" title="${esc(text)}">${esc(text)}</span>`;
    let t = 0;
    const shotBlocks = scenes.map((s, i) => {
      const a = t; t += nlShotSecs(s);
      const st = nlShotState(s).key;
      return blk(a, t, st === 'gen' ? `${i + 1} · rendering` : String(i + 1), `nl-atl__b--shot nl-atl__b--${st}${s.id === _nlSelShot ? ' is-sel' : ''}`, s.id);
    }).join('') + (endSecs ? blk(shotSecs, total, 'End card', 'nl-atl__b--shot') : '');
    const vo = au.vo.script;
    const voSecs = nlVoSecs(p, vo, 0);
    const voFrom = Math.min(au.vo.start, Math.max(0, total - 0.5));
    const voBlocks = f.vo && vo ? blk(voFrom, Math.max(voFrom + 0.6, voFrom + voSecs), vo, 'nl-atl__b--vo') : '';
    const capBlocks = f.captions && f.vo && vo
      ? nlCapChunks(p, vo, voSecs).slice(0, 24).map((c) => blk(voFrom + c.a, Math.max(voFrom + c.a + 0.2, voFrom + c.b), c.text, 'nl-atl__b--cap')).join('')
      : '';
    const songSecs = Number(p.music_length_ms) > 0 ? Number(p.music_length_ms) / 1000 : 0;
    const ms = nlMusicSpan(au.music, songSecs, total);
    const music = f.music && (p.music_bed_url || p.music_prompt) ? blk(ms.a, ms.b, p.music_prompt || 'Music bed', 'nl-atl__b--music') : '';
    const ticks = [];
    const step = total > 40 ? 10 : total > 20 ? 4 : 2;
    for (let s = 0; s < total; s += step) ticks.push(`<span style="left:${pct(s)}">${nlClock(s)}</span>`);
    const track = (label, blocks, empty) => `<div class="nl-atl__row"><span class="nl-atl__l">${label}</span><div class="nl-atl__lane">${blocks || `<span class="nl-atl__empty">${empty}</span>`}</div></div>`;
    el.innerHTML = `
      <div class="nl-acard__h nl-acard__h--flat"><h2 id="nl-tl-title">Timeline <span class="nl-acard__meta">${nlClock(total)}</span></h2><button type="button" class="nl-abtn nl-abtn--sm" data-nl-tl-edit ${nlTimelineEditable() ? '' : 'disabled title="Wait for the shots to finish"'}>Edit</button></div>
      <div class="nl-atl__ticks">${ticks.join('')}</div>
      ${track('Shots', shotBlocks, '')}
      ${track('Voiceover', voBlocks, f.vo ? 'No script yet' : 'Off')}
      ${track('Captions', capBlocks, f.captions ? (vo && f.vo ? '' : 'Follow the voiceover') : 'Off')}
      ${track('Music', music, f.music ? 'Not added' : 'Off')}`;
    el.querySelector('[data-nl-tl-edit]')?.addEventListener('click', () => nlTimelineOpen(el));
  }

  /* ── Timeline editing: shots (reorder, trim, remove) and the audio tracks; Save rebuilds ── */

  function nlTimelineEditable() {
    const p = _project;
    if (!p || nlEditWorking()) return false;
    return nlScenes().some((x) => x.video_url && x.status === 'ready');
  }

  /** Length of an audio or video file, read from its metadata (null when it can't be read). */
  function nlMediaSecs(url, kind) {
    return new Promise((resolve) => {
      if (!url) { resolve(null); return; }
      const m = document.createElement(kind);
      let settled = false;
      const done = (v) => { if (settled) return; settled = true; clearTimeout(timer); m.removeAttribute('src'); resolve(v); };
      const timer = setTimeout(() => done(null), 5000);
      m.preload = 'metadata';
      m.muted = true;
      m.onloadedmetadata = () => done(Number.isFinite(m.duration) && m.duration > 0 ? Math.round(m.duration * 100) / 100 : null);
      m.onerror = () => done(null);
      m.src = mediaSrc(url);
    });
  }

  async function nlTimelineOpen(el) {
    if (!nlTimelineEditable()) return;
    const scenes = nlScenes();
    const p = _project;
    const audio = nlAudioOf(p);
    _nlTl = {
      pid: p.id,
      order: scenes.map((x) => x.id),
      trims: Object.fromEntries(scenes.map((x) => [x.id, x.trim ? { in: Number(x.trim.in) || 0, out: x.trim.out == null ? null : Number(x.trim.out) } : null])),
      removed: new Set(),
      durs: Object.fromEntries(scenes.map((x) => [x.id, nlClipSecs(x)])),
      sel: _nlSelShot && scenes.some((x) => x.id === _nlSelShot) ? _nlSelShot : scenes[0].id,
      track: 'shot',
      audio,
      audio0: JSON.parse(JSON.stringify(audio)),
      voSecs: 0,
      songSecs: Number(p.music_length_ms) > 0 ? Number(p.music_length_ms) / 1000 : 0,
      songUrl: p.music_bed_url || '',
      saving: false,
    };
    nlTimelineEditor(el);
    // Read each clip's real length so trims are exact, and the recordings' lengths so the
    // voice and the bed are drawn as long as they really are.
    const tl = _nlTl;
    await Promise.all([
      ...scenes.filter((x) => x.video_url).map(async (x) => {
        const d = await nlMediaSecs(x.video_url, 'video');
        if (d > 0.5 && d < 20) tl.durs[x.id] = d;
      }),
      (async () => { const d = await nlMediaSecs(p.vo_url, 'audio'); if (d > 0.3 && d < 300) tl.voSecs = d; })(),
      (async () => { const d = await nlMediaSecs(p.music_bed_url, 'audio'); if (d > 0.5) tl.songSecs = d; })(),
    ]);
    tl.probed = true;
    if (_nlTl === tl) nlTimelineEditor(el);
  }

  function nlTlLen(id) {
    const tl = _nlTl;
    const dur = tl.durs[id] || 5;
    const t = tl.trims[id];
    if (!t) return dur;
    return Math.max(0.5, (t.out == null ? dur : Math.min(dur, t.out)) - (t.in || 0));
  }

  /** Only the audio fields the client changed, track by track. */
  function nlTlAudioDiff(tl) {
    const out = {};
    ['vo', 'music', 'captions'].forEach((k) => {
      const now = tl.audio[k];
      const was = tl.audio0[k];
      const d = {};
      Object.keys(now).forEach((f) => { if (JSON.stringify(now[f]) !== JSON.stringify(was[f])) d[f] = now[f]; });
      if (Object.keys(d).length) out[k] = d;
    });
    return out;
  }

  function nlTlChanged(tl) {
    const byId = Object.fromEntries(nlScenes().map((x) => [x.id, x]));
    const kept = tl.order.filter((id) => !tl.removed.has(id));
    return JSON.stringify(kept) !== JSON.stringify(nlScenes().map((x) => x.id))
      || kept.some((id) => JSON.stringify(tl.trims[id] || null) !== JSON.stringify(byId[id].trim ? { in: Number(byId[id].trim.in) || 0, out: byId[id].trim.out == null ? null : Number(byId[id].trim.out) } : null))
      || Object.keys(nlTlAudioDiff(tl)).length > 0;
  }

  /* Listening to a track from the timeline (one at a time). */
  let _nlTlAudio = null;
  function nlTlStop() {
    if (!_nlTlAudio) return;
    try { _nlTlAudio.a.pause(); } catch (_) {}
    _nlTlAudio = null;
  }

  function nlTlPlay(kind, el) {
    const p = _project;
    const tl = _nlTl;
    if (!tl) return;
    if (_nlTlAudio && _nlTlAudio.kind === kind) { nlTlStop(); nlTimelineEditor(el); return; }
    nlTlStop();
    const url = kind === 'vo' ? p.vo_url : p.music_bed_url;
    if (!url) return;
    const a = new Audio(mediaSrc(url));
    const from = kind === 'music' ? tl.audio.music.in : 0;
    const cur = { kind, a, from };
    _nlTlAudio = cur;
    const end = () => { if (_nlTlAudio === cur) { _nlTlAudio = null; if (_nlTl === tl) nlTimelineEditor(el); } };
    a.onended = end;
    a.onerror = () => { end(); toast('Could not play that track', 'error'); };
    a.addEventListener('loadedmetadata', () => { if (from > 0 && from < (a.duration || 0)) a.currentTime = from; }, { once: true });
    a.play().catch(() => { end(); });
    nlTimelineEditor(el);
    // Playhead on the track while it plays.
    const tick = () => {
      if (_nlTlAudio !== cur) return;
      const ph = el.querySelector(`.nl-tle__ph[data-ph="${kind}"]`);
      const laneEl = ph && ph.parentElement;
      if (ph && laneEl) {
        const total = Number(laneEl.dataset.total) || 1;
        const start = kind === 'music' ? tl.audio.music.start : tl.audio.vo.start;
        const at = start + Math.max(0, a.currentTime - from);
        ph.hidden = at > total;
        ph.style.left = `${((Math.min(total, at) / total) * 100).toFixed(3)}%`;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function nlTimelineEditor(el) {
    const tl = _nlTl;
    const p = _project;
    // Keep the caret where it was when the editor redraws under the client's typing.
    const act = document.activeElement;
    const keep = act && el.contains(act) && act.dataset && act.dataset.a
      ? { a: act.dataset.a, s: act.selectionStart, e: act.selectionEnd } : null;
    const byId = Object.fromEntries(nlScenes().map((x) => [x.id, x]));
    tl.order = tl.order.filter((id) => byId[id]);
    const kept = tl.order.filter((id) => !tl.removed.has(id));
    if (!kept.includes(tl.sel)) tl.sel = kept[0] || null;
    if ((p.music_bed_url || '') !== tl.songUrl) {
      // A new bed was made or picked while editing: read its length.
      tl.songUrl = p.music_bed_url || '';
      tl.songSecs = Number(p.music_length_ms) > 0 ? Number(p.music_length_ms) / 1000 : 0;
      nlMediaSecs(p.music_bed_url, 'audio').then((d) => { if (_nlTl === tl && d > 0.5) { tl.songSecs = d; nlTimelineEditor(el); } });
    }
    const f = assembleFlags();
    const au = tl.audio;
    const endSecs = p.outro_url && f.outro ? 2 : 0;
    const shotTotal = kept.reduce((n, id) => n + nlTlLen(id), 0);
    const total = Math.max(1, shotTotal + endSecs);
    const pct = (x) => `${((Math.max(0, Math.min(total, x)) / total) * 100).toFixed(3)}%`;
    let t = 0;
    const blocks = kept.map((id, i) => {
      const x = byId[id];
      const len = nlTlLen(id);
      const a = t; t += len;
      const thumb = x.keyframe_url ? ` style="--thumb:url('${String(x.keyframe_url).replace(/'/g, '%27')}')"` : '';
      return `<div class="nl-tle__b${tl.track === 'shot' && id === tl.sel ? ' is-sel' : ''}${tl.trims[id] ? ' is-trim' : ''}" data-id="${esc(id)}" draggable="true" style="left:${pct(a)};width:${pct(len)}" role="button" tabindex="0" aria-label="Shot ${i + 1}, ${len.toFixed(1)} seconds">
          <span class="nl-tle__thumb"${thumb}></span>
          <span class="nl-tle__h nl-tle__h--in" data-handle="in" aria-hidden="true"></span>
          <span class="nl-tle__lab"><b>${i + 1}</b>${len.toFixed(1)}s</span>
          <span class="nl-tle__h nl-tle__h--out" data-handle="out" aria-hidden="true"></span>
        </div>`;
    }).join('') + (endSecs ? `<div class="nl-tle__b nl-tle__b--end" style="left:${pct(shotTotal)};width:${pct(endSecs)}"><span class="nl-tle__lab">End card</span></div>` : '');

    // Voiceover track
    const voScript = au.vo.script;
    const voSecs = nlVoSecs(p, voScript, voScript === String(p.vo_script || '').trim() ? tl.voSecs : 0);
    const voFrom = Math.min(au.vo.start, Math.max(0, total - 0.5));
    const voTo = Math.min(total, voFrom + Math.max(0.6, voSecs));
    const voOver = voScript ? Math.max(0, voFrom + voSecs - total) : 0;
    const voBlock = voScript
      ? `<div class="nl-tle__ab nl-tle__ab--vo${au.vo.on ? '' : ' is-off'}${tl.track === 'vo' ? ' is-sel' : ''}${voOver > 0.2 ? ' is-over' : ''}" data-audio="vo" role="button" tabindex="0" aria-label="Voiceover, starts at ${voFrom.toFixed(1)} seconds. Drag or use the arrow keys to move it." style="left:${pct(voFrom)};width:${pct(voTo - voFrom)}"><span class="nl-tle__wave" aria-hidden="true"></span><span class="nl-tle__alab">${esc(voScript)}</span></div>`
      : `<span class="nl-atl__empty">No script yet</span>`;
    // Captions track (follows the voice)
    const capOn = au.captions.on && au.vo.on;
    const caps = tl.capLines || (voScript ? nlCapChunks(p, voScript, voSecs, { voice: !!tl.capFromVoice }) : []);
    const capBlocks = caps.length
      ? caps.map((c) => `<span class="nl-tle__cap" data-rel="${c.a.toFixed(3)}" data-relb="${c.b.toFixed(3)}" style="left:${pct(voFrom + c.a)};width:${pct(Math.max(voFrom + c.a + 0.2, Math.min(total, voFrom + c.b)) - (voFrom + c.a))}" title="${esc(c.text)}">${esc(c.text)}</span>`).join('')
      : `<span class="nl-atl__empty">Follow the voiceover</span>`;
    // Music track
    const ms = nlMusicSpan(au.music, tl.songSecs, total);
    const mLen = Math.max(0.1, ms.b - ms.a);
    const fadeIn = Math.min(au.music.fade_in, mLen);
    const fadeOut = ms.b >= total - 0.05 ? Math.min(au.music.fade_out, mLen) : 0;
    const musicBlock = p.music_bed_url
      ? `<div class="nl-tle__ab nl-tle__ab--music${au.music.on ? '' : ' is-off'}${tl.track === 'music' ? ' is-sel' : ''}" data-audio="music" role="button" tabindex="0" aria-label="Music, starts at ${ms.a.toFixed(1)} seconds. Drag or use the arrow keys to move it." style="left:${pct(ms.a)};width:${pct(mLen)}">
          ${fadeIn ? `<span class="nl-tle__fade nl-tle__fade--in" style="width:${((fadeIn / mLen) * 100).toFixed(2)}%"></span>` : ''}
          ${fadeOut ? `<span class="nl-tle__fade nl-tle__fade--out" style="width:${((fadeOut / mLen) * 100).toFixed(2)}%"></span>` : ''}
          <span class="nl-tle__wave" aria-hidden="true"></span>
          <span class="nl-tle__alab">${esc(p.music_prompt || 'Music bed')}${au.music.in ? ` · from ${nlR1(au.music.in).toFixed(1)}s` : ''}${au.music.loop ? ' · loops' : ''}</span>
        </div>`
      : `<span class="nl-atl__empty">Not added · <button type="button" class="nl-alink" data-tl-lane="Music">Add music</button></span>`;

    const ticks = [];
    const step = total > 40 ? 10 : total > 20 ? 4 : 2;
    for (let sec = 0; sec < total; sec += step) ticks.push(`<span style="left:${pct(sec)}">${nlClock(sec)}</span>`);
    const playing = _nlTlAudio ? _nlTlAudio.kind : null;
    const row = (key, label, on, laneCls, inner, extra = '') => `
      <div class="nl-tle__row${on ? '' : ' is-off'}">
        <button type="button" class="nl-tle__rl${tl.track === key ? ' is-sel' : ''}" data-track="${key}">${label}${on ? '' : '<small>Off</small>'}</button>
        <div class="${laneCls}" data-total="${total}" ${extra}>${inner}<span class="nl-tle__ph" data-ph="${key}" hidden></span></div>
      </div>`;

    const sw = (path, on, label) => `<label class="nl-tle__sw"><input type="checkbox" data-a="${path}" ${on ? 'checked' : ''}><span aria-hidden="true"></span>${label}</label>`;
    const num = (path, v, max, label, unit = 's', stepv = 0.1) => `<label class="nl-tle__f">${label}<input type="number" step="${stepv}" min="0" max="${max}" value="${Number(v).toFixed(1)}" data-a="${path}"><span>${unit}</span></label>`;
    const slider = (path, v, label) => `<label class="nl-tle__f nl-tle__f--vol">${label}<input type="range" min="0" max="100" step="1" value="${Math.round(v * 100)}" data-a="${path}" aria-valuetext="${Math.round(v * 100)}%"><output>${Math.round(v * 100)}%</output></label>`;
    const play = (kind, can, why) => `<button type="button" class="nl-abtn nl-abtn--sm" data-tl-play="${kind}" ${can ? '' : `disabled title="${esc(why)}"`}>${nlSvg(playing === kind ? NL_I.stop : NL_I.play, 12, 2)}${playing === kind ? 'Stop' : 'Listen'}</button>`;

    let inspector = '';
    if (tl.track === 'vo') {
      const same = voScript === String(p.vo_script || '').trim();
      inspector = `
      <div class="nl-tle__insp nl-tle__insp--audio" data-insp="vo">
        <div class="nl-tle__irow">
          <span class="nl-tle__it">Voiceover</span>
          ${sw('vo.on', au.vo.on, 'On')}
          ${num('vo.start', au.vo.start, NL_TL_MAX.voStart, 'Starts at')}
          ${slider('vo.volume', au.vo.volume, 'Volume')}
          <span class="nl-grow"></span>
          ${play('vo', !!p.vo_url && same, same ? 'No recording yet' : 'Save to hear the new words')}
        </div>
        <label class="nl-tle__script"><span>What the voice says</span><textarea rows="3" data-a="vo.script" maxlength="4500" placeholder="Write what the voice says">${esc(voScript)}</textarea></label>
        <p class="nl-tle__note">${voOver > 0.2 ? `<b>The voice runs ${voOver.toFixed(1)}s past the end.</b> Move it earlier or shorten the words. ` : ''}${same ? `About ${voSecs.toFixed(1)}s of speech.` : 'New words are recorded when you save, and the length is checked against the video.'}</p>
      </div>`;
    } else if (tl.track === 'music') {
      inspector = p.music_bed_url ? `
      <div class="nl-tle__insp nl-tle__insp--audio" data-insp="music">
        <div class="nl-tle__irow">
          <span class="nl-tle__it">Music</span>
          ${sw('music.on', au.music.on, 'On')}
          ${num('music.start', au.music.start, NL_TL_MAX.musicStart, 'Starts at')}
          ${num('music.in', au.music.in, tl.songSecs ? Math.max(0, tl.songSecs - 1).toFixed(1) : NL_TL_MAX.musicIn, 'Song from')}
          ${slider('music.volume', au.music.volume, 'Volume')}
        </div>
        <div class="nl-tle__irow">
          ${num('music.fade_in', au.music.fade_in, NL_TL_MAX.fade, 'Fade in')}
          ${num('music.fade_out', au.music.fade_out, NL_TL_MAX.fade, 'Fade out')}
          ${sw('music.loop', au.music.loop, 'Loop if the song is shorter')}
          <span class="nl-grow"></span>
          ${play('music', true, '')}
          <button type="button" class="nl-abtn nl-abtn--sm" data-tl-lane="Music">Change music</button>
        </div>
        <p class="nl-tle__note">${tl.songSecs ? `The song is ${tl.songSecs.toFixed(1)}s long. ` : ''}${ms.short ? 'It ends before the video does: start it from earlier, or turn on Loop. ' : ''}Listen plays the song from the point you chose.</p>
      </div>` : `
      <div class="nl-tle__insp" data-insp="music"><span class="nl-tle__it">Music</span><span class="nl-tle__note">No music bed yet.</span><span class="nl-grow"></span><button type="button" class="nl-abtn nl-abtn--sm" data-tl-lane="Music">Add music</button></div>`;
    } else if (tl.track === 'cap') {
      // Each caption line, editable in place. The lines keep their times while you type;
      // saving lines the new words up with the voice again.
      if (!tl.capLines) tl.capLines = caps.map((c) => ({ text: c.text, a: c.a, b: c.b }));
      const own = !!String(au.captions.text || '').trim();
      inspector = `
      <div class="nl-tle__insp nl-tle__insp--cap" data-insp="cap">
        <div class="nl-tle__irow">
          <span class="nl-tle__it">Captions</span>
          ${sw('captions.on', au.captions.on, 'On')}
          <span class="nl-tle__note">${au.vo.on ? (own ? 'Your own words, timed to the voice.' : 'Timed to the voice, word by word.') : 'Captions need the voiceover on.'}</span>
          <span class="nl-grow"></span>
          ${own ? '<button type="button" class="nl-abtn nl-abtn--sm" data-tl-cap="match">Match the voiceover</button>' : ''}
          <button type="button" class="nl-abtn nl-abtn--sm" data-tl-lane="Captions">Style captions</button>
        </div>
        ${tl.capLines.length ? `<ol class="nl-tle__caplines">${tl.capLines.map((l, i) => `
          <li class="nl-tle__capline"><span class="nl-tle__captime">${nlClock(voFrom + l.a)}</span><input type="text" data-cap-line="${i}" value="${esc(l.text)}" aria-label="Caption line ${i + 1}, at ${nlClock(voFrom + l.a)}"></li>`).join('')}
        </ol>` : '<p class="nl-tle__note">No captions yet. Write the voiceover first.</p>'}
        <p class="nl-tle__note">Change what a line says without changing the voice, like OPA on screen while the voice says O P A. Saving rebuilds the final.</p>
      </div>`;
    } else {
      const sel = tl.sel ? byId[tl.sel] : null;
      const selIdx = kept.indexOf(tl.sel);
      const dur = sel ? (tl.durs[sel.id] || 5) : 5;
      const tr = sel ? (tl.trims[sel.id] || { in: 0, out: null }) : null;
      inspector = sel ? `
      <div class="nl-tle__insp">
        <span class="nl-tle__it">Shot ${selIdx + 1}</span>
        <label class="nl-tle__f">Start<input type="number" step="0.1" min="0" max="${(dur - 0.5).toFixed(1)}" value="${(tr.in || 0).toFixed(1)}" data-trim="in" aria-label="Start, seconds into the clip"><span>s</span></label>
        <label class="nl-tle__f">End<input type="number" step="0.1" min="0.5" max="${dur.toFixed(1)}" value="${(tr.out == null ? dur : tr.out).toFixed(1)}" data-trim="out" aria-label="End, seconds into the clip"><span>s</span></label>
        <span class="nl-tle__len">${nlTlLen(sel.id).toFixed(1)}s of ${dur.toFixed(1)}s</span>
        <span class="nl-grow"></span>
        <button type="button" class="nl-abtn nl-abtn--sm nl-abtn--icon" data-tl="left" ${selIdx <= 0 ? 'disabled' : ''} aria-label="Move earlier">${nlSvg(NL_I.left, 13, 2)}</button>
        <button type="button" class="nl-abtn nl-abtn--sm nl-abtn--icon" data-tl="right" ${selIdx >= kept.length - 1 ? 'disabled' : ''} aria-label="Move later">${nlSvg(NL_I.right, 13, 2)}</button>
        <button type="button" class="nl-abtn nl-abtn--sm" data-tl="reset" ${tl.trims[sel.id] ? '' : 'disabled'}>Reset trim</button>
        <button type="button" class="nl-abtn nl-abtn--sm nl-abtn--bad" data-tl="remove" ${kept.length <= 1 ? 'disabled' : ''}>Remove</button>
      </div>` : '';
    }
    const removedList = tl.order.filter((id) => tl.removed.has(id));
    const changed = nlTlChanged(tl);
    el.innerHTML = `
      <div class="nl-acard__h nl-acard__h--flat"><h2 id="nl-tl-title">Timeline <span class="nl-tle__badge">Editing</span><span class="nl-acard__meta">${nlClock(total)}</span></h2>
        <span class="nl-acard__tools"><button type="button" class="nl-abtn nl-abtn--sm" data-tl="cancel">Cancel</button><button type="button" class="nl-abtn nl-abtn--sm nl-abtn--primary" data-tl="save" ${changed && !tl.saving ? '' : 'disabled'}>${tl.saving ? 'Saving…' : 'Save and rebuild'}</button></span></div>
      <div class="nl-atl__ticks">${ticks.join('')}</div>
      <div class="nl-tle__rows"${tl.probed ? ' data-probed' : ''}>
        ${row('shot', 'Shots', true, 'nl-tle__lane', `${blocks}<span class="nl-tle__drop" hidden></span>`, 'data-lane')}
        ${row('vo', 'Voiceover', au.vo.on, 'nl-tle__alane nl-tle__alane--vo', voBlock)}
        ${row('cap', 'Captions', capOn, 'nl-tle__alane nl-tle__alane--cap', capBlocks)}
        ${row('music', 'Music', au.music.on, 'nl-tle__alane nl-tle__alane--music', musicBlock)}
      </div>
      ${inspector}
      ${removedList.length ? `<div class="nl-tle__removed">Removed: ${removedList.map((id) => `<button type="button" class="nl-alink" data-restore="${esc(id)}">Shot ${nlScenes().findIndex((x) => x.id === id) + 1} · Undo</button>`).join(' ')}</div>` : ''}
      <p class="nl-tle__hint">Drag a shot to move it, or drag its edges to trim. Drag the voiceover or the music to change when it starts, and click a track to set its volume, fades and words. Saving rebuilds the final.</p>`;
    nlTimelineBind(el, total);
    if (keep) {
      const back = el.querySelector(`[data-a="${keep.a}"]`);
      if (back) {
        back.focus();
        try { if (keep.s != null && back.setSelectionRange) back.setSelectionRange(keep.s, keep.e); } catch (_) {}
      }
    }
  }

  function nlTimelineBind(el, total) {
    const tl = _nlTl;
    const lane = el.querySelector('[data-lane]');
    const kept = () => tl.order.filter((id) => !tl.removed.has(id));
    const rerender = () => nlTimelineEditor(el);
    const refreshSave = () => {
      const b = el.querySelector('[data-tl="save"]');
      if (b) b.disabled = !nlTlChanged(tl) || tl.saving;
    };
    // A field that commits on blur must not redraw under a press in progress, or the
    // button being pressed is replaced and its click is lost. Redraw once it lands.
    tl.el = el;
    el.addEventListener('pointerdown', () => { tl.down = true; }, true);
    if (!window.__nlTlUp) {
      window.__nlTlUp = true;
      const land = () => setTimeout(() => {
        const cur = _nlTl;
        if (!cur) return;
        cur.down = false;
        if (cur.pending) { cur.pending = false; if (cur.el && cur.el.isConnected) nlTimelineEditor(cur.el); }
      }, 0);
      window.addEventListener('pointerup', land, true);
      window.addEventListener('pointercancel', land, true);
      window.addEventListener('dragend', land, true);
    }
    const later = () => { if (tl.down) tl.pending = true; else rerender(); };
    el.querySelector('[data-tl="cancel"]')?.addEventListener('click', () => { nlTlStop(); _nlTl = null; nlTimeline(el); });
    el.querySelector('[data-tl="save"]')?.addEventListener('click', () => nlTimelineSave(el));
    el.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => { tl.removed.delete(b.dataset.restore); rerender(); }));
    el.querySelectorAll('[data-track]').forEach((b) => b.addEventListener('click', () => { tl.track = b.dataset.track; rerender(); }));
    el.querySelectorAll('[data-tl-lane]').forEach((b) => b.addEventListener('click', () => nlOpenLane(b.dataset.tlLane)));
    el.querySelectorAll('[data-tl-play]').forEach((b) => b.addEventListener('click', () => nlTlPlay(b.dataset.tlPlay, el)));
    el.querySelector('.nl-tle__alane--cap')?.addEventListener('click', () => { if (tl.track !== 'cap') { tl.track = 'cap'; rerender(); } });
    // Caption lines: typing changes the words (the voice is not touched).
    el.querySelectorAll('[data-cap-line]').forEach((inp) => inp.addEventListener('input', () => {
      const i = Number(inp.dataset.capLine);
      if (!tl.capLines || !tl.capLines[i]) return;
      tl.capLines[i].text = inp.value;
      const joined = tl.capLines.map((l) => String(l.text || '').trim()).filter(Boolean).join(' ');
      const voice = String(tl.audio.vo.script || '').trim();
      tl.audio.captions.text = joined === voice ? '' : joined;
      const chip = el.querySelectorAll('.nl-tle__cap')[i];
      if (chip) { chip.textContent = inp.value; chip.title = inp.value; }
      refreshSave();
    }));
    el.querySelector('[data-tl-cap="match"]')?.addEventListener('click', () => {
      tl.audio.captions.text = '';
      tl.capLines = null;
      tl.capFromVoice = true;
      rerender();
    });

    // Audio settings: switches, numbers, volume sliders and the script.
    const setA = (path, v) => {
      const [k, f] = path.split('.');
      tl.audio[k][f] = v;
    };
    el.querySelectorAll('[data-a]').forEach((inp) => {
      const path = inp.dataset.a;
      if (inp.type === 'checkbox') {
        inp.addEventListener('change', () => { setA(path, inp.checked); rerender(); });
      } else if (inp.type === 'range') {
        const out = inp.parentElement.querySelector('output');
        inp.addEventListener('input', () => {
          setA(path, Math.round(Number(inp.value)) / 100);
          if (out) out.textContent = `${Math.round(Number(inp.value))}%`;
          inp.setAttribute('aria-valuetext', `${Math.round(Number(inp.value))}%`);
          refreshSave();
        });
      } else if (inp.tagName === 'TEXTAREA') {
        inp.addEventListener('input', () => {
          setA(path, inp.value.trim());
          // Captions that follow the voice follow its new words too.
          if (path === 'vo.script' && !String(tl.audio.captions.text || '').trim()) tl.capLines = null;
          refreshSave();
          // The recording only matches the words it was made from.
          const pb = el.querySelector('[data-tl-play="vo"]');
          if (pb) {
            const same = inp.value.trim() === String(_project.vo_script || '').trim();
            pb.disabled = !same || !_project.vo_url;
            pb.title = same ? '' : 'Save to hear the new words';
            if (!same && _nlTlAudio && _nlTlAudio.kind === 'vo') nlTlStop();
          }
        });
        inp.addEventListener('change', later);
      } else {
        inp.addEventListener('change', () => {
          const max = Number(inp.max) || 0;
          let v = Number(inp.value);
          if (!Number.isFinite(v) || v < 0) v = 0;
          if (max) v = Math.min(max, v);
          setA(path, nlR1(v));
          later();
        });
      }
    });

    // Move the voice or the bed: drag it, or arrow keys (Shift for a second at a time).
    el.querySelectorAll('[data-audio]').forEach((blk) => {
      const kind = blk.dataset.audio;
      const laneEl = blk.parentElement;
      const max = Math.max(0, Math.min(kind === 'vo' ? NL_TL_MAX.voStart : NL_TL_MAX.musicStart, total - 0.5));
      const caps = kind === 'vo' ? [...el.querySelectorAll('.nl-tle__cap')] : [];
      const width = Number.parseFloat(blk.style.width) / 100 * total;
      const paint = (s) => {
        blk.style.left = `${((s / total) * 100).toFixed(3)}%`;
        if (kind === 'vo') {
          caps.forEach((c) => { c.style.left = `${(((s + Number(c.dataset.rel)) / total) * 100).toFixed(3)}%`; });
        } else {
          blk.style.width = `${((Math.max(0.1, Math.min(total, s + width) - s) / total) * 100).toFixed(3)}%`;
        }
      };
      blk.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const s0 = tl.audio[kind].start;
        const x0 = e.clientX;
        const pxPerSec = laneEl.getBoundingClientRect().width / total;
        try { blk.setPointerCapture(e.pointerId); } catch (_) {}
        blk.classList.add('is-moving');
        const move = (ev) => {
          const d = (ev.clientX - x0) / pxPerSec;
          const s = Math.max(0, Math.min(max, nlR1(s0 + d)));
          tl.audio[kind].start = s;
          paint(s);
        };
        const up = () => {
          blk.removeEventListener('pointermove', move);
          blk.removeEventListener('pointerup', up);
          blk.removeEventListener('pointercancel', up);
          tl.track = kind;
          rerender();
          el.querySelector(`[data-audio="${kind}"]`)?.focus({ preventScroll: true });
        };
        blk.addEventListener('pointermove', move);
        blk.addEventListener('pointerup', up);
        blk.addEventListener('pointercancel', up);
      });
      blk.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tl.track = kind; rerender(); el.querySelector(`[data-audio="${kind}"]`)?.focus(); return; }
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const d = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowLeft' ? -1 : 1);
        tl.audio[kind].start = Math.max(0, Math.min(max, nlR1(tl.audio[kind].start + d)));
        tl.track = kind;
        rerender();
        el.querySelector(`[data-audio="${kind}"]`)?.focus();
      });
    });

    const insp = el.querySelector('.nl-tle__insp:not([data-insp])');
    insp?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tl]');
      if (!b || b.disabled) return;
      const ids = kept();
      const i = ids.indexOf(tl.sel);
      if (b.dataset.tl === 'left' || b.dataset.tl === 'right') {
        const j = b.dataset.tl === 'left' ? i - 1 : i + 1;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        tl.order = ids.concat(tl.order.filter((id) => tl.removed.has(id)));
      } else if (b.dataset.tl === 'reset') {
        tl.trims[tl.sel] = null;
      } else if (b.dataset.tl === 'remove') {
        if (ids.length <= 1) return;
        tl.removed.add(tl.sel);
        tl.sel = ids[i + 1] || ids[i - 1] || null;
      }
      rerender();
    });
    insp?.querySelectorAll('[data-trim]').forEach((inp) => inp.addEventListener('change', () => {
      const dur = tl.durs[tl.sel] || 5;
      const cur = tl.trims[tl.sel] || { in: 0, out: null };
      let a = inp.dataset.trim === 'in' ? Number(inp.value) : cur.in || 0;
      let b = inp.dataset.trim === 'out' ? Number(inp.value) : (cur.out == null ? dur : cur.out);
      a = Math.max(0, Math.min(Number.isFinite(a) ? a : 0, dur - 0.5));
      b = Math.max(a + 0.5, Math.min(Number.isFinite(b) ? b : dur, dur));
      tl.trims[tl.sel] = a <= 0.05 && b >= dur - 0.05 ? null : { in: Math.round(a * 10) / 10, out: b >= dur - 0.05 ? null : Math.round(b * 10) / 10 };
      later();
    }));
    if (!lane) return;
    // Select and keyboard nudge
    lane.addEventListener('click', (e) => {
      const b = e.target.closest('.nl-tle__b[data-id]');
      if (!b || e.target.closest('[data-handle]')) return;
      tl.sel = b.dataset.id;
      tl.track = 'shot';
      rerender();
    });
    lane.addEventListener('keydown', (e) => {
      const b = e.target.closest('.nl-tle__b[data-id]');
      if (!b) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tl.sel = b.dataset.id; tl.track = 'shot'; rerender(); el.querySelector(`.nl-tle__b[data-id="${CSS.escape(tl.sel)}"]`)?.focus(); }
    });
    // Trim by dragging an edge
    lane.addEventListener('pointerdown', (e) => {
      const h = e.target.closest('[data-handle]');
      const b = e.target.closest('.nl-tle__b[data-id]');
      if (!h || !b) return;
      e.preventDefault();
      const id = b.dataset.id;
      tl.sel = id;
      tl.track = 'shot';
      const dur = tl.durs[id] || 5;
      const start = tl.trims[id] || { in: 0, out: null };
      const startIn = start.in || 0;
      const startOut = start.out == null ? dur : start.out;
      const ids = kept();
      const end = el.querySelector('.nl-tle__b--end');
      const totalSec = ids.reduce((n, k) => n + nlTlLen(k), 0) + (end ? 2 : 0);
      const pxPerSec = lane.getBoundingClientRect().width / Math.max(1, totalSec);
      const x0 = e.clientX;
      lane.setPointerCapture(e.pointerId);
      lane.classList.add('is-trimming');
      const move = (ev) => {
        const d = (ev.clientX - x0) / pxPerSec;
        let a = startIn;
        let o = startOut;
        if (h.dataset.handle === 'in') a = Math.max(0, Math.min(startOut - 0.5, startIn + d));
        else o = Math.max(startIn + 0.5, Math.min(dur, startOut + d));
        a = Math.round(a * 10) / 10;
        o = Math.round(o * 10) / 10;
        tl.trims[id] = a <= 0.05 && o >= dur - 0.05 ? null : { in: a, out: o >= dur - 0.05 ? null : o };
        // Repaint blocks in place so the drag keeps its pointer.
        let acc = 0;
        const tot = ids.reduce((n, k) => n + nlTlLen(k), 0) + (end ? 2 : 0);
        ids.forEach((k) => {
          const node = lane.querySelector(`.nl-tle__b[data-id="${CSS.escape(k)}"]`);
          const len = nlTlLen(k);
          if (node) {
            node.style.left = `${((acc / tot) * 100).toFixed(3)}%`;
            node.style.width = `${((len / tot) * 100).toFixed(3)}%`;
            const lab = node.querySelector('.nl-tle__lab');
            if (lab) lab.innerHTML = `<b>${ids.indexOf(k) + 1}</b>${len.toFixed(1)}s`;
          }
          acc += len;
        });
        if (end) { end.style.left = `${((acc / tot) * 100).toFixed(3)}%`; end.style.width = `${((2 / tot) * 100).toFixed(3)}%`; }
      };
      const up = () => {
        lane.removeEventListener('pointermove', move);
        lane.removeEventListener('pointerup', up);
        lane.removeEventListener('pointercancel', up);
        lane.classList.remove('is-trimming');
        rerender();
      };
      lane.addEventListener('pointermove', move);
      lane.addEventListener('pointerup', up);
      lane.addEventListener('pointercancel', up);
    });
    // Reorder by dragging a shot
    let dragId = null;
    const drop = lane.querySelector('.nl-tle__drop');
    const slotAt = (clientX) => {
      const ids = kept().filter((k) => k !== dragId);
      for (let i = 0; i < ids.length; i++) {
        const r = lane.querySelector(`.nl-tle__b[data-id="${CSS.escape(ids[i])}"]`).getBoundingClientRect();
        if (clientX < r.left + r.width / 2) return { index: i, x: r.left };
      }
      const last = ids.length ? lane.querySelector(`.nl-tle__b[data-id="${CSS.escape(ids[ids.length - 1])}"]`).getBoundingClientRect() : lane.getBoundingClientRect();
      return { index: ids.length, x: last.right };
    };
    lane.addEventListener('dragstart', (e) => {
      const b = e.target.closest('.nl-tle__b[data-id]');
      if (!b || lane.classList.contains('is-trimming')) { e.preventDefault(); return; }
      dragId = b.dataset.id;
      b.classList.add('is-drag');
      try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch (_) {}
    });
    lane.addEventListener('dragover', (e) => {
      if (!dragId) return;
      e.preventDefault();
      const at = slotAt(e.clientX);
      drop.hidden = false;
      drop.style.left = `${at.x - lane.getBoundingClientRect().left - 1}px`;
    });
    lane.addEventListener('dragleave', (e) => { if (!lane.contains(e.relatedTarget)) drop.hidden = true; });
    lane.addEventListener('drop', (e) => {
      if (!dragId) return;
      e.preventDefault();
      const at = slotAt(e.clientX);
      const ids = kept().filter((k) => k !== dragId);
      ids.splice(at.index, 0, dragId);
      tl.order = ids.concat(tl.order.filter((id) => tl.removed.has(id)));
      tl.sel = dragId;
      dragId = null;
      rerender();
    });
    lane.addEventListener('dragend', () => { dragId = null; drop.hidden = true; lane.querySelectorAll('.is-drag').forEach((n) => n.classList.remove('is-drag')); });
  }

  async function nlTimelineSave(el) {
    const tl = _nlTl;
    if (!tl || tl.saving) return;
    const kept = tl.order.filter((id) => !tl.removed.has(id));
    const audio = nlTlAudioDiff(tl);
    tl.saving = true;
    nlTlStop();
    nlTimelineEditor(el);
    try {
      const data = await animFetch(`/api/animation/projects/${_project.id}/timeline`, {
        method: 'POST',
        body: JSON.stringify({
          scene_ids: kept,
          remove: [...tl.removed],
          trims: Object.fromEntries(kept.map((id) => [id, tl.trims[id] || null])),
          durations: tl.durs,
          ...(Object.keys(audio).length ? { audio } : {}),
        }),
      });
      _nlTl = null;
      if (data.project) _project = data.project;
      _canvasFp = projectUiFingerprint(_project);
      renderCanvas();
      renderChat();
      if (data.rebuilding) { toast(data.revoice ? 'Timeline saved. Recording the new words and rebuilding the final.' : 'Timeline saved. Rebuilding the final.', 'success'); startPoll(); }
    } catch (e) {
      tl.saving = false;
      nlTimelineEditor(el);
      toast(e.message || 'Could not save the timeline', 'error', e.request_id);
    }
  }

  function renderCanvas() {
    renderCanvasInner();
    if (document.documentElement.classList.contains('nl')) {
      const body = document.getElementById('anim-canvas-body');
      if (body) body.dataset.nlSteps = _project ? animStepsNL(_project) : '';
      paintStepsNL();
      try { nlAnimLayout(true); } catch (e) { console.warn('[animate] new look layout', e); }
    }
  }

  function renderCanvasInner() {
    const el = document.getElementById('anim-canvas-body');
    if (!el) return;
    _canvasFp = projectUiFingerprint(_project);
    const p = _project;
    if (!p) {
      // Always show saved projects — including soft-expired (need Char re-upload).
      // Filtering these out made the home screen look wiped after a restart.
      const listed = _recent.slice();
      const recentHtml = _recentLoading ? `
        <div class="anim-placeholder-row" style="margin-top:22px;max-width:420px;margin-left:auto;margin-right:auto;">Loading recent projects…</div>`
        : listed.length ? `
        <div class="anim-recent">
          <div class="anim-section__label">Recent projects</div>
          <div class="anim-recent__list">
            ${listed.slice(0, 12).map((rp) => `
              <div class="anim-recent__row">
                <button type="button" class="anim-recent__item" data-open-project="${esc(rp.id)}">
                  ${nlOn() ? `<span class="anim-recent__th">${rp.thumb_url ? `<img src="${esc(mediaSrc(rp.thumb_url))}" alt="" loading="lazy">` : ''}</span>` : ''}
                  ${nlOn() ? `<span class="anim-recent__tb"><span class="anim-recent__title">${esc(projectTitle(rp))}</span><span class="anim-recent__sub">${esc(nlRecentSub(rp))}</span></span>` : `<span class="anim-recent__title">${esc(projectTitle(rp))}</span>`}
                  <span class="anim-recent__meta">${statusBadge(rp.status)}${rp.recovered_from_content ? ' <span class="anim-recent__mode">recovered</span>' : ''}${projectMediaExpired(rp) ? ' <span class="anim-recent__mode">expired media</span>' : (projectNeedsCharReupload(rp) ? ' <span class="anim-recent__mode">re-upload Char</span>' : '')}${nlOn() ? '' : ` <span class="anim-recent__mode">${esc(rp.mode || '')}</span>`}</span>
                </button>
                <button type="button" class="anim-btn anim-btn--ghost anim-recent__del" data-del-project="${esc(rp.id)}" title="Delete project">✕</button>
              </div>`).join('')}
          </div>
        </div>` : `
        <div class="anim-placeholder-row" style="margin-top:22px;max-width:420px;margin-left:auto;margin-right:auto;">No saved projects yet — send a prompt to start one. Your shots stay with the project across refreshes.</div>`;
      el.innerHTML = `
        <div class="anim-empty">
          <div class="anim-empty__title">Start a video</div>
          <div class="anim-empty__desc">Pick a mode, attach tagged refs, and describe one idea. AI looks at the images, then writes distinct shots. Accept to generate character views, scenes, and shots here.</div>
          <div class="anim-empty__hint">Tip: tag refs as <strong>Char</strong>, <strong>Item</strong>, <strong>Setting</strong>, or <strong>Scene</strong>, then run. Uploads stay saved on your account.</div>
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

      ${renderStoryArcSection(p)}

      <div class="anim-section" data-nl="char">
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
            ? 'Character refs need a re-upload after a restart, but your shots and finals are still here.'
            : 'Some images expired after a restart. Delete this project, re-upload refs (tag Char + Style), and run again — new uploads stay saved.'}</div>
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
        <div class="anim-placeholder-row">${nlOn() ? "Add a photo of your character above, then accept the shot plan to make their reference sheet." : "Add reference images in the chat panel, then accept the brief to generate multi-view sheets."}</div>`}
      </div>

      <div class="anim-section" data-nl="shots">
        <div class="anim-section__label">Timeline</div>
        <div class="anim-timeline">
          ${scenes.length ? (() => {
            const timelineBusy = projectHasBusyScenes(p) || p.status === 'assembling';
            const addReason = addSceneDisabledReason(p);
            return `${scenes.map((s, idx) => {
              const regenLabel = s.status === 'generating'
                ? 'Generating…'
                : (s.video_url || (s.takes || []).length) ? 'Regenerate' : 'Generate';
              const shotI2v = s.i2v_model || currentI2vModel() || 'seedance';
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
                <label class="anim-shot__prompt-label">What happens</label>
                <textarea class="anim-shot__prompt-edit" data-scene="${esc(s.id)}" rows="2" ${s.status === 'generating' ? 'disabled' : ''} placeholder="Short description of this shot…">${esc(_shotPromptDrafts[s.id] != null ? _shotPromptDrafts[s.id] : customerShotLine(s))}</textarea>
                ${s.motion_warning ? `<div style="font-size:0.62rem;color:#FCD34D;margin:2px 0 6px;line-height:1.35;">${esc(s.motion_warning)}</div>` : ''}
                ${s.persist_warning ? `<div style="font-size:0.62rem;color:#FCD34D;margin:2px 0 6px;line-height:1.35;">${esc(s.persist_warning)}</div>` : ''}
                ${s.error ? `<div style="font-size:0.62rem;color:#FCA5A5;margin:2px 0 6px;line-height:1.35;">${esc(s.error)}</div>` : ''}
                <div class="anim-shot__overrides">
                  <select class="anim-select anim-shot-i2v" data-scene="${esc(s.id)}" title="I2V model" style="font-size:0.65rem;padding:4px 6px;">
                    <option value="">Motion: default</option>
                    <option value="seedance" ${shotI2v === 'seedance' ? 'selected' : ''}>Smooth</option>
                    <option value="kling" ${shotI2v === 'kling' ? 'selected' : ''}>Dynamic</option>
                    <option value="auto" ${shotI2v === 'auto' ? 'selected' : ''}>Auto</option>
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
                  <button type="button" class="anim-btn anim-btn--ghost anim-shot-save" data-scene="${esc(s.id)}" ${timelineBusy || !(s.video_url || s.keyframe_url) ? 'disabled' : ''} title="${s.video_url || s.keyframe_url ? 'Save clip and recipe for another video' : 'Generate this shot first'}">Save</button>
                  <button type="button" class="anim-btn anim-btn--ghost anim-shot-delete" data-scene="${esc(s.id)}" ${timelineBusy ? 'disabled' : ''} title="Remove this shot from the video">Delete</button>
                </div>
              </div>
            </div>`;
            }).join('')}
            ${savedShotsAllowed(p) ? savedShotsHtml({ disabled: timelineBusy || scenes.length >= ANIM_MAX_SCENES_UI }) : ''}
            <div class="anim-add-scene-wrap">
              <button type="button" class="anim-btn anim-btn--ghost" id="anim-add-scene" ${addReason ? 'disabled' : ''} title="${esc(addReason || 'Append a blank shot')}" style="width:100%;">+ Add scene</button>
              ${addReason ? `<div class="anim-add-scene-hint">${esc(addReason)}</div>` : ''}
            </div>`;
          })() : `
            <div class="anim-placeholder-row">${
              _briefing || p.status === 'briefing'
              ? 'Writing your shots — stay here. This can take a minute.'
              : (p.status === 'failed' || p.error)
              ? (p.error || 'Generation stopped. Upload a Char still on the right, then Retry.')
              : p.status === 'developing'
              ? 'Preparing your character…'
              : p.status === 'generating'
              ? 'Making your shots…'
              : p.status === 'character_review'
              ? 'Shots wait until you Approve character lock.'
              : brief?.shots?.length
              ? `Ready to generate ${brief.shots.length} shots — accept the brief, then approve the character lock.`
              : 'Shot cards will land on this timeline.'}</div>
            ${savedShotsAllowed(p) ? savedShotsHtml({ disabled: projectHasBusyScenes(p) || p.status === 'assembling' || (p.scenes || []).length >= ANIM_MAX_SCENES_UI }) : ''}
            ${brief?.shots?.length ? `<div class="anim-timeline anim-timeline--ghost">${brief.shots.map((s) => `
              <div class="anim-shot anim-shot--ghost"><div class="anim-shot__media">${
                _briefing || ['briefing', 'developing', 'generating', 'assembling'].includes(p.status)
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
      <div class="anim-section" data-nl="final">
        <div class="anim-section__label">Final</div>
        <div class="anim-final">
          ${showPlayer
            ? (/\.(mp4|webm|mov)(\?|$)/i.test(finalUrl) || readyShotUrls.length
              ? `<div class="anim-final__stage">
                  <video class="anim-final__video" src="${esc(mediaSrc(previewBaseUrl))}${esc(finalCacheBust)}" controls playsinline></video>
                  <div class="anim-safe-zone" id="anim-safe-zone" hidden aria-hidden="true"><span>Reels UI zone</span></div>
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
            <div class="anim-layers" role="group" aria-label="Include in final">
              ${(() => { const f = assembleFlags();
                const chip = (id, key, label, ready) => `
                <label class="anim-layer ${f[key] ? 'is-on' : ''}" title="${ready || ''}">
                  <input type="checkbox" id="${id}" ${f[key] ? 'checked' : ''}/>
                  <span>${label}</span>
                  ${ready ? `<em>${ready}</em>` : ''}
                </label>`;
                return [
                  chip('anim-flag-vo', 'vo', 'Voiceover', p.vo_script ? 'script' : ''),
                  chip('anim-flag-captions', 'captions', 'Captions', p.last_burned_caption_style ? 'styled' : ''),
                  chip('anim-flag-music', 'music', 'Music', p.music_bed_url ? 'ready' : ''),
                  chip('anim-flag-outro', 'outro', 'Outro', p.outro_url ? 'ready' : ''),
                ].join('');
              })()}
            </div>
            <div class="anim-lane-tabs" role="tablist" aria-label="Edit layer">
              ${['vo','captions','music','outro'].map((tab) => {
                const labels = { vo: 'Voiceover', captions: 'Captions', music: 'Music', outro: 'Outro' };
                const on = (_assembleTab || 'vo') === tab;
                return `<button type="button" class="anim-lane-tab ${on ? 'is-on' : ''}" role="tab" data-assemble-tab="${tab}" aria-selected="${on ? 'true' : 'false'}">${labels[tab]}</button>`;
              }).join('')}
            </div>

            <div class="anim-lane" data-lane="vo" ${(_assembleTab || 'vo') === 'vo' ? '' : 'hidden'}>
              <textarea id="anim-vo-script" class="anim-brief-edit anim-lane__primary" placeholder="What the voice says. Plain text, edit any time.">${esc(voText(p))}</textarea>
              <div class="anim-vo-save">
                <span class="anim-vo-save__state" id="anim-vo-state">${voDirty(p) ? 'Not saved' : (voSaved(p).trim() ? 'Saved' : '')}</span>
                <button type="button" class="anim-btn ${voDirty(p) ? 'is-lit' : 'anim-btn--ghost'}" id="anim-vo-save" ${voDirty(p) ? '' : 'disabled'}>Save</button>
              </div>
              <div class="anim-vo-tweak">
                <textarea id="anim-vo-direction" class="anim-brief-edit" rows="2" placeholder="${voSaved(p).trim() ? 'Describe your changes, like shorter, warmer, or end with a soft ask' : 'Describe the voiceover you want, or leave blank to write one from the shots'}">${esc(draftFor(_voDirDraft, p) != null ? draftFor(_voDirDraft, p) : '')}</textarea>
                ${voSaved(p).trim()
                  ? `<button type="button" class="anim-btn ${String(draftFor(_voDirDraft, p) || '').trim() ? 'is-lit' : 'anim-btn--ghost'}" id="anim-vo-generate" ${String(draftFor(_voDirDraft, p) || '').trim() ? '' : 'disabled'}>Tweak</button>`
                  : '<button type="button" class="anim-btn is-lit" id="anim-vo-generate">Write it</button>'}
              </div>
              <div class="anim-lane__actions">
                ${p.vo_script ? `<button type="button" class="anim-btn anim-btn--ghost" id="anim-vo-regen-fresh" title="Write a new script from the shots and your note">Fresh</button>
                <button type="button" class="anim-btn anim-btn--ghost" id="anim-vo-keep" title="Remember as a winner">Keep</button>
                <button type="button" class="anim-btn anim-btn--ghost" id="anim-vo-reject" title="Avoid this pattern">Skip</button>` : ''}
                <label class="anim-vol anim-vol--inline">
                  Vol
                  <input type="range" id="anim-vo-volume" min="0" max="100" step="1" value="${Math.round((p.vo_volume == null ? 1 : Number(p.vo_volume)) * 100)}" />
                  <span id="anim-vo-volume-val">${Math.round((p.vo_volume == null ? 1 : Number(p.vo_volume)) * 100)}%</span>
                </label>
              </div>
            </div>

            <div class="anim-lane" data-lane="captions" ${(_assembleTab || 'vo') === 'captions' ? '' : 'hidden'}>
              <label class="anim-cap-words"><span>What the captions say</span>
                <textarea id="anim-cap-words" class="anim-brief-edit" rows="3" placeholder="The captions show the voiceover's words">${esc(capText(p))}</textarea>
              </label>
              <p class="anim-lane__hint" style="margin:6px 0 8px;">Change the words on screen without changing the voice, like OPA on screen while the voice says O P A. They stay timed to the voice.</p>
              ${p.captions_out_of_date ? '<p class="anim-lane__warn" id="anim-cap-stale">These caption words were written for an earlier voiceover. Check them, or match the voiceover.</p>' : ''}
              <div class="anim-vo-save">
                <span class="anim-vo-save__state" id="anim-cap-state">${capDirty(p) ? 'Not saved' : (capSaved(p) ? 'Your own words' : 'Following the voiceover')}</span>
                ${capSaved(p) || capDirty(p) ? '<button type="button" class="anim-btn anim-btn--ghost" id="anim-cap-match">Match the voiceover</button>' : ''}
                <button type="button" class="anim-btn ${capDirty(p) ? 'is-lit' : 'anim-btn--ghost'}" id="anim-cap-words-save" ${capDirty(p) ? '' : 'disabled'}>Save</button>
              </div>
              <div class="anim-lane__actions">
                <button type="button" class="anim-btn anim-btn--ghost" id="anim-cap-open">${_captionStudioOpen ? 'Style ✓' : 'Style captions'}</button>
              </div>
              ${renderCaptionStudioPanel(p)}
            </div>

            <div class="anim-lane" data-lane="music" ${(_assembleTab || 'vo') === 'music' ? '' : 'hidden'}>
              <label class="anim-lane__label">Bed prompt</label>
              <textarea id="anim-music-prompt" class="anim-brief-edit anim-lane__primary" placeholder="e.g. warm lo-fi instrumental, soft pulse, no vocals">${esc(p.music_prompt || '')}</textarea>
              <div class="anim-lane__actions">
                <select id="anim-music-length" class="anim-select anim-select--compact" title="Length">
                  ${Array.from({ length: 12 }, (_, i) => (i + 1) * 15).map((s) => {
                    const ms = s * 1000;
                    const cur = Number(p.music_length_ms) || 30000;
                    const label = s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
                    return `<option value="${ms}" ${cur === ms ? 'selected' : ''}>${label}</option>`;
                  }).join('')}
                </select>
                <button type="button" class="anim-btn anim-btn--ghost" id="anim-music-generate" ${!(_meta?.providers?.elevenlabs_configured) ? 'disabled title="Music generation isn\'t enabled on this account"' : ''}>${p.music_bed_url ? 'Regen' : 'Generate'}</button>
                <label class="anim-vol anim-vol--inline">
                  Vol
                  <input type="range" id="anim-music-volume" min="0" max="100" step="1" value="${Math.round((p.music_volume == null ? 0.18 : Number(p.music_volume)) * 100)}" />
                  <span id="anim-music-volume-val">${Math.round((p.music_volume == null ? 0.18 : Number(p.music_volume)) * 100)}%</span>
                </label>
              </div>
              <label class="anim-lane__label">Or pick / upload</label>
              ${renderSavedPicker('music', p.music_bed_url)}
            </div>

            <div class="anim-lane" data-lane="outro" ${(_assembleTab || 'vo') === 'outro' ? '' : 'hidden'}>
              <label class="anim-lane__label">End card</label>
              <p class="anim-lane__hint">Pick a saved outro or upload one. Choose None to remove.</p>
              ${renderSavedPicker('outro', p.outro_url)}
              ${assembleFlags().outro && !p.outro_url ? `<div class="anim-lane__warn">Outro is on — attach a clip before Rebuild.</div>` : ''}
            </div>
          </div>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
            ${showPlayer ? `<button type="button" class="anim-btn anim-btn--ghost" id="anim-expand-final" style="width:auto;">Expand</button>` : ''}
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
            ${readyShotUrls.length && p.final_url ? `<button type="button" class="anim-btn anim-btn--ghost" id="anim-send-new-review" title="Mint a new Pending card even if one already exists">Send new to Review</button>` : ''}
            ${p.content_record_id
              ? `<div style="font-size:0.68rem;color:rgba(167,139,250,0.95);margin:8px 0 0;line-height:1.35;">Linked to Content Review — Rebuild updates the Pending card, or mints a new one after publish/delete.</div>`
              : (readyShotUrls.length
                ? `<div style="font-size:0.68rem;color:rgba(255,255,255,0.45);margin:8px 0 0;line-height:1.35;">Rebuild Final to add a Pending card in Content Review.</div>`
                : '')}
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

    bindStoryArcSection(el);
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
    el.querySelectorAll('.anim-shot-delete').forEach((btn) => {
      btn.addEventListener('click', () => deleteScene(btn.dataset.scene));
    });
    el.querySelectorAll('.anim-shot-save').forEach((btn) => {
      btn.addEventListener('click', () => saveScene(btn.dataset.scene));
    });
    el.querySelectorAll('[data-saved-shot]').forEach((btn) => {
      btn.addEventListener('click', () => addSavedShot(btn.getAttribute('data-saved-shot')));
    });
    document.getElementById('anim-add-scene')?.addEventListener('click', () => addScene());
    document.getElementById('anim-music-upload')?.addEventListener('click', () => document.getElementById('anim-music-file')?.click());
    document.getElementById('anim-outro-upload')?.addEventListener('click', () => document.getElementById('anim-outro-file')?.click());
    document.getElementById('anim-music-generate')?.addEventListener('click', () => generateMusicBed());
    document.querySelectorAll('[data-assemble-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-assemble-tab');
        if (!tab || tab === _assembleTab) return;
        _assembleTab = tab;
        renderCanvas();
      });
    });
    document.getElementById('anim-vo-generate')?.addEventListener('click', () => generateVoScript({ revise: true }));
    bindVoAndCaptionWords();
    document.getElementById('anim-vo-regen-fresh')?.addEventListener('click', () => generateVoScript({ revise: false }));
    document.getElementById('anim-vo-keep')?.addEventListener('click', () => rateVoScript('accept'));
    document.getElementById('anim-vo-reject')?.addEventListener('click', () => rateVoScript('reject'));
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
      _assembleTab = 'captions';
      _captionStudioOpen = !_captionStudioOpen;
      _canvasFp = '';
      renderCanvas();
      if (_captionStudioOpen) {
        const flag = document.getElementById('anim-flag-captions');
        if (flag) {
          flag.checked = true;
          flag.closest('.anim-layer')?.classList.add('is-on');
        }
      }
    });
    document.getElementById('anim-cap-close')?.addEventListener('click', () => {
      _captionStudioOpen = false;
      _assembleTab = 'captions';
      _canvasFp = '';
      renderCanvas();
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
      'anim-vo-script', 'anim-vo-direction',
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
    document.getElementById('anim-music-pick')?.addEventListener('change', async (e) => {
      await applyLibraryPick('music', e.target.value);
    });
    document.getElementById('anim-outro-pick')?.addEventListener('change', async (e) => {
      await applyLibraryPick('outro', e.target.value);
    });
    ['anim-outro-preview', 'anim-music-preview'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('mouseenter', () => { try { el.play(); } catch (_) {} });
      el.addEventListener('mouseleave', () => { try { el.pause(); el.currentTime = 0; } catch (_) {} });
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
      document.getElementById(id)?.addEventListener('change', (ev) => {
        if (_project) {
          _project.pipeline = _project.pipeline || {};
          _project.pipeline.assemble = assembleFlagsFromDom();
        }
        const lab = ev.target?.closest?.('.anim-layer');
        if (lab) lab.classList.toggle('is-on', !!ev.target.checked);
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
    document.getElementById('anim-rebuild-final')?.addEventListener('click', () => rebuildFinal());
    document.getElementById('anim-send-new-review')?.addEventListener('click', () => rebuildFinal({ forceNewContent: true }));
    document.getElementById('anim-open-review')?.addEventListener('click', () => {
      document.querySelector('[data-nav="content"]')?.click();
    });
  }

  function renderChat() {
    const logEl = document.getElementById('anim-chat-log');
    if (!logEl) return;
    const rawChat = _project?.chat || [];
    const chat = [];
    for (const m of rawChat) {
      const role = String(m?.role || '').toLowerCase();
      const prev = chat[chat.length - 1];
      const sameUser = role === 'user' && prev && String(prev.role || '').toLowerCase() === 'user'
        && String(prev.text || '').trim() === String(m.text || '').trim();
      if (sameUser) chat[chat.length - 1] = m;
      else chat.push(m);
    }
    const brief = _project?.agent_brief;
    // New look: stay where the client is reading unless something new arrived.
    const chatSig = `${(_project && _project.id) || ''}|${chat.length}|${(_project && _project.status) || ''}`;
    const keepScroll = nlOn() && logEl.dataset.sig === chatSig ? logEl.scrollTop : null;
    if (nlOn()) {
      logEl.innerHTML = nlThreadHtml(chat, brief);
      nlPlanBind(logEl);
      logEl.dataset.sig = chatSig;
      logEl.scrollTop = keepScroll != null ? keepScroll : logEl.scrollHeight;
    } else logEl.innerHTML = chat.map((m) => {
      const isAgent = m.role === 'agent' || m.role === 'system';
      return `<div class="anim-msg ${isAgent ? 'anim-msg--agent' : 'anim-msg--user'}">
        <div class="anim-msg__role">${esc(m.role === 'agent' ? 'AI · shots' : (m.role === 'user' ? 'Your idea' : m.role))}</div>
        <div class="anim-msg__text">${esc(m.text)}</div>
      </div>`;
    }).join('') || `<div class="anim-msg anim-msg--agent anim-msg--intro"><div class="anim-msg__role">AI · shots</div><div class="anim-msg__text">Describe one idea. I’ll turn it into separate shots — not copies of your prompt. Then you accept before anything generates.</div></div>`;

    const actions = document.getElementById('anim-brief-actions');
    if (actions) {
      if (_briefing || _project?.status === 'briefing') {
        actions.innerHTML = `<div class="anim-working" aria-busy="true">AI is writing the shots — stay here. This can take a minute.</div>`;
      } else if (_project?.status === 'failed' || _project?.error) {
        actions.innerHTML = `
          <div class="anim-brief-card">
            <div class="anim-brief-card__title">Needs a Char still</div>
            <div class="anim-brief-shot">${esc(_project.error || 'Upload a Character reference, tag it Char, then retry.')}</div>
            <div class="anim-brief-btns">
              <button type="button" class="anim-btn" id="anim-retry-generate">Retry</button>
            </div>
          </div>`;
        document.getElementById('anim-retry-generate')?.addEventListener('click', acceptBrief);
      } else if (_project?.status === 'brief_ready' && brief && nlOn()) {
        // New look: the plan lives in the thread's Shot plan section, editable there.
        actions.innerHTML = '';
      } else if (_project?.status === 'brief_ready' && brief) {
        const lines = (brief.shots || []).map((s, i) => {
          const line = customerShotLine(s) || s.title || `Shot ${i + 1}`;
          const said = nlOn() && s.vo_line ? `<q class="nl-tplan__vo">${esc(s.vo_line)}</q>` : '';
          const secs = nlOn() && s.duration_target ? ` <span class="anim-brief-shot-secs">${esc(String(s.duration_target))}s</span>` : '';
          return `<div class="anim-brief-shot-line"><strong>${i + 1}.</strong>${secs} ${esc(line)}${said}</div>`;
        }).join('');
        actions.innerHTML = `
          <div class="anim-brief-card">
            <div class="anim-brief-card__title">${(brief.shots || []).length || 0} shots from your idea</div>
            ${lines || '<div class="anim-brief-shot-line">No shots yet — try again.</div>'}
            <div class="anim-brief-btns">
              <button type="button" class="anim-btn" id="anim-accept">Accept & generate</button>
              <button type="button" class="anim-btn anim-btn--ghost" id="anim-rebrief">Try again</button>
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
        actions.innerHTML = `<div class="anim-working">Making your video — the canvas updates as each shot lands…</div>`;
      } else {
        actions.innerHTML = '';
      }
    }
    if (!nlOn()) logEl.scrollTop = logEl.scrollHeight;
    if (document.documentElement.classList.contains('nl')) {
      try { nlAnimLayout(false); } catch (e) { console.warn('[animate] new look layout', e); }
    }
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
        i2v_model: document.getElementById('anim-i2v')?.value || currentI2vModel() || 'seedance',
        driving_video_url: _project?.driving_video_url || null,
        references,
        reference_urls: references.map((r) => r.url),
        character_ref_url: references.find((r) => r.role === 'character')?.url || null,
      }),
    });
    _project = data.project;
    if (_pendingMusicUrl && !_project.music_bed_url) _project.music_bed_url = _pendingMusicUrl;
    await maybeAttachDefaultOutro();
    if (_project.outro_url || _project.music_bed_url) await syncMotionSettings();
    rememberOpenProject(_project?.id);
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
    toast('Trying a new shot plan…', 'info');
    await sendPrompt({ auto: true });
  }

  async function sendPrompt(opts = {}) {
    if (_busy) return;
    const ta = document.getElementById('anim-prompt');
    const entry = document.querySelector('#anim-entry-mode [data-entry].active')?.dataset.entry || readAnimEntry();
    const text = (ta?.value || '').trim();
    if (!text) return toast(entry === 'vo' ? 'Enter a voiceover script' : 'Enter a prompt', 'error');
    if (!_storyDraft?.story_type && opts.auto === true) {
      _storyDraft = Object.assign({}, _storyDraft, { story_type: _project?.story_brief?.story_type || 'auto' });
    }
    if (!_storyDraft?.story_type) {
      document.getElementById('anim-story-type')?.focus();
      return toast('Pick a story type (or "Let AI pick") — Meta rewards a clear format', 'error');
    }
    if (_refs.length && !_refs.some((r) => r.role === 'character')) {
      return toast('Tag one reference as Character (identity)', 'error');
    }
    _busy = true;
    _briefing = true;
    _project = Object.assign({}, _project || {}, {
      status: 'briefing',
      user_prompt: (_project && _project.user_prompt) || text,
      chat: ((_project && _project.chat) || []).concat([{ role: 'user', text, ts: new Date().toISOString() }]),
      agent_brief: (_project && _project.agent_brief) || { title: 'Writing shots…', shots: [] },
      scenes: (_project && _project.scenes) || [],
    });
    const sendBtn = document.getElementById('anim-send');
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending…';
    }
    renderCanvas();
    renderChat();
    try {
      await ensureProject();
      _project = Object.assign({}, _project, { status: 'briefing' });
      renderCanvas();
      renderChat();
      const mode = document.getElementById('anim-mode')?.value || 'video';
      const look = document.getElementById('anim-look')?.value || 'stylized';
      const motion_mode = document.getElementById('anim-motion')?.value || currentMotionMode();
      const references = refsPayload();
      _project.mode = mode;
      _project.look = look;
      _project.motion_mode = motion_mode;
      await syncMotionSettings();
      toast('Writing your shots…', 'info');
      const briefBody = {
        mode,
        look,
        references,
        reference_urls: references.map((r) => r.url),
        character_ref_url: references.find((r) => r.role === 'character')?.url || null,
        force_rewrite: true,
        format_template_id: _pendingFormatTemplateId || undefined,
        style_pack_id: _pendingStylePackId || undefined,
        story_brief: animStoryBriefFromDraft(),
      };
      if (entry === 'vo') {
        briefBody.vo_script = text;
        briefBody.prompt = null;
      } else {
        briefBody.prompt = text;
        const len = document.getElementById('anim-length');
        if (len && nlOn()) briefBody.length_seconds = Number(len.value) || 15;
      }
      if (nlOn()) nlPlanReset();
      const data = await animFetch(`/api/animation/projects/${_project.id}/brief`, {
        method: 'POST',
        body: JSON.stringify(briefBody),
      });
      _pendingFormatTemplateId = null;
      _pendingStylePackId = null;
      renderPendingPacks();
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
        toast('Shot plan looks unfinished — tap Try again', 'error');
      } else {
        toast('Shot plan ready — review, then Accept & generate', 'success');
      }
    } catch (e) {
      toast(e.message || 'Brief failed', 'error', e.request_id);
    } finally {
      _briefing = false;
      _busy = false;
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Write shots';
      }
      renderCanvas();
      renderChat();
    }
  }

  async function acceptBrief() {
    if (_busy || !_project?.id) return;
    _busy = true;
    _briefing = false;
    const hasChar = !!(_refs.some((r) => r.role === 'character')
      || (_project.references || []).some((r) => r && r.role === 'character')
      || _project.character_ref_url);
    _project = Object.assign({}, _project, {
      status: hasChar ? 'developing' : 'generating',
      error: null,
      identity_source: hasChar ? 'upload' : 't2v',
    });
    renderCanvas();
    renderChat();
    startPoll();
    try {
      const data = await animFetch(`/api/animation/projects/${_project.id}/approve-brief`, {
        method: 'POST',
        body: JSON.stringify({ agent_brief: _project.agent_brief || {} }),
      });
      _project = data.project;
      renderCanvas();
      renderChat();
      startPoll();
      toast(hasChar ? 'Generating character sheet…' : 'Generating shots as text-to-video…', 'success');
    } catch (e) {
      toast(e.message || 'Approve failed', 'error', e.request_id);
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
      toast(e.message || 'Character approve failed', 'error', e.request_id);
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
      toast(e.message || 'Add scene failed', 'error', e.request_id);
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
    const localPrompt = (shotControl(sceneId, '.anim-shot__prompt-edit')?.value
      || _shotPromptDrafts[sceneId]
      || scene.prompt
      || '').trim();
    if (localPrompt && !force) {
      const ok = window.confirm('Replace current prompt with AI draft?');
      if (!ok) return;
      return suggestScene(sceneId, { force: true });
    }
    const btn = shotControl(sceneId, '.anim-shot-suggest');
    const ta = shotControl(sceneId, '.anim-shot__prompt-edit');
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
      if (!resp.ok) throw apiError(data, resp);
      _project = data.project;
      const prompt = data.scene?.prompt || data.suggestion?.prompt || '';
      _shotPromptDrafts[sceneId] = prompt;
      _canvasFp = '';
      renderCanvas();
      toast('Draft prompt ready — edit or Generate', 'success');
      document.querySelector(`.anim-shot__prompt-edit[data-scene="${sceneId}"]`)?.focus();
    } catch (e) {
      toast(e.message || 'Suggest failed', 'error', e.request_id);
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
      toast(e.message || 'Reorder failed', 'error', e.request_id);
    } finally {
      _busy = false;
    }
  }

  async function deleteScene(sceneId) {
    if (!_project?.id || !sceneId || _busy) return;
    if (projectHasBusyScenes(_project) || _project.status === 'assembling') {
      return toast('Wait for shots to finish before deleting', 'info');
    }
    if (!window.confirm('Remove this shot from the video?')) return;
    _busy = true;
    try {
      const data = await animFetch(`/api/animation/projects/${_project.id}/scenes/${encodeURIComponent(sceneId)}`, {
        method: 'DELETE',
      });
      _project = data.project;
      delete _shotPromptDrafts[sceneId];
      _canvasFp = '';
      renderCanvas();
      toast('Shot removed', 'success');
    } catch (e) {
      toast(e.message || 'Delete failed', 'error', e.request_id);
    } finally {
      _busy = false;
    }
  }

  async function saveScene(sceneId) {
    if (!_project?.id || !sceneId || _busy) return;
    const scene = (_project.scenes || []).find((s) => s.id === sceneId);
    if (!scene) return;
    if (!scene.video_url && !scene.keyframe_url) {
      return toast('Generate this shot or keep a keyframe before saving', 'error');
    }
    _busy = true;
    try {
      const data = await animFetch(`/api/animation/projects/${_project.id}/scenes/${encodeURIComponent(sceneId)}/save`, {
        method: 'POST',
        body: '{}',
      });
      if (Array.isArray(data.assets)) _library = data.assets;
      else await refreshLibrary({ silent: true });
      _canvasFp = '';
      renderCanvas();
      toast(data.deduped ? 'Already in Saved shots' : 'Saved — still on this video. Add it to another project from Saved shots.', 'success');
    } catch (e) {
      toast(e.message || 'Save failed', 'error', e.request_id);
    } finally {
      _busy = false;
    }
  }

  async function addSavedShot(assetId) {
    if (!_project?.id || !assetId || _busy) return;
    if (!savedShotsAllowed(_project)) {
      return toast('Wait until shots are on the timeline before adding a saved shot', 'info');
    }
    if (projectHasBusyScenes(_project) || _project.status === 'assembling') {
      return toast('Wait for shots to finish before adding a saved shot', 'info');
    }
    _busy = true;
    try {
      const data = await animFetch(`/api/animation/projects/${_project.id}/scenes/from-saved`, {
        method: 'POST',
        body: JSON.stringify({ asset_id: assetId }),
      });
      _project = data.project;
      const newId = data.scene?.id;
      if (newId) _shotPromptDrafts[newId] = data.scene.prompt || '';
      _canvasFp = '';
      renderCanvas();
      const ready = data.scene && data.scene.status === 'ready' && data.scene.video_url;
      toast(ready
        ? 'Saved clip added. Rebuild Final to include it. Regenerate only if you want a new take.'
        : 'Recipe added as a draft — write or Generate. Character lock on this project applies.', 'success');
    } catch (e) {
      toast(e.message || 'Could not add that saved shot', 'error', e.request_id);
    } finally {
      _busy = false;
    }
  }

  async function regenScene(sceneId) {
    if (!_project?.id || !sceneId || _busy) return;
    const scene = (_project.scenes || []).find((s) => s.id === sceneId);
    if (scene?.status === 'generating') return toast('This shot is already generating — hang tight', 'info');
    const promptEdit = (shotControl(sceneId, '.anim-shot__prompt-edit')?.value
      || _shotPromptDrafts[sceneId]
      || customerShotLine(scene)
      || '').trim();
    if (!promptEdit) return toast('Describe what happens in this shot first', 'error');
    _busy = true;
    try {
      toast('Remaking this shot…', 'info');
      const references = refsPayload();
      const shotI2v = shotControl(sceneId, '.anim-shot-i2v')?.value || '';
      const shotTpl = shotControl(sceneId, '.anim-shot-template')?.value || '';
      _shotPromptDrafts[sceneId] = promptEdit;
      const data = await animFetch(`/api/animation/projects/${_project.id}/scenes/${sceneId}/regenerate`, {
        method: 'POST',
        body: JSON.stringify({
          action: promptEdit,
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
      if (updated) _shotPromptDrafts[sceneId] = customerShotLine(updated) || promptEdit;
      renderCanvas();
      startPoll();
      toast(data.started ? 'Shot regenerating — canvas will update when ready' : 'Shot updated', 'success');
    } catch (e) {
      toast(e.message || 'Regen failed', 'error', e.request_id);
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

  async function applyLibraryPick(kind, id) {
    if (!_project) return;
    const url = assetHelpers().selectedUrl(assetHelpers().filterKind(_library, kind), id) || null;
    if (kind === 'music') _project.music_bed_url = url;
    if (kind === 'outro') _project.outro_url = url;
    await syncMotionSettings();
    renderCanvas();
  }

  async function uploadProjectAsset(file, kind) {
    if (!_project?.id || !file) return;
    toast(`Uploading ${kind}…`, 'info');
    try {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('name', String(file.name || kind).replace(/\.[^.]+$/, ''));
      fd.append('file', file);
      const res = await fetch(`${apiBase()}/api/assets`, {
        method: 'POST',
        headers: authHeadersMultipart(),
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.asset?.url) throw apiError(data, res, 'Upload failed');
      _library = Array.isArray(data.assets) ? data.assets : _library;
      if (kind === 'music') _project.music_bed_url = data.asset.url;
      if (kind === 'outro') _project.outro_url = data.asset.url;
      await syncMotionSettings();
      renderCanvas();
      toast(`${kind === 'music' ? 'Music bed' : 'Outro'} saved to the library`, 'success');
    } catch (e) {
      toast(e.message || 'Upload failed', 'error', e.request_id);
    }
  }

  /** The Save buttons and the Tweak button light up when there is something to do. */
  function paintWordButtons() {
    const p = _project;
    if (!p) return;
    const vs = document.getElementById('anim-vo-save');
    const vst = document.getElementById('anim-vo-state');
    if (vs) { const d = voDirty(p); vs.disabled = !d; vs.classList.toggle('is-lit', d); vs.classList.toggle('anim-btn--ghost', !d); }
    if (vst) vst.textContent = voDirty(p) ? 'Not saved' : (voSaved(p).trim() ? 'Saved' : '');
    const tw = document.getElementById('anim-vo-generate');
    if (tw && voSaved(p).trim()) {
      const has = !!String(document.getElementById('anim-vo-direction')?.value || '').trim();
      tw.disabled = !has || _busy;
      tw.classList.toggle('is-lit', has);
      tw.classList.toggle('anim-btn--ghost', !has);
    }
    const cs = document.getElementById('anim-cap-words-save');
    const cst = document.getElementById('anim-cap-state');
    if (cs) { const d = capDirty(p); cs.disabled = !d; cs.classList.toggle('is-lit', d); cs.classList.toggle('anim-btn--ghost', !d); }
    if (cst) cst.textContent = capDirty(p) ? 'Not saved' : (capSaved(p) ? 'Your own words' : 'Following the voiceover');
  }

  function bindVoAndCaptionWords() {
    const p = _project;
    if (!p) return;
    const vo = document.getElementById('anim-vo-script');
    vo?.addEventListener('input', () => { _voDraft = { pid: p.id, text: vo.value }; paintWordButtons(); });
    const dir = document.getElementById('anim-vo-direction');
    dir?.addEventListener('input', () => { _voDirDraft = { pid: p.id, text: dir.value }; paintWordButtons(); });
    dir?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && dir.value.trim()) { e.preventDefault(); generateVoScript({ revise: true }); }
    });
    document.getElementById('anim-vo-save')?.addEventListener('click', () => saveWords({ vo: true }));
    const cap = document.getElementById('anim-cap-words');
    cap?.addEventListener('input', () => { _capDraft = { pid: p.id, text: cap.value }; paintWordButtons(); });
    document.getElementById('anim-cap-words-save')?.addEventListener('click', () => saveWords({ captions: true }));
    document.getElementById('anim-cap-match')?.addEventListener('click', () => saveWords({ captions: true, match: true }));
    paintWordButtons();
  }

  /** Save the voiceover words and/or the caption words now, without rebuilding. */
  async function saveWords({ vo = false, captions = false, match = false } = {}) {
    const p = _project;
    if (!p?.id) return;
    const body = {};
    if (vo) body.vo_script = voText(p);
    if (captions) body.caption_script = match ? '' : capText(p);
    try {
      const data = await animFetch(`/api/animation/projects/${p.id}/settings`, { method: 'POST', body: JSON.stringify(body) });
      if (data.project) _project = data.project;
      if (vo) _voDraft = null;
      if (captions) _capDraft = null;
      renderCanvas();
      toast(captions
        ? (match ? 'Captions follow the voiceover again. Rebuild to see them.' : 'Caption words saved. Rebuild to see them in the video.')
        : 'Voiceover saved. Rebuild to record it.', 'success');
    } catch (e) {
      toast(e.message || 'Could not save', 'error', e.request_id);
    }
  }

  async function generateVoScript({ revise = true } = {}) {
    if (!_project?.id || _busy) return;
    const direction = String(document.getElementById('anim-vo-direction')?.value || '').trim();
    const current = String(document.getElementById('anim-vo-script')?.value || voText(_project) || '').trim();
    const useDraft = revise && !!current;
    _busy = true;
    const btn = document.getElementById('anim-vo-generate');
    const freshBtn = document.getElementById('anim-vo-regen-fresh');
    if (btn) btn.disabled = true;
    if (freshBtn) freshBtn.disabled = true;
    try {
      toast(useDraft
        ? (direction ? 'Applying your VO tweak…' : 'Tightening the current VO…')
        : (direction ? 'Writing VO from your direction…' : 'Writing voiceover from shots and brand voice…'), 'info');
      const data = await animFetch(`/api/animation/projects/${_project.id}/generate-vo`, {
        method: 'POST',
        body: JSON.stringify({
          direction,
          vo_direction: direction,
          vo_script: useDraft ? current : '',
        }),
      });
      _project = data.project || _project;
      if (data.vo_script) _project.vo_script = data.vo_script;
      if (data.vo_direction != null) _project.vo_direction = data.vo_direction;
      else _project.vo_direction = direction;
      // The new words replace the box; the change request is done.
      _voDraft = null;
      _voDirDraft = null;
      renderCanvas();
      const visionHint = data.vision_count ? ` · saw ${data.vision_count} keyframe${data.vision_count === 1 ? '' : 's'}` : '';
      toast(`${data.revised ? 'VO tweaked' : 'VO ready'}${visionHint} — edit more or Rebuild final`, 'success');
    } catch (e) {
      toast(e.message || 'VO generation failed', 'error', e.request_id);
    } finally {
      _busy = false;
      if (btn) btn.disabled = false;
      if (freshBtn) freshBtn.disabled = false;
    }
  }

  async function rateVoScript(feedback) {
    if (!_project?.id || _busy) return;
    const script = String(document.getElementById('anim-vo-script')?.value || _project.vo_script || '').trim();
    if (!script) return toast('No VO script to rate', 'error');
    _busy = true;
    try {
      const data = await animFetch(`/api/animation/projects/${_project.id}/generate-vo`, {
        method: 'POST',
        body: JSON.stringify({ feedback, vo_script: script }),
      });
      _project = data.project || _project;
      toast(feedback === 'accept' ? 'Saved as a winning VO pattern' : 'Noted — will avoid this pattern', 'success');
      if (feedback === 'reject') {
        // Clear so they can regen cleanly
        const el = document.getElementById('anim-vo-script');
        if (el) el.value = '';
        _project.vo_script = '';
        renderCanvas();
      }
    } catch (e) {
      toast(e.message || 'Could not save VO feedback', 'error', e.request_id);
    } finally {
      _busy = false;
    }
  }

  async function generateMusicBed() {
    if (!_project?.id || _busy) return;
    if (!_meta?.providers?.elevenlabs_configured) {
      return toast("Music generation isn't enabled on this account.", 'error');
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
      toast(e.message || 'Music generation failed', 'error', e.request_id);
    } finally {
      _busy = false;
      if (btn) btn.disabled = false;
    }
  }

  async function rebuildFinal({ forceNewContent = false } = {}) {
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
        forceNewContent
          ? `Building Final + new Content Review card (${clipHint}, ${capHint})…`
          : forceRetry
            ? `Retrying Final (${clipHint}, ${capHint})…`
            : `Building Final (${clipHint}, ${capHint})…`,
        'info'
      );
      const data = await animFetch(`/api/animation/projects/${projectId}/assemble`, {
        method: 'POST',
        body: JSON.stringify({
          create_content: true,
          force_new_content: !!forceNewContent,
          force: forceRetry,
          assemble: flags,
          // Only send style when burning — avoids any "style present ⇒ burn" coupling.
          ...(flags.captions ? { caption_style: style } : {}),
          caption_text: '',
          vo_script: voText(_project) || '',
          ...(capDirty(_project) ? { caption_script: capText(_project) } : {}),
          music_volume: document.getElementById('anim-music-volume')
            ? Math.max(0, Math.min(1, Number(document.getElementById('anim-music-volume').value) / 100))
            : (_project.music_volume ?? 0.18),
          vo_volume: document.getElementById('anim-vo-volume')
            ? Math.max(0, Math.min(1, Number(document.getElementById('anim-vo-volume').value) / 100))
            : (_project.vo_volume ?? 1),
        }),
      });
      // Keep local assemble flags so remount during assemble doesn't re-check Captions.
      if (_project) {
        _project.pipeline = _project.pipeline || {};
        _project.pipeline.assemble = { ...flags };
      }
      // Keep the open project — never bounce to Home while assemble runs.
      _project = data.project || _project;
      _voDraft = null;
      _capDraft = null;
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
      toast(e.message || 'Assemble failed', 'error', e.request_id);
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
      toast(e.message || 'Could not switch take', 'error', e.request_id);
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
      toast(e.message || 'Could not restore Final', 'error', e.request_id);
      throw e;
    } finally {
      _busy = false;
    }
  }

  function renderRefs() {
    renderRefsInner();
    if (nlOn()) { const r = document.querySelector('.anim-shell .nl-anim'); if (r) nlBriefSummary(r); }
  }
  function renderRefsInner() {
    const box = document.getElementById('anim-refs');
    if (!box) return;
    if (!_refs.length) {
      box.innerHTML = `<div class="anim-refs-empty">Add refs and tag roles: Char = one person, Item = object, Setting = group of people (family, friends, classroom), Scene = place, Style = look</div>`;
      return;
    }
    box.innerHTML = _refs.map((r, i) => `
      <div class="anim-ref-card">
        <div class="anim-ref-chip" title="${esc(r.title || r.url)}">
          <img src="${esc(mediaSrc(r.url))}" alt="" />
          <button type="button" class="anim-ref-x" data-i="${i}" aria-label="Remove">×</button>
        </div>
        <span class="anim-ref-name">${esc(r.title || 'Reference')}</span>
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
      const res = await fetch(`${apiBase()}/api/studio/upload-image`, {
        method: 'POST',
        headers: authHeadersMultipart(),
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw apiError(data, res, 'Upload failed');
      if (data.durable === false || /\/api\/media\//i.test(String(data.url))) {
        throw new Error("Upload didn't finish saving. Try again in a moment.");
      }
      const role = defaultRefRole();
      _refs.push({ url: data.url, title: file.name || 'Upload', role });
      renderRefs();
      toast(`Added as ${role}`, 'success');
    } catch (e) {
      toast(e.message || 'Upload failed', 'error', e.request_id);
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
    _briefing = false;
    _project = null;
    _refs = [];
    rememberOpenProject('');
    _recentLoading = true;
    resetComposeDefaults();
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

  const STYLE_PACK_LOOK = {
    'flat-vector-explainer': 'stylized',
    'cinematic-realistic': 'realistic',
    'paper-cut-collage': 'cartoon',
  };
  const STYLE_PACK_LABEL = {
    'flat-vector-explainer': 'Flat vector explainer',
    'cinematic-realistic': 'Cinematic realistic',
    'paper-cut-collage': 'Paper-cut collage',
  };
  const FORMAT_TEMPLATE_LABEL = {
    'awareness-15s': 'Awareness 15s',
    'mythbust-20s': 'Myth-bust 20s',
    'remix-24s': 'Remix 24s',
  };

  function renderPendingPacks() {
    const el = document.getElementById('anim-pending-packs');
    if (!el) return;
    const styleId = _pendingStylePackId;
    const formatId = _pendingFormatTemplateId;
    if (!styleId && !formatId) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    const styleLabel = STYLE_PACK_LABEL[styleId] || styleId || null;
    const formatLabel = FORMAT_TEMPLATE_LABEL[formatId] || formatId || null;
    const bits = [];
    if (styleLabel) bits.push(`Style: ${esc(styleLabel)}`);
    if (formatLabel) bits.push(`Format: ${esc(formatLabel)}`);
    el.style.display = 'flex';
    el.innerHTML = `<span style="font-size:0.68rem;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:rgba(196,181,253,0.85);">${bits.join(' · ')}</span><span style="font-size:0.65rem;color:rgba(255,255,255,0.4);margin-left:8px;">Applied on Accept</span>`;
  }

  async function applyAnimRemixSessionIfAny() {
    const s = window.__SE_ANIM_REMIX_SESSION;
    // Still-backed remix OR prompt-only charity Video → Animate recipe handoff
    if (!s || (!s.referenceUrl && !String(s.prompt || '').trim())) return false;
    window.__SE_ANIM_REMIX_SESSION = null;
    const modeEl = document.getElementById('anim-mode');
    if (modeEl) modeEl.value = 'video';
    const entry = s.entry === 'prompt' || !s.referenceUrl ? 'prompt' : 'vo';
    writeAnimEntry(entry);
    applyAnimEntryUI(entry);
    if (s.referenceUrl) {
      _refs = [{ url: s.referenceUrl, title: 'Remix still', role: 'character' }];
      renderRefs();
    }
    const ta = document.getElementById('anim-prompt');
    if (ta) ta.value = s.prompt || '';
    _pendingFormatTemplateId = s.format_template_id || 'remix-24s';
    if (s.style_pack_id) _pendingStylePackId = s.style_pack_id;
    // Sync Look dropdown to the style pack's look so Settings matches what Accept sends.
    const lookFromPack = STYLE_PACK_LOOK[s.style_pack_id];
    const lookEl = document.getElementById('anim-look');
    if (lookEl && lookFromPack) lookEl.value = lookFromPack;
    const settings = document.querySelector('.anim-chat-settings');
    if (settings && s.kind === 'charity_recipe') settings.open = true;
    renderPendingPacks();
    const kindLabel = s.kind === 'charity_recipe' ? 'Explainer recipe' : 'Remix';
    toast(kindLabel + ' loaded in Reels. Review the brief, then Accept.', 'success');
    // Prompt-only charity handoff: seed the composer; do not auto-brief until they Accept.
    if (s.kind === 'charity_recipe' || (!s.referenceUrl && String(s.prompt || '').trim())) {
      return true;
    }
    await sendPrompt({ auto: true });
    return true;
  }
  window.applyAnimRemixSessionIfAny = applyAnimRemixSessionIfAny;

  async function applyAnimCoachCreateSessionIfAny() {
    const s = window.__SE_COACH_CREATE_SESSION;
    const ta = document.getElementById('anim-prompt');
    const apply = typeof window.applyCoachCreateFields === 'function' ? window.applyCoachCreateFields : null;
    const result = apply ? apply(s, { animPrompt: ta }) : { applied: false, keep: true };
    if (!result.applied) return false;
    if (!ta) return false;
    const already = ta.value === result.animPrompt;
    ta.value = result.animPrompt;
    if (result.entry === 'vo') {
      writeAnimEntry(result.entry);
      applyAnimEntryUI(result.entry);
    } else {
      writeAnimEntry('prompt');
      applyAnimEntryUI('prompt');
    }
    if (result.format_template_id) _pendingFormatTemplateId = result.format_template_id;
    const nextRefs = [];
    const seen = new Set();
    const pushRef = (url, title, role) => {
      const u = String(url || '').trim();
      if (!u || seen.has(u)) return;
      seen.add(u);
      nextRefs.push({ url: u, title: title || 'Coach ref', role });
    };
    const tagged = Array.isArray(result.references) ? result.references : [];
    if (tagged.length) {
      tagged.forEach((r) => pushRef(r.url, r.name || r.title || 'Library ref', r.role || 'scene'));
    } else {
      if (result.attached_image_url) {
        pushRef(result.attached_image_url, (s && s.product_name) || 'Coach ref', 'character');
      }
      const extras = Array.isArray(result.ref_image_urls) ? result.ref_image_urls : [];
      extras.forEach((url, i) => {
        const role = nextRefs.some((r) => r.role === 'character') ? 'scene' : (i === 0 ? 'character' : 'scene');
        pushRef(url, 'Collection still', role);
      });
    }
    if (nextRefs.length) {
      _refs = nextRefs.slice(0, 8);
      renderRefs();
    }
    if (result.outro_url) _pendingOutroUrl = result.outro_url;
    if (result.music_bed_url) _pendingMusicUrl = result.music_bed_url;
    if (_project) {
      if (result.outro_url) _project.outro_url = result.outro_url;
      if (result.music_bed_url) _project.music_bed_url = result.music_bed_url;
      if (_project.id && (result.outro_url || result.music_bed_url)) await syncMotionSettings();
    }
    if (result.missing_outro) toast(result.missing_outro, 'error');
    if (!already) toast('Coach brief loaded in Reels. Review it, then Write shots.', 'success');
    return true;
  }
  window.applyAnimCoachCreateSessionIfAny = applyAnimCoachCreateSessionIfAny;

  window.renderAnimationStudio = async function renderAnimationStudio(data) {
    window.__clientData = data || window.__clientData || window.clientData;
    const storyPreset = window.__SE_ANIM_STORY_PRESET;
    if (storyPreset && storyPreset.story_type) {
      window.__SE_ANIM_STORY_PRESET = null;
      _storyDraft = Object.assign({}, _storyDraft, { story_type: storyPreset.story_type });
    }
    window.__clientEmail = window.clientEmail || window.__clientEmail || '';
    window.API = typeof API !== 'undefined' ? API : window._seAPI;

    const remixSession = window.__SE_ANIM_REMIX_SESSION;
    const coachSession = window.__SE_COACH_CREATE_SESSION;
    if (remixSession && remixSession.referenceUrl) {
      _project = null;
      stopPoll();
    }
    if (coachSession && coachSession.prompt && coachSession.destination === 'animate') {
      _project = null;
      stopPoll();
    }

    const root = document.getElementById('dash-content');
    if (!root) return;
    root.classList.add('dash-content--animate');

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
      if (['developing', 'generating', 'assembling'].includes(_project.status) || projectHasBusyScenes(_project) || projectChecking(_project)) {
        startPoll();
      }
      // Reels and Storyboard share this studio: show the one that was picked.
      if (window.SEStory) {
        try { window.SEStory.setSurface(window.__SE_CREATE_SURFACE === 'storyboard'); } catch (e) { console.warn('[animate] story builder', e); }
      }
      return;
    }

    // Kick project list immediately (don't wait on meta) — home felt empty for ~30s otherwise.
    const recentPromise = (!_project || !_recent.length)
      ? ((_recentLoading = true), refreshRecent({ silent: true }))
      : Promise.resolve();
    const libraryPromise = refreshLibrary({ silent: true });

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
          <div style="color:#F87171;font-weight:700;margin-bottom:8px;">Reels is briefly unavailable</div>
          <div style="color:rgba(255,255,255,0.65);font-size:0.85rem;line-height:1.45;margin-bottom:14px;">${esc(lastErr?.message || 'Failed to fetch')} — usually a short restart. Wait about 30 seconds and retry.</div>
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
        #dash-content.dash-content--animate { padding: 0; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
        /* Compact Create chrome (~88px). Wider Coach; stage shares the rest. */
        .anim-shell.atelier-shell { display:grid; grid-template-columns: minmax(0,1fr) minmax(380px,42%); gap:0; height:calc(100vh - var(--create-chrome-h, 88px)); min-height:420px; max-height:calc(100vh - var(--create-chrome-h, 88px)); border:none; border-radius:0; overflow:hidden; background:#070b14; flex:1 1 auto; }
        .anim-canvas.atelier-stage { display:flex; flex-direction:column; min-width:0; min-height:0; height:100%; border-right:1px solid rgba(255,255,255,0.06); background:radial-gradient(ellipse at 40% 0%,rgba(124,58,237,0.06),transparent 45%),#070b14; }
        .anim-canvas-header { display:flex; align-items:center; justify-content:space-between; padding:10px 16px; border-bottom:1px solid rgba(255,255,255,0.06); flex-shrink:0; background:rgba(8,12,22,0.65); }
        .anim-canvas-header h2 { margin:0; font-family:var(--font-display); font-size:0.95rem; color:#fff; font-weight:700; letter-spacing:-0.02em; }
        .anim-canvas-body { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; padding:14px 16px 28px; -webkit-overflow-scrolling:touch; }
        .anim-chat.atelier-inspector { display:flex; flex-direction:column; min-width:0; min-height:0; height:100%; overflow:hidden; background:rgba(10,14,24,0.98); }
        .anim-chat-header { padding:12px 16px 10px; border-bottom:1px solid rgba(255,255,255,0.06); flex-shrink:0; }
        .anim-chat-header h3 { margin:0 0 2px; font-size:0.62rem; font-weight:700; color:rgba(255,255,255,0.38); text-transform:uppercase; letter-spacing:0.1em; }
        .anim-chat-header p { margin:0; font-size:0.72rem; color:rgba(255,255,255,0.45); line-height:1.35; }
        .anim-chat-body { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; display:flex; flex-direction:column; scrollbar-gutter:stable; scrollbar-width:thin; scrollbar-color:rgba(167,139,250,0.45) rgba(255,255,255,0.04); }
        .anim-chat-body::-webkit-scrollbar { width:8px; }
        .anim-chat-body::-webkit-scrollbar-track { background:rgba(255,255,255,0.04); border-radius:8px; }
        .anim-chat-body::-webkit-scrollbar-thumb { background:rgba(167,139,250,0.4); border-radius:8px; }
        .anim-chat-log { flex:0 0 auto; padding:12px 16px; display:flex; flex-direction:column; gap:10px; }
        .anim-chat-compose { padding:12px 14px 14px; border-top:1px solid rgba(255,255,255,0.07); flex:0 0 auto; background:linear-gradient(180deg, rgba(15,23,42,0.96), #0B1220); display:flex; flex-direction:column; gap:0; }
        .anim-chat-settings { margin:0 0 10px; border:1px solid rgba(255,255,255,0.07); border-radius:10px; background:rgba(255,255,255,0.015); }
        .anim-chat-settings > summary { cursor:pointer; list-style:none; padding:9px 12px; font-size:0.72rem; font-weight:700; color:#CBD5E1; }
        .anim-chat-settings > summary::-webkit-details-marker { display:none; }
        .anim-chat-settings > summary::after { content:'▸'; float:right; color:rgba(255,255,255,0.35); font-size:0.7rem; }
        .anim-chat-settings[open] > summary::after { content:'▾'; }
        .anim-chat-settings[open] > summary { border-bottom:1px solid rgba(255,255,255,0.06); }
        .anim-chat-settings__body { padding:10px 12px 12px; max-height:min(240px, 28vh); overflow-y:auto; }
        .anim-chat-send { flex:0 0 auto; padding-top:8px; }
        .anim-drawer { margin-top:8px; border:1px solid rgba(255,255,255,0.07); border-radius:10px; background:rgba(255,255,255,0.015); }
        .anim-drawer > summary { cursor:pointer; list-style:none; padding:9px 12px; font-size:0.7rem; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:rgba(226,232,240,0.75); }
        .anim-drawer > summary::-webkit-details-marker { display:none; }
        .anim-drawer > summary::after { content:'▸'; float:right; color:rgba(255,255,255,0.3); text-transform:none; letter-spacing:0; }
        .anim-drawer[open] > summary::after { content:'▾'; }
        .anim-drawer[open] > summary { border-bottom:1px solid rgba(255,255,255,0.06); }
        .anim-drawer__body { padding:10px 12px 12px; }
        .anim-brief-card { padding:12px; margin:0 0 12px; border-radius:12px; border:1px solid rgba(167,139,250,0.35); background:rgba(124,58,237,0.1); }
        .anim-brief-card__title { font-size:0.85rem; font-weight:700; color:#F8FAFC; margin-bottom:8px; }
        .anim-brief-shot-line { font-size:0.78rem; color:#E2E8F0; line-height:1.4; padding:7px 0; border-top:1px solid rgba(255,255,255,0.06); }
        .anim-brief-shot-line:first-of-type { border-top:none; }
        .anim-brief-btns { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
        .anim-brief-btns .anim-btn { width:auto; flex:1; min-width:120px; }
        .anim-row { display:flex; gap:8px; margin-bottom:8px; }
        .anim-select { flex:1; background:#1E293B; border:1px solid rgba(255,255,255,0.1); color:#E2E8F0; border-radius:8px; padding:8px 10px; font-size:0.78rem; font-family:inherit; }
        .anim-prompt { width:100%; min-height:110px; max-height:min(280px, 36vh); resize:none; overflow-y:auto; field-sizing:content; background:#111827; border:1px solid rgba(255,255,255,0.1); color:#F8FAFC; border-radius:12px; padding:12px 14px; font-size:0.88rem; line-height:1.45; font-family:inherit; margin:0 0 8px; box-sizing:border-box; }
        .anim-prompt:focus { outline:none; border-color:rgba(167,139,250,0.55); box-shadow:0 0 0 3px rgba(124,58,237,0.12); }
        .anim-story { display:flex; flex-direction:column; gap:6px; margin:0 0 8px; }
        .anim-story .anim-select { width:100%; }
        .anim-story__why { border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:6px 10px; background:rgba(255,255,255,0.02); }
        .anim-story__why summary { cursor:pointer; font-size:0.72rem; font-weight:600; color:#CBD5E1; }
        .anim-story__why summary em { font-style:normal; font-weight:400; color:rgba(255,255,255,0.4); margin-left:4px; }
        .anim-story__field { display:block; margin-top:6px; }
        .anim-story__field span { display:block; font-size:0.62rem; color:rgba(255,255,255,0.5); margin-bottom:2px; }
        .anim-story__field input { width:100%; box-sizing:border-box; background:#111827; border:1px solid rgba(255,255,255,0.1); color:#F8FAFC; border-radius:8px; padding:6px 8px; font-size:0.75rem; font-family:inherit; }
        .anim-story__nudge { text-align:left; font-size:0.66rem; line-height:1.35; color:#FCD34D; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.3); border-radius:8px; padding:6px 8px; cursor:pointer; font-family:inherit; }
        .anim-arc { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; }
        .anim-arc__row span { display:block; font-size:0.62rem; color:rgba(255,255,255,0.5); margin-bottom:2px; }
        .anim-arc__row textarea { width:100%; box-sizing:border-box; resize:vertical; background:#111827; border:1px solid rgba(255,255,255,0.1); color:#F8FAFC; border-radius:8px; padding:6px 8px; font-size:0.74rem; line-height:1.4; font-family:inherit; }
        @media (max-width: 720px) { .anim-arc { grid-template-columns:1fr; } }
        .anim-refs { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:8px; min-height:28px; }
        .anim-refs-empty { font-size:0.7rem; color:rgba(255,255,255,0.3); padding:4px 0; line-height:1.4; }
        .anim-ref-card { display:flex; flex-direction:column; gap:4px; width:72px; }
        .anim-ref-name { display:none; }
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
        .anim-saved-shots { margin:8px 0 12px; }
        .anim-saved-shots__hint { font-size:0.68rem; color:rgba(148,163,184,0.85); margin:0 0 8px; line-height:1.35; }
        .anim-saved-shots__row { display:flex; gap:8px; overflow-x:auto; padding-bottom:4px; }
        .anim-saved-shot { width:88px; flex:0 0 auto; padding:0; border:1px solid rgba(255,255,255,0.1); border-radius:10px; background:rgba(255,255,255,0.04); color:#F1F5F9; cursor:pointer; }
        .anim-saved-shot:disabled { opacity:0.45; cursor:not-allowed; }
        .anim-saved-shot img, .anim-saved-shot video { width:100%; aspect-ratio:9/16; object-fit:cover; display:block; border-radius:10px 10px 0 0; background:#0F172A; }
        .anim-saved-shot span { display:block; font-size:0.62rem; padding:5px 6px 6px; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.anim-layers { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
        .anim-layer { display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:999px; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.03); font-size:0.68rem; color:rgba(255,255,255,0.55); cursor:pointer; user-select:none; }
        .anim-layer input { accent-color:#A78BFA; margin:0; }
        .anim-layer.is-on { border-color:rgba(167,139,250,0.45); background:rgba(124,58,237,0.16); color:#F1F5F9; }
        .anim-layer em { font-style:normal; font-size:0.58rem; letter-spacing:0.04em; text-transform:uppercase; color:rgba(167,139,250,0.9); }
        .anim-lane-tabs { display:flex; gap:2px; margin:0 0 10px; padding:3px; border-radius:10px; background:rgba(0,0,0,0.28); border:1px solid rgba(255,255,255,0.06); }
        .anim-lane-tab { flex:1; padding:7px 6px; border:none; border-radius:8px; background:transparent; color:rgba(255,255,255,0.5); font-size:0.68rem; font-weight:650; cursor:pointer; font-family:inherit; }
        .anim-lane-tab:hover { color:#E2E8F0; }
        .anim-lane-tab.is-on { background:rgba(124,58,237,0.35); color:#F8FAFC; }
        .anim-lane { display:flex; flex-direction:column; gap:8px; }
        .anim-lane__label { font-size:0.62rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:rgba(255,255,255,0.4); }
        .anim-lane__hint { margin:0; font-size:0.65rem; color:rgba(255,255,255,0.4); line-height:1.4; }
        .anim-lane__warn { font-size:0.68rem; color:#FCD34D; line-height:1.35; }
        .anim-lane__primary { min-height:88px !important; margin:0 !important; }
        .anim-lane__primary-input { width:100%; margin:0; }
        .anim-lane__actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
        .anim-lane__actions .anim-btn { width:auto; padding:6px 10px; font-size:0.68rem; }
        .anim-lane__more { border:1px solid rgba(255,255,255,0.07); border-radius:8px; background:rgba(255,255,255,0.02); }
        .anim-lane__more > summary { cursor:pointer; list-style:none; padding:8px 10px; font-size:0.68rem; font-weight:650; color:rgba(226,232,240,0.7); }
        .anim-lane__more > summary::-webkit-details-marker { display:none; }
        .anim-lane__more[open] > summary { border-bottom:1px solid rgba(255,255,255,0.06); }
        .anim-lane__more .anim-brief-edit { margin:8px 10px 10px; min-height:52px; }
        .anim-vol--inline { display:inline-flex; align-items:center; gap:6px; margin-left:auto; font-size:0.68rem; color:rgba(255,255,255,0.65); }
        .anim-vol--inline input[type="range"] { width:90px; }
        .anim-select--compact { width:auto; min-width:72px; font-size:0.68rem; }
        .anim-asset-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
        .anim-asset-row__pick { flex:1 1 160px; min-width:140px; font-size:0.68rem; }
        .anim-asset-row .anim-btn { width:auto; padding:6px 10px; font-size:0.68rem; }
        .anim-asset-row__preview { margin-top:4px; }
        .anim-asset-row__preview audio { width:100%; max-width:280px; height:32px; }
        .anim-asset-row__preview video { width:72px; height:40px; object-fit:cover; border-radius:6px; background:#000; }
        .anim-assemble-panel { width:100%; margin-top:8px; padding:12px; border-radius:12px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.02); }

        .anim-assemble-flags { display:flex; flex-wrap:wrap; gap:12px; font-size:0.72rem; color:#CBD5E1; }
        .anim-assemble-flags label { display:inline-flex; align-items:center; gap:5px; cursor:pointer; }
        .anim-final__stage { position:relative; width:280px; max-width:100%; border-radius:12px; overflow:hidden; background:#000; }
        .anim-final__video { display:block; width:100%; max-width:280px; border-radius:12px; background:#000; }
        .anim-cap-overlay { position:absolute; left:50%; width:78%; pointer-events:none; z-index:2; text-align:center; }
        .anim-safe-zone { position:absolute; left:0; right:0; bottom:0; height:35%; pointer-events:none; z-index:1; background:repeating-linear-gradient(135deg, rgba(239,68,68,0.10) 0 6px, rgba(239,68,68,0.04) 6px 12px); border-top:1px dashed rgba(239,68,68,0.55); }
        .anim-safe-zone[hidden] { display:none; }
        .anim-safe-zone span { position:absolute; top:3px; right:6px; font-size:0.55rem; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:rgba(252,165,165,0.85); }
        .anim-safe-zone.is-violated { background:repeating-linear-gradient(135deg, rgba(239,68,68,0.22) 0 6px, rgba(239,68,68,0.10) 6px 12px); border-top-color:#EF4444; }
        .anim-cap-safe-warn { font-size:0.62rem; line-height:1.35; color:#FCA5A5; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.3); border-radius:6px; padding:5px 8px; margin:2px 0 6px; }
        .anim-cap-safe-warn[hidden] { display:none; }
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
        .anim-entry-mode { display:flex; gap:6px; margin:0 0 8px; }
        .anim-entry-seg { flex:1; padding:7px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.1); background:transparent; color:rgba(255,255,255,0.55); font-size:0.72rem; font-weight:600; cursor:pointer; font-family:inherit; }
        .anim-entry-seg.active { background:rgba(124,58,237,0.2); border-color:rgba(124,58,237,0.45); color:#E9D5FF; }
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
        @media (max-width: 1100px) {
          .anim-shell.atelier-shell { grid-template-columns: minmax(0,1fr) minmax(340px,46%); }
        }
        @media (max-width: 960px) {
          .anim-shell.atelier-shell { grid-template-columns:1fr; height:auto; max-height:none; }
          .anim-canvas.atelier-stage { border-right:none; border-bottom:1px solid rgba(255,255,255,0.08); min-height:42vh; }
          .anim-chat.atelier-inspector { min-height:48vh; }
          .anim-prompt { min-height:96px; max-height:220px; }
        }
      </style>
      <div class="anim-shell atelier-shell">
        <section class="anim-canvas atelier-stage">
          <div class="anim-canvas-header">
            <h2>Reels</h2>
            <div style="display:flex;gap:8px;align-items:center;">
              <button type="button" class="anim-btn anim-btn--ghost" id="anim-home" style="padding:7px 12px;font-size:0.72rem;" title="Back to start">Home</button>
              <button type="button" class="anim-btn anim-btn--ghost" id="anim-new" style="padding:7px 12px;font-size:0.72rem;">New project</button>
            </div>
          </div>
          <div class="anim-canvas-body" id="anim-canvas-body"></div>
        </section>
        <aside class="anim-chat atelier-inspector">
          <div class="anim-chat-header">
            <h3>Coach</h3>
            <p>Brief → shots → you approve</p>
          </div>
          <div class="anim-chat-body">
            <div class="anim-chat-log" id="anim-chat-log"></div>
            <div id="anim-brief-actions" style="padding:0 14px;"></div>
          </div>
          <div class="anim-chat-compose">
              <details class="anim-chat-settings">
                <summary>Settings &amp; references</summary>
                <div class="anim-chat-settings__body">
              <div class="anim-row">
                <select id="anim-mode" class="anim-select" title="Mode">${modeOptions()}</select>
                <select id="anim-look" class="anim-select" title="Look">${lookOptions()}</select>
              </div>
              <div class="anim-row" style="margin-top:8px;">
                <select id="anim-motion" class="anim-select" title="Motion" style="flex:1;">${motionOptions()}</select>
                <select id="anim-i2v" class="anim-select" title="Motion style" style="flex:1;">${i2vOptions()}</select>
              </div>
              <div class="anim-row" style="margin-top:8px;">
                <select id="anim-template" class="anim-select" title="Motion style pack" style="flex:1;">${templateOptions()}</select>
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
              ${!(_meta?.providers?.elevenlabs_configured) ? `<div style="font-size:0.65rem;color:#FCD34D;margin:0 0 10px;line-height:1.35;">Voiceover and music generation aren't enabled on this account — captions, uploaded music and outros still work.</div>` : ''}
              <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin:0 0 6px;">References</div>
              <div class="anim-refs" id="anim-refs"></div>
              <div class="anim-ref-tools">
                <input type="file" id="anim-ref-file" accept="image/*" multiple hidden />
                <button type="button" class="anim-btn anim-btn--ghost" id="anim-ref-upload" style="padding:7px 10px;font-size:0.72rem;width:auto;white-space:nowrap;">Upload</button>
                <button type="button" class="anim-btn anim-btn--ghost" id="anim-ref-library" style="padding:7px 10px;font-size:0.72rem;width:auto;white-space:nowrap;">Library</button>
                <input type="url" id="anim-ref-url" class="anim-ref-url" placeholder="Paste image URL…" />
                <button type="button" class="anim-btn anim-btn--ghost" id="anim-ref-add-url" style="padding:7px 10px;font-size:0.72rem;width:auto;">Add</button>
              </div>
                </div>
              </details>
              ${renderStoryComposer()}
              <div id="anim-entry-mode" class="anim-entry-mode" role="tablist" aria-label="Animate input">
                <button type="button" class="anim-entry-seg active" role="tab" data-entry="vo" aria-selected="true">Voiceover script</button>
                <button type="button" class="anim-entry-seg" role="tab" data-entry="prompt" aria-selected="false">Describe a video</button>
              </div>
              <textarea id="anim-prompt" class="anim-prompt" placeholder="Write or paste the voiceover. We'll build the shots around it."></textarea>
              <div id="anim-pending-packs" style="display:none;margin:6px 0 0;padding:8px 10px;border-radius:8px;border:1px solid rgba(124,58,237,0.35);background:rgba(124,58,237,0.1);align-items:center;flex-wrap:wrap;gap:4px;"></div>
              <div class="anim-chat-send">
                <button type="button" class="anim-btn" id="anim-send">Write shots</button>
              </div>
          </div>
        </aside>
      </div>
    `;

    document.getElementById('anim-entry-mode')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-entry]');
      if (!btn) return;
      const mode = btn.dataset.entry === 'prompt' ? 'prompt' : 'vo';
      writeAnimEntry(mode);
      applyAnimEntryUI(mode);
    });
    applyAnimEntryUI(readAnimEntry());
    bindStoryComposer();
    const growPrompt = () => {
      const ta = document.getElementById('anim-prompt');
      if (!ta) return;
      ta.style.height = 'auto';
      const max = Math.min(280, Math.round(window.innerHeight * 0.36));
      const next = Math.max(110, Math.min(max, ta.scrollHeight));
      ta.style.height = next + 'px';
    };
    document.getElementById('anim-prompt')?.addEventListener('input', growPrompt);
    growPrompt();
    document.getElementById('anim-send')?.addEventListener('click', sendPrompt);
    document.getElementById('anim-new')?.addEventListener('click', newProject);
    document.getElementById('anim-home')?.addEventListener('click', goHome);
    document.getElementById('anim-ref-upload')?.addEventListener('click', () => document.getElementById('anim-ref-file')?.click());
    document.getElementById('anim-ref-library')?.addEventListener('click', () => {
      const open = window.openLibraryPicker;
      if (typeof open !== 'function') return toast('Open Library from the sidebar first', 'error');
      open({
        title: 'Add Library refs',
        kinds: ['character', 'item', 'setting', 'scene', 'logo', 'plate', 'style'],
        onPick: (picked, ids) => {
          const refs = (window.SEAssets && typeof window.SEAssets.refsFromAssets === 'function')
            ? window.SEAssets.refsFromAssets(picked, ids)
            : (picked || []).map((a) => ({
              url: a.url,
              title: a.name || a.kind,
              role: (window.SEAssets && window.SEAssets.roleForKind) ? window.SEAssets.roleForKind(a.kind) : (a.kind === 'character' ? 'character' : (a.kind === 'style' || a.kind === 'logo' ? 'style' : 'scene')),
            }));
          const seen = new Set(_refs.map((r) => r.url));
          refs.forEach((r) => {
            const u = String(r.url || '').trim();
            if (!u || seen.has(u)) return;
            seen.add(u);
            _refs.push({ url: u, title: r.title || r.name || 'Library ref', role: r.role || 'scene' });
          });
          _refs = _refs.slice(0, 8);
          renderRefs();
          if (refs.length) toast('Library refs attached — tag Char vs Scene, then Write shots.', 'success');
        },
      });
    });
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

    await Promise.all([recentPromise, libraryPromise]);

    // Auto-resume in-flight work. Never auto-delete on expired media.
    if (_project && projectMediaExpired(_project)) {
      toast('Some media links died after a restart — re-upload Char refs if needed.', 'warning');
    } else if (!_project && !(remixSession && remixSession.referenceUrl) && !(coachSession && coachSession.prompt && coachSession.destination === 'animate')) {
      const lastId = lastOpenProjectId();
      const inflight = _recent.find((p) =>
        !projectMediaExpired(p)
        && ['developing', 'generating', 'assembling', 'brief_ready', 'character_review'].includes(p.status)
      );
      const resumeId = lastId || inflight?.id;
      if (resumeId) {
        try {
          const data = await animFetch(`/api/animation/projects/${resumeId}`);
          if (window.SEStory && nlOn() && window.SEStory.claims(data.project)) {
            // A story not made yet belongs to the Storyboard tab, which reopens it itself.
          } else {
            _project = data.project;
            rememberOpenProject(_project.id);
          }
        } catch (_) {
          if (lastId && lastId === resumeId) rememberOpenProject('');
          _project = null;
        }
      }
    }
    await maybeAttachDefaultOutro();
    renderCanvas();
    renderChat();
    if (_project && (['developing', 'generating', 'assembling'].includes(_project.status) || projectHasBusyScenes(_project) || projectChecking(_project))) {
      startPoll();
    }
    if (remixSession && remixSession.referenceUrl) {
      await applyAnimRemixSessionIfAny();
    }
    if (coachSession && coachSession.prompt && coachSession.destination === 'animate') {
      await applyAnimCoachCreateSessionIfAny();
    }
    const pendingRef = window.__SE_ANIM_PENDING_REF;
    if (pendingRef && pendingRef.url && !_refs.some((r) => r.url === pendingRef.url)) {
      _refs.push({
        url: pendingRef.url,
        title: pendingRef.title || 'Library still',
        role: pendingRef.role === 'character' ? 'character' : 'scene',
      });
      window.__SE_ANIM_PENDING_REF = null;
      renderRefs();
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };
})();
