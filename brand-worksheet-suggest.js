/* Brand worksheet suggestions: analyses the client's last 12 months of posts and
   offers one-click answers beside each worksheet question. Nothing saves until
   the user presses the worksheet's own Save button.
   window.seMountWorksheetSuggest(panel) — panel contains #se-brand-worksheet and #se-bw-suggest. */
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
      .se-bw-wrap { display: grid; grid-template-columns: minmax(0, 800px) minmax(280px, 360px); gap: 16px; align-items: start; margin: 0 0 24px; }
      .se-bw-wrap .se-bw { margin: 0; }
      @media (max-width: 1100px) { .se-bw-wrap { grid-template-columns: 1fr; } }
      .bws { background: rgba(124,58,237,0.05); border: 1px solid rgba(124,58,237,0.25); border-radius: 12px; padding: 16px 18px; font-size: 0.78rem; color: rgba(226,232,240,0.9); position: sticky; top: 16px; }
      .bws__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .bws__title { margin: 0; font-size: 0.9rem; font-weight: 700; color: #fff; }
      .bws__link { background: none; border: none; color: #A78BFA; font-size: 0.72rem; font-weight: 600; cursor: pointer; padding: 0; width: auto; }
      .bws__meta { font-size: 0.68rem; color: rgba(148,163,184,0.75); margin: 4px 0 8px; line-height: 1.4; }
      .bws__summary { margin: 0 0 6px; line-height: 1.5; }
      .bws__sec { border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px; margin-top: 10px; }
      .bws__q { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(167,139,250,0.9); margin-bottom: 6px; }
      .bws__why { font-size: 0.7rem; color: rgba(148,163,184,0.85); line-height: 1.45; margin-top: 4px; }
      .bws__quote { font-size: 0.7rem; color: rgba(226,232,240,0.7); font-style: italic; margin-top: 3px; }
      .bws__chips { display: flex; flex-wrap: wrap; gap: 5px; }
      .bws__chip { padding: 4px 9px; border-radius: 14px; border: 1px solid rgba(124,58,237,0.35); background: rgba(124,58,237,0.1); color: #DDD6FE; font-size: 0.72rem; font-weight: 600; cursor: pointer; width: auto; font-family: inherit; }
      .bws__chip[disabled] { opacity: 0.45; cursor: default; }
      .bws__chip small { font-weight: 500; opacity: 0.7; margin-left: 3px; }
      .bws__item { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 8px; }
      .bws__item > div { flex: 1; min-width: 0; }
      .bws__item strong { color: #fff; font-weight: 600; }
      .bws__use { padding: 3px 9px; border-radius: 6px; border: 1px solid rgba(124,58,237,0.4); background: transparent; color: #C4B5FD; font-size: 0.68rem; font-weight: 700; cursor: pointer; width: auto; flex-shrink: 0; font-family: inherit; }
      .bws__use[disabled] { opacity: 0.45; cursor: default; }
      .bws__cta { width: 100%; margin-top: 12px; padding: 8px 12px; border-radius: 8px; border: none; background: #7C3AED; color: #fff; font-weight: 700; font-size: 0.76rem; cursor: pointer; font-family: inherit; }
      .bws__cta[disabled] { opacity: 0.6; cursor: default; }
      .bws__note { font-size: 0.68rem; color: #FCD34D; margin-top: 8px; line-height: 1.4; }
      .bws__stats { font-size: 0.66rem; color: rgba(148,163,184,0.7); margin-top: 10px; line-height: 1.5; }
      .se-bw-input.bws-filled, .se-bw__range.bws-filled { box-shadow: 0 0 0 2px rgba(167,139,250,0.55); }
    `;
    document.head.appendChild(st);
  }

  function create(panel) {
    const box = panel.querySelector('#se-bw-suggest');
    const form = panel.querySelector('#se-brand-worksheet');
    if (!box || !form) return;
    const S = { data: null, busy: false, error: '' };

    const listInputs = (key) => [...form.querySelectorAll(`[data-bw-list="${key}"]`)];
    const adjInput = () => form.querySelector('#se-bw-adjectives');
    const adjList = () => String(adjInput()?.value || '').split(',').map((s) => s.trim()).filter(Boolean);
    const inList = (key, v) => listInputs(key).some((i) => i.value.trim().toLowerCase() === String(v).toLowerCase());

    function mark(el) {
      if (!el) return;
      el.classList.add('bws-filled');
      setTimeout(() => el.classList.remove('bws-filled'), 1600);
      const save = form.querySelector('#se-bw-save');
      if (save && !save.dataset.bwsDirty) { save.dataset.bwsDirty = '1'; save.textContent = 'Save changes'; }
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
      const slot = listInputs(key).find((i) => !i.value.trim());
      if (!slot) { toast('All three boxes are full — clear one first', 'warning'); return false; }
      slot.value = value;
      mark(slot);
      return true;
    }

    function fillEmpty() {
      const d = S.data;
      let n = 0;
      if (!adjList().length) d.expectation_adjectives.suggestions.slice(0, 5).forEach((w) => { if (addAdjective(w)) n += 1; });
      for (const v of d.values.suggestions) { if (listInputs('values').some((i) => !i.value.trim()) && !inList('values', v.value)) { fillList('values', v.value); n += 1; } }
      for (const e of d.embrace.suggestions) { if (listInputs('embrace').some((i) => !i.value.trim()) && !inList('embrace', e.phrase)) { fillList('embrace', e.phrase); n += 1; } }
      for (const a of d.avoid.suggestions) { if (listInputs('avoid').some((i) => !i.value.trim()) && !inList('avoid', a.phrase)) { fillList('avoid', a.phrase); n += 1; } }
      toast(n ? `Filled ${n} empty box${n === 1 ? '' : 'es'} — check them, then press Save` : 'Nothing empty to fill');
      render();
    }

    function metaLine(d) {
      const b = d.based_on || {};
      const fmt = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
      const parts = [`${b.posts || 0} posts`];
      if (b.from && b.to) parts.push(`${fmt(b.from)} – ${fmt(b.to)}`);
      if ((d.sources || []).length) parts.push(d.sources.join(' + '));
      if (b.confidence) parts.push(`${b.confidence} confidence`);
      if (b.engagement_weighted) parts.push('weighted to your best posts');
      return parts.join(' · ');
    }

    function render() {
      const d = S.data;
      if (S.busy) {
        box.innerHTML = `<div class="bws__head"><h4 class="bws__title">Suggestions from your posts</h4></div>
          <p class="bws__meta">Reading your last 12 months of posts… this takes 20–40 seconds.</p>`;
        return;
      }
      if (!d || (!d.empty && !d.formality)) {
        box.innerHTML = `<div class="bws__head"><h4 class="bws__title">Not sure what to write?</h4></div>
          <p class="bws__summary">We'll read your last 12 months of posts — Instagram and anything made here — and suggest answers for each question, with real examples from your captions.</p>
          ${S.error ? `<div class="bws__note">${esc(S.error)}</div>` : ''}
          <button type="button" class="bws__cta" id="bws-run">Analyse my posts</button>`;
        box.querySelector('#bws-run').addEventListener('click', run);
        return;
      }
      if (d.empty) {
        box.innerHTML = `<div class="bws__head"><h4 class="bws__title">Suggestions from your posts</h4><button type="button" class="bws__link" id="bws-run">Try again</button></div>
          <p class="bws__summary">${esc(d.message)}</p>
          ${(d.notes || []).map((n) => `<div class="bws__note">${esc(n)}</div>`).join('')}`;
        box.querySelector('#bws-run').addEventListener('click', run);
        return;
      }
      const adjNow = adjList().map((w) => w.toLowerCase());
      const st = d.stats || {};
      box.innerHTML = `
        <div class="bws__head"><h4 class="bws__title">Suggestions from your posts</h4><button type="button" class="bws__link" id="bws-run">Re-analyse</button></div>
        <div class="bws__meta">${esc(metaLine(d))}</div>
        ${d.summary ? `<p class="bws__summary">${esc(d.summary)}</p>` : ''}
        ${S.error ? `<div class="bws__note">${esc(S.error)}</div>` : ''}

        <div class="bws__sec" data-bws="formality">
          <div class="bws__q">How formal?</div>
          <div class="bws__item"><div><strong>${esc(FORMALITY[d.formality.value] || '')}</strong></div>
            <button type="button" class="bws__use" data-bws-formality="${d.formality.value}">Use</button></div>
          ${d.formality.why ? `<div class="bws__why">${esc(d.formality.why)}</div>` : ''}
        </div>

        ${d.expectation_adjectives.suggestions.length ? `<div class="bws__sec" data-bws="adjectives">
          <div class="bws__q">People expect us to sound…</div>
          <div class="bws__chips">${d.expectation_adjectives.suggestions.map((w) => `<button type="button" class="bws__chip" data-bws-adj="${esc(w)}" ${adjNow.includes(w.toLowerCase()) ? 'disabled' : ''}>+ ${esc(w)}</button>`).join('')}</div>
          ${d.expectation_adjectives.why ? `<div class="bws__why">${esc(d.expectation_adjectives.why)}</div>` : ''}
          ${(d.expectation_adjectives.quotes || []).map((q) => `<div class="bws__quote">“${esc(q)}”</div>`).join('')}
        </div>` : ''}

        ${d.values.suggestions.length ? `<div class="bws__sec" data-bws="values">
          <div class="bws__q">Our 3 values</div>
          ${d.values.suggestions.map((v, i) => `<div class="bws__item"><div><strong>${esc(v.value)}</strong>
              ${v.why ? `<div class="bws__why">${esc(v.why)}</div>` : ''}
              ${v.quote ? `<div class="bws__quote">“${esc(v.quote)}”</div>` : ''}</div>
            <button type="button" class="bws__use" data-bws-value="${i}" ${inList('values', v.value) ? 'disabled' : ''}>${inList('values', v.value) ? 'Added' : 'Use'}</button></div>`).join('')}
        </div>` : ''}

        ${d.embrace.suggestions.length ? `<div class="bws__sec" data-bws="embrace">
          <div class="bws__q">Phrases you already use</div>
          ${d.embrace.suggestions.map((e, i) => `<div class="bws__item"><div><strong>“${esc(e.phrase)}”</strong> <span class="bws__why">in ${e.used} post${e.used === 1 ? '' : 's'}</span>
              ${e.why ? `<div class="bws__why">${esc(e.why)}</div>` : ''}</div>
            <button type="button" class="bws__use" data-bws-embrace="${i}" ${inList('embrace', e.phrase) ? 'disabled' : ''}>${inList('embrace', e.phrase) ? 'Added' : 'Use'}</button></div>`).join('')}
        </div>` : ''}

        ${d.avoid.suggestions.length ? `<div class="bws__sec" data-bws="avoid">
          <div class="bws__q">Phrases to drop</div>
          ${d.avoid.suggestions.map((a, i) => `<div class="bws__item"><div><strong>“${esc(a.phrase)}”</strong>${a.used ? ` <span class="bws__why">in ${a.used} post${a.used === 1 ? '' : 's'}</span>` : ''}
              ${a.why ? `<div class="bws__why">${esc(a.why)}</div>` : ''}</div>
            <button type="button" class="bws__use" data-bws-avoid="${i}" ${inList('avoid', a.phrase) ? 'disabled' : ''}>${inList('avoid', a.phrase) ? 'Added' : 'Use'}</button></div>`).join('')}
        </div>` : ''}

        <button type="button" class="bws__cta" id="bws-fill">Fill empty boxes with these</button>
        ${(d.notes || []).map((n) => `<div class="bws__note">${esc(n)}</div>`).join('')}
        ${st.posts ? `<div class="bws__stats">Your captions: ~${st.avg_caption_chars} characters · ${st.emoji_per_post} emoji per post · ${Math.round((st.question_share || 0) * 100)}% ask a question · ${st.hashtags_per_post} hashtags per post</div>` : ''}
      `;
      box.querySelector('#bws-run').addEventListener('click', run);
      box.querySelector('#bws-fill').addEventListener('click', fillEmpty);
      box.querySelectorAll('[data-bws-formality]').forEach((b) => b.addEventListener('click', () => setFormality(Number(b.dataset.bwsFormality))));
      box.querySelectorAll('[data-bws-adj]').forEach((b) => b.addEventListener('click', () => { if (addAdjective(b.dataset.bwsAdj)) render(); }));
      box.querySelectorAll('[data-bws-value]').forEach((b) => b.addEventListener('click', () => { if (fillList('values', d.values.suggestions[Number(b.dataset.bwsValue)].value)) render(); }));
      box.querySelectorAll('[data-bws-embrace]').forEach((b) => b.addEventListener('click', () => { if (fillList('embrace', d.embrace.suggestions[Number(b.dataset.bwsEmbrace)].phrase)) render(); }));
      box.querySelectorAll('[data-bws-avoid]').forEach((b) => b.addEventListener('click', () => { if (fillList('avoid', d.avoid.suggestions[Number(b.dataset.bwsAvoid)].phrase)) render(); }));
    }

    async function run() {
      S.busy = true; S.error = ''; render();
      try {
        const d = await call('POST', '/api/brand-worksheet/suggestions');
        S.data = d.suggestions || null;
      } catch (e) {
        S.error = e.message || 'Could not analyse your posts';
      } finally {
        S.busy = false; render();
      }
    }

    render();
    call('GET', '/api/brand-worksheet/suggestions')
      .then((d) => { if (d && d.suggestions) { S.data = d.suggestions; render(); } })
      .catch(() => {});
  }

  global.seMountWorksheetSuggest = function (panel) {
    injectStyles();
    create(panel);
  };
})(window);
