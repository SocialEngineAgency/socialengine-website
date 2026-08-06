/**
 * Animation Studio — canvas-first OiiOii-style UX
 * Left: timeline / asset canvas  |  Right: agent chat + mode/look dropdowns
 */
(function () {
  'use strict';

  let _meta = null;
  let _project = null;
  let _pollTimer = null;
  let _busy = false;

  function apiBase() {
    return (typeof window.API !== 'undefined' && window.API) || window._seAPI || '';
  }
  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-client-email': window.clientEmail || window.__clientEmail || '',
      'x-client-hash': window.clientHash || window.__clientHash || '',
    };
  }
  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'info');
  }
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  async function animFetch(path, opts) {
    const resp = await fetch(apiBase() + path, Object.assign({}, opts || {}, { headers: authHeaders() }));
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || resp.statusText);
    return data;
  }

  function stopPoll() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = null;
  }

  function startPoll() {
    stopPoll();
    _pollTimer = setInterval(async () => {
      if (!_project?.id) return;
      try {
        const data = await animFetch(`/api/animation/projects/${_project.id}`);
        _project = data.project;
        renderCanvas();
        renderChat();
        const done = ['ready', 'failed', 'brief_ready', 'brief'].includes(_project.status);
        if (done && !['developing', 'generating', 'assembling'].includes(_project.status)) {
          if (['ready', 'failed'].includes(_project.status)) stopPoll();
        }
        if (['developing', 'generating', 'assembling'].includes(_project.status)) {
          /* keep polling */
        } else if (_project.status === 'ready' || _project.status === 'failed') {
          stopPoll();
        }
      } catch (_) {}
    }, 3000);
  }

  function modeOptions() {
    return (_meta?.modes || []).map((m) =>
      `<option value="${esc(m.id)}" ${(_project?.mode || 'video') === m.id ? 'selected' : ''}>${esc(m.label)}</option>`
    ).join('');
  }
  function lookOptions() {
    return (_meta?.looks || [
      { id: 'realistic', label: 'Realistic' },
      { id: 'stylized', label: 'Stylized' },
      { id: 'cartoon', label: 'Cartoon / animated' },
    ]).map((l) =>
      `<option value="${esc(l.id)}" ${(_project?.look || 'stylized') === l.id ? 'selected' : ''}>${esc(l.label)}</option>`
    ).join('');
  }

  function statusBadge(status) {
    const colors = {
      brief: '#94A3B8',
      brief_ready: '#A78BFA',
      developing: '#FBBF24',
      generating: '#FBBF24',
      assembling: '#38BDF8',
      ready: '#34D399',
      failed: '#F87171',
      pending: '#64748B',
    };
    const c = colors[status] || '#94A3B8';
    return `<span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:${c}22;border:1px solid ${c}55;color:${c};font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${esc(status || 'idle')}</span>`;
  }

  function renderCanvas() {
    const el = document.getElementById('anim-canvas-body');
    if (!el) return;
    const p = _project;
    if (!p) {
      el.innerHTML = `
        <div class="anim-empty">
          <div class="anim-empty__title">Animation canvas</div>
          <div class="anim-empty__desc">Pick a mode, describe what you want, and Claude will rewrite it into a production brief. Accept to generate character views, scenes, and shots here.</div>
          <div class="anim-empty__hint">Tip: use <strong>Character</strong> first to lock a sheet, then <strong>Video</strong> for multi-shot reels.</div>
        </div>`;
      return;
    }

    const views = p.character_pack?.views || [];
    const scenes = (p.scenes || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const brief = p.agent_brief;

    el.innerHTML = `
      <div class="anim-canvas-top">
        <div>
          <div style="font-size:0.72rem;color:rgba(255,255,255,0.4);margin-bottom:4px;">Project</div>
          <div style="font-weight:700;font-size:1rem;color:#F8FAFC;">${esc(brief?.title || 'Untitled')}</div>
        </div>
        ${statusBadge(p.status)}
      </div>

      ${views.length ? `
      <div class="anim-section">
        <div class="anim-section__label">Character / asset lock</div>
        <div class="anim-strip">
          ${views.map((v) => `
            <div class="anim-tile">
              ${v.url ? `<img src="${esc(v.url)}" alt="${esc(v.label)}" />` : `<div class="anim-tile__ph">${esc(v.status || '…')}</div>`}
              <div class="anim-tile__cap">${esc(v.label)}</div>
            </div>`).join('')}
        </div>
      </div>` : `
      <div class="anim-section">
        <div class="anim-section__label">Character / asset lock</div>
        <div class="anim-placeholder-row">Multi-view sheets appear here after you accept the brief.</div>
      </div>`}

      <div class="anim-section">
        <div class="anim-section__label">Timeline</div>
        <div class="anim-timeline">
          ${scenes.length ? scenes.map((s) => `
            <div class="anim-shot" data-scene="${esc(s.id)}">
              <div class="anim-shot__media">
                ${s.video_url
                  ? `<video src="${esc(s.video_url)}" muted loop playsinline controls></video>`
                  : s.keyframe_url
                    ? `<img src="${esc(s.keyframe_url)}" alt="" />`
                    : `<div class="anim-tile__ph">${esc(s.status || 'pending')}</div>`}
              </div>
              <div class="anim-shot__meta">
                <div class="anim-shot__title">${esc(s.title || s.id)} ${statusBadge(s.status)}</div>
                <div class="anim-shot__prompt">${esc((s.prompt || '').slice(0, 120))}${(s.prompt || '').length > 120 ? '…' : ''}</div>
                <button type="button" class="anim-btn anim-btn--ghost anim-regen" data-scene="${esc(s.id)}" ${s.status === 'generating' ? 'disabled' : ''}>Regenerate</button>
              </div>
            </div>`).join('') : `
            <div class="anim-placeholder-row">${brief?.shots?.length
              ? `Ready to generate ${brief.shots.length} shots — accept the brief in chat.`
              : 'Shot cards will land on this timeline.'}</div>
            ${brief?.shots?.length ? `<div class="anim-timeline anim-timeline--ghost">${brief.shots.map((s) => `
              <div class="anim-shot anim-shot--ghost"><div class="anim-shot__media"><div class="anim-tile__ph">${esc(s.title || s.id)}</div></div></div>`).join('')}</div>` : ''}
          `}
        </div>
      </div>

      ${p.final_url ? `
      <div class="anim-section">
        <div class="anim-section__label">Final</div>
        <div class="anim-final">
          ${/\.(mp4|webm|mov)(\?|$)/i.test(p.final_url) || p.scenes?.some((s) => s.video_url)
            ? `<video src="${esc(p.final_url)}" controls playsinline style="max-width:280px;border-radius:12px;background:#000;"></video>`
            : `<img src="${esc(p.final_url)}" alt="Final" style="max-width:280px;border-radius:12px;" />`}
          ${p.content_record_id ? `<button type="button" class="anim-btn" id="anim-open-review">Open in Content Review</button>` : ''}
        </div>
      </div>` : ''}
      ${p.error ? `<div class="anim-error">${esc(p.error)}</div>` : ''}
    `;

    el.querySelectorAll('.anim-regen').forEach((btn) => {
      btn.addEventListener('click', () => regenScene(btn.dataset.scene));
    });
    document.getElementById('anim-open-review')?.addEventListener('click', () => {
      document.querySelector('[data-nav="content"]')?.click();
    });
  }

  function renderChat() {
    const logEl = document.getElementById('anim-chat-log');
    if (!logEl) return;
    const chat = _project?.chat || [];
    const brief = _project?.agent_brief;
    logEl.innerHTML = chat.map((m) => {
      const isAgent = m.role === 'agent' || m.role === 'system';
      return `<div class="anim-msg ${isAgent ? 'anim-msg--agent' : 'anim-msg--user'}">
        <div class="anim-msg__role">${esc(m.role === 'agent' ? 'Claude · Art Director' : m.role)}</div>
        <div class="anim-msg__text">${esc(m.text)}</div>
      </div>`;
    }).join('') || `<div class="anim-msg anim-msg--agent"><div class="anim-msg__role">Claude · Art Director</div><div class="anim-msg__text">Tell me what to make. I’ll rewrite it into an optimized brief for ${esc(_project?.mode || 'video')} mode — then you accept or edit before anything generates.</div></div>`;

    const actions = document.getElementById('anim-brief-actions');
    if (actions) {
      if (_project?.status === 'brief_ready' && brief) {
        actions.innerHTML = `
          <div class="anim-brief-card">
            <div class="anim-brief-card__title">Optimized brief</div>
            <textarea id="anim-brief-edit" class="anim-brief-edit">${esc(brief.rewritten_prompt || '')}</textarea>
            <div class="anim-brief-shots">${(brief.shots || []).map((s, i) =>
              `<div class="anim-brief-shot"><strong>${i + 1}. ${esc(s.title)}</strong> — ${esc((s.prompt || '').slice(0, 80))}…</div>`
            ).join('')}</div>
            <div class="anim-brief-btns">
              <button type="button" class="anim-btn" id="anim-accept">Accept & generate</button>
              <button type="button" class="anim-btn anim-btn--ghost" id="anim-rebrief">Re-brief</button>
            </div>
          </div>`;
        document.getElementById('anim-accept')?.addEventListener('click', acceptBrief);
        document.getElementById('anim-rebrief')?.addEventListener('click', () => {
          const ta = document.getElementById('anim-prompt');
          if (ta) ta.focus();
        });
      } else if (['developing', 'generating', 'assembling'].includes(_project?.status)) {
        actions.innerHTML = `<div class="anim-working">Generating — canvas updates live…</div>`;
      } else {
        actions.innerHTML = '';
      }
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  async function ensureProject() {
    if (_project?.id) return _project;
    const mode = document.getElementById('anim-mode')?.value || 'video';
    const look = document.getElementById('anim-look')?.value || 'stylized';
    const data = await animFetch('/api/animation/projects', {
      method: 'POST',
      body: JSON.stringify({ mode, look }),
    });
    _project = data.project;
    return _project;
  }

  async function sendPrompt() {
    if (_busy) return;
    const ta = document.getElementById('anim-prompt');
    const prompt = (ta?.value || '').trim();
    if (!prompt) return toast('Enter a prompt', 'error');
    _busy = true;
    try {
      await ensureProject();
      const mode = document.getElementById('anim-mode')?.value || 'video';
      const look = document.getElementById('anim-look')?.value || 'stylized';
      _project.mode = mode;
      _project.look = look;
      toast('Claude is rewriting your brief…', 'info');
      const data = await animFetch(`/api/animation/projects/${_project.id}/brief`, {
        method: 'POST',
        body: JSON.stringify({ prompt, mode, look }),
      });
      _project = data.project;
      if (ta) ta.value = '';
      renderCanvas();
      renderChat();
    } catch (e) {
      toast(e.message || 'Brief failed', 'error');
    } finally {
      _busy = false;
    }
  }

  async function acceptBrief() {
    if (_busy || !_project?.id) return;
    _busy = true;
    try {
      const edited = document.getElementById('anim-brief-edit')?.value;
      const agent_brief = { ...(_project.agent_brief || {}) };
      if (edited) agent_brief.rewritten_prompt = edited;
      const data = await animFetch(`/api/animation/projects/${_project.id}/approve-brief`, {
        method: 'POST',
        body: JSON.stringify({ agent_brief }),
      });
      _project = data.project;
      renderCanvas();
      renderChat();
      startPoll();
      toast('Generation started', 'success');
    } catch (e) {
      toast(e.message || 'Approve failed', 'error');
    } finally {
      _busy = false;
    }
  }

  async function regenScene(sceneId) {
    if (!_project?.id || !sceneId || _busy) return;
    _busy = true;
    try {
      toast('Regenerating shot…', 'info');
      const data = await animFetch(`/api/animation/projects/${_project.id}/scenes/${sceneId}/regenerate`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      _project = data.project;
      renderCanvas();
      toast('Shot updated', 'success');
    } catch (e) {
      toast(e.message || 'Regen failed', 'error');
    } finally {
      _busy = false;
    }
  }

  async function newProject() {
    stopPoll();
    _project = null;
    const mode = document.getElementById('anim-mode')?.value || 'video';
    const look = document.getElementById('anim-look')?.value || 'stylized';
    try {
      const data = await animFetch('/api/animation/projects', {
        method: 'POST',
        body: JSON.stringify({ mode, look }),
      });
      _project = data.project;
      renderCanvas();
      renderChat();
      toast('New project', 'info');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  window.renderAnimationStudio = async function renderAnimationStudio(data) {
    window.__clientData = data || window.__clientData || window.clientData;
    window.__clientEmail = window.clientEmail || window.__clientEmail || '';
    window.__clientHash = window.clientHash || window.__clientHash || '';
    window.API = typeof API !== 'undefined' ? API : window._seAPI;

    const root = document.getElementById('dash-content');
    if (!root) return;

    if (!_meta) {
      try { _meta = await animFetch('/api/animation/meta'); } catch (e) {
        root.innerHTML = `<div style="padding:40px;color:#F87171;">Animation Studio API unavailable: ${esc(e.message)}</div>`;
        return;
      }
    }

    root.innerHTML = `
      <style>
        .anim-shell { display:grid; grid-template-columns: 1fr minmax(320px,380px); gap:0; height:calc(100vh - 120px); min-height:560px; border:1px solid rgba(255,255,255,0.08); border-radius:16px; overflow:hidden; background:#0B1220; }
        .anim-canvas { display:flex; flex-direction:column; min-width:0; border-right:1px solid rgba(255,255,255,0.08); background:radial-gradient(1200px 600px at 10% 0%, rgba(124,58,237,0.12), transparent 55%), #0B1220; }
        .anim-canvas-header { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid rgba(255,255,255,0.06); }
        .anim-canvas-header h2 { margin:0; font-size:1.05rem; color:#F8FAFC; font-weight:700; }
        .anim-canvas-body { flex:1; overflow:auto; padding:18px; }
        .anim-chat { display:flex; flex-direction:column; min-width:0; background:#0F172A; }
        .anim-chat-header { padding:14px 16px; border-bottom:1px solid rgba(255,255,255,0.06); }
        .anim-chat-header h3 { margin:0 0 4px; font-size:0.95rem; color:#E2E8F0; }
        .anim-chat-header p { margin:0; font-size:0.72rem; color:rgba(255,255,255,0.4); }
        .anim-chat-log { flex:1; overflow:auto; padding:14px 16px; display:flex; flex-direction:column; gap:12px; }
        .anim-chat-compose { padding:12px 14px 16px; border-top:1px solid rgba(255,255,255,0.06); }
        .anim-row { display:flex; gap:8px; margin-bottom:8px; }
        .anim-select { flex:1; background:#1E293B; border:1px solid rgba(255,255,255,0.1); color:#E2E8F0; border-radius:8px; padding:8px 10px; font-size:0.78rem; font-family:inherit; }
        .anim-prompt { width:100%; min-height:72px; resize:vertical; background:#1E293B; border:1px solid rgba(255,255,255,0.1); color:#F8FAFC; border-radius:10px; padding:10px 12px; font-size:0.85rem; font-family:inherit; margin-bottom:8px; }
        .anim-btn { width:100%; padding:10px 14px; border:none; border-radius:10px; background:linear-gradient(135deg,#7C3AED,#5B21B6); color:#fff; font-weight:700; font-size:0.82rem; cursor:pointer; font-family:inherit; }
        .anim-btn:disabled { opacity:0.5; cursor:not-allowed; }
        .anim-btn--ghost { background:transparent; border:1px solid rgba(255,255,255,0.15); color:#CBD5E1; width:auto; }
        .anim-msg { padding:10px 12px; border-radius:12px; max-width:100%; }
        .anim-msg--user { background:rgba(124,58,237,0.18); border:1px solid rgba(124,58,237,0.3); align-self:flex-end; }
        .anim-msg--agent { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); }
        .anim-msg__role { font-size:0.65rem; font-weight:700; color:#A78BFA; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.04em; }
        .anim-msg__text { font-size:0.82rem; color:#E2E8F0; line-height:1.45; white-space:pre-wrap; }
        .anim-empty { max-width:420px; margin:12vh auto 0; text-align:center; }
        .anim-empty__title { font-size:1.35rem; font-weight:800; color:#F8FAFC; margin-bottom:8px; }
        .anim-empty__desc { font-size:0.88rem; color:rgba(255,255,255,0.55); line-height:1.5; margin-bottom:12px; }
        .anim-empty__hint { font-size:0.75rem; color:rgba(167,139,250,0.85); }
        .anim-canvas-top { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; }
        .anim-section { margin-bottom:22px; }
        .anim-section__label { font-size:0.68rem; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:rgba(255,255,255,0.35); margin-bottom:10px; }
        .anim-strip { display:flex; gap:10px; overflow-x:auto; padding-bottom:4px; }
        .anim-tile { width:110px; flex:0 0 auto; }
        .anim-tile img, .anim-shot__media img, .anim-shot__media video { width:100%; aspect-ratio:1; object-fit:cover; border-radius:10px; background:#1E293B; display:block; }
        .anim-shot__media video { aspect-ratio:9/16; max-height:220px; }
        .anim-tile__ph { width:100%; aspect-ratio:1; border-radius:10px; background:rgba(255,255,255,0.04); border:1px dashed rgba(255,255,255,0.12); display:flex; align-items:center; justify-content:center; color:rgba(255,255,255,0.35); font-size:0.7rem; }
        .anim-tile__cap { margin-top:6px; font-size:0.68rem; color:rgba(255,255,255,0.5); text-align:center; }
        .anim-timeline { display:flex; flex-direction:column; gap:12px; }
        .anim-timeline--ghost { flex-direction:row; margin-top:10px; }
        .anim-shot { display:grid; grid-template-columns:120px 1fr; gap:12px; padding:12px; border-radius:14px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); }
        .anim-shot--ghost { grid-template-columns:1fr; width:100px; }
        .anim-shot__title { display:flex; align-items:center; gap:8px; font-size:0.85rem; font-weight:700; color:#F1F5F9; margin-bottom:6px; }
        .anim-shot__prompt { font-size:0.75rem; color:rgba(255,255,255,0.45); line-height:1.4; margin-bottom:8px; }
        .anim-placeholder-row { font-size:0.8rem; color:rgba(255,255,255,0.4); padding:14px; border:1px dashed rgba(255,255,255,0.1); border-radius:12px; }
        .anim-brief-card { margin-top:8px; padding:12px; border-radius:12px; background:rgba(124,58,237,0.1); border:1px solid rgba(124,58,237,0.28); }
        .anim-brief-card__title { font-size:0.72rem; font-weight:700; color:#C4B5FD; margin-bottom:8px; text-transform:uppercase; }
        .anim-brief-edit { width:100%; min-height:90px; background:#0F172A; border:1px solid rgba(255,255,255,0.1); color:#F8FAFC; border-radius:8px; padding:8px; font-size:0.78rem; font-family:inherit; margin-bottom:8px; }
        .anim-brief-shot { font-size:0.72rem; color:rgba(255,255,255,0.55); margin-bottom:4px; }
        .anim-brief-btns { display:flex; gap:8px; margin-top:10px; }
        .anim-brief-btns .anim-btn { width:auto; flex:1; }
        .anim-working { font-size:0.78rem; color:#FBBF24; padding:8px 0; }
        .anim-error { margin-top:12px; padding:10px 12px; border-radius:10px; background:rgba(248,113,113,0.1); border:1px solid rgba(248,113,113,0.3); color:#FCA5A5; font-size:0.78rem; }
        .anim-final { display:flex; flex-direction:column; gap:12px; align-items:flex-start; }
        @media (max-width: 960px) {
          .anim-shell { grid-template-columns:1fr; height:auto; }
          .anim-canvas { border-right:none; border-bottom:1px solid rgba(255,255,255,0.08); min-height:50vh; }
          .anim-chat { min-height:50vh; }
        }
      </style>
      <div class="anim-shell">
        <section class="anim-canvas">
          <div class="anim-canvas-header">
            <h2>Animation Studio</h2>
            <button type="button" class="anim-btn anim-btn--ghost" id="anim-new" style="padding:7px 12px;font-size:0.72rem;">New project</button>
          </div>
          <div class="anim-canvas-body" id="anim-canvas-body"></div>
        </section>
        <aside class="anim-chat">
          <div class="anim-chat-header">
            <h3>AI Agent</h3>
            <p>Claude rewrites → you approve → canvas fills</p>
          </div>
          <div class="anim-chat-log" id="anim-chat-log"></div>
          <div id="anim-brief-actions" style="padding:0 14px;"></div>
          <div class="anim-chat-compose">
            <div class="anim-row">
              <select id="anim-mode" class="anim-select" title="Mode">${modeOptions()}</select>
              <select id="anim-look" class="anim-select" title="Look">${lookOptions()}</select>
            </div>
            <textarea id="anim-prompt" class="anim-prompt" placeholder="Describe a character, scene, product, or full video idea…"></textarea>
            <button type="button" class="anim-btn" id="anim-send">Send to Claude</button>
          </div>
        </aside>
      </div>
    `;

    document.getElementById('anim-send')?.addEventListener('click', sendPrompt);
    document.getElementById('anim-new')?.addEventListener('click', newProject);
    document.getElementById('anim-prompt')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendPrompt();
    });

    if (!_project) {
      try {
        const list = await animFetch('/api/animation/projects');
        if (list.projects?.length) _project = list.projects[0];
      } catch (_) {}
    }
    renderCanvas();
    renderChat();
    if (_project && ['developing', 'generating', 'assembling'].includes(_project.status)) startPoll();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };
})();
