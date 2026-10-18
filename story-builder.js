/**
 * Storyboard: the Create tab next to Reels (new look only). It shares the Animate studio
 * (animation-studio.js), which Reels uses for "one idea becomes a shot plan".
 *
 *   1 Cast and world: a story kit of characters, places and products, made once (four
 *     looks each, matched to the kit) and locked.
 *   2 Story: one voiceover line per scene, what happens, who and where is in it, camera
 *     and length, with previews that match each other.
 *   3 Make: the reel runs on the normal board, with these steps above it.
 *
 * animation-studio.js calls SEStory.attach(root, host) once the board exists,
 * SEStory.onLayout() after every board render, and SEStory.setSurface(on) when the
 * Storyboard or Reels tab is picked. Everything else lives here.
 */
(function () {
  'use strict';

  let H = null; // host helpers from animation-studio.js
  let canvas = null;
  let shell = null;
  let box = null; // .nl-story

  const S = {
    on: false,
    view: 'start', // start | kit | story | board
    kits: [],
    kit: null,
    reel: null,
    story: null,
    panel: null,
    sel: null,
    newKit: null, // { title, look, from }
    menu: false,
    addEl: false,
    writer: null, // { idea, busy }
    save: { timer: null, busy: false, again: false, state: 'saved' },
    poll: null,
    boardPid: null,
    anim: null,
    loading: false,
    picker: null, // { tab: 'library'|'products', q, items, sel: Map }
    catalog: null, // { has: bool } once the product catalog was checked
  };
  const LS_LOOKS = 'se_story_looks';
  const MAX_REFS = 3;
  const lookCountPref = () => { const n = Number(ls.get(LS_LOOKS)); return n >= 1 && n <= 6 ? n : 4; };
  const LS_LAST = 'se_story_last';
  const WPS = 2.5;
  const COLORS = ['#f2b84b', '#58b4ff', '#2ee6a6', '#ff7ab6', '#c4a6ff', '#ff8a5c'];
  const I = {
    grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
    spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
    plus: 'M12 5v14 M5 12h14',
    x: 'M6 6l12 12 M18 6L6 18',
    chev: 'M6 9l6 6 6-6',
    right: 'M5 12h13 M13 6l6 6-6 6',
    lock: 'M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    mic: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5.5 11a6.5 6.5 0 0 0 13 0 M12 17.5V21',
    play: 'M7 5l12 7-12 7z',
    pause: 'M7 5h3v14H7z M14 5h3v14h-3z',
    redo: 'M20 11a8 8 0 1 0-2.3 5.7 M20 5v6h-6',
    copy: 'M9 9h11v11H9z M5 15V4h11',
    image: 'M4 5h16v14H4z M9 10.5a1.5 1.5 0 1 0 0-.01 M20 15l-5-5-9 9',
    check: 'M5 12.5l4.2 4.2L19 7',
    upload: 'M12 16V4 M7 9l5-5 5 5 M4 20h16',
    expand: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
    left: 'M15 6l-6 6 6 6',
    next: 'M9 6l6 6-6 6',
  };

  const esc = (s) => (H ? H.esc(s) : String(s == null ? '' : s));
  const svg = (d, size = 14, sw = 1.9) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const media = (u) => (H && H.mediaSrc ? H.mediaSrc(u) : u);
  const api = (path, opts) => H.fetch(path, opts);
  const toast = (m, t, ref) => H && H.toast(m, t, ref);
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* private mode */ } },
  };
  const rid = (p) => `${p}_${Array.from(crypto.getRandomValues(new Uint8Array(5))).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  const TYPE_LABEL = { character: 'Character', place: 'Place', item: 'Prop' };
  const elType = (e) => (e.type === 'item' && e.source === 'product' ? 'Product' : TYPE_LABEL[e.type] || 'Item');
  const LOOKS = [['stylized', 'Stylized'], ['realistic', 'Realistic'], ['cartoon', 'Cartoon']];
  const lookLabel = (v) => (LOOKS.find((l) => l[0] === v) || LOOKS[0])[1];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;
  const clock = (sec) => { const t = Math.max(0, Math.round(sec)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  const words = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
  function secondsFor(line) {
    const n = words(line);
    if (!n) return 5;
    return Math.max(4, Math.min(8, Math.round((n / WPS + 0.6) * 2) / 2));
  }
  function stats(story) {
    const sc = (story && story.scenes) || [];
    const seconds = sc.reduce((n, s) => n + (Number(s.seconds) || 5), 0);
    const w = sc.reduce((n, s) => n + words(s.line), 0);
    const spoken = w / WPS;
    return { scenes: sc.length, seconds, words: w, spoken, fits: !w || spoken <= seconds - 0.4 };
  }
  const counts = (kit) => {
    const els = (kit && kit.elements) || [];
    return {
      character: els.filter((e) => e.type === 'character').length,
      place: els.filter((e) => e.type === 'place').length,
      item: els.filter((e) => e.type === 'item').length,
    };
  };
  function countLine(c, reels) {
    const bits = [];
    if (c.character) bits.push(plural(c.character, 'character'));
    if (c.place) bits.push(plural(c.place, 'place'));
    if (c.item) bits.push(plural(c.item, 'product'));
    if (reels != null) bits.push(plural(reels, 'reel'));
    return bits.join(' · ') || 'Empty so far';
  }
  const busyReel = (p) => !!p && ['generating', 'assembling', 'developing'].includes(p.status);
  const madeReel = (p) => !!p && p.status !== 'story';

  // ── Mount ────────────────────────────────────────────────────────────────
  function attach(root, host) {
    H = host;
    canvas = root.parentElement;
    shell = root.closest('.anim-shell');
    if (!canvas || !shell) return;
    box = canvas.querySelector(':scope > .nl-story');
    if (!box) {
      box = document.createElement('div');
      box.className = 'nl-story';
      canvas.appendChild(box);
      box.addEventListener('click', onClick);
      box.addEventListener('input', onInput);
      box.addEventListener('change', onChange);
      box.addEventListener('keydown', onKey);
      document.addEventListener('click', (e) => {
        if (S.menu && !e.target.closest('.nl-skitpick')) { S.menu = false; paintHeader(); }
      });
    }
    ensureHeader();
    S.on = onStoryboardTab();
    if (S.on) restore();
    paint();
  }

  const onStoryboardTab = () => window.__SE_CREATE_SURFACE === 'storyboard';

  function ensureHeader() {
    const head = shell.querySelector('.anim-canvas-header');
    if (!head || head.querySelector('.nl-sbar')) return;
    const bar = document.createElement('div');
    bar.className = 'nl-sbar';
    bar.addEventListener('click', onClick);
    bar.addEventListener('change', onChange);
    const h2 = head.querySelector('h2');
    head.insertBefore(bar, h2 ? h2.nextSibling : head.firstChild);
  }

  /** The Storyboard tab (on) or the Reels tab (off) was picked. */
  function setSurface(on) {
    if (!shell) return;
    if (!!on === S.on) { paint(); return; }
    S.on = !!on;
    stopPoll();
    S.menu = false;
    if (S.on) restore();
    paint();
  }

  function remember() {
    ls.set(LS_LAST, JSON.stringify({ kit: S.kit ? S.kit.id : null, reel: S.view === 'board' ? S.boardPid : (S.reel ? S.reel.id : null), view: S.view }));
  }
  function restore() {
    let last = null;
    try { last = JSON.parse(ls.get(LS_LAST) || 'null'); } catch (_) { last = null; }
    S.view = 'start';
    refreshKits();
    const p = H.project();
    if (last && last.view === 'story' && last.reel) openReel(last.reel);
    else if (last && last.view === 'kit' && last.kit) openKit(last.kit);
    else if (last && last.view === 'board' && last.reel && p && p.id === last.reel) {
      S.view = 'board';
      S.boardPid = p.id;
      loadKitQuiet(p.kit_id);
    }
  }

  // Called by animation-studio.js after each board render. In Storyboard, the board
  // follows the story reel being made; anything else sends Storyboard back to its start.
  function onLayout() {
    if (!shell) return;
    if (S.on && S.view === 'board') {
      const p = H.project();
      if (p && p.workflow === 'story') {
        if (p.id !== S.boardPid) { S.boardPid = p.id; loadKitQuiet(p.kit_id); remember(); }
      } else {
        S.boardPid = null;
        S.view = 'start';
        remember();
      }
    }
    paint();
  }

  /** A story reel that has not been made yet opens in the story view, not the board. */
  function claims(p) {
    return !!p && p.workflow === 'story' && p.status === 'story';
  }

  // ── Data ─────────────────────────────────────────────────────────────────
  async function refreshKits() {
    try {
      const d = await api('/api/animation/kits');
      S.kits = d.kits || [];
    } catch (_) {
      S.kits = (H.kits && H.kits()) || S.kits;
    }
    if (S.on && S.view === 'start') render();
  }

  async function loadKitQuiet(id) {
    if (!id || (S.kit && S.kit.id === id)) return;
    try {
      const d = await api(`/api/animation/kits/${encodeURIComponent(id)}`);
      S.kit = d.kit;
      paintHeader();
    } catch (_) { /* header only */ }
  }

  async function openKit(id, { panel = null } = {}) {
    S.loading = true;
    try {
      const d = await api(`/api/animation/kits/${encodeURIComponent(id)}`);
      S.kit = d.kit;
      if (S.reel && S.reel.kit_id !== S.kit.id) { S.reel = null; S.story = null; }
      S.view = 'kit';
      S.panel = panel || draftPanel() || (S.kit.elements.length ? null : { mode: 'new', type: 'character', source: 'describe', name: '', description: '' });
      remember();
      pollIfWorking();
    } catch (e) {
      toast(e.message || 'Could not open the kit', 'error', e.request_id);
      S.view = 'start';
    } finally {
      S.loading = false;
    }
    paint();
  }

  /** Looks still on the kit (being made, or made and not locked) reopen in the panel. */
  function draftPanel() {
    const d = ((S.kit && S.kit.drafts) || []).slice().reverse().find((x) => x.status === 'working' || x.status === 'ready');
    if (!d) return null;
    const refs = Array.isArray(d.refs) && d.refs.length ? d.refs : (d.photo_url ? [{ url: d.photo_url, kind: d.source === 'product' ? 'product' : 'photo' }] : []);
    return { mode: 'new', type: d.type, source: d.source, name: d.name, description: d.description, refs, count: (d.options || []).length || 4, need_id: d.need_id || null, draft_id: d.id, picks: [] };
  }

  async function openReel(idOrProject) {
    if (!S.on) {
      // From Reels: a story that has not been made yet opens in the Storyboard tab.
      const p = typeof idOrProject === 'object' ? idOrProject : null;
      ls.set(LS_LAST, JSON.stringify({ kit: p ? p.kit_id : null, reel: p ? p.id : idOrProject, view: 'story' }));
      H.goStoryboard();
      return;
    }
    S.loading = true;
    try {
      const p = typeof idOrProject === 'object' ? idOrProject : (await api(`/api/animation/projects/${encodeURIComponent(idOrProject)}`)).project;
      if (!p || p.workflow !== 'story') throw new Error('That reel was not built as a story.');
      if (!S.kit || S.kit.id !== p.kit_id) S.kit = (await api(`/api/animation/kits/${encodeURIComponent(p.kit_id)}`)).kit;
      S.reel = p;
      S.story = localStory(p.story);
      S.sel = S.story.scenes[0] ? S.story.scenes[0].id : null;
      S.view = 'story';
      S.panel = null;
      S.writer = S.story.scenes.length ? null : { idea: S.story.idea || '', busy: false };
      remember();
      pollIfWorking();
    } catch (e) {
      toast(e.message || 'Could not open the story', 'error', e.request_id);
      if (S.view !== 'kit') S.view = 'start';
    } finally {
      S.loading = false;
    }
    paint();
  }

  function localStory(st) {
    const s = st || {};
    return {
      title: s.title || '',
      idea: s.idea || '',
      script_source: s.script_source === 'client' ? 'client' : 'ai',
      scenes: (s.scenes || []).map((x) => ({
        id: x.id,
        line: x.line || '',
        what: x.what || '',
        element_ids: (x.element_ids || []).slice(),
        camera: x.camera || 'push',
        seconds: Number(x.seconds) || secondsFor(x.line),
        seconds_manual: !!x.seconds_manual,
        preview_url: x.preview_url || null,
        preview_status: x.preview_status || null,
        preview_stale: !!x.preview_stale,
        preview_error: x.preview_error || null,
      })),
    };
  }

  async function newReel() {
    if (!S.kit) return;
    const mine = (S.kit.reels || []).find((r) => r.status === 'story');
    if (mine) return openReel(mine.id);
    try {
      const d = await api(`/api/animation/kits/${encodeURIComponent(S.kit.id)}/reels`, { method: 'POST', body: JSON.stringify({}) });
      S.kit = d.kit || S.kit;
      await openReel(d.project);
    } catch (e) {
      toast(e.message || 'Could not start a reel', 'error', e.request_id);
    }
  }

  async function createKit(fromId) {
    const nk = S.newKit || {};
    try {
      const body = fromId ? { from_project_id: fromId } : { title: nk.title || '', look: nk.look || 'stylized' };
      const d = await api('/api/animation/kits', { method: 'POST', body: JSON.stringify(body) });
      S.newKit = null;
      S.kit = d.kit;
      S.view = 'kit';
      S.panel = S.kit.elements.length ? null : { mode: 'new', type: 'character', source: 'describe', name: '', description: '' };
      remember();
      refreshKits();
      pollIfWorking();
      paint();
      toast(fromId ? 'Kit started from that reel' : 'Story kit created', 'success');
    } catch (e) {
      toast(e.message || 'Could not create the kit', 'error', e.request_id);
    }
  }

  // ── Polling: looks, sheets and previews being made ──────────────────────
  function kitWorking() {
    const k = S.kit;
    if (!k) return false;
    return (k.drafts || []).some((d) => d.status === 'working') || (k.elements || []).some((e) => e.sheet_status === 'working');
  }
  function storyWorking() {
    return !!(S.story && S.story.scenes.some((s) => s.preview_status === 'working'));
  }
  function stopPoll() { if (S.poll) clearInterval(S.poll); S.poll = null; }
  function pollIfWorking() {
    if (S.poll) return;
    if (!(kitWorking() || storyWorking())) return;
    S.poll = setInterval(tick, 2500);
  }
  async function tick() {
    if (!S.on || S.view === 'board' || S.view === 'start') { stopPoll(); return; }
    try {
      if (S.kit && kitWorking()) {
        const d = await api(`/api/animation/kits/${encodeURIComponent(S.kit.id)}`);
        S.kit = d.kit;
        if (S.view === 'kit') render();
      }
      if (S.reel && storyWorking()) {
        const d = await api(`/api/animation/projects/${encodeURIComponent(S.reel.id)}`);
        mergePreviews(d.project);
        if (S.view === 'story') render();
      }
    } catch (_) { /* next tick */ }
    if (!(kitWorking() || storyWorking())) stopPoll();
  }
  function mergePreviews(p) {
    if (!p || !S.story) return;
    S.reel = Object.assign({}, S.reel, { status: p.status, final_url: p.final_url, updated_at: p.updated_at });
    const by = new Map(((p.story && p.story.scenes) || []).map((s) => [s.id, s]));
    S.story.scenes.forEach((s) => {
      const r = by.get(s.id);
      if (!r) return;
      s.preview_url = r.preview_url || null;
      s.preview_status = r.preview_status || null;
      s.preview_stale = !!r.preview_stale;
      s.preview_error = r.preview_error || null;
    });
  }

  // ── Saving the story ─────────────────────────────────────────────────────
  function touch({ client = false } = {}) {
    if (client && S.story) S.story.script_source = 'client';
    S.story.scenes.forEach((s) => { if (!s.seconds_manual) s.seconds = secondsFor(s.line); });
    S.save.state = 'saving';
    paintSaveState();
    clearTimeout(S.save.timer);
    S.save.timer = setTimeout(saveNow, 700);
  }
  async function saveNow() {
    if (!S.reel || !S.story) return;
    if (S.save.busy) { S.save.again = true; return; }
    S.save.busy = true;
    try {
      const body = {
        title: S.story.title,
        idea: S.story.idea,
        script_source: S.story.script_source,
        scenes: S.story.scenes.map((s) => ({
          id: s.id, line: s.line, what: s.what, element_ids: s.element_ids, camera: s.camera,
          seconds: s.seconds, seconds_manual: s.seconds_manual, preview_url: s.preview_url,
        })),
      };
      const d = await api(`/api/animation/projects/${encodeURIComponent(S.reel.id)}/story`, { method: 'PUT', body: JSON.stringify(body) });
      // Local edits win; the server owns previews and lengths it worked out.
      const by = new Map(((d.project.story && d.project.story.scenes) || []).map((s) => [s.id, s]));
      S.story.scenes.forEach((s) => {
        const r = by.get(s.id);
        if (!r) return;
        if (!s.seconds_manual) s.seconds = r.seconds;
        s.preview_url = r.preview_url;
        s.preview_status = r.preview_status;
        s.preview_stale = !!r.preview_stale;
      });
      S.save.state = 'saved';
    } catch (e) {
      S.save.state = 'error';
      toast(e.message || 'Could not save the story', 'error', e.request_id);
    } finally {
      S.save.busy = false;
    }
    if (S.save.again) { S.save.again = false; saveNow(); return; }
    paintSaveState();
    paintStoryBits();
  }
  async function flushSave() {
    if (S.save.timer) { clearTimeout(S.save.timer); S.save.timer = null; await saveNow(); }
    while (S.save.busy) await new Promise((r) => setTimeout(r, 80));
  }

  // ── Paint ────────────────────────────────────────────────────────────────
  function paint() {
    if (!shell || !box) return;
    shell.classList.toggle('nl-story-mode', S.on);
    shell.classList.toggle('nl-story-board', S.on && S.view === 'board');
    paintHeader();
    render();
  }

  function paintHeader() {
    const head = shell && shell.querySelector('.anim-canvas-header');
    if (!head) return;
    const bar = head.querySelector('.nl-sbar');
    if (!bar) return;
    if (!S.on || (S.view === 'start' && !S.kit)) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.hidden = false;
    const k = S.kit;
    const faces = k ? (k.elements || []).filter((e) => e.type === 'character' && e.image_url).slice(0, 2) : [];
    const stepIdx = { kit: 0, story: 1, board: 2, start: -1 }[S.view];
    const made = madeReel(S.view === 'board' ? H.project() : S.reel);
    const steps = [['Cast and world', 'kit'], ['Story', 'story'], ['Make', 'board']].map(([label, v], i) => {
      const st = i < stepIdx ? 'done' : i === stepIdx ? 'now' : 'todo';
      const can = (v === 'kit' && k) || (v === 'story' && (S.reel || k)) || (v === 'board' && made);
      return `<li class="nl-step nl-step--${st}"><button type="button" data-step="${v}" ${can ? '' : 'disabled'} ${st === 'now' ? 'aria-current="step"' : ''}><span class="nl-step__n">${st === 'done' ? svg(I.check, 11, 3) : i + 1}</span>${esc(label)}</button></li>`;
    }).join('<li class="nl-step__sep" aria-hidden="true"></li>');
    const menu = S.menu ? `<div class="nl-skitpick__menu" role="menu">
        ${S.kits.map((x) => `<button type="button" role="menuitem" data-kit-open="${esc(x.id)}" class="${k && x.id === k.id ? 'is-on' : ''}"><span class="nl-skitpick__mt">${esc(x.title)}</span><span class="nl-skitpick__ms">${esc(countLine(x.counts || {}, x.reel_count))}</span></button>`).join('')}
        <hr>
        <button type="button" role="menuitem" data-kit-new>${svg(I.plus, 13)}New story kit</button>
        <button type="button" role="menuitem" data-go-start>All story kits</button>
      </div>` : '';
    bar.innerHTML = `
      <div class="nl-skitpick">
        <button type="button" class="nl-skitpick__b" data-kit-menu aria-haspopup="menu" aria-expanded="${S.menu ? 'true' : 'false'}">
          ${faces.length ? `<span class="nl-sfaces">${faces.map((e) => `<img src="${esc(media(e.image_url))}" alt="">`).join('')}</span>` : `<span class="nl-sfaces nl-sfaces--none">${svg(I.grid, 12)}</span>`}
          <span class="nl-skitpick__t">${esc(k ? k.title : 'Pick a kit')}</span>${svg(I.chev, 12, 2)}
        </button>${menu}
      </div>
      <ol class="nl-ssteps" aria-label="Steps">${steps}</ol>
      ${k && S.view !== 'board' ? `<label class="nl-skitlook"><span>Look</span><select data-kit-look aria-label="Look for this kit">${LOOKS.map(([v, l]) => `<option value="${v}" ${k.look === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${svg(I.chev, 12, 2)}</label>` : ''}`;
  }

  function render() {
    if (!box) return;
    if (!S.on || S.view === 'board') { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    const keep = focusState();
    let html = '';
    if (S.loading && !S.kit && S.view !== 'start') html = '<div class="nl-sloading">Loading…</div>';
    else if (S.view === 'kit' && S.kit) html = kitView();
    else if (S.view === 'story' && S.story) html = storyView();
    else html = startView();
    box.innerHTML = html;
    box.querySelectorAll('.nl-sline__t').forEach(grow);
    restoreFocus(keep);
    // An open look viewer follows the set (new looks arrive, the panel closes).
    if (S.viewer) paintViewer();
  }
  /** Script lines wrap and grow with their text. */
  function grow(ta) {
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(34, ta.scrollHeight)}px`;
  }

  function focusState() {
    const a = document.activeElement;
    if (!a || !box || !box.contains(a) || !a.dataset.fk) return null;
    return { key: a.dataset.fk, start: a.selectionStart, end: a.selectionEnd };
  }
  function restoreFocus(st) {
    if (!st) return;
    const el = box.querySelector(`[data-fk="${CSS.escape(st.key)}"]`);
    if (!el) return;
    el.focus({ preventScroll: true });
    try { if (st.start != null) el.setSelectionRange(st.start, st.end); } catch (_) { /* not a text field */ }
  }

  // ── Start: kits and story reels ──────────────────────────────────────────
  function kitCard(k, { compact = false } = {}) {
    const th = (k.thumbs || []).slice(0, 4);
    const tiles = th.length ? th.map((u) => `<img src="${esc(media(u))}" alt="" loading="lazy">`).join('') : `<span class="nl-skc__empty">${svg(I.grid, 18)}</span>`;
    return `<div class="nl-skc" data-kit-open="${esc(k.id)}" role="button" tabindex="0" aria-label="Open ${esc(k.title)}">
      <div class="nl-skc__art nl-skc__art--${Math.max(1, th.length)}">${tiles}</div>
      <div class="nl-skc__b">
        <div><div class="nl-skc__t">${esc(k.title)}</div><div class="nl-skc__s">${esc(countLine(k.counts || {}, compact ? null : k.reel_count))}</div></div>
        <span class="nl-sbtn nl-sbtn--sm">Open</span>
      </div>
    </div>`;
  }

  function newKitCard() {
    const nk = S.newKit;
    if (!nk) {
      return `<div class="nl-skc nl-skc--new">
        <button type="button" class="nl-skc__newb" data-kit-new><span class="nl-skc__plus">${svg(I.plus, 16)}</span><span class="nl-skc__t">New story kit</span><span class="nl-skc__s">Make your cast and places first, then lay out the scenes.</span></button>
        <button type="button" class="nl-slink" data-kit-from>or start from a past reel</button>
      </div>`;
    }
    if (nk.from) {
      const reels = ((H.recent && H.recent()) || []).filter((p) => p.workflow !== 'story' && (p.has_final || p.scene_count));
      return `<div class="nl-skc nl-skc--new nl-skc--form">
        <div class="nl-skc__t">Start from a past reel</div>
        <div class="nl-skc__s">Its character and a frame become the first things in the kit.</div>
        ${reels.length ? `<select class="nl-sinput" data-kit-from-pick>${reels.map((p) => `<option value="${esc(p.id)}">${esc(H.title(p))}</option>`).join('')}</select>` : '<div class="nl-skc__s">No finished reels yet.</div>'}
        <div class="nl-srow"><button type="button" class="nl-sbtn nl-sbtn--primary" data-kit-from-go ${reels.length ? '' : 'disabled'}>Start the kit</button><button type="button" class="nl-sbtn" data-kit-cancel>Cancel</button></div>
      </div>`;
    }
    return `<div class="nl-skc nl-skc--new nl-skc--form">
      <label class="nl-slabel" for="nl-sk-name">Kit name</label>
      <input id="nl-sk-name" class="nl-sinput" data-kit-name data-fk="kitname" maxlength="80" placeholder="Winter wellbeing" value="${esc(nk.title || '')}">
      <div class="nl-slabel">Look</div>
      <div class="nl-sseg" role="group" aria-label="Look">${LOOKS.map(([v, l]) => `<button type="button" data-kit-newlook="${v}" aria-pressed="${(nk.look || 'stylized') === v}">${l}</button>`).join('')}</div>
      <div class="nl-srow"><button type="button" class="nl-sbtn nl-sbtn--primary" data-kit-create>Create kit</button><button type="button" class="nl-sbtn" data-kit-cancel>Cancel</button></div>
    </div>`;
  }

  function reelRow(p) {
    const kit = S.kits.find((k) => k.id === p.kit_id);
    const st = p.status === 'story' ? ['Draft', 'todo'] : p.has_final ? ['Ready', 'ok'] : busyReel(p) ? ['Making', 'gen'] : [String(p.status || ''), 'todo'];
    return `<button type="button" class="nl-srr" data-reel-open="${esc(p.id)}">
      <span class="nl-srr__th">${p.thumb_url ? `<img src="${esc(media(p.thumb_url))}" alt="" loading="lazy">` : svg(I.image, 14)}</span>
      <span class="nl-srr__b"><span class="nl-srr__t">${esc(H.title(p))}</span><span class="nl-srr__s">${esc(kit ? kit.title : 'Story')}${p.story_scene_count ? ` · ${plural(p.story_scene_count, 'scene')}` : ''}</span></span>
      <span class="nl-spill nl-spill--${st[1]}">${esc(st[0])}</span>
    </button>`;
  }

  function startView() {
    const reels = ((H.recent && H.recent()) || []).filter((p) => p.workflow === 'story').slice(0, 8);
    return `<div class="nl-sstart">
      <div class="nl-sstart__main">
        <div class="nl-sstart__h">
          <h2 class="nl-sh1">Start with your cast</h2>
          <p class="nl-ssub">Make your characters, places and products once. Then lay out each reel scene by scene, one voiceover line each.</p>
        </div>
        <div class="nl-skits">${S.kits.map((k) => kitCard(k)).join('')}${newKitCard()}</div>
      </div>
      <aside class="nl-sstart__side" aria-label="Story reels">
        <div class="nl-shead">Story reels</div>
        ${reels.length ? `<div class="nl-srrs">${reels.map(reelRow).join('')}</div>` : '<div class="nl-sempty">Reels you build from a kit show up here.</div>'}
      </aside>
    </div>`;
  }

  function currentLook() {
    const sel = document.getElementById('anim-look');
    return sel && LOOKS.some((l) => l[0] === sel.value) ? sel.value : 'stylized';
  }
  function focusLater(sel) { setTimeout(() => { const el = box && box.querySelector(sel); if (el) el.focus(); }, 30); }

  // ── 1 Cast and world ─────────────────────────────────────────────────────
  function elCard(e) {
    const sel = S.panel && S.panel.mode === 'el' && S.panel.id === e.id;
    const badge = e.type === 'character'
      ? `<span class="nl-sbadge nl-sbadge--ok"><i></i>Locked</span>`
      : e.type === 'item' && e.source === 'product' ? '<span class="nl-sbadge">Product</span>' : '';
    const sheet = e.type === 'character'
      ? (e.sheet_status === 'ready' && e.sheet_url
        ? `<span class="nl-sel__sheet"><img src="${esc(media(e.sheet_url))}" alt="" loading="lazy"></span>`
        : e.sheet_status === 'working' ? '<span class="nl-sel__sheetw"><i class="nl-sspin"></i>Making views</span>' : '')
      : '';
    const sub = e.description || (e.source === 'photo' ? 'From a photo' : e.source === 'mascot' ? 'From a mascot' : e.source === 'product' ? 'Keeps its print' : '');
    return `<button type="button" class="nl-sel${sel ? ' is-sel' : ''}" data-el="${esc(e.id)}" aria-pressed="${sel ? 'true' : 'false'}">
      <span class="nl-sel__art${e.type === 'item' ? ' nl-sel__art--item' : ''}"><img src="${esc(media(e.image_url))}" alt="" loading="lazy">${badge}${sheet}</span>
      <span class="nl-sel__t">${esc(e.name)}</span><span class="nl-sel__s">${esc(sub)}</span>
    </button>`;
  }
  function needCard(n) {
    const what = n.type === 'place' ? `Scene ${n.scene} happens here.` : `In scene ${n.scene}.`;
    return `<div class="nl-sneed">
      <span class="nl-sneed__k">Needed by the story</span>
      <span class="nl-sneed__t">${esc(n.name)}</span>
      <span class="nl-sneed__s">${esc(what)}</span>
      <button type="button" class="nl-sbtn nl-sbtn--sm" data-need="${esc(n.id)}">Make it</button>
    </div>`;
  }
  function newCard(type) {
    const label = { character: 'New character', place: 'New place', item: 'New item' }[type];
    const sub = { character: 'Describe, photo or mascot', place: 'Describe or photo', item: 'Product, photo or describe' }[type];
    const on = S.panel && S.panel.mode === 'new' && S.panel.type === type;
    return `<button type="button" class="nl-snew${on ? ' is-on' : ''}" data-new="${type}"><span class="nl-skc__plus">${svg(I.plus, 15)}</span><span class="nl-snew__t">${label}</span><span class="nl-snew__s">${sub}</span></button>`;
  }
  function kitSection(type, title, hint) {
    const els = (S.kit.elements || []).filter((e) => e.type === type);
    const needs = (S.kit.suggestions || []).filter((n) => n.type === type);
    return `<section class="nl-scard nl-ssec nl-ssec--${type}" aria-label="${esc(title)}">
      <div class="nl-ssec__h"><h3>${esc(title)} <span>${els.length}</span></h3>${hint ? `<span class="nl-ssec__hint">${esc(hint)}</span>` : ''}</div>
      <div class="nl-ssec__grid">${els.map(elCard).join('')}${needs.map(needCard).join('')}${newCard(type)}</div>
    </section>`;
  }

  function kitView() {
    const c = counts(S.kit);
    return `<div class="nl-skit">
      <div class="nl-skit__main">
        ${kitSection('character', 'Characters', 'Locked looks stay the same in every scene and every reel')}
        <div class="nl-skit__pair">
          ${kitSection('place', 'Places')}
          ${kitSection('item', 'Props and products')}
        </div>
      </div>
      <aside class="nl-skit__side">${panelView()}</aside>
    </div>
    <div class="nl-sfoot">
      <button type="button" class="nl-sfoot__t" data-kit-rename title="Rename">${esc(S.kit.title)}</button>
      <span class="nl-sfoot__sep"></span>
      <span class="nl-sfoot__m">${esc(countLine(c))}</span>
      <span class="nl-sfoot__sep"></span>
      <span class="nl-sstate nl-sstate--ok"><i></i>Saved to this kit</span>
      <span class="nl-grow"></span>
      <button type="button" class="nl-sbtn nl-sbtn--primary" data-next-story ${(S.kit.elements || []).length ? '' : 'disabled'}>Next: the story ${svg(I.right, 14)}</button>
    </div>`;
  }

  const SOURCES = {
    character: [['describe', 'Describe'], ['photo', 'From a photo'], ['mascot', 'From a mascot']],
    place: [['describe', 'Describe'], ['photo', 'From a photo']],
    item: [['describe', 'Describe'], ['product', 'A product'], ['photo', 'From a photo']],
  };
  function panelView() {
    const P = S.panel;
    if (!P) {
      return `<div class="nl-scard nl-spanel nl-spanel--idle">
        <div class="nl-spanel__h"><h3>Add to the kit</h3></div>
        <div class="nl-spanel__b">
          <p class="nl-ssub">Pick a card to see it, or make something new. New things are made to match what is already here.</p>
          <div class="nl-scol">
            <button type="button" class="nl-sbtn" data-new="character">${svg(I.plus, 13)}Character</button>
            <button type="button" class="nl-sbtn" data-new="place">${svg(I.plus, 13)}Place</button>
            <button type="button" class="nl-sbtn" data-new="item">${svg(I.plus, 13)}Prop or product</button>
          </div>
        </div>
      </div>`;
    }
    if (P.mode === 'el') return elPanel();
    const kindName = { character: 'character', place: 'place', item: 'item' }[P.type];
    const draft = P.draft_id ? (S.kit.drafts || []).find((d) => d.id === P.draft_id) : null;
    const working = draft && draft.status === 'working';
    const locked = !!draft;
    const needsPhoto = P.source !== 'describe';
    const refs = P.refs || [];
    const count = P.count || lookCountPref();
    if (!locked && S.catalog == null) checkCatalog();
    const aboutLabel = P.type === 'character' ? 'Who they are' : P.type === 'place' ? 'What it looks like' : 'What it is';
    const aboutPh = P.type === 'character'
      ? 'Community nurse in her mid 30s. Warm and calm. Short dark wavy hair, oatmeal cable-knit jumper.'
      : P.type === 'place' ? 'A warm family kitchen on a winter morning, wooden table by the window.' : 'A folded purple charity leaflet about symptoms.';
    const opts = draft ? draft.options : null;
    // Any number of looks can be picked; each goes into the kit as its own card.
    const picks = (P.picks || []).filter((i) => opts && opts[i] && opts[i].status === 'ready');
    const ready = opts && opts.some((o) => o.status === 'ready');
    const looks = opts ? `<div class="nl-slooks" style="--cols:${opts.length === 1 ? 2 : Math.min(4, opts.length)}">
        ${opts.map((o, i) => o.status === 'ready'
          ? `<div class="nl-slook${picks.includes(i) ? ' is-on' : ''}">
              <button type="button" class="nl-slook__pick" data-pick="${i}" aria-pressed="${picks.includes(i)}" aria-label="Look ${i + 1}"><img src="${esc(media(o.url))}" alt=""><span class="nl-slook__n">${picks.includes(i) ? svg(I.check, 11, 3) : i + 1}</span></button>
              <button type="button" class="nl-slook__zoom" data-zoom="${i}" aria-label="Look closer at look ${i + 1}" title="Look closer">${svg(I.expand, 12, 2.2)}</button>
            </div>`
          : o.status === 'failed' ? `<div class="nl-slook nl-slook--bad"><span class="nl-slook__n">${i + 1}</span><em>Did not work</em></div>`
            : `<div class="nl-slook nl-slook--wait" aria-busy="true"><span class="nl-slook__n">${i + 1}</span><i class="nl-sshim"></i></div>`).join('')}
      </div>` : '';
    const kindPlural = { character: 'characters', place: 'places', item: 'items' }[P.type];
    const lockText = !picks.length ? 'Pick a look'
      : picks.length === 1 ? `${P.type === 'character' ? 'Lock look' : 'Add look'} ${picks[0] + 1}`
        : `Add ${picks.length} ${kindPlural}`;
    const lib = draft && draft.library;
    const libNote = lib && lib.full ? 'Your Library is full, so these looks were not saved there.'
      : lib && lib.saved ? `${lib.saved === opts.length ? (opts.length === 1 ? 'This look is' : `All ${opts.length} looks are`) : `${plural(lib.saved, 'look')}`} saved in your Library${lib.collection ? ` under ${lib.collection}` : ''}.` : '';
    return `<div class="nl-scard nl-spanel">
      <div class="nl-spanel__h"><h3>${P.need_id ? 'Needed: ' : 'New '}${esc(P.need_id ? P.name || kindName : kindName)}</h3><button type="button" class="nl-sicon" data-panel-close aria-label="Close">${svg(I.x, 14)}</button></div>
      <div class="nl-spanel__b">
        <div class="nl-sseg nl-sseg--full" role="group" aria-label="Start from">${SOURCES[P.type].map(([v, l]) => `<button type="button" data-src="${v}" aria-pressed="${P.source === v}" ${locked ? 'disabled' : ''}>${l}</button>`).join('')}</div>
        <label class="nl-slabel" for="nl-sp-name">Name</label>
        <input id="nl-sp-name" class="nl-sinput" data-p-name data-fk="pname" maxlength="60" value="${esc(P.name || '')}" placeholder="${P.type === 'character' ? 'Maya' : P.type === 'place' ? 'Kitchen' : 'Know the Signs leaflet'}" ${locked ? 'readonly' : ''}>
        ${refsBlock(P, { locked, needsPhoto, refs })}
        <label class="nl-slabel" for="nl-sp-about">${aboutLabel}${needsPhoto ? ' <em>optional</em>' : ''}</label>
        <textarea id="nl-sp-about" class="nl-sinput nl-sarea" data-p-about data-fk="pabout" rows="3" maxlength="600" placeholder="${esc(aboutPh)}" ${locked ? 'readonly' : ''}>${esc(P.description || '')}</textarea>
        ${draft ? `<div class="nl-slabel nl-slabel--row"><span>${opts.length > 1 ? 'Pick one or more' : 'Pick a look'}</span>${working ? `<span class="nl-snote"><i class="nl-sspin"></i>Making ${plural(opts.length, 'look')}, about a minute</span>` : `<button type="button" class="nl-slink" data-more-looks>${svg(I.redo, 12)}${count} more</button>`}</div>${looks}` : ''}
        ${libNote ? `<div class="nl-snote nl-snote--lib">${svg(I.image, 12)}${esc(libNote)}</div>` : ''}
        ${draft && refs.length && needsPhoto && !working ? `<button type="button" class="nl-slink" data-use-photo>Use the ${P.source === 'product' ? 'product photo' : 'photo'} as it is</button>` : ''}
      </div>
      <div class="nl-spanel__f">
        ${draft
          ? `<button type="button" class="nl-sbtn nl-sbtn--light nl-sbtn--wide" data-lock ${!picks.length || !ready ? 'disabled' : ''}>${svg(I.lock, 13)}${lockText}</button>
             <div class="nl-snote nl-snote--c">${picks.length > 1
               ? `Each look becomes its own ${kindName}: ${esc(P.name || kindName)}, ${esc(P.name || kindName)} 2…${P.type === 'character' ? ` · ${plural(picks.length, 'image render')}` : ''}`
               : P.type === 'character' ? 'Makes front, three-quarter and side views · 1 image render' : 'Saved to this kit for every reel'}</div>`
          : `<div class="nl-scount"><span class="nl-slabel">Looks</span>
               <div class="nl-sstep" role="group" aria-label="How many looks">
                 <button type="button" data-count="-1" aria-label="Fewer looks" ${count <= 1 ? 'disabled' : ''}>−</button>
                 <output data-count-val aria-live="polite">${count}</output>
                 <button type="button" data-count="1" aria-label="More looks" ${count >= 6 ? 'disabled' : ''}>+</button>
               </div></div>
             <button type="button" class="nl-sbtn nl-sbtn--primary nl-sbtn--wide" data-make-looks>${svg(I.spark, 13)}Make ${plural(count, 'look')}</button>
             <div class="nl-snote nl-snote--c">${S.kit.elements.length ? 'Matched to the kit\'s style · ' : ''}${plural(count, 'image render')}</div>
             ${needsPhoto && refs.length ? `<button type="button" class="nl-slink nl-slink--c" data-as-is>or use the ${P.source === 'product' ? 'product photo' : 'photo'} as it is, no renders</button>` : ''}`}
      </div>
    </div>`;
  }

  const REF_KIND_LABEL = { product: 'Product', library: 'Library', logo: 'Logo', photo: 'Upload' };

  /** Starting images: an upload, Library items or products. Up to three. */
  function refsBlock(P, { locked, needsPhoto, refs }) {
    const label = P.source === 'product' ? 'Product' : P.source === 'mascot' ? 'Mascot or logo' : P.source === 'photo' ? 'Photo' : 'References';
    const full = refs.length >= MAX_REFS;
    const products = S.catalog && S.catalog.has;
    const thumbs = refs.map((r, i) => `<div class="nl-sref" title="${esc(r.label || REF_KIND_LABEL[r.kind] || '')}">
        <img src="${esc(media(r.url))}" alt="">
        <span class="nl-sref__k">${esc(REF_KIND_LABEL[r.kind] || 'Photo')}</span>
        ${locked ? '' : `<button type="button" class="nl-sref__x" data-ref-rm="${i}" aria-label="Remove">${svg(I.x, 10, 2.4)}</button>`}
      </div>`).join('');
    const buttons = locked ? '' : `<div class="nl-srow nl-sref__add">
        <input type="file" accept="image/*" data-p-file multiple hidden>
        <button type="button" class="nl-sbtn nl-sbtn--sm" data-p-upload ${full || P.uploading ? 'disabled' : ''}>${svg(I.upload, 13)}${P.uploading ? 'Uploading…' : 'Upload'}</button>
        <button type="button" class="nl-sbtn nl-sbtn--sm" data-pick-from="library" ${full ? 'disabled' : ''}>${svg(I.image, 13)}Library</button>
        ${products || P.source === 'product' ? `<button type="button" class="nl-sbtn nl-sbtn--sm" data-pick-from="products" ${full || !products ? 'disabled' : ''} ${products ? '' : 'title="No product catalog connected"'}>${svg(I.grid, 13)}Products</button>` : ''}
      </div>`;
    return `<div class="nl-slabel nl-slabel--row"><span>${label}${needsPhoto ? '' : ' <em>optional</em>'}</span>${refs.length ? `<span class="nl-smono">${refs.length}/${MAX_REFS}</span>` : ''}</div>
      <div class="nl-srefs${refs.length ? '' : ' is-empty'}">
        ${thumbs}
        ${refs.length ? '' : `<p class="nl-snote">${needsPhoto ? (P.source === 'product' ? 'Pick the product it starts from.' : 'Add the photo it starts from.') : 'Add a product they hold or wear, or a look to follow.'}</p>`}
        ${buttons}
      </div>`;
  }

  function addRefs(list) {
    const P = S.panel;
    if (!P || P.mode !== 'new') return;
    P.refs = P.refs || [];
    for (const r of list) {
      if (!r || !/^https?:\/\//i.test(String(r.url || '')) || P.refs.some((x) => x.url === r.url)) continue;
      if (P.refs.length >= MAX_REFS) break;
      P.refs.push({ url: r.url, kind: r.kind || 'photo', label: r.label || '' });
      // A product or Library item names the new thing when nothing is typed yet.
      if (!String(P.name || '').trim() && r.label) P.name = String(r.label).slice(0, 60);
    }
  }

  async function checkCatalog() {
    S.catalog = { has: false, checking: true };
    try {
      const d = await api('/api/studio/products?limit=1&page=1');
      S.catalog = { has: Array.isArray(d.products) && d.products.length > 0 };
    } catch (_) {
      S.catalog = { has: false };
    }
    if (S.catalog.has && S.view === 'kit') render();
  }

  // ── Library and product picker ─────────────────────────────────────────────
  const LIB_KINDS = {
    character: ['character', 'item', 'logo', 'style', 'setting', 'scene'],
    place: ['setting', 'scene', 'plate', 'style', 'item'],
    item: ['item', 'logo', 'style'],
  };
  const LIB_KIND_LABEL = { character: 'Characters', item: 'Items', logo: 'Logos', style: 'Styles', setting: 'Settings', scene: 'Scenes', plate: 'Plates' };

  function openPicker(tab) {
    const P = S.panel;
    if (!P) return;
    S.picker = { tab, q: '', kind: '', items: null, sel: new Map(), room: MAX_REFS - (P.refs || []).length, loading: true, error: null };
    paintPicker();
    loadPicker();
  }
  function closePicker() {
    S.picker = null;
    document.getElementById('nl-spick')?.remove();
  }
  async function loadPicker() {
    const pk = S.picker;
    if (!pk) return;
    pk.loading = true;
    pk.error = null;
    paintPicker();
    try {
      if (pk.tab === 'library') {
        if (!S.assets) S.assets = (await api('/api/assets')).assets || [];
        // Every image in the Library, the kinds that fit this element first.
        const kinds = LIB_KINDS[(S.panel && S.panel.type) || 'character'];
        const rank = (k) => { const i = kinds.indexOf(k); return i < 0 ? kinds.length : i; };
        pk.items = S.assets.filter((a) => a && a.url && !['color', 'music', 'outro', 'video'].includes(a.kind) && !/\.(mp4|mov|webm|mp3|wav|m4a)(\?|$)/i.test(a.url))
          .sort((a, b) => rank(a.kind) - rank(b.kind))
          .map((a) => ({ id: `a:${a.id}`, url: a.url, label: a.name || LIB_KIND_LABEL[a.kind] || 'Library', kind: a.kind === 'logo' ? 'logo' : 'library', group: a.kind }));
      } else {
        const qs = new URLSearchParams({ limit: '36', page: '1' });
        if (pk.q) qs.set('search', pk.q);
        const d = await api(`/api/studio/products?${qs}`);
        if (S.picker !== pk) return;
        pk.items = (d.products || []).filter((x) => x.primary_image).map((x) => ({ id: `p:${x.id}`, url: x.primary_image, label: x.title || 'Product', kind: 'product', group: x.product_type || '' }));
      }
    } catch (e) {
      pk.error = e.message || 'Could not load';
      pk.items = [];
    }
    pk.loading = false;
    if (S.picker === pk) paintPicker();
  }
  function paintPicker() {
    const pk = S.picker;
    if (!pk) return;
    let ov = document.getElementById('nl-spick');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'nl-spick';
      ov.className = 'nl-spick';
      document.body.appendChild(ov);
      ov.addEventListener('click', onPickerClick);
      ov.addEventListener('input', (e) => {
        if (!e.target.matches('[data-pk-q]') || !S.picker) return;
        S.picker.q = e.target.value;
        clearTimeout(S.picker.t);
        if (S.picker.tab === 'products') S.picker.t = setTimeout(loadPicker, 300);
        else paintPickerGrid();
      });
    }
    const products = S.catalog && S.catalog.has;
    ov.innerHTML = `<div class="nl-spick__bg" data-pk-close></div>
      <div class="nl-spick__p" role="dialog" aria-modal="true" aria-label="Add a reference">
        <div class="nl-spick__h">
          <h3>Add a reference</h3>
          <div class="nl-sseg" role="tablist">
            <button type="button" role="tab" data-pk-tab="library" aria-pressed="${pk.tab === 'library'}">Library</button>
            ${products ? `<button type="button" role="tab" data-pk-tab="products" aria-pressed="${pk.tab === 'products'}">Products</button>` : ''}
          </div>
          <span class="nl-grow"></span>
          <button type="button" class="nl-sicon" data-pk-close aria-label="Close">${svg(I.x, 14)}</button>
        </div>
        <div class="nl-spick__bar"><input class="nl-sinput" type="search" data-pk-q placeholder="${pk.tab === 'products' ? 'Search products' : 'Search the Library'}" value="${esc(pk.q)}" aria-label="Search"></div>
        <div class="nl-spick__grid" data-pk-grid></div>
        <div class="nl-spick__f">
          <span class="nl-snote" data-pk-count></span>
          <span class="nl-grow"></span>
          <button type="button" class="nl-sbtn" data-pk-close>Cancel</button>
          <button type="button" class="nl-sbtn nl-sbtn--primary" data-pk-use disabled>Add</button>
        </div>
      </div>`;
    paintPickerGrid();
    const q = ov.querySelector('[data-pk-q]');
    if (q && document.activeElement !== q) setTimeout(() => q.focus(), 0);
  }
  function paintPickerGrid() {
    const pk = S.picker;
    const ov = document.getElementById('nl-spick');
    if (!pk || !ov) return;
    const grid = ov.querySelector('[data-pk-grid]');
    const q = pk.q.trim().toLowerCase();
    const items = (pk.items || []).filter((x) => pk.tab === 'products' || !q || `${x.label} ${x.group}`.toLowerCase().includes(q));
    if (pk.loading) grid.innerHTML = '<div class="nl-spick__empty"><i class="nl-sspin"></i>Loading</div>';
    else if (pk.error) grid.innerHTML = `<div class="nl-spick__empty">${esc(pk.error)}</div>`;
    else if (!items.length) grid.innerHTML = `<div class="nl-spick__empty">${pk.tab === 'products' ? 'No products found.' : 'Nothing here yet. Add characters, items and settings in Library.'}</div>`;
    else {
      grid.innerHTML = items.map((x) => {
        const on = pk.sel.has(x.id);
        return `<button type="button" class="nl-spick__it${on ? ' is-on' : ''}" data-pk-item="${esc(x.id)}" aria-pressed="${on}">
          <span class="nl-spick__im"><img src="${esc(media(x.url))}" alt="" loading="lazy"><i>${on ? svg(I.check, 12, 3) : ''}</i></span>
          <span class="nl-spick__t">${esc(x.label)}</span>${x.group ? `<span class="nl-spick__s">${esc(LIB_KIND_LABEL[x.group] || x.group)}</span>` : ''}
        </button>`;
      }).join('');
    }
    const n = pk.sel.size;
    ov.querySelector('[data-pk-count]').textContent = pk.room <= 0 ? 'Already at three references' : `${n} of up to ${pk.room} picked`;
    const use = ov.querySelector('[data-pk-use]');
    use.disabled = !n;
    use.textContent = n > 1 ? `Add ${n}` : 'Add';
  }
  function onPickerClick(e) {
    const pk = S.picker;
    if (!pk) return;
    const t = e.target;
    if (t.closest('[data-pk-close]')) { closePicker(); return; }
    const tab = t.closest('[data-pk-tab]');
    if (tab) { if (tab.dataset.pkTab !== pk.tab) { pk.tab = tab.dataset.pkTab; pk.q = ''; pk.sel.clear(); pk.items = null; paintPicker(); loadPicker(); } return; }
    const it = t.closest('[data-pk-item]');
    if (it) {
      const item = (pk.items || []).find((x) => x.id === it.dataset.pkItem);
      if (!item) return;
      if (pk.sel.has(item.id)) pk.sel.delete(item.id);
      else if (pk.sel.size < pk.room) pk.sel.set(item.id, item);
      else if (pk.room === 1) { pk.sel.clear(); pk.sel.set(item.id, item); }
      else { toast(`Up to ${MAX_REFS} references in all`, 'info'); return; }
      paintPickerGrid();
      return;
    }
    if (t.closest('[data-pk-use]')) {
      addRefs([...pk.sel.values()]);
      closePicker();
      render();
    }
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.picker) closePicker(); });

  async function useAsIs() {
    const P = S.panel;
    const ref = P && (P.refs || [])[0];
    if (!ref) return;
    const name = String(P.name || '').trim();
    if (!name) { toast('Give it a name first', 'error'); focusLater('[data-p-name]'); return; }
    try {
      const d = await api(`/api/animation/kits/${encodeURIComponent(S.kit.id)}/elements`, {
        method: 'POST',
        body: JSON.stringify({ type: P.type, name, description: P.description || '', source: P.source, image_url: ref.url, kind: ref.kind, label: ref.label, need_id: P.need_id || undefined }),
      });
      afterLock(d, P);
    } catch (e) {
      toast(e.message || 'Could not add it to the kit', 'error', e.request_id);
    }
  }

  function elPanel() {
    const e = (S.kit.elements || []).find((x) => x.id === S.panel.id);
    if (!e) { S.panel = null; return panelView(); }
    const P = S.panel;
    const sheet = e.type === 'character'
      ? `<div class="nl-slabel nl-slabel--row"><span>Turnaround</span>${e.sheet_status === 'failed' ? '<button type="button" class="nl-slink" data-sheet-redo>Try again</button>' : ''}</div>
         ${e.sheet_url && e.sheet_status !== 'working' ? `<img class="nl-ssheet" src="${esc(media(e.sheet_url))}" alt="Front, three-quarter and side views">`
          : e.sheet_status === 'working' ? '<div class="nl-ssheet nl-ssheet--wait"><i class="nl-sshim"></i><span>Making front, three-quarter and side views</span></div>'
            : '<div class="nl-snote">The views did not come out. Try again.</div>'}`
      : '';
    return `<div class="nl-scard nl-spanel">
      <div class="nl-spanel__h"><h3>${esc(e.name)} <span class="nl-spanel__k">${esc(elType(e))}</span></h3><button type="button" class="nl-sicon" data-panel-close aria-label="Close">${svg(I.x, 14)}</button></div>
      <div class="nl-spanel__b">
        <img class="nl-spanel__img${e.type === 'item' ? ' nl-spanel__img--item' : ''}" src="${esc(media(e.image_url))}" alt="">
        ${sheet}
        <label class="nl-slabel" for="nl-se-name">Name</label>
        <input id="nl-se-name" class="nl-sinput" data-e-name data-fk="ename" maxlength="60" value="${esc(P.name != null ? P.name : e.name)}">
        <label class="nl-slabel" for="nl-se-about">${e.type === 'character' ? 'Who they are' : 'About'}</label>
        <textarea id="nl-se-about" class="nl-sinput nl-sarea" data-e-about data-fk="eabout" rows="3" maxlength="600">${esc(P.description != null ? P.description : e.description || '')}</textarea>
      </div>
      <div class="nl-spanel__f nl-spanel__f--row">
        <button type="button" class="nl-sbtn" data-e-save ${P.dirty ? '' : 'disabled'}>Save</button>
        <span class="nl-grow"></span>
        <button type="button" class="nl-sbtn nl-sbtn--danger" data-e-del>Delete</button>
      </div>
    </div>`;
  }

  // ── 2 Story ──────────────────────────────────────────────────────────────
  const sceneColor = (i) => COLORS[i % COLORS.length];
  function elById(id) { return ((S.kit && S.kit.elements) || []).find((e) => e.id === id) || null; }

  function storyView() {
    const st = stats(S.story);
    const locked = busyReel(S.reel);
    const made = madeReel(S.reel) && !locked;
    const scenes = S.story.scenes;
    if (S.sel && !scenes.some((s) => s.id === S.sel)) S.sel = scenes[0] ? scenes[0].id : null;
    const banner = locked
      ? `<div class="nl-sban">${svg(I.spark, 14)}<span>This reel is being made from the story.</span><button type="button" class="nl-slink" data-step="board">Open the reel</button></div>`
      : made ? `<div class="nl-sban nl-sban--quiet">${svg(I.check, 14)}<span>Made already. Changes here apply when you make it again.</span><button type="button" class="nl-slink" data-step="board">Open the reel</button></div>` : '';
    const needs = ((S.kit && S.kit.suggestions) || []).filter((n) => n.reel_id === S.reel.id);
    const needBar = needs.length ? `<div class="nl-sban nl-sban--need">${svg(I.plus, 14)}<span>The story needs ${needs.map((n) => `<b>${esc(n.name)}</b> (scene ${n.scene})`).join(', ')}.</span>${needs.map((n) => `<button type="button" class="nl-sbtn nl-sbtn--sm" data-need="${esc(n.id)}">Make ${esc(n.name)}</button>`).join('')}</div>` : '';
    return `<fieldset class="nl-sstory" ${locked ? 'disabled' : ''}>
      ${banner}
      <div class="nl-sstory__main">
        ${scriptCard(st)}
        ${needBar}
        <section class="nl-scard nl-sscenes" aria-label="Scenes">
          <div class="nl-sscenes__grid">${scenes.map(sceneCard).join('')}
            ${scenes.length < 6 ? `<button type="button" class="nl-sscene nl-sscene--add" data-add-scene>${svg(I.plus, 16)}<span>Add a scene</span></button>` : ''}
          </div>
        </section>
      </div>
      <aside class="nl-sstory__side">${inspector()}</aside>
    </fieldset>
    ${storyFoot(st)}`;
  }

  function fitChip(st) {
    if (!st.words) return '<span class="nl-schip">No voiceover yet</span>';
    return st.fits
      ? `<span class="nl-schip nl-schip--ok"><i></i>Fits ${plural(st.scenes, 'scene')}</span>`
      : `<span class="nl-schip nl-schip--warn"><i></i>Runs long by ${Math.ceil(st.spoken - st.seconds + 0.4)}s</span>`;
  }

  function scriptCard(st) {
    const scenes = S.story.scenes;
    const W = S.writer;
    const writer = W ? `<div class="nl-swriter">
        <label class="nl-slabel" for="nl-sw-idea">What is this reel about?</label>
        <textarea id="nl-sw-idea" class="nl-sinput nl-sarea" data-w-idea data-fk="widea" rows="3" maxlength="1500" placeholder="A dad notices a symptom early, reads our leaflet and books a GP appointment.">${esc(W.idea || '')}</textarea>
        <div class="nl-srow">
          <button type="button" class="nl-sbtn nl-sbtn--primary" data-w-go ${W.busy ? 'disabled' : ''}>${W.busy ? '<i class="nl-sspin"></i>Writing…' : `${svg(I.spark, 13)}${scenes.length ? 'Rewrite the scenes' : 'Write the scenes'}`}</button>
          ${scenes.length ? `<button type="button" class="nl-sbtn" data-w-cancel ${W.busy ? 'disabled' : ''}>Cancel</button><span class="nl-snote">Replaces the lines and clears previews.</span>` : '<button type="button" class="nl-slink" data-add-scene>or write the lines yourself</button>'}
        </div>
      </div>` : '';
    const lines = scenes.map((s, i) => `<li class="nl-sline${s.id === S.sel ? ' is-sel' : ''}" style="--c:${sceneColor(i)}" data-line-row="${esc(s.id)}">
        <span class="nl-sline__n">${i + 1}</span>
        <textarea class="nl-sline__t" rows="1" data-line="${esc(s.id)}" data-fk="line:${esc(s.id)}" placeholder="What the voice says in scene ${i + 1}" aria-label="Voiceover line ${i + 1}">${esc(s.line)}</textarea>
        <span class="nl-sline__s" data-line-secs="${esc(s.id)}">${s.seconds.toFixed(1)}s</span>
      </li>`).join('');
    return `<section class="nl-scard nl-sscript" aria-label="Script">
      <div class="nl-sscript__h">
        <span class="nl-sscript__t">${svg(I.mic, 15)}Script</span>
        ${W ? '' : `<button type="button" class="nl-sbtn nl-sbtn--sm" data-w-open>${svg(I.spark, 13)}Write it for me</button>`}
        <span class="nl-grow"></span>
        <span class="nl-smono" data-st-words>${st.words} words · ${clock(st.seconds)}</span>
        <span data-st-fit>${fitChip(st)}</span>
      </div>
      ${writer}
      ${scenes.length ? `<ol class="nl-slines">${lines}</ol>` : ''}
    </section>`;
  }

  function sceneCard(s, i) {
    const els = s.element_ids.map(elById).filter(Boolean);
    const place = els.find((e) => e.type === 'place');
    const people = els.filter((e) => e.type !== 'place').slice(0, 3);
    const needs = ((S.kit && S.kit.suggestions) || []).filter((n) => n.reel_id === S.reel.id && n.scene === i + 1);
    let mediaHtml;
    if (s.preview_status === 'working') mediaHtml = '<div class="nl-sscene__ph" aria-busy="true"><i class="nl-sshim"></i><span>Making preview</span></div>';
    else if (s.preview_url) mediaHtml = `<img src="${esc(media(s.preview_url))}" alt="Scene ${i + 1} preview" loading="lazy">`;
    else mediaHtml = `<div class="nl-sscene__ph">${place && place.image_url ? `<img class="nl-sscene__bg" src="${esc(media(place.image_url))}" alt="">` : ''}<span>${s.preview_status === 'failed' ? 'Preview did not work' : 'No preview yet'}</span><span class="nl-sbtn nl-sbtn--sm" data-preview="${esc(s.id)}" role="button" tabindex="0">Preview</span></div>`;
    return `<div class="nl-sscene${s.id === S.sel ? ' is-sel' : ''}" style="--c:${sceneColor(i)}" data-scene="${esc(s.id)}" role="button" tabindex="0" aria-pressed="${s.id === S.sel}" aria-label="Scene ${i + 1}">
      <div class="nl-sscene__m">${mediaHtml}
        <span class="nl-sscene__num"><i></i>${i + 1} · ${Number(s.seconds).toFixed(0)}s</span>
        ${s.preview_url && s.preview_stale ? '<span class="nl-sscene__stale">Out of date</span>' : ''}
        ${people.length ? `<span class="nl-sfaces nl-sscene__cast">${people.map((e) => `<img src="${esc(media(e.image_url))}" alt="${esc(e.name)}" title="${esc(e.name)}">`).join('')}</span>` : ''}
      </div>
      <div class="nl-sscene__p">${esc(place ? place.name : 'No place yet')}</div>
      <div class="nl-sscene__w" data-what-card="${esc(s.id)}">${esc(s.what || 'Say what happens')}</div>
      ${needs.map((n) => `<span class="nl-sneedchip">Needs ${esc(n.name)}</span>`).join('')}
    </div>`;
  }

  function inspector() {
    const scenes = S.story.scenes;
    const i = scenes.findIndex((s) => s.id === S.sel);
    if (i < 0) {
      return `<div class="nl-scard nl-sinsp nl-sinsp--idle"><p class="nl-ssub">${scenes.length ? 'Pick a scene to set who is in it, what happens, the camera and its length.' : 'Write the scenes, or add the first one yourself.'}</p></div>`;
    }
    const s = scenes[i];
    const els = s.element_ids.map(elById).filter(Boolean);
    const rest = ((S.kit && S.kit.elements) || []).filter((e) => !s.element_ids.includes(e.id));
    const addMenu = S.addEl ? `<div class="nl-saddmenu" role="menu">
        ${['character', 'place', 'item'].map((t) => {
          const list = rest.filter((e) => e.type === t);
          if (!list.length) return '';
          return `<div class="nl-saddmenu__h">${{ character: 'Characters', place: 'Places', item: 'Props and products' }[t]}</div>${list.map((e) => `<button type="button" role="menuitem" data-add-el="${esc(e.id)}"><img src="${esc(media(e.image_url))}" alt="">${esc(e.name)}</button>`).join('')}`;
        }).join('')}
        <button type="button" role="menuitem" class="nl-saddmenu__new" data-go-kit>${svg(I.plus, 13)}Make something new</button>
      </div>` : '';
    const cams = [['still', 'Still'], ['push', 'Push'], ['pan', 'Pan'], ['orbit', 'Orbit']];
    const preview = s.preview_status === 'working';
    return `<div class="nl-scard nl-sinsp">
      <div class="nl-sinsp__h"><h3>Scene ${i + 1}</h3><span class="nl-smono" data-insp-secs>${s.seconds.toFixed(1)}s</span></div>
      <div class="nl-slabel nl-slabel--row"><span>In this scene</span><button type="button" class="nl-slink" data-add-open aria-expanded="${S.addEl ? 'true' : 'false'}">${svg(I.plus, 12)}Add</button></div>
      ${addMenu}
      <div class="nl-sinels">${els.length ? els.map((e) => `<div class="nl-sinel"><img src="${esc(media(e.image_url))}" alt=""><span class="nl-sinel__t">${esc(e.name)}</span><span class="nl-sinel__k">${esc(elType(e))}</span><button type="button" class="nl-sicon nl-sicon--sm" data-rm-el="${esc(e.id)}" aria-label="Take ${esc(e.name)} out of this scene">${svg(I.x, 12)}</button></div>`).join('') : '<div class="nl-snote">Add who and where from the kit.</div>'}</div>
      <label class="nl-slabel" for="nl-si-what">What happens</label>
      <textarea id="nl-si-what" class="nl-sinput nl-sarea" data-what="${esc(s.id)}" data-fk="what:${esc(s.id)}" rows="3" maxlength="600" placeholder="Ravi reads the leaflet at the kitchen table and nods.">${esc(s.what)}</textarea>
      <div class="nl-slabel nl-slabel--row"><span>Voiceover <span class="nl-schip nl-schip--line" style="--c:${sceneColor(i)}"><i></i>Line ${i + 1}</span></span><button type="button" class="nl-slink" data-edit-line="${esc(s.id)}">Edit in script</button></div>
      <blockquote class="nl-squote" style="--c:${sceneColor(i)}" data-insp-line>${s.line ? `“${esc(s.line)}”` : '<em>No line yet</em>'}</blockquote>
      <div class="nl-sinsp__row">
        <div><div class="nl-slabel">Camera</div><div class="nl-sseg" role="group" aria-label="Camera">${cams.map(([v, l]) => `<button type="button" data-cam="${v}" aria-pressed="${s.camera === v}">${l}</button>`).join('')}</div></div>
        <div class="nl-slen"><div class="nl-slabel nl-slabel--row"><span>Length</span><span class="nl-smono" data-len-val>${s.seconds.toFixed(1)}s${s.seconds_manual ? '' : ' auto'}</span></div>
          <input type="range" min="4" max="8" step="0.5" value="${s.seconds}" data-len aria-label="Scene length in seconds">
          ${s.seconds_manual ? '<button type="button" class="nl-slink" data-len-auto>Fit to the line</button>' : ''}</div>
      </div>
      <div class="nl-sinsp__acts">
        <button type="button" class="nl-sbtn nl-sbtn--sm" data-preview="${esc(s.id)}" ${preview ? 'disabled' : ''}>${preview ? '<i class="nl-sspin"></i>Previewing' : `${svg(I.redo, 13)}${s.preview_url ? 'New preview' : 'Preview'}`}</button>
        <button type="button" class="nl-sbtn nl-sbtn--sm" data-dup ${scenes.length >= 6 ? 'disabled' : ''}>${svg(I.copy, 13)}Duplicate</button>
        <span class="nl-grow"></span>
        <button type="button" class="nl-sbtn nl-sbtn--sm nl-sbtn--danger" data-del-scene>Delete</button>
      </div>
    </div>`;
  }

  function storyFoot(st) {
    const used = new Set();
    S.story.scenes.forEach((s) => s.element_ids.forEach((id) => used.add(id)));
    const els = [...used].map(elById).filter(Boolean);
    const people = els.filter((e) => e.type === 'character');
    const nPlaces = els.filter((e) => e.type === 'place').length;
    const nItems = els.filter((e) => e.type === 'item').length;
    const who = [people.map((e) => e.name).join(', '), nPlaces ? plural(nPlaces, 'place') : '', nItems ? plural(nItems, 'product') : ''].filter(Boolean).join(' · ');
    const made = madeReel(S.reel);
    const busy = busyReel(S.reel);
    return `<div class="nl-sfoot">
      <b class="nl-sfoot__t" data-ft-total>${plural(st.scenes, 'scene')} · ${clock(st.seconds)}</b>
      ${who ? `<span class="nl-sfoot__sep"></span>${people.length ? `<span class="nl-sfaces">${people.slice(0, 3).map((e) => `<img src="${esc(media(e.image_url))}" alt="">`).join('')}</span>` : ''}<span class="nl-sfoot__m">${esc(who)}</span>` : ''}
      <span class="nl-sfoot__sep"></span>
      <span data-ft-fit>${st.words ? (st.fits ? '<span class="nl-sstate nl-sstate--ok"><i></i>Voiceover fits</span>' : '<span class="nl-sstate nl-sstate--warn"><i></i>Voiceover runs long</span>') : '<span class="nl-sstate"><i></i>No voiceover yet</span>'}</span>
      <span class="nl-sstate nl-ssave" data-save-state></span>
      <span class="nl-grow"></span>
      <button type="button" class="nl-sbtn" data-animatic ${st.words ? '' : 'disabled'}>${svg(I.play, 12)}Play animatic</button>
      <button type="button" class="nl-sbtn nl-sbtn--primary" data-make ${busy || !st.scenes ? 'disabled' : ''}>${made ? 'Make it again' : 'Make the reel'} · ${plural(st.scenes, 'render')} ${svg(I.right, 14)}</button>
    </div>`;
  }

  function paintSaveState() {
    const el = box && box.querySelector('[data-save-state]');
    if (!el) return;
    const st = S.save.state;
    el.className = `nl-sstate nl-ssave${st === 'error' ? ' nl-sstate--warn' : ''}`;
    el.textContent = st === 'saving' ? 'Saving…' : st === 'error' ? 'Not saved' : 'Saved';
  }

  /** Small updates while typing, so the field keeps focus. */
  function paintStoryBits() {
    if (!box || S.view !== 'story' || !S.story) return;
    const st = stats(S.story);
    const w = box.querySelector('[data-st-words]');
    if (w) w.textContent = `${st.words} words · ${clock(st.seconds)}`;
    const fit = box.querySelector('[data-st-fit]');
    if (fit) fit.innerHTML = fitChip(st);
    const tot = box.querySelector('[data-ft-total]');
    if (tot) tot.textContent = `${plural(st.scenes, 'scene')} · ${clock(st.seconds)}`;
    const ff = box.querySelector('[data-ft-fit]');
    if (ff) ff.innerHTML = st.words ? (st.fits ? '<span class="nl-sstate nl-sstate--ok"><i></i>Voiceover fits</span>' : '<span class="nl-sstate nl-sstate--warn"><i></i>Voiceover runs long</span>') : '<span class="nl-sstate"><i></i>No voiceover yet</span>';
    S.story.scenes.forEach((s, i) => {
      const secs = box.querySelector(`[data-line-secs="${CSS.escape(s.id)}"]`);
      if (secs) secs.textContent = `${s.seconds.toFixed(1)}s`;
      const num = box.querySelector(`[data-scene="${CSS.escape(s.id)}"] .nl-sscene__num`);
      if (num) num.innerHTML = `<i></i>${i + 1} · ${Number(s.seconds).toFixed(0)}s`;
      const wc = box.querySelector(`[data-what-card="${CSS.escape(s.id)}"]`);
      if (wc) wc.textContent = s.what || 'Say what happens';
    });
    const sel = S.story.scenes.find((s) => s.id === S.sel);
    if (sel) {
      const q = box.querySelector('[data-insp-line]');
      if (q) q.innerHTML = sel.line ? `“${esc(sel.line)}”` : '<em>No line yet</em>';
      const is = box.querySelector('[data-insp-secs]');
      if (is) is.textContent = `${sel.seconds.toFixed(1)}s`;
      const lv = box.querySelector('[data-len-val]');
      if (lv) lv.textContent = `${sel.seconds.toFixed(1)}s${sel.seconds_manual ? '' : ' auto'}`;
      const rng = box.querySelector('[data-len]');
      if (rng && document.activeElement !== rng) rng.value = String(sel.seconds);
    }
    const anim = box.querySelector('[data-animatic]');
    if (anim) anim.disabled = !st.words;
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  function selScene() { return S.story && S.story.scenes.find((s) => s.id === S.sel); }

  async function makeLooks({ again = false } = {}) {
    const P = S.panel;
    if (!P || !S.kit) return;
    const name = String(P.name || '').trim();
    if (!name) { toast('Give it a name first', 'error'); focusLater('[data-p-name]'); return; }
    const refs = P.refs || [];
    if (P.source === 'describe' && !String(P.description || '').trim() && !refs.length) { toast('Describe it in a sentence or two', 'error'); focusLater('[data-p-about]'); return; }
    if (P.source !== 'describe' && !refs.length) { toast(P.source === 'product' ? 'Pick the product first' : 'Add a photo to start from', 'error'); return; }
    const count = P.count || lookCountPref();
    try {
      // "N more" adds looks to this set, so the ones already made stay to compare and pick.
      const more = again && P.draft_id;
      const d = await api(`/api/animation/kits/${encodeURIComponent(S.kit.id)}/options`, {
        method: 'POST',
        body: JSON.stringify(more
          ? { more_of: P.draft_id, count }
          : { type: P.type, name, description: P.description || '', source: P.source, refs, count, need_id: P.need_id || undefined, reel_id: S.reel ? S.reel.id : undefined }),
      });
      S.kit = d.kit;
      P.draft_id = d.draft.id;
      if (!more) P.picks = [];
      render();
      pollIfWorking();
    } catch (e) {
      toast(e.message || 'Could not make the looks', 'error', e.request_id);
    }
  }

  /** The picked looks by number, plus what they show, so they can be added even if the set's record went missing. */
  function lockBody(P) {
    const draft = (S.kit.drafts || []).find((d) => d.id === P.draft_id);
    const picks = (P.picks || []).slice().sort((a, b) => a - b);
    const looks = draft ? picks.map((i) => draft.options[i] && draft.options[i].url).filter(Boolean) : [];
    return { draft_id: P.draft_id, options: picks, looks, type: P.type, name: P.name || (draft && draft.name) || '', description: P.description || '', source: P.source, refs: P.refs || [] };
  }

  /* ── Look closer: one look large, step through the set, pick from here ── */
  function viewerDraft() {
    const P = S.panel;
    return P && P.draft_id && S.kit ? (S.kit.drafts || []).find((d) => d.id === P.draft_id) : null;
  }
  function openViewer(i) {
    S.viewer = { i, back: document.activeElement };
    paintViewer();
    document.querySelector('#nl-sview [data-v-pick]')?.focus();
  }
  function closeViewer() {
    const back = S.viewer && S.viewer.back;
    S.viewer = null;
    document.getElementById('nl-sview')?.remove();
    const z = back && back.dataset && back.dataset.zoom != null ? document.querySelector(`[data-zoom="${back.dataset.zoom}"]`) : null;
    if (z) z.focus();
  }
  function paintViewer() {
    const P = S.panel;
    const draft = viewerDraft();
    const ready = draft ? draft.options.map((o, i) => (o.status === 'ready' && o.url ? i : -1)).filter((i) => i >= 0) : [];
    if (!S.viewer || !draft || !ready.length) { closeViewer(); return; }
    if (!ready.includes(S.viewer.i)) S.viewer.i = ready[0];
    const i = S.viewer.i;
    const at = ready.indexOf(i);
    const picks = P.picks || [];
    const on = picks.includes(i);
    const kind = { character: 'character', place: 'place', item: 'item' }[P.type] || 'look';
    let ov = document.getElementById('nl-sview');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'nl-sview';
      ov.className = 'nl-sview';
      document.body.appendChild(ov);
      ov.addEventListener('click', onViewerClick);
    }
    ov.innerHTML = `<div class="nl-sview__bg" data-v-close></div>
      <div class="nl-sview__p" role="dialog" aria-modal="true" aria-label="${esc(P.name || kind)}, look ${i + 1}">
        <div class="nl-sview__h">
          <h3>${esc(P.name || kind)} <span>· look ${i + 1}</span></h3>
          <span class="nl-snote">${at + 1} of ${ready.length}</span>
          <span class="nl-grow"></span>
          <button type="button" class="nl-sicon" data-v-close aria-label="Close">${svg(I.x, 14)}</button>
        </div>
        <div class="nl-sview__stage">
          <button type="button" class="nl-sview__nav nl-sview__nav--prev" data-v-step="-1" aria-label="Previous look" ${ready.length < 2 ? 'disabled' : ''}>${svg(I.left, 18, 2)}</button>
          <img src="${esc(media(draft.options[i].url))}" alt="${esc(P.name || kind)}, look ${i + 1}">
          <button type="button" class="nl-sview__nav nl-sview__nav--next" data-v-step="1" aria-label="Next look" ${ready.length < 2 ? 'disabled' : ''}>${svg(I.next, 18, 2)}</button>
        </div>
        ${ready.length > 1 ? `<div class="nl-sview__strip">${ready.map((k) => `<button type="button" class="nl-sview__th${k === i ? ' is-cur' : ''}${picks.includes(k) ? ' is-on' : ''}" data-v-go="${k}" aria-label="Look ${k + 1}${picks.includes(k) ? ', picked' : ''}" aria-current="${k === i}"><img src="${esc(media(draft.options[k].url))}" alt=""><span>${picks.includes(k) ? svg(I.check, 10, 3) : k + 1}</span></button>`).join('')}</div>` : ''}
        <div class="nl-sview__f">
          <span class="nl-snote">${picks.length ? `${picks.length} picked` : 'Nothing picked yet'}</span>
          <span class="nl-grow"></span>
          <button type="button" class="nl-sbtn${on ? '' : ' nl-sbtn--primary'}" data-v-pick aria-pressed="${on}">${on ? `${svg(I.check, 13, 2.4)}Picked` : 'Pick this look'}</button>
          <button type="button" class="nl-sbtn" data-v-close>Done</button>
        </div>
      </div>`;
  }
  function viewerStep(d) {
    const draft = viewerDraft();
    if (!draft || !S.viewer) return;
    const ready = draft.options.map((o, i) => (o.status === 'ready' && o.url ? i : -1)).filter((i) => i >= 0);
    const at = ready.indexOf(S.viewer.i);
    S.viewer.i = ready[(at + d + ready.length) % ready.length];
    paintViewer();
  }
  function viewerPick() {
    const P = S.panel;
    if (!P || !S.viewer) return;
    const i = S.viewer.i;
    const cur = P.picks || [];
    P.picks = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i];
    render();
    paintViewer();
    document.querySelector('#nl-sview [data-v-pick]')?.focus();
  }
  function onViewerClick(e) {
    const q = (sel) => e.target.closest(sel);
    let b;
    if (q('[data-v-close]')) { closeViewer(); return; }
    if ((b = q('[data-v-step]'))) { viewerStep(Number(b.dataset.vStep)); return; }
    if ((b = q('[data-v-go]'))) { S.viewer.i = Number(b.dataset.vGo); paintViewer(); return; }
    if (q('[data-v-pick]')) viewerPick();
  }
  document.addEventListener('keydown', (e) => {
    if (!S.viewer) return;
    if (e.key === 'Escape') { e.preventDefault(); closeViewer(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); viewerStep(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); viewerStep(1); }
  });

  async function lockLook({ usePhoto = false } = {}) {
    const P = S.panel;
    if (!P || !P.draft_id) return;
    try {
      const d = await api(`/api/animation/kits/${encodeURIComponent(S.kit.id)}/elements`, {
        method: 'POST',
        body: JSON.stringify(usePhoto ? { draft_id: P.draft_id, use_photo: true } : lockBody(P)),
      });
      afterLock(d, P);
    } catch (e) {
      toast(e.message || 'Could not add it to the kit', 'error', e.request_id);
    }
  }

  /** A new element is in the kit: show it, follow the story that asked for it, refresh. */
  function afterLock(d, P) {
    S.kit = d.kit;
    if (d.reel && S.reel && d.reel.id === S.reel.id && S.story) {
      // The new element went into the scene that asked for it.
      const by = new Map(((d.reel.story && d.reel.story.scenes) || []).map((s) => [s.id, s]));
      S.story.scenes.forEach((s) => { const r = by.get(s.id); if (r) s.element_ids = r.element_ids.slice(); });
    }
    S.panel = { mode: 'el', id: d.element.id };
    const added = Array.isArray(d.elements) && d.elements.length ? d.elements : [d.element];
    toast(added.length > 1
      ? `${added.length} ${{ character: 'characters', place: 'places', item: 'items' }[d.element.type] || 'things'} are in the kit${d.element.type === 'character' ? '. Making their turnaround views.' : ''}`
      : d.element.type === 'character' && d.element.sheet_status === 'working' ? `${d.element.name} is locked. Making the turnaround views.` : `${d.element.name} is in the kit`, 'success');
    if (P.need_id && S.reel) { S.view = 'story'; S.panel = null; remember(); }
    render();
    paintHeader();
    pollIfWorking();
    refreshKits();
  }

  async function uploadPhoto(files) {
    const P = S.panel;
    const list = [...(files || [])].filter(Boolean);
    if (!list.length || !P) return;
    const room = MAX_REFS - (P.refs || []).length;
    if (room <= 0) { toast(`Up to ${MAX_REFS} references`, 'info'); return; }
    if (list.length > room) toast(`Only ${room} more can be added`, 'info');
    P.uploading = true;
    render();
    try {
      for (const file of list.slice(0, room)) {
        if (!/^image\//.test(file.type)) { toast('Please pick an image', 'error'); continue; }
        if (file.size > 10 * 1024 * 1024) { toast('Image must be under 10MB', 'error'); continue; }
        addRefs([{ url: await H.uploadImage(file), kind: 'photo' }]);
      }
    } catch (e) {
      toast(e.message || 'Upload failed', 'error', e.request_id);
    } finally {
      P.uploading = false;
      render();
    }
  }

  async function saveElement() {
    const P = S.panel;
    if (!P || P.mode !== 'el') return;
    try {
      const body = {};
      if (P.name != null) body.name = P.name;
      if (P.description != null) body.description = P.description;
      const d = await api(`/api/animation/kits/${encodeURIComponent(S.kit.id)}/elements/${encodeURIComponent(P.id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      S.kit = d.kit;
      S.panel = { mode: 'el', id: P.id };
      render();
      toast('Saved', 'success');
    } catch (e) {
      toast(e.message || 'Could not save', 'error', e.request_id);
    }
  }

  async function deleteElement() {
    const P = S.panel;
    const e = P && (S.kit.elements || []).find((x) => x.id === P.id);
    if (!e) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete ${e.name} from this kit? Reels already made keep it.`)) return;
    try {
      const d = await api(`/api/animation/kits/${encodeURIComponent(S.kit.id)}/elements/${encodeURIComponent(e.id)}`, { method: 'DELETE' });
      S.kit = d.kit;
      S.panel = null;
      if (S.story) S.story.scenes.forEach((s) => { s.element_ids = s.element_ids.filter((id) => id !== e.id); });
      render();
      paintHeader();
      refreshKits();
    } catch (err) {
      toast(err.message || 'Could not delete it', 'error', err.request_id);
    }
  }

  async function writeStory() {
    const W = S.writer;
    if (!W || W.busy || !S.reel) return;
    W.busy = true;
    render();
    try {
      await flushSave();
      const d = await api(`/api/animation/projects/${encodeURIComponent(S.reel.id)}/story/write`, { method: 'POST', body: JSON.stringify({ idea: W.idea || '' }) });
      S.reel = d.project;
      S.story = localStory(d.project.story);
      if (d.kit) S.kit = d.kit;
      S.sel = S.story.scenes[0] ? S.story.scenes[0].id : null;
      S.writer = null;
      toast(d.needed && d.needed.length ? `Story written. It needs ${d.needed.map((n) => n.name).join(', ')}.` : 'Story written', 'success');
    } catch (e) {
      W.busy = false;
      toast(e.message || 'The writer could not write it', 'error', e.request_id);
    }
    render();
    paintHeader();
  }

  async function preview(id) {
    const s = S.story && S.story.scenes.find((x) => x.id === id);
    if (!s || s.preview_status === 'working') return;
    if (!s.what && !s.element_ids.length) { toast('Say what happens in this scene first', 'error'); return; }
    try {
      await flushSave();
      s.preview_status = 'working';
      render();
      const d = await api(`/api/animation/projects/${encodeURIComponent(S.reel.id)}/story/scenes/${encodeURIComponent(id)}/preview`, { method: 'POST' });
      mergePreviews(d.project);
      render();
      pollIfWorking();
    } catch (e) {
      s.preview_status = s.preview_url ? 'ready' : null;
      render();
      toast(e.message || 'Could not make the preview', 'error', e.request_id);
    }
  }

  function addScene({ after = null, copy = null } = {}) {
    if (!S.story || S.story.scenes.length >= 6) return;
    const base = copy || {};
    const s = {
      id: rid('sc'), line: base.line || '', what: base.what || '', element_ids: (base.element_ids || []).slice(), camera: base.camera || 'push',
      seconds: base.seconds_manual ? base.seconds : secondsFor(base.line), seconds_manual: !!base.seconds_manual,
      preview_url: null, preview_status: null, preview_stale: false,
    };
    // A new scene starts with the people and place from the one before it.
    if (!copy && S.story.scenes.length) s.element_ids = S.story.scenes[S.story.scenes.length - 1].element_ids.slice();
    const i = after ? S.story.scenes.findIndex((x) => x.id === after) : -1;
    if (i >= 0) S.story.scenes.splice(i + 1, 0, s); else S.story.scenes.push(s);
    S.sel = s.id;
    S.writer = null;
    touch({ client: true });
    render();
    focusLater(`[data-line="${CSS.escape(s.id)}"]`);
  }

  async function make() {
    if (!S.reel || !S.story) return;
    const sc = S.story.scenes;
    if (!sc.length) { toast('Add a scene first', 'error'); return; }
    const empty = sc.findIndex((s) => !s.what && !s.element_ids.length);
    if (empty >= 0) { S.sel = sc[empty].id; render(); toast(`Scene ${empty + 1} needs what happens in it`, 'error'); return; }
    if (!sc.some((s) => s.line)) { toast('Write the voiceover first', 'error'); return; }
    // eslint-disable-next-line no-alert
    if (madeReel(S.reel) && !window.confirm('Make it again? This replaces the shots made last time.')) return;
    const btn = box.querySelector('[data-make]');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="nl-sspin"></i>Starting…'; }
    try {
      await flushSave();
      const d = await api(`/api/animation/projects/${encodeURIComponent(S.reel.id)}/story/make`, { method: 'POST' });
      S.reel = d.project;
      S.view = 'board';
      S.boardPid = d.project.id;
      remember();
      stopPoll();
      H.showProject(d.project);
      paint();
    } catch (e) {
      toast(e.message || 'Could not start the reel', 'error', e.request_id);
      render();
    }
  }

  // ── Animatic: the voiceover with each scene's still, timed to its words ─────
  async function playAnimatic() {
    if (!S.story || !S.reel) return;
    const script = S.story.scenes.map((s) => s.line).filter(Boolean).join(' ');
    if (!script) return;
    closeAnimatic();
    const ov = document.createElement('div');
    ov.className = 'nl-sanim';
    ov.innerHTML = `<div class="nl-sanim__bg" data-close></div>
      <div class="nl-sanim__p" role="dialog" aria-modal="true" aria-label="Animatic">
        <div class="nl-sanim__stage"><div class="nl-sanim__frame"></div><div class="nl-sanim__cap"></div><div class="nl-sanim__wait"><i class="nl-sspin"></i>Recording the voice</div></div>
        <div class="nl-sanim__ctl"><button type="button" class="nl-sicon" data-pp aria-label="Pause">${svg(I.pause, 14)}</button><div class="nl-sanim__bar"><i></i></div><span class="nl-smono" data-t>0:00</span><button type="button" class="nl-sicon" data-close aria-label="Close">${svg(I.x, 14)}</button></div>
      </div>`;
    document.body.appendChild(ov);
    const st = { ov, audio: null, raf: 0, start: 0, paused: false, silent: false, pausedAt: 0 };
    S.anim = st;
    ov.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeAnimatic();
      if (e.target.closest('[data-pp]')) togglePause();
    });
    const scenes = S.story.scenes.map((s) => ({ ...s }));
    const total = scenes.reduce((n, s) => n + s.seconds, 0);
    // Word ranges for each scene, to follow the voice.
    let acc = 0;
    const ranges = scenes.map((s) => { const n = words(s.line); const r = [acc, acc + n]; acc += n; return r; });
    let cues = null;
    try {
      const key = script;
      if (S.animCache && S.animCache.key === key) {
        cues = S.animCache.cues;
        st.audio = new Audio(media(S.animCache.url));
      } else {
        const d = await api(`/api/animation/projects/${encodeURIComponent(S.reel.id)}/tts`, { method: 'POST', body: JSON.stringify({ vo_script: script }) });
        if (S.anim !== st) return;
        cues = d.caption_cues || [];
        S.animCache = { key, url: d.vo_url, cues };
        st.audio = new Audio(media(d.vo_url));
      }
    } catch (e) {
      if (S.anim !== st) return;
      st.silent = true;
      toast('The voice preview is not available, so this shows the timing only.', 'info');
    }
    if (S.anim !== st) return;
    ov.querySelector('.nl-sanim__wait').hidden = true;
    const frame = ov.querySelector('.nl-sanim__frame');
    const cap = ov.querySelector('.nl-sanim__cap');
    const bar = ov.querySelector('.nl-sanim__bar i');
    const tEl = ov.querySelector('[data-t]');
    let shown = -1;
    const show = (i) => {
      if (i === shown || i < 0 || i >= scenes.length) return;
      shown = i;
      const s = scenes[i];
      const place = s.element_ids.map(elById).find((e) => e && e.type === 'place');
      const img = s.preview_url || (place && place.image_url);
      frame.innerHTML = img ? `<img src="${esc(media(img))}" alt="">` : `<div class="nl-sanim__blank"><b>Scene ${i + 1}</b><span>${esc(s.what || '')}</span></div>`;
      frame.style.setProperty('--c', sceneColor(i));
      cap.textContent = s.line || '';
    };
    const sceneAtTime = (t) => {
      if (cues && cues.length) {
        let w = 0;
        for (let k = 0; k < cues.length; k++) if (Number(cues[k].start) <= t) w = k;
        const i = ranges.findIndex((r) => w >= r[0] && w < r[1]);
        return i >= 0 ? i : scenes.length - 1;
      }
      let a = 0;
      for (let i = 0; i < scenes.length; i++) { a += scenes[i].seconds; if (t < a) return i; }
      return scenes.length - 1;
    };
    const dur = () => (st.audio && Number.isFinite(st.audio.duration) ? Math.max(st.audio.duration, 0.1) : total);
    const loop = () => {
      if (S.anim !== st) return;
      const t = st.audio && !st.silent ? st.audio.currentTime : st.paused ? st.pausedAt : (performance.now() - st.start) / 1000;
      show(sceneAtTime(t));
      bar.style.width = `${Math.min(100, (t / dur()) * 100)}%`;
      tEl.textContent = `${clock(t)} / ${clock(dur())}`;
      if ((st.audio && !st.silent && st.audio.ended) || (st.silent && t >= total)) { ov.querySelector('[data-pp]').innerHTML = svg(I.play, 14); st.paused = true; st.done = true; return; }
      st.raf = requestAnimationFrame(loop);
    };
    show(0);
    st.start = performance.now();
    if (st.audio && !st.silent) {
      try { await st.audio.play(); } catch (_) { st.silent = true; st.start = performance.now(); }
    }
    st.raf = requestAnimationFrame(loop);
    function togglePause() {
      const b = ov.querySelector('[data-pp]');
      if (st.done) { st.done = false; st.paused = false; if (st.audio && !st.silent) { st.audio.currentTime = 0; st.audio.play().catch(() => {}); } st.start = performance.now(); b.innerHTML = svg(I.pause, 14); st.raf = requestAnimationFrame(loop); return; }
      st.paused = !st.paused;
      if (st.audio && !st.silent) { if (st.paused) st.audio.pause(); else st.audio.play().catch(() => {}); }
      else if (st.paused) st.pausedAt = (performance.now() - st.start) / 1000;
      else st.start = performance.now() - st.pausedAt * 1000;
      b.innerHTML = svg(st.paused ? I.play : I.pause, 14);
      b.setAttribute('aria-label', st.paused ? 'Play' : 'Pause');
    }
  }
  function closeAnimatic() {
    const st = S.anim;
    if (!st) return;
    S.anim = null;
    cancelAnimationFrame(st.raf);
    if (st.audio) { try { st.audio.pause(); } catch (_) { /* gone */ } }
    st.ov.remove();
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.anim) closeAnimatic(); });

  // ── Events ───────────────────────────────────────────────────────────────
  function onClick(e) {
    const t = e.target;
    const q = (sel) => t.closest(sel);
    let b;
    if ((b = q('[data-step]'))) {
      const v = b.dataset.step;
      if (v === 'kit' && S.kit) { S.view = 'kit'; S.panel = S.panel || draftPanel(); remember(); paint(); pollIfWorking(); }
      else if (v === 'story') { if (S.reel && S.reel.kit_id === (S.kit && S.kit.id)) openReel(S.reel.id); else if (S.kit) newReel(); }
      else if (v === 'board') {
        const pid = (S.reel && S.reel.id) || S.boardPid;
        if (pid) { S.view = 'board'; S.boardPid = pid; remember(); stopPoll(); H.openProject(pid); paint(); }
      }
      return;
    }
    if (q('[data-kit-menu]')) { S.menu = !S.menu; paintHeader(); e.stopPropagation(); return; }
    if ((b = q('[data-kit-open]'))) { S.menu = false; openKit(b.dataset.kitOpen); return; }
    if (q('[data-go-start]')) { S.menu = false; S.view = 'start'; S.panel = null; remember(); stopPoll(); refreshKits(); paint(); return; }
    if (q('[data-kit-new]')) { S.menu = false; S.newKit = { title: '', look: (S.kit && S.kit.look) || currentLook() }; S.view = 'start'; paint(); focusLater('[data-kit-name]'); return; }
    if (q('[data-kit-from]')) { S.newKit = { from: true }; render(); return; }
    if (q('[data-kit-cancel]')) { S.newKit = null; render(); return; }
    if ((b = q('[data-kit-newlook]'))) { S.newKit.look = b.dataset.kitNewlook; render(); return; }
    if (q('[data-kit-create]')) { createKit(); return; }
    if (q('[data-kit-from-go]')) { const sel = box.querySelector('[data-kit-from-pick]'); if (sel && sel.value) createKit(sel.value); return; }
    if ((b = q('[data-reel-open]'))) {
      const p = ((H.recent && H.recent()) || []).find((x) => x.id === b.dataset.reelOpen);
      if (p && p.status !== 'story') { S.view = 'board'; S.boardPid = p.id; loadKitQuiet(p.kit_id); H.openProject(p.id); paint(); }
      else openReel(b.dataset.reelOpen);
      return;
    }
    if (q('[data-kit-rename]')) {
      // eslint-disable-next-line no-alert
      const name = window.prompt('Name this kit', S.kit.title);
      if (name && name.trim() && name.trim() !== S.kit.title) {
        api(`/api/animation/kits/${encodeURIComponent(S.kit.id)}`, { method: 'PATCH', body: JSON.stringify({ title: name.trim() }) })
          .then((d) => { S.kit = d.kit; paint(); refreshKits(); })
          .catch((err) => toast(err.message || 'Could not rename', 'error', err.request_id));
      }
      return;
    }
    if (q('[data-next-story]')) { newReel(); return; }
    // Kit panel
    if ((b = q('[data-new]'))) { S.panel = { mode: 'new', type: b.dataset.new, source: b.dataset.new === 'item' && S.catalog && S.catalog.has ? 'product' : 'describe', name: '', description: '', refs: [], count: lookCountPref() }; render(); focusLater('[data-p-name]'); return; }
    if ((b = q('[data-need]'))) {
      const n = (S.kit.suggestions || []).find((x) => x.id === b.dataset.need);
      if (n) { S.view = 'kit'; S.panel = { mode: 'new', type: n.type, source: 'describe', name: n.name, description: n.description, need_id: n.id }; remember(); paint(); }
      return;
    }
    if ((b = q('[data-el]'))) { const el = elById(b.dataset.el); S.panel = { mode: 'el', id: b.dataset.el, name: el ? el.name : null, description: el ? el.description || '' : null }; render(); return; }
    if (q('[data-panel-close]')) {
      const P = S.panel;
      if (P && P.draft_id) {
        const d = (S.kit.drafts || []).find((x) => x.id === P.draft_id);
        if (d && d.status !== 'working') api(`/api/animation/kits/${encodeURIComponent(S.kit.id)}/drafts/${encodeURIComponent(P.draft_id)}`, { method: 'DELETE' }).then((r) => { if (r && r.kit) S.kit = r.kit; }).catch(() => {});
      }
      S.panel = null;
      render();
      return;
    }
    if ((b = q('[data-src]'))) { S.panel.source = b.dataset.src; render(); return; }
    if (q('[data-p-upload]')) { const f = box.querySelector('[data-p-file]'); if (f) f.click(); return; }
    if ((b = q('[data-pick-from]'))) { openPicker(b.dataset.pickFrom); return; }
    if ((b = q('[data-ref-rm]'))) { S.panel.refs.splice(Number(b.dataset.refRm), 1); render(); return; }
    if ((b = q('[data-count]'))) {
      const n = Math.max(1, Math.min(6, (S.panel.count || lookCountPref()) + Number(b.dataset.count)));
      S.panel.count = n;
      ls.set(LS_LOOKS, String(n));
      render();
      return;
    }
    if (q('[data-as-is]')) { useAsIs(); return; }
    if (q('[data-make-looks]')) { makeLooks(); return; }
    if (q('[data-more-looks]')) { makeLooks({ again: true }); return; }
    if ((b = q('[data-zoom]'))) { openViewer(Number(b.dataset.zoom)); return; }
    if ((b = q('[data-pick]'))) {
      const n = Number(b.dataset.pick);
      const cur = S.panel.picks || [];
      S.panel.picks = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n];
      render();
      return;
    }
    if (q('[data-lock]')) { lockLook(); return; }
    if (q('[data-use-photo]')) { lockLook({ usePhoto: true }); return; }
    if (q('[data-e-save]')) { saveElement(); return; }
    if (q('[data-e-del]')) { deleteElement(); return; }
    if (q('[data-sheet-redo]')) {
      api(`/api/animation/kits/${encodeURIComponent(S.kit.id)}/elements/${encodeURIComponent(S.panel.id)}/sheet`, { method: 'POST' })
        .then((d) => { S.kit = d.kit; render(); pollIfWorking(); })
        .catch((err) => toast(err.message || 'Could not start the views', 'error', err.request_id));
      return;
    }
    // Story
    if (q('[data-w-open]')) { S.writer = { idea: (S.story && S.story.idea) || '', busy: false }; render(); focusLater('[data-w-idea]'); return; }
    if (q('[data-w-cancel]')) { S.writer = null; render(); return; }
    if (q('[data-w-go]')) { writeStory(); return; }
    if ((b = q('[data-preview]'))) { e.stopPropagation(); preview(b.dataset.preview); return; }
    if (q('[data-add-scene]')) { addScene({ after: S.sel }); return; }
    if ((b = q('[data-scene]'))) { if (S.sel !== b.dataset.scene) { S.sel = b.dataset.scene; S.addEl = false; render(); } return; }
    if ((b = q('[data-line-row]')) && !q('textarea')) { S.sel = b.dataset.lineRow; render(); return; }
    if (q('[data-add-open]')) { S.addEl = !S.addEl; render(); return; }
    if ((b = q('[data-add-el]'))) {
      const s = selScene();
      if (s && !s.element_ids.includes(b.dataset.addEl) && s.element_ids.length < 6) { s.element_ids.push(b.dataset.addEl); markStale(s); touch(); }
      S.addEl = false;
      render();
      return;
    }
    if (q('[data-go-kit]')) { S.addEl = false; S.view = 'kit'; S.panel = { mode: 'new', type: 'character', source: 'describe', name: '', description: '' }; remember(); paint(); return; }
    if ((b = q('[data-rm-el]'))) { const s = selScene(); if (s) { s.element_ids = s.element_ids.filter((id) => id !== b.dataset.rmEl); markStale(s); touch(); render(); } return; }
    if ((b = q('[data-cam]'))) { const s = selScene(); if (s && s.camera !== b.dataset.cam) { s.camera = b.dataset.cam; touch(); render(); } return; }
    if (q('[data-len-auto]')) { const s = selScene(); if (s) { s.seconds_manual = false; s.seconds = secondsFor(s.line); touch(); render(); } return; }
    if ((b = q('[data-edit-line]'))) { const el = box.querySelector(`[data-line="${CSS.escape(b.dataset.editLine)}"]`); if (el) { el.focus(); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } return; }
    if (q('[data-dup]')) { const s = selScene(); if (s) addScene({ after: s.id, copy: s }); return; }
    if (q('[data-del-scene]')) {
      const s = selScene();
      if (!s) return;
      const i = S.story.scenes.indexOf(s);
      S.story.scenes.splice(i, 1);
      S.sel = (S.story.scenes[i] || S.story.scenes[i - 1] || {}).id || null;
      touch({ client: true });
      render();
      return;
    }
    if (q('[data-animatic]')) { flushSave().then(playAnimatic); return; }
    if (q('[data-make]')) { make(); }
  }

  function markStale(s) { if (s.preview_url) s.preview_stale = true; }

  function onInput(e) {
    const t = e.target;
    if (t.matches('[data-kit-name]')) { S.newKit.title = t.value; return; }
    if (t.matches('[data-p-name]')) { S.panel.name = t.value; return; }
    if (t.matches('[data-p-about]')) { S.panel.description = t.value; return; }
    if (t.matches('[data-e-name], [data-e-about]')) {
      if (t.matches('[data-e-name]')) S.panel.name = t.value; else S.panel.description = t.value;
      S.panel.dirty = true;
      const sv = box.querySelector('[data-e-save]');
      if (sv) sv.disabled = false;
      return;
    }
    if (t.matches('[data-w-idea]')) { S.writer.idea = t.value; S.story.idea = t.value; return; }
    if (t.matches('[data-line]')) {
      const s = S.story.scenes.find((x) => x.id === t.dataset.line);
      if (!s) return;
      s.line = t.value.replace(/\n/g, ' ');
      grow(t);
      if (S.sel !== s.id) {
        S.sel = s.id;
        box.querySelectorAll('.nl-sline.is-sel, .nl-sscene.is-sel').forEach((x) => x.classList.remove('is-sel'));
        t.closest('.nl-sline').classList.add('is-sel');
        const side = box.querySelector('.nl-sstory__side');
        if (side) side.innerHTML = inspector();
        const card = box.querySelector(`[data-scene="${CSS.escape(s.id)}"]`);
        if (card) card.classList.add('is-sel');
      }
      touch({ client: true });
      paintStoryBits();
      return;
    }
    if (t.matches('[data-what]')) {
      const s = S.story.scenes.find((x) => x.id === t.dataset.what);
      if (!s) return;
      s.what = t.value;
      markStale(s);
      touch();
      paintStoryBits();
      return;
    }
    if (t.matches('[data-len]')) {
      const s = selScene();
      if (!s) return;
      s.seconds = Number(t.value);
      s.seconds_manual = true;
      touch();
      paintStoryBits();
    }
  }

  function onChange(e) {
    const t = e.target;
    if (t.matches('[data-p-file]')) { uploadPhoto(t.files); t.value = ''; return; }
    if (t.matches('[data-len]')) { render(); return; }
    if (t.matches('[data-kit-look]') && S.kit) {
      const look = t.value;
      api(`/api/animation/kits/${encodeURIComponent(S.kit.id)}`, { method: 'PATCH', body: JSON.stringify({ look }) })
        .then((d) => { S.kit = d.kit; paintHeader(); toast(`New things in this kit will be ${lookLabel(look).toLowerCase()}. What is already here keeps its look.`, 'info'); })
        .catch((err) => toast(err.message || 'Could not change the look', 'error', err.request_id));
    }
  }

  function onKey(e) {
    const t = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && t.matches('[data-kit-open], [data-scene], [data-preview][role="button"]')) { e.preventDefault(); t.click(); return; }
    if (e.key === 'Enter' && t.matches('[data-line]')) {
      e.preventDefault();
      addScene({ after: t.dataset.line });
      return;
    }
    if (e.key === 'Enter' && t.matches('[data-kit-name]')) { e.preventDefault(); createKit(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && t.matches('[data-w-idea]')) { e.preventDefault(); writeStory(); }
  }

  window.SEStory = {
    attach,
    onLayout,
    setSurface,
    claims,
    openReel,
    isOn: () => S.on,
    _state: S,
  };
})();
