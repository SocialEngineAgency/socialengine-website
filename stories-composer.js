/* Instagram Stories composer. Loaded by portal.html; opened from the Calendar's
   "This week on Meta" card via window.openStoriesComposer({ date, story_type }). */
(function (global) {
  const FALLBACK_TYPES = [
    { id: 'tutorial', label: 'Tutorial / how-to' }, { id: 'qa', label: 'Q&A' }, { id: 'listicle', label: 'Listicle' },
    { id: 'pov', label: 'POV' }, { id: 'types_of', label: 'Types of…' }, { id: 'bts', label: 'Behind the scenes' },
    { id: 'town_hall', label: 'Town hall' }, { id: 'before_after', label: 'Before / after' }, { id: 'facts_list', label: 'Facts list' },
  ];
  const FALLBACK_STICKERS = {
    poll: { label: 'Poll' }, quiz: { label: 'Quiz' }, question: { label: 'Questions' }, add_yours: { label: 'Add Yours' },
    slider: { label: 'Emoji slider' }, link: { label: 'Link' }, music: { label: 'Music' },
  };
  const LIMITS = { min: 3, max: 8, readable: 90, hook: 60 };

  let S = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function api() { return global.API || global._seAPI || ''; }
  function headers(extra) {
    const a = global.seApi;
    return Object.assign({}, a && typeof a.headers === 'function' ? a.headers() : {}, extra || {});
  }
  function toast(msg, kind) { if (typeof global.showToast === 'function') global.showToast(msg, kind); }
  async function call(method, path, body) {
    const res = await fetch(`${api()}${path}`, {
      method,
      headers: headers(body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || `Request failed (${res.status})`);
      err.data = json;
      throw err;
    }
    return json;
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function weekStart(date) {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  function blankFrame(text) { return { text: text || '', sub: '', bg: { color: '#7C3AED', image_url: '' }, sticker: null }; }
  function storyTypes() {
    const d = global.seApi && global.seApi.data;
    return (d && Array.isArray(d.story_types) && d.story_types.length) ? d.story_types : FALLBACK_TYPES;
  }
  function mode(draft) { return draft.frames.some((f) => f.sticker) ? 'phone' : 'auto'; }
  function fontPx(text) {
    const n = String(text || '').length;
    const base = n <= 30 ? 96 : n <= 60 ? 80 : n <= 90 ? 68 : 56;
    return Math.round(base * (240 / 1080));
  }

  function localIssues(draft) {
    const out = [];
    const n = draft.frames.length;
    if (n < LIMITS.min || n > LIMITS.max) out.push(`Use ${LIMITS.min}–${LIMITS.max} frames (now ${n}).`);
    if (!draft.frames[0] || !draft.frames[0].text.trim()) out.push('Frame 1 needs a hook line.');
    draft.frames.forEach((f, i) => {
      const s = f.sticker;
      if (s && (s.type === 'poll' || s.type === 'quiz') && (s.options || []).filter((o) => o.trim()).length < 2) out.push(`Frame ${i + 1}: add at least 2 options.`);
      if (s && s.type === 'link' && !/^https?:\/\//.test(s.url || '')) out.push(`Frame ${i + 1}: the Link sticker needs a full URL.`);
    });
    return out;
  }

  function ensureStyles() {
    if (document.getElementById('sc-styles')) return;
    const st = document.createElement('style');
    st.id = 'sc-styles';
    st.textContent = `
      .sc-overlay{position:fixed;inset:0;background:rgba(3,7,18,.72);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px}
      .sc-modal{width:min(1040px,100%);max-height:92vh;overflow:auto;background:#0B1120;border:1px solid #243049;border-radius:16px;color:#E2E8F0;font-family:var(--font-body,system-ui)}
      .sc-head{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.06)}
      .sc-tabs{display:inline-flex;border:1px solid rgba(255,255,255,.1);border-radius:8px;overflow:hidden}
      .sc-tab{padding:6px 12px;font-size:.78rem;font-weight:600;background:transparent;border:0;color:rgba(255,255,255,.6);cursor:pointer}
      .sc-tab.is-on{background:#7C3AED;color:#fff}
      .sc-x{background:transparent;border:0;color:rgba(255,255,255,.6);font-size:1.2rem;cursor:pointer}
      .sc-body{display:grid;grid-template-columns:1fr 280px;gap:18px;padding:16px 18px}
      .sc-row{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px}
      .sc-row label{display:flex;flex-direction:column;gap:4px;font-size:.7rem;color:rgba(255,255,255,.55)}
      .sc-in,.sc-sel,.sc-ta{background:#111A2E;border:1px solid #243049;border-radius:8px;color:#fff;padding:7px 9px;font-size:.82rem;font-family:inherit}
      .sc-ta{width:100%;min-height:62px;resize:vertical}
      .sc-btn{padding:7px 12px;border-radius:8px;border:1px solid #243049;background:transparent;color:#E2E8F0;font-size:.78rem;font-weight:600;cursor:pointer}
      .sc-btn--pri{background:#7C3AED;border-color:#7C3AED;color:#fff}
      .sc-btn:disabled{opacity:.5;cursor:default}
      .sc-frames{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px}
      .sc-fchip{min-width:34px;padding:6px 8px;border-radius:8px;border:1px solid #243049;background:transparent;color:#fff;font-size:.75rem;cursor:pointer}
      .sc-fchip.is-on{border-color:#A78BFA;background:rgba(124,58,237,.18)}
      .sc-fchip .sc-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#FBBF24;margin-left:4px;vertical-align:middle}
      .sc-count{font-size:.66rem;color:rgba(255,255,255,.4);text-align:right}
      .sc-count.is-warn{color:#FBBF24}
      .sc-mode{font-size:.7rem;font-weight:700;padding:3px 8px;border-radius:99px}
      .sc-mode--auto{background:rgba(34,197,94,.12);color:#4ADE80}
      .sc-mode--phone{background:rgba(245,158,11,.12);color:#FBBF24}
      .sc-msgs{font-size:.74rem;margin-top:8px}
      .sc-msgs .err{color:#F87171}.sc-msgs .warn{color:#FBBF24}
      .sc-phone{position:relative;width:240px;height:427px;border-radius:18px;overflow:hidden;border:1px solid #243049;background-size:cover;background-position:center}
      .sc-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.25),rgba(0,0,0,.55) 50%,rgba(0,0,0,.35))}
      .sc-safe{position:absolute;left:0;right:0;border-top:1px dashed rgba(255,255,255,.25)}
      .sc-ptext{position:absolute;left:20px;right:20px;transform:translateY(-50%);text-align:center;color:#fff;font-weight:700;line-height:1.15;font-family:Inter,system-ui}
      .sc-psub{display:block;font-weight:400;font-size:10px;color:#E2E8F0;margin-top:8px}
      .sc-psticker{position:absolute;left:40px;right:40px;top:56%;border:1.5px dashed rgba(251,191,36,.8);border-radius:10px;padding:8px;font-size:10px;color:#FBBF24;text-align:center;background:rgba(0,0,0,.25)}
      .sc-list{padding:16px 18px;display:flex;flex-direction:column;gap:12px}
      .sc-card{border:1px solid #243049;border-radius:12px;padding:12px}
      .sc-thumbs{display:flex;gap:6px;margin:8px 0}
      .sc-thumbs img{width:54px;height:96px;object-fit:cover;border-radius:6px;border:1px solid #243049}
      .sc-check{font-size:.76rem;color:rgba(255,255,255,.75);margin:8px 0 0 18px}
      .sc-check li{margin-bottom:4px}
      @media (max-width:820px){.sc-body{grid-template-columns:1fr}}
    `;
    document.head.appendChild(st);
  }

  function previewHtml(frame, idx, total) {
    const hasImg = !!(frame.bg && frame.bg.image_url);
    const bg = hasImg
      ? `background-image:url('${esc(frame.bg.image_url)}')`
      : `background:linear-gradient(160deg, ${esc((frame.bg && frame.bg.color) || '#7C3AED')}, #0A1628)`;
    const top = frame.sticker ? (640 / 1920) * 100 : (900 / 1920) * 100;
    const st = frame.sticker;
    const stLabel = st ? ((S.stickers[st.type] || {}).label || st.type) : '';
    return `<div class="sc-phone" id="sc-preview" style="${bg}">
      ${hasImg ? '<div class="sc-scrim"></div>' : ''}
      <div class="sc-safe" style="top:${(260 / 1920) * 100}%" title="Instagram covers above this line"></div>
      <div class="sc-safe" style="top:${(1580 / 1920) * 100}%" title="Reply bar covers below this line"></div>
      <div class="sc-ptext" style="top:${top}%;font-size:${fontPx(frame.text)}px">${esc(frame.text || (idx === 0 ? 'Your hook goes here' : ''))}${frame.sub ? `<span class="sc-psub">${esc(frame.sub)}</span>` : ''}</div>
      ${st ? `<div class="sc-psticker">${esc(stLabel)} sticker — added in the Instagram app${st.prompt ? `<br>“${esc(st.prompt)}”` : ''}</div>` : ''}
    </div>
    <div style="font-size:.68rem;color:rgba(255,255,255,.4);margin-top:6px">Frame ${idx + 1} of ${total} · dashed lines = Instagram's header and reply bar</div>`;
  }

  function stickerFields(st) {
    if (!st) return '';
    const opts = st.options || [];
    const optInputs = (n) => Array.from({ length: n }, (_, i) => `<input class="sc-in" data-sc-opt="${i}" value="${esc(opts[i] || '')}" placeholder="Option ${i + 1}" maxlength="24" style="width:110px">`).join('');
    let extra = '';
    if (st.type === 'poll') extra = optInputs(2);
    if (st.type === 'quiz') extra = `${optInputs(4)}<label>Right answer<select class="sc-sel" data-sc-correct>${[0, 1, 2, 3].map((i) => `<option value="${i}" ${Number(st.correct) === i ? 'selected' : ''}>Option ${i + 1}</option>`).join('')}</select></label>`;
    if (st.type === 'slider') extra = `<input class="sc-in" data-sc-emoji value="${esc(st.emoji || '😍')}" style="width:56px">`;
    if (st.type === 'link') extra = `<input class="sc-in" data-sc-url value="${esc(st.url || '')}" placeholder="https://…" style="flex:1;min-width:200px">`;
    const prompt = st.type === 'link' ? '' : `<input class="sc-in" data-sc-prompt value="${esc(st.prompt || '')}" placeholder="${st.type === 'music' ? 'Mood or track idea' : 'Question or prompt'}" maxlength="100" style="flex:1;min-width:200px">`;
    return `<div class="sc-row">${prompt}${extra}</div>`;
  }

  function composeHtml() {
    const d = S.draft;
    const f = d.frames[S.sel] || blankFrame();
    const types = storyTypes();
    const m = mode(d);
    const issues = localIssues(d);
    const v = S.validation;
    const msgs = [
      ...issues.map((x) => `<div class="err">• ${esc(x)}</div>`),
      ...((v && v.errors) || []).filter((x) => !issues.includes(x)).map((x) => `<div class="err">• ${esc(x)}</div>`),
      ...((v && v.warnings) || []).map((x) => `<div class="warn">• ${esc(x)}</div>`),
    ].join('');
    const len = f.text.length;
    const warnLen = S.sel === 0 ? LIMITS.hook : LIMITS.readable;
    return `<div class="sc-body">
      <div>
        <div class="sc-row">
          <label>Story type<select class="sc-sel" id="sc-type"><option value="">Let AI pick</option>${types.map((t) => `<option value="${esc(t.id)}" ${d.story_type === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
          <label style="flex:1;min-width:200px">Topic<input class="sc-in" id="sc-topic" value="${esc(d.topic || '')}" placeholder="What is this Story about?"></label>
          <label>Frames<input class="sc-in" id="sc-n" type="number" min="3" max="8" value="${Math.max(3, Math.min(8, d.frames.length || 5))}" style="width:60px"></label>
          <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="sc-allow" ${S.allowStickers ? 'checked' : ''}> Stickers</label>
          <button type="button" class="sc-btn sc-btn--pri" id="sc-ai" ${S.busy ? 'disabled' : ''}>${S.busy === 'draft' ? 'Drafting…' : 'Draft with AI'}</button>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="sc-frames" id="sc-frames">${d.frames.map((fr, i) => `<button type="button" class="sc-fchip${i === S.sel ? ' is-on' : ''}" data-sc-frame="${i}">${i + 1}${fr.sticker ? '<span class="sc-dot"></span>' : ''}</button>`).join('')}
            ${d.frames.length < LIMITS.max ? '<button type="button" class="sc-fchip" id="sc-add" title="Add frame">+</button>' : ''}</div>
          <span class="sc-mode sc-mode--${m}" id="sc-mode">${m === 'auto' ? 'Auto-publish' : 'Post from phone (has stickers)'}</span>
        </div>
        <label style="font-size:.7rem;color:rgba(255,255,255,.55)">${S.sel === 0 ? 'Hook (frame 1)' : `Frame ${S.sel + 1} text`}</label>
        <textarea class="sc-ta" id="sc-text" maxlength="140">${esc(f.text)}</textarea>
        <div class="sc-count${len > warnLen ? ' is-warn' : ''}" id="sc-count">${len}/${warnLen}</div>
        <div class="sc-row">
          <label style="flex:1;min-width:200px">Sub line (optional)<input class="sc-in" id="sc-sub" value="${esc(f.sub)}" maxlength="120"></label>
          <label>Colour<input class="sc-in" id="sc-color" type="color" value="${esc(f.bg.color || '#7C3AED')}" style="width:52px;padding:2px"></label>
          <label style="flex:1;min-width:200px">Background image URL<input class="sc-in" id="sc-img" value="${esc(f.bg.image_url)}" placeholder="https://… (optional)"></label>
        </div>
        <div class="sc-row">
          <label>Sticker<select class="sc-sel" id="sc-sticker"><option value="">None</option>${Object.keys(S.stickers).map((k) => `<option value="${k}" ${f.sticker && f.sticker.type === k ? 'selected' : ''}>${esc(S.stickers[k].label)}</option>`).join('')}</select></label>
          <button type="button" class="sc-btn" id="sc-left" ${S.sel === 0 ? 'disabled' : ''}>← Move</button>
          <button type="button" class="sc-btn" id="sc-right" ${S.sel >= d.frames.length - 1 ? 'disabled' : ''}>Move →</button>
          <button type="button" class="sc-btn" id="sc-del" ${d.frames.length <= 1 ? 'disabled' : ''}>Remove frame</button>
        </div>
        <div id="sc-sticker-fields">${stickerFields(f.sticker)}</div>
        <div class="sc-row">
          <label>Highlight name<input class="sc-in" id="sc-hl" value="${esc(d.highlight.name || '')}" maxlength="15" placeholder="e.g. How to" style="width:140px"></label>
          <label>Date<input class="sc-in" id="sc-date" type="date" value="${esc(S.date)}"></label>
          <label>Time<input class="sc-in" id="sc-time" type="time" value="${esc(S.time)}"></label>
          <button type="button" class="sc-btn sc-btn--pri" id="sc-save" ${S.busy || issues.length ? 'disabled' : ''}>${S.busy === 'save' ? 'Rendering frames…' : (S.editingId ? 'Save changes' : 'Save Story')}</button>
        </div>
        <div class="sc-msgs" id="sc-msgs">${msgs}</div>
      </div>
      <div>${previewHtml(f, S.sel, d.frames.length)}</div>
    </div>`;
  }

  function cardHtml(s) {
    const posted = s.status === 'Published';
    const thumbs = (s.frame_urls || []).slice(0, 8).map((u, i) => `<img src="${esc(u)}" alt="Frame ${i + 1}" loading="lazy">`).join('');
    const label = (storyTypes().find((t) => t.id === s.draft.story_type) || {}).label || 'Story';
    let actions = '';
    if (!posted && s.mode === 'phone') {
      actions = `<button type="button" class="sc-btn" data-sc-dl="${s.id}">Download frames</button>
        <button type="button" class="sc-btn sc-btn--pri" data-sc-posted="${s.id}">Mark as posted</button>
        <button type="button" class="sc-btn" data-sc-edit="${s.id}">Edit</button>`;
    } else if (!posted) {
      const queued = ['Approved', 'Scheduled', 'Publishing'].includes(s.status);
      actions = `${queued ? '' : `<button type="button" class="sc-btn sc-btn--pri" data-sc-now="${s.id}">Post now</button>
        <button type="button" class="sc-btn" data-sc-approve="${s.id}">Approve for ${esc(s.date)}</button>`}
        <button type="button" class="sc-btn" data-sc-edit="${s.id}">Edit</button>`;
    }
    const progress = !posted && s.published_count ? ` · ${s.published_count}/${s.frame_urls.length} frames posted` : '';
    return `<div class="sc-card" data-sc-story="${s.id}">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
        <div><strong>${esc(label)}</strong> <span style="font-size:.72rem;color:rgba(255,255,255,.5)">${esc(s.date)}${s.time ? ' ' + esc(s.time) : ''} · ${esc(s.status)}${progress}</span></div>
        <span class="sc-mode sc-mode--${s.mode}">${s.mode === 'auto' ? 'Auto-publish' : 'Post from phone'}</span>
      </div>
      <div class="sc-thumbs">${thumbs}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${actions}</div>
      ${!posted && s.mode === 'phone' && s.checklist.length ? `<ol class="sc-check">${s.checklist.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>` : ''}
    </div>`;
  }

  function listHtml() {
    const items = S.stories || [];
    const ws = weekStart(S.date);
    return `<div class="sc-list" id="sc-list">
      <div style="font-size:.74rem;color:rgba(255,255,255,.5)">Week of ${esc(ws)} · Stories made here count toward your plan. Stories posted straight from Instagram aren't counted.</div>
      ${items.length ? items.map(cardHtml).join('') : '<div style="font-size:.8rem;color:rgba(255,255,255,.5)">No Stories this week yet.</div>'}
    </div>`;
  }

  function render() {
    const root = document.getElementById('sc-root');
    if (!root) return;
    root.innerHTML = `<div class="sc-modal" role="dialog" aria-label="Stories">
      <div class="sc-head">
        <div style="display:flex;gap:12px;align-items:center"><strong>Instagram Stories</strong>
          <div class="sc-tabs"><button type="button" class="sc-tab${S.view === 'compose' ? ' is-on' : ''}" data-sc-view="compose">${S.editingId ? 'Edit Story' : 'New Story'}</button><button type="button" class="sc-tab${S.view === 'list' ? ' is-on' : ''}" data-sc-view="list">This week</button></div>
        </div>
        <button type="button" class="sc-x" id="sc-close" aria-label="Close">×</button>
      </div>
      ${S.view === 'compose' ? composeHtml() : listHtml()}
    </div>`;
    bind(root);
  }

  function refreshIssues() {
    const issues = localIssues(S.draft);
    const btn = document.getElementById('sc-save');
    if (btn) btn.disabled = !!(S.busy || issues.length);
    const box = document.getElementById('sc-msgs');
    if (box) {
      const v = S.validation;
      box.innerHTML = [
        ...issues.map((x) => `<div class="err">• ${esc(x)}</div>`),
        ...((v && v.warnings) || []).map((x) => `<div class="warn">• ${esc(x)}</div>`),
      ].join('');
    }
  }

  function rerenderPreview() {
    refreshIssues();
    const f = S.draft.frames[S.sel];
    const wrap = document.getElementById('sc-preview');
    if (wrap && f) wrap.parentElement.innerHTML = previewHtml(f, S.sel, S.draft.frames.length);
    const cnt = document.getElementById('sc-count');
    if (cnt && f) {
      const warnLen = S.sel === 0 ? LIMITS.hook : LIMITS.readable;
      cnt.textContent = `${f.text.length}/${warnLen}`;
      cnt.classList.toggle('is-warn', f.text.length > warnLen);
    }
  }

  function bind(root) {
    root.querySelector('#sc-close')?.addEventListener('click', close);
    root.querySelectorAll('[data-sc-view]').forEach((b) => b.addEventListener('click', () => {
      S.view = b.dataset.scView;
      if (S.view === 'list') loadList(); else render();
    }));
    if (S.view === 'compose') bindCompose(root); else bindList(root);
  }

  function bindCompose(root) {
    const d = S.draft;
    const f = () => d.frames[S.sel];
    const on = (id, ev, fn) => root.querySelector(id)?.addEventListener(ev, fn);
    on('#sc-type', 'change', (e) => { d.story_type = e.target.value; });
    on('#sc-topic', 'input', (e) => { d.topic = e.target.value; });
    on('#sc-allow', 'change', (e) => { S.allowStickers = e.target.checked; });
    on('#sc-text', 'input', (e) => { f().text = e.target.value; rerenderPreview(); });
    on('#sc-sub', 'input', (e) => { f().sub = e.target.value; rerenderPreview(); });
    on('#sc-color', 'input', (e) => { f().bg.color = e.target.value; rerenderPreview(); });
    on('#sc-img', 'change', (e) => { f().bg.image_url = e.target.value.trim(); rerenderPreview(); });
    on('#sc-hl', 'input', (e) => { d.highlight.name = e.target.value; });
    on('#sc-date', 'change', (e) => { S.date = e.target.value; });
    on('#sc-time', 'change', (e) => { S.time = e.target.value; });
    on('#sc-sticker', 'change', (e) => {
      const t = e.target.value;
      f().sticker = t ? { type: t, prompt: '', options: t === 'quiz' ? ['', '', '', ''] : ['', ''], correct: 0, emoji: '😍', url: '' } : null;
      S.validation = null;
      render();
    });
    const sf = root.querySelector('#sc-sticker-fields');
    if (sf) {
      sf.addEventListener('input', (e) => {
        const st = f().sticker;
        if (!st) return;
        const t = e.target;
        if (t.dataset.scPrompt !== undefined) st.prompt = t.value;
        if (t.dataset.scOpt !== undefined) st.options[Number(t.dataset.scOpt)] = t.value;
        if (t.dataset.scEmoji !== undefined) st.emoji = t.value;
        if (t.dataset.scUrl !== undefined) st.url = t.value.trim();
        rerenderPreview();
      });
      sf.addEventListener('change', (e) => {
        if (e.target.dataset.scCorrect !== undefined && f().sticker) f().sticker.correct = Number(e.target.value);
        render();
      });
    }
    root.querySelectorAll('[data-sc-frame]').forEach((b) => b.addEventListener('click', () => { S.sel = Number(b.dataset.scFrame); render(); }));
    on('#sc-add', 'click', () => { d.frames.push(blankFrame()); S.sel = d.frames.length - 1; render(); });
    on('#sc-del', 'click', () => { d.frames.splice(S.sel, 1); S.sel = Math.max(0, S.sel - 1); render(); });
    on('#sc-left', 'click', () => { const i = S.sel; [d.frames[i - 1], d.frames[i]] = [d.frames[i], d.frames[i - 1]]; S.sel = i - 1; render(); });
    on('#sc-right', 'click', () => { const i = S.sel; [d.frames[i + 1], d.frames[i]] = [d.frames[i], d.frames[i + 1]]; S.sel = i + 1; render(); });
    on('#sc-ai', 'click', draftWithAi);
    on('#sc-save', 'click', save);
  }

  function cleanDraft() {
    const d = S.draft;
    return {
      story_type: d.story_type,
      goal: d.goal,
      topic: d.topic,
      highlight: { name: d.highlight.name || '', cover_text: d.highlight.cover_text || '' },
      frames: d.frames.map((f) => {
        let st = f.sticker;
        if (st) {
          st = { ...st, options: (st.options || []).map((o) => String(o || '').trim()).filter(Boolean) };
          if (st.type === 'quiz' && st.correct >= st.options.length) st.correct = 0;
        }
        return { text: f.text.trim(), sub: f.sub.trim(), bg: { ...f.bg }, sticker: st };
      }),
    };
  }

  function adoptDraft(draft) {
    S.draft = {
      story_type: draft.story_type || '',
      goal: draft.goal || 'grow',
      topic: draft.topic || '',
      highlight: { name: (draft.highlight && draft.highlight.name) || '', cover_text: (draft.highlight && draft.highlight.cover_text) || '' },
      frames: (draft.frames || []).map((f) => ({
        text: f.text || '',
        sub: f.sub || '',
        bg: { color: (f.bg && f.bg.color) || '#7C3AED', image_url: (f.bg && f.bg.image_url) || '' },
        sticker: f.sticker ? { prompt: '', options: [], correct: 0, emoji: '😍', url: '', ...f.sticker, options: (f.sticker.options || []).concat(['', '', '', '']).slice(0, f.sticker.type === 'quiz' ? 4 : 2) } : null,
      })),
    };
    if (!S.draft.frames.length) S.draft.frames = [blankFrame(), blankFrame(), blankFrame()];
    S.sel = 0;
  }

  async function draftWithAi() {
    const n = Number(document.getElementById('sc-n')?.value) || 5;
    S.busy = 'draft';
    render();
    try {
      const out = await call('POST', '/api/stories/draft', {
        story_type: S.draft.story_type, topic: S.draft.topic, frames: n, allow_stickers: S.allowStickers, date: S.date,
      });
      adoptDraft({ ...out.draft, topic: S.draft.topic || out.draft.topic });
      S.validation = out.validation || null;
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      S.busy = null;
      render();
    }
  }

  async function save() {
    S.busy = 'save';
    render();
    try {
      const body = { draft: cleanDraft(), date: S.date, time: S.time };
      const out = S.editingId ? await call('PUT', `/api/stories/${S.editingId}`, body) : await call('POST', '/api/stories', body);
      toast(out.story.mode === 'phone' ? 'Story saved — download the frames and post from your phone.' : 'Story saved — approve it to publish.', 'success');
      S.editingId = null;
      S.validation = null;
      adoptDraft({ frames: [] });
      S.view = 'list';
      if (typeof global.onStoriesChanged === 'function') global.onStoriesChanged();
      await loadList();
    } catch (e) {
      if (e.data && e.data.validation) S.validation = e.data.validation;
      toast(e.message, 'error');
    } finally {
      S.busy = null;
      if (S.view === 'compose') render();
    }
  }

  async function loadList() {
    try {
      const out = await call('GET', `/api/stories?week=${encodeURIComponent(weekStart(S.date))}`);
      S.stories = out.stories || [];
      if (out.stickers) S.stickers = out.stickers;
    } catch (e) {
      S.stories = [];
      toast(e.message, 'error');
    }
    render();
  }

  async function download(story) {
    for (let i = 0; i < story.frame_urls.length; i++) {
      const url = story.frame_urls[i];
      try {
        const blob = await (await fetch(url)).blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `story-${story.date}-frame-${i + 1}.jpg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } catch (_) {
        global.open(url, '_blank', 'noopener');
      }
    }
  }

  function bindList(root) {
    const find = (id) => (S.stories || []).find((s) => s.id === id);
    root.querySelectorAll('[data-sc-dl]').forEach((b) => b.addEventListener('click', () => download(find(b.dataset.scDl))));
    root.querySelectorAll('[data-sc-edit]').forEach((b) => b.addEventListener('click', () => {
      const s = find(b.dataset.scEdit);
      if (!s) return;
      adoptDraft(s.draft);
      S.editingId = s.id;
      S.date = s.date || S.date;
      S.time = String(s.time || '').slice(0, 5) || S.time;
      S.validation = null;
      S.view = 'compose';
      render();
    }));
    root.querySelectorAll('[data-sc-posted]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await call('POST', `/api/stories/${b.dataset.scPosted}/mark-posted`);
        toast('Marked as posted.', 'success');
        if (typeof global.onStoriesChanged === 'function') global.onStoriesChanged();
        await loadList();
      } catch (e) { toast(e.message, 'error'); b.disabled = false; }
    }));
    const approve = async (b, publishNow) => {
      b.disabled = true;
      try {
        const out = await call('POST', '/api/approve-post', { postId: b.dataset.scNow || b.dataset.scApprove, publishNow });
        toast(out.message || 'Approved.', 'success');
        if (typeof global.onStoriesChanged === 'function') global.onStoriesChanged();
        await loadList();
      } catch (e) { toast(e.message, 'error'); b.disabled = false; }
    };
    root.querySelectorAll('[data-sc-now]').forEach((b) => b.addEventListener('click', () => approve(b, true)));
    root.querySelectorAll('[data-sc-approve]').forEach((b) => b.addEventListener('click', () => approve(b, false)));
  }

  function close() {
    document.getElementById('sc-root')?.remove();
    document.removeEventListener('keydown', onKey);
    S = null;
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function openStoriesComposer(opts) {
    const o = opts || {};
    ensureStyles();
    close();
    S = {
      view: o.view === 'list' ? 'list' : 'compose',
      sel: 0,
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(o.date || '')) ? o.date : today(),
      time: '09:00',
      allowStickers: true,
      stickers: FALLBACK_STICKERS,
      stories: [],
      editingId: null,
      validation: null,
      busy: null,
      draft: null,
    };
    adoptDraft({ story_type: o.story_type || '', goal: o.goal, frames: [] });
    const root = document.createElement('div');
    root.id = 'sc-root';
    root.className = 'sc-overlay';
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    document.body.appendChild(root);
    document.addEventListener('keydown', onKey);
    if (S.view === 'list') loadList(); else render();
  }

  global.openStoriesComposer = openStoriesComposer;
})(typeof window !== 'undefined' ? window : globalThis);
