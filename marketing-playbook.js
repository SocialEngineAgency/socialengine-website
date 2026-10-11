/* Marketing playbook UI, kind-aware (online shop / charity / service business).
   window.seMountFunnel(panel)        — funnel map + free resources, under the brand worksheet.
   window.seOpenCopyCheck(textarea)   — checks a caption; "Check copy" buttons attach to caption boxes.
   window.seOpenQuestionLog({ getItems }) — what customers ask, clustered from Inbox comments and DMs.
   window.seOpenLeadMagnet({ topic }) — builds a free resource (guide, checklist) people swap an email for. */
(function (global) {
  'use strict';

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const toast = (msg, kind) => { if (typeof global.showToast === 'function') global.showToast(msg, kind); };

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
    if (document.getElementById('mp-styles')) return;
    const st = document.createElement('style');
    st.id = 'mp-styles';
    st.textContent = `
      .mp-overlay { position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 16px; }
      .mp-modal { background: linear-gradient(135deg,#0f1a2e,#162237); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; width: min(720px, 100%); max-height: 90vh; overflow: auto; padding: 24px; color: #E2E8F0; font-family: var(--font-body, Inter, sans-serif); box-shadow: 0 24px 80px rgba(0,0,0,0.5); }
      .mp-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
      .mp-head h3 { margin: 0; font-size: 1.1rem; color: #fff; }
      .mp-x { background: none; border: none; color: rgba(148,163,184,0.7); font-size: 1.3rem; cursor: pointer; width: auto; }
      .mp-lead { font-size: 0.8rem; color: rgba(148,163,184,0.85); margin: 0 0 14px; line-height: 1.5; }
      .mp-btn { padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: transparent; color: #E2E8F0; font-size: 0.78rem; font-weight: 600; cursor: pointer; font-family: inherit; width: auto; white-space: nowrap; }
      .mp-btn--primary { background: linear-gradient(135deg,#7C3AED,#6D28D9); border: none; color: #fff; }
      .mp-btn--sm { padding: 5px 10px; font-size: 0.72rem; }
      .mp-btn:disabled { opacity: 0.5; cursor: default; }
      .mp-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 10px 0; }
      .mp-input, .mp-select, .mp-text { width: 100%; box-sizing: border-box; padding: 8px 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; font-size: 0.82rem; font-family: inherit; }
      .mp-text { min-height: 80px; resize: vertical; line-height: 1.45; }
      .mp-select option { background: #0f1a2e; }
      .mp-label { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: rgba(167,139,250,0.85); margin: 12px 0 4px; display: block; }
      .mp-hint { font-size: 0.72rem; color: rgba(148,163,184,0.75); line-height: 1.45; }
      .mp-note { font-size: 0.74rem; color: #FCD34D; margin-top: 6px; line-height: 1.45; }
      .mp-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; }
      .mp-check { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; border-top: 1px solid rgba(255,255,255,0.05); font-size: 0.8rem; }
      .mp-check:first-child { border-top: none; }
      .mp-dot { flex: none; width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 800; color: #0A1628; }
      .mp-dot--pass { background: #4ADE80; } .mp-dot--warn { background: #FBBF24; } .mp-dot--fail { background: #F87171; }
      .mp-verdict { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 0.72rem; font-weight: 700; }
      .mp-verdict--ready { background: rgba(74,222,128,0.15); color: #4ADE80; }
      .mp-verdict--improve { background: rgba(251,191,36,0.15); color: #FBBF24; }
      .mp-verdict--fix { background: rgba(248,113,113,0.15); color: #F87171; }
      .mp-ck-btn { display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(124,58,237,0.35); background: rgba(124,58,237,0.08); color: #C4B5FD; font-size: 0.7rem; font-weight: 600; cursor: pointer; font-family: inherit; width: auto; }
      .se-fn { margin-top: 18px; padding: 18px; border-radius: 14px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.07); }
      .se-fn__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
      .se-fn__title { margin: 0; font-size: 1rem; color: #fff; }
      .se-fn__sub { margin: 4px 0 0; font-size: 0.78rem; color: rgba(148,163,184,0.85); line-height: 1.45; max-width: 560px; }
      .se-fn__stage { display: grid; grid-template-columns: 170px minmax(0,1fr) minmax(0,1fr); gap: 10px; align-items: start; padding: 10px 0; border-top: 1px solid rgba(255,255,255,0.05); }
      .se-fn__stage:first-of-type { border-top: none; }
      @media (max-width: 800px) { .se-fn__stage { grid-template-columns: 1fr; } }
      .se-fn__name { font-size: 0.82rem; font-weight: 700; color: #fff; }
      .se-fn__goal { font-size: 0.7rem; color: rgba(148,163,184,0.75); margin-top: 2px; line-height: 1.4; }
      .se-fn__default { display: flex; gap: 6px; align-items: center; font-size: 0.7rem; color: rgba(148,163,184,0.85); margin-top: 6px; cursor: pointer; }
      .se-fn__next { margin-top: 10px; padding: 10px 12px; border-radius: 8px; background: rgba(124,58,237,0.07); border: 1px solid rgba(124,58,237,0.2); font-size: 0.76rem; color: #DDD6FE; }
      .mp-theme__q { font-weight: 700; color: #fff; font-size: 0.86rem; }
      .mp-theme__meta { font-size: 0.7rem; color: rgba(148,163,184,0.75); margin: 2px 0 6px; }
      .mp-theme em { display: block; font-size: 0.74rem; color: rgba(226,232,240,0.7); margin: 2px 0; }
      .mp-lm-preview { background: #fff; color: #111; border-radius: 10px; padding: 18px 20px; margin-top: 12px; font-size: 0.82rem; line-height: 1.5; }
      .mp-lm-preview h4 { margin: 0 0 4px; font-size: 1.15rem; }
      .mp-lm-preview h5 { margin: 14px 0 4px; font-size: 0.9rem; color: #4C1D95; }
      .mp-lm-preview ul { margin: 4px 0; padding-left: 18px; }
      .mp-add { background: #FEF3C7; color: #92400E; padding: 0 3px; border-radius: 3px; }
    `;
    document.head.appendChild(st);
  }

  function modal(title, lead) {
    injectStyles();
    const ov = document.createElement('div');
    ov.className = 'mp-overlay';
    ov.innerHTML = `<div class="mp-modal" role="dialog" aria-label="${esc(title)}">
      <div class="mp-head"><h3>${esc(title)}</h3><button type="button" class="mp-x" aria-label="Close">×</button></div>
      ${lead ? `<p class="mp-lead">${lead}</p>` : ''}
      <div class="mp-body"></div></div>`;
    const close = () => ov.remove();
    ov.querySelector('.mp-x').addEventListener('click', close);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    return { root: ov, body: ov.querySelector('.mp-body'), close };
  }

  const markAdd = (s) => esc(s).replace(/\[ADD:([^\]]*)\]/g, '<span class="mp-add">[ADD:$1]</span>');

  /* ── Copy check ── */
  const CAPTION_BOXES = '.post-caption-edit, #cs-caption-box, #vs-upload-caption, #quick-schedule-caption, textarea[data-fc-k="caption"]';

  function platformFor(ta) {
    const p = ta.dataset.platform || ta.closest('[data-platform]')?.dataset.platform || '';
    return /facebook/i.test(p) ? 'facebook' : /tiktok/i.test(p) ? 'tiktok' : /linkedin/i.test(p) ? 'linkedin' : 'instagram';
  }

  function setText(ta, value) {
    ta.value = value;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function openCopyCheck(target, opts = {}) {
    const ta = target && target.tagName === 'TEXTAREA' ? target : null;
    const text = ta ? ta.value : String((target && target.text) || '');
    if (!text.trim()) { toast('Write or paste the caption first', 'warning'); return; }
    const m = modal('Check copy', 'Quick checks run instantly. The deeper review compares your caption against the fundamentals for your kind of business and flags anything that looks made up.');
    m.body.innerHTML = '<div class="mp-hint">Checking…</div>';
    const source = opts.source || '';
    api('/api/marketing/copy-check', { method: 'POST', body: JSON.stringify({ text, platform: opts.platform || (ta ? platformFor(ta) : 'instagram'), source }) })
      .then((d) => {
        const label = { ready: 'Ready to post', improve: 'Could be stronger', fix: 'Fix before posting' }[d.verdict] || d.verdict;
        const sym = { pass: '✓', warn: '!', fail: '×' };
        const checks = (d.checks || []).map((c) => `<div class="mp-check" data-check="${esc(c.id)}">
            <span class="mp-dot mp-dot--${esc(c.status)}">${sym[c.status] || ''}</span>
            <div><div style="font-weight:600;color:#fff">${esc(c.label)}</div>
            ${c.note ? `<div class="mp-hint">${esc(c.note)}</div>` : ''}
            ${(c.unsupported || []).length ? `<div class="mp-note">Not backed by your source: ${c.unsupported.map(esc).join('; ')}</div>` : ''}</div>
          </div>`).join('');
        const hasDash = (d.checks || []).some((c) => c.id === 'em_dash' && c.status !== 'pass');
        m.body.innerHTML = `<div class="mp-row" style="justify-content:space-between"><span class="mp-verdict mp-verdict--${esc(d.verdict)}" id="mp-ck-verdict">${esc(label)}</span><span class="mp-hint">Score ${esc(d.score)}/100</span></div>
          <div class="mp-card">${checks}</div>
          ${d.ai_error ? `<div class="mp-note">${esc(d.ai_error)}</div>` : ''}
          ${d.better_hook ? `<span class="mp-label">Stronger first line</span><div class="mp-card" id="mp-ck-hook">${esc(d.better_hook)}</div>` : ''}
          <div class="mp-row">
            ${ta && d.better_hook ? '<button type="button" class="mp-btn mp-btn--primary" id="mp-ck-use-hook">Use this first line</button>' : ''}
            ${ta && hasDash ? '<button type="button" class="mp-btn" id="mp-ck-dash">Remove em dashes</button>' : ''}
            <button type="button" class="mp-btn" id="mp-ck-close">Close</button>
          </div>`;
        m.body.querySelector('#mp-ck-close').addEventListener('click', m.close);
        m.body.querySelector('#mp-ck-use-hook')?.addEventListener('click', () => {
          const lines = ta.value.split('\n');
          const i = lines.findIndex((l) => l.trim());
          lines[i < 0 ? 0 : i] = d.better_hook;
          setText(ta, lines.join('\n'));
          toast('First line updated');
          m.close();
        });
        m.body.querySelector('#mp-ck-dash')?.addEventListener('click', () => {
          setText(ta, ta.value.replace(/\s*\u2014\s*$/gm, '').replace(/(\S)\s*\u2014\s*(\S)/g, '$1, $2'));
          toast('Em dashes removed');
          m.close();
        });
      })
      .catch((e) => { m.body.innerHTML = `<div class="mp-note">${esc(e.message)}</div>`; });
  }

  function attachCheckButtons(root) {
    (root || document).querySelectorAll(CAPTION_BOXES).forEach((ta) => {
      if (ta.dataset.mpCheck) return;
      ta.dataset.mpCheck = '1';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mp-ck-btn';
      b.textContent = '✓ Check copy';
      b.title = 'Check the hook, next step, tone and facts before you post';
      b.addEventListener('click', (e) => { e.preventDefault(); openCopyCheck(ta); });
      ta.insertAdjacentElement('afterend', b);
    });
  }

  /* ── Funnel map ── */
  function mountFunnel(panel) {
    injectStyles();
    if (!panel || panel.querySelector('#se-funnel')) return;
    const anchor = panel.querySelector('#se-brand-worksheet');
    const sec = document.createElement('section');
    sec.id = 'se-funnel';
    sec.className = 'se-fn';
    sec.innerHTML = '<div class="mp-hint">Loading your customer journey…</div>';
    if (anchor) anchor.insertAdjacentElement('afterend', sec); else panel.prepend(sec);
    const S = { d: null, kind: '', funnel: { stages: {}, default_next_step: '' }, magnets: [] };

    const read = () => {
      const stages = {};
      sec.querySelectorAll('[data-fn-stage]').forEach((row) => {
        const id = row.dataset.fnStage;
        stages[id] = {
          title: row.querySelector('[data-fn="title"]').value.trim(),
          url: row.querySelector('[data-fn="url"]').value.trim(),
          note: row.querySelector('[data-fn="note"]').value.trim(),
        };
      });
      const def = sec.querySelector('input[name="se-fn-default"]:checked');
      return { stages, default_next_step: def ? def.value : '' };
    };

    function render() {
      const d = S.d;
      const kind = S.kind || d.kind;
      const stages = ((d.stages_by_kind || {})[kind] || d.stages || []).filter((s) => s.id !== 'content');
      const f = S.funnel;
      const opts = [`<option value="">Auto (${esc((d.kinds.find((k) => k.id === d.detected_kind) || {}).label || '')})</option>`]
        .concat(d.kinds.map((k) => `<option value="${esc(k.id)}">${esc(k.label)}</option>`)).join('');
      sec.innerHTML = `<div class="se-fn__head">
          <div><h3 class="se-fn__title">Customer journey</h3>
          <p class="se-fn__sub">What follows a post? Fill in what you offer at each step. Every caption, Coach answer and carousel will end by pointing to one of these, instead of a vague "check us out".</p></div>
          <div class="mp-row" style="margin:0">
            <button type="button" class="mp-btn" id="se-fn-suggest">Draft it for me</button>
            <button type="button" class="mp-btn mp-btn--primary" id="se-fn-save">Save</button>
          </div>
        </div>
        <label class="mp-label" for="se-fn-kind">We are a</label>
        <select class="mp-select" id="se-fn-kind" style="max-width:320px">${opts}</select>
        <div class="mp-hint" style="margin-top:4px">This changes the advice: charities get hope and small asks, shops get offers and repeat orders, service businesses get bookings and local proof.</div>
        <div style="margin-top:12px">${stages.map((s) => {
          const v = (f.stages || {})[s.id] || {};
          return `<div class="se-fn__stage" data-fn-stage="${esc(s.id)}">
            <div><div class="se-fn__name">${esc(s.label)}</div><div class="se-fn__goal">${esc(s.goal)}</div>
              <label class="se-fn__default"><input type="radio" name="se-fn-default" value="${esc(s.id)}" ${f.default_next_step === s.id ? 'checked' : ''}> Posts point here</label></div>
            <div><input class="mp-input" data-fn="title" maxlength="120" placeholder="${esc((s.examples || [])[0] || s.label)}" value="${esc(v.title)}" />
              <input class="mp-input" data-fn="url" style="margin-top:6px" maxlength="500" placeholder="https:// link (optional)" value="${esc(v.url)}" /></div>
            <div><input class="mp-input" data-fn="note" maxlength="240" placeholder="Note for the writer (optional)" value="${esc(v.note)}" />
              ${s.id === 'lead_magnet' ? '<button type="button" class="mp-btn mp-btn--sm" style="margin-top:6px" id="se-fn-build">Build a free resource</button>' : ''}</div>
          </div>`;
        }).join('')}</div>
        <div class="se-fn__next" id="se-fn-next"><strong>Posts end with:</strong> ${esc(d.next_step || '')}</div>
        <div id="se-fn-magnets" style="margin-top:14px"></div>`;
      sec.querySelector('#se-fn-kind').value = S.kindChosen || '';
      renderMagnets();
      sec.querySelector('#se-fn-kind').addEventListener('change', (e) => { S.funnel = read(); S.kindChosen = e.target.value; S.kind = e.target.value || d.detected_kind; render(); });
      sec.querySelector('#se-fn-save').addEventListener('click', save);
      sec.querySelector('#se-fn-suggest').addEventListener('click', suggest);
      sec.querySelector('#se-fn-build')?.addEventListener('click', () => openLeadMagnet({ onSaved: loadMagnets }));
    }

    function renderMagnets() {
      const box = sec.querySelector('#se-fn-magnets');
      if (!box) return;
      if (!S.magnets.length) { box.innerHTML = ''; return; }
      box.innerHTML = `<span class="mp-label">Your free resources</span>${S.magnets.map((m) => `<div class="mp-card" style="display:flex;justify-content:space-between;gap:10px;align-items:center">
          <div style="min-width:0"><div style="font-weight:600;color:#fff">${esc(m.title)}</div><div class="mp-hint">${esc(m.promise || '')}</div></div>
          <div class="mp-row" style="margin:0;flex:none">
            <button type="button" class="mp-btn mp-btn--sm" data-lm-print="${esc(m.id)}">PDF</button>
            <button type="button" class="mp-btn mp-btn--sm" data-lm-use="${esc(m.id)}">Use as free offer</button>
            <button type="button" class="mp-btn mp-btn--sm" data-lm-del="${esc(m.id)}" aria-label="Delete">×</button>
          </div></div>`).join('')}`;
      box.querySelectorAll('[data-lm-print]').forEach((b) => b.addEventListener('click', () => printLeadMagnet(b.dataset.lmPrint)));
      box.querySelectorAll('[data-lm-use]').forEach((b) => b.addEventListener('click', () => {
        const m = S.magnets.find((x) => x.id === b.dataset.lmUse);
        const row = sec.querySelector('[data-fn-stage="lead_magnet"]');
        if (!m || !row) return;
        row.querySelector('[data-fn="title"]').value = m.title;
        toast('Added as your free offer. Press Save to keep it.');
      }));
      box.querySelectorAll('[data-lm-del]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Delete this free resource?')) return;
        try { S.magnets = (await api(`/api/marketing/lead-magnets/${encodeURIComponent(b.dataset.lmDel)}`, { method: 'DELETE' })).items || []; renderMagnets(); } catch (e) { toast(e.message, 'error'); }
      }));
    }

    async function save(e) {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const body = { funnel: read(), kind: sec.querySelector('#se-fn-kind').value };
        const d = await api('/api/marketing/funnel', { method: 'PUT', body: JSON.stringify(body) });
        S.d = d; S.kind = d.kind; S.kindChosen = d.kind_override; S.funnel = d.funnel;
        render();
        toast('Customer journey saved');
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false; btn.textContent = 'Save';
      }
    }

    async function suggest(e) {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Drafting…';
      try {
        const d = await api('/api/marketing/funnel/suggest', { method: 'POST', body: '{}' });
        const cur = read();
        const stages = Object.assign({}, cur.stages);
        let filled = 0;
        for (const [id, s] of Object.entries((d.funnel || {}).stages || {})) {
          if (!stages[id] || !stages[id].title) { stages[id] = s; filled += 1; }
        }
        S.funnel = { stages, default_next_step: cur.default_next_step || (d.funnel || {}).default_next_step || '' };
        render();
        toast(filled ? `Filled ${filled} empty step${filled === 1 ? '' : 's'}. Check them, then Save.` : 'Every step already has something in it.');
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false; btn.textContent = 'Draft it for me';
      }
    }

    async function loadMagnets() {
      try { S.magnets = (await api('/api/marketing/lead-magnets')).items || []; renderMagnets(); } catch (_) { /* optional */ }
    }

    api('/api/marketing/funnel')
      .then((d) => {
        if (!Array.isArray(d.kinds)) { sec.remove(); return; }
        S.d = d; S.kind = d.kind; S.kindChosen = d.kind_override; S.funnel = d.funnel || S.funnel; render(); loadMagnets(); })
      .catch(() => { sec.innerHTML = '<div class="mp-hint">Could not load your customer journey. Refresh to try again.</div>'; });
  }

  /* ── Lead magnet builder ── */
  async function printLeadMagnet(id) {
    const w = global.open('', '_blank');
    if (!w) { toast('Allow pop-ups to download the PDF', 'warning'); return; }
    w.document.write('<p style="font-family:sans-serif">Preparing…</p>');
    try {
      const se = global.seApi || {};
      const res = await fetch(`${global.API || global._seAPI || ''}/api/marketing/lead-magnets/${encodeURIComponent(id)}/print`, { headers: typeof se.headers === 'function' ? se.headers() : {} });
      if (!res.ok) throw new Error('Could not build the PDF');
      const html = await res.text();
      w.document.open(); w.document.write(html); w.document.close();
      setTimeout(() => { try { w.focus(); w.print(); } catch (_) { /* user prints manually */ } }, 400);
    } catch (e) {
      w.close();
      toast(e.message, 'error');
    }
  }

  function lmPreviewHtml(m) {
    return `<div class="mp-lm-preview" id="mp-lm-preview">
      <h4>${markAdd(m.title)}</h4>${m.subtitle ? `<div style="color:#555">${markAdd(m.subtitle)}</div>` : ''}
      ${m.promise ? `<p><strong>${markAdd(m.promise)}</strong></p>` : ''}
      ${(m.sections || []).map((s) => `<h5>${markAdd(s.heading)}</h5>${s.body ? `<p>${markAdd(s.body)}</p>` : ''}${(s.items || []).length ? `<ul>${s.items.map((i) => `<li>${markAdd(i)}</li>`).join('')}</ul>` : ''}`).join('')}
      ${m.next_step ? `<p style="margin-top:14px;font-weight:700">${markAdd(m.next_step)}</p>` : ''}
    </div>`;
  }

  function openLeadMagnet(opts = {}) {
    const m = modal('Build a free resource', 'A short, genuinely useful guide or checklist people get in exchange for their email. It solves one problem fully, then points to your next step. It only uses facts you give it; anything it needs from you is marked <span class="mp-add">[ADD: …]</span>.');
    const S = { formats: [], kind: '', magnet: null, saved: null };
    m.body.innerHTML = '<div class="mp-hint">Loading…</div>';

    function form() {
      m.body.innerHTML = `<label class="mp-label" for="mp-lm-topic">What problem does it solve?</label>
        <input class="mp-input" id="mp-lm-topic" maxlength="400" placeholder="${S.kind === 'charity' ? 'e.g. What to ask at your first appointment' : S.kind === 'service' ? 'e.g. What to check before hiring a roofer' : 'e.g. How to pick the right size first time'}" value="${esc(opts.topic || '')}" />
        <label class="mp-label" for="mp-lm-format">Format</label>
        <select class="mp-select" id="mp-lm-format">${S.formats.map((f) => `<option value="${esc(f.id)}">${esc(f.label)}: ${esc(f.hint)}</option>`).join('')}</select>
        <label class="mp-label" for="mp-lm-source">Facts to use (optional)</label>
        <textarea class="mp-text" id="mp-lm-source" maxlength="6000" placeholder="${S.kind === 'charity' ? 'Paste approved health information (e.g. from your medical advisers or NHS pages). Medical points will only come from here.' : 'Paste product details, prices, process, FAQs. Nothing outside this and your brand details will be stated as fact.'}"></textarea>
        <div class="mp-row"><button type="button" class="mp-btn mp-btn--primary" id="mp-lm-go">Write it</button></div>
        <div id="mp-lm-out"></div>`;
      m.body.querySelector('#mp-lm-go').addEventListener('click', generate);
    }

    function showResult() {
      const x = S.magnet;
      const out = m.body.querySelector('#mp-lm-out');
      out.innerHTML = `${(x.sources_needed || []).length ? `<div class="mp-note"><strong>Before you share it, add or confirm:</strong><br>${x.sources_needed.map(esc).join('<br>')}</div>` : ''}
        ${lmPreviewHtml(x)}
        <span class="mp-label">Sign-up box copy</span>
        <div class="mp-card"><div style="font-weight:700;color:#fff">${esc(x.optin.headline)}</div><div class="mp-hint">${esc(x.optin.subhead)}</div>
          <ul style="margin:6px 0;padding-left:18px;font-size:0.78rem">${x.optin.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
          <span class="mp-btn mp-btn--sm mp-btn--primary" style="display:inline-block">${esc(x.optin.button)}</span></div>
        ${x.delivery_email.subject ? `<span class="mp-label">Delivery email</span><div class="mp-card"><div style="font-weight:600;color:#fff">${esc(x.delivery_email.subject)}</div><div class="mp-hint" style="white-space:pre-wrap">${esc(x.delivery_email.body)}</div></div>` : ''}
        <div class="mp-row">
          <button type="button" class="mp-btn mp-btn--primary" id="mp-lm-save">${S.saved ? 'Saved' : 'Save'}</button>
          <button type="button" class="mp-btn" id="mp-lm-pdf">Save and download PDF</button>
          <button type="button" class="mp-btn" id="mp-lm-copy">Copy sign-up text</button>
        </div>`;
      const doSave = async () => {
        if (S.saved) return S.saved;
        const d = await api('/api/marketing/lead-magnets', { method: 'POST', body: JSON.stringify({ magnet: x }) });
        S.saved = d.item;
        if (typeof opts.onSaved === 'function') opts.onSaved(d.item);
        return d.item;
      };
      out.querySelector('#mp-lm-save').addEventListener('click', async (e) => {
        try { await doSave(); e.currentTarget.textContent = 'Saved'; toast('Saved. Find it under Settings, Brand, Customer journey.'); } catch (err) { toast(err.message, 'error'); }
      });
      out.querySelector('#mp-lm-pdf').addEventListener('click', async () => {
        try { const item = await doSave(); printLeadMagnet(item.id); } catch (err) { toast(err.message, 'error'); }
      });
      out.querySelector('#mp-lm-copy').addEventListener('click', () => {
        const t = [x.optin.headline, x.optin.subhead, ...x.optin.bullets.map((b) => `- ${b}`), x.optin.button].filter(Boolean).join('\n');
        navigator.clipboard?.writeText(t).then(() => toast('Copied'), () => toast('Could not copy', 'error'));
      });
    }

    async function generate(e) {
      const btn = e.currentTarget;
      const topic = m.body.querySelector('#mp-lm-topic').value.trim();
      if (!topic) { toast('Say what problem it solves', 'warning'); return; }
      btn.disabled = true; btn.textContent = 'Writing… (about 30 seconds)';
      S.saved = null;
      try {
        const d = await api('/api/marketing/lead-magnets/generate', {
          method: 'POST',
          body: JSON.stringify({ topic, format: m.body.querySelector('#mp-lm-format').value, source: m.body.querySelector('#mp-lm-source').value }),
        });
        S.magnet = d.magnet;
        showResult();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'Write it again';
      }
    }

    api('/api/marketing/lead-magnets')
      .then((d) => { S.formats = d.formats || []; S.kind = d.kind; form(); })
      .catch((e) => { m.body.innerHTML = `<div class="mp-note">${esc(e.message)}</div>`; });
  }

  /* ── Customer question log ── */
  function openQuestionLog(opts = {}) {
    const m = modal('What customers ask', 'Reads the comments and DMs in your Inbox and groups the questions people keep asking. Each one is a post idea, and the biggest ones make the best free resources.');
    const render = (d, error) => {
      const themes = d.themes || [];
      const when = d.generated_at ? new Date(d.generated_at).toLocaleString() : '';
      m.body.innerHTML = `<div class="mp-row" style="justify-content:space-between">
          <span class="mp-hint">${when ? `From ${esc(d.message_count)} messages · ${esc(when)}` : 'Not read yet.'}</span>
          <button type="button" class="mp-btn mp-btn--primary" id="mp-q-run">${themes.length ? 'Read again' : 'Read my inbox'}</button>
        </div>
        ${error ? `<div class="mp-note">${esc(error)}</div>` : ''}
        ${themes.map((t, i) => `<div class="mp-card mp-theme">
            <div class="mp-theme__q">${esc(t.question)}</div>
            <div class="mp-theme__meta">${esc(t.theme)} · asked ${esc(t.count)}×</div>
            ${(t.examples || []).map((x) => `<em>“${esc(x)}”</em>`).join('')}
            ${t.content_idea ? `<div class="mp-hint" style="margin-top:6px"><strong>Post idea:</strong> ${esc(t.content_idea)}</div>` : ''}
            ${t.lead_magnet_idea ? `<div class="mp-hint"><strong>Free resource idea:</strong> ${esc(t.lead_magnet_idea)}</div>` : ''}
            <div class="mp-row" style="margin-bottom:0">
              <button type="button" class="mp-btn mp-btn--sm" data-q-post="${i}">Make a post</button>
              <button type="button" class="mp-btn mp-btn--sm" data-q-magnet="${i}">Build a free resource</button>
            </div>
          </div>`).join('') || (when ? '<div class="mp-hint">No repeated questions yet.</div>' : '')}`;
      m.body.querySelector('#mp-q-run').addEventListener('click', run);
      m.body.querySelectorAll('[data-q-post]').forEach((b) => b.addEventListener('click', () => {
        const t = themes[Number(b.dataset.qPost)];
        global.__SE_COACH_CREATE_SESSION = { destination: 'design', mode: 'image', aspect_ratio: '4:5', prompt: `${t.content_idea || t.question}\n\nAnswer the question customers ask: "${t.question}"` };
        m.close();
        if (typeof global.switchNav === 'function') global.switchNav('design-studio');
      }));
      m.body.querySelectorAll('[data-q-magnet]').forEach((b) => b.addEventListener('click', () => {
        const t = themes[Number(b.dataset.qMagnet)];
        m.close();
        openLeadMagnet({ topic: t.lead_magnet_idea || t.question });
      }));
    };
    async function run(e) {
      const btn = e.currentTarget;
      const items = (typeof opts.getItems === 'function' ? opts.getItems() : []) || [];
      btn.disabled = true; btn.textContent = 'Reading…';
      try {
        const payload = items.slice(0, 300).map((i) => ({ type: i.type, platform: i.platform, text: String(i.text || '').slice(0, 400), is_from_us: !!i.is_from_us }));
        render(await api('/api/marketing/questions/refresh', { method: 'POST', body: JSON.stringify({ items: payload }) }));
      } catch (err) {
        const prev = await api('/api/marketing/questions').catch(() => ({}));
        render(prev, err.message);
      }
    }
    m.body.innerHTML = '<div class="mp-hint">Loading…</div>';
    api('/api/marketing/questions').then((d) => render(d)).catch((e) => render({}, e.message));
  }

  global.seMountFunnel = mountFunnel;
  global.seOpenCopyCheck = openCopyCheck;
  global.seOpenQuestionLog = openQuestionLog;
  global.seOpenLeadMagnet = openLeadMagnet;

  function boot() {
    injectStyles();
    attachCheckButtons(document);
    let pending = null;
    new MutationObserver(() => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; attachCheckButtons(document); }, 150);
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
