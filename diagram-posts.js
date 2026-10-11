/* Diagram posts: steps, timeline, compare, cycle, funnel. Rendered on the API as a 4:5 PNG.
   window.seOpenDiagram({ text })  — opens the editor, optionally drafting from text.
   A "◇ Diagram" button attaches under caption boxes and the Create brief. */
(function (global) {
  'use strict';

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const toast = (msg, kind) => { if (typeof global.showToast === 'function') global.showToast(msg, kind); };
  const TYPE_LABELS = { steps: 'Steps (a process)', timeline: 'Timeline (milestones)', compare: 'Compare (myth vs fact, before vs after)', cycle: 'Cycle (a loop)', funnel: 'Funnel (narrowing stages)' };

  function api(path, opts = {}) {
    const se = global.seApi || {};
    const base = global.API || global._seAPI || '';
    const headers = Object.assign({}, typeof se.headers === 'function' ? se.headers() : {}, opts.body ? { 'Content-Type': 'application/json' } : {});
    return fetch(`${base}${path}`, Object.assign({}, opts, { headers }))
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        return data;
      });
  }

  function injectStyles() {
    if (document.getElementById('dg-styles')) return;
    const st = document.createElement('style');
    st.id = 'dg-styles';
    st.textContent = `
      .dg-overlay { position: fixed; inset: 0; z-index: 10001; background: rgba(0,0,0,0.72); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 16px; }
      .dg-modal { background: linear-gradient(135deg,#0f1a2e,#162237); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; width: min(980px,100%); max-height: 94vh; overflow: auto; padding: 22px; color: #E2E8F0; font-family: var(--font-body, Inter, sans-serif); }
      .dg-head { display: flex; justify-content: space-between; align-items: center; }
      .dg-head h3 { margin: 0; font-size: 1.1rem; color: #fff; }
      .dg-x { background: none; border: none; color: rgba(148,163,184,0.7); font-size: 1.3rem; cursor: pointer; width: auto; }
      .dg-lead { font-size: 0.78rem; color: rgba(148,163,184,0.85); margin: 4px 0 14px; line-height: 1.5; }
      .dg-grid { display: grid; grid-template-columns: minmax(0,1fr) 380px; gap: 20px; }
      @media (max-width: 820px) { .dg-grid { grid-template-columns: 1fr; } }
      .dg-label { display: block; font-size: 0.68rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: rgba(167,139,250,0.85); margin: 12px 0 4px; }
      .dg-input, .dg-select, .dg-text { width: 100%; box-sizing: border-box; padding: 8px 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; font-size: 0.82rem; font-family: inherit; }
      .dg-select option { background: #0f1a2e; }
      .dg-text { min-height: 90px; resize: vertical; line-height: 1.45; }
      .dg-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
      .dg-item { display: grid; grid-template-columns: 70px 1fr 1fr 28px; gap: 6px; margin-bottom: 6px; align-items: center; }
      .dg-item.no-when { grid-template-columns: 1fr 1fr 28px; }
      .dg-item.compare { grid-template-columns: 1fr 1fr 28px; }
      .dg-del { background: none; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: rgba(248,113,113,0.8); cursor: pointer; width: 28px; height: 32px; padding: 0; }
      .dg-btn { padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: transparent; color: #E2E8F0; font-size: 0.78rem; font-weight: 600; cursor: pointer; font-family: inherit; width: auto; text-decoration: none; display: inline-block; }
      .dg-btn--primary { background: linear-gradient(135deg,#7C3AED,#6D28D9); border: none; color: #fff; }
      .dg-btn:disabled { opacity: 0.5; cursor: default; }
      .dg-hint { font-size: 0.72rem; color: rgba(148,163,184,0.75); line-height: 1.45; }
      .dg-err { font-size: 0.74rem; color: #FCD34D; margin-top: 6px; }
      .dg-stage { background: #05080F; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; aspect-ratio: 4 / 5; display: flex; align-items: center; justify-content: center; overflow: hidden; }
      .dg-stage img { width: 100%; height: 100%; object-fit: contain; }
      .dg-attach { display: inline-flex; align-items: center; gap: 4px; margin: 6px 0 0 6px; padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(56,189,248,0.35); background: rgba(56,189,248,0.08); color: #7DD3FC; font-size: 0.7rem; font-weight: 600; cursor: pointer; font-family: inherit; width: auto; }
    `;
    document.head.appendChild(st);
  }

  function blankSpec(type) {
    if (type === 'compare') return { type, eyebrow: '', title: '', left_title: 'Myth', right_title: 'Fact', rows: [{ left: '', right: '' }, { left: '', right: '' }], focus: 0 };
    return { type, eyebrow: '', title: '', center: '', items: [{ label: '' }, { label: '' }, { label: '' }], focus: 2 };
  }

  function openDiagram(opts = {}) {
    injectStyles();
    let options = null;
    let spec = null;
    let previewSeq = 0;
    let previewTimer = null;
    const ov = document.createElement('div');
    ov.className = 'dg-overlay';
    ov.innerHTML = `<div class="dg-modal" role="dialog" aria-label="Diagram post">
      <div class="dg-head"><h3>Diagram post</h3><button type="button" class="dg-x" aria-label="Close">×</button></div>
      <p class="dg-lead">Explain a process, a story, a comparison or a loop as one clean graphic. Paste your text and we draft it, then edit any line. Only your words are used.</p>
      <div class="dg-grid"><div>
        <label class="dg-label" for="dg-source">What should it explain?</label>
        <textarea class="dg-text" id="dg-source" maxlength="3000" placeholder="Our process: free home visit, design and fixed quote within a week, built in our workshop, fitted in five days.">${esc(opts.text || '')}</textarea>
        <div class="dg-row"><select class="dg-select" id="dg-type" style="width:auto"><option value="">Pick the best type for me</option></select>
          <button type="button" class="dg-btn dg-btn--primary" id="dg-draft">Draft it</button>
          <button type="button" class="dg-btn" id="dg-blank">Start blank</button></div>
        <div id="dg-editor"></div>
      </div>
      <div><div class="dg-stage" id="dg-stage"><div class="dg-hint" style="padding:20px;text-align:center">Your diagram appears here.</div></div>
        <div class="dg-row" id="dg-out"></div></div></div>
    </div>`;
    const close = () => ov.remove();
    ov.querySelector('.dg-x').addEventListener('click', close);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    const $ = (s) => ov.querySelector(s);
    $('#dg-editor').addEventListener('input', onInput);
    $('#dg-editor').addEventListener('change', onInput);

    api('/api/diagrams/options').then((o) => {
      options = o;
      $('#dg-type').innerHTML += o.types.map((t) => `<option value="${esc(t.id)}">${esc(TYPE_LABELS[t.id] || t.id)}</option>`).join('');
    }).catch((e) => { $('#dg-editor').innerHTML = `<div class="dg-err">${esc(e.message)}</div>`; });

    $('#dg-draft').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const text = $('#dg-source').value.trim();
      if (!text) { toast('Write what the diagram should explain first', 'warning'); return; }
      btn.disabled = true; btn.textContent = 'Drafting…';
      try {
        const r = await api('/api/diagrams/draft', { method: 'POST', body: JSON.stringify({ text, type: $('#dg-type').value }) });
        spec = r.spec;
        renderEditor();
        schedulePreview(0);
      } catch (err) {
        $('#dg-editor').innerHTML = `<div class="dg-err">${esc(err.message)}</div>`;
      } finally {
        btn.disabled = false; btn.textContent = 'Draft it';
      }
    });
    $('#dg-blank').addEventListener('click', () => {
      spec = blankSpec($('#dg-type').value || 'steps');
      renderEditor();
    });

    function count() { return spec.type === 'compare' ? spec.rows.length : spec.items.length; }
    function limits() {
      const t = (options && options.types || []).find((x) => x.id === spec.type);
      return t ? [t.min, t.max] : [2, 6];
    }

    function renderEditor() {
      const box = $('#dg-editor');
      const d = (options && options.defaults) || {};
      if (spec._accent == null && d.accent) spec._accent = String(d.accent).toLowerCase();
      if (spec.handle == null && d.handle != null) spec.handle = d.handle;
      const isCompare = spec.type === 'compare';
      const hasWhen = spec.type === 'timeline';
      const [, max] = limits();
      const list = isCompare ? spec.rows : spec.items;
      box.innerHTML = `
        <label class="dg-label" for="dg-kind">Type</label>
        <select class="dg-select" id="dg-kind">${Object.keys(TYPE_LABELS).map((t) => `<option value="${t}" ${t === spec.type ? 'selected' : ''}>${esc(TYPE_LABELS[t])}</option>`).join('')}</select>
        <label class="dg-label" for="dg-title">Title (the takeaway)</label>
        <input class="dg-input" id="dg-title" maxlength="110" value="${esc(spec.title)}">
        <label class="dg-label" for="dg-eyebrow">Small label above the title</label>
        <input class="dg-input" id="dg-eyebrow" maxlength="32" value="${esc(spec.eyebrow)}" placeholder="How it works">
        ${isCompare ? `<div class="dg-item compare" style="margin-top:12px"><input class="dg-input" id="dg-lt" maxlength="28" value="${esc(spec.left_title)}"><input class="dg-input" id="dg-rt" maxlength="28" value="${esc(spec.right_title)}"><span></span></div>` : ''}
        ${spec.type === 'cycle' ? `<label class="dg-label" for="dg-center">Middle of the loop (optional)</label><input class="dg-input" id="dg-center" maxlength="40" value="${esc(spec.center || '')}">` : ''}
        <span class="dg-label">${isCompare ? 'Rows' : 'Items'} (${list.length} of up to ${max})</span>
        <div id="dg-items">${list.map((it, i) => isCompare
          ? `<div class="dg-item compare"><input class="dg-input" data-f="left" data-i="${i}" maxlength="90" value="${esc(it.left)}" placeholder="Instead of"><input class="dg-input" data-f="right" data-i="${i}" maxlength="90" value="${esc(it.right)}" placeholder="Try"><button type="button" class="dg-del" data-del="${i}" aria-label="Remove">×</button></div>`
          : `<div class="dg-item ${hasWhen ? '' : 'no-when'}">${hasWhen ? `<input class="dg-input" data-f="when" data-i="${i}" maxlength="20" value="${esc(it.when || '')}" placeholder="2024">` : ''}<input class="dg-input" data-f="label" data-i="${i}" maxlength="60" value="${esc(it.label)}" placeholder="Label"><input class="dg-input" data-f="note" data-i="${i}" maxlength="110" value="${esc(it.note || '')}" placeholder="Short note (optional)"><button type="button" class="dg-del" data-del="${i}" aria-label="Remove">×</button></div>`).join('')}</div>
        <div class="dg-row" style="margin-top:4px">${list.length < max ? '<button type="button" class="dg-btn" id="dg-add">+ Add</button>' : ''}
          <label class="dg-hint">Highlight <select class="dg-select" id="dg-focus" style="width:auto">${list.map((it, i) => `<option value="${i}" ${i === spec.focus ? 'selected' : ''}>${i + 1}. ${esc((isCompare ? it.right : it.label) || '…').slice(0, 24)}</option>`).join('')}</select></label></div>
        <div class="dg-row"><label class="dg-hint">Background <select class="dg-select" id="dg-theme" style="width:auto"><option value="light">Light paper</option><option value="dark">Dark</option></select></label>
          <label class="dg-hint">Highlight colour <input type="color" id="dg-accent" value="${esc(spec._accent || d.accent || '#7C3AED')}" style="width:40px;height:30px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:none;padding:0;cursor:pointer;vertical-align:middle"></label>
          <label class="dg-hint">Font <select class="dg-select" id="dg-font" style="width:auto">${((options && options.fonts) || [{ id: 'inter', name: 'Inter' }]).map((f) => `<option value="${esc(f.id)}" ${f.id === (spec._font || d.font) ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label></div>
        <label class="dg-label" for="dg-handle">Handle</label>
        <input class="dg-input" id="dg-handle" maxlength="40" value="${esc(spec.handle != null ? spec.handle : (d.handle || ''))}" placeholder="yourbrand">
        <div class="dg-row"><button type="button" class="dg-btn dg-btn--primary" id="dg-save">Save image</button><span class="dg-hint" id="dg-status"></span></div>`;
      $('#dg-theme').value = spec._theme || 'light';
      box.querySelector('#dg-kind').addEventListener('change', (e) => {
        const next = e.target.value;
        const wasCompare = spec.type === 'compare';
        if ((next === 'compare') !== wasCompare) {
          const fresh = blankSpec(next);
          spec = { ...fresh, title: spec.title, eyebrow: spec.eyebrow, handle: spec.handle, _accent: spec._accent, _theme: spec._theme, _font: spec._font };
        } else {
          spec.type = next;
          const [, mx] = limits();
          spec.items = spec.items.slice(0, mx);
          spec.focus = Math.min(spec.focus, spec.items.length - 1);
        }
        renderEditor();
        schedulePreview();
      });
      box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
        const [min] = limits();
        if (count() <= min) { toast(`Keep at least ${min}`, 'warning'); return; }
        const i = Number(b.dataset.del);
        (isCompare ? spec.rows : spec.items).splice(i, 1);
        spec.focus = Math.min(spec.focus, count() - 1);
        renderEditor();
        schedulePreview();
      }));
      box.querySelector('#dg-add')?.addEventListener('click', () => {
        (isCompare ? spec.rows : spec.items).push(isCompare ? { left: '', right: '' } : { label: '' });
        renderEditor();
      });
      box.querySelector('#dg-save').addEventListener('click', save);
    }

    function onInput(e) {
      const t = e.target;
      if (!t || t.id === 'dg-kind') return;
      if (t.dataset.f) {
        const list = spec.type === 'compare' ? spec.rows : spec.items;
        list[Number(t.dataset.i)][t.dataset.f] = t.value;
      } else if (t.id === 'dg-title') spec.title = t.value;
      else if (t.id === 'dg-eyebrow') spec.eyebrow = t.value;
      else if (t.id === 'dg-lt') spec.left_title = t.value;
      else if (t.id === 'dg-rt') spec.right_title = t.value;
      else if (t.id === 'dg-center') spec.center = t.value;
      else if (t.id === 'dg-focus') spec.focus = Number(t.value);
      else if (t.id === 'dg-theme') spec._theme = t.value;
      else if (t.id === 'dg-accent') spec._accent = t.value;
      else if (t.id === 'dg-font') spec._font = t.value;
      else if (t.id === 'dg-handle') spec.handle = t.value;
      else return;
      $('#dg-out').innerHTML = '';
      schedulePreview();
    }

    function payload(extra) {
      const clean = { ...spec };
      delete clean._theme; delete clean._accent; delete clean._font;
      return JSON.stringify({ spec: clean, theme: spec._theme || 'light', accent: spec._accent || '', font: spec._font || '', ...extra });
    }

    function schedulePreview(delay = 500) {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(async () => {
        const seq = ++previewSeq;
        try {
          const r = await api('/api/diagrams/render', { method: 'POST', body: payload({ preview: true }) });
          if (seq !== previewSeq) return;
          $('#dg-stage').innerHTML = `<img id="dg-preview" src="${r.data_url}" alt="Diagram preview">`;
          const s = $('#dg-status'); if (s) s.textContent = '';
        } catch (err) {
          if (seq !== previewSeq) return;
          const s = $('#dg-status'); if (s) s.textContent = err.message;
        }
      }, delay);
    }

    async function save(e) {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const r = await api('/api/diagrams/render', { method: 'POST', body: payload({}) });
        $('#dg-stage').innerHTML = `<img id="dg-preview" src="${esc(r.url)}" alt="Diagram">`;
        $('#dg-out').innerHTML = `<a class="dg-btn" id="dg-download" href="${esc(r.url)}" download="diagram.png" target="_blank" rel="noopener">Download PNG</a>
          <button type="button" class="dg-btn dg-btn--primary" id="dg-create">Post it from Create</button>`;
        $('#dg-create').addEventListener('click', () => {
          global.__SE_COACH_CREATE_SESSION = { destination: 'design', mode: 'image', aspect_ratio: '4:5', prompt: spec.title, attached_image_url: r.url, product_name: 'Diagram', finished: true };
          close();
          if (typeof global.switchNav === 'function') global.switchNav('design-studio');
        });
        toast('Diagram saved');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'Save image';
      }
    }

    if (opts.text && opts.autoDraft !== false) setTimeout(() => $('#dg-draft').click(), 0);
  }

  const BOXES = '.post-caption-edit, #cs-caption-box, #cs-brief';

  function attach() {
    document.querySelectorAll(BOXES).forEach((ta) => {
      if (ta.dataset.dgAttach) return;
      ta.dataset.dgAttach = '1';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dg-attach';
      b.textContent = '◇ Diagram';
      b.title = 'Turn this into a diagram graphic';
      b.addEventListener('click', (e) => {
        e.preventDefault();
        openDiagram({ text: ta.value.trim(), autoDraft: !!ta.value.trim() });
      });
      let after = ta;
      while (after.nextElementSibling && /mp-ck-btn|mr-attach/.test(after.nextElementSibling.className)) after = after.nextElementSibling;
      after.insertAdjacentElement('afterend', b);
    });
  }

  global.seOpenDiagram = openDiagram;

  function boot() {
    injectStyles();
    attach();
    let pending = null;
    new MutationObserver(() => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; attach(); }, 200);
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
