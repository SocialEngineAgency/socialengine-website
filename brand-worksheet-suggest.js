/* Brand worksheet suggestions: analyses the client's last 12 months of posts (or,
   for a new account with too few posts, their website) and puts one-click answers
   beside each worksheet question (summary strip on top, chips per question,
   evidence behind "Why?"). A website reading also offers the products or services
   the site names, and its colours and logo. An empty worksheet is filled from the
   suggestions automatically; nothing saves until the user presses Save.
   window.seMountWorksheetSuggest(panel) — panel contains #se-brand-worksheet. */
(function (global) {
  'use strict';

  const FORMALITY = ['', 'Very formal', 'Mostly formal', 'Balanced', 'Mostly casual', 'Very casual'];
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function apiBase() { return global.API || global._seAPI || ''; }
  function headers(extra) {
    const a = global.seApi;
    return Object.assign({}, a && typeof a.headers === 'function' ? a.headers() : {}, extra || {});
  }
  function toast(msg, kind) { if (typeof global.showToast === 'function') global.showToast(msg, kind); }
  async function call(method, path) {
    const res = await fetch(`${apiBase()}${path}`, { method, headers: headers(method === 'POST' ? { 'Content-Type': 'application/json' } : {}), body: method === 'POST' ? '{}' : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }

  function injectStyles() {
    if (document.getElementById('bws-styles')) return;
    const st = document.createElement('style');
    st.id = 'bws-styles';
    st.textContent = `
      .se-bw__q { padding: 12px 0; border-top: 1px solid rgba(255,255,255,0.05); }
      .se-bw__q:first-child { border-top: none; }
      .se-bw__q .se-bw__label { margin-top: 0; }
      .se-bw__sugg:empty { display: none; }
      .se-bw.bws-on .se-bw__q { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 24px; align-items: start; }
      @media (max-width: 900px) { .se-bw.bws-on .se-bw__q { grid-template-columns: 1fr; gap: 8px; } }
      .bws { margin: 10px 0 6px; padding: 12px 14px; border-radius: 10px; background: rgba(124,58,237,0.07); border: 1px solid rgba(124,58,237,0.22); font-size: 0.76rem; color: rgba(226,232,240,0.9); display: flex; gap: 14px; align-items: flex-start; }
      .bws__main { flex: 1; min-width: 0; }
      .bws__title { font-size: 0.8rem; font-weight: 700; color: #fff; }
      .bws__meta { font-size: 0.68rem; color: rgba(148,163,184,0.8); margin-top: 2px; }
      .bws__summary { margin: 6px 0 0; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .bws.is-open .bws__summary { -webkit-line-clamp: unset; display: block; }
      .bws__more { background: none; border: none; padding: 0; color: #A78BFA; font-size: 0.7rem; font-weight: 600; cursor: pointer; width: auto; margin-top: 2px; font-family: inherit; }
      .bws__stats, .bws__note { font-size: 0.68rem; margin-top: 6px; line-height: 1.45; }
      .bws__stats { color: rgba(148,163,184,0.8); display: none; }
      .bws.is-open .bws__stats { display: block; }
      .bws__note { color: #FCD34D; }
      .bws__actions { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
      .bws__btn { padding: 7px 12px; border-radius: 8px; border: 1px solid rgba(124,58,237,0.4); background: transparent; color: #DDD6FE; font-size: 0.72rem; font-weight: 600; cursor: pointer; width: auto; white-space: nowrap; font-family: inherit; }
      .bws__btn--primary { background: #7C3AED; border-color: #7C3AED; color: #fff; }
      .bws__btn[disabled] { opacity: 0.6; cursor: default; }
      @media (max-width: 640px) { .bws { flex-direction: column; } .bws__actions { flex-direction: row; } }
      .bws-s__label { font-size: 0.64rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(167,139,250,0.85); margin-bottom: 6px; }
      .bws-s__chips { display: flex; flex-wrap: wrap; gap: 5px; }
      .bws-chip { padding: 4px 10px; border-radius: 14px; border: 1px solid rgba(124,58,237,0.35); background: rgba(124,58,237,0.1); color: #DDD6FE; font-size: 0.72rem; font-weight: 600; cursor: pointer; width: auto; font-family: inherit; text-align: left; line-height: 1.35; }
      .bws-chip:hover:not([disabled]) { background: rgba(124,58,237,0.22); }
      .bws-chip[disabled] { opacity: 0.5; cursor: default; }
      .bws-chip small { font-weight: 500; opacity: 0.7; margin-left: 4px; }
      .se-bw__brand { padding: 12px 0 2px; border-top: 1px solid rgba(255,255,255,0.05); }
      .bws-brand__row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 4px; }
      .bws-swatch { display: inline-flex; align-items: center; gap: 6px; padding: 3px 4px 3px 3px; border-radius: 9px; border: 1px solid var(--color-border, rgba(255,255,255,0.12)); font: 600 0.7rem var(--font-mono, monospace); color: rgba(226,232,240,0.9); }
      .bws-swatch i { width: 22px; height: 22px; border-radius: 6px; display: block; border: 1px solid rgba(255,255,255,0.15); }
      .bws-logo { display: inline-flex; align-items: center; gap: 6px; padding: 3px; border-radius: 9px; border: 1px solid var(--color-border, rgba(255,255,255,0.12)); background: rgba(255,255,255,0.9); }
      .bws-logo img { height: 28px; max-width: 120px; object-fit: contain; display: block; }
      .bws-drop { width: 22px; height: 22px; border-radius: 6px; border: none; background: rgba(15,23,42,0.08); color: #475569; cursor: pointer; font-size: 0.85rem; line-height: 1; padding: 0; }
      .bws-swatch .bws-drop { background: transparent; color: rgba(148,163,184,0.85); }
      .bws-brand__hint { font-size: 0.68rem; color: rgba(148,163,184,0.8); margin-top: 6px; }
      .bws__note--ok { color: #A7F3D0; }
      .bws-why { margin-top: 6px; font-size: 0.7rem; color: rgba(148,163,184,0.85); }
      .bws-why summary { cursor: pointer; color: rgba(167,139,250,0.85); font-weight: 600; list-style: none; display: inline; }
      .bws-why summary::-webkit-details-marker { display: none; }
      .bws-why ul { margin: 6px 0 0; padding-left: 16px; line-height: 1.45; }
      .bws-why li { margin-bottom: 4px; }
      .bws-why em { color: rgba(226,232,240,0.75); }
      .se-bw-input.bws-filled, .se-bw__range.bws-filled { box-shadow: 0 0 0 2px rgba(167,139,250,0.55); }
    `;
    document.head.appendChild(st);
  }

  function create(panel) {
    const form = panel.querySelector('#se-brand-worksheet');
    const strip = panel.querySelector('#se-bw-suggest');
    if (!form || !strip) return;
    const S = { data: null, busy: false, error: '', open: false, autoFilled: false, dropped: new Set() };
    const offerNames = () => (typeof form.seOfferings === 'function' ? form.seOfferings().map((o) => o.name.toLowerCase()) : []);
    const isEmpty = () => !adjList().length && ['values', 'embrace', 'avoid'].every((k) => listInputs(k).every((i) => !i.value.trim())) && !offerNames().length;

    const slot = (name) => form.querySelector(`[data-bws-slot="${name}"]`);
    const listInputs = (key) => [...form.querySelectorAll(`[data-bw-list="${key}"]`)];
    const adjInput = () => form.querySelector('#se-bw-adjectives');
    const adjList = () => String(adjInput()?.value || '').split(',').map((s) => s.trim()).filter(Boolean);
    const inList = (key, v) => listInputs(key).some((i) => i.value.trim().toLowerCase() === String(v).toLowerCase());
    const formalityNow = () => Number(form.querySelector('#se-bw-formality')?.value) || 3;

    function markDirty() {
      const save = form.querySelector('#se-bw-save');
      if (save && !save.dataset.bwsDirty) { save.dataset.bwsDirty = '1'; save.textContent = 'Save changes'; }
    }

    function mark(el) {
      if (!el) return;
      el.classList.add('bws-filled');
      setTimeout(() => el.classList.remove('bws-filled'), 1600);
      markDirty();
    }

    function setFormality(v) {
      const r = form.querySelector('#se-bw-formality');
      if (!r) return;
      r.value = String(v);
      r.dispatchEvent(new Event('input', { bubbles: true }));
      mark(r);
    }

    function addAdjective(word) {
      const list = adjList();
      if (list.some((w) => w.toLowerCase() === word.toLowerCase())) return true;
      if (list.length >= 5) { toast('Up to 5 words — remove one first', 'warning'); return false; }
      list.push(word);
      adjInput().value = list.join(', ');
      mark(adjInput());
      return true;
    }

    function fillList(key, value) {
      if (inList(key, value)) return true;
      const empty = listInputs(key).find((i) => !i.value.trim());
      if (!empty) { toast('All three boxes are full — clear one first', 'warning'); return false; }
      empty.value = value;
      mark(empty);
      return true;
    }

    function fillEmpty(quiet) {
      const d = S.data;
      let n = 0;
      if (!offerNames().length && typeof form.seAddOffering === 'function') {
        (d.offerings || []).forEach((o) => { if (form.seAddOffering(o)) n += 1; });
      }
      if (!adjList().length) d.expectation_adjectives.suggestions.slice(0, 5).forEach((w) => { if (addAdjective(w)) n += 1; });
      const top = (key, items) => {
        for (const v of items) {
          if (!listInputs(key).some((i) => !i.value.trim())) break;
          if (!inList(key, v)) { fillList(key, v); n += 1; }
        }
      };
      top('values', d.values.suggestions.map((v) => v.value));
      top('embrace', d.embrace.suggestions.map((e) => e.phrase));
      top('avoid', d.avoid.suggestions.map((a) => a.phrase));
      if (!quiet) toast(n ? `Filled ${n} empty box${n === 1 ? '' : 'es'} — check them, then press Save` : 'Nothing empty to fill');
      if (n) markDirty();
      renderSlots();
      return n;
    }

    function metaLine(d) {
      const b = d.based_on || {};
      if (d.from_site) {
        const kinds = ((d.site && d.site.pages) || []).map((p) => (p.kind === 'home' ? 'home page' : p.kind));
        return [d.site && d.site.url ? d.site.url.replace(/^https:\/\//, '') : '', kinds.length ? `read: ${kinds.join(', ')}` : '', b.confidence ? `${b.confidence} confidence` : ''].filter(Boolean).join(' · ');
      }
      const fmt = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
      const parts = [];
      if (b.from && b.to) parts.push(`${fmt(b.from)} – ${fmt(b.to)}`);
      if ((d.sources || []).length) parts.push(d.sources.join(' + '));
      if (b.confidence) parts.push(`${b.confidence} confidence`);
      if (b.engagement_weighted) parts.push('weighted to your best posts');
      return parts.join(' · ');
    }

    const why = (items) => (items.length ? `<details class="bws-why"><summary>Why?</summary><ul>${items.join('')}</ul></details>` : '');
    const chip = (attrs, label, used, extra = '') => `<button type="button" class="bws-chip" ${attrs} ${used ? 'disabled' : ''}>${used ? '✓ ' : '+ '}${esc(label)}${extra}</button>`;

    function renderStrip() {
      const d = S.data;
      form.classList.toggle('bws-on', !!(d && !d.empty && d.formality) && !S.busy);
      strip.classList.toggle('is-open', S.open);
      if (S.busy) {
        strip.innerHTML = '<div class="bws__main"><div class="bws__title">Reading your posts, or your website if you are new…</div><div class="bws__meta">This takes 20–60 seconds.</div></div>';
        return;
      }
      if (!d || (!d.empty && !d.formality)) {
        strip.innerHTML = `<div class="bws__main"><div class="bws__title">Not sure what to write?</div>
            <div class="bws__meta">We'll read your last 12 months of posts and suggest an answer beside each question, with real examples from your captions. New here? We'll read your website instead.</div>
            ${S.error ? `<div class="bws__note">${esc(S.error)}</div>` : ''}</div>
          <div class="bws__actions"><button type="button" class="bws__btn bws__btn--primary" id="bws-run">Analyse my posts</button></div>`;
        strip.querySelector('#bws-run').addEventListener('click', run);
        return;
      }
      if (d.empty) {
        strip.innerHTML = `<div class="bws__main"><div class="bws__title">Suggestions from your posts</div>
            <div class="bws__meta">${esc(d.message)}</div>
            ${(d.notes || []).map((n) => `<div class="bws__note">${esc(n)}</div>`).join('')}</div>
          <div class="bws__actions"><button type="button" class="bws__btn" id="bws-run">Try again</button></div>`;
        strip.querySelector('#bws-run').addEventListener('click', run);
        return;
      }
      const st = d.stats || {};
      strip.innerHTML = `<div class="bws__main">
          <div class="bws__title">${d.from_site ? 'Suggestions from your website' : `Suggestions from your last ${esc((d.based_on || {}).posts || 0)} posts`}</div>
          <div class="bws__meta">${esc(metaLine(d))}</div>
          ${d.summary ? `<p class="bws__summary">${esc(d.summary)}</p>` : ''}
          ${st.posts ? `<div class="bws__stats">Your captions: ~${st.avg_caption_chars} characters · ${st.emoji_per_post} emoji per post · ${Math.round((st.question_share || 0) * 100)}% ask a question · ${st.hashtags_per_post} hashtags per post</div>` : ''}
          <button type="button" class="bws__more" id="bws-more">${S.open ? 'Less' : 'More'}</button>
          ${S.error ? `<div class="bws__note">${esc(S.error)}</div>` : ''}
          ${(d.notes || []).map((n) => `<div class="bws__note">${esc(n)}</div>`).join('')}
          ${S.autoFilled ? '<div class="bws__note bws__note--ok" id="bws-autofilled">We filled your empty worksheet from these suggestions. Check each box, then press Save.</div>' : ''}
        </div>
        <div class="bws__actions">
          <button type="button" class="bws__btn bws__btn--primary" id="bws-fill">Fill empty boxes</button>
          <button type="button" class="bws__btn" id="bws-run">${d.from_site ? 'Read again' : 'Re-analyse'}</button>
        </div>`;
      strip.querySelector('#bws-run').addEventListener('click', run);
      strip.querySelector('#bws-fill').addEventListener('click', () => fillEmpty(false));
      strip.querySelector('#bws-more').addEventListener('click', () => { S.open = !S.open; renderStrip(); });
    }

    function renderSlots() {
      const d = S.data;
      const live = d && !d.empty && d.formality && !S.busy;
      ['formality', 'adjectives', 'values', 'embrace', 'avoid', 'offerings'].forEach((n) => { const el = slot(n); if (el) el.innerHTML = ''; });
      renderBrand();
      if (!live) return;
      const site = !!d.from_site;

      const f = d.formality;
      slot('formality').innerHTML = `<div class="bws-s__label">Suggested</div>
        <div class="bws-s__chips">${chip(`data-bws-formality="${f.value}"`, FORMALITY[f.value] || '', formalityNow() === f.value)}</div>
        ${why(f.why ? [`<li>${esc(f.why)}</li>`] : [])}`;

      const adj = d.expectation_adjectives;
      if (adj.suggestions.length) {
        const now = adjList().map((w) => w.toLowerCase());
        slot('adjectives').innerHTML = `<div class="bws-s__label">Suggested</div>
          <div class="bws-s__chips">${adj.suggestions.map((w) => chip(`data-bws-adj="${esc(w)}"`, w, now.includes(w.toLowerCase()))).join('')}</div>
          ${why([adj.why && `<li>${esc(adj.why)}</li>`, ...(adj.quotes || []).map((q) => `<li><em>“${esc(q)}”</em></li>`)].filter(Boolean))}`;
      }

      const vals = d.values.suggestions;
      if (vals.length) {
        slot('values').innerHTML = `<div class="bws-s__label">Suggested</div>
          <div class="bws-s__chips">${vals.map((v, i) => chip(`data-bws-value="${i}" title="${esc(v.why)}"`, v.value, inList('values', v.value))).join('')}</div>
          ${why(vals.map((v) => `<li><strong>${esc(v.value)}</strong> — ${esc(v.why)}${v.quote ? ` <em>“${esc(v.quote)}”</em>` : ''}</li>`))}`;
      }

      const emb = d.embrace.suggestions;
      if (emb.length) {
        slot('embrace').innerHTML = `<div class="bws-s__label">You already use</div>
          <div class="bws-s__chips">${emb.map((e, i) => chip(`data-bws-embrace="${i}" title="${esc(e.why)}"`, e.phrase, inList('embrace', e.phrase), site ? '' : `<small>${e.used}×</small>`)).join('')}</div>
          ${why(emb.map((e) => `<li><strong>“${esc(e.phrase)}”</strong> — ${site ? 'on your website' : `in ${e.used} post${e.used === 1 ? '' : 's'}`}. ${esc(e.why)}</li>`))}`;
      }

      const av = d.avoid.suggestions;
      if (av.length) {
        slot('avoid').innerHTML = `<div class="bws-s__label">Consider dropping</div>
          <div class="bws-s__chips">${av.map((a, i) => chip(`data-bws-avoid="${i}" title="${esc(a.why)}"`, a.phrase, inList('avoid', a.phrase))).join('')}</div>
          ${why(av.map((a) => `<li><strong>“${esc(a.phrase)}”</strong>${a.used ? ` — ${site ? 'on your website' : `in ${a.used} post${a.used === 1 ? '' : 's'}`}` : ''}. ${esc(a.why)}</li>`))}`;
      }

      const offs = d.offerings || [];
      if (offs.length && slot('offerings') && typeof form.seAddOffering === 'function') {
        const have = offerNames();
        slot('offerings').innerHTML = `<div class="bws-s__label">Named on your website</div>
          <div class="bws-s__chips">${offs.map((o, i) => chip(`data-bws-offer="${i}" title="${esc(o.note)}"`, o.name, have.includes(o.name.toLowerCase()))).join('')}</div>`;
        form.querySelectorAll('[data-bws-offer]').forEach((b) => b.addEventListener('click', () => {
          if (form.seAddOffering(offs[Number(b.dataset.bwsOffer)])) { markDirty(); renderSlots(); } else toast('The list is full — remove one first', 'warning');
        }));
      }

      form.querySelectorAll('[data-bws-formality]').forEach((b) => b.addEventListener('click', () => { setFormality(Number(b.dataset.bwsFormality)); renderSlots(); }));
      form.querySelectorAll('[data-bws-adj]').forEach((b) => b.addEventListener('click', () => { if (addAdjective(b.dataset.bwsAdj)) renderSlots(); }));
      form.querySelectorAll('[data-bws-value]').forEach((b) => b.addEventListener('click', () => { if (fillList('values', vals[Number(b.dataset.bwsValue)].value)) renderSlots(); }));
      form.querySelectorAll('[data-bws-embrace]').forEach((b) => b.addEventListener('click', () => { if (fillList('embrace', emb[Number(b.dataset.bwsEmbrace)].phrase)) renderSlots(); }));
      form.querySelectorAll('[data-bws-avoid]').forEach((b) => b.addEventListener('click', () => { if (fillList('avoid', av[Number(b.dataset.bwsAvoid)].phrase)) renderSlots(); }));
    }

    // Colours and logo read from the website. The client drops what is wrong; what is kept goes to the Library on Save.
    function keptBrand() {
      const b = (S.data && S.data.from_site && S.data.brand) || null;
      if (!b) return null;
      const colors = (b.colors || []).filter((c) => !S.dropped.has(c));
      const logo = b.logo_url && !S.dropped.has('logo') ? b.logo_url : '';
      return colors.length || logo ? { colors, logo_url: logo } : null;
    }
    form.seKeptBrand = () => keptBrand() || undefined;

    function renderBrand() {
      const box = form.querySelector('#se-bw-brand');
      if (!box) return;
      const b = (S.data && S.data.from_site && !S.busy && S.data.brand) || null;
      const colors = b ? (b.colors || []) : [];
      if (!b || (!colors.length && !b.logo_url)) { box.hidden = true; box.innerHTML = ''; return; }
      const keep = keptBrand();
      box.hidden = false;
      box.innerHTML = `<div class="bws-s__label">Colours and logo on your website</div>
        <div class="bws-brand__row">
          ${b.logo_url && !S.dropped.has('logo') ? `<span class="bws-logo"><img src="${esc(b.logo_url)}" alt="Logo from your website" referrerpolicy="no-referrer" /><button type="button" class="bws-drop" data-bws-drop="logo" aria-label="Not my logo">×</button></span>` : ''}
          ${colors.filter((c) => !S.dropped.has(c)).map((c) => `<span class="bws-swatch"><i style="background:${esc(c)}"></i>${esc(c.toUpperCase())}<button type="button" class="bws-drop" data-bws-drop="${esc(c)}" aria-label="Not a brand colour">×</button></span>`).join('')}
        </div>
        <div class="bws-brand__hint">${keep ? 'Remove anything that is not yours. What is left is added to your Library when you press Save.' : 'Nothing kept. Your Library stays as it is.'}</div>`;
      box.querySelectorAll('[data-bws-drop]').forEach((x) => x.addEventListener('click', () => { S.dropped.add(x.dataset.bwsDrop); renderBrand(); }));
    }

    // An empty worksheet arrives filled from the suggestions (once); nothing is saved until Save.
    function maybeAutoFill() {
      const d = S.data;
      if (S.autoFilled || !d || d.empty || !d.formality || !isEmpty()) return;
      setFormality(d.formality.value);
      fillEmpty(true);
      S.autoFilled = true;
      renderStrip();
    }

    function render() { renderStrip(); renderSlots(); }

    let pending = null;
    form.addEventListener('input', (e) => {
      if (!S.data || !e.target.matches('.se-bw-input, #se-bw-formality')) return;
      clearTimeout(pending);
      pending = setTimeout(renderSlots, 250);
    });

    async function run() {
      S.busy = true; S.error = ''; render();
      try {
        const d = await call('POST', '/api/brand-worksheet/suggestions');
        S.data = d.suggestions || null;
        S.dropped = new Set();
      } catch (e) {
        S.error = e.message || 'Could not analyse your posts';
      } finally {
        S.busy = false; render(); maybeAutoFill();
      }
    }

    form.addEventListener('se-bw-saved', () => { S.autoFilled = false; renderStrip(); });

    render();
    call('GET', '/api/brand-worksheet/suggestions')
      .then((d) => {
        if (d && d.suggestions) { S.data = d.suggestions; render(); maybeAutoFill(); return; }
        if (!isEmpty()) return;
        let tried = false;
        try { tried = sessionStorage.getItem('se-bws-auto') === '1'; sessionStorage.setItem('se-bws-auto', '1'); } catch (_) { /* no storage: still run once per page */ }
        if (!tried) run();
      })
      .catch(() => {});
  }

  global.seMountWorksheetSuggest = function (panel) {
    injectStyles();
    create(panel);
  };
})(window);
