/**
 * Animation Studio — canvas-first OiiOii-style UX
 * Left: timeline / asset canvas  |  Right: agent chat + mode/look dropdowns
 */
(function () {
  'use strict';

  let _meta = null;
  let _project = null;
  let _recent = []; // project list for home screen
  let _pollTimer = null;
  let _busy = false;
  let _refs = []; // [{ url, title, role: 'character'|'style'|'scene' }]
  const REF_ROLES = [
    { id: 'character', label: 'Char' },
    { id: 'style', label: 'Style' },
    { id: 'scene', label: 'Scene' },
  ];

  function defaultRefRole() {
    if (!_refs.some((r) => r.role === 'character')) return 'character';
    if (!_refs.some((r) => r.role === 'style')) return 'style';
    return 'scene';
  }

  function refsPayload() {
    return _refs.map((r) => ({
      url: r.url,
      role: REF_ROLES.some((x) => x.id === r.role) ? r.role : 'character',
      title: r.title || undefined,
    }));
  }

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
  function authHeadersMultipart() {
    return {
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

  /** Atlas / Aliyun OSS hotlink-blocks portal Referers — route through API proxy. */
  function mediaSrc(url) {
    if (!url) return '';
    if (/\/api\/media(\/|-fetch)/i.test(url)) return url;
    if (/(aliyuncs\.com|higgsfield\.ai)/i.test(url)) {
      return `${apiBase()}/api/media-fetch?url=${encodeURIComponent(url)}`;
    }
    return url;
  }

  function tileMedia(url, alt, status) {
    const busy = !url && ['generating', 'pending', 'developing', 'assembling'].includes(status);
    if (busy) {
      return `<div class="anim-tile__ph anim-tile__ph--gen" aria-busy="true">
        <span class="anim-tile__gen-label">${esc(status === 'assembling' ? 'Creating' : 'Generating')}</span>
      </div>`;
    }
    if (!url) {
      return `<div class="anim-tile__ph ${status === 'failed' ? 'anim-tile__ph--fail' : ''}">${esc(status === 'failed' ? 'Failed' : (status || '…'))}</div>`;
    }
    const src = mediaSrc(url);
    return `<img class="anim-media" src="${esc(src)}" alt="${esc(alt || '')}" loading="lazy" data-fallback="1" />`;
  }

  function projectHasCharacterRef(p) {
    if (!p) return false;
    if (p.model_plan?.character_ref) return true;
    if (p.character_ref_url) return true;
    return (p.references || []).some((r) => r.role === 'character' && r.url);
  }

  function projectHasStyleRef(p) {
    if (!p) return false;
    if (p.model_plan?.style_ref) return true;
    if (p.style_ref_url) return true;
    return (p.references || []).some((r) => r.role === 'style' && r.url)
      || ((p.reference_urls || []).length > 1 && !(p.references || []).length);
  }

  function modelLine(p) {
    if (!p?.model_plan?.imageEndpoint && !projectHasCharacterRef(p)) return '';
    const ep = p.model_plan?.imageEndpoint || 'unknown';
    const short = ep.split('/').slice(-2).join('/');
    const char = projectHasCharacterRef(p) ? ' · identity from Character ref' : ' · no Character ref';
    const style = projectHasStyleRef(p) ? ' · Style ref for look' : '';
    return `<div class="anim-model-line">Model: ${esc(short)}${char}${style}</div>`;
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
        if (['developing', 'generating', 'assembling'].includes(_project.status)) {
          /* keep polling */
        } else {
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

  function currentMotionMode() {
    return _project?.motion_mode || _meta?.default_motion_mode || 'auto';
  }

  function motionOptions() {
    const modes = _meta?.motion_modes || [
      { id: 'auto', label: 'Auto (DreamActor)' },
      { id: 'drive', label: 'Upload drive' },
      { id: 'kling', label: 'Kling only' },
    ];
    const cur = currentMotionMode();
    return modes.map((m) =>
      `<option value="${esc(m.id)}" ${cur === m.id ? 'selected' : ''}>${esc(m.label)}</option>`
    ).join('');
  }

  function motionHint() {
    const id = document.getElementById('anim-motion')?.value || currentMotionMode();
    const hit = (_meta?.motion_modes || []).find((m) => m.id === id);
    if (hit?.hint) return hit.hint;
    if (id === 'drive') return 'Upload a driving video for motion — DreamActor maps your locked character onto it.';
    if (id === 'kling') return 'Kling image-to-video only (faster, weaker identity lock).';
    return 'Kling builds motion from the keyframe, then DreamActor reinforces the locked character.';
  }

  async function syncMotionSettings() {
    if (!_project?.id) return;
    const motion_mode = document.getElementById('anim-motion')?.value || currentMotionMode();
    try {
      const identity_source = document.getElementById('anim-identity')?.value || _project.identity_source || 'upload';
      const data = await animFetch(`/api/animation/projects/${_project.id}/settings`, {
        method: 'POST',
        body: JSON.stringify({
          motion_mode,
          driving_video_url: _project.driving_video_url || null,
          identity_source,
        }),
      });
      _project = data.project;
    } catch (e) {
      toast(e.message || 'Could not save motion settings', 'error');
    }
  }

  async function uploadDrivingVideo(file) {
    if (!file) return;
    if (!file.type.startsWith('video/')) return toast('Please upload a video (mp4/mov)', 'error');
    if (file.size > 80 * 1024 * 1024) return toast('Driving video must be under 80MB', 'error');
    toast('Uploading driving video…', 'info');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('video', file);
      const res = await fetch(`${apiBase()}/api/studio/upload-video`, {
        method: 'POST',
        headers: authHeadersMultipart(),
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
      if (!_project?.id) {
        const created = await animFetch('/api/animation/projects', {
          method: 'POST',
          body: JSON.stringify({
            mode: document.getElementById('anim-mode')?.value || 'video',
            look: document.getElementById('anim-look')?.value || 'stylized',
            motion_mode: 'drive',
            driving_video_url: data.url,
          }),
        });
        _project = created.project;
      } else {
        _project.driving_video_url = data.url;
        _project.motion_mode = 'drive';
        const sel = document.getElementById('anim-motion');
        if (sel) sel.value = 'drive';
        await syncMotionSettings();
      }
      renderDriveControls();
      toast('Driving video attached', 'success');
    } catch (e) {
      toast(e.message || 'Driving video upload failed', 'error');
    }
  }

  function renderDriveControls() {
    const wrap = document.getElementById('anim-drive-wrap');
    if (!wrap) return;
    const mode = document.getElementById('anim-motion')?.value || currentMotionMode();
    wrap.hidden = mode !== 'drive';
    const status = document.getElementById('anim-drive-status');
    if (status) {
      const url = _project?.driving_video_url;
      status.textContent = url ? 'Driving video ready' : 'No driving video yet';
      status.style.color = url ? '#86EFAC' : 'rgba(255,255,255,0.4)';
    }
    const hint = document.getElementById('anim-motion-hint');
    if (hint) hint.textContent = motionHint();
  }

  function statusBadge(status) {
    const colors = {
      brief: '#94A3B8',
      brief_ready: '#A78BFA',
      developing: '#FBBF24',
      generating: '#FBBF24',
      character_review: '#F472B6',
      assembling: '#38BDF8',
      ready: '#34D399',
      failed: '#F87171',
      pending: '#64748B',
    };
    const c = colors[status] || '#94A3B8';
    return `<span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:${c}22;border:1px solid ${c}55;color:${c};font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${esc(status || 'idle')}</span>`;
  }

  function projectTitle(p) {
    return p?.agent_brief?.title || p?.user_prompt?.slice(0, 48) || 'Untitled project';
  }

  function projectMediaExpired(p) {
    if (!p) return false;
    if (p.media_expired) return true;
    const views = p.character_pack?.views || [];
    if (!views.length) return false;
    return views.every((v) => !v.url || /\/api\/media\//i.test(String(v.url)));
  }

  async function refreshRecent() {
    try {
      const list = await animFetch('/api/animation/projects');
      _recent = list.projects || [];
      if (list.purged > 0) {
        toast(`Removed ${list.purged} expired project${list.purged === 1 ? '' : 's'} (old links from a server restart)`, 'info');
      }
    } catch (_) {
      _recent = [];
    }
  }

  async function deleteProject(id, { silent } = {}) {
    if (!id) return;
    try {
      const data = await animFetch(`/api/animation/projects/${id}`, { method: 'DELETE' });
      _recent = data.projects || _recent.filter((p) => p.id !== id);
      if (_project?.id === id) {
        _project = null;
        _refs = [];
        stopPoll();
      }
      if (!silent) toast('Expired project removed', 'success');
      renderCanvas();
      renderChat();
      renderRefs();
    } catch (e) {
      if (!silent) toast(e.message || 'Could not delete project', 'error');
    }
  }

  async function openProject(id) {
    if (!id || _busy) return;
    try {
      const data = await animFetch(`/api/animation/projects/${id}`);
      _project = data.project;
      if (projectMediaExpired(_project)) {
        await deleteProject(_project.id, { silent: true });
        toast('That project’s images expired after a server restart. Start a new one and re-upload refs.', 'error');
        return;
      }
      _refs = (_project.references || []).map((r) => ({
        url: r.url,
        title: r.title || 'Ref',
        role: r.role || 'character',
      }));
      if (!_refs.length && _project.reference_urls?.length) {
        _refs = _project.reference_urls.map((url, i) => ({
          url,
          title: 'Ref',
          role: i === 0 ? 'character' : i === 1 ? 'style' : 'scene',
        }));
      }
      if (!_refs.length && _project.character_ref_url) {
        _refs = [{ url: _project.character_ref_url, title: 'Ref', role: 'character' }];
      }
      renderCanvas();
      renderChat();
      renderRefs();
      if (['developing', 'generating', 'assembling'].includes(_project.status)) startPoll();
      else stopPoll();
      toast(`Opened ${projectTitle(_project)}`, 'success');
    } catch (e) {
      await refreshRecent();
      _project = null;
      renderCanvas();
      renderChat();
      renderRefs();
      toast(e.message || 'Could not open project', 'error');
    }
  }

  function renderCanvas() {
    const el = document.getElementById('anim-canvas-body');
    if (!el) return;
    const p = _project;
    if (!p) {
      const usable = _recent.filter((rp) => !projectMediaExpired(rp));
      const recentHtml = usable.length ? `
        <div class="anim-recent">
          <div class="anim-section__label">Recent projects</div>
          <div class="anim-recent__list">
            ${usable.slice(0, 12).map((rp) => `
              <div class="anim-recent__row">
                <button type="button" class="anim-recent__item" data-open-project="${esc(rp.id)}">
                  <span class="anim-recent__title">${esc(projectTitle(rp))}</span>
                  <span class="anim-recent__meta">${statusBadge(rp.status)} <span class="anim-recent__mode">${esc(rp.mode || '')}</span></span>
                </button>
                <button type="button" class="anim-btn anim-btn--ghost anim-recent__del" data-del-project="${esc(rp.id)}" title="Delete project">✕</button>
              </div>`).join('')}
          </div>
        </div>` : `
        <div class="anim-placeholder-row" style="margin-top:22px;max-width:420px;margin-left:auto;margin-right:auto;">No saved projects yet — send a prompt to start one. Generated images now persist on CDN across refreshes.</div>`;
      el.innerHTML = `
        <div class="anim-empty">
          <div class="anim-empty__title">Animation canvas</div>
          <div class="anim-empty__desc">Pick a mode, describe what you want, and Claude will rewrite it into a production brief. Accept to generate character views, scenes, and shots here.</div>
          <div class="anim-empty__hint">Tip: tag refs as <strong>Char</strong> + <strong>Style</strong>, then run. Uploads must land on CDN (not ephemeral links).</div>
        </div>
        ${recentHtml}`;
      el.querySelectorAll('[data-open-project]').forEach((btn) => {
        btn.addEventListener('click', () => openProject(btn.dataset.openProject));
      });
      el.querySelectorAll('[data-del-project]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteProject(btn.dataset.delProject);
        });
      });
      return;
    }

    const views = p.character_pack?.views || [];
    const plannedViews = (!views.length && ['developing', 'generating', 'assembling'].includes(p.status) && p.agent_brief?.multi_view_plan?.length)
      ? p.agent_brief.multi_view_plan.slice(0, 6).map((label) => ({ label, url: null, status: 'generating' }))
      : views;
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

      <div class="anim-section">
        <div class="anim-section__label">Character / asset lock ${p.character_pack?.locked ? '· Locked' : ''}</div>
        ${modelLine(p)}
        ${plannedViews.length ? `
        <div class="anim-strip">
          ${plannedViews.map((v) => `
            <div class="anim-tile">
              ${tileMedia(v.url, v.label, v.status || p.status)}
              <div class="anim-tile__cap">${esc(v.label)}${v.model ? `<span class="anim-tile__model">${esc(String(v.model).split('/').pop())}</span>` : ''}</div>
            </div>`).join('')}
        </div>
        <div class="anim-expired-banner" id="anim-expired-banner" hidden>
          <div>Images expired after a server restart (old ephemeral links). Delete this project, re-upload refs (tag Char + Style), and run again — new runs persist on CDN.</div>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
            <button type="button" class="anim-btn" id="anim-delete-expired" style="width:auto;">Delete expired project</button>
            <button type="button" class="anim-btn anim-btn--ghost" id="anim-new-from-expired" style="width:auto;">New project</button>
          </div>
        </div>
        ${p.status === 'character_review' ? `
        <div class="anim-lock-banner">
          <div>Review the sheet. If identity looks right, approve the lock — shots will not generate until you do.</div>
          <button type="button" class="anim-btn" id="anim-approve-character" style="width:auto;margin-top:10px;">Approve character lock</button>
        </div>` : ''}
        ` : (p.references || []).length || (p.reference_urls || []).length || _refs.length ? `
        <div class="anim-strip">
          ${(p.reference_urls?.length ? p.reference_urls : _refs.map((r) => r.url)).map((url, i) => `
            <div class="anim-tile">
              ${tileMedia(url, `Ref ${i + 1}`, 'ready')}
              <div class="anim-tile__cap">Ref ${i + 1}</div>
            </div>`).join('')}
        </div>
        <div class="anim-placeholder-row" style="margin-top:10px;">Your references are attached — multi-view sheets generate after you accept the brief.</div>` : `
        <div class="anim-placeholder-row">Add reference images in the chat panel, then accept the brief to generate multi-view sheets.</div>`}
      </div>

      <div class="anim-section">
        <div class="anim-section__label">Timeline</div>
        <div class="anim-timeline">
          ${scenes.length ? scenes.map((s) => `
            <div class="anim-shot" data-scene="${esc(s.id)}">
              <div class="anim-shot__media">
                ${s.video_url
                  ? `<video src="${esc(mediaSrc(s.video_url))}" muted loop playsinline controls></video>`
                  : s.keyframe_url
                    ? tileMedia(s.keyframe_url, s.title || '', s.status)
                    : tileMedia(null, '', s.status || 'pending')}
              </div>
              <div class="anim-shot__meta">
                <div class="anim-shot__title">${esc(s.title || s.id)} ${statusBadge(s.status)}</div>
                <div class="anim-shot__prompt">${esc((s.prompt || '').slice(0, 120))}${(s.prompt || '').length > 120 ? '…' : ''}</div>
                ${s.motion ? `<div style="font-size:0.65rem;color:rgba(167,139,250,0.9);margin:4px 0;">Motion: ${esc(s.motion)}${s.model_video ? ` · ${esc(String(s.model_video).split('/').pop())}` : ''}</div>` : ''}
                ${s.motion_warning ? `<div style="font-size:0.62rem;color:#FCD34D;margin:2px 0 6px;line-height:1.35;">${esc(s.motion_warning)}</div>` : ''}
                <button type="button" class="anim-btn anim-btn--ghost anim-regen" data-scene="${esc(s.id)}" ${s.status === 'generating' ? 'disabled' : ''}>Regenerate</button>
              </div>
            </div>`).join('') : `
            <div class="anim-placeholder-row">${p.status === 'character_review'
              ? 'Shots wait until you Approve character lock.'
              : brief?.shots?.length
              ? `Ready to generate ${brief.shots.length} shots — accept the brief, then approve the character lock.`
              : 'Shot cards will land on this timeline.'}</div>
            ${brief?.shots?.length ? `<div class="anim-timeline anim-timeline--ghost">${brief.shots.map((s) => `
              <div class="anim-shot anim-shot--ghost"><div class="anim-shot__media">${
                ['developing', 'generating', 'assembling'].includes(p.status)
                  ? tileMedia(null, '', 'generating')
                  : `<div class="anim-tile__ph">${esc(s.title || s.id)}</div>`
              }</div></div>`).join('')}</div>` : ''}
          `}
        </div>
      </div>

      ${(() => {
        const finalUrl = p.final_url;
        if (!finalUrl || p.status === 'character_review') return '';
        // Hide Final when it's just the uploaded character ref (legacy bug)
        if (finalUrl === p.character_ref_url && !(p.scenes || []).some((s) => s.video_url || s.keyframe_url)) {
          const front = (p.character_pack?.views || []).find((v) => v.label === 'front' && v.url)?.url
            || (p.character_pack?.views || []).find((v) => v.url)?.url;
          if (!front || front === finalUrl) return '';
        }
        return `
      <div class="anim-section">
        <div class="anim-section__label">Final</div>
        <div class="anim-final">
          ${/\.(mp4|webm|mov)(\?|$)/i.test(finalUrl) || p.scenes?.some((s) => s.video_url)
            ? `<video src="${esc(mediaSrc(finalUrl))}" controls playsinline style="max-width:280px;border-radius:12px;background:#000;"></video>`
            : `<img class="anim-media" src="${esc(mediaSrc(finalUrl))}" alt="Final" style="max-width:280px;border-radius:12px;" data-fallback="1" />`}
          ${p.content_record_id ? `<button type="button" class="anim-btn" id="anim-open-review">Open in Content Review</button>` : ''}
        </div>
      </div>`;
      })()}
      ${p.error ? `<div class="anim-error">${esc(p.error)}</div>` : ''}
    `;

    el.querySelectorAll('.anim-regen').forEach((btn) => {
      btn.addEventListener('click', () => regenScene(btn.dataset.scene));
    });
    let expiredCount = 0;
    const showExpiredBanner = () => {
      const banner = document.getElementById('anim-expired-banner');
      if (banner) banner.hidden = false;
    };
    if (projectMediaExpired(p)) showExpiredBanner();
    el.querySelectorAll('img.anim-media[data-fallback]').forEach((img) => {
      img.addEventListener('error', () => {
        expiredCount += 1;
        const ph = document.createElement('div');
        ph.className = 'anim-tile__ph anim-tile__ph--fail';
        ph.textContent = 'Expired';
        img.replaceWith(ph);
        if (expiredCount >= 1) showExpiredBanner();
      }, { once: true });
    });
    document.getElementById('anim-delete-expired')?.addEventListener('click', () => {
      if (_project?.id) deleteProject(_project.id);
    });
    document.getElementById('anim-new-from-expired')?.addEventListener('click', () => newProject());
    document.getElementById('anim-approve-character')?.addEventListener('click', approveCharacter);
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
      } else if (_project?.status === 'character_review') {
        actions.innerHTML = `
          <div class="anim-brief-card">
            <div class="anim-brief-card__title">Character lock</div>
            <div class="anim-brief-shot">Check the canvas views. Approve only if face/hair/outfit match your Character reference.</div>
            <div class="anim-brief-btns">
              <button type="button" class="anim-btn" id="anim-accept-character">Approve character lock</button>
            </div>
          </div>`;
        document.getElementById('anim-accept-character')?.addEventListener('click', approveCharacter);
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
    const motion_mode = document.getElementById('anim-motion')?.value || currentMotionMode();
    const references = refsPayload();
    const data = await animFetch('/api/animation/projects', {
      method: 'POST',
      body: JSON.stringify({
        mode,
        look,
        motion_mode,
        driving_video_url: _project?.driving_video_url || null,
        references,
        reference_urls: references.map((r) => r.url),
        character_ref_url: references.find((r) => r.role === 'character')?.url || null,
      }),
    });
    _project = data.project;
    return _project;
  }

  async function sendPrompt() {
    if (_busy) return;
    const ta = document.getElementById('anim-prompt');
    const prompt = (ta?.value || '').trim();
    if (!prompt) return toast('Enter a prompt', 'error');
    if (_refs.length && !_refs.some((r) => r.role === 'character')) {
      return toast('Tag one reference as Character (identity)', 'error');
    }
    _busy = true;
    try {
      await ensureProject();
      const mode = document.getElementById('anim-mode')?.value || 'video';
      const look = document.getElementById('anim-look')?.value || 'stylized';
      const motion_mode = document.getElementById('anim-motion')?.value || currentMotionMode();
      const references = refsPayload();
      _project.mode = mode;
      _project.look = look;
      _project.motion_mode = motion_mode;
      await syncMotionSettings();
      toast('Claude is rewriting your brief…', 'info');
      const data = await animFetch(`/api/animation/projects/${_project.id}/brief`, {
        method: 'POST',
        body: JSON.stringify({
          prompt,
          mode,
          look,
          references,
          reference_urls: references.map((r) => r.url),
          character_ref_url: references.find((r) => r.role === 'character')?.url || null,
        }),
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
      toast('Generating character sheet…', 'success');
    } catch (e) {
      toast(e.message || 'Approve failed', 'error');
    } finally {
      _busy = false;
    }
  }

  async function approveCharacter() {
    if (_busy || !_project?.id) return;
    const motion_mode = document.getElementById('anim-motion')?.value || currentMotionMode();
    if (motion_mode === 'drive' && !_project.driving_video_url) {
      return toast('Upload a driving video first (or switch motion to Auto / Kling only)', 'error');
    }
    _busy = true;
    try {
      await syncMotionSettings();
      const data = await animFetch(`/api/animation/projects/${_project.id}/approve-character`, {
        method: 'POST',
        body: JSON.stringify({
          motion_mode,
          driving_video_url: _project.driving_video_url || null,
        }),
      });
      _project = data.project;
      renderCanvas();
      renderChat();
      if (data.started) {
        startPoll();
        toast('Character locked — generating shots…', 'success');
      } else {
        stopPoll();
        toast('Character lock saved', 'success');
      }
    } catch (e) {
      toast(e.message || 'Character approve failed', 'error');
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
        body: JSON.stringify({
          motion_mode: document.getElementById('anim-motion')?.value || currentMotionMode(),
        }),
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

  function renderRefs() {
    const box = document.getElementById('anim-refs');
    if (!box) return;
    if (!_refs.length) {
      box.innerHTML = `<div class="anim-refs-empty">Add refs and tag roles: Character = identity, Style = art look, Scene = setting</div>`;
      return;
    }
    box.innerHTML = _refs.map((r, i) => `
      <div class="anim-ref-card">
        <div class="anim-ref-chip" title="${esc(r.title || r.url)}">
          <img src="${esc(mediaSrc(r.url))}" alt="" />
          <button type="button" class="anim-ref-x" data-i="${i}" aria-label="Remove">×</button>
        </div>
        <select class="anim-ref-role" data-i="${i}" title="Reference role">
          ${REF_ROLES.map((role) =>
            `<option value="${role.id}" ${r.role === role.id ? 'selected' : ''}>${role.label}</option>`
          ).join('')}
        </select>
      </div>`).join('');
    box.querySelectorAll('.anim-ref-x').forEach((btn) => {
      btn.addEventListener('click', () => {
        _refs.splice(Number(btn.dataset.i), 1);
        renderRefs();
      });
    });
    box.querySelectorAll('.anim-ref-role').forEach((sel) => {
      sel.addEventListener('change', () => {
        const i = Number(sel.dataset.i);
        if (_refs[i]) _refs[i].role = sel.value;
      });
    });
  }

  async function uploadRefFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Please upload an image', 'error');
    if (file.size > 10 * 1024 * 1024) return toast('Image must be under 10MB', 'error');
    if (_refs.length >= 8) return toast('Max 8 reference images', 'error');
    toast('Uploading reference…', 'info');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('image', file);
      const res = await fetch(`${apiBase()}/api/studio/upload-image`, {
        method: 'POST',
        headers: authHeadersMultipart(),
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
      if (data.durable === false || /\/api\/media\//i.test(String(data.url))) {
        throw new Error('Upload did not persist to CDN. Check Atlas API key on the server, then retry.');
      }
      const role = defaultRefRole();
      _refs.push({ url: data.url, title: file.name || 'Upload', role });
      renderRefs();
      toast(`Added as ${role}`, 'success');
    } catch (e) {
      toast(e.message || 'Upload failed', 'error');
    }
  }

  function addRefUrl() {
    const input = document.getElementById('anim-ref-url');
    const raw = (input?.value || '').trim();
    if (!raw) return toast('Paste an image URL first', 'error');
    if (!/^https?:\/\//i.test(raw)) return toast('URL must start with http(s)://', 'error');
    if (_refs.length >= 8) return toast('Max 8 reference images', 'error');
    if (_refs.some((r) => r.url === raw)) return toast('Already attached', 'info');
    const role = defaultRefRole();
    _refs.push({ url: raw, title: 'URL', role });
    if (input) input.value = '';
    renderRefs();
    toast(`Added as ${role}`, 'success');
  }

  async function goHome() {
    stopPoll();
    _project = null;
    _refs = [];
    await refreshRecent();
    renderCanvas();
    renderChat();
    renderRefs();
    const actions = document.getElementById('anim-brief-actions');
    if (actions) actions.innerHTML = '';
    const ta = document.getElementById('anim-prompt');
    if (ta) {
      ta.value = '';
      ta.focus();
    }
  }

  async function newProject() {
    // Back to the first Animate screen — do not create a server project until Send.
    goHome();
    toast('Ready for a new idea', 'info');
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
        .anim-canvas { display:flex; flex-direction:column; min-width:0; min-height:0; border-right:1px solid rgba(255,255,255,0.08); background:radial-gradient(1200px 600px at 10% 0%, rgba(124,58,237,0.12), transparent 55%), #0B1220; }
        .anim-canvas-header { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid rgba(255,255,255,0.06); flex-shrink:0; }
        .anim-canvas-header h2 { margin:0; font-size:1.05rem; color:#F8FAFC; font-weight:700; }
        .anim-canvas-body { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; padding:18px 18px 40px; -webkit-overflow-scrolling:touch; }
        .anim-chat { display:flex; flex-direction:column; min-width:0; min-height:0; background:#0F172A; }
        .anim-chat-header { padding:14px 16px; border-bottom:1px solid rgba(255,255,255,0.06); flex-shrink:0; }
        .anim-chat-header h3 { margin:0 0 4px; font-size:0.95rem; color:#E2E8F0; }
        .anim-chat-header p { margin:0; font-size:0.72rem; color:rgba(255,255,255,0.4); }
        .anim-chat-log { flex:1; min-height:0; overflow:auto; padding:14px 16px; display:flex; flex-direction:column; gap:12px; }
        .anim-chat-compose { padding:12px 14px 16px; border-top:1px solid rgba(255,255,255,0.06); flex-shrink:0; }
        .anim-row { display:flex; gap:8px; margin-bottom:8px; }
        .anim-select { flex:1; background:#1E293B; border:1px solid rgba(255,255,255,0.1); color:#E2E8F0; border-radius:8px; padding:8px 10px; font-size:0.78rem; font-family:inherit; }
        .anim-prompt { width:100%; min-height:72px; resize:vertical; background:#1E293B; border:1px solid rgba(255,255,255,0.1); color:#F8FAFC; border-radius:10px; padding:10px 12px; font-size:0.85rem; font-family:inherit; margin-bottom:8px; }
        .anim-refs { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:8px; min-height:28px; }
        .anim-refs-empty { font-size:0.7rem; color:rgba(255,255,255,0.3); padding:4px 0; line-height:1.4; }
        .anim-ref-card { display:flex; flex-direction:column; gap:4px; width:72px; }
        .anim-ref-chip { position:relative; width:72px; height:72px; border-radius:8px; overflow:hidden; border:1px solid rgba(167,139,250,0.45); }
        .anim-ref-chip img { width:100%; height:100%; object-fit:cover; display:block; }
        .anim-ref-x { position:absolute; top:2px; right:2px; width:18px; height:18px; border:none; border-radius:50%; background:rgba(0,0,0,0.7); color:#fff; font-size:12px; line-height:1; cursor:pointer; padding:0; }
        .anim-ref-role { width:100%; background:#1E293B; border:1px solid rgba(255,255,255,0.12); color:#E2E8F0; border-radius:6px; padding:3px 4px; font-size:0.62rem; font-family:inherit; }
        .anim-ref-tools { display:flex; gap:6px; margin-bottom:8px; align-items:center; }
        .anim-model-line { font-size:0.68rem; color:rgba(167,139,250,0.85); margin:-4px 0 10px; }
        .anim-tile__model { display:block; font-size:0.58rem; color:rgba(255,255,255,0.35); margin-top:2px; }
        .anim-lock-banner { margin-top:12px; padding:12px 14px; border-radius:12px; background:rgba(244,114,182,0.1); border:1px solid rgba(244,114,182,0.35); color:#F9A8D4; font-size:0.78rem; line-height:1.4; }
        .anim-expired-banner { margin-top:12px; padding:12px 14px; border-radius:12px; background:rgba(251,191,36,0.1); border:1px solid rgba(251,191,36,0.35); color:#FCD34D; font-size:0.78rem; line-height:1.4; }
        .anim-ref-url { flex:1; background:#1E293B; border:1px solid rgba(255,255,255,0.1); color:#E2E8F0; border-radius:8px; padding:7px 9px; font-size:0.72rem; font-family:inherit; }
        .anim-btn { width:100%; padding:10px 14px; border:none; border-radius:10px; background:linear-gradient(135deg,#7C3AED,#5B21B6); color:#fff; font-weight:700; font-size:0.82rem; cursor:pointer; font-family:inherit; }
        .anim-btn:disabled { opacity:0.5; cursor:not-allowed; }
        .anim-btn--ghost { background:transparent; border:1px solid rgba(255,255,255,0.15); color:#CBD5E1; width:auto; }
        .anim-msg { padding:10px 12px; border-radius:12px; max-width:100%; }
        .anim-msg--user { background:rgba(124,58,237,0.18); border:1px solid rgba(124,58,237,0.3); align-self:flex-end; }
        .anim-msg--agent { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); }
        .anim-msg__role { font-size:0.65rem; font-weight:700; color:#A78BFA; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.04em; }
        .anim-msg__text { font-size:0.82rem; color:#E2E8F0; line-height:1.45; white-space:pre-wrap; }
        .anim-empty { max-width:420px; margin:8vh auto 0; text-align:center; }
        .anim-empty__title { font-size:1.35rem; font-weight:800; color:#F8FAFC; margin-bottom:8px; }
        .anim-empty__desc { font-size:0.88rem; color:rgba(255,255,255,0.55); line-height:1.5; margin-bottom:12px; }
        .anim-empty__hint { font-size:0.75rem; color:rgba(167,139,250,0.85); }
        .anim-recent { max-width:520px; margin:28px auto 0; text-align:left; }
        .anim-recent__list { display:flex; flex-direction:column; gap:8px; }
        .anim-recent__row { display:flex; align-items:stretch; gap:6px; }
        .anim-recent__item { display:flex; align-items:center; justify-content:space-between; gap:12px; flex:1; text-align:left; padding:12px 14px; border-radius:12px; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.03); color:#E2E8F0; cursor:pointer; font-family:inherit; }
        .anim-recent__item:hover { border-color:rgba(167,139,250,0.45); background:rgba(124,58,237,0.12); }
        .anim-recent__del { width:auto !important; padding:0 12px !important; font-size:0.85rem !important; opacity:0.55; }
        .anim-recent__del:hover { opacity:1; color:#FCA5A5 !important; }
        .anim-recent__title { font-size:0.85rem; font-weight:650; color:#F8FAFC; }
        .anim-recent__meta { display:flex; align-items:center; gap:8px; flex-shrink:0; }
        .anim-recent__mode { font-size:0.65rem; color:rgba(255,255,255,0.4); text-transform:uppercase; letter-spacing:0.04em; }
        .anim-canvas-top { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; }
        .anim-section { margin-bottom:22px; }
        .anim-section__label { font-size:0.68rem; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:rgba(255,255,255,0.35); margin-bottom:10px; }
        .anim-strip { display:flex; gap:10px; overflow-x:auto; padding-bottom:4px; }
        .anim-tile { width:110px; flex:0 0 auto; }
        .anim-tile img, .anim-shot__media img, .anim-shot__media video { width:100%; aspect-ratio:1; object-fit:cover; border-radius:10px; background:#1E293B; display:block; }
        .anim-shot__media video { aspect-ratio:9/16; max-height:220px; }
        .anim-tile__ph { width:100%; aspect-ratio:1; border-radius:10px; background:rgba(255,255,255,0.04); border:1px dashed rgba(255,255,255,0.12); display:flex; align-items:center; justify-content:center; color:rgba(255,255,255,0.35); font-size:0.7rem; }
        .anim-tile__ph--gen { border:none; position:relative; overflow:hidden; color:#F8FAFC; font-size:0.72rem; font-weight:700; letter-spacing:0.04em; text-transform:uppercase;
          background: linear-gradient(120deg, #1E293B 0%, #312E81 35%, #7C3AED 55%, #1E293B 100%);
          background-size: 220% 220%;
          animation: animShimmer 2.4s ease-in-out infinite; }
        .anim-tile__ph--gen::after { content:''; position:absolute; inset:0; background:linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.18) 50%, transparent 60%); background-size:200% 100%; animation: animSheen 1.8s linear infinite; pointer-events:none; }
        .anim-tile__gen-label { position:relative; z-index:1; text-shadow:0 1px 8px rgba(0,0,0,0.45); }
        .anim-tile__ph--fail { border-style:solid; border-color:rgba(248,113,113,0.35); color:#FCA5A5; background:rgba(248,113,113,0.08); }
        @keyframes animShimmer { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
        @keyframes animSheen { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
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
            <div style="display:flex;gap:8px;align-items:center;">
              <button type="button" class="anim-btn anim-btn--ghost" id="anim-home" style="padding:7px 12px;font-size:0.72rem;" title="Back to start">Home</button>
              <button type="button" class="anim-btn anim-btn--ghost" id="anim-new" style="padding:7px 12px;font-size:0.72rem;">New project</button>
            </div>
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
            <div class="anim-row" style="margin-top:8px;">
              <select id="anim-motion" class="anim-select" title="Motion" style="flex:1;">${motionOptions()}</select>
            </div>
            <div id="anim-motion-hint" style="font-size:0.68rem;color:rgba(255,255,255,0.4);line-height:1.4;margin:6px 0 8px;">${esc(motionHint())}</div>
            <div id="anim-drive-wrap" hidden style="margin-bottom:10px;">
              <input type="file" id="anim-drive-file" accept="video/*" hidden />
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <button type="button" class="anim-btn anim-btn--ghost" id="anim-drive-upload" style="padding:7px 10px;font-size:0.72rem;width:auto;">Upload driving video</button>
                <span id="anim-drive-status" style="font-size:0.68rem;color:rgba(255,255,255,0.4);">No driving video yet</span>
              </div>
              ${_project?.driving_video_url ? `<video src="${esc(mediaSrc(_project.driving_video_url))}" muted playsinline controls style="margin-top:8px;width:100%;max-height:120px;border-radius:8px;background:#000;"></video>` : ''}
            </div>
            ${!(_meta?.providers?.fal_configured) ? `<div style="font-size:0.65rem;color:#FCD34D;margin:-2px 0 10px;line-height:1.35;">DreamActor needs FAL_KEY on the API — without it, Auto falls back to Kling only.</div>` : ''}
            <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin:0 0 6px;">Identity</div>
            <select id="anim-identity" class="anim-select" title="Identity source" style="width:100%;margin-bottom:8px;">
              <option value="upload" ${(_project?.identity_source || 'upload') !== 'generate' ? 'selected' : ''}>Use Char upload as lock (OiiOii sheets)</option>
              <option value="generate" ${_project?.identity_source === 'generate' ? 'selected' : ''}>Regenerate sheet with Soul</option>
            </select>
            <div style="font-size:0.65rem;color:rgba(255,255,255,0.38);line-height:1.35;margin:-2px 0 10px;">For finished OiiOii sheets keep “Use Char upload” — Soul was redesigning the character.</div>
            <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin:0 0 6px;">References <span style="font-weight:500;text-transform:none;letter-spacing:0;opacity:0.7;">— Character = your person · or prompt to create one</span></div>
            <div class="anim-refs" id="anim-refs"></div>
            <div class="anim-ref-tools">
              <input type="file" id="anim-ref-file" accept="image/*" multiple hidden />
              <button type="button" class="anim-btn anim-btn--ghost" id="anim-ref-upload" style="padding:7px 10px;font-size:0.72rem;width:auto;white-space:nowrap;">Upload</button>
              <input type="url" id="anim-ref-url" class="anim-ref-url" placeholder="Paste image URL…" />
              <button type="button" class="anim-btn anim-btn--ghost" id="anim-ref-add-url" style="padding:7px 10px;font-size:0.72rem;width:auto;">Add</button>
            </div>
            <textarea id="anim-prompt" class="anim-prompt" placeholder="Describe a character, scene, product, or full video idea…"></textarea>
            <button type="button" class="anim-btn" id="anim-send">Send to Claude</button>
          </div>
        </aside>
      </div>
    `;

    document.getElementById('anim-send')?.addEventListener('click', sendPrompt);
    document.getElementById('anim-new')?.addEventListener('click', newProject);
    document.getElementById('anim-home')?.addEventListener('click', goHome);
    document.getElementById('anim-ref-upload')?.addEventListener('click', () => document.getElementById('anim-ref-file')?.click());
    document.getElementById('anim-ref-file')?.addEventListener('change', async (e) => {
      const files = [...(e.target.files || [])];
      for (const f of files) await uploadRefFile(f);
      e.target.value = '';
    });
    document.getElementById('anim-ref-add-url')?.addEventListener('click', addRefUrl);
    document.getElementById('anim-ref-url')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addRefUrl(); }
    });
    document.getElementById('anim-prompt')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendPrompt();
    });
    document.getElementById('anim-motion')?.addEventListener('change', async () => {
      if (_project) _project.motion_mode = document.getElementById('anim-motion').value;
      renderDriveControls();
      if (_project?.id) await syncMotionSettings();
    });
    document.getElementById('anim-identity')?.addEventListener('change', async () => {
      if (_project) _project.identity_source = document.getElementById('anim-identity').value;
      if (_project?.id) await syncMotionSettings();
    });
    document.getElementById('anim-drive-upload')?.addEventListener('click', () => document.getElementById('anim-drive-file')?.click());
    document.getElementById('anim-drive-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (file) await uploadDrivingVideo(file);
      e.target.value = '';
    });
    renderDriveControls();
    // Restore refs from resumed project (prefer role-tagged references)
    if (!_refs.length) {
      if (_project?.references?.length) {
        _refs = _project.references.map((r) => ({
          url: r.url,
          title: r.title || 'Ref',
          role: r.role || 'character',
        }));
      } else if (_project?.reference_urls?.length) {
        _refs = _project.reference_urls.map((url, i) => ({
          url,
          title: 'Ref',
          role: i === 0 ? 'character' : i === 1 ? 'style' : 'scene',
        }));
      } else if (_project?.character_ref_url) {
        _refs = [{ url: _project.character_ref_url, title: 'Ref', role: 'character' }];
      }
    }
    renderRefs();

    // Auto-resume in-flight work; never reopen projects with dead ephemeral media.
    if (_project && projectMediaExpired(_project)) {
      const deadId = _project.id;
      _project = null;
      _refs = [];
      stopPoll();
      await refreshRecent();
      if (deadId) await deleteProject(deadId, { silent: true });
    } else if (!_project) {
      await refreshRecent();
      const inflight = _recent.find((p) =>
        !projectMediaExpired(p)
        && ['developing', 'generating', 'assembling', 'brief_ready', 'character_review'].includes(p.status)
      );
      if (inflight) _project = inflight;
    } else {
      await refreshRecent();
    }
    renderCanvas();
    renderChat();
    if (_project && ['developing', 'generating', 'assembling'].includes(_project.status)) startPoll();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };
})();
