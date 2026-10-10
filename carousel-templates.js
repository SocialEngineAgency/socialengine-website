/* Brand carousel templates (server-stored, v2).
   window.seCarouselTemplates:
     list(force)                    → { templates, fonts } (cached)
     defaultTemplate()              → cached default template or null
     mountSection(el, { uploadImage }) → template list + "New from example slides"
     build({ master, plan, count, templateId, onProgress }) → { templateId, specs, slides }
     mountEditor(el, state, onSlide) → per-slide text + art crop editor; onSlide(index, url) after re-render */
(function (global) {
  'use strict';

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  let cache = null;
  const listeners = new Set();
  function notify() { listeners.forEach((fn) => { try { fn(cache); } catch (_) {} }); }

  async function list(force) {
    if (cache && !force) return cache;
    const data = await call('GET', '/api/carousel-templates');
    cache = { templates: data.templates || [], fonts: data.fonts || [] };
    notify();
    return cache;
  }
  function defaultTemplate() {
    const t = (cache && cache.templates) || [];
    return t.find((x) => x.is_default) || t[t.length - 1] || null;
  }
  function setTemplates(templates) {
    cache = { templates: templates || [], fonts: (cache && cache.fonts) || [] };
    notify();
  }

  function injectStyles() {
    if (document.getElementById('sct-styles')) return;
    const st = document.createElement('style');
    st.id = 'sct-styles';
    st.textContent = `
      .sct-row { display:flex; align-items:center; gap:6px; padding:7px 8px; margin-bottom:6px; border-radius:8px; border:1px solid rgba(124,58,237,0.28); background:rgba(124,58,237,0.08); font-size:0.72rem; color:#E9D5FF; }
      .sct-row b { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .sct-chip { font-size:0.6rem; padding:2px 6px; border-radius:999px; background:rgba(16,185,129,0.15); color:#6EE7B7; }
      .sct-link { background:none; border:none; color:rgba(255,255,255,0.5); font-size:0.66rem; cursor:pointer; padding:2px 4px; font-family:var(--font-body); }
      .sct-link:hover { color:#fff; }
      .sct-btn { width:100%; margin-top:6px; padding:9px; border-radius:9px; border:1px solid rgba(124,58,237,0.4); background:rgba(124,58,237,0.14); color:#E9D5FF; font-size:0.74rem; font-weight:700; cursor:pointer; font-family:var(--font-body); }
      .sct-btn[disabled] { opacity:0.45; cursor:not-allowed; }
      .sct-modal { position:fixed; inset:0; z-index:9999; background:rgba(3,6,12,0.78); display:flex; align-items:center; justify-content:center; padding:20px; }
      .sct-card { width:min(1080px,100%); max-height:92vh; overflow:auto; background:#0B1220; border:1px solid rgba(255,255,255,0.1); border-radius:14px; padding:18px 20px; color:#E2E8F0; font-family:var(--font-body); }
      .sct-card h3 { margin:0 0 4px; font-size:1rem; }
      .sct-sub { font-size:0.74rem; color:rgba(148,163,184,0.85); margin-bottom:14px; }
      .sct-grid { display:grid; grid-template-columns: 260px 1fr; gap:20px; }
      @media (max-width: 820px) { .sct-grid { grid-template-columns: 1fr; } }
      .sct-field { display:block; font-size:0.68rem; color:rgba(148,163,184,0.9); margin:0 0 10px; }
      .sct-field input[type=text], .sct-field select, .sct-field textarea { width:100%; box-sizing:border-box; margin-top:4px; padding:8px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.05); color:#fff; font-size:0.8rem; font-family:var(--font-body); }
      .sct-colors { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; }
      .sct-colors input { width:100%; height:32px; padding:0; border:1px solid rgba(255,255,255,0.15); border-radius:6px; background:none; }
      .sct-previews { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
      .sct-previews figure { margin:0; text-align:center; font-size:0.66rem; color:rgba(148,163,184,0.8); }
      .sct-previews img { width:100%; border-radius:8px; border:1px solid rgba(255,255,255,0.1); background:#111; display:block; margin-bottom:4px; }
      .sct-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:14px; flex-wrap:wrap; }
      .sct-actions button { padding:9px 14px; border-radius:9px; font-size:0.76rem; font-weight:700; cursor:pointer; font-family:var(--font-body); border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.05); color:#fff; }
      .sct-actions .sct-primary { background:#7C3AED; border-color:#7C3AED; }
      .sct-editor { margin-top:12px; padding:12px; border-radius:10px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.02); display:grid; grid-template-columns: minmax(0,1fr) 220px; gap:14px; }
      @media (max-width: 760px) { .sct-editor { grid-template-columns:1fr; } }
      .sct-crop { position:relative; user-select:none; touch-action:none; cursor:crosshair; border-radius:8px; overflow:hidden; border:1px solid rgba(255,255,255,0.1); }
      .sct-crop img { width:100%; display:block; pointer-events:none; }
      .sct-crop__box { position:absolute; border:2px solid #A78BFA; background:rgba(167,139,250,0.15); box-shadow:0 0 0 9999px rgba(0,0,0,0.35); pointer-events:none; }
      .sct-warn { font-size:0.68rem; color:#FCD34D; margin-top:6px; }
    `;
    document.head.appendChild(st);
  }

  // ── Template list in the "Saved & templates" drawer ──
  function mountSection(el, { uploadImage } = {}) {
    if (!el) return;
    injectStyles();
    const draw = () => {
      const t = (cache && cache.templates) || [];
      el.innerHTML = `
        <div style="font-size:0.66rem;color:rgba(255,255,255,0.4);margin-bottom:6px;">Brand carousel templates</div>
        ${t.length ? t.map((x) => `
          <div class="sct-row" data-id="${esc(x.id)}">
            <b title="${esc(x.name)}">${esc(x.name)}</b>
            ${x.is_default ? '<span class="sct-chip">Default</span>' : `<button type="button" class="sct-link" data-act="default">Make default</button>`}
            <button type="button" class="sct-link" data-act="edit">Edit</button>
            <button type="button" class="sct-link" data-act="delete" title="Delete">✕</button>
          </div>`).join('') : '<div style="font-size:0.7rem;color:rgba(255,255,255,0.35);margin-bottom:6px;">None yet. Build one from 2–10 slides of a carousel you like.</div>'}
        <input type="file" id="sct-files" accept="image/png,image/jpeg,image/webp" multiple style="display:none;">
        <button type="button" class="sct-btn" id="sct-new">New template from example slides</button>`;
      el.querySelector('#sct-new').addEventListener('click', () => el.querySelector('#sct-files').click());
      el.querySelector('#sct-files').addEventListener('change', async (ev) => {
        const files = Array.from(ev.target.files || []);
        ev.target.value = '';
        await createFromFiles(files, uploadImage, el.querySelector('#sct-new'));
      });
      el.querySelectorAll('.sct-row').forEach((row) => {
        const id = row.getAttribute('data-id');
        row.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
          const act = b.getAttribute('data-act');
          const tpl = ((cache && cache.templates) || []).find((x) => x.id === id);
          try {
            if (act === 'delete') {
              if (!global.confirm(`Delete "${tpl ? tpl.name : 'template'}"?`)) return;
              setTemplates((await call('DELETE', `/api/carousel-templates/${encodeURIComponent(id)}`)).templates);
            } else if (act === 'default') {
              setTemplates((await call('POST', '/api/carousel-templates', { template: tpl, make_default: true })).templates);
            } else if (act === 'edit' && tpl) {
              const pv = await call('POST', '/api/carousel-templates/preview', { template: tpl });
              openReview({ template: pv.template, previews: pv.previews, fonts: cache.fonts, isDefault: tpl.is_default });
            }
          } catch (e) { toast(e.message, 'error'); }
        }));
      });
    };
    listeners.add(draw);
    draw();
    list().catch(() => {});
  }

  async function createFromFiles(files, uploadImage, btn) {
    const imgs = files.filter((f) => /^image\/(png|jpe?g|webp)$/i.test(f.type || '') || /\.(png|jpe?g|webp)$/i.test(f.name || ''))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
    if (imgs.length < 2 || imgs.length > 10) { toast('Pick 2–10 slides from one carousel, in order', 'warning'); return; }
    if (typeof uploadImage !== 'function') { toast('Upload is not available here', 'error'); return; }
    const label = btn ? btn.textContent : '';
    try {
      if (btn) btn.disabled = true;
      const urls = [];
      for (let i = 0; i < imgs.length; i++) {
        if (btn) btn.textContent = `Uploading ${i + 1}/${imgs.length}…`;
        urls.push(await uploadImage(imgs[i]));
      }
      if (btn) btn.textContent = 'Reading the layout… (about 30s)';
      const data = await call('POST', '/api/carousel-templates/extract', { slide_urls: urls });
      if (cache && data.fonts) cache.fonts = data.fonts;
      openReview({ template: data.template, previews: data.previews, fonts: data.fonts || (cache && cache.fonts) || [], isDefault: true });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  // ── Review: name, fonts, colours, sample renders ──
  function openReview({ template, previews, fonts, isDefault }) {
    injectStyles();
    let tpl = JSON.parse(JSON.stringify(template));
    const modal = document.createElement('div');
    modal.className = 'sct-modal';
    modal.id = 'sct-review';
    const fontOpts = (sel) => (fonts || []).map((f) => `<option value="${esc(f.id)}" ${f.id === sel ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
    const pal = tpl.palette || {};
    modal.innerHTML = `
      <div class="sct-card" role="dialog" aria-label="Review carousel template">
        <h3>Review your carousel template</h3>
        <div class="sct-sub">These are sample slides drawn with the layout read from your examples. Fix the name, fonts and colours, then save. Positions can be refined later.</div>
        <div class="sct-grid">
          <div>
            <label class="sct-field">Name<input type="text" id="sct-name" value="${esc(tpl.name)}"></label>
            <label class="sct-field">Heading font<select id="sct-font-heading">${fontOpts(tpl.fonts.heading)}</select></label>
            <label class="sct-field">Body font<select id="sct-font-body">${fontOpts(tpl.fonts.body)}</select></label>
            <div class="sct-field">Colours (background · text · accent · muted)
              <div class="sct-colors" style="margin-top:4px;">
                ${['bg', 'fg', 'accent', 'muted'].map((k) => `<input type="color" data-pal="${k}" value="${esc(String(pal[k] || '#000000').slice(0, 7))}" title="${k}">`).join('')}
              </div>
            </div>
            <div class="sct-field">Format: ${esc(tpl.aspect)}</div>
          </div>
          <div class="sct-previews" id="sct-previews"></div>
        </div>
        <div class="sct-actions">
          <button type="button" id="sct-cancel">Cancel</button>
          <button type="button" id="sct-refresh">Update preview</button>
          <button type="button" class="sct-primary" id="sct-save">${isDefault ? 'Save as default' : 'Save'}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const drawPreviews = (p) => {
      modal.querySelector('#sct-previews').innerHTML = ['cover', 'content', 'cta'].map((k) => `
        <figure><img alt="${k} preview" src="${esc(p && p[k] ? p[k] : '')}">${k === 'cta' ? 'Last slide' : k === 'cover' ? 'Cover' : 'Content'}</figure>`).join('');
    };
    drawPreviews(previews);
    const readForm = () => {
      tpl = {
        ...tpl,
        name: modal.querySelector('#sct-name').value.trim() || tpl.name,
        fonts: { heading: modal.querySelector('#sct-font-heading').value, body: modal.querySelector('#sct-font-body').value },
        palette: { ...tpl.palette },
      };
      modal.querySelectorAll('[data-pal]').forEach((i) => { tpl.palette[i.getAttribute('data-pal')] = i.value.toUpperCase(); });
      return tpl;
    };
    const close = () => modal.remove();
    modal.querySelector('#sct-cancel').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('#sct-refresh').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try { drawPreviews((await call('POST', '/api/carousel-templates/preview', { template: readForm() })).previews); } catch (err) { toast(err.message, 'error'); }
      b.disabled = false;
    });
    modal.querySelector('#sct-save').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const data = await call('POST', '/api/carousel-templates', { template: readForm(), make_default: !!isDefault });
        setTemplates(data.templates);
        toast(`Template "${data.template.name}" saved`, 'success');
        close();
      } catch (err) { toast(err.message, 'error'); b.disabled = false; }
    });
  }

  // ── Build: master → copy + crops → rendered slides ──
  async function build({ master, plan, count, templateId, onProgress } = {}) {
    const tpl = templateId ? { template_id: templateId } : {};
    if (onProgress) onProgress('Writing the slides from your poster…');
    const filled = await call('POST', '/api/carousel-templates/fill', {
      ...tpl,
      master_image_url: master,
      plan: Array.isArray(plan) ? plan.map((s) => ({ title: s.title || '', keep: s.keep || '' })) : undefined,
      count: count || undefined,
    });
    const id = filled.template_id || templateId || null;
    if (onProgress) onProgress(`Drawing ${filled.slides.length} slides in your template…`);
    const rendered = await call('POST', '/api/carousel-templates/render', {
      ...(id ? { template_id: id } : {}),
      master_image_url: master,
      slides: filled.slides,
    });
    return { templateId: id, specs: filled.slides, slides: rendered.slides };
  }

  async function rerender(state, index) {
    const data = await call('POST', '/api/carousel-templates/render', {
      ...(state.templateId ? { template_id: state.templateId } : {}),
      master_image_url: state.master,
      slides: state.specs,
      only_index: index + 1,
    });
    return data.slides[0];
  }

  // ── Per-slide editor: text + drag a box on the poster for the art ──
  function mountEditor(el, state, onSlide) {
    if (!el || !state || !Array.isArray(state.specs)) return;
    injectStyles();
    const i = Math.max(0, Math.min(state.specs.length - 1, Number(state.selected) || 0));
    const spec = state.specs[i];
    const box = spec.art_box;
    el.innerHTML = `
      <div class="sct-editor" data-slide="${i + 1}">
        <div>
          <div style="font-size:0.7rem;font-weight:700;color:#fff;margin-bottom:8px;">Slide ${i + 1} of ${state.specs.length} · ${esc(spec.layout)}</div>
          <label class="sct-field">Label<input type="text" id="sct-e-kicker" value="${esc(spec.kicker)}"></label>
          <label class="sct-field">Headline<textarea id="sct-e-title" rows="2">${esc(spec.title)}</textarea></label>
          <label class="sct-field">Text<textarea id="sct-e-body" rows="3">${esc(spec.body)}</textarea></label>
          ${state.overflow && state.overflow[i] && state.overflow[i].length ? `<div class="sct-warn">Text was cut to fit (${esc(state.overflow[i].join(', '))}). Shorten it.</div>` : ''}
          <div class="sct-actions" style="justify-content:flex-start;">
            <button type="button" class="sct-primary" id="sct-e-apply">Update slide</button>
            <button type="button" id="sct-e-noart">${box ? 'No picture' : 'Picture: none'}</button>
          </div>
        </div>
        <div>
          <div style="font-size:0.66rem;color:rgba(148,163,184,0.85);margin-bottom:6px;">Drag on the poster to pick this slide's picture</div>
          <div class="sct-crop" id="sct-crop"><img alt="Poster" src="${esc(state.masterDisplay || state.master)}" referrerpolicy="no-referrer">${box ? `<div class="sct-crop__box" style="left:${box.x * 100}%;top:${box.y * 100}%;width:${box.w * 100}%;height:${box.h * 100}%;"></div>` : ''}</div>
        </div>
      </div>`;
    const crop = el.querySelector('#sct-crop');
    let start = null;
    const frac = (ev) => {
      const r = crop.getBoundingClientRect();
      return { x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)) };
    };
    const drawBox = (b) => {
      let d = crop.querySelector('.sct-crop__box');
      if (!d) { d = document.createElement('div'); d.className = 'sct-crop__box'; crop.appendChild(d); }
      Object.assign(d.style, { left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` });
    };
    crop.addEventListener('pointerdown', (ev) => { start = frac(ev); crop.setPointerCapture(ev.pointerId); });
    crop.addEventListener('pointermove', (ev) => {
      if (!start) return;
      const p = frac(ev);
      drawBox({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) });
    });
    crop.addEventListener('pointerup', (ev) => {
      if (!start) return;
      const p = frac(ev);
      const b = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
      start = null;
      if (b.w >= 0.03 && b.h >= 0.03) spec.art_box = b;
    });
    el.querySelector('#sct-e-noart').addEventListener('click', () => {
      spec.art_box = null;
      const d = crop.querySelector('.sct-crop__box');
      if (d) d.remove();
    });
    el.querySelector('#sct-e-apply').addEventListener('click', async (ev) => {
      const b = ev.currentTarget;
      spec.kicker = el.querySelector('#sct-e-kicker').value.trim();
      spec.title = el.querySelector('#sct-e-title').value.trim();
      spec.body = el.querySelector('#sct-e-body').value.trim();
      b.disabled = true;
      b.textContent = 'Updating…';
      try {
        const out = await rerender(state, i);
        state.overflow = state.overflow || [];
        state.overflow[i] = out.overflow || [];
        if (typeof onSlide === 'function') onSlide(i, out.url);
      } catch (e) {
        toast(e.message, 'error');
        b.disabled = false;
        b.textContent = 'Update slide';
      }
    });
  }

  global.seCarouselTemplates = { list, defaultTemplate, mountSection, build, mountEditor, openReview, onChange: (fn) => listeners.add(fn) };
})(typeof window !== 'undefined' ? window : globalThis);
