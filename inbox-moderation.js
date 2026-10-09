/* Inbox moderation assist (P3.4): hidden-words list + sync guide for Instagram / Facebook.
   window.openHiddenWordsModal() — loads GET /api/inbox/hide-keywords, saves with PUT. */
(function () {
  'use strict';

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function api(path, opts = {}) {
    const se = window.seApi || {};
    const base = window.API || window._seAPI || '';
    const headers = Object.assign({}, typeof se.headers === 'function' ? se.headers() : {}, opts.body ? { 'Content-Type': 'application/json' } : {});
    return fetch(`${base}${path}`, Object.assign({}, opts, { headers }))
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        return data;
      });
  }

  function injectStyles() {
    if (document.getElementById('hw-styles')) return;
    const st = document.createElement('style');
    st.id = 'hw-styles';
    st.textContent = `
      .hw-overlay { position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 16px; }
      .hw-modal { background: linear-gradient(135deg,#0f1a2e,#162237); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; width: min(640px, 100%); max-height: 90vh; overflow: auto; padding: 24px; color: #E2E8F0; font-family: var(--font-body, Inter, sans-serif); box-shadow: 0 24px 80px rgba(0,0,0,0.5); }
      .hw-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
      .hw-head h3 { margin: 0; font-size: 1.1rem; color: #fff; }
      .hw-x { background: none; border: none; color: rgba(148,163,184,0.7); font-size: 1.3rem; cursor: pointer; }
      .hw-lead { font-size: 0.8rem; color: rgba(148,163,184,0.85); margin: 0 0 14px; line-height: 1.5; }
      .hw-modal textarea { width: 100%; min-height: 110px; box-sizing: border-box; padding: 10px 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; font-size: 0.85rem; font-family: inherit; resize: vertical; }
      .hw-row { display: flex; gap: 8px; align-items: center; margin: 8px 0 16px; flex-wrap: wrap; }
      .hw-count { font-size: 0.72rem; color: rgba(148,163,184,0.7); margin-right: auto; }
      .hw-btn { padding: 8px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #E2E8F0; font-size: 0.78rem; font-weight: 600; cursor: pointer; font-family: inherit; width: auto; }
      .hw-btn--primary { background: linear-gradient(135deg,#7C3AED,#6D28D9); border: none; color: #fff; }
      .hw-btn:disabled { opacity: 0.5; cursor: default; }
      .hw-steps { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      @media (max-width: 600px) { .hw-steps { grid-template-columns: 1fr; } }
      .hw-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 12px 14px; }
      .hw-card h4 { margin: 0 0 6px; font-size: 0.8rem; color: #fff; }
      .hw-card ol { margin: 0; padding-left: 18px; font-size: 0.74rem; line-height: 1.5; color: rgba(226,232,240,0.85); }
      .hw-note { font-size: 0.7rem; color: rgba(148,163,184,0.7); margin-top: 12px; line-height: 1.45; }
      .hw-err { color: #F87171; font-size: 0.75rem; margin-top: 6px; }
    `;
    document.head.appendChild(st);
  }

  const S = { keywords: [], guide: null, max: 100, busy: false, error: '' };

  function close() {
    const el = document.getElementById('hw-root');
    if (el) el.remove();
  }

  function render() {
    const root = document.getElementById('hw-root');
    if (!root) return;
    const g = S.guide || { instagram: [], facebook: [], note: '', copy_text: '' };
    root.innerHTML = `
      <div class="hw-modal" role="dialog" aria-label="Hidden words">
        <div class="hw-head"><h3>Hidden words</h3><button type="button" class="hw-x" id="hw-close" aria-label="Close">×</button></div>
        <p class="hw-lead">Words or phrases you never want under your posts — spam, scams, slurs, competitor links. One per line or comma-separated. SocialEngine flags matching comments and never auto-replies to them. To actually hide them, copy the list into Instagram and Facebook (steps below).</p>
        <textarea id="hw-text" placeholder="crypto, dm me for collab, bit.ly">${esc(S.keywords.join('\n'))}</textarea>
        <div class="hw-row">
          <span class="hw-count" id="hw-count">${S.keywords.length}/${S.max} saved</span>
          <button type="button" class="hw-btn" id="hw-copy" ${S.keywords.length ? '' : 'disabled'}>Copy list</button>
          <button type="button" class="hw-btn hw-btn--primary" id="hw-save" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Saving…' : 'Save'}</button>
        </div>
        ${S.error ? `<div class="hw-err">${esc(S.error)}</div>` : ''}
        <div class="hw-steps">
          <div class="hw-card"><h4>Instagram</h4><ol>${g.instagram.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>
          <div class="hw-card"><h4>Facebook Page</h4><ol>${g.facebook.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>
        </div>
        <div class="hw-note">${esc(g.note)}</div>
      </div>`;
    root.querySelector('#hw-close').addEventListener('click', close);
    root.querySelector('#hw-save').addEventListener('click', save);
    root.querySelector('#hw-copy').addEventListener('click', copy);
  }

  async function copy() {
    const text = (S.guide && S.guide.copy_text) || S.keywords.join(', ');
    try {
      await navigator.clipboard.writeText(text);
      if (typeof window.showToast === 'function') window.showToast('Copied — paste it into Hidden Words');
    } catch (_) {
      if (typeof window.showToast === 'function') window.showToast('Could not copy — select the list and copy it', 'warning');
    }
  }

  async function save() {
    const raw = (document.getElementById('hw-text') || {}).value || '';
    S.busy = true; S.error = ''; render();
    try {
      const d = await api('/api/inbox/hide-keywords', { method: 'PUT', body: JSON.stringify({ keywords: raw }) });
      S.keywords = d.keywords || []; S.guide = d.guide; S.max = d.max || S.max;
      if (typeof window.showToast === 'function') window.showToast('Hidden words saved');
      if (typeof window.onHiddenWordsChanged === 'function') window.onHiddenWordsChanged(S.keywords);
    } catch (e) {
      S.error = e.message || 'Could not save';
    } finally {
      S.busy = false; render();
    }
  }

  async function openHiddenWordsModal() {
    injectStyles();
    close();
    const root = document.createElement('div');
    root.id = 'hw-root';
    root.className = 'hw-overlay';
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    document.body.appendChild(root);
    S.error = '';
    root.innerHTML = '<div class="hw-modal"><p class="hw-lead">Loading…</p></div>';
    try {
      const d = await api('/api/inbox/hide-keywords');
      S.keywords = d.keywords || []; S.guide = d.guide; S.max = d.max || S.max;
    } catch (e) {
      S.error = e.message || 'Could not load hidden words';
    }
    render();
  }

  window.openHiddenWordsModal = openHiddenWordsModal;
})();
