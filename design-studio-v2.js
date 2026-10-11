/* Brand Design (Design Studio v2): learn the brand's carousel system from approved slides, then
   design finished carousels in it. Create → Design (#create/design).
   window.seDesignStudio:
     render(container)                              → draws the screen into container
     openWith({ brief, slides, source_image_url, autostart }) → Coach handoff: prefill and optionally start */
(function (global) {
  'use strict';

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  function apiBase() { return global.API || global._seAPI || ''; }
  function headers(extra) {
    const a = global.seApi;
    return Object.assign({}, a && typeof a.headers === 'function' ? a.headers() : {}, extra || {});
  }
  function toast(msg, kind) { if (typeof global.showToast === 'function') global.showToast(msg, kind); }
  async function call(method, path, body) {
    const res = await fetch(`${apiBase()}${path}`, {
      method,
      headers: headers(body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }
  async function uploadFile(file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${apiBase()}/api/studio/upload-image`, { method: 'POST', headers: headers(), body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
    return data.url;
  }

  const STAGES = {
    queued: 'Waiting for a free designer…',
    draft: 'Studying your example slides…',
    review: 'Comparing layouts with your examples',
    final: 'Saving your design system…',
    research: 'Checking facts on official sources…',
    plan: 'Planning slides and writing copy…',
    art: 'Drawing illustrations in your style…',
    render: 'Laying out slides',
    critic: 'Creative director review',
    fix: 'Fixing weak slides',
    saving: 'Saving slides…',
  };
  function stageText(p) {
    if (!p) return 'Working…';
    const base = STAGES[p.stage] || 'Working…';
    const bits = [];
    if (p.round) bits.push(`round ${p.round}`);
    if (p.stage === 'art' && p.count) bits.push(`${p.count} image${p.count === 1 ? '' : 's'}`);
    if (p.stage === 'fix' && Array.isArray(p.slides)) bits.push(`slide ${p.slides.join(', ')}`);
    return bits.length ? `${base} (${bits.join(', ')})` : base;
  }

  function clientKey() {
    const c = global._studioClientData || global.clientData || {};
    return String(c.id || c.client_id || (c.fields && c.fields.contact_email) || 'me');
  }
  const store = {
    get(name) { try { return JSON.parse(localStorage.getItem(`se_dsv2_${name}_${clientKey()}`) || 'null'); } catch (_) { return null; } },
    set(name, v) { try { if (v == null) localStorage.removeItem(`se_dsv2_${name}_${clientKey()}`); else localStorage.setItem(`se_dsv2_${name}_${clientKey()}`, JSON.stringify(v)); } catch (_) {} },
  };

  const state = {
    root: null,
    info: null,
    examples: [],
    source: '',
    rebuild: false,
    pending: null,
    pollTimer: null,
  };

  function injectStyles() {
    if (document.getElementById('dsv2-styles')) return;
    const st = document.createElement('style');
    st.id = 'dsv2-styles';
    st.textContent = `
      .dsv2 { max-width:1100px; margin:0 auto; padding:8px 4px 40px; color:#E2E8F0; font-family:var(--font-body); }
      .dsv2 h2 { font-family:var(--font-display); font-size:1.35rem; margin:0 0 4px; color:#fff; }
      .dsv2 h3 { font-family:var(--font-display); font-size:0.95rem; margin:0 0 10px; color:#fff; }
      .dsv2-sub { font-size:0.8rem; color:rgba(255,255,255,0.55); margin:0 0 18px; line-height:1.5; }
      .dsv2-card { background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:18px; margin-bottom:16px; }
      .dsv2-row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
      .dsv2-label { font-size:0.7rem; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:rgba(255,255,255,0.5); margin:12px 0 6px; display:block; }
      .dsv2 textarea, .dsv2 input[type=text], .dsv2 select, .dsv2 input[type=number] { width:100%; box-sizing:border-box; background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.12); border-radius:9px; color:#F8FAFC; padding:9px 11px; font-size:0.82rem; font-family:var(--font-body); }
      .dsv2 textarea { min-height:90px; resize:vertical; line-height:1.5; }
      .dsv2-btn { padding:9px 16px; border-radius:9px; border:1px solid rgba(124,58,237,0.45); background:rgba(124,58,237,0.14); color:#E9D5FF; font-size:0.78rem; font-weight:700; cursor:pointer; font-family:var(--font-body); }
      .dsv2-btn:hover { background:rgba(124,58,237,0.24); }
      .dsv2-btn--primary { background:linear-gradient(135deg,#7C3AED,#A78BFA); color:#fff; border:none; box-shadow:0 2px 10px rgba(124,58,237,0.3); }
      .dsv2-btn:disabled { opacity:0.5; cursor:not-allowed; }
      .dsv2-link { background:none; border:none; color:#A78BFA; font-size:0.75rem; cursor:pointer; padding:0; font-family:var(--font-body); }
      .dsv2-thumbs { display:grid; grid-template-columns:repeat(auto-fill,minmax(92px,1fr)); gap:8px; margin-top:10px; }
      .dsv2-thumb { position:relative; border-radius:8px; overflow:hidden; border:1px solid rgba(255,255,255,0.1); background:#0B0F1A; }
      .dsv2-thumb img { width:100%; display:block; aspect-ratio:4/5; object-fit:cover; }
      .dsv2-thumb button { position:absolute; top:4px; right:4px; width:20px; height:20px; border-radius:50%; border:none; background:rgba(0,0,0,0.7); color:#fff; cursor:pointer; font-size:0.8rem; line-height:1; }
      .dsv2-swatch { width:22px; height:22px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); display:inline-block; }
      .dsv2-chip { font-size:0.68rem; padding:3px 8px; border-radius:999px; background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.75); }
      .dsv2-patterns { display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:10px; margin-top:12px; }
      .dsv2-patterns figure { margin:0; }
      .dsv2-patterns img { width:100%; border-radius:8px; display:block; border:1px solid rgba(255,255,255,0.08); }
      .dsv2-patterns figcaption { font-size:0.66rem; color:rgba(255,255,255,0.55); margin-top:4px; }
      .dsv2-progress { display:flex; align-items:center; gap:10px; font-size:0.8rem; color:#E9D5FF; padding:12px 14px; border-radius:10px; background:rgba(124,58,237,0.1); border:1px solid rgba(124,58,237,0.25); margin-top:12px; }
      .dsv2-spin { width:14px; height:14px; border:2px solid rgba(233,213,255,0.3); border-top-color:#E9D5FF; border-radius:50%; animation:dsv2spin 0.7s linear infinite; flex-shrink:0; }
      @keyframes dsv2spin { to { transform:rotate(360deg); } }
      .dsv2-error { color:#FCA5A5; font-size:0.8rem; margin-top:10px; }
      .dsv2-slides { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:12px; margin-top:12px; }
      .dsv2-slide img { width:100%; border-radius:10px; display:block; border:1px solid rgba(255,255,255,0.08); }
      .dsv2-slide-meta { font-size:0.66rem; color:rgba(255,255,255,0.55); margin-top:5px; line-height:1.4; }
      .dsv2-score { font-weight:700; color:#6EE7B7; }
      .dsv2-score--low { color:#FBBF24; }
      .dsv2-sources a { color:#A78BFA; font-size:0.72rem; word-break:break-all; }
    `;
    document.head.appendChild(st);
  }

  function el(id) { return state.root ? state.root.querySelector(`#${id}`) : null; }

  async function render(container) {
    injectStyles();
    state.root = container;
    container.innerHTML = '<div class="dsv2"><div class="dsv2-progress"><span class="dsv2-spin"></span>Loading your brand design…</div></div>';
    try {
      state.info = await call('GET', '/api/design/system');
    } catch (e) {
      container.innerHTML = `<div class="dsv2"><div class="dsv2-error">${esc(e.message)}</div></div>`;
      return;
    }
    if (state.root !== container) return;
    draw();
    const job = store.get('job');
    if (job && job.id) poll(job.id, job.kind);
    if (state.pending) {
      const p = state.pending;
      state.pending = null;
      applyHandoff(p);
    }
  }

  function draw() {
    const info = state.info || {};
    const sys = info.system;
    const root = state.root;
    if (!root) return;
    if (!info.enabled) {
      root.innerHTML = '<div class="dsv2"><h2>Brand Design</h2><p class="dsv2-sub">Brand Design is not switched on for this server yet.</p></div>';
      return;
    }
    const showSetup = !sys || state.rebuild;
    root.innerHTML = `<div class="dsv2">
      <h2>Brand Design</h2>
      <p class="dsv2-sub">Carousels designed in your exact brand style: your layouts, fonts, colours and illustration style, with facts checked and every slide reviewed before you see it.</p>
      ${sys ? systemCard(sys, info) : ''}
      ${showSetup ? setupCard(!!sys) : ''}
      ${sys && !state.rebuild ? makeCard() : ''}
      <div id="dsv2-result"></div>
    </div>`;
    wire();
    const last = store.get('last');
    if (sys && !state.rebuild && last && !store.get('job')) showResult(last);
  }

  function systemCard(sys, info) {
    const colors = Object.entries(sys.colors || {}).filter(([, v]) => /^#/.test(String(v)));
    const fonts = sys.fonts || {};
    const previews = (info.previews || []).filter((p) => p && p.url);
    const names = new Map((sys.patterns || []).map((p) => [p.id, p.name || p.id]));
    return `<div class="dsv2-card" id="dsv2-system">
      <div class="dsv2-row" style="justify-content:space-between;">
        <h3 style="margin:0;">${esc(sys.name || 'Your brand')} design system</h3>
        <button type="button" class="dsv2-link" id="dsv2-rebuild">${state.rebuild ? 'Cancel rebuild' : 'Rebuild from new examples'}</button>
      </div>
      <div class="dsv2-row" style="margin-top:10px;">
        ${colors.map(([k, v]) => `<span class="dsv2-swatch" title="${esc(k)} ${esc(v)}" style="background:${esc(v)}"></span>`).join('')}
        ${['heading', 'body'].map((k) => (fonts[k] && fonts[k].family ? `<span class="dsv2-chip">${esc(k)}: ${esc(fonts[k].family)}</span>` : '')).join('')}
        <span class="dsv2-chip">${esc(sys.ratio || '4:5')}</span>
        <span class="dsv2-chip">${(sys.patterns || []).length} layouts</span>
      </div>
      ${previews.length ? `<div class="dsv2-patterns">${previews.map((p) => `<figure><img src="${esc(p.url)}" alt="" loading="lazy"><figcaption>${esc(names.get(p.pattern) || p.pattern)}</figcaption></figure>`).join('')}</div>` : ''}
    </div>`;
  }

  function setupCard(isRebuild) {
    return `<div class="dsv2-card" id="dsv2-setup">
      <h3>${isRebuild ? 'Rebuild your design system' : 'Step 1: teach it your brand'}</h3>
      <p class="dsv2-sub" style="margin-bottom:6px;">Add 2–10 carousel slides you've already approved. It learns their layouts, fonts, colours and illustration style. This takes about 10 minutes.</p>
      <div class="dsv2-row">
        <label class="dsv2-btn" style="display:inline-block;">Upload slides<input type="file" id="dsv2-files" accept="image/*" multiple hidden></label>
        <button type="button" class="dsv2-btn" id="dsv2-lib">From Library</button>
        <span class="dsv2-chip" id="dsv2-count">${state.examples.length} / 10</span>
      </div>
      <div class="dsv2-thumbs" id="dsv2-thumbs"></div>
      <label class="dsv2-label" for="dsv2-notes">Anything it should know (optional)</label>
      <textarea id="dsv2-notes" placeholder="e.g. UK spelling, always end with our website, never use red"></textarea>
      <div class="dsv2-row" style="margin-top:4px;">
        <div style="flex:1;min-width:140px;"><label class="dsv2-label" for="dsv2-ratio">Slide shape</label>
          <select id="dsv2-ratio"><option value="4:5">4:5 portrait (Instagram feed)</option><option value="9:16">9:16 tall (Stories, TikTok)</option><option value="1:1">1:1 square</option></select></div>
        <div style="flex:1;min-width:160px;"><label class="dsv2-label" for="dsv2-handle">Handle or website on slides</label>
          <input type="text" id="dsv2-handle" placeholder="@yourbrand"></div>
      </div>
      <div class="dsv2-row" style="margin-top:14px;"><button type="button" class="dsv2-btn dsv2-btn--primary" id="dsv2-build">Build my design system</button></div>
      <div id="dsv2-build-status"></div>
    </div>`;
  }

  function makeCard() {
    return `<div class="dsv2-card" id="dsv2-make">
      <h3>Make a carousel</h3>
      <label class="dsv2-label" for="dsv2-brief">What is it about?</label>
      <textarea id="dsv2-brief" placeholder="Topic, who it's for, the key points, and what people should do at the end"></textarea>
      <div class="dsv2-row" style="margin-top:4px;align-items:flex-end;">
        <div style="width:110px;"><label class="dsv2-label" for="dsv2-slides">Slides</label><input type="number" id="dsv2-slides" min="3" max="10" value="7"></div>
        <div style="width:170px;"><label class="dsv2-label" for="dsv2-platform">Platform</label>
          <select id="dsv2-platform"><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="linkedin">LinkedIn</option><option value="tiktok">TikTok</option></select></div>
        <label class="dsv2-row" style="gap:6px;font-size:0.78rem;padding-bottom:9px;"><input type="checkbox" id="dsv2-research" checked> Check facts on official sources</label>
      </div>
      <label class="dsv2-label">Start from a poster or image (optional)</label>
      <div class="dsv2-row" id="dsv2-source-row">
        <label class="dsv2-btn" style="display:inline-block;">Upload<input type="file" id="dsv2-source-file" accept="image/*" hidden></label>
        <button type="button" class="dsv2-btn" id="dsv2-source-lib">From Library</button>
        <span id="dsv2-source-view"></span>
      </div>
      <div class="dsv2-row" style="margin-top:14px;"><button type="button" class="dsv2-btn dsv2-btn--primary" id="dsv2-go">Design carousel</button></div>
      <div id="dsv2-make-status"></div>
    </div>`;
  }

  function drawExamples() {
    const box = el('dsv2-thumbs');
    if (!box) return;
    box.innerHTML = state.examples.map((u, i) => `<div class="dsv2-thumb"><img src="${esc(u)}" alt=""><button type="button" data-rm="${i}" aria-label="Remove">×</button></div>`).join('');
    box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      state.examples.splice(Number(b.dataset.rm), 1);
      drawExamples();
    }));
    const count = el('dsv2-count');
    if (count) count.textContent = `${state.examples.length} / 10`;
  }

  function drawSource() {
    const view = el('dsv2-source-view');
    if (!view) return;
    view.innerHTML = state.source
      ? `<span class="dsv2-row" style="gap:6px;"><img src="${esc(state.source)}" alt="" style="height:44px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);"><button type="button" class="dsv2-link" id="dsv2-source-clear">Remove</button></span>`
      : '';
    const clear = el('dsv2-source-clear');
    if (clear) clear.addEventListener('click', () => { state.source = ''; drawSource(); });
  }

  function pickFromLibrary(title, onUrls) {
    if (typeof global.openLibraryPicker !== 'function') { toast('Library is not available here', 'warning'); return; }
    global.openLibraryPicker({
      title,
      kinds: [],
      onPick: (picked) => onUrls((picked || []).map((a) => a && a.url).filter((u) => /^https:\/\//i.test(String(u || '')))),
    });
  }

  function wire() {
    const rebuild = el('dsv2-rebuild');
    if (rebuild) rebuild.addEventListener('click', () => { state.rebuild = !state.rebuild; draw(); });

    const files = el('dsv2-files');
    if (files) {
      drawExamples();
      files.addEventListener('change', async () => {
        const list = [...files.files].filter((f) => f.type.startsWith('image/')).slice(0, 10 - state.examples.length);
        files.value = '';
        if (!list.length) return;
        toast(`Uploading ${list.length} slide${list.length === 1 ? '' : 's'}…`, 'info');
        for (const f of list) {
          try { state.examples.push(await uploadFile(f)); drawExamples(); } catch (e) { toast(e.message, 'error'); }
        }
      });
      el('dsv2-lib').addEventListener('click', () => pickFromLibrary('Pick approved slides', (urls) => {
        for (const u of urls) if (state.examples.length < 10 && !state.examples.includes(u)) state.examples.push(u);
        drawExamples();
      }));
      el('dsv2-build').addEventListener('click', startBuild);
      const sys = state.info && state.info.system;
      if (sys) {
        el('dsv2-ratio').value = sys.ratio || '4:5';
        el('dsv2-handle').value = sys.handle || '';
      }
    }

    const go = el('dsv2-go');
    if (go) {
      drawSource();
      go.addEventListener('click', () => startCarousel());
      el('dsv2-source-file').addEventListener('change', async (ev) => {
        const f = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        if (!f) return;
        try { state.source = await uploadFile(f); drawSource(); } catch (e) { toast(e.message, 'error'); }
      });
      el('dsv2-source-lib').addEventListener('click', () => pickFromLibrary('Pick a poster or image', (urls) => {
        if (urls[0]) { state.source = urls[0]; drawSource(); }
      }));
    }
  }

  function setStatus(id, html) {
    const box = el(id);
    if (box) box.innerHTML = html;
  }

  async function startBuild() {
    if (state.examples.length < 2) { toast('Add at least 2 approved slides', 'warning'); return; }
    const btn = el('dsv2-build');
    if (btn) btn.disabled = true;
    try {
      const r = await call('POST', '/api/design/system/build', {
        example_urls: state.examples,
        notes: el('dsv2-notes').value.trim(),
        ratio: el('dsv2-ratio').value,
        handle: el('dsv2-handle').value.trim(),
      });
      store.set('job', { id: r.job_id, kind: 'build' });
      poll(r.job_id, 'build');
    } catch (e) {
      if (btn) btn.disabled = false;
      setStatus('dsv2-build-status', `<div class="dsv2-error">${esc(e.message)}</div>`);
    }
  }

  async function startCarousel() {
    const briefEl = el('dsv2-brief');
    const brief = briefEl ? briefEl.value.trim() : '';
    if (brief.length < 10) { toast('Describe the carousel in a sentence or two', 'warning'); return; }
    const btn = el('dsv2-go');
    if (btn) btn.disabled = true;
    try {
      const r = await call('POST', '/api/design/carousel', {
        brief,
        count: Math.max(3, Math.min(10, Number(el('dsv2-slides').value) || 7)),
        platform: el('dsv2-platform').value,
        research: !!el('dsv2-research').checked,
        source_image_url: state.source || undefined,
      });
      store.set('job', { id: r.job_id, kind: 'carousel', brief });
      setStatus('dsv2-result', '');
      poll(r.job_id, 'carousel');
    } catch (e) {
      if (btn) btn.disabled = false;
      setStatus('dsv2-make-status', `<div class="dsv2-error">${esc(e.message)}</div>`);
    }
  }

  function poll(id, kind) {
    clearTimeout(state.pollTimer);
    const statusId = kind === 'build' ? 'dsv2-build-status' : 'dsv2-make-status';
    const root = state.root;
    const tick = async () => {
      if (state.root !== root || !root.isConnected) return;
      let job;
      try {
        job = (await call('GET', `/api/design/jobs/${encodeURIComponent(id)}`)).job;
      } catch (e) {
        if (/not found/i.test(e.message)) { store.set('job', null); setStatus(statusId, ''); return; }
        state.pollTimer = setTimeout(tick, 5000);
        return;
      }
      if (job.status === 'done') {
        store.set('job', null);
        if (kind === 'build') {
          toast('Your design system is ready', 'success');
          state.rebuild = false;
          state.examples = [];
          state.info = await call('GET', '/api/design/system').catch(() => state.info);
          store.set('last', null);
          draw();
        } else {
          setStatus(statusId, '');
          const btn = el('dsv2-go');
          if (btn) btn.disabled = false;
          store.set('last', job.result);
          showResult(job.result);
          toast('Carousel ready', 'success');
        }
        return;
      }
      if (job.status === 'failed') {
        store.set('job', null);
        setStatus(statusId, `<div class="dsv2-error">${esc(job.error || 'Design failed. Try again.')}</div>`);
        const btn = el(kind === 'build' ? 'dsv2-build' : 'dsv2-go');
        if (btn) btn.disabled = false;
        return;
      }
      setStatus(statusId, `<div class="dsv2-progress"><span class="dsv2-spin"></span><span>${esc(stageText(job.progress))}</span></div>`);
      const btn = el(kind === 'build' ? 'dsv2-build' : 'dsv2-go');
      if (btn) btn.disabled = true;
      state.pollTimer = setTimeout(tick, 3000);
    };
    tick();
  }

  function captionWithTags(result) {
    const tags = (result.hashtags || []).join(' ');
    return [String(result.caption || '').trim(), tags].filter(Boolean).join('\n\n');
  }

  function showResult(result) {
    const box = el('dsv2-result');
    if (!box || !result || !Array.isArray(result.slides)) return;
    const slides = result.slides.filter((s) => s && s.url);
    box.innerHTML = `<div class="dsv2-card" id="dsv2-done">
      <div class="dsv2-row" style="justify-content:space-between;">
        <h3 style="margin:0;">${esc(result.title || 'Your carousel')}</h3>
        <div class="dsv2-row">
          <button type="button" class="dsv2-btn" id="dsv2-zip">Download</button>
          <button type="button" class="dsv2-btn dsv2-btn--primary" id="dsv2-queue">Add to queue</button>
        </div>
      </div>
      ${result.angle ? `<p class="dsv2-sub" style="margin:6px 0 0;">${esc(result.angle)}</p>` : ''}
      <div class="dsv2-slides">${slides.map((s, i) => {
        const c = s.critic || {};
        const score = Number(c.score) || 0;
        const notes = (c.problems || []).slice(0, 2).join('; ');
        return `<div class="dsv2-slide"><a href="${esc(s.url)}" target="_blank" rel="noopener"><img src="${esc(s.url)}" alt="Slide ${i + 1}" loading="lazy"></a>
          <div class="dsv2-slide-meta">Slide ${i + 1}${score ? ` · review <span class="dsv2-score${score < 4 ? ' dsv2-score--low' : ''}">${score}/5</span>` : ''}${notes ? `<br>${esc(notes)}` : ''}</div></div>`;
      }).join('')}</div>
      <label class="dsv2-label" for="dsv2-caption">Caption</label>
      <textarea id="dsv2-caption">${esc(captionWithTags(result))}</textarea>
      ${(result.sources || []).length ? `<div class="dsv2-sources"><label class="dsv2-label">Facts checked against</label>${result.sources.map((u) => `<div><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a></div>`).join('')}</div>` : ''}
    </div>`;
    const urls = slides.map((s) => s.url);
    el('dsv2-zip').addEventListener('click', () => downloadZip(urls));
    el('dsv2-queue').addEventListener('click', () => queue(urls, result));
  }

  async function downloadZip(urls) {
    try {
      const res = await fetch(`${apiBase()}/api/studio/carousel-zip`, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ image_urls: urls }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'carousel-slides.zip';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast(e.message || 'Download failed', 'error');
    }
  }

  async function queue(urls, result) {
    const btn = el('dsv2-queue');
    if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
    try {
      const ready = global.studioQueueReady || {};
      const caption = (el('dsv2-caption') && el('dsv2-caption').value.trim()) || captionWithTags(result);
      const job = store.get('job');
      const r = await call('POST', '/api/studio/design-queue', {
        image_urls: urls,
        brief: (job && job.brief) || result.title || '',
        caption,
        platform: (el('dsv2-platform') && el('dsv2-platform').value) || 'instagram',
        status: typeof ready.queueReviewStatus === 'function' ? ready.queueReviewStatus() : 'Pending',
      });
      if (!(r.ok || r.success)) throw new Error(r.error || 'Queue failed');
      toast('Added to content queue', 'success');
      if (btn) btn.textContent = 'Added ✓';
      if (typeof ready.openContentReviewAfterQueue === 'function') ready.openContentReviewAfterQueue();
    } catch (e) {
      toast(e.message || 'Queue failed', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Add to queue'; }
    }
  }

  function applyHandoff(p) {
    const brief = el('dsv2-brief');
    if (!brief) {
      if (!(state.info && state.info.system)) toast('Set up your brand design first, then Coach can design carousels in it', 'info');
      return;
    }
    brief.value = String(p.brief || '');
    if (p.slides) el('dsv2-slides').value = Math.max(3, Math.min(10, Number(p.slides) || 7));
    if (/^https:\/\//i.test(String(p.source_image_url || ''))) { state.source = p.source_image_url; drawSource(); }
    brief.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (p.autostart && !store.get('job')) startCarousel();
  }

  function openWith(p) {
    state.pending = Object.assign({}, p || {});
    if (typeof global.switchNav === 'function') global.switchNav('brand-design');
  }

  global.seDesignStudio = { render, openWith, stageText };
})(typeof window !== 'undefined' ? window : globalThis);
