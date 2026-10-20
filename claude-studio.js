/**
 * Studio · Post — Phase 1.5
 * Reference picker (Products / Library / Uploads) → on-brand 9:16 (or specified) → PNG → queue
 * Infographic upload → split into IG+FB carousel slides
 * Or upload 2–10 already-cut squares (filename order) and queue as a carousel
 */
(function () {
  'use strict';

  let _csGenerating = false;
  let _csHtml = '';
  let _csBrief = '';
  let _csSpec = { w: 1080, h: 1920, ratio: '9:16', label: '9:16', format: 'portrait' };
  let _csGeneratedUrl = null;
  let _csBrandName = '';
  let _csCharity = false;
  // New look, Post: the minimal canvas (no Brief column). Element refs and its own state.
  let _nlP2 = null;
  let _nlP2Finished = false; // a finished graphic was dropped in: it is the post, not a reference
  let _nlP2Platforms = null; // ['Instagram', 'Facebook'] when the toggles are shown
  let _csRef = null; // { url, type, title, source, product_id?, video_url?, poster_url? }
  let _csPickerTab = 'products';
  let _csCarousel = null; // { originalUrl, width, height, method, slides: [{ url, y0, y1 }], queueOrder: number[], selected: 0 }
  let _csOriginalPreviewUrl = null;
  let _csCutTimer = null;
  let _csQueueSingleUrl = null;
  let _csSplitSeq = 0;
  let _csCoachPending = null;
  let _csCoachJob = null;
  let _csCoachSending = false;
  // How often the posts card checks on posts being made (tests shorten it).
  let _csPostsPollMs = (typeof window !== 'undefined' && Number(window.__SE_POSTS_POLL_MS)) || 2500;
  const CS_MAX_STYLE_REFS = 10;
  const CS_CAROUSEL_SEED = 'Redesign this infographic into a 9:16 Instagram carousel. Look at the image. If reference slides are attached, propose exactly that many slides (Instagram max 10). If none are attached, propose 4 to 6 complete slides. Do not crop strips.';
  let _csCoachStyleUrls = [];
  /** Style https URLs already injected into a Coach chat turn (do not re-attach). */
  let _csCoachStylesSentToChat = new Set();
  /** Prior Stage posters for Restore previous (newest at end). */
  let _csPosterHistory = [];
  let _csRestoringPoster = false;
  let _csDesignId = null;
  let _csWorkspaceCleared = false;
  let _csScene = null;
  let _csTpl = null;
  let _csCarouselError = '';
  let _csPosterOk = '';
  let _csGenerateError = '';
  let _csTplListening = false;
  let _csActiveDesignPoll = null; // { jobId, promise }
  // Stage spinner only — never the Generate button (that button is a short CTA).
  const CS_LEAVE_BUSY = 'A few minutes — you can leave; we\'ll keep working.';
  const CS_POSTER_HISTORY_MAX = 5;

  function queueReady() {
    return (typeof window !== 'undefined' && window.studioQueueReady) || {
      queueableSingleImage({ carousel, designed, imageUrl, type }) {
        if (carousel || designed || type === 'video') return '';
        return String(imageUrl || '').trim();
      },
      captionForQueue({ typedCaption, generatedCaption, brief }) {
        return String(typedCaption || generatedCaption || brief || '').trim();
      },
      queueReviewStatus() { return 'Pending'; },
      openContentReviewAfterQueue() { return false; },
    };
  }

  function afterQueued() {
    toast('Added to content queue', 'success');
    queueReady().openContentReviewAfterQueue();
  }

  function readQueueCaption() {
    const box = document.getElementById('cs-caption-box');
    const typed = box && 'value' in box ? box.value : '';
    return queueReady().captionForQueue({
      typedCaption: typed,
      generatedCaption: box?.dataset?.caption || '',
      brief: document.getElementById('cs-brief')?.value || _csBrief,
    });
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

  const CS_ENGINE_KEY = 'se_post_engine';
  let _csEngines = [{ id: 'auto', displayName: 'Auto (recommended)', description: 'Picks the best still engine for this account and brief.' }];

  function readStickyEngine() {
    try {
      const v = String(localStorage.getItem(CS_ENGINE_KEY) || 'auto').trim();
      return v || 'auto';
    } catch (_) {
      return 'auto';
    }
  }

  function writeStickyEngine(id) {
    try { localStorage.setItem(CS_ENGINE_KEY, String(id || 'auto')); } catch (_) {}
  }

  function selectedEngineId() {
    const el = document.getElementById('cs-engine');
    const v = el && el.value ? String(el.value).trim() : '';
    return v || readStickyEngine() || 'auto';
  }

  function renderEngineSelect(engines) {
    const sel = document.getElementById('cs-engine');
    const hint = document.getElementById('cs-engine-hint');
    if (!sel) return;
    const rows = Array.isArray(engines) && engines.length ? engines : _csEngines;
    _csEngines = rows;
    const sticky = readStickyEngine();
    const ids = new Set(rows.map((e) => e.id));
    const chosen = ids.has(sticky) ? sticky : 'auto';
    sel.innerHTML = rows.map((e) => {
      const label = escapeHtml(e.displayName || e.id);
      const badge = e.badge ? ` [${escapeHtml(e.badge)}]` : '';
      return `<option value="${escapeHtml(e.id)}">${label}${badge}</option>`;
    }).join('');
    sel.value = chosen;
    writeStickyEngine(chosen);
    if (hint) {
      const cur = rows.find((e) => e.id === chosen);
      const styleLock = rows.some((e) => e.id === 'figurelabs') && rows.every((e) => (e.capabilities || []).includes('style_ref'));
      hint.textContent = styleLock
        ? 'Style attached — Scientific Infographic will match that look. New facts come from your brief.'
        : ((cur && cur.description) || 'Auto picks for this account. Stick with a model you’ve liked.');
    }
  }

  async function loadDesignEngines() {
    try {
      const hasStyle = typeof coachStyleHttpsUrls === 'function' && coachStyleHttpsUrls().length > 0;
      const qs = hasStyle ? '?style_lock=1' : '';
      const res = await fetch(`${apiBase()}/api/studio/design-engines${qs}`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'engines failed');
      const engines = Array.isArray(data.engines) ? data.engines.filter((e) => e && e.status !== 'tier_locked' && e.status !== 'coming_soon') : [];
      renderEngineSelect(engines.length ? engines : _csEngines);
    } catch (e) {
      console.warn('[SE] design-engines fetch failed:', e.message || e);
      renderEngineSelect(_csEngines);
    }
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'info');
  }

  /** Atlas / Aliyun OSS hotlink-blocks portal Referers — display via API proxy. Keep canonical URLs for queue/export. */
  function mediaSrc(url) {
    if (!url) return '';
    if (/\/api\/media(\/|-fetch)/i.test(url)) return url;
    if (/(aliyuncs\.com|atlascloud\.ai|higgsfield\.ai)/i.test(url)) {
      return `${apiBase()}/api/media-fetch?url=${encodeURIComponent(url)}`;
    }
    return url;
  }

  function designStoreKey() {
    const data = window._studioClientData || window.__clientData || window.clientData || {};
    const id = data?.client?.id || data?.client?.contact_email || data?.email || _csBrandName || 'client';
    return `se-design-last:${id}`;
  }

  function designJobStoreKey() {
    return designStoreKey().replace('se-design-last:', 'se-design-job:');
  }

  function posterHistoryStoreKey() {
    return designStoreKey().replace('se-design-last:', 'se-design-history:');
  }

  function loadPosterHistory() {
    try {
      const raw = sessionStorage.getItem(posterHistoryStoreKey());
      const list = raw ? JSON.parse(raw) : [];
      _csPosterHistory = Array.isArray(list) ? list.filter((r) => r && /^https:\/\//i.test(r.image_url)).slice(-CS_POSTER_HISTORY_MAX) : [];
    } catch (_) {
      _csPosterHistory = [];
    }
    return _csPosterHistory;
  }

  function persistPosterHistory() {
    try {
      sessionStorage.setItem(posterHistoryStoreKey(), JSON.stringify(_csPosterHistory.slice(-CS_POSTER_HISTORY_MAX)));
    } catch (_) {}
  }

  function pushPosterHistory(prevUrl, spec, brief) {
    const url = String(prevUrl || '').trim();
    if (!/^https:\/\//i.test(url)) return;
    loadPosterHistory();
    const last = _csPosterHistory[_csPosterHistory.length - 1];
    if (last && last.image_url === url) return;
    _csPosterHistory.push({
      image_url: url,
      spec: spec || _csSpec,
      brief: brief || _csBrief || '',
      saved_at: Date.now(),
    });
    if (_csPosterHistory.length > CS_POSTER_HISTORY_MAX) {
      _csPosterHistory = _csPosterHistory.slice(-CS_POSTER_HISTORY_MAX);
    }
    persistPosterHistory();
    refreshRestorePreviousButton();
  }

  function restorePreviousPoster() {
    loadPosterHistory();
    const prev = _csPosterHistory.pop();
    persistPosterHistory();
    if (!prev || !prev.image_url) {
      toast('No previous poster to restore', 'info');
      refreshRestorePreviousButton();
      return false;
    }
    _csRestoringPoster = true;
    try {
      if (prev.brief) {
        const briefEl = document.getElementById('cs-brief');
        if (briefEl) briefEl.value = prev.brief;
        _csBrief = prev.brief;
      }
      showGeneratedImage(prev.image_url, prev.spec);
      toast('Restored previous poster', 'success');
      return true;
    } finally {
      _csRestoringPoster = false;
      refreshRestorePreviousButton();
    }
  }

  function refreshRestorePreviousButton() {
    loadPosterHistory();
    const btn = document.getElementById('cs-restore-prev');
    if (!btn) return;
    const on = _csPosterHistory.length > 0 && !_csGenerating;
    btn.disabled = !on;
    btn.style.opacity = on ? '1' : '0.45';
    btn.style.cursor = on ? 'pointer' : 'not-allowed';
    btn.style.color = on ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)';
    btn.style.borderColor = on ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.08)';
  }

  function coachStylesPendingForChat() {
    return coachStyleHttpsUrls().filter((u) => !_csCoachStylesSentToChat.has(u));
  }

  function markCoachStylesSent(urls) {
    for (const u of urls || []) {
      if (/^https:\/\//i.test(u)) _csCoachStylesSentToChat.add(u);
    }
  }

  function persistDesignJob(job) {
    try {
      if (!job || !job.job_id) return;
      sessionStorage.setItem(designJobStoreKey(), JSON.stringify(job));
    } catch (_) {}
  }

  function readDesignJob() {
    try {
      const raw = sessionStorage.getItem(designJobStoreKey());
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.job_id ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function clearDesignJob() {
    try { sessionStorage.removeItem(designJobStoreKey()); } catch (_) {}
  }

  function designStudioMounted() {
    return !!(document.getElementById('cs-loading') || document.getElementById('cs-brief'));
  }

  function applyCompletedDesign(data, { awayToast = false } = {}) {
    if (data && data.brand && data.brand.name) {
      _csBrandName = data.brand.name;
      const pill = document.getElementById('cs-brand-pill');
      if (pill) pill.textContent = _csBrandName;
    }
    if (data && data.record_id) _csDesignId = data.record_id;
    const imageUrl = data && data.image_url;
    if (!imageUrl) throw new Error('Generation failed');
    if (designStudioMounted()) {
      showGeneratedImage(imageUrl, data.spec);
      if (!awayToast) toast('Design ready', 'success');
    } else {
      _csHtml = '';
      _csWorkspaceCleared = false;
      _csGeneratedUrl = imageUrl;
      _csSpec = data.spec || _csSpec;
      _csQueueSingleUrl = imageUrl;
      _csOriginalPreviewUrl = imageUrl;
      _csRef = {
        url: imageUrl,
        type: 'image',
        title: 'Generated design',
        source: 'generate',
      };
      window._studioReference = { ..._csRef };
      persistLastDesign();
      toast('Poster ready in Design Studio', 'success');
    }
  }

  async function awaitDesignJob(jobId) {
    const id = String(jobId || '').trim();
    if (!id) throw new Error('Missing generate job');
    if (_csActiveDesignPoll && _csActiveDesignPoll.jobId === id) {
      return _csActiveDesignPoll.promise;
    }
    const started = Date.now();
    const maxMs = 8 * 60_000;
    const promise = (async () => {
      persistDesignJob({ job_id: id, status: 'processing', started_at: started });
      while (Date.now() - started < maxMs) {
        const res = await fetch(`${apiBase()}/api/studio/design-job/${encodeURIComponent(id)}`, {
          headers: authHeaders(),
          signal: AbortSignal.timeout(30_000),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 404) {
          clearDesignJob();
          throw new Error('That generate job expired — try again');
        }
        if (!res.ok) throw new Error(data.error || 'Could not check generate status');
        if (data.status === 'completed' && data.image_url) {
          clearDesignJob();
          return data;
        }
        if (data.status === 'failed') {
          clearDesignJob();
          const err = new Error(data.error || 'Generation failed');
          err.code = data.code;
          throw err;
        }
        persistDesignJob({ job_id: id, status: 'processing', started_at: started });
        await new Promise((r) => setTimeout(r, 2500));
      }
      throw new Error('Still generating — reopen Design Studio in a minute');
    })().finally(() => {
      if (_csActiveDesignPoll && _csActiveDesignPoll.jobId === id) _csActiveDesignPoll = null;
    });
    _csActiveDesignPoll = { jobId: id, promise };
    return promise;
  }

  async function resumeDesignJobIfAny() {
    const saved = readDesignJob();
    if (!saved || !saved.job_id) return;
    if (_csGenerating && _csActiveDesignPoll && _csActiveDesignPoll.jobId === saved.job_id) {
      restoreBusyUiIfGenerating();
      return;
    }
    if (_csGenerating && !_csActiveDesignPoll) {
      // In-memory flag orphaned (e.g. remount after false busy) — reclaim via job poll.
    }
    setBusy(true, CS_LEAVE_BUSY);
    try {
      const data = await awaitDesignJob(saved.job_id);
      applyCompletedDesign(data, { awayToast: false });
    } catch (e) {
      toast(e.message || 'Generation failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  function persistLastDesign() {
    try {
      if (_csWorkspaceCleared || !_csGeneratedUrl) return;
      localStorage.setItem(designStoreKey(), JSON.stringify({
        image_url: _csGeneratedUrl,
        spec: _csSpec,
        brief: (document.getElementById('cs-brief') && document.getElementById('cs-brief').value) || _csBrief,
        design_id: _csDesignId || '',
        saved_at: Date.now(),
      }));
    } catch (_) {}
  }

  function libraryStoreKey() {
    return designStoreKey().replace('se-design-last:', 'se-design-library:');
  }

  function templateStoreKey() {
    return designStoreKey().replace('se-design-last:', 'se-design-templates:');
  }

  function readJsonStore(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function writeJsonStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function loadSavedDesigns() {
    return Array.isArray(readJsonStore(libraryStoreKey(), [])) ? readJsonStore(libraryStoreKey(), []) : [];
  }

  function loadSavedTemplates() {
    return Array.isArray(readJsonStore(templateStoreKey(), [])) ? readJsonStore(templateStoreKey(), []) : [];
  }

  function workspaceApi() {
    return window.designWorkspaceApi || {};
  }

  function sceneApi() {
    return window.designSceneApi || {};
  }

  function startFresh(opts = {}) {
    const keepStyles = opts.keepStyles !== false;
    const styles = keepStyles ? _csCoachStyleUrls.slice() : [];
    const api = workspaceApi();
    const next = typeof api.startFreshWorkspace === 'function'
      ? api.startFreshWorkspace({
        generatedUrl: _csGeneratedUrl,
        html: _csHtml,
        carousel: _csCarousel,
        ref: _csRef,
        styleUrls: styles,
      })
      : { generatedUrl: null, html: '', carousel: null, ref: null, cleared: true, styleUrls: styles };
    _csGeneratedUrl = next.generatedUrl;
    _csHtml = next.html || '';
    _csCarousel = next.carousel;
    _csRef = next.ref;
    _csOriginalPreviewUrl = null;
    _csQueueSingleUrl = null;
    _csDesignId = null;
    _csScene = null;
    _csBrief = '';
    _csWorkspaceCleared = true;
    _csCoachStyleUrls = Array.isArray(next.styleUrls) ? next.styleUrls : styles;
    _csCoachStylesSentToChat = new Set();
    _csPosterHistory = [];
    try { localStorage.removeItem(designStoreKey()); } catch (_) {}
    try { sessionStorage.removeItem(posterHistoryStoreKey()); } catch (_) {}
    window._studioReference = null;
    window.__SE_CAROUSEL_REDESIGN = null;
    window.__SE_CAROUSEL_PLAN = null;
    window._seCoachAttachedImage = '';
    window.__SE_COACH_MASTER_IMAGE = '';
    _csCoachJob = null;
    setDesignCoachApply(null);
    const briefEl = document.getElementById('cs-brief');
    if (briefEl && !opts.keepBrief) briefEl.value = '';
    const cap = document.getElementById('cs-caption-box');
    if (cap) cap.value = '';
    _nlP2Finished = false;
    renderRefSummary();
    renderCoachStyleChip();
    renderSavedDesigns();
    restorePreview();
    refreshActionButtons();
    syncSplitButton();
    return true;
  }

  function currentTitle() {
    const brief = (document.getElementById('cs-brief') && document.getElementById('cs-brief').value) || _csBrief;
    return String(brief || 'Saved design').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Saved design';
  }

  function saveDesignForLater() {
    const url = _csGeneratedUrl || masterImageUrl();
    if (!/^https?:\/\//i.test(url)) {
      toast('Nothing to save yet', 'warning');
      return false;
    }
    const api = workspaceApi();
    const items = typeof api.upsertLibraryItem === 'function'
      ? api.upsertLibraryItem(loadSavedDesigns(), {
        id: _csDesignId || `local-${Date.now()}`,
        image_url: url,
        title: currentTitle(),
        status: 'saved',
        saved_at: Date.now(),
      })
      : loadSavedDesigns();
    writeJsonStore(libraryStoreKey(), items);
    toast('Saved for later', 'success');
    startFresh({ keepStyles: true });
    return true;
  }

  async function archiveCurrentDesign() {
    const id = _csDesignId;
    const api = workspaceApi();
    let items = loadSavedDesigns();
    if (id && typeof api.archiveLibraryItem === 'function') items = api.archiveLibraryItem(items, id);
    writeJsonStore(libraryStoreKey(), items);
    if (id && /^rec/i.test(id)) {
      try {
        const res = await fetch(`${apiBase()}/api/archive-post`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ postId: id }),
        });
        if (!res.ok) throw new Error('Archive failed');
      } catch (e) {
        toast(e.message || 'Could not archive', 'error');
        return false;
      }
    }
    toast('Archived', 'success');
    startFresh({ keepStyles: true });
    return true;
  }

  async function deleteCurrentDesign() {
    if (!masterImageUrl() && !_csGeneratedUrl && !hasCarousel()) {
      toast('Nothing to delete', 'warning');
      return false;
    }
    if (!window.confirm('Permanently delete this design from the canvas and your saved list?')) return false;
    const id = _csDesignId;
    const api = workspaceApi();
    let items = loadSavedDesigns();
    if (id && typeof api.deleteLibraryItem === 'function') items = api.deleteLibraryItem(items, id);
    writeJsonStore(libraryStoreKey(), items);
    try { localStorage.removeItem(designStoreKey()); } catch (_) {}
    if (id && /^rec/i.test(id)) {
      try {
        const res = await fetch(`${apiBase()}/api/delete-post`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ postId: id }),
        });
        if (!res.ok) throw new Error('Delete failed');
      } catch (e) {
        toast(e.message || 'Could not delete', 'error');
      }
    }
    toast('Deleted', 'success');
    startFresh({ keepStyles: true });
    return true;
  }

  function restoreLastDesign() {
    if (_csGenerating) return false;
    const snapshot = {
      generatedUrl: _csGeneratedUrl,
      html: _csHtml,
      carousel: _csCarousel,
      cleared: _csWorkspaceCleared,
    };
    if (window.__SE_CAROUSEL_REDESIGN) return false;
    const api = workspaceApi();
    try {
      const raw = localStorage.getItem(designStoreKey());
      if (!raw) return false;
      const row = JSON.parse(raw);
      if (typeof api.shouldRestoreLastDesign === 'function' && !api.shouldRestoreLastDesign(snapshot, row)) return false;
      if (!row || !/^https?:\/\//i.test(row.image_url)) return false;
      if (row.spec) _csSpec = Object.assign({}, _csSpec, row.spec);
      if (row.brief) {
        const briefEl = document.getElementById('cs-brief');
        if (briefEl && !String(briefEl.value || '').trim()) briefEl.value = row.brief;
        _csBrief = row.brief;
      }
      if (row.design_id) _csDesignId = row.design_id;
      _csWorkspaceCleared = false;
      showGeneratedImage(row.image_url, row.spec);
      return true;
    } catch (_) {
      return false;
    }
  }

  function renderSavedDesigns() {
    const box = document.getElementById('cs-saved-designs');
    if (!box) return;
    const items = loadSavedDesigns().filter((it) => it && it.status !== 'archived');
    const templates = loadSavedTemplates();
    if (!items.length && !templates.length) {
      box.innerHTML = '<div style="font-size:0.72rem;color:rgba(255,255,255,0.32);line-height:1.4;">No saved designs yet. Save for later keeps the poster without posting it.</div>';
      return;
    }
    box.innerHTML = [
      items.map((it) => (
        `<button type="button" data-open-design="${escapeHtml(it.id)}" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:6px;margin-bottom:6px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:#fff;cursor:pointer;font-family:var(--font-body);">`
        + `<img src="${escapeHtml(mediaSrc(it.image_url))}" alt="" referrerpolicy="no-referrer" style="width:36px;height:36px;object-fit:cover;border-radius:6px;background:#111;">`
        + `<span style="font-size:0.72rem;font-weight:600;">${escapeHtml(it.title || 'Saved design')}</span></button>`
      )).join(''),
      templates.map((it) => (
        `<button type="button" data-open-template="${escapeHtml(it.id)}" style="display:block;width:100%;text-align:left;padding:6px 8px;margin-bottom:6px;border-radius:8px;border:1px solid rgba(124,58,237,0.28);background:rgba(124,58,237,0.08);color:#E9D5FF;cursor:pointer;font-family:var(--font-body);font-size:0.72rem;font-weight:700;">Template · ${escapeHtml(it.title || 'Format')}</button>`
      )).join(''),
    ].join('');
    box.querySelectorAll('[data-open-design]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-open-design');
        const row = loadSavedDesigns().find((it) => it.id === id);
        if (!row || !row.image_url) return;
        _csWorkspaceCleared = false;
        _csDesignId = row.id;
        showGeneratedImage(row.image_url, _csSpec);
      });
    });
    box.querySelectorAll('[data-open-template]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-open-template');
        const row = loadSavedTemplates().find((it) => it.id === id);
        if (!row || !row.scene) return;
        _csScene = row.scene;
        renderScenePreview();
        toast('Template loaded — click a box to hide it, or ask Coach to remove a piece', 'info');
      });
    });
  }

  function renderScenePreview() {
    const api = sceneApi();
    if (!_csScene || typeof api.slideToSvg !== 'function') return false;
    hidePreviewPanes();
    setPreviewHeader('Preview · Template');
    const wrap = document.getElementById('cs-scene-preview');
    const svg = api.slideToSvg(_csScene, (_csScene.slides[0] && _csScene.slides[0].index) || 1);
    if (wrap) {
      wrap.style.display = 'block';
      wrap.innerHTML = `<div id="cs-scene-svg" style="width:100%;max-height:min(70vh,640px);overflow:auto;background:#fff;border-radius:8px;">${svg}</div>`
        + `<div style="font-size:0.68rem;color:rgba(255,255,255,0.4);margin-top:8px;">Click a box to hide it. Logo stays locked.</div>`;
      wrap.querySelectorAll('[data-object-id]').forEach((el) => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', (e) => {
          const id = el.getAttribute('data-object-id');
          if (!id || id === 'logo') return;
          e.preventDefault();
          _csScene = api.hideObject(_csScene, id);
          renderScenePreview();
        });
      });
    }
    refreshActionButtons();
    return true;
  }

  function queuePlatform() {
    if (_nlP2 && document.body.contains(_nlP2.root) && Array.isArray(_nlP2Platforms) && _nlP2Platforms.length) return _nlP2Platforms.join(',');
    return connectedQueuePlatform();
  }

  function connectedQueuePlatform() {
    const data = window.__clientData || window.clientData || window._studioClientData || {};
    const c = data?.client || {};
    const raw = c.social_connected_platforms;
    const list = Array.isArray(raw)
      ? raw
      : String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
    const lower = list.map((p) => String(p || '').toLowerCase());
    const fbFlag = String(c.facebook_connected || '').toLowerCase();
    const fbOff = fbFlag === 'false' || fbFlag === '0' || fbFlag === 'no';
    const hasIg = lower.includes('instagram') || !!String(c.instagram_user_id || '').trim();
    const hasFb = lower.includes('facebook') || (!fbOff && !!(c.meta_page_id && c.meta_page_token));
    if (hasIg && hasFb) return 'Instagram,Facebook';
    if (hasIg) return 'Instagram';
    if (hasFb) return 'Facebook';
    return 'Instagram,Facebook';
  }

  function hasCarousel() {
    return !!( _csCarousel && Array.isArray(_csCarousel.slides) && _csCarousel.slides.length >= 2 );
  }

  function isAssembledCarousel() {
    return hasCarousel() && (_csCarousel.method === 'assembled' || _csCarousel.method === 'redesign' || _csCarousel.method === 'template');
  }

  function identityQueueOrder(n) {
    return Array.from({ length: n }, (_, i) => i);
  }

  function carouselQueueOrder() {
    if (!_csCarousel || !Array.isArray(_csCarousel.slides)) return [];
    const n = _csCarousel.slides.length;
    if (!_csCarousel.queueOrder || _csCarousel.queueOrder.length !== n) {
      _csCarousel.queueOrder = identityQueueOrder(n);
    }
    return _csCarousel.queueOrder;
  }

  function slidesInQueueOrder() {
    const slides = _csCarousel.slides || [];
    return carouselQueueOrder().map((idx) => slides[idx]).filter(Boolean);
  }

  function masterImageUrl() {
    if (_csGeneratedUrl) return _csGeneratedUrl;
    if (_csRef && _csRef.type === 'image' && _csRef.url) return _csRef.url;
    return _csOriginalPreviewUrl || '';
  }

  function syncSplitButton() {
    syncTemplateButton();
    const btn = document.getElementById('cs-split-carousel');
    if (!btn) return;
    const on = /^https?:\/\//i.test(masterImageUrl());
    btn.disabled = !on;
    btn.style.cursor = on ? 'pointer' : 'not-allowed';
    btn.style.opacity = on ? '1' : '0.5';
    btn.style.color = on ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)';
  }

  function setPreviewHeader(text) {
    const el = document.getElementById('cs-preview-header');
    if (el) el.textContent = text;
  }

  function previewLabel(spec) {
    const ratio = (spec && (spec.ratio || spec.label)) || '9:16';
    return `Preview · ${ratio}`;
  }

  function fitPreviewFrame(w, h) {
    const maxW = 360;
    const maxH = 640;
    const scale = Math.min(maxW / (w || 1080), maxH / (h || 1920), 1);
    return { scale, frameW: Math.round((w || 1080) * scale), frameH: Math.round((h || 1920) * scale) };
  }

  function hidePreviewPanes() {
    const empty = document.getElementById('cs-empty');
    const loading = document.getElementById('cs-loading');
    const frame = document.getElementById('cs-frame');
    const original = document.getElementById('cs-original-preview');
    const carousel = document.getElementById('cs-carousel');
    const scene = document.getElementById('cs-scene-preview');
    if (empty) empty.style.display = 'none';
    if (loading) loading.style.display = 'none';
    if (frame) frame.style.display = 'none';
    if (original) original.style.display = 'none';
    if (carousel) carousel.style.display = 'none';
    if (scene) scene.style.display = 'none';
  }

  function showOriginalPreview(url) {
    const src = url || _csOriginalPreviewUrl || _csRef?.url;
    if (!src) return;
    _csOriginalPreviewUrl = src;
    hidePreviewPanes();
    setPreviewHeader('Preview · Uploaded');
    const wrap = document.getElementById('cs-original-preview');
    const img = document.getElementById('cs-original-preview-img');
    if (img) {
      img.referrerPolicy = 'no-referrer';
      img.src = mediaSrc(src);
    }
    if (wrap) wrap.style.display = 'block';
    refreshActionButtons();
  }

  function setReference(ref) {
    const prevUrl = _csRef?.url || '';
    let clearedCarouselForNewRef = false;
    if (!ref || !ref.url) {
      startFresh({ keepStyles: true, keepBrief: true });
      return;
    } else {
      _csRef = {
        url: String(ref.url),
        type: ref.type === 'video' ? 'video' : 'image',
        title: String(ref.title || 'Reference'),
        source: ref.source || 'upload',
        product_id: ref.product_id || undefined,
        video_url: ref.video_url || undefined,
        poster_url: ref.poster_url || undefined,
      };
      window._studioReference = { ..._csRef };
      if (_csCarousel && _csCarousel.originalUrl !== _csRef.url) {
        _csCarousel = null;
        clearedCarouselForNewRef = true;
        _csSplitSeq += 1;
      }
      if (!_csCarousel && _csRef.type === 'image') {
        _csHtml = '';
        _csGeneratedUrl = null;
        _csQueueSingleUrl = _csRef.url;
      } else if (_csRef.type !== 'image') {
        _csQueueSingleUrl = null;
      }
      if (prevUrl && prevUrl !== _csRef.url && _csOriginalPreviewUrl === prevUrl) {
        _csOriginalPreviewUrl = null;
      }
    }
    renderRefSummary();
    syncSplitButton();
    if (_csRef.type === 'image' && !_csCarousel) {
      showOriginalPreview(_csRef.url);
    } else if (clearedCarouselForNewRef) {
      restorePreview();
    }
    refreshActionButtons();
  }

  function heroUrlForGenerate() {
    if (!_csRef) return '';
    if (_csRef.type === 'video') return _csRef.poster_url || _csRef.url || '';
    return _csRef.url || '';
  }

  function renderRefSummary() {
    const box = document.getElementById('cs-ref-summary');
    if (!box) return;
    if (!_csRef) {
      box.innerHTML = `
        <div style="font-size:0.78rem;color:rgba(255,255,255,0.35);line-height:1.45;">No reference yet — pick a Shopify product, past content, or upload.</div>
        <button type="button" id="cs-ref-open" style="margin-top:10px;width:100%;padding:10px;background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.35);border-radius:9px;color:#C4B5FD;font-size:0.8rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Choose reference</button>`;
      document.getElementById('cs-ref-open')?.addEventListener('click', openPicker);
      return;
    }
    const thumb = _csRef.poster_url || _csRef.url;
    box.innerHTML = `
      <div style="display:flex;gap:10px;align-items:flex-start;">
        <img src="${escapeHtml(mediaSrc(thumb))}" alt="" referrerpolicy="no-referrer" style="width:56px;height:56px;border-radius:8px;object-fit:cover;border:1px solid rgba(255,255,255,0.1);background:#111;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.78rem;font-weight:700;color:#fff;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(_csRef.title)}</div>
          <div style="font-size:0.65rem;color:rgba(255,255,255,0.35);margin-top:3px;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(_csRef.source)} · ${_csRef.type}</div>
          ${_csRef.type === 'video' && !_csRef.poster_url ? '<div style="font-size:0.68rem;color:#FBBF24;margin-top:4px;">Video selected — Design Studio needs a still. Upload a frame or open Video Studio.</div>' : ''}
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button type="button" id="cs-ref-open" style="flex:1;padding:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:rgba(255,255,255,0.7);font-size:0.72rem;font-weight:600;cursor:pointer;font-family:var(--font-body);">Change</button>
        <button type="button" id="cs-ref-clear" style="padding:8px 10px;background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:rgba(255,255,255,0.4);font-size:0.72rem;font-weight:600;cursor:pointer;font-family:var(--font-body);">Clear</button>
      </div>`;
    document.getElementById('cs-ref-open')?.addEventListener('click', openPicker);
    document.getElementById('cs-ref-clear')?.addEventListener('click', () => setReference(null));
    nlP2Sync();
  }

  function openPicker() {
    const modal = document.getElementById('cs-picker-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    setPickerTab(_csPickerTab || 'products');
  }
  function closePicker() {
    const modal = document.getElementById('cs-picker-modal');
    if (modal) modal.style.display = 'none';
  }

  function setPickerTab(tab) {
    _csPickerTab = tab;
    ['products', 'library', 'uploads'].forEach((t) => {
      const btn = document.getElementById('cs-tab-' + t);
      const panel = document.getElementById('cs-panel-' + t);
      if (btn) {
        const on = t === tab;
        btn.style.background = on ? 'rgba(124,58,237,0.25)' : 'transparent';
        btn.style.color = on ? '#E9D5FF' : 'rgba(255,255,255,0.4)';
      }
      if (panel) panel.style.display = t === tab ? 'block' : 'none';
    });
    if (tab === 'products') loadProducts();
    if (tab === 'library') loadLibrary();
    if (tab === 'uploads') renderUploadsPanel();
  }

  async function loadProducts(q) {
    const grid = document.getElementById('cs-products-grid');
    if (!grid) return;
    grid.innerHTML = '<div style="padding:24px;color:rgba(255,255,255,0.35);font-size:0.8rem;">Loading products…</div>';
    try {
      const params = new URLSearchParams({ limit: '24', page: '1' });
      if (q) params.set('search', q);
      const res = await fetch(`${apiBase()}/api/studio/products?${params}`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      const products = Array.isArray(data.products) ? data.products : [];
      if (!products.length) {
        grid.innerHTML = '<div style="padding:24px;color:rgba(255,255,255,0.35);font-size:0.8rem;">No products found. Connect Shopify or try another search.</div>';
        return;
      }
      grid.innerHTML = products.map((p) => {
        const img = p.primary_image || '';
        const title = p.title || 'Product';
        const id = p.id || '';
        return `<button type="button" class="cs-pick-card" data-url="${escapeHtml(img)}" data-title="${escapeHtml(title)}" data-id="${escapeHtml(String(id))}" data-source="shopify" style="text-align:left;padding:0;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.03);cursor:pointer;overflow:hidden;">
          <div style="aspect-ratio:1;background:#111;"><img src="${escapeHtml(mediaSrc(img))}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;" loading="lazy"></div>
          <div style="padding:8px 9px;font-size:0.72rem;font-weight:600;color:rgba(255,255,255,0.8);line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(title)}</div>
        </button>`;
      }).join('');
      grid.querySelectorAll('.cs-pick-card').forEach((el) => {
        el.addEventListener('click', () => {
          const url = el.getAttribute('data-url');
          if (!url) { toast('Product has no image', 'warning'); return; }
          setReference({
            url,
            type: 'image',
            title: el.getAttribute('data-title') || 'Product',
            source: 'shopify',
            product_id: el.getAttribute('data-id') || undefined,
          });
          closePicker();
          toast('Product selected', 'success');
        });
      });
    } catch (e) {
      grid.innerHTML = `<div style="padding:24px;color:#F87171;font-size:0.8rem;">${escapeHtml(e.message || 'Failed to load products')}</div>`;
    }
  }

  async function loadLibrary() {
    const grid = document.getElementById('cs-library-grid');
    if (!grid) return;
    grid.innerHTML = '<div style="padding:24px;color:rgba(255,255,255,0.35);font-size:0.8rem;">Loading library…</div>';
    try {
      const res = await fetch(`${apiBase()}/api/studio/media-library?type=all&limit=40`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) {
        grid.innerHTML = '<div style="padding:24px;color:rgba(255,255,255,0.35);font-size:0.8rem;">No past content with media yet.</div>';
        return;
      }
      grid.innerHTML = items.map((it) => {
        const thumb = it.image_url || '';
        const isVideo = it.type === 'video' || (!!it.video_url && !it.image_url);
        const title = it.title || 'Content';
        return `<button type="button" class="cs-lib-card" data-url="${escapeHtml(thumb || it.video_url || '')}" data-poster="${escapeHtml(thumb)}" data-video="${escapeHtml(it.video_url || '')}" data-type="${isVideo ? 'video' : 'image'}" data-title="${escapeHtml(title)}" style="text-align:left;padding:0;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.03);cursor:pointer;overflow:hidden;position:relative;">
          <div style="aspect-ratio:1;background:#111;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.3);font-size:0.7rem;">
            ${thumb ? `<img src="${escapeHtml(mediaSrc(thumb))}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;" loading="lazy">` : (isVideo ? 'VIDEO' : '—')}
          </div>
          ${isVideo ? '<span style="position:absolute;top:6px;left:6px;font-size:0.58rem;font-weight:800;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,0.55);color:#fff;">VIDEO</span>' : ''}
          <div style="padding:8px 9px;font-size:0.72rem;font-weight:600;color:rgba(255,255,255,0.8);line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(title)}</div>
        </button>`;
      }).join('');
      grid.querySelectorAll('.cs-lib-card').forEach((el) => {
        el.addEventListener('click', () => {
          const type = el.getAttribute('data-type') || 'image';
          const poster = el.getAttribute('data-poster') || '';
          const video = el.getAttribute('data-video') || '';
          const url = poster || el.getAttribute('data-url') || '';
          if (type === 'video' && !poster) {
            setReference({
              url: video,
              type: 'video',
              title: el.getAttribute('data-title') || 'Video',
              source: 'library',
              video_url: video,
              poster_url: '',
            });
            closePicker();
            toast('Video needs a still for Design Studio — upload a frame or use Video Studio', 'warning');
            return;
          }
          if (!url) { toast('No usable image on that item', 'warning'); return; }
          setReference({
            url,
            type: 'image',
            title: el.getAttribute('data-title') || 'Content',
            source: 'library',
            video_url: video || undefined,
            poster_url: poster || undefined,
          });
          closePicker();
          toast('Library item selected', 'success');
        });
      });
    } catch (e) {
      grid.innerHTML = `<div style="padding:24px;color:#F87171;font-size:0.8rem;">${escapeHtml(e.message || 'Failed to load library')}</div>`;
    }
  }

  function renderUploadsPanel() {
    const sess = document.getElementById('cs-session-upload');
    if (!sess) return;
    const existing = window._studioReference && window._studioReference.source === 'upload' ? window._studioReference : null;
    const vsHint = (window.vsUploadedImageUrl || window._vsUploadedImageUrl)
      ? `<button type="button" id="cs-use-vs-upload" style="margin-top:10px;width:100%;padding:10px;border-radius:9px;border:1px solid rgba(16,185,129,0.35);background:rgba(16,185,129,0.1);color:#6EE7B7;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Use Video Studio upload</button>`
      : '';
    sess.innerHTML = `
      <div style="font-size:0.78rem;color:rgba(255,255,255,0.45);line-height:1.45;margin-bottom:12px;">Upload an image (preferred). Videos need a still frame for Design Studio.</div>
      <div id="cs-drop" style="border:2px dashed rgba(255,255,255,0.12);border-radius:12px;padding:28px 16px;text-align:center;cursor:pointer;background:rgba(255,255,255,0.02);">
        <div style="font-size:0.85rem;font-weight:600;color:rgba(255,255,255,0.7);">Drop image here or click</div>
        <div style="font-size:0.7rem;color:rgba(255,255,255,0.3);margin-top:6px;">PNG / JPG / WEBP · max 10MB</div>
      </div>
      <input type="file" id="cs-file" accept="image/*" style="display:none;">
      ${vsHint}
      ${existing ? `<div style="margin-top:12px;font-size:0.72rem;color:rgba(255,255,255,0.4);">Current: ${escapeHtml(existing.title)}</div>` : ''}`;
    const drop = document.getElementById('cs-drop');
    const file = document.getElementById('cs-file');
    drop?.addEventListener('click', () => file?.click());
    drop?.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.borderColor = 'rgba(124,58,237,0.45)'; });
    drop?.addEventListener('dragleave', () => { drop.style.borderColor = 'rgba(255,255,255,0.12)'; });
    drop?.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.style.borderColor = 'rgba(255,255,255,0.12)';
      const f = e.dataTransfer?.files?.[0];
      if (f) uploadLocalFile(f);
    });
    file?.addEventListener('change', () => { if (file.files?.[0]) uploadLocalFile(file.files[0]); });
    document.getElementById('cs-use-vs-upload')?.addEventListener('click', () => {
      const url = window.vsUploadedImageUrl || window._vsUploadedImageUrl;
      if (!url) return;
      setReference({ url, type: 'image', title: 'Studio upload', source: 'upload' });
      closePicker();
      toast('Using Video Studio upload', 'success');
    });
  }

  async function uploadLocalFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please upload an image file', 'warning'); return; }
    if (file.size > 10 * 1024 * 1024) { toast('Image must be under 10MB', 'warning'); return; }
    toast('Uploading…', 'info');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${apiBase()}/api/studio/upload-image`, {
        method: 'POST',
        headers: authHeadersMultipart(),
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
      setReference({ url: data.url, type: 'image', title: file.name || 'Upload', source: 'upload' });
      closePicker();
      toast('Upload ready', 'success');
    } catch (e) {
      toast(e.message || 'Upload failed', 'error');
    }
  }

  async function resolveAdvancedUrl() {
    const input = document.getElementById('cs-photo');
    const raw = input?.value?.trim() || '';
    if (!raw) { toast('Paste a URL first', 'warning'); return; }
    if (/\/products\//i.test(raw) && !/\.(jpe?g|png|webp|gif)(\?|$)/i.test(raw)) {
      toast('Resolving product URL…', 'info');
      try {
        const res = await fetch(`${apiBase()}/api/studio/product-from-url`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ url: raw }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.product?.primary_image) {
          throw new Error(data.error || 'Could not match that product URL in your catalog');
        }
        setReference({
          url: data.product.primary_image,
          type: 'image',
          title: data.product.title || 'Product',
          source: 'shopify',
          product_id: data.product.id ? String(data.product.id) : undefined,
        });
        toast('Product matched from URL', 'success');
        return;
      } catch (e) {
        toast(e.message, 'error');
        return;
      }
    }
    if (!/^https?:\/\//i.test(raw)) { toast('URL must start with https://', 'warning'); return; }
    setReference({ url: raw, type: 'image', title: 'Pasted URL', source: 'url' });
    toast('URL set as reference', 'success');
  }

  function readWorkspaceHandoff() {
    let handoff = null;
    try {
      const params = new URLSearchParams(window.location.search || '');
      const project = params.get('project') || '';
      const thread = params.get('thread') || '';
      if (project || thread) {
        handoff = {
          projectId: project,
          threadId: thread,
          projectName: params.get('projectName') || '',
          threadName: params.get('threadName') || '',
        };
      }
    } catch (_) {}
    if (!handoff) {
      try { handoff = JSON.parse(sessionStorage.getItem('se_workspace_handoff') || 'null'); } catch (_) { handoff = null; }
    }
    const s = window.__SE_COACH_CREATE_SESSION;
    if ((!handoff || (!handoff.projectName && !handoff.threadName)) && s && (s.projectId || s.projectName)) {
      handoff = {
        projectId: s.projectId || handoff?.projectId || '',
        threadId: s.threadId || handoff?.threadId || '',
        projectName: s.projectName || handoff?.projectName || '',
        threadName: s.threadName || handoff?.threadName || '',
        kind: s.kind || handoff?.kind || '',
      };
    }
    return handoff && (handoff.projectName || handoff.threadName || handoff.projectId) ? handoff : null;
  }

  function renderWorkspaceChip() {
    const chip = document.getElementById('cs-workspace-chip');
    if (!chip) return;
    const handoff = readWorkspaceHandoff();
    if (!handoff) {
      chip.style.display = 'none';
      chip.textContent = '';
      return;
    }
    const project = handoff.projectName || 'Project';
    const thread = handoff.threadName || 'chat';
    chip.style.display = 'block';
    chip.textContent = 'Working in: ' + project + ' · ' + thread;
  }

  function applyDesignCoachSession() {
    const s = window.__SE_COACH_CREATE_SESSION;
    renderWorkspaceChip();
    if (!s || s.destination !== 'design' || !s.prompt) return;
    const apply = typeof window.applyCoachCreateFields === 'function' ? window.applyCoachCreateFields : null;
    const briefEl = document.getElementById('cs-brief');
    const result = apply
      ? apply(s, { csBrief: briefEl })
      : { applied: !!briefEl, keep: true, prompt: s.prompt, attached_image_url: s.attached_image_url };
    if (!result.applied) return;
    if (briefEl) briefEl.value = result.prompt;
    _csBrief = result.prompt;
    if (result.attached_image_url) {
      setReference({
        url: result.attached_image_url,
        type: 'image',
        title: s.product_name || 'Coach still',
        source: 'coach',
      });
    }
    // A size the Coach named; the default it fills in never overrides the size picked here.
    if (s.aspect_explicit !== false) setPostSize(s.aspect_ratio);
    if (s.finished && result.attached_image_url) {
      toast('Graphic loaded. Write the caption, then Add to Queue.', 'success');
      return;
    }
    toast('Coach brief loaded — generating now…', 'success');
    applyRedesignedSlides();
    if (!_csGenerating && !masterImageUrl()) {
      setTimeout(() => { generate(); }, 0);
    }
  }

  function applyRedesignedSlides() {
    const pack = window.__SE_CAROUSEL_REDESIGN;
    if (!pack || !Array.isArray(pack.slides) || pack.slides.length < 2) return false;
    const slides = pack.slides.map((s, i) => ({
      url: s.url,
      y0: 0,
      y1: 1,
      title: s.title || `Slide ${i + 1}`,
    })).filter((s) => /^https?:\/\//i.test(s.url));
    if (slides.length < 2) return false;
    _csCarousel = {
      originalUrl: pack.master_image_url || slides[0].url,
      method: 'redesign',
      slides,
      selected: 0,
      queueOrder: identityQueueOrder(slides.length),
    };
    _csOriginalPreviewUrl = _csCarousel.originalUrl;
    _csQueueSingleUrl = null;
    if (pack.master_image_url) {
      setReference({
        url: pack.master_image_url,
        type: 'image',
        title: 'Carousel master',
        source: 'coach',
      });
    }
    renderCarouselPreview();
    return true;
  }

  // New look (html.nl): the same controls, laid out like the redesign. Every element keeps its
  // id, so the handlers bound below work unchanged. Style, size and engine come out of their
  // drawers; size becomes a segmented control; the caption gets its own card under the stage.
  function arrangePostNL(content, isCarouselMode) {
    const shell = content.querySelector('.atelier-shell');
    if (!shell) return;
    shell.classList.add('nl-post');
    const left = shell.querySelector('.atelier-essentials');
    const brief = content.querySelector('#cs-brief');
    const gen = content.querySelector('#cs-generate');
    const style = content.querySelector('#cs-style');
    const aspect = content.querySelector('#cs-aspect');
    const engine = content.querySelector('#cs-engine');
    const hint = content.querySelector('#cs-engine-hint');
    if (!left || !brief || !gen || !style || !aspect || !engine) return;
    const field = (label, forId) => {
      const w = document.createElement('div');
      w.className = 'nl-field';
      const l = document.createElement(forId ? 'label' : 'span');
      l.className = 'nl-field__label';
      l.textContent = label;
      if (forId) l.htmlFor = forId;
      w.appendChild(l);
      return w;
    };
    const opts = document.createElement('div');
    opts.className = 'nl-post__opts';
    const fStyle = field('Style', 'cs-style');
    fStyle.appendChild(style);
    const row = document.createElement('div');
    row.className = 'nl-post__row';
    const fSize = field('Size');
    const seg = document.createElement('div');
    seg.className = 'nl-seg nl-seg--fill';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Size');
    ['9:16', '4:5', '1:1'].forEach((v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = v;
      b.dataset.aspect = v;
      b.addEventListener('click', () => {
        aspect.value = v;
        aspect.dispatchEvent(new Event('change', { bubbles: true }));
        syncSeg();
      });
      seg.appendChild(b);
    });
    aspect.classList.add('nl-hidden-select');
    fSize.appendChild(seg);
    fSize.appendChild(aspect);
    const fEngine = field('Engine', 'cs-engine');
    fEngine.appendChild(engine);
    row.appendChild(fSize);
    row.appendChild(fEngine);
    opts.appendChild(fStyle);
    opts.appendChild(row);
    if (hint) { hint.classList.add('nl-hint'); opts.appendChild(hint); }
    const syncSeg = () => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.aspect === aspect.value)));
    syncSeg();
    const timer = setInterval(() => { if (!document.body.contains(seg)) clearInterval(timer); else syncSeg(); }, 700);
    // Brief's block, then the options, then the brand chip and Generate.
    const briefBlock = brief.parentElement;
    briefBlock.insertAdjacentElement('afterend', opts);
    const brand = document.createElement('div');
    brand.className = 'nl-brand-chip';
    brand.innerHTML = '<i></i><span></span>';
    brand.querySelector('span').textContent = `${_csBrandName} · colours, logo, voice`;
    brand.title = 'Your brand colours, logo and voice are applied to every design';
    opts.insertAdjacentElement('afterend', brand);
    brand.insertAdjacentElement('afterend', gen);
    gen.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>Generate design';
    // The emptied drawers go.
    left.querySelectorAll('details.atelier-drawer').forEach((d) => {
      if (!d.querySelector('input, select, textarea, button, #cs-saved-designs')) d.remove();
    });
    // Caption card under the stage.
    const bar = content.querySelector('#cs-finish-bar');
    const capBtn = content.querySelector('#cs-caption');
    const capBox = content.querySelector('#cs-caption-box');
    if (bar && capBtn && capBox) {
      const card = document.createElement('section');
      card.className = 'nl-caption';
      card.setAttribute('aria-labelledby', 'nl-caption-title');
      card.innerHTML = '<div class="nl-caption__head"><h2 id="nl-caption-title">Caption</h2><span class="nl-muted">Reads the image, watches and listens to video</span></div>';
      card.querySelector('.nl-caption__head').appendChild(capBtn);
      capBtn.textContent = 'Get caption';
      card.appendChild(capBox);
      bar.appendChild(card);
      const actions = bar.firstElementChild;
      if (actions) actions.classList.add('nl-post__actions');
    }
    // New / Save / Archive / Delete sit with the drawers, so Generate stays in view.
    const fileRow = content.querySelector('#cs-new-post')?.parentElement;
    const drawers = left.querySelector('details.atelier-drawer')?.parentElement;
    if (fileRow && drawers) { fileRow.classList.add('nl-post__file'); drawers.appendChild(fileRow); }
    const coachHead = content.querySelector('#cs-coach-rail > div');
    if (coachHead) { coachHead.textContent = 'Coach'; coachHead.classList.add('nl-coach__head'); }
  }

  /* ── New look, Post: one canvas and the Coach ──────────────────────────────
   * No Brief column. Starting a post is one line in the middle of the canvas
   * (reference and style beside it, quick starts under it); once there is a
   * post, it sits beside its caption with the queue controls, and changes go
   * through the Coach. Drafts and the rarer tools live in two small menus.
   * The original controls are moved, not copied, so every handler still runs. */
  const NL_ICON = {
    spark: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>',
    drafts: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    more: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
    image: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-9 9"/></svg>',
    style: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 100 18c1 0 1.6-.7 1.6-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16a5 5 0 005-5c0-4.3-4-7.8-9-7.8z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="10.5" r="1"/></svg>',
    clip: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.5l-8.6 8.6a5 5 0 01-7.1-7.1l9.2-9.2a3.3 3.3 0 014.7 4.7l-9.2 9.2a1.7 1.7 0 01-2.4-2.4l8.5-8.5"/></svg>',
    send: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  };

  function nlP2Starts() {
    return _csCharity
      ? [['Awareness', 'An awareness post: '], ['Fundraiser', 'A fundraiser post: '], ['Event', 'An event post: '], ['Thank you', 'A thank-you post for '], ['Story', 'A real story post: '], ['Quick tip', 'A quick tip: '], ['Diagram', '']]
      : [['Product spotlight', 'A product spotlight on '], ['Offer or sale', 'An offer post: '], ['Quick tip', 'A quick tip: '], ['Quote', 'A quote post: '], ['Event', 'An event post: '], ['Behind the scenes', 'A behind-the-scenes post: '], ['Diagram', '']];
  }

  function nlP2Menu(label, html, { icon = '', id, right = false, iconOnly = false } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'nl-p2-menu';
    wrap.innerHTML = `<button type="button" class="nl-p2-chip${iconOnly ? ' nl-p2-chip--icon' : ''}" aria-haspopup="true" aria-expanded="false" aria-controls="${id}"${iconOnly ? ` aria-label="${label}" title="${label}"` : ''}>${icon}${iconOnly ? '' : `<span>${label}</span>`}</button>
      <div class="nl-p2-pop${right ? ' nl-p2-pop--right' : ''}" id="${id}" role="menu" hidden>${html}</div>`;
    const btn = wrap.firstElementChild;
    const pop = wrap.querySelector('.nl-p2-pop');
    const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = pop.hidden;
      document.querySelectorAll('.nl-p2-pop').forEach((p) => { p.hidden = true; });
      document.querySelectorAll('.nl-p2-menu > .nl-p2-chip').forEach((b) => b.setAttribute('aria-expanded', 'false'));
      pop.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
    pop.addEventListener('click', (e) => {
      if (e.target.closest('button:not([data-keep-open]), a')) setTimeout(close, 0);
    });
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); btn.focus(); } });
    return wrap;
  }

  function nlP2MenuItem(label, onClick, { danger = false, id } = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `nl-p2-item${danger ? ' nl-p2-item--danger' : ''}`;
    b.setAttribute('role', 'menuitem');
    if (id) b.id = id;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function arrangePostMinimalNL(content) {
    const shell = content.querySelector('.atelier-shell');
    const stage = content.querySelector('.atelier-stage');
    const left = content.querySelector('.atelier-essentials');
    const brief = content.querySelector('#cs-brief');
    const gen = content.querySelector('#cs-generate');
    const wrap = content.querySelector('#cs-preview-wrap');
    const finish = content.querySelector('#cs-finish-bar');
    if (!shell || !stage || !left || !brief || !gen || !wrap || !finish) return;
    shell.classList.add('nl-post', 'nl-p2');
    const $ = (sel) => content.querySelector(sel);
    const rescue = document.createElement('div'); // controls no layout shows, still alive for their handlers
    rescue.hidden = true;
    rescue.className = 'nl-p2-rescue';

    /* Toolbar */
    const bar = document.createElement('div');
    bar.className = 'nl-p2-bar';
    const drafts = nlP2Menu('Drafts', '', { icon: NL_ICON.drafts, id: 'nl-p2-drafts' });
    const dPop = drafts.querySelector('.nl-p2-pop');
    const head = (t) => { const h = document.createElement('div'); h.className = 'nl-p2-pophead'; h.textContent = t; return h; };
    const relabel = (el, text) => { if (el) { el.textContent = text; el.className = 'nl-p2-item'; el.removeAttribute('style'); el.setAttribute('role', 'menuitem'); } return el; };
    dPop.appendChild(relabel($('#cs-new-post'), 'New post'));
    dPop.appendChild(relabel($('#cs-save-later'), 'Save for later'));
    dPop.appendChild(relabel($('#cs-save-template'), 'Save as template'));
    dPop.appendChild(head('Saved'));
    const saved = $('#cs-saved-designs');
    if (saved) { saved.removeAttribute('style'); saved.classList.add('nl-p2-saved'); dPop.appendChild(saved); }
    const sep = document.createElement('div'); sep.className = 'nl-p2-sep'; dPop.appendChild(sep);
    dPop.appendChild(relabel($('#cs-archive-design'), 'Archive'));
    const del = relabel($('#cs-delete-design'), 'Delete');
    if (del) { del.classList.add('nl-p2-item--danger'); dPop.appendChild(del); }
    bar.appendChild(drafts);
    const title = document.createElement('span');
    title.className = 'nl-p2-title';
    bar.appendChild(title);
    const sp = document.createElement('span'); sp.className = 'nl-p2-sp'; bar.appendChild(sp);
    const ws = $('#cs-workspace-chip');
    if (ws) { ws.classList.add('nl-p2-ws'); bar.appendChild(ws); }
    const brand = document.createElement('span');
    brand.className = 'nl-p2-brand';
    brand.title = 'Your brand colours, logo and voice are applied to every design';
    brand.innerHTML = '<i></i><span></span>';
    brand.querySelector('span').textContent = `${_csBrandName} brand`;
    bar.appendChild(brand);
    const aspect = $('#cs-aspect');
    const size = document.createElement('div');
    size.className = 'nl-p2-size';
    size.setAttribute('role', 'group');
    size.setAttribute('aria-label', 'Size');
    ['9:16', '4:5', '1:1'].forEach((v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = v;
      b.dataset.aspect = v;
      b.addEventListener('click', () => {
        aspect.value = v;
        aspect.dispatchEvent(new Event('change', { bubbles: true }));
        nlP2Sync();
      });
      size.appendChild(b);
    });
    if (aspect) { aspect.classList.add('nl-hidden-select'); rescue.appendChild(aspect); }
    bar.appendChild(size);
    const more = nlP2Menu('More', '', { icon: NL_ICON.more, id: 'nl-p2-more', right: true, iconOnly: true });
    const mPop = more.querySelector('.nl-p2-pop');
    mPop.appendChild(nlP2MenuItem('Edit the prompt', () => nlP2Edit(true), { id: 'nl-p2-edit' }));
    mPop.appendChild(nlP2MenuItem('Download PNG', () => $('#cs-export')?.click()));
    mPop.appendChild(nlP2MenuItem('Upload a finished graphic', () => nlP2PickFinished()));
    const engWrap = document.createElement('div');
    engWrap.className = 'nl-p2-field';
    engWrap.innerHTML = '<label for="cs-engine">Image engine</label>';
    const engine = $('#cs-engine');
    if (engine) engWrap.appendChild(engine);
    const hint = $('#cs-engine-hint');
    if (hint) { hint.removeAttribute('style'); hint.className = 'nl-p2-hint'; engWrap.appendChild(hint); }
    mPop.appendChild(head('Settings'));
    mPop.appendChild(engWrap);
    const urlWrap = document.createElement('div');
    urlWrap.className = 'nl-p2-field';
    urlWrap.innerHTML = '<label for="cs-photo">Use an image or product URL</label><div class="nl-p2-inline"></div>';
    const photo = $('#cs-photo');
    const resolve = $('#cs-resolve-url');
    if (photo && resolve) {
      resolve.textContent = 'Use';
      resolve.removeAttribute('style');
      resolve.className = 'nl-p2-btn';
      resolve.dataset.keepOpen = '1';
      urlWrap.lastElementChild.append(photo, resolve);
      mPop.appendChild(urlWrap);
    }
    const sep2 = document.createElement('div'); sep2.className = 'nl-p2-sep'; mPop.appendChild(sep2);
    mPop.appendChild(nlP2MenuItem('Making a carousel? Open Carousels', () => $('#cs-mode-carousels')?.click()));
    bar.appendChild(more);

    /* Composer: start a post (also the "Edit the prompt" sheet) */
    const compose = document.createElement('section');
    compose.className = 'nl-p2-compose';
    compose.setAttribute('aria-labelledby', 'nl-p2-ask');
    compose.innerHTML = `<div class="nl-p2-compose__in">
        <h2 id="nl-p2-ask">What are we posting?</h2>
        <p class="nl-p2-sub"></p>
        <div class="nl-p2-box"><div class="nl-p2-row">
          <button type="button" class="nl-p2-chip nl-p2-ref" id="nl-p2-ref"></button>
          <div class="nl-p2-stylewrap"></div>
          <span class="nl-p2-sp"></span>
          <button type="button" class="nl-p2-ghost" id="nl-p2-cancel" hidden>Cancel</button>
        </div></div>
        <div class="nl-p2-starts nl-p2-quick" role="group" aria-label="Quick starts"></div>
        <div class="nl-p2-drop">or <button type="button" class="nl-p2-link" id="nl-p2-finished">upload a finished graphic</button>, or drop one here</div>
        <input type="file" id="nl-p2-file" accept="image/png,image/jpeg,image/webp" hidden>
      </div>`;
    compose.querySelector('.nl-p2-sub').textContent = `Describe it in a line. ${_csBrandName}'s colours, logo and voice are applied.`;
    const box = compose.querySelector('.nl-p2-box');
    brief.setAttribute('placeholder', 'A calm poster: let your tea cool before you drink it');
    brief.setAttribute('aria-labelledby', 'nl-p2-ask');
    brief.removeAttribute('style');
    brief.rows = 2;
    box.insertBefore(brief, box.firstChild);
    gen.removeAttribute('style');
    gen.innerHTML = `${NL_ICON.spark}Generate`;
    gen.title = `Generate (${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} + Enter)`;
    compose.querySelector('.nl-p2-row').appendChild(gen);
    const styleIn = $('#cs-style');
    const styleMenu = nlP2Menu('Style', '', { icon: NL_ICON.style, id: 'nl-p2-style' });
    const sPop = styleMenu.querySelector('.nl-p2-pop');
    sPop.setAttribute('role', 'dialog');
    sPop.setAttribute('aria-label', 'Style');
    const sField = document.createElement('div');
    sField.className = 'nl-p2-field';
    sField.innerHTML = '<label for="cs-style">Style, in a few words</label>';
    if (styleIn) { styleIn.placeholder = 'Leave blank for your usual style'; sField.appendChild(styleIn); }
    sPop.appendChild(sField);
    const sSugs = document.createElement('div');
    sSugs.className = 'nl-p2-starts nl-p2-starts--small';
    ['Bold and minimal', 'Warm and photographic', 'Clean editorial', 'Playful and bright'].forEach((t) => {
      const c = document.createElement('button');
      c.type = 'button';
      c.textContent = t;
      c.dataset.keepOpen = '1';
      c.addEventListener('click', () => { styleIn.value = t; nlP2Sync(); });
      sSugs.appendChild(c);
    });
    sPop.appendChild(sSugs);
    styleIn?.addEventListener('input', () => nlP2Sync());
    compose.querySelector('.nl-p2-stylewrap').appendChild(styleMenu);
    const starts = compose.querySelector('.nl-p2-quick');
    nlP2Starts().forEach(([label, lead]) => {
      const c = document.createElement('button');
      c.type = 'button';
      c.textContent = label;
      c.addEventListener('click', () => {
        if (label === 'Diagram') {
          if (typeof window.seOpenDiagram === 'function') window.seOpenDiagram({ text: brief.value.trim(), autoDraft: !!brief.value.trim() });
          return;
        }
        const rest = brief.value.trim().replace(/^(an? [a-z -]+ (post|on|for)|a quick tip)[:]?\s*/i, '');
        brief.value = `${lead}${rest}`;
        brief.focus();
        brief.setSelectionRange(brief.value.length, brief.value.length);
      });
      starts.appendChild(c);
    });
    compose.querySelector('#nl-p2-ref').addEventListener('click', () => openPicker());
    compose.querySelector('#nl-p2-cancel').addEventListener('click', () => nlP2Edit(false));
    compose.querySelector('#nl-p2-finished').addEventListener('click', () => nlP2PickFinished());
    compose.querySelector('#nl-p2-file').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) nlP2UseFinished(f);
    });
    brief.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); gen.click(); }
    });
    gen.addEventListener('click', () => nlP2Edit(false));

    /* Result: the post beside its caption */
    const result = document.createElement('div');
    result.className = 'nl-p2-result';
    stage.insertBefore(result, wrap);
    result.appendChild(wrap);
    const side = document.createElement('aside');
    side.className = 'nl-p2-side';
    side.setAttribute('aria-label', 'Caption and posting');
    side.innerHTML = `<div class="nl-p2-caphead"><h2 id="nl-p2-cap">Caption</h2></div>
      <div class="nl-p2-capbox"></div>
      <div class="nl-p2-meta" aria-live="polite"><span class="nl-p2-count"></span><span class="nl-p2-tags"></span></div>
      <div class="nl-p2-plats" role="group" aria-label="Post to"></div>
      <div class="nl-p2-cta"></div>
      <div class="nl-p2-links"></div>`;
    const capBtn = $('#cs-caption');
    const capBox = $('#cs-caption-box');
    if (capBtn) { capBtn.removeAttribute('style'); capBtn.className = 'nl-p2-link nl-p2-link--sig'; capBtn.innerHTML = `${NL_ICON.spark}Write it for me`; side.querySelector('.nl-p2-caphead').appendChild(capBtn); }
    if (capBox) {
      capBox.removeAttribute('style');
      capBox.setAttribute('aria-labelledby', 'nl-p2-cap');
      capBox.placeholder = 'Write the caption, or let AI write it from the post.';
      side.querySelector('.nl-p2-capbox').appendChild(capBox);
      capBox.addEventListener('input', () => nlP2Sync());
    }
    const queue = $('#cs-queue');
    const exportBtn = $('#cs-export');
    if (queue) { queue.removeAttribute('style'); queue.className = 'nl-p2-primary'; side.querySelector('.nl-p2-cta').appendChild(queue); }
    if (exportBtn) { exportBtn.removeAttribute('style'); exportBtn.className = 'nl-p2-secondary'; side.querySelector('.nl-p2-cta').appendChild(exportBtn); }
    const links = side.querySelector('.nl-p2-links');
    const regen = $('#cs-regen');
    const prev = $('#cs-restore-prev');
    if (regen) { regen.removeAttribute('style'); regen.className = 'nl-p2-link'; regen.textContent = 'Regenerate'; links.appendChild(regen); }
    if (prev) { prev.removeAttribute('style'); prev.className = 'nl-p2-link'; prev.textContent = 'Previous version'; links.appendChild(prev); }
    result.appendChild(side);
    // Platforms: the connected ones, both on by default.
    const plats = side.querySelector('.nl-p2-plats');
    const defaults = connectedQueuePlatform().split(',');
    if (!Array.isArray(_nlP2Platforms) || !_nlP2Platforms.length) _nlP2Platforms = defaults.slice();
    ['Instagram', 'Facebook'].forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nl-p2-plat';
      b.dataset.plat = p;
      b.textContent = p;
      b.addEventListener('click', () => {
        const on = _nlP2Platforms.includes(p);
        if (on && _nlP2Platforms.length === 1) { toast('Post to at least one platform', 'warning'); return; }
        _nlP2Platforms = on ? _nlP2Platforms.filter((x) => x !== p) : [..._nlP2Platforms, p];
        nlP2Sync();
      });
      plats.appendChild(b);
    });

    /* Stage parts no longer shown, kept for their handlers */
    const header = $('#cs-preview-header');
    if (header) header.hidden = true;
    finish.hidden = true;
    rescue.append(...[...finish.querySelectorAll('button, textarea')].filter((el) => !side.contains(el)));
    left.hidden = true;
    stage.insertBefore(bar, result);
    stage.insertBefore(compose, result);
    stage.appendChild(rescue);
    // Drop a finished graphic anywhere on the canvas.
    stage.addEventListener('dragover', (e) => {
      if (![...(e.dataTransfer?.items || [])].some((it) => it.kind === 'file')) return;
      e.preventDefault();
      stage.classList.add('nl-p2--drop');
    });
    stage.addEventListener('dragleave', (e) => { if (!stage.contains(e.relatedTarget)) stage.classList.remove('nl-p2--drop'); });
    stage.addEventListener('drop', (e) => {
      const f = [...(e.dataTransfer?.files || [])].find((x) => /^image\//.test(x.type));
      stage.classList.remove('nl-p2--drop');
      if (!f) return;
      e.preventDefault();
      nlP2UseFinished(f);
    });

    /* Coach: same conversation, quieter chrome */
    const coachHead = $('#cs-coach-rail > div');
    if (coachHead) { coachHead.innerHTML = `${NL_ICON.spark}<span>Coach</span>`; coachHead.classList.add('nl-coach__head'); }
    const send = $('#cs-coach-send');
    const attach = $('#cs-coach-style');
    const input = $('#cs-coach-input');
    if (send && attach && input) {
      send.innerHTML = NL_ICON.send;
      send.setAttribute('aria-label', 'Send');
      send.title = 'Send';
      attach.innerHTML = NL_ICON.clip;
      attach.setAttribute('aria-label', 'Add a style reference photo');
      attach.title = 'Add a style reference photo';
      input.placeholder = 'Ask for a change…';
      input.dataset.placeholder = 'Ask for a change…';
      const row = send.parentElement;
      row.classList.add('nl-p2-coachin');
      row.insertBefore(input, send);
      const sugs = document.createElement('div');
      sugs.className = 'nl-p2-sugs';
      sugs.setAttribute('role', 'group');
      sugs.setAttribute('aria-label', 'Quick changes');
      ['Make it brighter', 'Bigger headline', 'Shorter text', 'Try it with a photo', 'Add our logo'].forEach((t) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = t;
        b.addEventListener('click', () => designCoachAsk(t));
        sugs.appendChild(b);
      });
      row.parentElement.insertBefore(sugs, row.parentElement.firstChild);
    }

    _nlP2 = { root: shell, stage, bar, title, size, compose, result, side, brief, styleMenu, ref: compose.querySelector('#nl-p2-ref'), plats, editing: false };
    const tick = setInterval(() => { if (!document.body.contains(shell)) clearInterval(tick); else nlP2Sync(); }, 800);
    document.addEventListener('click', nlP2CloseMenus);
    nlP2Sync();
  }

  function nlP2CloseMenus(e) {
    if (e && e.target && e.target.closest && e.target.closest('.nl-p2-menu')) return;
    document.querySelectorAll('.nl-p2-pop').forEach((p) => { p.hidden = true; });
    document.querySelectorAll('.nl-p2-menu > .nl-p2-chip').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }

  function nlP2PickFinished() {
    document.getElementById('nl-p2-file')?.click();
  }

  async function nlP2UseFinished(file) {
    try {
      toast('Uploading your graphic…', 'info');
      const url = await uploadStudioImage(file);
      if (!url) throw new Error('Upload failed');
      _nlP2Finished = true;
      setReference({ url, type: 'image', title: file.name || 'Finished graphic', source: 'upload' });
      nlP2Sync();
    } catch (e) {
      toast(e.message || 'Upload failed', 'error');
    }
  }

  /** Show the composer over the post to change the prompt and generate again. */
  function nlP2Edit(on) {
    if (!_nlP2) return;
    _nlP2.editing = !!on;
    nlP2Sync();
    if (on) setTimeout(() => _nlP2 && _nlP2.brief.focus(), 0);
  }

  /** Which view the canvas shows, and the small labels that follow the state. */
  function nlP2Sync() {
    const p = _nlP2;
    if (!p || !document.body.contains(p.root)) return;
    const hasPost = !!(_csGeneratedUrl || _csHtml || _csScene || hasCarousel() || _csGenerating || (_nlP2Finished && _csOriginalPreviewUrl));
    p.root.classList.toggle('nl-p2--result', hasPost);
    p.root.classList.toggle('nl-p2--compose', !hasPost);
    p.root.classList.toggle('nl-p2--editing', hasPost && p.editing);
    if (!hasPost) p.editing = false;
    const cancel = p.compose.querySelector('#nl-p2-cancel');
    if (cancel) cancel.hidden = !p.editing;
    const ask = p.compose.querySelector('#nl-p2-ask');
    if (ask) ask.textContent = p.editing ? 'Change the prompt' : 'What are we posting?';
    const edit = document.getElementById('nl-p2-edit');
    if (edit) edit.hidden = !hasPost || _nlP2Finished;
    const brief = String(p.brief.value || _csBrief || '').replace(/\s+/g, ' ').trim();
    p.title.textContent = hasPost ? (_nlP2Finished && !brief ? 'Finished graphic' : brief || 'Untitled post') : '';
    p.title.title = brief;
    const aspect = document.getElementById('cs-aspect');
    p.size.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(!!aspect && b.dataset.aspect === aspect.value)));
    // Reference chip: the photo the design starts from (not the design itself).
    const ref = _csRef && _csRef.source !== 'generate' && !_nlP2Finished ? _csRef : null;
    const refHtml = ref
      ? `<img src="${escapeHtml(mediaSrc(ref.poster_url || ref.url))}" alt="" referrerpolicy="no-referrer"><span>${escapeHtml(String(ref.title || 'Reference').slice(0, 24))}</span>`
      : `${NL_ICON.image}<span>Reference</span>`;
    if (p.ref.dataset.html !== refHtml) {
      p.ref.innerHTML = refHtml;
      p.ref.dataset.html = refHtml;
      p.ref.setAttribute('aria-label', ref ? `Reference: ${ref.title || 'photo'}. Change it` : 'Add a reference photo or product');
    }
    const style = document.getElementById('cs-style');
    const sLabel = p.styleMenu.querySelector('.nl-p2-chip > span');
    if (sLabel) sLabel.textContent = style && style.value.trim() ? `Style: ${style.value.trim().slice(0, 22)}` : 'Style';
    // Caption: length and hashtags; platform toggles.
    const cap = document.getElementById('cs-caption-box');
    const text = cap ? cap.value : '';
    const count = p.side.querySelector('.nl-p2-count');
    const tags = (text.match(/#[\p{L}\p{N}_]+/gu) || []).length;
    if (count) {
      count.textContent = `${text.length.toLocaleString()} / 2,200`;
      count.classList.toggle('nl-p2-over', text.length > 2200);
    }
    const tagEl = p.side.querySelector('.nl-p2-tags');
    if (tagEl) tagEl.textContent = tags ? `${tags} hashtag${tags === 1 ? '' : 's'}` : '';
    p.plats.querySelectorAll('.nl-p2-plat').forEach((b) => b.setAttribute('aria-pressed', String((_nlP2Platforms || []).includes(b.dataset.plat))));
    const queue = document.getElementById('cs-queue');
    if (queue && !/…|✓/.test(queue.textContent)) queue.textContent = hasCarousel() ? 'Add slides to Queue' : 'Add to Queue';
    const exp = document.getElementById('cs-export');
    if (exp) exp.textContent = hasCarousel() ? 'Download ZIP' : 'Download';
    // Only what applies to this post is shown: nothing greyed out.
    [['cs-export', exp], ['cs-regen', document.getElementById('cs-regen')], ['cs-restore-prev', document.getElementById('cs-restore-prev')]].forEach(([, el]) => {
      if (el) el.classList.toggle('nl-p2-na', !!el.disabled);
    });
    const loading = document.getElementById('cs-loading');
    if (loading) {
      const r = (aspect && aspect.value) || '9:16';
      loading.dataset.ratio = r;
      loading.style.setProperty('--nl-p2-ratio', r.replace(':', ' / '));
    }
    const sugs = p.root.querySelector('.nl-p2-sugs');
    if (sugs) sugs.hidden = !hasPost || _csGenerating || !(_csGeneratedUrl || _csHtml);
    // Buttons that write their own plain labels get their icon back once idle.
    const gen = document.getElementById('cs-generate');
    if (gen && !_csGenerating && /^Generate( design)?$/.test(gen.textContent.trim()) && !gen.querySelector('svg')) gen.innerHTML = `${NL_ICON.spark}Generate`;
    const capBtn = document.getElementById('cs-caption');
    if (capBtn && /^Get caption$/i.test(capBtn.textContent.trim())) capBtn.innerHTML = `${NL_ICON.spark}Write it for me`;
  }

  function renderClaudeStudio() {
    const content = document.getElementById('dash-content');
    if (!content) return;
    // 'post' = Create → Post (single posts). 'carousel' = Create → Carousels → Infographic or finished slides.
    const csMode = window.__SE_CS_MODE === 'carousel' ? 'carousel' : 'post';
    const isCarouselMode = csMode === 'carousel';

    const data = window._studioClientData || window.__clientData || window.clientData || {};
    _csBrandName = data?.client?.business_name || data?.business_name || 'Your Brand';
    _csCharity = /charit|nonprofit|non-profit/i.test(String(data?.client?.client_type || data?.client_type || ''));
    _csHtml = '';
    _csGeneratedUrl = null;
    _csBrief = '';
    _csCarousel = null;
    _csOriginalPreviewUrl = null;
    _csQueueSingleUrl = null;

    // Inherit shared reference (e.g. from Video Studio upload)
    if (window._studioReference && window._studioReference.url) {
      _csRef = { ...window._studioReference };
    } else if (window.vsUploadedImageUrl || window._vsUploadedImageUrl) {
      const url = window.vsUploadedImageUrl || window._vsUploadedImageUrl;
      _csRef = { url, type: 'image', title: 'Studio upload', source: 'upload' };
      window._studioReference = { ..._csRef };
    } else {
      _csRef = null;
    }

    content.innerHTML = `
      <div class="atelier-shell" style="display:flex;height:calc(100vh - 56px);overflow:hidden;">
        <div class="atelier-essentials" style="width:300px;min-width:280px;border-right:1px solid rgba(255,255,255,0.07);overflow-y:auto;padding:22px 18px;display:flex;flex-direction:column;gap:16px;background:rgba(8,12,22,0.92);">
          <div>
            <div style="font-family:var(--font-display);font-size:1.35rem;font-weight:700;color:#fff;letter-spacing:-0.03em;">${isCarouselMode ? 'Carousels' : 'Post'}</div>
            <div style="font-size:0.72rem;color:rgba(255,255,255,0.38);margin-top:4px;line-height:1.4;">${isCarouselMode ? 'Infographic or finished slides · brand locked' : 'Still · story · brand locked'}</div>
            ${isCarouselMode
              ? `<button type="button" id="cs-mode-brand" style="margin-top:10px;padding:0;background:none;border:none;color:rgba(255,255,255,0.6);font-size:0.72rem;font-weight:600;cursor:pointer;font-family:var(--font-body);text-decoration:underline;">← Brand template carousels</button>`
              : `<button type="button" id="cs-mode-carousels" style="margin-top:10px;padding:0;background:none;border:none;color:rgba(255,255,255,0.6);font-size:0.72rem;font-weight:600;cursor:pointer;font-family:var(--font-body);text-decoration:underline;">Making a carousel? Open Carousels →</button>`}
          </div>
          <div id="cs-workspace-chip" style="display:none;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);font-size:0.72rem;color:rgba(255,255,255,0.72);font-weight:600;line-height:1.35;"></div>
          <div style="display:flex;gap:4px;">
            <button type="button" id="cs-new-post" title="New post" style="flex:1;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:rgba(255,255,255,0.7);font-size:0.68rem;font-weight:600;cursor:pointer;font-family:var(--font-body);">New</button>
            <button type="button" id="cs-save-later" title="Save for later" style="flex:1;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:rgba(255,255,255,0.7);font-size:0.68rem;font-weight:600;cursor:pointer;font-family:var(--font-body);">Save</button>
            <button type="button" id="cs-archive-design" title="Archive" style="flex:1;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:rgba(255,255,255,0.55);font-size:0.68rem;font-weight:600;cursor:pointer;font-family:var(--font-body);">Archive</button>
            <button type="button" id="cs-delete-design" title="Delete" style="flex:1;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:transparent;color:rgba(252,165,165,0.75);font-size:0.68rem;font-weight:600;cursor:pointer;font-family:var(--font-body);">Delete</button>
          </div>

          <div>
            <div style="font-size:0.65rem;font-weight:700;color:rgba(255,255,255,0.32);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Reference</div>
            <div id="cs-ref-summary" style="padding:12px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.08);border-radius:12px;"></div>
          </div>

          <div>
            <div style="font-size:0.65rem;font-weight:700;color:rgba(255,255,255,0.32);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Brief</div>
            <textarea id="cs-brief" rows="5" placeholder="Caption for a finished graphic, or describe the design to generate…" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.09);border-radius:12px;padding:12px;color:#fff;font-size:0.84rem;font-family:var(--font-body);line-height:1.5;resize:vertical;outline:none;"></textarea>
          </div>

          <button type="button" id="cs-generate" style="width:100%;padding:14px;background:#fff;border:none;border-radius:12px;color:#0A0F1A;font-size:0.88rem;font-weight:700;cursor:pointer;font-family:var(--font-body);letter-spacing:-0.01em;">Generate design</button>

          <div style="display:flex;flex-direction:column;gap:8px;">
            <details class="atelier-drawer" style="border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:0;background:rgba(255,255,255,0.015);">
              <summary style="font-size:0.72rem;color:rgba(255,255,255,0.5);cursor:pointer;font-weight:600;padding:10px 12px;list-style:none;display:flex;justify-content:space-between;align-items:center;">
                <span>Style &amp; aspect</span><span style="opacity:0.45;font-size:0.65rem;">▸</span>
              </summary>
              <div style="padding:0 12px 12px;display:flex;flex-direction:column;gap:10px;">
                <input id="cs-style" type="text" placeholder="Bold typographic, dark, minimal" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:9px 11px;color:#fff;font-size:0.79rem;font-family:var(--font-body);outline:none;">
                <select id="cs-aspect" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:9px 11px;color:#fff;font-size:0.79rem;font-family:var(--font-body);outline:none;">
                  <option value="9:16" selected>9:16 portrait</option>
                  <option value="1:1">1:1 square</option>
                  <option value="4:5">4:5 portrait</option>
                </select>
              </div>
            </details>

            <details class="atelier-drawer" style="border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:0;background:rgba(255,255,255,0.015);">
              <summary style="font-size:0.72rem;color:rgba(255,255,255,0.5);cursor:pointer;font-weight:600;padding:10px 12px;list-style:none;display:flex;justify-content:space-between;align-items:center;">
                <span>Engine</span><span style="opacity:0.45;font-size:0.65rem;">▸</span>
              </summary>
              <div style="padding:0 12px 12px;display:flex;flex-direction:column;gap:8px;">
                <label for="cs-engine" style="font-size:0.65rem;color:rgba(255,255,255,0.38);font-weight:600;">Still model</label>
                <select id="cs-engine" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:9px 11px;color:#fff;font-size:0.79rem;font-family:var(--font-body);outline:none;">
                  <option value="auto">Auto (recommended)</option>
                </select>
                <div id="cs-engine-hint" style="font-size:0.65rem;color:rgba(255,255,255,0.32);line-height:1.45;">Auto picks for this account. Stick with a model you’ve liked.</div>
              </div>
            </details>

            <details class="atelier-drawer" id="cs-carousel-drawer"${isCarouselMode ? ' open' : ' hidden'} style="border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:0;background:rgba(255,255,255,0.015);">
              <summary style="font-size:0.72rem;color:rgba(255,255,255,0.5);cursor:pointer;font-weight:600;padding:10px 12px;list-style:none;display:flex;justify-content:space-between;align-items:center;">
                <span>Carousel</span><span style="opacity:0.45;font-size:0.65rem;">▸</span>
              </summary>
              <div style="padding:0 12px 12px;">
                <input id="cs-infographic-file" type="file" accept="image/png,image/jpeg,image/webp" multiple style="display:none;">
                <input id="cs-slides-file" type="file" accept="image/png,image/jpeg,image/webp" multiple style="display:none;">
                <button type="button" id="cs-upload-infographic" style="width:100%;padding:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:9px;color:rgba(255,255,255,0.8);font-size:0.78rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Upload infographic</button>
                <button type="button" id="cs-upload-slides" style="width:100%;margin-top:8px;padding:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:9px;color:rgba(255,255,255,0.8);font-size:0.78rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Upload slides</button>
                <button type="button" id="cs-split-carousel" disabled style="width:100%;margin-top:8px;padding:10px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.28);border-radius:9px;color:rgba(255,255,255,0.35);font-size:0.78rem;font-weight:700;cursor:not-allowed;font-family:var(--font-body);opacity:0.5;">Redesign as carousel</button>
                <div style="display:flex;gap:6px;align-items:center;margin-top:8px;">
                  <button type="button" id="cs-build-template" disabled style="flex:1;padding:10px;background:rgba(124,58,237,0.14);border:1px solid rgba(124,58,237,0.4);border-radius:9px;color:#E9D5FF;font-size:0.78rem;font-weight:700;cursor:not-allowed;font-family:var(--font-body);opacity:0.5;">Build in brand template</button>
                  <select id="cs-tpl-count" title="Slides" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:7px;color:#fff;padding:8px 6px;font-size:0.75rem;font-family:var(--font-body);">
                    ${[3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}" ${n === 6 ? 'selected' : ''}>${n}</option>`).join('')}
                  </select>
                </div>
                <div style="font-size:0.65rem;color:rgba(255,255,255,0.32);line-height:1.45;margin-top:8px;">Tall graphic → redesign each slide · or drop 2–10 cut slides (max 10). Brand template uses your saved layout, fonts and colours.</div>
              </div>
            </details>

            <details class="atelier-drawer" style="border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:0;background:rgba(255,255,255,0.015);">
              <summary style="font-size:0.72rem;color:rgba(255,255,255,0.5);cursor:pointer;font-weight:600;padding:10px 12px;list-style:none;display:flex;justify-content:space-between;align-items:center;">
                <span>Saved &amp; templates</span><span style="opacity:0.45;font-size:0.65rem;">▸</span>
              </summary>
              <div style="padding:0 12px 12px;">
                <div id="cs-saved-designs" style="padding:10px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:10px;"></div>
                <button type="button" id="cs-save-template" style="width:100%;margin-top:8px;padding:9px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:9px;color:rgba(255,255,255,0.75);font-size:0.74rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Save as template</button>
                <div id="cs-brand-templates"${isCarouselMode ? '' : ' hidden'} style="margin-top:12px;"></div>
              </div>
            </details>

            <details class="atelier-drawer" style="border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:0;background:rgba(255,255,255,0.015);">
              <summary style="font-size:0.72rem;color:rgba(255,255,255,0.5);cursor:pointer;font-weight:600;padding:10px 12px;list-style:none;display:flex;justify-content:space-between;align-items:center;">
                <span>Advanced · URL</span><span style="opacity:0.45;font-size:0.65rem;">▸</span>
              </summary>
              <div style="padding:0 12px 12px;display:flex;flex-direction:column;gap:8px;">
                <input id="cs-photo" type="url" placeholder="Image URL or Shopify product URL" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:9px 11px;color:#fff;font-size:0.79rem;font-family:var(--font-body);outline:none;">
                <button type="button" id="cs-resolve-url" style="padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.65);font-size:0.72rem;font-weight:600;cursor:pointer;font-family:var(--font-body);">Use URL</button>
              </div>
            </details>
          </div>

          <div style="margin-top:auto;padding:12px;border-top:1px solid rgba(255,255,255,0.06);">
            <div style="font-size:0.62rem;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Branded as</div>
            <div style="font-size:0.82rem;font-weight:600;color:rgba(255,255,255,0.78);" id="cs-brand-pill">${escapeHtml(_csBrandName)}</div>
            <div style="font-size:0.68rem;color:rgba(255,255,255,0.3);margin-top:2px;">Colors, logo &amp; voice applied</div>
          </div>
        </div>

        <div class="atelier-stage" style="flex:1;display:flex;flex-direction:column;overflow:hidden;background:radial-gradient(ellipse at 50% 30%,rgba(255,255,255,0.03),transparent 55%),rgba(6,10,18,0.95);">
          <div id="cs-preview-header" style="padding:12px 18px;border-bottom:1px solid rgba(255,255,255,0.06);font-size:0.7rem;color:rgba(255,255,255,0.35);letter-spacing:0.04em;text-transform:uppercase;font-weight:600;">Stage · 9:16</div>
          <div id="cs-preview-wrap" style="flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;padding:36px 28px;">
            <div id="cs-empty" style="text-align:center;max-width:400px;">
              <div style="font-family:var(--font-display);font-size:1.5rem;font-weight:700;color:rgba(255,255,255,0.78);margin-bottom:10px;letter-spacing:-0.03em;">Stage</div>
              <div style="font-size:0.88rem;color:rgba(255,255,255,0.35);line-height:1.65;">${isCarouselMode ? 'Upload a tall infographic to split or redesign into slides, or upload 2–10 finished slides and Add to Queue.' : 'Choose a reference, write a brief, Generate — or drop a finished graphic and Add to Queue. Carousels have their own tab.'}</div>
            </div>
            <div id="cs-loading" style="display:none;text-align:center;">
              <div style="width:52px;height:52px;border:3px solid rgba(124,58,237,0.2);border-top-color:#7C3AED;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 20px;"></div>
              <div id="cs-loading-msg" style="font-size:0.9rem;color:rgba(255,255,255,0.5);">Generating on-brand design…</div>
            </div>
            <div id="cs-frame" style="display:none;position:relative;">
              <iframe id="cs-iframe" style="border:none;display:block;border-radius:4px;background:#fff;" scrolling="no"></iframe>
            </div>
            <div id="cs-original-preview" style="display:none;max-width:min(420px,100%);text-align:center;">
              <img id="cs-original-preview-img" alt="Infographic" style="max-width:100%;max-height:min(70vh,640px);border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:#111;">
            </div>
            <div id="cs-scene-preview" style="display:none;max-width:min(420px,100%);text-align:center;"></div>
            <div id="cs-carousel" style="display:none;width:min(640px,100%);">
              <div id="cs-slide-hero" style="display:none;margin:0 auto 16px;max-width:min(420px,100%);text-align:center;"></div>
              <div id="cs-slide-strip" style="display:flex;gap:8px;overflow-x:auto;padding-bottom:8px;"></div>
              <div id="cs-cut-canvas" style="margin-top:12px;"></div>
              <div id="cs-tpl-editor"></div>
              <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px;">
                <button type="button" id="cs-slide-delete" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(248,113,113,0.35);background:rgba(248,113,113,0.1);color:#FCA5A5;font-size:0.72rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Delete selected</button>
                <button type="button" id="cs-slide-redo" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(16,185,129,0.35);background:rgba(16,185,129,0.1);color:#6EE7B7;font-size:0.72rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Redo selected</button>
                <button type="button" id="cs-slide-left" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.75);font-size:0.72rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Move left</button>
                <button type="button" id="cs-slide-right" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.75);font-size:0.72rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Move right</button>
                <button type="button" id="cs-slide-reel" title="Animate these slides into a vertical Reel" style="display:none;padding:8px 12px;border-radius:8px;border:1px solid rgba(34,197,94,0.35);background:rgba(34,197,94,0.1);color:#86EFAC;font-size:0.72rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">▶ Make it a Reel</button>
                <label id="cs-slide-count-wrap" style="margin-left:auto;font-size:0.72rem;color:rgba(255,255,255,0.45);display:flex;align-items:center;gap:8px;">Slides
                  <select id="cs-slide-count" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:7px;color:#fff;padding:6px 8px;font-size:0.75rem;font-family:var(--font-body);">
                    <option value="3">3</option>
                    <option value="4">4</option>
                    <option value="5">5</option>
                    <option value="6">6</option>
                    <option value="7">7</option>
                    <option value="8">8</option>
                    <option value="9">9</option>
                    <option value="10">10</option>
                  </select>
                </label>
              </div>
            </div>
          </div>
          <div id="cs-finish-bar" style="padding:12px 16px;border-top:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              <button type="button" id="cs-export" disabled style="padding:9px 12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:rgba(255,255,255,0.35);font-size:0.78rem;font-weight:600;cursor:not-allowed;font-family:var(--font-body);">Export PNG</button>
              <button type="button" id="cs-queue" disabled style="padding:9px 12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:rgba(255,255,255,0.35);font-size:0.78rem;font-weight:600;cursor:not-allowed;font-family:var(--font-body);">Add to Queue</button>
              <button type="button" id="cs-regen" disabled style="padding:9px 12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:rgba(255,255,255,0.35);font-size:0.78rem;font-weight:600;cursor:not-allowed;font-family:var(--font-body);">Regenerate</button>
              <button type="button" id="cs-restore-prev" disabled title="Restore the previous Stage poster" style="padding:9px 12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:rgba(255,255,255,0.35);font-size:0.78rem;font-weight:600;cursor:not-allowed;font-family:var(--font-body);">Restore previous</button>
              <button type="button" id="cs-caption" disabled style="padding:9px 12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:rgba(255,255,255,0.35);font-size:0.78rem;font-weight:600;cursor:not-allowed;font-family:var(--font-body);">Get Caption</button>
            </div>
            <textarea id="cs-caption-box" rows="3" placeholder="Paste your caption here — or Get Caption after you describe the post." style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:9px;padding:10px;min-height:56px;font-size:0.75rem;color:rgba(255,255,255,0.75);font-family:var(--font-body);line-height:1.5;resize:vertical;outline:none;"></textarea>
          </div>
        </div>

        <div id="cs-coach-rail" class="atelier-inspector" style="width:320px;min-width:280px;border-left:1px solid rgba(255,255,255,0.07);display:flex;flex-direction:column;background:rgba(8,12,22,0.92);min-height:0;">
          <div style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.06);font-size:0.65rem;font-weight:700;color:rgba(255,255,255,0.32);text-transform:uppercase;letter-spacing:0.08em;">Inspector · Coach</div>
          <div id="cs-coach-log" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;min-height:0;"></div>
          <div id="cs-coach-apply-wrap" style="display:none;padding:0 12px 8px;">
            <button type="button" id="cs-coach-apply" style="width:100%;padding:10px;background:linear-gradient(135deg,#059669,#34D399);border:none;border-radius:8px;color:#fff;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Apply</button>
          </div>
          <div style="padding:10px 12px 14px;border-top:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;gap:8px;">
            <div id="cs-coach-status" style="display:none;align-items:center;gap:8px;padding:7px 10px;background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.22);border-radius:8px;font-size:0.72rem;color:#DDD6FE;font-family:var(--font-body);line-height:1.35;">
              <span style="width:8px;height:8px;border-radius:50%;background:#A78BFA;flex-shrink:0;animation:pulse-dot 1.2s ease-in-out infinite;"></span>
              <span id="cs-coach-status-text">Coach is reading…</span>
            </div>
            <div id="cs-coach-style-chip" style="display:none;flex-direction:column;gap:6px;"></div>
            <input id="cs-coach-style-file" type="file" accept="image/png,image/jpeg,image/webp" multiple style="display:none;">
            <textarea id="cs-coach-input" rows="2" placeholder="Ask your coach…" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:9px 10px;color:#fff;font-size:0.78rem;font-family:var(--font-body);line-height:1.45;resize:none;outline:none;min-height:52px;max-height:160px;overflow-y:auto;"></textarea>
            <div style="display:flex;gap:8px;">
              <button type="button" id="cs-coach-style" style="flex:1;padding:9px 10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:rgba(255,255,255,0.75);font-size:0.74rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">+ Reference photo</button>
              <button type="button" id="cs-coach-send" style="flex:1;padding:9px 12px;background:linear-gradient(135deg,#7C3AED,#4F46E5);border:none;border-radius:8px;color:#fff;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Send</button>
            </div>
          </div>
        </div>
      </div>

      <div id="cs-picker-modal" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.65);align-items:center;justify-content:center;padding:24px;">
        <div style="width:min(820px,100%);max-height:min(80vh,720px);background:#0F172A;border:1px solid rgba(255,255,255,0.1);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;">
          <div style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div style="font-family:var(--font-display);font-size:1.05rem;font-weight:700;color:#fff;">Choose reference</div>
            <button type="button" id="cs-picker-close" style="background:none;border:none;color:rgba(255,255,255,0.45);font-size:1.2rem;cursor:pointer;">×</button>
          </div>
          <div style="display:flex;gap:6px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);">
            <button type="button" id="cs-tab-products" style="flex:1;padding:8px;border:none;border-radius:8px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Products</button>
            <button type="button" id="cs-tab-library" style="flex:1;padding:8px;border:none;border-radius:8px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Past posts</button>
            <button type="button" id="cs-tab-uploads" style="flex:1;padding:8px;border:none;border-radius:8px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Uploads</button>
          </div>
          <div style="flex:1;overflow:auto;padding:14px;">
            <div id="cs-panel-products">
              <input id="cs-product-search" type="search" placeholder="Search products…" style="width:100%;box-sizing:border-box;margin-bottom:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:#fff;font-size:0.8rem;font-family:var(--font-body);outline:none;">
              <div id="cs-products-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;"></div>
            </div>
            <div id="cs-panel-library" style="display:none;">
              <div id="cs-library-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;"></div>
            </div>
            <div id="cs-panel-uploads" style="display:none;">
              <div id="cs-session-upload"></div>
            </div>
          </div>
        </div>
      </div>

      <div id="cs-export-mount" style="position:fixed;left:-10000px;top:0;width:1080px;height:1080px;overflow:hidden;pointer-events:none;"></div>
    `;
    if (document.documentElement.classList.contains('nl')) {
      if (isCarouselMode) arrangePostNL(content, isCarouselMode);
      else arrangePostMinimalNL(content);
    }

    renderRefSummary();
    syncSplitButton();

    document.getElementById('cs-new-post')?.addEventListener('click', () => {
      startFresh({ keepStyles: false });
      toast('Blank post', 'info');
    });
    document.getElementById('cs-save-later')?.addEventListener('click', () => saveDesignForLater());
    document.getElementById('cs-archive-design')?.addEventListener('click', () => archiveCurrentDesign());
    document.getElementById('cs-delete-design')?.addEventListener('click', () => deleteCurrentDesign());
    document.getElementById('cs-save-template')?.addEventListener('click', () => saveOpenTemplate());
    document.getElementById('cs-generate')?.addEventListener('click', () => generate());
    document.getElementById('cs-regen')?.addEventListener('click', () => generate());
    document.getElementById('cs-restore-prev')?.addEventListener('click', () => restorePreviousPoster());
    document.getElementById('cs-engine')?.addEventListener('change', (e) => {
      const id = e?.target?.value || 'auto';
      writeStickyEngine(id);
      const hint = document.getElementById('cs-engine-hint');
      const cur = (_csEngines || []).find((x) => x.id === id);
      if (hint) {
        hint.textContent = (cur && cur.description)
          || 'Auto picks for this account. Stick with a model you’ve liked.';
      }
    });
    loadDesignEngines();
    document.getElementById('cs-export')?.addEventListener('click', () => exportPng(false));
    document.getElementById('cs-coach-send')?.addEventListener('click', () => designCoachAsk());
    document.getElementById('cs-coach-style')?.addEventListener('click', () => {
      if (_csCoachStyleUrls.length >= CS_MAX_STYLE_REFS) {
        toast('10 reference photos max', 'error');
        return;
      }
      document.getElementById('cs-coach-style-file')?.click();
    });
    document.getElementById('cs-coach-style-file')?.addEventListener('change', async (e) => {
      const files = Array.from(e.target?.files || []);
      e.target.value = '';
      if (!files.length) return;
      try {
        let added = 0;
        for (const file of files) {
          if (_csCoachStyleUrls.length >= CS_MAX_STYLE_REFS) {
            toast('10 reference photos max', 'error');
            break;
          }
          const url = await uploadStudioImage(file);
          if (!url) throw new Error('Upload failed');
          if (_csCoachStyleUrls.includes(url)) continue;
          _csCoachStyleUrls.push(url);
          added += 1;
        }
        renderCoachStyleChip();
        if (added) loadDesignEngines();
        if (added === 1) toast('Style reference attached', 'success');
        else if (added > 1) toast(`${added} style references attached`, 'success');
      } catch (err) {
        toast(err.message || 'Upload failed', 'error');
      }
    });
    document.getElementById('cs-coach-apply')?.addEventListener('click', () => applyPendingDesignCoach());
    const coachInputEl = document.getElementById('cs-coach-input');
    if (coachInputEl) {
      const autosizeCoachInput = () => {
        coachInputEl.style.height = 'auto';
        const maxPx = parseFloat(getComputedStyle(coachInputEl).maxHeight) || 160;
        coachInputEl.style.height = Math.min(coachInputEl.scrollHeight, maxPx) + 'px';
      };
      coachInputEl.addEventListener('input', autosizeCoachInput);
      coachInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          designCoachAsk();
        }
      });
      autosizeCoachInput();
    }
    document.getElementById('cs-queue')?.addEventListener('click', () => exportPng(true));
    document.getElementById('cs-caption')?.addEventListener('click', () => getCaption());
    document.getElementById('cs-resolve-url')?.addEventListener('click', () => resolveAdvancedUrl());
    document.getElementById('cs-upload-infographic')?.addEventListener('click', () => {
      document.getElementById('cs-infographic-file')?.click();
    });
    document.getElementById('cs-infographic-file')?.addEventListener('change', (e) => {
      const files = e.target?.files ? Array.from(e.target.files) : [];
      if (files.length >= 2) uploadSlideFiles(files);
      else if (files[0]) uploadInfographicFile(files[0]);
      e.target.value = '';
    });
    document.getElementById('cs-upload-slides')?.addEventListener('click', () => {
      document.getElementById('cs-slides-file')?.click();
    });
    document.getElementById('cs-slides-file')?.addEventListener('change', (e) => {
      const files = e.target?.files ? Array.from(e.target.files) : [];
      if (files.length) uploadSlideFiles(files);
      e.target.value = '';
    });
    document.getElementById('cs-split-carousel')?.addEventListener('click', () => {
      const url = masterImageUrl();
      const seed = CS_CAROUSEL_SEED;
      window._seCoachAttachedImage = url;
      window.__SE_COACH_MASTER_IMAGE = url;
      designCoachAsk(seed);
    });
    document.getElementById('cs-slide-delete')?.addEventListener('click', () => deleteSelectedSlide());
    document.getElementById('cs-slide-redo')?.addEventListener('click', () => redoSelectedSlide());
    document.getElementById('cs-build-template')?.addEventListener('click', () => {
      const plan = window.__SE_CAROUSEL_PLAN && Array.isArray(window.__SE_CAROUSEL_PLAN.slides) ? window.__SE_CAROUSEL_PLAN.slides : null;
      buildTemplateCarousel({ plan });
    });
    if (window.seCarouselTemplates) {
      window.seCarouselTemplates.mountSection(document.getElementById('cs-brand-templates'), { uploadImage: uploadStudioImage });
      if (!_csTplListening) {
        _csTplListening = true;
        window.seCarouselTemplates.onChange(() => syncTemplateButton());
      }
    }
    syncTemplateButton();
    document.getElementById('cs-slide-left')?.addEventListener('click', () => moveSelectedSlide(-1));
    document.getElementById('cs-slide-right')?.addEventListener('click', () => moveSelectedSlide(1));
    document.getElementById('cs-slide-reel')?.addEventListener('click', () => {
      const urls = reelSlideUrls();
      if (!urls.length || typeof window.seOpenMotionReel !== 'function') return;
      const cap = document.getElementById('cs-caption-box')?.value || '';
      window.seOpenMotionReel({ kind: 'carousel', slides: urls, name: cap.split('\n')[0].slice(0, 60) });
    });
    document.getElementById('cs-picker-close')?.addEventListener('click', closePicker);
    document.getElementById('cs-picker-modal')?.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'cs-picker-modal') closePicker();
    });
    document.getElementById('cs-tab-products')?.addEventListener('click', () => setPickerTab('products'));
    document.getElementById('cs-tab-library')?.addEventListener('click', () => setPickerTab('library'));
    document.getElementById('cs-tab-uploads')?.addEventListener('click', () => setPickerTab('uploads'));

    document.getElementById('cs-mode-carousels')?.addEventListener('click', () => {
      if (typeof window.seOpenCarousels === 'function') window.seOpenCarousels('brand');
    });
    document.getElementById('cs-mode-brand')?.addEventListener('click', () => {
      if (typeof window.seOpenCarousels === 'function') window.seOpenCarousels('brand');
    });

    applyDesignCoachSession();
    applyRedesignedSlides();
    renderSavedDesigns();
    restoreLastDesign();
    loadPosterHistory();
    refreshRestorePreviousButton();
    restoreBusyUiIfGenerating();
    resumeDesignJobIfAny();
    if (window.__SE_COACH_MASTER_IMAGE && !masterImageUrl()) {
      setReference({
        url: window.__SE_COACH_MASTER_IMAGE,
        type: 'image',
        title: 'Carousel master',
        source: 'coach',
      });
    }
    hydrateDesignCoachLog();
    restoreBusyUiIfGenerating();
    const seed = window.__SE_DESIGN_COACH_SEED;
    if (seed) {
      window.__SE_DESIGN_COACH_SEED = '';
      designCoachAsk(seed);
    }

    let searchTimer = null;
    document.getElementById('cs-product-search')?.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadProducts(e.target.value.trim()), 280);
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function setActionEnabled(id, on, extra) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = !on;
    btn.style.cursor = on ? 'pointer' : 'not-allowed';
    btn.style.color = on ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)';
    btn.style.borderColor = on ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.08)';
    if (id === 'cs-queue') {
      if (on) {
        btn.style.background = 'linear-gradient(135deg,rgba(124,58,237,0.35),rgba(79,70,229,0.25))';
        btn.style.borderColor = 'rgba(124,58,237,0.45)';
        btn.style.color = '#E9D5FF';
      } else {
        btn.style.background = 'rgba(255,255,255,0.04)';
      }
    }
    if (extra && extra.label) btn.textContent = extra.label;
  }

  function refreshActionButtons() {
    const carousel = hasCarousel();
    const designed = !!_csHtml || !!_csGeneratedUrl;
    const singleUrl = queueReady().queueableSingleImage({
      carousel,
      designed,
      imageUrl: _csQueueSingleUrl || (_csRef?.type === 'image' ? _csRef.url : ''),
      type: _csRef?.type || 'image',
    });
    const single = !!singleUrl;
    if (single) _csQueueSingleUrl = singleUrl;
    setActionEnabled('cs-export', carousel || designed, { label: carousel ? 'Export ZIP' : 'Export PNG' });
    setActionEnabled('cs-queue', carousel || designed || single);
    setActionEnabled('cs-regen', designed && !carousel);
    setActionEnabled('cs-caption', carousel || designed || !!_csOriginalPreviewUrl || single);
    refreshRestorePreviousButton();
    nlP2Sync();
  }

  function setBusy(busy, msg) {
    _csGenerating = busy;
    const gen = document.getElementById('cs-generate');
    if (gen) {
      gen.disabled = busy;
      // White CTA stays a short label. Long status copy belongs on #cs-loading-msg.
      const shortBtn = msg && msg !== CS_LEAVE_BUSY && String(msg).length <= 32 ? msg : 'Generating…';
      gen.textContent = busy ? shortBtn : 'Generate design';
    }
    const loadMsg = document.getElementById('cs-loading-msg');
    if (loadMsg && msg) loadMsg.textContent = msg;
    if (busy) {
      hidePreviewPanes();
      const empty = document.getElementById('cs-empty');
      if (empty) empty.style.display = 'none';
      const loading = document.getElementById('cs-loading');
      if (loading) loading.style.display = 'block';
      setPreviewHeader('Stage · Generating');
    } else {
      const loading = document.getElementById('cs-loading');
      const loadingOn = loading && loading.style.display === 'block';
      if (loading) loading.style.display = 'none';
      const shown = ['cs-frame', 'cs-carousel', 'cs-original-preview', 'cs-scene-preview'].some((id) => {
        const el = document.getElementById(id);
        return el && el.style.display && el.style.display !== 'none';
      });
      if (loadingOn && !shown) restorePreview();
    }
    nlP2Sync();
  }

  /** Session poll / nav remount wipes #cs-loading; keep the purple spinner if a generate is in flight. */
  function restoreBusyUiIfGenerating() {
    if (!_csGenerating) return;
    setBusy(true, CS_LEAVE_BUSY);
  }

  function restorePreview() {
    if (hasCarousel()) {
      renderCarouselPreview();
      return;
    }
    if (_csScene && !_csGeneratedUrl) {
      renderScenePreview();
      return;
    }
    if (_csGeneratedUrl) {
      showGeneratedImage(_csGeneratedUrl, _csSpec);
      return;
    }
    if (_csHtml) {
      showDesign(_csHtml, _csSpec);
      return;
    }
    if (_csOriginalPreviewUrl) {
      showOriginalPreview(_csOriginalPreviewUrl);
      return;
    }
    hidePreviewPanes();
    setPreviewHeader('Preview · 9:16');
    const empty = document.getElementById('cs-empty');
    if (empty) empty.style.display = 'block';
    refreshActionButtons();
  }

  function enableActions(on) {
    if (on) {
      refreshActionButtons();
      return;
    }
    setActionEnabled('cs-export', false, { label: 'Export PNG' });
    setActionEnabled('cs-queue', false);
    setActionEnabled('cs-regen', false);
    setActionEnabled('cs-caption', !!_csOriginalPreviewUrl || hasCarousel());
  }

  function showDesign(html, spec) {
    _csHtml = html;
    _csGeneratedUrl = null;
    _csSpec = spec || _csSpec;
    _csCarousel = null;
    _csQueueSingleUrl = null;
    hidePreviewPanes();
    setPreviewHeader(previewLabel(_csSpec));
    const frame = document.getElementById('cs-frame');
    const iframe = document.getElementById('cs-iframe');
    frame.style.display = 'block';
    const fit = fitPreviewFrame(_csSpec.w, _csSpec.h);
    iframe.style.width = _csSpec.w + 'px';
    iframe.style.height = _csSpec.h + 'px';
    iframe.style.transform = `scale(${fit.scale})`;
    iframe.style.transformOrigin = 'top left';
    frame.style.width = fit.frameW + 'px';
    frame.style.height = fit.frameH + 'px';
    iframe.srcdoc = html;
    refreshActionButtons();
  }

  function showGeneratedImage(url, spec) {
    const nextUrl = String(url || '').trim();
    const prevUrl = String(_csGeneratedUrl || '').trim();
    if (!_csRestoringPoster && /^https:\/\//i.test(prevUrl) && /^https:\/\//i.test(nextUrl) && prevUrl !== nextUrl) {
      pushPosterHistory(prevUrl, _csSpec, (document.getElementById('cs-brief') && document.getElementById('cs-brief').value) || _csBrief);
    }
    _csHtml = '';
    _csWorkspaceCleared = false;
    _csGeneratedUrl = nextUrl;
    _csSpec = spec || _csSpec;
    _csCarousel = null;
    _csQueueSingleUrl = nextUrl;
    _csOriginalPreviewUrl = nextUrl;
    hidePreviewPanes();
    setPreviewHeader(previewLabel(_csSpec));
    const wrap = document.getElementById('cs-original-preview');
    const img = document.getElementById('cs-original-preview-img');
    if (img) {
      img.referrerPolicy = 'no-referrer';
      img.src = mediaSrc(nextUrl);
    }
    if (wrap) wrap.style.display = 'block';
    _csRef = {
      url: nextUrl,
      type: 'image',
      title: 'Generated design',
      source: 'generate',
    };
    window._studioReference = { ..._csRef };
    renderRefSummary();
    syncSplitButton();
    refreshActionButtons();
    persistLastDesign();
  }

  async function uploadStudioImage(file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${apiBase()}/api/studio/upload-image`, {
      method: 'POST',
      headers: authHeadersMultipart(),
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
    return data.url;
  }

  async function uploadInfographicFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please upload an image file', 'warning'); return; }
    if (file.size > 10 * 1024 * 1024) { toast('Image must be under 10MB', 'warning'); return; }
    toast('Uploading infographic…', 'info');
    try {
      const url = await uploadStudioImage(file);
      _csCarousel = null;
      _csHtml = '';
      _csQueueSingleUrl = null;
      _csOriginalPreviewUrl = url;
      setReference({ url, type: 'image', title: 'Infographic', source: 'upload' });
      showOriginalPreview(url);
      toast('Infographic uploaded', 'success');
    } catch (e) {
      toast(e.message || 'Upload failed', 'error');
    }
  }

  async function uploadSlideFiles(files) {
    const list = (files || [])
      .filter((f) => {
        const t = String(f?.type || '').toLowerCase();
        const name = String(f?.name || '').toLowerCase();
        return t === 'image/png' || t === 'image/jpeg' || t === 'image/jpg' || t === 'image/webp'
          || /\.(png|jpe?g|webp)$/.test(name);
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' }));
    if (!list.length) {
      toast('Only PNG, JPG, or WebP slides are allowed', 'warning');
      return;
    }
    if (list.length < 2 || list.length > 10) {
      toast('Pick 2–10 slide images (Instagram carousel max is 10)', 'warning');
      return;
    }
    if (list.some((f) => f.size > 10 * 1024 * 1024)) {
      toast('Each slide must be under 10MB', 'warning');
      return;
    }
    const seq = ++_csSplitSeq;
    _csHtml = '';
    setBusy(true, `Uploading slides 1/${list.length}…`);
    try {
      const urls = [];
      for (let i = 0; i < list.length; i++) {
        if (seq !== _csSplitSeq) throw new Error('__aborted__');
        setBusy(true, `Uploading slides ${i + 1}/${list.length}…`);
        urls.push(await uploadStudioImage(list[i]));
      }
      if (seq !== _csSplitSeq) throw new Error('__aborted__');
      const n = urls.length;
      const slides = urls.map((url, i) => ({
        url,
        y0: i / n,
        y1: (i + 1) / n,
      }));
      _csCarousel = {
        originalUrl: urls[0],
        width: 1080,
        height: 1080,
        method: 'assembled',
        slides,
        selected: 0,
        queueOrder: identityQueueOrder(n),
      };
      _csOriginalPreviewUrl = urls[0];
      _csQueueSingleUrl = null;
      _csRef = { url: urls[0], type: 'image', title: `${n} carousel slides`, source: 'upload' };
      window._studioReference = { ..._csRef };
      renderRefSummary();
      syncSplitButton();
      renderCarouselPreview();
      toast(`${n} slides uploaded. Add to Queue to save them — they are not posted yet.`, 'success');
    } catch (e) {
      if (e && e.message === '__aborted__') return;
      toast(e.message || 'Slide upload failed', 'error');
    } finally {
      if (seq === _csSplitSeq) {
        setBusy(false);
        if (hasCarousel()) renderCarouselPreview();
      }
    }
  }

  async function splitCarousel(opts) {
    if (isAssembledCarousel() && !(opts && Array.isArray(opts.cuts))) {
      toast('These are already separate slides — reorder or delete instead', 'info');
      return;
    }
    const slideCount = opts && opts.slideCount;
    const cuts = opts && opts.cuts;
    const quiet = Array.isArray(cuts) && cuts.length >= 2;
    const imageUrl = (quiet ? _csCarousel?.originalUrl : null) || _csRef?.url || _csOriginalPreviewUrl;
    if (!imageUrl) { toast('Upload or pick an image first', 'warning'); return; }
    if (_csRef && _csRef.type === 'video') { toast('Split needs an image, not a video', 'warning'); return; }
    const splitBtn = document.getElementById('cs-split-carousel');
    if (splitBtn) { splitBtn.disabled = true; splitBtn.textContent = 'Splitting…'; }
    const seq = ++_csSplitSeq;
    if (!quiet) _csHtml = '';
    if (!quiet) setBusy(true, 'Splitting into carousel…');
    try {
      const body = { image_url: imageUrl };
      if (quiet) body.cuts = cuts;
      else if (slideCount) body.slide_count = slideCount;
      const res = await fetch(`${apiBase()}/api/studio/split-carousel`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (seq !== _csSplitSeq) return;
      if (!res.ok || !data.ok) throw new Error(data.error || 'Split failed');
      if (data.split === false) {
        _csCarousel = null;
        _csOriginalPreviewUrl = imageUrl;
        _csQueueSingleUrl = imageUrl;
        if (!quiet) setBusy(false);
        else restorePreview();
        toast('Already square — queue as a single post', 'info');
        return;
      }
      const slides = Array.isArray(data.slides) ? data.slides : [];
      if (slides.length < 2) throw new Error('Split did not return enough slides');
      const selected = _csCarousel ? Math.min(_csCarousel.selected || 0, slides.length - 1) : 0;
      _csCarousel = {
        originalUrl: data.original_url || imageUrl,
        width: data.width,
        height: data.height,
        method: data.method || (quiet ? 'cuts' : 'even'),
        slides,
        selected,
        queueOrder: identityQueueOrder(slides.length),
      };
      _csOriginalPreviewUrl = _csCarousel.originalUrl;
      _csQueueSingleUrl = null;
      if (!quiet) setBusy(false);
      else renderCarouselPreview();
      if (_csCarousel.method === 'even' && !quiet && !slideCount) {
        toast('used even split — drag cuts if needed', 'info');
      } else if (!quiet) {
        toast('Carousel ready', 'success');
      }
    } catch (e) {
      if (seq !== _csSplitSeq) return;
      if (!quiet) setBusy(false);
      toast(e.message || 'Split failed', 'error');
    } finally {
      if (splitBtn && seq === _csSplitSeq) {
        splitBtn.textContent = 'Redesign as carousel';
        syncSplitButton();
      }
    }
  }

  function scheduleResplitFromCuts() {
    clearTimeout(_csCutTimer);
    _csCutTimer = setTimeout(() => {
      if (!hasCarousel() || isAssembledCarousel()) return;
      const cuts = _csCarousel.slides
        .slice()
        .sort((a, b) => (Number(a.y0) || 0) - (Number(b.y0) || 0))
        .map((s) => ({ y0: s.y0, y1: s.y1 }));
      splitCarousel({ cuts });
    }, 400);
  }

  function reelSlideUrls() {
    if (!hasCarousel() || !isAssembledCarousel()) return [];
    const urls = carouselQueueOrder().map((i) => _csCarousel.slides[i]?.url).filter(Boolean);
    return urls.every((u) => /^https:\/\//i.test(u)) ? urls.slice(0, 10) : [];
  }

  function renderCarouselPreview() {
    if (!hasCarousel()) return;
    hidePreviewPanes();
    const wrap = document.getElementById('cs-carousel');
    if (wrap) wrap.style.display = 'block';
    const slides = _csCarousel.slides;
    const order = carouselQueueOrder();
    setPreviewHeader(`Preview · Carousel · ${order.length} slides · not queued yet`);
    if (_csCarousel.selected == null || _csCarousel.selected < 0 || _csCarousel.selected >= order.length) {
      _csCarousel.selected = 0;
    }
    const selectedSlide = slides[order[_csCarousel.selected]];
    const hero = document.getElementById('cs-slide-hero');
    if (hero) {
      if (isAssembledCarousel() && selectedSlide?.url) {
        hero.style.display = 'block';
        hero.innerHTML = `<img src="${escapeHtml(mediaSrc(selectedSlide.url))}" alt="Selected slide" referrerpolicy="no-referrer" style="width:100%;max-height:min(70vh,640px);object-fit:contain;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:#111;">`;
      } else {
        hero.style.display = 'none';
        hero.innerHTML = '';
      }
    }
    const strip = document.getElementById('cs-slide-strip');
    if (strip) {
      strip.innerHTML = order.map((slideIdx, i) => {
        const s = slides[slideIdx];
        if (!s) return '';
        const on = i === _csCarousel.selected;
        return `<button type="button" class="cs-slide-btn" data-i="${i}" style="flex:0 0 auto;width:88px;padding:0;border:${on ? '2px solid #A78BFA' : '1px solid rgba(255,255,255,0.12)'};border-radius:8px;background:#111;cursor:pointer;overflow:hidden;outline:none;">
          <img src="${escapeHtml(mediaSrc(s.url))}" alt="Slide ${i + 1}" referrerpolicy="no-referrer" style="width:88px;height:88px;object-fit:cover;display:block;">
        </button>`;
      }).join('');
      strip.querySelectorAll('.cs-slide-btn').forEach((el) => {
        el.addEventListener('click', () => {
          _csCarousel.selected = Number(el.getAttribute('data-i')) || 0;
          renderCarouselPreview();
        });
      });
    }
    const reelBtn = document.getElementById('cs-slide-reel');
    if (reelBtn) reelBtn.style.display = reelSlideUrls().length >= 2 ? '' : 'none';
    const countWrap = document.getElementById('cs-slide-count-wrap');
    if (countWrap) countWrap.style.display = isAssembledCarousel() ? 'none' : 'flex';
    const countSel = document.getElementById('cs-slide-count');
    if (countSel && !isAssembledCarousel()) {
      const n = Math.min(8, Math.max(3, slides.length));
      countSel.value = String(n);
    }
    renderCutCanvas();
    renderTemplateEditor();
    refreshActionButtons();
  }

  function renderTemplateEditor() {
    const el = document.getElementById('cs-tpl-editor');
    const redo = document.getElementById('cs-slide-redo');
    const on = hasCarousel() && _csCarousel.method === 'template' && _csTpl && window.seCarouselTemplates;
    if (redo) redo.style.display = on ? 'none' : '';
    if (!el) return;
    if (!on) { el.innerHTML = ''; return; }
    const order = carouselQueueOrder();
    _csTpl.selected = order[_csCarousel.selected || 0] || 0;
    window.seCarouselTemplates.mountEditor(el, _csTpl, (idx, url) => {
      if (_csCarousel && _csCarousel.slides[idx]) _csCarousel.slides[idx].url = url;
      renderCarouselPreview();
    });
  }

  function carouselFail(reason) {
    _csCarouselError = String(reason || '');
    toast(`Carousel: ${_csCarouselError}`, 'error');
    return false;
  }

  async function buildTemplateCarousel({ plan, count } = {}) {
    const api = window.seCarouselTemplates;
    const master = String(masterImageUrl() || '').trim();
    if (!api || !/^https:\/\//i.test(master)) {
      carouselFail('there is no stored poster on the canvas yet — generate or upload the 4K poster first');
      return false;
    }
    await api.list().catch(() => null);
    const tpl = api.defaultTemplate();
    if (!tpl) {
      carouselFail('no brand template saved — Saved & templates → New template from example slides');
      return false;
    }
    setBusy(true, 'Writing the slides from your poster…');
    try {
      const out = await api.build({
        master,
        plan,
        count: count || Number(document.getElementById('cs-tpl-count')?.value) || 6,
        templateId: tpl.id,
        onProgress: (m) => setBusy(true, m),
      });
      _csTpl = {
        templateId: out.templateId,
        master,
        masterDisplay: mediaSrc(master),
        specs: out.specs,
        overflow: out.slides.map((s) => s.overflow || []),
        selected: 0,
      };
      _csCarousel = {
        originalUrl: master,
        method: 'template',
        slides: out.slides.map((s, i) => ({ url: s.url, y0: 0, y1: 1, title: (out.specs[i] && out.specs[i].title) || `Slide ${i + 1}` })),
        selected: 0,
        queueOrder: identityQueueOrder(out.slides.length),
      };
      _csOriginalPreviewUrl = master;
      _csQueueSingleUrl = null;
      setBusy(false);
      renderCarouselPreview();
      const cut = out.slides.filter((s) => s.overflow && s.overflow.length).length;
      toast(cut ? `${out.slides.length} slides ready — ${cut} need shorter text` : `${out.slides.length} slides ready in "${tpl.name}"`, cut ? 'warning' : 'success');
      return true;
    } catch (e) {
      setBusy(false);
      carouselFail(e.message || 'the server did not say why');
      return false;
    }
  }

  function syncTemplateButton() {
    const btn = document.getElementById('cs-build-template');
    if (!btn) return;
    const api = window.seCarouselTemplates;
    const on = /^https:\/\//i.test(masterImageUrl()) && !!(api && api.defaultTemplate());
    btn.disabled = !on;
    btn.style.cursor = on ? 'pointer' : 'not-allowed';
    btn.style.opacity = on ? '1' : '0.5';
    btn.title = on ? '' : (api && api.defaultTemplate() ? 'Generate or upload the poster first' : 'Save a brand template first (Saved & templates)');
  }

  function renderCutCanvas() {
    const canvas = document.getElementById('cs-cut-canvas');
    if (!canvas || !hasCarousel()) return;
    if (isAssembledCarousel()) {
      canvas.innerHTML = `<div style="font-size:0.68rem;color:rgba(255,255,255,0.35);line-height:1.5;">${_csCarousel.method === 'template' ? 'Built in your brand template. Pick a slide to edit its words or picture. Slide numbers are drawn on the slides, so redo a slide after moving it.' : _csCarousel.method === 'redesign' ? 'These slides were redesigned as complete 9:16 frames. Reorder, delete, or Redo selected. Ask Coach to change the plan.' : 'These slides were uploaded separately. Reorder with Move left/right, or delete a slide.'}</div>`;
      return;
    }
    const orig = _csCarousel.originalUrl;
    const slides = _csCarousel.slides;
    const lines = slides.slice(0, -1).map((s, i) => {
      const pct = Math.min(100, Math.max(0, (Number(s.y1) || 0) * 100));
      return `<div data-cut-line="${i}" style="position:absolute;left:0;right:0;top:${pct}%;height:0;border-top:2px solid rgba(167,139,250,0.9);pointer-events:none;">
        <span style="position:absolute;right:4px;top:-11px;font-size:0.58rem;font-weight:700;color:#E9D5FF;background:rgba(15,23,42,0.85);padding:1px 5px;border-radius:4px;">${Math.round(pct)}%</span>
      </div>`;
    }).join('');
    const sliders = slides.slice(0, -1).map((s, i) => {
      const pct = Math.min(100, Math.max(0, (Number(s.y1) || 0) * 100));
      const prev = i === 0 ? 1 : Math.min(99, Math.max(1, (Number(slides[i - 1].y1) || 0) * 100 + 1));
      const next = i >= slides.length - 2 ? 99 : Math.min(99, Math.max(1, (Number(slides[i + 1].y1) || 1) * 100 - 1));
      const min = Math.min(prev, pct);
      const max = Math.max(next, pct);
      return `<label style="display:flex;align-items:center;gap:10px;font-size:0.7rem;color:rgba(255,255,255,0.5);">
        Cut ${i + 1}
        <input type="range" class="cs-cut-range" data-i="${i}" min="${Math.round(min)}" max="${Math.round(max)}" value="${Math.round(pct)}" style="flex:1;accent-color:#A78BFA;">
        <span class="cs-cut-pct" data-i="${i}" style="width:36px;text-align:right;color:rgba(255,255,255,0.7);">${Math.round(pct)}%</span>
      </label>`;
    }).join('');
    canvas.innerHTML = `
      <div style="max-height:280px;overflow:auto;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:#111;">
        <div style="position:relative;">
          <img src="${escapeHtml(mediaSrc(orig))}" alt="Original cuts" referrerpolicy="no-referrer" style="width:100%;display:block;">
          ${lines}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">${sliders}</div>
      <div style="font-size:0.65rem;color:rgba(255,255,255,0.3);margin-top:6px;">Adjust cut handles (0–100%) to redraw slides. Updates debounce 400ms.</div>`;
    canvas.querySelectorAll('.cs-cut-range').forEach((input) => {
      input.addEventListener('input', (e) => {
        if (!hasCarousel()) return;
        const i = Number(e.target.getAttribute('data-i'));
        const pct = Number(e.target.value);
        const frac = pct / 100;
        _csCarousel.slides[i].y1 = frac;
        if (_csCarousel.slides[i + 1]) _csCarousel.slides[i + 1].y0 = frac;
        const line = canvas.querySelector(`[data-cut-line="${i}"]`);
        if (line) line.style.top = pct + '%';
        const label = canvas.querySelector(`.cs-cut-pct[data-i="${i}"]`);
        if (label) label.textContent = Math.round(pct) + '%';
        scheduleResplitFromCuts();
      });
    });
  }

  async function redoSelectedSlide() {
    if (!hasCarousel()) return;
    const pack = window.__SE_CAROUSEL_REDESIGN || {};
    const master = pack.master_image_url || _csCarousel.originalUrl;
    const order = carouselQueueOrder();
    const displayI = _csCarousel.selected || 0;
    const slideI = order[displayI];
    const current = _csCarousel.slides[slideI];
    const brief = (pack.slides || []).find((s) => Number(s.index) === displayI + 1)
      || { index: displayI + 1, title: current && current.title, role: 'other' };
    if (!/^https:\/\//i.test(master)) {
      toast('Need the stored master to redo a slide', 'warning');
      return;
    }
    setBusy(true, `Redoing slide ${displayI + 1}…`);
    try {
      const res = await fetch(`${apiBase()}/api/studio/carousel-redesign/slide`, {
        method: 'POST',
        headers: authHeaders(),
        signal: AbortSignal.timeout(180_000),
        body: JSON.stringify({
          master_image_url: master,
          session_id: pack.session_id || '',
          slide: brief,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Redo failed');
      _csCarousel.slides[slideI] = { ...current, url: data.url, title: brief.title || current.title };
      if (window.__SE_CAROUSEL_REDESIGN) {
        window.__SE_CAROUSEL_REDESIGN.session_id = data.session_id || pack.session_id;
        if (Array.isArray(window.__SE_CAROUSEL_REDESIGN.slides)) {
          window.__SE_CAROUSEL_REDESIGN.slides = window.__SE_CAROUSEL_REDESIGN.slides.map((s) => (
            Number(s.index) === displayI + 1 ? { ...s, url: data.url } : s
          ));
        }
      }
      renderCarouselPreview();
      toast('Slide updated', 'success');
    } catch (e) {
      toast(e.message || 'Redo failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  function deleteSelectedSlide() {
    if (!hasCarousel()) return;
    const displayI = _csCarousel.selected || 0;
    const order = carouselQueueOrder();
    const slideI = order[displayI];
    if (slideI == null) return;
    _csCarousel.slides.splice(slideI, 1);
    if (_csCarousel.slides.length < 2) {
      const surviving = _csCarousel.slides[0];
      const survivingUrl = surviving?.url || '';
      _csCarousel = null;
      _csHtml = '';
      _csSplitSeq += 1;
      if (survivingUrl) {
        _csQueueSingleUrl = survivingUrl;
        showOriginalPreview(survivingUrl);
      } else {
        restorePreview();
      }
      refreshActionButtons();
      toast('Carousel cleared — one slide left', 'info');
      return;
    }
    _csCarousel.queueOrder = order
      .filter((idx) => idx !== slideI)
      .map((idx) => (idx > slideI ? idx - 1 : idx));
    _csCarousel.selected = Math.min(displayI, _csCarousel.queueOrder.length - 1);
    renderCarouselPreview();
  }

  function moveSelectedSlide(dir) {
    if (!hasCarousel()) return;
    const order = carouselQueueOrder();
    const i = _csCarousel.selected || 0;
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
    _csCarousel.selected = j;
    renderCarouselPreview();
  }

  async function generate(opts = {}) {
    const continueBusy = !!opts.continueBusy;
    if (_csGenerating && !continueBusy) return;
    const briefEl = document.getElementById('cs-brief');
    let brief = briefEl?.value?.trim() || '';
    if (!brief) {
      toast('Describe your post first', 'warning');
      if (continueBusy) setBusy(false);
      return;
    }
    const replacing = opts.fresh ? masterImageUrl() : '';
    const hero = replacing && heroUrlForGenerate() === replacing ? '' : heroUrlForGenerate();
    if (_csRef && _csRef.type === 'video' && !hero) {
      toast('This video has no still — upload a frame or use Video Studio', 'warning');
      if (continueBusy) setBusy(false);
      return;
    }
    _csBrief = brief;
    const styleUrls = coachStyleHttpsUrls();
    const busyMsg = styleUrls.length ? CS_LEAVE_BUSY : 'Creating your design…';
    setBusy(true, busyMsg);
    try {
      const payload = {
        brief,
        style_hint: document.getElementById('cs-style')?.value?.trim() || undefined,
        aspect_ratio: document.getElementById('cs-aspect')?.value || '9:16',
        model: selectedEngineId(),
      };
      if (styleUrls.length) {
        payload.style_image_url = styleUrls[0];
        payload.style_image_urls = styleUrls;
      }
      if (_csRef && hero) {
        payload.reference = { ..._csRef, url: hero };
        payload.photo_url = hero;
      }
      // FigureLabs and GPT Image return a job_id immediately; HTML/Soul stay sync.
      const res = await fetch(`${apiBase()}/api/studio/design-generate`, {
        method: 'POST',
        headers: authHeaders(),
        signal: AbortSignal.timeout(360_000),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (data.code === 'USE_VIDEO_STUDIO') {
          _csGenerateError = data.error || 'Use Video Studio for animation';
          toast(data.error || 'Use Video Studio for animation', 'warning');
          return;
        }
        throw new Error(data.error || 'Generation failed');
      }
      let result = data;
      if (data.async && data.job_id) {
        setBusy(true, CS_LEAVE_BUSY);
        result = await awaitDesignJob(data.job_id);
        applyCompletedDesign(result, { awayToast: false });
      } else {
        if (data.brand?.name) {
          _csBrandName = data.brand.name;
          const pill = document.getElementById('cs-brand-pill');
          if (pill) pill.textContent = _csBrandName;
        }
        if (data.record_id) _csDesignId = data.record_id;
        if (data.image_url) showGeneratedImage(data.image_url, data.spec);
        else if (data.html) showDesign(data.html, data.spec);
        else throw new Error('Generation failed');
        toast('Design ready', 'success');
      }
      if (styleUrls.length && !(result.style_lock && result.style_lock.sent)) {
        toast('Style photo did not reach the generator — re-attach it', 'error');
      } else if (styleUrls.length && result.method && result.method !== 'figurelabs' && result.method !== 'gpt-image') {
        toast('Style lock needs Scientific Infographic or GPT Image 2.5 on this account', 'warning');
      }
    } catch (e) {
      const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      _csGenerateError = timedOut
        ? 'Generation timed out — try again, or shorten the brief'
        : (e.message || 'Generation failed');
      toast(_csGenerateError, 'error');
    } finally {
      setBusy(false);
    }
  }

  function sharedCoachStorageKey() {
    const email = window.__clientEmail || window.clientEmail || window._seEmail || '';
    return email ? 'se_chat_history_' + email : '';
  }

  function persistSharedCoach(role, text, extra) {
    const key = sharedCoachStorageKey();
    if (!key) return;
    let hist = [];
    try { hist = JSON.parse(localStorage.getItem(key) || '[]'); } catch { hist = []; }
    const make = typeof window.persistCoachHistoryEntry === 'function'
      ? window.persistCoachHistoryEntry
      : (r, t, e) => ({ role: r, text: t, time: (e && e.time) || '' });
    hist.push(make(role, text, extra || {}));
    if (hist.length > 50) hist = hist.slice(-50);
    try { localStorage.setItem(key, JSON.stringify(hist)); } catch {}
  }

  function appendDesignCoachBubble(role, text) {
    const log = document.getElementById('cs-coach-log');
    if (!log) return;
    const mine = role === 'user';
    const row = document.createElement('div');
    row.className = mine ? 'cs-cb cs-cb--me' : 'cs-cb cs-cb--ai';
    row.style.cssText = mine
      ? 'align-self:flex-end;max-width:92%;background:#7C3AED;color:#fff;border-radius:14px 14px 4px 14px;padding:8px 11px;font-size:0.78rem;line-height:1.55;'
      : 'align-self:flex-start;max-width:92%;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.86);border-radius:14px 14px 14px 4px;padding:8px 11px;font-size:0.78rem;line-height:1.55;';
    if (mine) {
      row.style.whiteSpace = 'pre-wrap';
      row.textContent = text;
    } else {
      const fmt = typeof window.formatCoachReplyHtml === 'function' ? window.formatCoachReplyHtml : null;
      if (fmt) row.innerHTML = fmt(text);
      else {
        row.style.whiteSpace = 'pre-wrap';
        row.textContent = text;
      }
    }
    log.appendChild(row);
    scrollCoachLogToBottom(!!mine);
    return row;
  }

  function offerDesignCarousel(action) {
    const log = document.getElementById('cs-coach-log');
    if (!log) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'cs-design-carousel';
    btn.className = 'cs-coach-act';
    const n = Number(action && action.slides);
    btn.textContent = n ? `Design this ${n}-slide carousel in my brand style` : 'Design this carousel in my brand style';
    btn.style.cssText = 'align-self:flex-start;background:#7C3AED;color:#fff;border:none;border-radius:9px;padding:8px 13px;font-size:0.76rem;font-weight:700;cursor:pointer;font-family:var(--font-body);';
    btn.addEventListener('click', () => {
      window.seDesignStudio.openWith({
        brief: action.brief,
        slides: action.slides,
        source_image_url: action.source_image_url || masterImageUrl() || '',
        medical: action.medical,
        style_id: action.style_id || undefined,
        autostart: true,
      });
    });
    log.appendChild(btn);
    scrollCoachLogToBottom();
  }

  // ── A new carousel style from the reference they attached (the Coach's design_style action) ──
  // Builds the style next to the existing ones, then, if the Coach was also asked for a carousel,
  // makes it in the new style. Runs here, so the chat keeps the page open for the second step.
  async function runDesignStyle(action) {
    const log = document.getElementById('cs-coach-log');
    await window.seDesignStudio.runStyleAction(action, {
      say: (text) => {
        const row = appendDesignCoachBubble('assistant', text);
        scrollCoachLogToBottom();
        return { set: (t) => { if (row) { row.textContent = t; scrollCoachLogToBottom(); } } };
      },
      offer: (label, fn) => {
        if (!log) return;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cs-coach-act';
        b.textContent = label;
        b.style.cssText = 'align-self:flex-start;background:#7C3AED;color:#fff;border:none;border-radius:9px;padding:8px 13px;font-size:0.76rem;font-weight:700;cursor:pointer;font-family:var(--font-body);';
        b.addEventListener('click', fn);
        log.appendChild(b);
        scrollCoachLogToBottom();
      },
      remember: (text) => persistSharedCoach('assistant', text, {}),
    });
  }

  // The Post tool's sizes. setPostSize moves the picker (and the size chips) to one the Coach
  // named, so what it says is the size the post is made at; say: tells the chat it switched.
  // (Function declarations, not consts: setPostSize is also used above this point.)
  function isPostSize(r) { return r === '9:16' || r === '4:5' || r === '1:1'; }
  function postSizeCss(r) { return ({ '9:16': '9/16', '4:5': '4/5', '1:1': '1/1' })[r] || '4/5'; }
  function currentPostSize() {
    const v = document.getElementById('cs-aspect')?.value || '';
    return isPostSize(v) ? v : '9:16';
  }
  function setPostSize(ratio, { say = false } = {}) {
    const v = String(ratio || '');
    const aspect = document.getElementById('cs-aspect');
    if (!aspect || !isPostSize(v) || aspect.value === v) return false;
    const was = aspect.value;
    aspect.value = v;
    aspect.dispatchEvent(new Event('change', { bubbles: true }));
    nlP2Sync();
    if (say) {
      appendDesignCoachBubble('assistant', `Size switched from ${was} to ${v}.`);
      scrollCoachLogToBottom();
    }
    return true;
  }

  /** A create action that named a size (CREATE_CONTENT aspect_ratio) switches the picker first. */
  function applyCoachPostSize(action) {
    if (action && action.aspect_explicit === true) setPostSize(action.aspect_ratio, { say: true });
  }

  // ── Several single posts at once (the Coach's design_posts action) ──
  // Each post is its own image: in the brand's design system when the client has one, else
  // made by the Stage engine. They are made two at a time and each tile fills in as it lands;
  // Open puts one on the canvas, Add to Review queues it, Add all queues every finished one.
  function designPostsCaption(post) {
    const tags = Array.isArray(post.hashtags) ? post.hashtags.filter(Boolean).join(' ') : '';
    const body = String(post.caption || '').trim() || String(post.brief || post.title || '').trim();
    return tags && !body.includes(tags) ? `${body}\n\n${tags}` : body;
  }

  function designPostsCard(action) {
    const log = document.getElementById('cs-coach-log');
    if (!log) return null;
    // The size they are made at: the brand's format, the size the Coach named, else the picker's.
    const view = { size: isPostSize(action.aspect_ratio) ? action.aspect_ratio : currentPostSize() };
    const posts = action.posts.map((p) => ({ ...p, status: 'queued', url: '', queued: false, ratio: view.size }));
    const card = document.createElement('div');
    card.className = 'cs-posts';
    card.setAttribute('data-cs-posts', '');
    card.style.cssText = 'align-self:stretch;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:9px;';
    log.appendChild(card);
    const paint = () => {
      const done = posts.filter((p) => p.status === 'done').length;
      const failed = posts.filter((p) => p.status === 'failed').length;
      const working = posts.length - done - failed;
      const head = working
        ? `Making ${posts.length === 1 ? 'your post' : `${posts.length} posts`}${done ? `: ${done} of ${posts.length} done` : ''}. Each one shows here when it is ready.`
        : failed
          ? `${done} of ${posts.length} made. ${failed === 1 ? 'One' : failed} could not be made; try ${failed === 1 ? 'it' : 'them'} again.`
          : `${posts.length === 1 ? 'Your post is' : `All ${posts.length} posts are`} ready. Open one to change it, or add ${posts.length === 1 ? 'it' : 'them'} to Review.`;
      const ready = posts.filter((p) => p.status === 'done' && !p.queued).length;
      const sizeNote = action.engine === 'brand' ? `Size ${view.size}, your brand format.` : `Size ${view.size}.`;
      card.innerHTML = `<div class="cs-posts__head" data-cs-posts-head style="font-size:0.74rem;color:rgba(255,255,255,0.7);line-height:1.45;">${escapeHtml(head)}</div>`
        + `<div class="cs-posts__size" data-cs-posts-size style="font-size:0.66rem;color:rgba(255,255,255,0.45);margin-top:-5px;">${escapeHtml(sizeNote)}</div>`
        + `<div class="cs-posts__grid" style="display:grid;grid-template-columns:repeat(${posts.length > 1 ? 2 : 1},minmax(0,1fr));gap:8px;">${posts.map((p, i) => {
          const img = p.status === 'done' && p.url
            ? `<img src="${escapeHtml(mediaSrc(p.url))}" alt="${escapeHtml(p.title)}" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;display:block;">`
            : p.status === 'failed'
              ? `<span style="font-size:0.7rem;color:#FCA5A5;padding:8px;text-align:center;">${escapeHtml(p.error || 'Could not be made')}</span>`
              : `<span class="cs-post__spin" aria-hidden="true" style="width:18px;height:18px;border:2px solid rgba(255,255,255,0.15);border-top-color:#A78BFA;border-radius:50%;animation:spin 0.8s linear infinite;"></span>`;
          const acts = p.status === 'done'
            ? `<button type="button" class="cs-post__btn" data-cs-post-open="${i}">Open</button><button type="button" class="cs-post__btn cs-post__btn--main" data-cs-post-queue="${i}" ${p.queued ? 'disabled' : ''}>${p.queued ? 'In Review' : 'Add to Review'}</button>`
            : p.status === 'failed'
              ? `<button type="button" class="cs-post__btn" data-cs-post-retry="${i}">Try again</button>`
              : `<span class="cs-post__note" style="font-size:0.66rem;color:rgba(255,255,255,0.45);">${p.status === 'working' ? 'Designing…' : 'Waiting…'}</span>`;
          return `<div class="cs-post" data-cs-post="${i}" data-status="${p.status}" style="display:flex;flex-direction:column;gap:5px;min-width:0;">`
            + `<div class="cs-post__img" style="aspect-ratio:${postSizeCss(p.ratio)};border-radius:8px;overflow:hidden;background:rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:center;">${img}</div>`
            + `<div class="cs-post__t" style="font-size:0.72rem;font-weight:600;color:rgba(255,255,255,0.85);line-height:1.3;">${escapeHtml(p.title)}</div>`
            + `<div class="cs-post__acts" style="display:flex;gap:5px;flex-wrap:wrap;">${acts}</div>`
            + '</div>';
        }).join('')}</div>`
        + (posts.length > 1 && ready > 1
          ? `<button type="button" class="cs-coach-act" data-cs-posts-queue-all style="align-self:flex-start;background:#7C3AED;color:#fff;border:none;border-radius:9px;padding:8px 13px;font-size:0.76rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Add all ${ready} to Review</button>`
          : '');
      card.querySelectorAll('.cs-post__btn').forEach((b) => {
        b.style.cssText = b.classList.contains('cs-post__btn--main')
          ? 'background:#7C3AED;color:#fff;border:none;border-radius:7px;padding:5px 9px;font-size:0.68rem;font-weight:700;cursor:pointer;font-family:var(--font-body);'
          : 'background:transparent;color:rgba(255,255,255,0.8);border:1px solid rgba(255,255,255,0.18);border-radius:7px;padding:5px 9px;font-size:0.68rem;font-weight:600;cursor:pointer;font-family:var(--font-body);';
      });
      scrollCoachLogToBottom();
    };
    return Object.assign(view, { card, posts, paint });
  }

  async function queueDesignPost(post) {
    const res = await fetch(`${apiBase()}/api/studio/design-queue`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        image_url: post.url,
        brief: post.brief || post.title,
        caption: designPostsCaption(post),
        platform: queuePlatform(),
        status: queueReady().queueReviewStatus(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !(data.ok || data.success)) throw new Error(data.error || 'Could not add it to Review');
    post.queued = true;
  }

  // Brand design system: one job makes every post; its progress carries each finished url.
  async function makePostsWithBrand(view, action, only) {
    const list = only != null ? [view.posts[only]] : view.posts;
    const res = await fetch(`${apiBase()}/api/design/posts`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        posts: list.map((p) => ({ title: p.title, brief: p.brief })),
        style_id: action.style_id || undefined,
        medical: action.medical === true || action.medical === 'ask',
        platform: 'instagram',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.code === 'DESIGN_NO_SYSTEM') return false;
    if (!res.ok || !data.job_id) throw new Error(data.error || 'Could not start the posts');
    const index = (k) => (only != null ? only : k);
    const started = Date.now();
    while (Date.now() - started < 15 * 60_000) {
      await new Promise((r) => setTimeout(r, _csPostsPollMs));
      const jr = await fetch(`${apiBase()}/api/design/jobs/${encodeURIComponent(data.job_id)}`, { headers: authHeaders() });
      const jd = await jr.json().catch(() => ({}));
      const job = jd.job || {};
      const states = (job.progress && Array.isArray(job.progress.posts)) ? job.progress.posts : [];
      states.forEach((st, k) => {
        const p = view.posts[index(k)];
        if (!p || p.status === 'done') return;
        if (st.status === 'done' && st.url) Object.assign(p, { status: 'done', url: st.url });
        else if (st.status === 'failed') Object.assign(p, { status: 'failed', error: st.error });
        else if (st.status === 'working') p.status = 'working';
      });
      if (job.status === 'done' && job.result && Array.isArray(job.result.posts)) {
        if (isPostSize(job.result.ratio)) view.size = job.result.ratio;
        job.result.posts.forEach((r, k) => {
          const p = view.posts[index(k)];
          if (!p || !r) return;
          if (r.url) Object.assign(p, { status: 'done', url: r.url, caption: r.caption || '', hashtags: r.hashtags || [], ratio: view.size });
          else Object.assign(p, { status: 'failed', error: r.error || 'Could not be made' });
        });
        view.paint();
        return true;
      }
      if (job.status === 'failed' || jr.status === 404) {
        list.forEach((p) => { if (p.status !== 'done') Object.assign(p, { status: 'failed', error: job.error || 'Could not be made' }); });
        view.paint();
        return true;
      }
      view.paint();
    }
    list.forEach((p) => { if (p.status !== 'done') Object.assign(p, { status: 'failed', error: 'This took too long' }); });
    view.paint();
    return true;
  }

  // No brand design system: each post is a Stage generation of its own, two at a time.
  async function makeOneWithStage(p) {
    p.status = 'working';
    const res = await fetch(`${apiBase()}/api/studio/design-generate`, {
      method: 'POST',
      headers: authHeaders(),
      signal: AbortSignal.timeout(360_000),
      body: JSON.stringify({
        brief: p.brief,
        aspect_ratio: isPostSize(p.ratio) ? p.ratio : currentPostSize(),
        model: selectedEngineId(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'Could not be made');
    let url = data.image_url || '';
    if (data.async && data.job_id) {
      const started = Date.now();
      while (!url && Date.now() - started < 8 * 60_000) {
        await new Promise((r) => setTimeout(r, _csPostsPollMs));
        const jr = await fetch(`${apiBase()}/api/studio/design-job/${encodeURIComponent(data.job_id)}`, { headers: authHeaders() });
        const jd = await jr.json().catch(() => ({}));
        if (jd.status === 'completed' && jd.image_url) url = jd.image_url;
        else if (jd.status === 'failed' || jr.status === 404) throw new Error(jd.error || 'Could not be made');
      }
    }
    if (!url) throw new Error(data.html ? 'This engine makes a layout, not an image; open it on the canvas instead' : 'Could not be made');
    Object.assign(p, { status: 'done', url });
  }

  async function makePostsWithStage(view, only) {
    const queue = only != null ? [only] : view.posts.map((_, i) => i);
    const worker = async () => {
      while (queue.length) {
        const p = view.posts[queue.shift()];
        try { await makeOneWithStage(p); } catch (e) { Object.assign(p, { status: 'failed', error: e.message || 'Could not be made' }); }
        view.paint();
      }
    };
    view.paint();
    await Promise.all([worker(), worker()]);
  }

  async function runDesignPosts(action, { finished = null } = {}) {
    const view = designPostsCard(action);
    if (!view) return;
    if (finished) {
      // Brought back from the chat history: the posts are already made.
      view.posts.forEach((p, i) => Object.assign(p, finished[i] || {}, { status: 'done', ratio: (finished[i] && finished[i].ratio) || p.ratio }));
      view.paint();
    }
    const remember = () => {
      if (view.posts.some((p) => p.status === 'working' || p.status === 'queued')) return;
      const made = view.posts.filter((p) => p.status === 'done' && p.url);
      if (!made.length) return;
      persistSharedCoach('assistant', `Made ${made.length === 1 ? 'a post' : `${made.length} posts`}: ${made.map((p) => p.title).join('; ')}.`, { posts: made });
    };
    const run = async (only) => {
      const list = only != null ? [view.posts[only]] : view.posts;
      list.forEach((p) => Object.assign(p, { status: 'working', error: '' }));
      view.paint();
      try {
        const brand = action.engine === 'brand' && await makePostsWithBrand(view, action, only);
        if (!brand) await makePostsWithStage(view, only);
      } catch (e) {
        list.forEach((p) => { if (p.status !== 'done') Object.assign(p, { status: 'failed', error: e.message || 'Could not be made' }); });
        view.paint();
      }
    };
    view.card.addEventListener('click', async (e) => {
      const open = e.target.closest('[data-cs-post-open]');
      const queue = e.target.closest('[data-cs-post-queue]');
      const retry = e.target.closest('[data-cs-post-retry]');
      const all = e.target.closest('[data-cs-posts-queue-all]');
      if (open) {
        const p = view.posts[Number(open.getAttribute('data-cs-post-open'))];
        // The canvas and any change from here use the size this post was made at.
        setPostSize(p.ratio);
        const brief = document.getElementById('cs-brief');
        if (brief) brief.value = p.brief || p.title;
        _csBrief = p.brief || p.title;
        const cap = document.getElementById('cs-caption-box');
        if (cap && 'value' in cap) { cap.value = designPostsCaption(p); cap.dataset.caption = cap.value; }
        showGeneratedImage(p.url);
        toast(`"${p.title}" is on the canvas`, 'success');
      } else if (queue) {
        const p = view.posts[Number(queue.getAttribute('data-cs-post-queue'))];
        queue.disabled = true;
        queue.textContent = 'Adding…';
        // Stay here (the other posts are still in this chat); the toast says where it went.
        try { await queueDesignPost(p); toast(`"${p.title}" added to Review`, 'success'); } catch (err) { toast(err.message, 'error'); }
        view.paint();
        rememberQueued();
      } else if (retry) {
        await run(Number(retry.getAttribute('data-cs-post-retry')));
        remember();
      } else if (all) {
        all.disabled = true;
        all.textContent = 'Adding…';
        let added = 0;
        for (const p of view.posts) {
          if (p.status !== 'done' || p.queued) continue;
          try { await queueDesignPost(p); added += 1; } catch (err) { toast(err.message, 'error'); }
        }
        if (added) toast(`${added} post${added === 1 ? '' : 's'} added to Review`, 'success');
        view.paint();
        rememberQueued();
      }
    });
    // Which posts went to Review, so a reload does not offer them again.
    function rememberQueued() {
      const key = sharedCoachStorageKey();
      if (!key) return;
      try {
        const hist = JSON.parse(localStorage.getItem(key) || '[]');
        for (let i = hist.length - 1; i >= 0; i -= 1) {
          const m = hist[i];
          if (!m || !Array.isArray(m.posts)) continue;
          m.posts.forEach((hp) => { const p = view.posts.find((x) => x.url === hp.url); if (p && p.queued) hp.queued = true; });
          break;
        }
        localStorage.setItem(key, JSON.stringify(hist));
      } catch (_) { /* storage is a convenience */ }
    }
    if (finished) return;
    await run(null);
    remember();
  }

  function coachStyleHttpsUrls() {
    return _csCoachStyleUrls.filter((u) => /^https:\/\//i.test(u));
  }

  function formatSlideHttpsUrls() {
    const api = workspaceApi();
    const slides = hasCarousel() ? slidesInQueueOrder() : [];
    if (typeof api.formatSlideHttpsUrls === 'function') {
      return api.formatSlideHttpsUrls({
        styleUrls: coachStyleHttpsUrls(),
        carouselSlides: slides,
      });
    }
    const styles = coachStyleHttpsUrls();
    if (styles.length >= 2) return styles;
    return slides.map((s) => s && s.url).filter((u) => /^https:\/\//i.test(u));
  }

  function alignCarouselPlanToStyleRefs(plan, styleUrls) {
    const n = Math.min(10, (Array.isArray(styleUrls) ? styleUrls : []).filter((u) => /^https:\/\//i.test(u)).length);
    if (!plan || !Array.isArray(plan.slides) || n < 4) return plan;
    if (plan.slides.length >= n) return plan;
    const slides = plan.slides.slice();
    while (slides.length < n) {
      const i = slides.length;
      slides.push({
        index: i + 1,
        role: 'other',
        title: `Slide ${i + 1}`,
        keep: 'Facts from the source infographic; layout trained from the format-set references.',
        do_not_invent: 'only facts visible on the source infographic; do not invent stats or claims',
        composition: 'complete 9:16 slide matching the attached format set; do not crop a strip from the poster',
      });
    }
    return { ...plan, slides: slides.map((s, i) => ({ ...s, index: i + 1 })) };
  }

  function renderCoachStyleChip() {
    const chip = document.getElementById('cs-coach-style-chip');
    if (!chip) return;
    if (!_csCoachStyleUrls.length) {
      chip.style.display = 'none';
      chip.innerHTML = '';
      _csCoachStylesSentToChat = new Set();
      return;
    }
    const n = _csCoachStyleUrls.length;
    chip.style.display = 'flex';
    chip.style.flexDirection = 'column';
    chip.style.gap = '6px';
    chip.style.maxHeight = '76px';
    chip.style.overflowY = 'auto';
    const thumbs = _csCoachStyleUrls.map((url, i) => (
      `<span style="position:relative;display:inline-flex;flex-shrink:0;" title="Style ${i + 1} — match this format">`
      + `<img src="${escapeHtml(mediaSrc(url))}" alt="" referrerpolicy="no-referrer" style="width:32px;height:32px;border-radius:6px;object-fit:cover;background:#111;border:1px solid rgba(124,58,237,0.35);">`
      + `<button type="button" data-style-clear="${i}" aria-label="Remove style ${i + 1}" style="position:absolute;top:-5px;right:-5px;width:16px;height:16px;padding:0;border-radius:999px;border:none;background:#1E1433;color:#E9D5FF;font-size:11px;line-height:16px;cursor:pointer;">×</button>`
      + `</span>`
    )).join('');
    chip.innerHTML = (
      `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">`
      + `<span style="font-size:0.68rem;font-weight:700;color:#DDD6FE;">Style refs (${n})</span>`
      + `<button type="button" data-style-clear-all="1" style="background:none;border:none;color:rgba(233,213,255,0.75);font-size:0.68rem;font-weight:600;cursor:pointer;font-family:var(--font-body);">Clear all</button>`
      + `</div>`
      + `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">${thumbs}</div>`
    );
    chip.querySelectorAll('[data-style-clear]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-style-clear'));
        if (!Number.isFinite(idx)) return;
        const removed = _csCoachStyleUrls.splice(idx, 1)[0];
        if (removed) _csCoachStylesSentToChat.delete(removed);
        renderCoachStyleChip();
        loadDesignEngines();
      });
    });
    chip.querySelector('[data-style-clear-all]')?.addEventListener('click', () => {
      _csCoachStyleUrls = [];
      _csCoachStylesSentToChat = new Set();
      renderCoachStyleChip();
      loadDesignEngines();
    });
  }

  function setDesignCoachApply(pending) {
    _csCoachPending = pending || null;
    const wrap = document.getElementById('cs-coach-apply-wrap');
    const btn = document.getElementById('cs-coach-apply');
    if (!wrap || !btn) return;
    const mode = _csCoachPending && _csCoachPending.mode;
    if (!_csCoachPending || mode === 'none' || mode === 'refine' || mode === 'apply_carousel' || mode === 'apply_generate') {
      wrap.style.display = 'none';
      return;
    }
    if (mode === 'offer_split') {
      btn.textContent = (typeof window.SPLIT_LABEL === 'string' && window.SPLIT_LABEL) || 'Split into carousel';
      wrap.style.display = 'block';
      return;
    }
    if (mode === 'offer_caption') {
      btn.textContent = (typeof window.CAPTION_LABEL === 'string' && window.CAPTION_LABEL) || 'Write caption and queue';
      wrap.style.display = 'block';
      return;
    }
    if (mode === 'confirm_carousel') {
      const master = String((_csCoachPending.action && _csCoachPending.action.master_image_url) || masterImageUrl() || '');
      if (!/^https:\/\//i.test(master)) {
        wrap.style.display = 'none';
        return;
      }
    }
    btn.textContent = mode === 'confirm_carousel' ? 'Apply carousel plan' : 'Apply design';
    wrap.style.display = 'block';
  }

  function hydrateDesignCoachLog() {
    const log = document.getElementById('cs-coach-log');
    if (!log) return;
    log.innerHTML = '';
    const key = sharedCoachStorageKey();
    let hist = [];
    if (key) {
      try { hist = JSON.parse(localStorage.getItem(key) || '[]'); } catch { hist = []; }
    }
    hist.slice(-12).forEach((m) => {
      if (m && (m.role === 'user' || m.role === 'assistant' || m.role === 'ai') && m.text) {
        appendDesignCoachBubble(m.role === 'user' ? 'user' : 'assistant', String(m.text));
      }
      if (m && m.role !== 'user' && Array.isArray(m.actions)) {
        const plan = m.actions.find((a) => a && a.type === 'carousel_redesign' && Array.isArray(a.slides) && a.slides.length >= 2);
        if (plan) window.__SE_CAROUSEL_PLAN = plan;
        const ranAgent = m.actions.find((a) => a && a.type === 'agent_run' && a.run_id);
        if (ranAgent) mountDesignAgentRun(ranAgent.run_id);
      }
      if (m && m.role !== 'user' && Array.isArray(m.posts) && m.posts.length) {
        runDesignPosts({ type: 'design_posts', aspect_ratio: (m.posts.find((p) => p.ratio) || {}).ratio || '', posts: m.posts.map((p) => ({ title: p.title, brief: p.brief })) }, { finished: m.posts });
      }
    });
    if (!log.childElementCount) {
      appendDesignCoachBubble('assistant', 'Tell me what you want to post, or describe it on the canvas. Once it is made, ask me for any change and it updates here.');
    }
  }

  async function generateFromCoach(prompt, opts = {}) {
    const briefEl = document.getElementById('cs-brief');
    const next = String(prompt || '').trim();
    const waitingAsk = typeof window.isCoachWaitingOnCreateAsk === 'function'
      ? window.isCoachWaitingOnCreateAsk(next)
      : /\bare you (creating|generating)\b/i.test(next);
    if (_csGenerating) {
      restoreBusyUiIfGenerating();
      toast('Still generating — watch the Stage spinner', 'info');
      return 'busy';
    }
    const current = briefEl ? (briefEl.value.trim() || _csBrief) : _csBrief;
    if (waitingAsk) {
      if (!current) {
        toast('Describe your post first', 'warning');
        return false;
      }
    } else if (!next) {
      return false;
    } else if (briefEl && opts.fresh) {
      briefEl.value = next;
    } else if (briefEl) {
      const styles = coachStyleHttpsUrls();
      if (styles.length && current) {
        // Keep the operator topic. Coach layout essays fight the style image at FigureLabs.
      } else if (masterImageUrl() && current && next !== current) {
        briefEl.value = `${current} [MODIFICATION: ${next}]`;
      } else {
        briefEl.value = next;
      }
    }
    const before = _csGeneratedUrl;
    _csGenerateError = '';
    if (!_csGenerating) {
      setBusy(true, CS_LEAVE_BUSY);
    }
    await generate({ continueBusy: true, fresh: !!opts.fresh });
    return Boolean(_csGeneratedUrl && _csGeneratedUrl !== before);
  }

  async function saveOpenTemplate() {
    const api = sceneApi();
    const ws = workspaceApi();
    const formatUrls = formatSlideHttpsUrls();
    let scene = null;
    if (formatUrls.length >= 2) {
      scene = typeof api.sceneFromSlideImages === 'function'
        ? api.sceneFromSlideImages(formatUrls, { name: currentTitle() || 'Carousel format' })
        : {
          type: 'design_scene',
          name: currentTitle() || 'Carousel format',
          aspect: '9:16',
          slides: formatUrls.slice(0, 10).map((href, i) => ({
            index: i + 1,
            objects: [{ id: `slide-${i + 1}-art`, kind: 'image', slot: 'art', unique: false, href }],
          })),
        };
    }
    if (!scene) scene = _csScene;
    if (!scene) {
      toast('Upload the carousel slides or attach them as reference photos, then Save as template', 'warning');
      return false;
    }
    scene = typeof api.stripUniqueSlots === 'function' ? api.stripUniqueSlots(scene) : scene;
    _csScene = scene;
    const items = typeof ws.upsertLibraryItem === 'function'
      ? ws.upsertLibraryItem(loadSavedTemplates(), {
        id: `tmpl-${Date.now()}`,
        title: scene.name || currentTitle(),
        status: 'saved',
        scene,
        saved_at: Date.now(),
      })
      : loadSavedTemplates();
    writeJsonStore(templateStoreKey(), items);
    renderSavedDesigns();
    renderScenePreview();
    toast(formatUrls.length >= 2 ? 'Template saved from those slides' : 'Template saved', 'success');
    return true;
  }

  async function applyCarouselPlan(plan) {
    if (window.seCarouselTemplates) {
      await window.seCarouselTemplates.list().catch(() => null);
      if (window.seCarouselTemplates.defaultTemplate()) {
        return buildTemplateCarousel({ plan: plan && Array.isArray(plan.slides) ? plan.slides : null });
      }
    }
    const canvasMaster = String(masterImageUrl() || window._seCoachAttachedImage || '').trim();
    const planMaster = String((plan && plan.master_image_url) || '').trim();
    const master = /^https:\/\//i.test(canvasMaster) ? canvasMaster : planMaster;
    if (_csScene) {
      setBusy(true, 'Filling the template from the 4K poster…');
      try {
        const res = await fetch(`${apiBase()}/api/studio/design-scene/fill`, {
          method: 'POST',
          headers: authHeaders(),
          signal: AbortSignal.timeout(120_000),
          body: JSON.stringify({ master_image_url: master, scene: _csScene }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.scene) throw new Error(data.error || 'Could not fill template');
        _csScene = data.scene;
        renderScenePreview();
        toast('Template filled from the poster — FigureLabs did not redraw the slides', 'success');
        return true;
      } catch (e) {
        carouselFail(e.message || 'template fill failed');
        return false;
      } finally {
        setBusy(false);
      }
    }
    const aligned = alignCarouselPlanToStyleRefs(plan, coachStyleHttpsUrls());
    const slides = aligned && Array.isArray(aligned.slides) ? aligned.slides : [];
    if (!/^https:\/\//i.test(master) || slides.length < 2) {
      carouselFail('need a stored poster and a 2–10 slide plan');
      return false;
    }
    const painted = [];
    let sessionId = '';
    setBusy(true, `Painting slide 1 of ${slides.length}…`);
    try {
      for (let i = 0; i < slides.length; i++) {
        setBusy(true, `Painting slide ${i + 1} of ${slides.length}…`);
        const res = await fetch(`${apiBase()}/api/studio/carousel-redesign/slide`, {
          method: 'POST',
          headers: authHeaders(),
          signal: AbortSignal.timeout(180_000),
          body: JSON.stringify({
            master_image_url: master,
            session_id: sessionId,
            slide: slides[i],
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) throw new Error(data.error || `Slide ${i + 1} generate failed`);
        sessionId = data.session_id || sessionId;
        painted.push({
          index: Number(data.index) || i + 1,
          url: data.url,
          title: data.title || slides[i].title || `Slide ${i + 1}`,
          session_id: sessionId,
        });
        window.__SE_CAROUSEL_REDESIGN = {
          ok: true,
          master_image_url: master,
          session_id: sessionId,
          slides: painted,
        };
        if (painted.length >= 2) applyRedesignedSlides();
      }
      toast('Carousel ready', 'success');
      return true;
    } catch (e) {
      carouselFail(e.message || 'carousel redesign failed');
      if (painted.length >= 2) applyRedesignedSlides();
      return painted.length >= 2;
    } finally {
      setBusy(false);
    }
  }

  async function applyPendingDesignCoach() {
    const pending = _csCoachPending;
    if (!pending) return;
    const btn = document.getElementById('cs-coach-apply');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Applying…';
    }
    try {
      if (pending.mode === 'confirm_carousel') {
        const ok = await applyCarouselPlan(pending.action || {});
        if (ok) {
          _csCoachJob = typeof window.advanceCoachJob === 'function'
            ? window.advanceCoachJob(_csCoachJob || pending.job, 'split')
            : _csCoachJob;
          offerNextCoachJobChip();
        }
      } else if (pending.mode === 'offer_split') {
        const plan = window.__SE_CAROUSEL_PLAN;
        const usable = plan && Array.isArray(plan.slides) && plan.slides.length >= 2;
        if (usable && /^https:\/\//i.test(masterImageUrl())) {
          const ok = await applyCarouselPlan(plan);
          if (ok) {
            _csCoachJob = typeof window.advanceCoachJob === 'function'
              ? window.advanceCoachJob(_csCoachJob || pending.job, 'split')
              : _csCoachJob;
            offerNextCoachJobChip();
          }
        } else {
          setDesignCoachApply(null);
          await designCoachAsk(CS_CAROUSEL_SEED);
        }
      } else if (pending.mode === 'offer_caption') {
        await getCaption();
        _csCoachJob = typeof window.advanceCoachJob === 'function'
          ? window.advanceCoachJob(_csCoachJob || pending.job, 'captioned')
          : _csCoachJob;
        setDesignCoachApply(null);
      } else if (pending.mode === 'confirm_generate' || pending.mode === 'apply_generate') {
        applyCoachPostSize(pending.action);
        const ok = await generateFromCoach(pending.prompt);
        if (ok === true) {
          _csPosterOk = masterImageUrl();
          _csCoachJob = typeof window.advanceCoachJob === 'function'
            ? window.advanceCoachJob(_csCoachJob || pending.job, 'generated')
            : _csCoachJob;
          offerNextCoachJobChip();
        } else if (ok !== 'busy') {
          setDesignCoachApply(null);
        }
      }
    } finally {
      if (btn && _csCoachPending) {
        btn.disabled = false;
        btn.textContent = _csCoachPending.mode === 'offer_split'
          ? ((typeof window.SPLIT_LABEL === 'string' && window.SPLIT_LABEL) || 'Split into carousel')
          : _csCoachPending.mode === 'offer_caption'
            ? ((typeof window.CAPTION_LABEL === 'string' && window.CAPTION_LABEL) || 'Write caption and queue')
            : _csCoachPending.mode === 'confirm_carousel' ? 'Apply carousel plan' : 'Apply design';
      }
    }
  }

  function offerNextCoachJobChip() {
    const job = typeof window.normalizeCoachJob === 'function'
      ? window.normalizeCoachJob(_csCoachJob)
      : _csCoachJob;
    _csCoachJob = job;
    if (!job) {
      setDesignCoachApply(null);
      return;
    }
    if (job.stage === 'split' && /^https:\/\//i.test(masterImageUrl())) {
      setDesignCoachApply({ mode: 'offer_split', job });
      return;
    }
    if (job.stage === 'caption') {
      setDesignCoachApply({ mode: 'offer_caption', job });
      return;
    }
    setDesignCoachApply(null);
  }

  let _csCoachStatusTimer = null;

  // The log follows new content only while you are at the bottom. Scroll up to read and it stays put, even
  // while a project card keeps updating. Sending your own message (force) or scrolling back down follows again.
  function scrollCoachLogToBottom(force) {
    const log = document.getElementById('cs-coach-log');
    if (!log) return;
    if (!log._csFollow) {
      log._csFollow = { on: true };
      log.addEventListener('scroll', () => {
        log._csFollow.on = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
      }, { passive: true });
    }
    if (force !== true && !log._csFollow.on) return;
    log._csFollow.on = true;
    log.scrollTop = log.scrollHeight;
  }

  /** A project the Coach's agent is working on: a live card in the Coach log (plan, steps, finished work). */
  function mountDesignAgentRun(runId) {
    const log = document.getElementById('cs-coach-log');
    if (!log || !runId || !window.seAgentRun) return;
    const holder = document.createElement('div');
    holder.className = 'cs-cb cs-cb--ai';
    holder.style.cssText = 'align-self:stretch;max-width:100%;';
    log.appendChild(holder);
    window.seAgentRun.mount(holder, runId, { scroll: scrollCoachLogToBottom, reply: (text) => designCoachAsk(text) });
  }

  function coachStatusPhrases(hasStyleRefs) {
    const base = [
      'Coach is reading…',
      'Coach is drafting…',
      'Coach is shaping the brief…',
      'Coach is lining up next steps…',
    ];
    if (!hasStyleRefs) return base;
    return [
      'Coach is reading…',
      'Coach is checking your references…',
      'Coach is matching the style…',
      'Coach is drafting…',
      'Coach is shaping the brief…',
    ];
  }

  function setCoachStatusBusy(busy, { hasStyleRefs = false } = {}) {
    const wrap = document.getElementById('cs-coach-status');
    const text = document.getElementById('cs-coach-status-text');
    const input = document.getElementById('cs-coach-input');
    if (_csCoachStatusTimer) {
      clearInterval(_csCoachStatusTimer);
      _csCoachStatusTimer = null;
    }
    if (!busy) {
      if (wrap) wrap.style.display = 'none';
      if (input) input.placeholder = input.dataset.placeholder || 'Ask your coach…';
      return;
    }
    const phrases = coachStatusPhrases(hasStyleRefs);
    let i = 0;
    if (text) text.textContent = phrases[0];
    if (wrap) wrap.style.display = 'flex';
    if (input) input.placeholder = phrases[0];
    _csCoachStatusTimer = setInterval(() => {
      i = (i + 1) % phrases.length;
      if (text) text.textContent = phrases[i];
      if (input) input.placeholder = phrases[i];
    }, 2200);
  }

  async function runCarouselFromPlan(decision) {
    const status = appendDesignCoachBubble('assistant', 'Generating the carousel…');
    scrollCoachLogToBottom();
    _csCarouselError = '';
    const ok = await applyCarouselPlan(decision.action || {});
    if (status) status.textContent = ok ? 'Carousel ready.' : `Could not generate the carousel: ${_csCarouselError || 'no reason given'}.`;
    if (ok) {
      _csCoachJob = typeof window.advanceCoachJob === 'function'
        ? window.advanceCoachJob(_csCoachJob || decision.job, 'split')
        : _csCoachJob;
      offerNextCoachJobChip();
    }
    return ok;
  }

  function posterBriefFromPlan(decision) {
    const job = decision.job || _csCoachJob || {};
    const slides = (decision.action && Array.isArray(decision.action.slides)) ? decision.action.slides : [];
    const points = slides.map((s, i) => `${i + 1}. ${s.title || ''}${s.keep ? ` — ${s.keep}` : ''}`).join('\n');
    return [job.goal || 'Infographic for this carousel', points ? `Cover these points:\n${points}` : ''].filter(Boolean).join('\n\n');
  }

  // The poster on Stage predates this request — ask before slicing slides from it.
  function askPosterForCarousel(decision) {
    const row = appendDesignCoachBubble('assistant', 'The poster on the canvas was made before this request. Which poster should the carousel come from?');
    if (!row) return;
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;';
    const btn = 'padding:6px 10px;border-radius:8px;color:#fff;font-size:0.72rem;font-weight:700;cursor:pointer;font-family:var(--font-body);';
    bar.innerHTML = `<button type="button" data-poster="keep" class="cs-poster-choice" style="${btn}border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.06);">Use the poster on the canvas</button>`
      + `<button type="button" data-poster="new" class="cs-poster-choice" style="${btn}border:1px solid #7C3AED;background:#7C3AED;">Make a new poster first</button>`;
    row.appendChild(bar);
    scrollCoachLogToBottom();
    bar.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
      bar.querySelectorAll('button').forEach((x) => { x.disabled = true; x.style.opacity = '0.5'; });
      if (b.getAttribute('data-poster') === 'keep') {
        _csPosterOk = masterImageUrl();
        await runCarouselFromPlan(decision);
        return;
      }
      const status = appendDesignCoachBubble('assistant', 'Generating the 4K poster first…');
      scrollCoachLogToBottom();
      const ok = await generateFromCoach(posterBriefFromPlan(decision), { fresh: true });
      if (ok !== true) {
        if (status) status.textContent = ok === 'busy' ? 'Still generating — try again when the Stage is free.' : `Could not generate the poster: ${_csGenerateError || 'no reason given'}.`;
        bar.querySelectorAll('button').forEach((x) => { x.disabled = false; x.style.opacity = ''; });
        return;
      }
      if (status) status.textContent = '4K poster ready. Building the carousel from it…';
      _csPosterOk = masterImageUrl();
      await runCarouselFromPlan(decision);
    }));
  }

  async function designCoachAsk(preset) {
    const input = document.getElementById('cs-coach-input');
    const message = String(preset || input?.value || '').trim();
    if (!message || _csCoachSending) return;
    if (input) {
      input.value = '';
      input.style.height = 'auto';
      const maxPx = parseFloat(getComputedStyle(input).maxHeight) || 160;
      input.style.height = Math.min(input.scrollHeight, maxPx) + 'px';
    }
    if (_csScene && sceneApi().applySceneCoachEdit) {
      const next = sceneApi().applySceneCoachEdit(_csScene, message);
      const changed = JSON.stringify(next) !== JSON.stringify(_csScene);
      if (changed) {
        _csScene = next;
        appendDesignCoachBubble('user', message);
        persistSharedCoach('user', message);
        appendDesignCoachBubble('assistant', 'Hidden that piece. The rest of the layout is unchanged.');
        persistSharedCoach('assistant', 'Hidden that piece. The rest of the layout is unchanged.');
        renderScenePreview();
        return;
      }
    }
    _csCoachSending = true;
    if (typeof window.coachStartsNewDesignTopic === 'function' && window.coachStartsNewDesignTopic(message)) _csPosterOk = '';
    const allStyleUrls = coachStyleHttpsUrls();
    // Inject style vision once per attach. Re-sending on every turn floods the model.
    const styleUrls = coachStylesPendingForChat();
    setCoachStatusBusy(true, { hasStyleRefs: styleUrls.length > 0 });
    if (_csCoachStyleUrls.length && !allStyleUrls.length) {
      toast('Style photos need a stored https URL — re-upload them', 'error');
    }
    const shown = styleUrls.length
      ? `${message}\n\n${styleUrls.length === 1 ? '1 style reference attached.' : `${styleUrls.length} style references attached.`}`
      : message;
    appendDesignCoachBubble('user', shown);
    persistSharedCoach('user', shown);
    scrollCoachLogToBottom();
    try {
      const attached = masterImageUrl() || window._seCoachAttachedImage || window.__SE_COACH_MASTER_IMAGE || '';
      const outbound = styleUrls.length >= 4
        ? `${message}\n\n${styleUrls.length} format-reference slides are attached. Train from their layout, color, and type. The plan must have exactly ${styleUrls.length} slides. Content comes from the source infographic.`
        : styleUrls.length === 1
          ? `${message}\n\nA house-style reference photo is attached. Match that carousel / graphic format.`
          : styleUrls.length > 1
            ? `${message}\n\n${styleUrls.length} house-style reference photos are attached. Combine their carousel / graphic format. Content comes from the source infographic.`
            : message;
      const res = await fetch(`${apiBase()}/api/chat/v2`, {
        method: 'POST',
        headers: authHeaders(),
        signal: AbortSignal.timeout(styleUrls.length >= 6 ? 120_000 : 90_000),
        body: JSON.stringify({
          message: outbound,
          attached_image_url: /^https:\/\//i.test(attached) ? attached : '',
          style_image_url: styleUrls[0] || '',
          style_image_urls: styleUrls,
          surface: 'design',
        }),
      });
      if (!res.ok) throw new Error('Coach error');
      const data = await res.json().catch(() => ({}));
      markCoachStylesSent(styleUrls);
      setCoachStatusBusy(false);
      const reply = String(data.reply || 'Got it.');
      appendDesignCoachBubble('assistant', reply);
      persistSharedCoach('assistant', reply, { actions: (Array.isArray(data.coach_actions) ? data.coach_actions : []).map((a) => (a && a.type === 'agent_run' ? { type: 'agent_run', run_id: a.run_id } : a)) });
      scrollCoachLogToBottom();
      const decide = typeof window.resolveDesignCoachApply === 'function'
        ? window.resolveDesignCoachApply
        : () => ({ mode: 'none' });
      const actions = Array.isArray(data.coach_actions) ? data.coach_actions : [];
      const agentRun = actions.find((a) => a && a.type === 'agent_run' && a.run_id);
      if (agentRun && window.seAgentRun) {
        setDesignCoachApply(null);
        mountDesignAgentRun(agentRun.run_id);
        return;
      }
      const designStyle = actions.find((a) => a && a.type === 'design_style' && a.source_image_url);
      if (designStyle && window.seDesignStudio && window.seDesignStudio.buildStyle) {
        setDesignCoachApply(null);
        runDesignStyle(designStyle);
        return;
      }
      const designPosts = actions.find((a) => a && a.type === 'design_posts' && Array.isArray(a.posts) && a.posts.length);
      if (designPosts) {
        setDesignCoachApply(null);
        // The size the Coach said is the size the picker shows and the posts are made at.
        setPostSize(designPosts.aspect_ratio, { say: true });
        runDesignPosts(designPosts);
        return;
      }
      const designCarousel = actions.find((a) => a && a.type === 'design_carousel' && a.brief);
      if (designCarousel && window.seDesignStudio) {
        setDesignCoachApply(null);
        offerDesignCarousel(designCarousel);
        return;
      }
      const fromActions = actions.find((a) => a && a.type === 'carousel_redesign' && Array.isArray(a.slides) && a.slides.length >= 2);
      if (fromActions) window.__SE_CAROUSEL_PLAN = fromActions;
      const decision = decide({
        reply,
        userMessage: message,
        hasCanvas: !!masterImageUrl(),
        actions,
        lastPlan: window.__SE_CAROUSEL_PLAN || null,
        lastJob: _csCoachJob,
      });
      if (decision.job) _csCoachJob = decision.job;
      if (decision.action && decision.action.type === 'carousel_redesign') {
        window.__SE_CAROUSEL_PLAN = decision.action;
      }
      setDesignCoachApply(decision);
      _csCoachSending = false;
      if (decision.hint === 'carousel_plan_missing') {
        appendDesignCoachBubble('assistant', 'The slide plan did not come through complete, so I left your poster alone. Say "send the slide plan again" and I will build the slides from it.');
        scrollCoachLogToBottom();
      }
      if (decision.mode === 'apply_carousel') {
        const master = masterImageUrl();
        if (/^https:\/\//i.test(master) && _csPosterOk !== master) askPosterForCarousel(decision);
        else await runCarouselFromPlan(decision);
      } else if (decision.mode === 'apply_generate') {
        applyCoachPostSize(decision.action);
        const status = appendDesignCoachBubble('assistant', 'Generating the 4K poster…');
        scrollCoachLogToBottom();
        // generateFromCoach owns setBusy — do not set busy before calling it
        // (that races the in-flight guard and leaves Stage stuck forever).
        const ok = await generateFromCoach(decision.prompt || message);
        if (ok === true) _csPosterOk = masterImageUrl();
        if (status) {
          status.textContent = ok === true
            ? '4K poster ready.'
            : ok === 'busy'
              ? 'Still generating — watch the Stage spinner.'
              : 'Could not generate the poster.';
        }
        if (ok === true) {
          _csCoachJob = typeof window.advanceCoachJob === 'function'
            ? window.advanceCoachJob(_csCoachJob || decision.job, 'generated')
            : _csCoachJob;
          offerNextCoachJobChip();
        } else if (ok !== 'busy') {
          setBusy(false);
        }
      } else if (decision.mode === 'refine') {
        applyCoachPostSize(decision.action);
        const status = appendDesignCoachBubble('assistant', 'Updating the preview…');
        scrollCoachLogToBottom();
        const ok = await generateFromCoach(decision.prompt || message);
        if (ok === true) _csPosterOk = masterImageUrl();
        if (status) {
          status.textContent = ok === true
            ? 'Preview updated.'
            : ok === 'busy'
              ? 'Still generating — watch the Stage spinner.'
              : 'Could not update the preview.';
        }
        if (ok !== true && ok !== 'busy') setBusy(false);
      }
    } catch (e) {
      setCoachStatusBusy(false);
      const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      appendDesignCoachBubble('assistant', timedOut
        ? 'Coach took too long with those photos. Try again — if it stalls, send fewer references.'
        : (e.message || 'Coach error — try again.'));
      scrollCoachLogToBottom();
      setDesignCoachApply(null);
    } finally {
      _csCoachSending = false;
      setCoachStatusBusy(false);
    }
  }

  // html2canvas (199 KB) is only needed for export, so it is loaded on first use
  // instead of on every portal visit.
  let _html2canvasPromise = null;
  function loadHtml2Canvas() {
    if (typeof html2canvas === 'function') return Promise.resolve();
    if (_html2canvasPromise) return _html2canvasPromise;
    _html2canvasPromise = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => { _html2canvasPromise = null; reject(new Error('Export library failed to load')); };
      document.head.appendChild(el);
    });
    return _html2canvasPromise;
  }

  async function rasterizePngBlob() {
    if (!_csHtml) throw new Error('No design to export');
    await loadHtml2Canvas();
    if (typeof html2canvas !== 'function') throw new Error('html2canvas not loaded — hard refresh');

    const mount = document.getElementById('cs-export-mount');
    mount.innerHTML = '';
    const host = document.createElement('div');
    host.style.cssText = `width:${_csSpec.w}px;height:${_csSpec.h}px;overflow:hidden;background:#fff;`;
    const iframe = document.createElement('iframe');
    iframe.style.cssText = `width:${_csSpec.w}px;height:${_csSpec.h}px;border:0;`;
    mount.appendChild(iframe);
    await new Promise((resolve) => {
      iframe.onload = resolve;
      iframe.srcdoc = _csHtml;
      setTimeout(resolve, 1800);
    });

    const doc = iframe.contentDocument;
    const target = doc?.body || host;
    const canvas = await html2canvas(target, {
      width: _csSpec.w,
      height: _csSpec.h,
      scale: 1,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      windowWidth: _csSpec.w,
      windowHeight: _csSpec.h,
    });
    mount.innerHTML = '';
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encode failed'))), 'image/png');
    });
  }

  async function exportPng(andQueue) {
    if (_csGenerating) return;
    if (hasCarousel()) {
      await exportCarousel(andQueue);
      return;
    }
    if (!_csHtml && _csGeneratedUrl) {
      if (andQueue) {
        await queueSingleImage(_csGeneratedUrl);
        return;
      }
      const a = document.createElement('a');
      a.href = mediaSrc(_csGeneratedUrl);
      a.download = `design-${Date.now()}.png`;
      a.target = '_blank';
      a.rel = 'noopener';
      a.click();
      toast('PNG opened', 'success');
      return;
    }
    if (!_csHtml && _csQueueSingleUrl && andQueue) {
      await queueSingleImage(_csQueueSingleUrl);
      return;
    }
    if (!_csHtml) return;
    const btn = document.getElementById(andQueue ? 'cs-queue' : 'cs-export');
    const prev = btn?.textContent;
    if (btn) { btn.textContent = andQueue ? 'Queuing…' : 'Exporting…'; btn.disabled = true; }
    try {
      const blob = await rasterizePngBlob();
      if (!andQueue) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `claude-design-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
        toast('PNG downloaded', 'success');
        return;
      }

      const fd = new FormData();
      fd.append('file', blob, `claude-design-${Date.now()}.png`);
      const up = await fetch(`${apiBase()}/api/studio/upload-image`, {
        method: 'POST',
        headers: authHeadersMultipart(),
        body: fd,
      });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok || !upData.url) throw new Error(upData.error || 'Upload failed');

      const captionText = readQueueCaption();
      _csBrief = document.getElementById('cs-brief')?.value?.trim() || _csBrief;

      const q = await fetch(`${apiBase()}/api/studio/design-queue`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          image_url: upData.url,
          brief: _csBrief,
          caption: captionText || _csBrief,
          platform: queuePlatform(),
          status: queueReady().queueReviewStatus(),
        }),
      });
      const qData = await q.json().catch(() => ({}));
      if (!q.ok || !(qData.ok || qData.success)) throw new Error(qData.error || 'Queue failed');
      afterQueued();
      if (btn) btn.textContent = 'Added ✓';
      setTimeout(() => { if (btn) btn.textContent = prev || 'Add to Queue'; }, 1600);
    } catch (e) {
      toast(e.message || 'Export failed', 'error');
    } finally {
      if (btn && btn.textContent.includes('…')) btn.textContent = prev || (andQueue ? 'Add to Queue' : 'Export PNG');
      refreshActionButtons();
    }
  }

  async function queueSingleImage(imageUrl) {
    const btn = document.getElementById('cs-queue');
    const prev = btn?.textContent;
    if (btn) { btn.textContent = 'Queuing…'; btn.disabled = true; }
    try {
      _csBrief = document.getElementById('cs-brief')?.value?.trim() || _csBrief;
      const caption = readQueueCaption();
      if (!caption) {
        toast('Paste the caption (or write it in Describe your post)', 'warning');
        return;
      }
      const q = await fetch(`${apiBase()}/api/studio/design-queue`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          image_url: imageUrl,
          brief: _csBrief,
          caption,
          platform: queuePlatform(),
          status: queueReady().queueReviewStatus(),
        }),
      });
      const qData = await q.json().catch(() => ({}));
      if (!q.ok || !(qData.ok || qData.success)) throw new Error(qData.error || 'Queue failed');
      afterQueued();
      if (btn) btn.textContent = 'Added ✓';
      setTimeout(() => { if (btn) btn.textContent = prev || 'Add to Queue'; }, 1600);
    } catch (e) {
      toast(e.message || 'Queue failed', 'error');
    } finally {
      if (btn && String(btn.textContent).includes('…')) btn.textContent = prev || 'Add to Queue';
      refreshActionButtons();
    }
  }

  async function exportCarousel(andQueue) {
    const slides = slidesInQueueOrder();
    const imageUrls = slides.map((s) => s.url).filter(Boolean);
    if (imageUrls.length < 2) return;
    const btn = document.getElementById(andQueue ? 'cs-queue' : 'cs-export');
    const prev = btn?.textContent;
    if (btn) { btn.textContent = andQueue ? 'Queuing…' : 'Exporting…'; btn.disabled = true; }
    try {
      if (!andQueue) {
        const res = await fetch(`${apiBase()}/api/studio/carousel-zip`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ image_urls: imageUrls }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'ZIP export failed');
        }
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'carousel-slides.zip';
        a.click();
        URL.revokeObjectURL(a.href);
        toast('ZIP downloaded', 'success');
        return;
      }

      _csBrief = document.getElementById('cs-brief')?.value?.trim() || _csBrief;
      const captionText = readQueueCaption();
      const q = await fetch(`${apiBase()}/api/studio/design-queue`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          image_urls: imageUrls,
          brief: _csBrief,
          caption: captionText || _csBrief,
          platform: queuePlatform(),
          status: queueReady().queueReviewStatus(),
        }),
      });
      const qData = await q.json().catch(() => ({}));
      if (!q.ok || !(qData.ok || qData.success)) throw new Error(qData.error || 'Queue failed');
      afterQueued();
      if (btn) btn.textContent = 'Added ✓';
      setTimeout(() => { if (btn) btn.textContent = prev || 'Add to Queue'; }, 1600);
    } catch (e) {
      toast(e.message || 'Export failed', 'error');
    } finally {
      if (btn && String(btn.textContent).includes('…')) btn.textContent = prev || (andQueue ? 'Add to Queue' : 'Export ZIP');
      refreshActionButtons();
    }
  }

  // What the caption writer should look at: the carousel slides, the
  // designed / picked image, or the referenced video. Only stored https URLs.
  function captionMedia() {
    const https = (u) => (/^https:\/\//i.test(String(u || '')) ? String(u) : '');
    if (hasCarousel()) {
      const urls = (_csCarousel.slides || []).map((sl) => https(sl.url)).filter(Boolean).slice(0, 10);
      if (urls.length > 1) return { image_urls: urls, media_type: 'carousel' };
      if (urls.length === 1) return { media_url: urls[0], media_type: 'image' };
    }
    const image = https(_csQueueSingleUrl) || https(_csGeneratedUrl) || https(_csOriginalPreviewUrl) || (_csRef && _csRef.type === 'image' ? https(_csRef.url) : '');
    if (image) return { media_url: image, media_type: 'image' };
    if (_csRef && _csRef.type === 'video' && https(_csRef.video_url || _csRef.url)) return { media_url: https(_csRef.video_url || _csRef.url), media_type: 'video' };
    return null;
  }

  async function getCaption() {
    const box = document.getElementById('cs-caption-box');
    const btn = document.getElementById('cs-caption');
    _csBrief = document.getElementById('cs-brief')?.value?.trim() || _csBrief;
    const media = captionMedia();
    if (!_csBrief && !media) {
      toast('Describe your post first', 'warning');
      return;
    }
    const draft = box && 'value' in box ? String(box.value || '').trim() : '';
    if (btn) { btn.disabled = true; btn.textContent = media ? 'Looking…' : 'Writing…'; }
    if (box && 'value' in box && !draft) box.value = 'Writing caption…';
    try {
      const res = await fetch(`${apiBase()}/api/studio/generate-caption`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ description: _csBrief, platform: 'Instagram', current_caption: draft, ...(media || {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Caption failed');
      const caption = data.caption || '';
      if (box) {
        box.dataset.caption = caption;
        if ('value' in box) box.value = caption;
      }
      if (data.warning) toast(data.warning, 'warning');
    } catch (e) {
      toast(e.message || 'Caption failed', 'error');
      if (box && 'value' in box && box.value === 'Writing caption…') box.value = draft;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Get Caption'; btn.style.cursor = 'pointer'; btn.style.color = 'rgba(255,255,255,0.75)'; }
    }
  }

  window.renderClaudeStudio = renderClaudeStudio;
  window.applyRedesignedSlides = applyRedesignedSlides;
  window.designCoachAsk = designCoachAsk;
  window.openClaudeDesignStudio = function openClaudeDesignStudio() {
    window.__SE_CREATE_SURFACE = 'design';
    window.__SE_CS_MODE = 'post';
    try {
      if (typeof window.activeNav !== 'undefined') window.activeNav = 'design-studio';
    } catch (_) {}
    try {
      const url = window.vsUploadedImageUrl || window._vsUploadedImageUrl;
      if (url && (!window._studioReference || !window._studioReference.url)) {
        window._studioReference = { url, type: 'image', title: 'Studio upload', source: 'upload' };
      }
    } catch (_) {}
    renderClaudeStudio();
  };
})();
