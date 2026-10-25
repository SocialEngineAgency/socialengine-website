'use strict';
// video-coach.js — the Coach on the Video tab.
//
// A small chat above the Generate form. The person says what they want to make, the Coach talks it through
// and, once it has a brief, the brief fills the form below (same path as the Coach → Studio handoff).
// The chat itself is the shared /api/chat/v2 Coach, asked with surface 'video'.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.seVideoCoach = api;
})(this, function () {
  const SUGGESTIONS = [
    'Plan a 10 second ad for my best seller',
    'Give me three hook ideas for a product teaser',
    'Make it feel like a handheld clip a customer would film',
  ];
  const MAX_LOG = 40;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // The brief the Coach wants loaded into the Video form, or null. Anything not meant for the Studio clip
  // form (a poster, an animation) is ignored here.
  function pickVideoBrief(actions) {
    const list = Array.isArray(actions) ? actions : [];
    const hit = list.find((a) => a && a.type === 'create' && String(a.prompt || '').trim()
      && (!a.destination || a.destination === 'studio' || a.destination === 'creation-studio')
      && (!a.mode || a.mode === 'video'));
    return hit ? Object.assign({}, hit, { mode: 'video', destination: 'studio' }) : null;
  }

  function logStore() {
    if (typeof window === 'undefined') return [];
    if (!Array.isArray(window.__SE_VS_COACH_LOG)) window.__SE_VS_COACH_LOG = [];
    return window.__SE_VS_COACH_LOG;
  }

  function replyHtml(text) {
    if (typeof window !== 'undefined' && typeof window.formatCoachReplyHtml === 'function') return window.formatCoachReplyHtml(text);
    return `<p style="margin:0;line-height:1.55;">${esc(text).replace(/\n/g, '<br>')}</p>`;
  }

  function bubbleHtml(m) {
    if (m.role === 'user') {
      return `<div class="vsc-row vsc-user"><div class="vsc-bubble">${esc(m.text)}</div></div>`;
    }
    const loaded = m.loaded ? '<div class="vsc-loaded">Brief loaded in the form below. Check it, then Generate.</div>' : '';
    const again = m.brief && !m.loaded
      ? `<button type="button" class="vsc-btn" data-vsc-load="${m.idx}">Use this brief</button>` : '';
    return `<div class="vsc-row"><div class="vsc-bubble">${replyHtml(m.text)}${loaded}${again}</div></div>`;
  }

  function panelHtml(log, opts) {
    const o = opts || {};
    const rows = (log || []).map((m, i) => bubbleHtml(Object.assign({ idx: i }, m))).join('');
    const typing = o.busy ? '<div class="vsc-row"><div class="vsc-bubble vsc-typing" aria-live="polite">Thinking it through…</div></div>' : '';
    const chips = !(log || []).length
      ? `<div class="vsc-chips">${SUGGESTIONS.map((s) => `<button type="button" class="vsc-chip" data-vsc-chip="${esc(s)}">${esc(s)}</button>`).join('')}</div>`
      : '';
    return `
      <style>
        .vsc { border: 1px solid rgba(167,139,250,0.28); border-radius: 14px; background: linear-gradient(180deg, rgba(124,58,237,0.08), rgba(255,255,255,0.015)); margin: 0 0 18px; }
        .vsc > summary { list-style: none; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; }
        .vsc > summary::-webkit-details-marker { display: none; }
        .vsc-title { font-family: var(--font-display); font-size: 0.95rem; font-weight: 700; color: #fff; }
        .vsc-sub { font-size: 0.74rem; color: rgba(255,255,255,0.5); margin-top: 2px; }
        .vsc-body { padding: 0 16px 16px; }
        .vsc-log { max-height: 280px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
        .vsc-row { display: flex; }
        .vsc-user { justify-content: flex-end; }
        .vsc-bubble { max-width: 86%; padding: 10px 13px; border-radius: 12px; background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.88); font-size: 0.82rem; }
        .vsc-user .vsc-bubble { background: rgba(124,58,237,0.28); color: #F3E8FF; }
        .vsc-typing { color: rgba(255,255,255,0.5); font-style: italic; }
        .vsc-loaded { margin-top: 8px; font-size: 0.72rem; font-weight: 600; color: #6EE7B7; }
        .vsc-btn { margin-top: 10px; padding: 7px 12px; border-radius: 8px; border: 1px solid rgba(167,139,250,0.5); background: rgba(124,58,237,0.2); color: #F3E8FF; font-size: 0.74rem; font-weight: 700; cursor: pointer; }
        .vsc-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
        .vsc-chip { padding: 7px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.7); font-size: 0.74rem; cursor: pointer; text-align: left; }
        .vsc-chip:hover, .vsc-btn:hover { border-color: rgba(167,139,250,0.6); color: #fff; }
        .vsc-form { display: flex; gap: 8px; align-items: flex-end; }
        .vsc-input { flex: 1; min-height: 40px; max-height: 120px; resize: vertical; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.25); color: #fff; font-size: 0.82rem; font-family: var(--font-body); }
        .vsc-send { padding: 10px 16px; border-radius: 10px; border: none; background: linear-gradient(135deg, #7C3AED, #A78BFA); color: #fff; font-weight: 700; font-size: 0.8rem; cursor: pointer; }
        .vsc-send:disabled, .vsc-input:disabled { opacity: 0.5; cursor: default; }
        .vsc :focus-visible { outline: 2px solid #A78BFA; outline-offset: 2px; }
      </style>
      <details class="vsc" id="vsc-details"${o.open === false ? '' : ' open'}>
        <summary>
          <span><span class="vsc-title">Ask the Coach</span><div class="vsc-sub">Talk through the idea and the Coach fills in the form below.</div></span>
          <span aria-hidden="true" style="opacity:0.45;font-size:0.65rem;">▸</span>
        </summary>
        <div class="vsc-body">
          ${chips}
          <div class="vsc-log" id="vsc-log" role="log" aria-live="polite">${rows}${typing}</div>
          <div class="vsc-form">
            <textarea class="vsc-input" id="vsc-input" rows="1" aria-label="Message the Coach" placeholder="What video do you want to make?"${o.busy ? ' disabled' : ''}></textarea>
            <button type="button" class="vsc-send" id="vsc-send"${o.busy ? ' disabled' : ''}>Send</button>
          </div>
        </div>
      </details>`;
  }

  let sending = false;

  function defaults() {
    const w = typeof window !== 'undefined' ? window : {};
    return {
      post: (body) => w.apiFetch(`${typeof API !== 'undefined' ? API : ''}/api/chat/v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(90000) : undefined,
      }),
      loadBrief: (brief) => {
        const normalize = typeof w.normalizeCoachCreateSession === 'function' ? w.normalizeCoachCreateSession : (x) => x;
        w.__SE_COACH_CREATE_SESSION = normalize(brief);
        return typeof w.applyCoachCreateSessionIfAny === 'function' ? w.applyCoachCreateSessionIfAny() : false;
      },
      toast: (m, t) => { if (typeof w.showToast === 'function') w.showToast(m, t); },
    };
  }

  // Ask the Coach one thing. Returns { reply, brief } and records both sides in the log.
  async function ask(message, deps) {
    const d = Object.assign(defaults(), deps || {});
    const text = String(message || '').trim();
    if (!text) return null;
    const log = logStore();
    log.push({ role: 'user', text });
    const res = await d.post({ message: text, surface: 'video' });
    if (!res || !res.ok) throw new Error('The Coach could not answer just now. Try again in a moment.');
    const data = await res.json().catch(() => ({}));
    const reply = String(data.reply || 'Got it.');
    const brief = pickVideoBrief(data.coach_actions);
    const entry = { role: 'assistant', text: reply, brief: brief || null, loaded: false };
    if (brief) entry.loaded = !!d.loadBrief(brief);
    log.push(entry);
    while (log.length > MAX_LOG) log.shift();
    return { reply, brief, loaded: entry.loaded };
  }

  function mount(deps) {
    if (typeof document === 'undefined') return false;
    const host = document.getElementById('vs-coach');
    if (!host) return false;
    const d = Object.assign(defaults(), deps || {});
    const paint = (busy) => {
      const open = document.getElementById('vsc-details');
      host.innerHTML = panelHtml(logStore(), { busy, open: open ? open.open : window.__SE_VS_COACH_OPEN !== false });
      const det = document.getElementById('vsc-details');
      if (det) det.addEventListener('toggle', () => { window.__SE_VS_COACH_OPEN = det.open; });
      const logEl = document.getElementById('vsc-log');
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
      bind();
    };
    const send = async (preset) => {
      const input = document.getElementById('vsc-input');
      const text = String(preset || (input && input.value) || '').trim();
      if (!text || sending) return;
      sending = true;
      const log = logStore();
      log.push({ role: 'user', text });
      paint(true);
      try {
        log.pop();
        await ask(text, d);
      } catch (e) {
        logStore().push({ role: 'assistant', text: (e && e.message) || 'The Coach could not answer just now.' });
      } finally {
        sending = false;
        paint(false);
        const again = document.getElementById('vsc-input');
        if (again) again.focus();
      }
    };
    function bind() {
      const input = document.getElementById('vsc-input');
      const btn = document.getElementById('vsc-send');
      if (btn) btn.addEventListener('click', () => send());
      if (input) input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      });
      host.querySelectorAll('[data-vsc-chip]').forEach((el) => el.addEventListener('click', () => send(el.getAttribute('data-vsc-chip'))));
      host.querySelectorAll('[data-vsc-load]').forEach((el) => el.addEventListener('click', () => {
        const m = logStore()[Number(el.getAttribute('data-vsc-load'))];
        if (m && m.brief && d.loadBrief(m.brief)) { m.loaded = true; d.toast('Coach brief loaded. Review it, then Generate.'); paint(false); }
      }));
    }
    paint(false);
    return true;
  }

  return { SUGGESTIONS, pickVideoBrief, panelHtml, ask, mount, logStore };
});
