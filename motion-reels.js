/* Motion Reels (HyperFrames render worker on the API side).
   window.seOpenMotionReel({ kind: 'carousel', slides: [url], name })  — carousel → animated vertical Reel
   window.seOpenMotionReel({ kind: 'text'|'faceless', text, name }) — text Reel or voiceover + footage Reel
   A "Make a Reel" button (text on screen, or voiceover + footage) attaches under caption boxes. Finished videos land in Library → Motion reels. */
(function (global) {
  'use strict';

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const toast = (msg, kind) => { if (typeof global.showToast === 'function') global.showToast(msg, kind); };
  const FONT_LABELS = { inter: 'Inter (clean)', poppins: 'Poppins (friendly)', montserrat: 'Montserrat (bold)', dmsans: 'DM Sans (modern)', playfair: 'Playfair (elegant)' };

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
    if (document.getElementById('mr-styles')) return;
    const st = document.createElement('style');
    st.id = 'mr-styles';
    st.textContent = `
      .mr-overlay { position: fixed; inset: 0; z-index: 10001; background: rgba(0,0,0,0.72); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 16px; }
      .mr-modal { background: linear-gradient(135deg,#0f1a2e,#162237); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; width: min(860px, 100%); max-height: 92vh; overflow: auto; padding: 22px; color: #E2E8F0; font-family: var(--font-body, Inter, sans-serif); box-shadow: 0 24px 80px rgba(0,0,0,0.5); }
      .mr-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
      .mr-head h3 { margin: 0; font-size: 1.1rem; color: #fff; }
      .mr-x { background: none; border: none; color: rgba(148,163,184,0.7); font-size: 1.3rem; cursor: pointer; width: auto; }
      .mr-lead { font-size: 0.78rem; color: rgba(148,163,184,0.85); margin: 0 0 14px; line-height: 1.5; }
      .mr-grid { display: grid; grid-template-columns: minmax(0,1fr) 300px; gap: 20px; }
      @media (max-width: 760px) { .mr-grid { grid-template-columns: 1fr; } }
      .mr-label { display: block; font-size: 0.68rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: rgba(167,139,250,0.85); margin: 12px 0 4px; }
      .mr-input, .mr-select, .mr-text { width: 100%; box-sizing: border-box; padding: 8px 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; font-size: 0.82rem; font-family: inherit; }
      .mr-select option { background: #0f1a2e; }
      .mr-text { min-height: 120px; resize: vertical; line-height: 1.45; }
      .mr-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
      .mr-colors { display: flex; gap: 10px; align-items: center; }
      .mr-colors input[type=color] { width: 40px; height: 32px; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; background: none; padding: 0; cursor: pointer; }
      .mr-btn { padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: transparent; color: #E2E8F0; font-size: 0.78rem; font-weight: 600; cursor: pointer; font-family: inherit; width: auto; white-space: nowrap; text-decoration: none; display: inline-block; }
      .mr-btn--primary { background: linear-gradient(135deg,#7C3AED,#6D28D9); border: none; color: #fff; }
      .mr-btn:disabled { opacity: 0.5; cursor: default; }
      .mr-hint { font-size: 0.72rem; color: rgba(148,163,184,0.75); line-height: 1.45; }
      .mr-note { font-size: 0.74rem; color: #FCD34D; margin-top: 8px; }
      .mr-stage { background: #05080F; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; aspect-ratio: 9 / 16; display: flex; align-items: center; justify-content: center; overflow: hidden; }
      .mr-stage video { width: 100%; height: 100%; object-fit: contain; background: #000; }
      .mr-thumbs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
      .mr-thumbs img { width: 56px; height: 70px; object-fit: cover; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12); flex: none; }
      .mr-spin { width: 34px; height: 34px; border-radius: 50%; border: 3px solid rgba(167,139,250,0.25); border-top-color: #A78BFA; animation: mrspin 0.9s linear infinite; }
      @keyframes mrspin { to { transform: rotate(360deg); } }
      .mr-tabs { display: inline-flex; gap: 4px; padding: 3px; border-radius: 9px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); margin: 8px 0 2px; }
      .mr-tab { padding: 6px 12px; border-radius: 7px; border: none; background: transparent; color: rgba(226,232,240,0.7); font-size: 0.76rem; font-weight: 600; cursor: pointer; font-family: inherit; width: auto; }
      .mr-tab--on { background: rgba(124,58,237,0.35); color: #fff; }
      .mr-scene { display: grid; grid-template-columns: 22px 1fr 28px; gap: 6px; align-items: start; margin-bottom: 8px; }
      .mr-scene__n { font-size: 0.72rem; font-weight: 700; color: rgba(167,139,250,0.85); padding-top: 9px; text-align: center; }
      .mr-scene__search { margin-top: 4px; font-size: 0.74rem; color: rgba(186,230,253,0.9); }
      .mr-scene__del { background: none; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: rgba(248,113,113,0.8); cursor: pointer; width: 28px; height: 34px; padding: 0; }
      .mr-attach { display: inline-flex; align-items: center; gap: 4px; margin: 6px 0 0 6px; padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(34,197,94,0.35); background: rgba(34,197,94,0.08); color: #86EFAC; font-size: 0.7rem; font-weight: 600; cursor: pointer; font-family: inherit; width: auto; }
    `;
    document.head.appendChild(st);
  }

  function openMotionReel(opts = {}) {
    injectStyles();
    let kind = ['carousel', 'faceless'].includes(opts.kind) ? opts.kind : 'text';
    const slides = (opts.slides || []).filter((u) => /^https:\/\//i.test(String(u || '')));
    let scenes = [];
    let lastOptions = null;
    const ov = document.createElement('div');
    ov.className = 'mr-overlay';
    ov.innerHTML = `<div class="mr-modal" role="dialog" aria-label="Motion Reel">
      <div class="mr-head"><h3 id="mr-title"></h3><button type="button" class="mr-x" aria-label="Close">×</button></div>
      ${kind === 'carousel' ? '' : `<div class="mr-tabs" role="tablist"><button type="button" class="mr-tab" data-mode="text">Text on screen</button><button type="button" class="mr-tab" data-mode="faceless">Voiceover + footage</button></div>`}
      <p class="mr-lead" id="mr-lead"></p>
      <div class="mr-grid"><div class="mr-form"><div class="mr-hint">Loading…</div></div>
      <div><div class="mr-stage" id="mr-stage"><div class="mr-hint" style="padding:20px;text-align:center">Your Reel appears here.</div></div><div class="mr-row" id="mr-out"></div></div></div>
    </div>`;
    const close = () => { stopped = true; ov.remove(); };
    let stopped = false;
    ov.querySelector('.mr-x').addEventListener('click', close);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    const form = ov.querySelector('.mr-form');
    const stage = ov.querySelector('#mr-stage');
    const out = ov.querySelector('#mr-out');
    const COPY = {
      carousel: ['Turn this carousel into a Reel', 'Your slides animate in one after another over a soft blurred background, with a progress bar and a closing call to action.'],
      text: ['Make a Reel', 'Short lines of bold text animate in, one beat at a time. Great for tips, myths and "3 signs" posts. No images needed.'],
      faceless: ['Make a Reel', 'A voice reads your script over video clips, with captions that light up word by word. No filming needed.'],
    };

    function syncHead() {
      ov.querySelector('#mr-title').textContent = COPY[kind][0];
      ov.querySelector('#mr-lead').textContent = `${COPY[kind][1]} Takes about 20 to 90 seconds. It is saved to your Library under Motion reels.`;
      ov.querySelectorAll('.mr-tab').forEach((t) => t.classList.toggle('mr-tab--on', t.dataset.mode === kind));
    }
    syncHead();
    ov.querySelectorAll('.mr-tab').forEach((t) => t.addEventListener('click', () => {
      if (t.dataset.mode === kind) return;
      kind = t.dataset.mode;
      syncHead();
      out.innerHTML = '';
      if (lastOptions) renderForm(lastOptions);
    }));

    function scenesHtml(stock) {
      return scenes.map((s, i) => `<div class="mr-scene"><span class="mr-scene__n">${i + 1}</span>
        <div><input class="mr-input" data-scene-line="${i}" maxlength="160" value="${esc(s.line)}" placeholder="What the voice says">
        ${stock ? `<input class="mr-input mr-scene__search" data-scene-search="${i}" maxlength="60" value="${esc(s.search || '')}" placeholder="Footage to show, e.g. folding linen shirt">` : ''}</div>
        <button type="button" class="mr-scene__del" data-scene-del="${i}" aria-label="Remove line">×</button></div>`).join('');
    }

    function renderScenes() {
      const box = form.querySelector('#mr-scenes');
      if (!box) return;
      const stock = form.querySelector('#mr-footage')?.value === 'stock';
      box.innerHTML = scenesHtml(stock) || '<div class="mr-hint">Write the script, or add lines yourself.</div>';
      box.querySelectorAll('[data-scene-del]').forEach((b) => b.addEventListener('click', () => {
        scenes.splice(Number(b.dataset.sceneDel), 1);
        renderScenes();
      }));
      const add = form.querySelector('#mr-scene-add');
      if (add) add.style.display = scenes.length >= 6 ? 'none' : '';
    }

    function facelessHtml(o) {
      const fl = o.faceless || {};
      const footageOpts = [
        fl.stock ? `<option value="stock">Stock video clips (free, from ${esc(fl.stock_source || 'Pexels')})</option>` : '',
        `<option value="library" ${fl.library_media ? '' : 'disabled'}>My Library photos and videos (${esc(fl.library_media || 0)})</option>`,
      ].join('');
      return `${!fl.enabled ? '<div class="mr-note">Voiceover Reels are being switched on. Try again shortly.</div>' : ''}
        ${!fl.stock && !fl.library_media ? '<div class="mr-note">Add some photos or videos to your Library first, so the Reel has footage.</div>' : ''}
        <label class="mr-label" for="mr-idea">Idea or caption</label>
        <textarea class="mr-text" id="mr-idea" maxlength="3000" style="min-height:80px" placeholder="Why linen should never go in a hot wash">${esc(opts.text || '')}</textarea>
        <div class="mr-row" style="margin-top:6px"><button type="button" class="mr-btn" id="mr-script">Write the script for me</button><span class="mr-hint">About 20 to 30 seconds spoken.</span></div>
        <label class="mr-label" for="mr-footage">Footage</label>
        <select class="mr-select" id="mr-footage">${footageOpts}</select>
        ${fl.stock_source === 'Pixabay' ? '<div class="mr-hint" id="mr-stock-credit">Stock clips from <a href="https://pixabay.com/" target="_blank" rel="noopener noreferrer">Pixabay</a>.</div>' : ''}
        <span class="mr-label">Script, one line per scene</span>
        <div id="mr-scenes"></div>
        <button type="button" class="mr-btn" id="mr-scene-add" style="margin-top:4px">+ Add line</button>`;
    }

    async function writeScript(auto) {
      const btn = form.querySelector('#mr-script');
      const source = (form.querySelector('#mr-idea').value || '').trim();
      if (!source) { if (!auto) toast('Write the idea first', 'warning'); return; }
      btn.disabled = true; btn.textContent = 'Writing…';
      try {
        const d = await api('/api/motion/faceless/script', { method: 'POST', body: JSON.stringify({ text: source }) });
        scenes = d.scenes;
        renderScenes();
        if (d.cta && !form.querySelector('#mr-cta').value) form.querySelector('#mr-cta').value = d.cta;
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'Write the script for me';
      }
    }

    function renderForm(o) {
      lastOptions = o;
      const d = o.defaults || {};
      const p = d.palette || {};
      const fl = o.faceless || {};
      const capUsed = kind === 'faceless' ? fl.used_today || 0 : o.used_today || 0;
      const capMax = kind === 'faceless' ? fl.daily_cap || 5 : o.daily_cap || 20;
      const ready = kind === 'faceless' ? o.enabled && fl.enabled && (fl.stock || fl.library_media) : o.enabled;
      form.innerHTML = `${!o.enabled ? '<div class="mr-note">Motion videos are being switched on. Try again shortly.</div>' : ''}
        ${kind === 'faceless' ? facelessHtml(o) : kind === 'carousel' ? `<span class="mr-label">Slides (${slides.length})</span><div class="mr-thumbs">${slides.map((u) => `<img src="${esc(u)}" alt="" referrerpolicy="no-referrer">`).join('')}</div>
          <label class="mr-label" for="mr-secs">Seconds per slide</label>
          <select class="mr-select" id="mr-secs"><option value="2">2 (snappy)</option><option value="2.6" selected>2.6 (balanced)</option><option value="3.5">3.5 (time to read)</option><option value="4.5">4.5 (text-heavy slides)</option></select>`
        : `<label class="mr-label" for="mr-lines">Lines, one per beat</label>
          <textarea class="mr-text" id="mr-lines" maxlength="1500" placeholder="Most people wash linen wrong.&#10;Hot water *shrinks* it.&#10;Cold wash, low spin, hang dry.">${esc(opts.lines || '')}</textarea>
          <div class="mr-row" style="margin-top:6px"><button type="button" class="mr-btn" id="mr-beats">Write the beats for me</button><span class="mr-hint">Put *stars* round a word to colour it.</span></div>
          <label class="mr-label" for="mr-style">Animation</label>
          <select class="mr-select" id="mr-style"><option value="rise">Rise (calm)</option><option value="pop">Pop (energetic)</option></select>`}
        <label class="mr-label" for="mr-cta">Closing line</label>
        <input class="mr-input" id="mr-cta" maxlength="60" value="${esc(d.cta || '')}" placeholder="Book a free check" />
        <label class="mr-label" for="mr-handle">Handle</label>
        <input class="mr-input" id="mr-handle" maxlength="40" value="${esc(d.handle || '')}" placeholder="yourbrand" />
        <span class="mr-label">Colours</span>
        <div class="mr-colors"><label class="mr-hint">Background <input type="color" id="mr-bg" value="${esc(p.bg || '#0F172A')}"></label><label class="mr-hint">Accent <input type="color" id="mr-accent" value="${esc(p.accent || '#A78BFA')}"></label></div>
        <label class="mr-label" for="mr-font">Font</label>
        <select class="mr-select" id="mr-font">${(o.fonts || ['inter']).map((f) => `<option value="${esc(f)}">${esc(FONT_LABELS[f] || f)}</option>`).join('')}</select>
        <label class="mr-label" for="mr-music">Music</label>
        <select class="mr-select" id="mr-music"><option value="">No music</option>${(o.music || []).map((m) => `<option value="${esc(m.url)}">${esc(m.name)}</option>`).join('')}</select>
        ${(o.music || []).length ? '' : '<div class="mr-hint" style="margin-top:4px">Add your own tracks in Library (kind: music) to use them here. You can also add trending audio in Instagram when you post.</div>'}
        <div class="mr-row"><button type="button" class="mr-btn mr-btn--primary" id="mr-go" ${ready ? '' : 'disabled'}>Make the Reel</button><span class="mr-hint" id="mr-cap">${esc(capUsed)} of ${esc(capMax)} used today</span></div>`;
      if (kind === 'text' && opts.text && !opts.lines && !form.dataset.beatsTried) { form.dataset.beatsTried = '1'; suggestBeats(true); }
      form.querySelector('#mr-beats')?.addEventListener('click', () => suggestBeats(false));
      if (kind === 'faceless') {
        renderScenes();
        form.querySelector('#mr-script').addEventListener('click', () => writeScript(false));
        form.querySelector('#mr-footage').addEventListener('change', renderScenes);
        form.querySelector('#mr-scene-add').addEventListener('click', () => { scenes.push({ line: '', search: '' }); renderScenes(); });
        form.querySelector('#mr-scenes').addEventListener('input', (e) => {
          const t = e.target;
          if (t.dataset.sceneLine != null) scenes[Number(t.dataset.sceneLine)].line = t.value;
          if (t.dataset.sceneSearch != null) scenes[Number(t.dataset.sceneSearch)].search = t.value;
        });
        if (!scenes.length && opts.text && ready) writeScript(true);
      }
      form.querySelector('#mr-go').addEventListener('click', go);
    }

    async function suggestBeats(auto) {
      const btn = form.querySelector('#mr-beats');
      const box = form.querySelector('#mr-lines');
      const source = auto ? opts.text : (box.value.trim() || opts.text || '');
      if (!source) { toast('Write a caption or idea first', 'warning'); return; }
      btn.disabled = true; btn.textContent = 'Writing…';
      try {
        const d = await api('/api/motion/beats', { method: 'POST', body: JSON.stringify({ text: source }) });
        box.value = d.beats.join('\n');
        if (d.cta && !form.querySelector('#mr-cta').value) form.querySelector('#mr-cta').value = d.cta;
      } catch (e) {
        if (!auto) toast(e.message, 'error');
        else if (!box.value) box.value = String(opts.text || '').split(/\n+/).slice(0, 6).join('\n');
      } finally {
        btn.disabled = false; btn.textContent = 'Write the beats for me';
      }
    }

    async function poll(id) {
      for (let i = 0; i < 120 && !stopped; i += 1) {
        await new Promise((r) => setTimeout(r, i < 3 ? 2000 : 3000));
        if (stopped) return null;
        const s = await api(`/api/motion/jobs/${encodeURIComponent(id)}`).catch((e) => ({ status: 'failed', error: e.message }));
        if (s.status !== 'processing') return s;
      }
      return stopped ? null : { status: 'failed', error: 'This is taking too long. Check your Library in a few minutes.' };
    }

    async function go(e) {
      const btn = e.currentTarget;
      const body = {
        kind,
        cta: form.querySelector('#mr-cta').value.trim(),
        handle: form.querySelector('#mr-handle').value.trim(),
        palette: { bg: form.querySelector('#mr-bg').value, accent: form.querySelector('#mr-accent').value },
        font: form.querySelector('#mr-font').value,
        music_url: form.querySelector('#mr-music').value,
        name: opts.name || '',
      };
      if (kind === 'carousel') {
        body.slides = slides;
        body.seconds_per_slide = Number(form.querySelector('#mr-secs').value);
      } else if (kind === 'faceless') {
        delete body.kind;
        body.scenes = scenes.map((s) => ({ line: String(s.line || '').trim(), search: String(s.search || '').trim() })).filter((s) => s.line);
        body.footage = form.querySelector('#mr-footage').value;
        if (!body.scenes.length) { toast('Write the script first', 'warning'); return; }
      } else {
        body.beats = form.querySelector('#mr-lines').value.split('\n').map((s) => s.trim()).filter(Boolean);
        body.style = form.querySelector('#mr-style').value;
        if (!body.beats.length) { toast('Add at least one line', 'warning'); return; }
      }
      btn.disabled = true; btn.textContent = 'Rendering…';
      out.innerHTML = '';
      stage.innerHTML = '<div style="text-align:center"><div class="mr-spin" style="margin:0 auto 10px"></div><div class="mr-hint">Rendering your Reel…</div></div>';
      try {
        const job = await api(kind === 'faceless' ? '/api/motion/faceless/render' : '/api/motion/render', { method: 'POST', body: JSON.stringify(body) });
        const cap = form.querySelector('#mr-cap');
        if (cap && job.daily_cap) cap.textContent = `${job.used_today} of ${job.daily_cap} used today`;
        const s = await poll(job.job_id);
        if (!s) return;
        if (s.status !== 'done') throw new Error(s.error || 'The video did not render.');
        stage.innerHTML = `<video id="mr-video" src="${esc(s.video_url)}" controls autoplay muted loop playsinline></video>`;
        out.innerHTML = `<a class="mr-btn mr-btn--primary" id="mr-download" href="${esc(s.video_url)}" download="reel.mp4" target="_blank" rel="noopener">Download MP4</a><span class="mr-hint">Saved to Library, Motion reels.</span>`;
        toast('Reel ready');
      } catch (err) {
        stage.innerHTML = `<div class="mr-note" style="padding:20px;text-align:center">${esc(err.message)}</div>`;
      } finally {
        btn.disabled = false; btn.textContent = 'Make another version';
      }
    }

    api('/api/motion/options').then(renderForm).catch((e) => { form.innerHTML = `<div class="mr-note">${esc(e.message)}</div>`; });
  }

  const CAPTION_BOXES = '.post-caption-edit, #cs-caption-box, #vs-upload-caption, #quick-schedule-caption, textarea[data-fc-k="caption"]';

  function attachTextReelButtons() {
    document.querySelectorAll(CAPTION_BOXES).forEach((ta) => {
      if (ta.dataset.mrAttach) return;
      ta.dataset.mrAttach = '1';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mr-attach';
      b.textContent = '▶ Make a Reel';
      b.title = 'Turn this caption into a text Reel or a voiceover Reel';
      b.addEventListener('click', (e) => {
        e.preventDefault();
        if (!ta.value.trim()) { toast('Write the caption first', 'warning'); return; }
        openMotionReel({ kind: 'text', text: ta.value, name: ta.value.split('\n')[0].slice(0, 60) });
      });
      const after = ta.nextElementSibling && ta.nextElementSibling.classList.contains('mp-ck-btn') ? ta.nextElementSibling : ta;
      after.insertAdjacentElement('afterend', b);
    });
  }

  global.seOpenMotionReel = openMotionReel;

  function boot() {
    injectStyles();
    attachTextReelButtons();
    let pending = null;
    new MutationObserver(() => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; attachTextReelButtons(); }, 200);
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
