'use strict';
// create-coach-thread.js — which chat the Coach in each Create tab talks in.
//
// Each tab (Post, Carousels, Video) has a chat of its own, so a post is never answered from a carousel conversation.
// The first time, the server makes the tab's chat (a "Posts", "Carousels" or "Videos" project); after that the chat
// picked here is remembered per tab. The picker lists every project and chat, and can start a new chat. Picking one
// here never changes the chat open on the main Coach page.
//
//   seCreateCoachThread.ensure(tab)            → { projectId, threadId, projectName, threadName }
//   seCreateCoachThread.current(tab)           → the same, or null before ensure
//   seCreateCoachThread.fromReply(tab, data)   → keep what the chat reply says it used
//   seCreateCoachThread.mountPicker(el, tab, onChange)
//   seCreateCoachThread.messages(threadId)     → [{ role, content }] from the server

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.seCreateCoachThread = api;
})(this, function () {
  const TABS = { post: 'Posts', carousel: 'Carousels', video: 'Videos' };
  const memo = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function who() {
    const w = typeof window !== 'undefined' ? window : {};
    return String(w.__clientEmail || w.clientEmail || w._seEmail || 'me').toLowerCase();
  }
  function key(tab) { return `se_create_chat_${who()}_${tab}`; }
  function apiBase() {
    const w = typeof window !== 'undefined' ? window : {};
    return (typeof w.API !== 'undefined' && w.API) || w._seAPI || '';
  }
  async function call(path, init) {
    const w = typeof window !== 'undefined' ? window : {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, (w.seApi && typeof w.seApi.headers === 'function') ? w.seApi.headers() : {});
    const res = await fetch(`${apiBase()}${path}`, Object.assign({ headers }, init || {}));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Could not load the chats'); e.status = res.status; throw e; }
    return data;
  }
  function tabOf(tab) { return TABS[tab] ? tab : 'post'; }

  function read(tab) {
    if (memo[tab]) return memo[tab];
    try {
      const v = JSON.parse(localStorage.getItem(key(tab)) || 'null');
      if (v && v.threadId) memo[tab] = v;
    } catch (_) { /* storage is a convenience */ }
    return memo[tab] || null;
  }
  function write(tab, sel) {
    memo[tab] = sel;
    try { localStorage.setItem(key(tab), JSON.stringify(sel)); } catch (_) { /* storage is a convenience */ }
    return sel;
  }

  function current(tab) { return read(tabOf(tab)); }

  /** Pick a chat for this tab (from the picker, or a hand-off from the main Coach that continues a chat). */
  function set(tab, sel) {
    if (!sel || !sel.threadId) return null;
    return write(tabOf(tab), { projectId: sel.projectId || '', threadId: sel.threadId, projectName: sel.projectName || '', threadName: sel.threadName || '' });
  }

  /** The tab's chat: the one picked before when it still exists, else the tab's own chat (made the first time). */
  async function ensure(tab) {
    const t = tabOf(tab);
    const have = read(t);
    if (have) {
      try {
        const d = await call(`/api/workspace/threads/${encodeURIComponent(have.threadId)}`);
        return write(t, { projectId: d.project.id, threadId: d.thread.id, projectName: d.project.name, threadName: d.thread.name });
      } catch (e) {
        if (e.status && e.status !== 404) return have; // offline or a hiccup: keep the pick
      }
    }
    const d = await call('/api/workspace/surface-thread', { method: 'POST', body: JSON.stringify({ tab: t }) });
    return write(t, { projectId: d.project.id, threadId: d.thread.id, projectName: d.project.name, threadName: d.thread.name });
  }

  /**
   * The chat the reply was saved in (the server may have made the tab's chat). sentTo: the chat the message was sent
   * in; when another chat has been picked since, the pick stands.
   */
  function fromReply(tab, data, sentTo) {
    if (!data || !data.threadId) return current(tab);
    const t = tabOf(tab);
    const was = read(t) || {};
    if (sentTo && was.threadId && was.threadId !== sentTo) return was;
    return write(t, {
      projectId: data.projectId || was.projectId || '',
      threadId: data.threadId,
      projectName: (data.project && data.project.name) || (was.threadId === data.threadId ? was.projectName : '') || '',
      threadName: (data.thread && data.thread.name) || (was.threadId === data.threadId ? was.threadName : '') || '',
    });
  }

  async function messages(threadId) {
    if (!threadId) return [];
    try {
      const d = await call(`/api/workspace/threads/${encodeURIComponent(threadId)}`);
      return Array.isArray(d.thread && d.thread.messages) ? d.thread.messages : [];
    } catch (_) { return []; }
  }

  function label(sel) {
    return sel ? `${sel.projectName || 'Project'} · ${sel.threadName || 'Chat'}` : 'Loading chat…';
  }

  const BTN = 'display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.8);font-size:0.72rem;font-weight:600;cursor:pointer;font-family:var(--font-body);';
  const MENU = 'position:absolute;z-index:60;top:calc(100% + 6px);right:0;min-width:240px;max-width:320px;max-height:360px;overflow:auto;padding:6px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:#16131f;box-shadow:0 12px 32px rgba(0,0,0,0.45);';
  const ITEM = 'display:block;width:100%;text-align:left;padding:7px 9px;border:none;border-radius:7px;background:transparent;color:rgba(255,255,255,0.82);font-size:0.74rem;cursor:pointer;font-family:var(--font-body);';

  /**
   * The chat picker: a button with the chat's name, and a menu of every project's chats plus "New chat".
   * onChange(sel) runs after a different chat is picked (or a new one is started).
   */
  function mountPicker(el, tab, onChange, { busy = () => false } = {}) {
    if (!el || typeof document === 'undefined') return null;
    const t = tabOf(tab);
    el.style.position = 'relative';
    el.innerHTML = `<button type="button" class="se-cc-pick" data-se-cc-pick aria-haspopup="listbox" aria-expanded="false" title="Which chat the Coach here talks in" style="${BTN}">`
      + '<span style="opacity:0.55;">Chat:</span> <span data-se-cc-label style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span><span aria-hidden="true" style="opacity:0.5;">▾</span></button>';
    const btn = el.querySelector('[data-se-cc-pick]');
    const paintLabel = () => { el.querySelector('[data-se-cc-label]').textContent = label(current(t)); };
    let menu = null;
    const close = () => {
      if (menu) { menu.remove(); menu = null; }
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', outside, true);
      document.removeEventListener('keydown', onKey, true);
    };
    const outside = (e) => { if (menu && !el.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { close(); btn.focus(); } };
    const choose = async (sel) => {
      close();
      const was = current(t);
      set(t, sel);
      paintLabel();
      if (!was || was.threadId !== sel.threadId) { try { await onChange(current(t)); } catch (_) { /* the caller reports */ } }
    };
    const open = async () => {
      if (menu) { close(); return; }
      // A message being answered belongs to this chat: switching now would show its reply in another one.
      if (busy()) {
        btn.title = 'Wait for the Coach to answer, then switch chats';
        btn.animate && btn.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], { duration: 220 });
        return;
      }
      menu = document.createElement('div');
      menu.className = 'se-cc-menu';
      menu.setAttribute('role', 'listbox');
      menu.style.cssText = MENU;
      menu.innerHTML = '<div style="padding:8px;font-size:0.72rem;color:rgba(255,255,255,0.5);">Loading chats…</div>';
      el.appendChild(menu);
      btn.setAttribute('aria-expanded', 'true');
      document.addEventListener('click', outside, true);
      document.addEventListener('keydown', onKey, true);
      let list = null;
      try { list = await call('/api/workspace/projects'); } catch (e) {
        if (menu) menu.innerHTML = `<div style="padding:8px;font-size:0.72rem;color:#FCA5A5;">${esc(e.message)}</div>`;
        return;
      }
      if (!menu) return;
      const sel = current(t) || {};
      const projects = Array.isArray(list.projects) ? list.projects : [];
      const here = projects.find((p) => p.id === sel.projectId);
      menu.innerHTML = projects.map((p) => `<div style="padding:6px 9px 3px;font-size:0.64rem;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.42);">${esc(p.name)}</div>`
        + (() => {
          // Most recent first; the chat open here is always listed.
          const all = (p.threads || []).slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
          const shown = all.slice(0, 10);
          const mine = all.find((th) => th.id === sel.threadId);
          if (mine && !shown.includes(mine)) shown.push(mine);
          return shown;
        })().map((th) => {
          const on = th.id === sel.threadId;
          return `<button type="button" role="option" aria-selected="${on}" data-se-cc-thread="${esc(th.id)}" data-se-cc-project="${esc(p.id)}" data-se-cc-pname="${esc(p.name)}" data-se-cc-tname="${esc(th.name)}" style="${ITEM}${on ? 'background:rgba(124,58,237,0.25);color:#fff;' : ''}">${esc(th.name)}${th.messageCount ? `<span style="opacity:0.45;"> · ${th.messageCount}</span>` : ''}</button>`;
        }).join('')).join('')
        + `<div style="border-top:1px solid rgba(255,255,255,0.08);margin-top:6px;padding-top:6px;"><button type="button" data-se-cc-new style="${ITEM}color:#C4B5FD;font-weight:700;">+ New chat${here ? ` in ${esc(here.name)}` : ''}</button></div>`;
      menu.querySelectorAll('[data-se-cc-thread]').forEach((b) => b.addEventListener('click', () => choose({
        projectId: b.getAttribute('data-se-cc-project'), threadId: b.getAttribute('data-se-cc-thread'),
        projectName: b.getAttribute('data-se-cc-pname'), threadName: b.getAttribute('data-se-cc-tname'),
      })));
      menu.querySelector('[data-se-cc-new]').addEventListener('click', async () => {
        try {
          const projectId = here ? here.id : (await ensure(t)).projectId;
          const d = await call(`/api/workspace/projects/${encodeURIComponent(projectId)}/threads`, { method: 'POST', body: JSON.stringify({ name: 'New chat', keepActive: true }) });
          await choose({ projectId: d.project.id, threadId: d.thread.id, projectName: d.project.name, threadName: d.thread.name });
        } catch (e) {
          if (menu) menu.innerHTML = `<div style="padding:8px;font-size:0.72rem;color:#FCA5A5;">${esc(e.message)}</div>`;
        }
      });
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); open(); });
    paintLabel();
    return { refresh: paintLabel, close };
  }

  return { TABS, current, set, ensure, fromReply, messages, mountPicker, label };
});
