/* Coach work panel.
 *
 * A slim panel beside the Coach chat that shows work being done: the stage it is at, the plan (one line per
 * slide), small pictures of the slides as they appear, then the finished slides and a button to the tab
 * where they live. It only draws what it is told; design-studio-v2.js feeds it from the design job.
 *
 *   const p = seWork.start({ title, sub });
 *   p.phase({ title, steps: [{ id, label, stages: ['plan'] }], ratio })   // a stretch of work with its own steps
 *   p.progress(job.progress)   p.outline([...])   p.slides([{ n, label, src }])
 *   p.endPhase(note)           // closes the phase; the next p.phase() starts below it
 *   p.finish({ urls, tab, note })   p.fail(text)
 *   seWork.attach()            // draw the current panel again on a Coach page that was just drawn
 *   seWork.chip(tab)  seWork.button(label, fn)  seWork.openTab(tab)
 */
(function (global) {
  'use strict';

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeSrc = (u) => (/^(https:\/\/|data:image\/(jpeg|png|webp);base64,)/i.test(String(u || '')) ? String(u) : '');

  // Where the work ends up. `go` opens the tab.
  const TABS = {
    carousels: { label: 'Carousels', go() { if (typeof global.seOpenCarousels === 'function') global.seOpenCarousels('brand'); else { global.__SE_CAROUSEL_VIEW = 'brand'; if (typeof global.switchNav === 'function') global.switchNav('brand-design'); } } },
    posts: { label: 'Posts', go() { if (typeof global.switchNav === 'function') global.switchNav('design-studio'); } },
    reels: { label: 'Reels', go() { if (typeof global.switchNav === 'function') global.switchNav('animation-studio'); } },
    storyboard: { label: 'Storyboard', go() { if (typeof global.switchNav === 'function') global.switchNav('storyboard'); } },
    review: { label: 'Content Review', go() { if (typeof global.switchNav === 'function') global.switchNav('content'); } },
  };
  const tabKey = (k) => (Object.prototype.hasOwnProperty.call(TABS, k) ? k : '');
  function openTab(k) { const t = TABS[tabKey(k)]; if (t) t.go(); return !!t; }

  function css() {
    if (document.getElementById('se-work-css')) return;
    const s = document.createElement('style');
    s.id = 'se-work-css';
    s.textContent = `
.sw{--sw-s:var(--nl-surface,#101216);--sw-s2:var(--nl-s2,#14161b);--sw-s3:var(--nl-s3,#191c22);--sw-line:var(--nl-line,#1e2127);--sw-line2:var(--nl-line-strong,#282c34);
  --sw-fg:var(--nl-fg,#e8e6e1);--sw-fg2:var(--nl-fg2,#a3a09a);--sw-fg3:var(--nl-fg3,#75736c);--sw-fg4:var(--nl-fg4,#514f49);
  --sw-sig:var(--nl-signal,#9d8cff);--sw-sig-ink:var(--nl-signal-ink,#0b0820);--sw-sig-soft:var(--nl-signal-soft,rgba(157,140,255,0.16));
  --sw-ok:var(--nl-ok,#2ee6a6);--sw-bad:var(--nl-bad,#ff5c6c);--sw-pri:var(--nl-primary-bg,#e8e6e1);--sw-pri-ink:var(--nl-primary-fg,#0d0e11);
  --sw-body:var(--nl-body,'Instrument Sans','Inter',system-ui,sans-serif);--sw-display:var(--nl-display,'Figtree','Inter',system-ui,sans-serif);--sw-mono:var(--nl-mono,'JetBrains Mono',ui-monospace,monospace);
  box-sizing:border-box;display:flex;flex-direction:column;min-height:0;background:var(--sw-s);color:var(--sw-fg2);font:400 13px/1.45 var(--sw-body);animation:sw-in .38s cubic-bezier(.2,.7,.2,1) both}
.sw *{box-sizing:border-box}
.sw--dock{flex:0 0 324px;width:324px;border-left:1px solid var(--sw-line)}
.sw--inline{position:sticky;top:0;z-index:3;align-self:stretch;margin:0 0 8px;border:1px solid var(--sw-line2);border-radius:12px;max-height:70%;flex:none}
.sw--float{position:fixed;right:16px;bottom:16px;z-index:60;width:324px;max-height:min(78vh,640px);border:1px solid var(--sw-line2);border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.45)}
@keyframes sw-in{from{opacity:0;transform:translateX(10px)}to{opacity:1;transform:none}}
.sw__head{flex:none;display:flex;align-items:center;gap:10px;padding:14px 14px 10px}
.sw__dot{position:relative;flex:none;width:8px;height:8px;border-radius:50%;background:var(--sw-sig)}
.sw[data-s=running] .sw__dot::after{content:'';position:absolute;inset:-5px;border-radius:50%;border:1px solid var(--sw-sig);opacity:0;animation:sw-ping 1.8s ease-out infinite}
.sw[data-s=done] .sw__dot{background:var(--sw-fg)}.sw[data-s=failed] .sw__dot{background:var(--sw-bad)}
@keyframes sw-ping{0%{opacity:.7;transform:scale(.6)}100%{opacity:0;transform:scale(1.7)}}
.sw__titles{min-width:0;flex:1}
.sw__title{margin:0;font:500 14px/1.25 var(--sw-display);color:var(--sw-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sw__sub{margin:1px 0 0;font:400 12px var(--sw-body);color:var(--sw-fg3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sw__time{flex:none;font:500 11px var(--sw-mono);color:var(--sw-fg3);letter-spacing:.02em}
.sw__min{flex:none;width:26px;height:26px;border:1px solid var(--sw-line2);background:transparent;color:var(--sw-fg3);border-radius:7px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}
.sw__min:hover{color:var(--sw-fg);background:var(--sw-s2)}
.sw__min svg{transition:transform .2s}.sw.is-min .sw__min svg{transform:rotate(180deg)}
.sw__bar{flex:none;height:2px;margin:0 14px;background:var(--sw-line);border-radius:2px;overflow:hidden}
.sw__bar i{display:block;height:100%;width:0;background:var(--sw-fg2);border-radius:2px;transition:width .6s cubic-bezier(.2,.7,.2,1)}
.sw[data-s=running] .sw__bar i{background:var(--sw-sig)}
.sw__body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:12px 14px 14px;display:flex;flex-direction:column;gap:14px}
.sw.is-min .sw__body{display:none}
.sw__past{display:flex;flex-direction:column;gap:6px}
.sw__past div{display:flex;gap:8px;align-items:baseline;font-size:12.5px;color:var(--sw-fg3)}
.sw__past svg{flex:none;align-self:center;color:var(--sw-fg2)}
.sw__steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.sw__step{position:relative;display:flex;align-items:center;gap:10px;min-height:30px;padding-left:0;color:var(--sw-fg4);font-size:13px}
.sw__step::before{content:'';position:absolute;left:6.5px;top:-15px;height:30px;width:1px;background:var(--sw-line2)}
.sw__step:first-child::before{display:none}
.sw__mk{position:relative;flex:none;width:14px;height:14px;border-radius:50%;border:1px solid var(--sw-line2);background:var(--sw-s);display:inline-flex;align-items:center;justify-content:center;z-index:1}
.sw__step[data-st=done]{color:var(--sw-fg2)}.sw__step[data-st=done] .sw__mk{border-color:var(--sw-fg3);color:var(--sw-fg2)}
.sw__step[data-st=active]{color:var(--sw-fg);font-weight:500}.sw__step[data-st=active] .sw__mk{border-color:transparent}
.sw__step[data-st=active] .sw__mk::after{content:'';position:absolute;inset:-1px;border-radius:50%;border:1.5px solid var(--sw-line2);border-top-color:var(--sw-sig);animation:sw-spin .9s linear infinite}
.sw__step[data-st=skipped]{display:none}
@keyframes sw-spin{to{transform:rotate(360deg)}}
.sw__meta{margin-left:auto;font:400 11.5px var(--sw-body);color:var(--sw-fg3);white-space:nowrap}
.sw__say{margin:0;font-size:12.5px;color:var(--sw-fg3);min-height:1.4em}
.sw__grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.sw--inline .sw__grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.sw__tile{position:relative;display:block;aspect-ratio:var(--sw-r,9/16);border-radius:8px;overflow:hidden;background:var(--sw-s2);border:1px solid var(--sw-line);text-decoration:none}
.sw__tile::before{content:'';position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.055) 50%,transparent 70%);background-size:220% 100%;animation:sw-shim 1.7s linear infinite}
.sw__tile.has-img::before{display:none}
.sw[data-s=done] .sw__tile::before,.sw[data-s=failed] .sw__tile::before{display:none}
@keyframes sw-shim{from{background-position:130% 0}to{background-position:-90% 0}}
.sw__tile img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;animation:sw-pop .55s cubic-bezier(.2,.7,.2,1) both}
@keyframes sw-pop{from{opacity:0;filter:blur(8px);transform:scale(1.03)}to{opacity:1;filter:none;transform:none}}
.sw__plan{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:8px;text-align:center;font:400 10.5px/1.3 var(--sw-body);color:var(--sw-fg4);overflow:hidden}
.sw__tile.has-img .sw__plan{display:none}
.sw__n{position:absolute;left:5px;bottom:5px;min-width:16px;height:16px;padding:0 4px;border-radius:5px;background:rgba(10,11,14,.72);color:#e8e6e1;font:500 10px/16px var(--sw-mono);text-align:center}
.sw__foot{flex:none;display:flex;flex-direction:column;gap:8px;padding:12px 14px 14px;border-top:1px solid var(--sw-line)}
.sw.is-min .sw__foot{display:none}
.sw__foot:empty{display:none}
.sw__note{margin:0;font-size:12.5px;color:var(--sw-fg3)}
.sw__err{margin:0;font-size:12.5px;color:var(--sw-fg2)}
.sw-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:36px;padding:0 14px;border-radius:8px;border:1px solid transparent;background:var(--sw-pri,#e8e6e1);color:var(--sw-pri-ink,#0d0e11);font:600 13px var(--sw-body,'Instrument Sans',system-ui,sans-serif);cursor:pointer;white-space:nowrap}
.sw-btn:hover{filter:brightness(1.07)}
.sw-btn--ghost{background:transparent;color:var(--sw-fg2,#a3a09a);border-color:var(--sw-line2,#282c34);font-weight:500}
.sw-btn--ghost:hover{color:var(--sw-fg,#e8e6e1);background:var(--sw-s2,#14161b);filter:none}
.sw-btn--chip{height:30px;padding:0 11px;font-size:12.5px;margin-top:10px}
.sw-btn,.sw-link{--sw-s2:var(--nl-s2,#14161b);--sw-line2:var(--nl-line-strong,#282c34);--sw-fg:var(--nl-fg,#e8e6e1);--sw-fg2:var(--nl-fg2,#a3a09a);--sw-pri:var(--nl-primary-bg,#e8e6e1);--sw-pri-ink:var(--nl-primary-fg,#0d0e11)}
.sw-link{color:var(--nl-signal,#9d8cff);text-decoration:underline;text-decoration-color:rgba(157,140,255,.4);text-underline-offset:2px;cursor:pointer;font:inherit;background:none;border:0;padding:0}
.sw-link:hover{text-decoration-color:currentColor}
@media (max-width:900px){
  .sw--dock{order:-1;flex:0 0 auto;width:auto;max-height:46vh;border-left:0;border-bottom:1px solid var(--sw-line)}
  .sw--float{left:12px;right:12px;width:auto}
}
@media (prefers-reduced-motion:reduce){.sw,.sw *,.sw *::before,.sw *::after{animation:none!important;transition:none!important}}
`;
    document.head.appendChild(s);
  }

  const CHECK = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const CHEV = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>';
  const X = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
  const ARROW = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

  function dur(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /** The one panel that is current. A new piece of work replaces it. */
  let cur = null;
  let seq = 0;

  function hostFor() {
    const ws = document.querySelector('.chat-workspace');
    if (ws && document.getElementById('chat-messages')) return { kind: 'dock', el: ws };
    const log = document.getElementById('cs-coach-log');
    if (log) return { kind: 'inline', el: log };
    return { kind: 'float', el: document.body };
  }

  function detailOf(step, p) {
    if (!p) return '';
    if (p.stage === 'queued') {
      const n = Number(p.ahead);
      return Number.isFinite(n) && n > 0 ? `${n} ahead` : 'next in line';
    }
    const bits = [];
    if (p.stage === 'art' && p.count) bits.push(`${p.count} image${p.count === 1 ? '' : 's'}`);
    if (p.stage === 'fix' && Array.isArray(p.slides) && p.slides.length) bits.push(`slide ${p.slides.join(', ')}`);
    if (p.round && step && (step.rounds || /render|critic|fix|review/.test(p.stage))) bits.push(`round ${p.round}`);
    return bits.join(' · ');
  }

  function start(opts = {}) {
    css();
    if (cur && cur.stop) cur.stop();
    const st = {
      id: ++seq, status: 'running', t0: Date.now(), tEnd: 0,
      title: String(opts.title || 'Working on it').slice(0, 80), sub: String(opts.sub || '').slice(0, 100),
      past: [], phase: null, outline: [], slides: [], total: 0, ratio: '9/16',
      urls: [], tab: '', note: '', error: '', say: '', min: false, progress: 0,
      el: null, kind: '', timer: null,
    };
    st.min = global.innerWidth < 900;
    st.stop = () => { if (st.timer) { clearInterval(st.timer); st.timer = null; } };
    cur = st;

    // ── drawing ──
    function ensure() {
      if (st.el && document.body.contains(st.el)) return true;
      const h = hostFor();
      const el = document.createElement('aside');
      el.className = `sw sw--${h.kind}`;
      el.setAttribute('aria-label', 'Work in progress');
      el.innerHTML = `<div class="sw__head"><span class="sw__dot"></span><div class="sw__titles"><p class="sw__title"></p><p class="sw__sub"></p></div><span class="sw__time"></span><button type="button" class="sw__min" aria-label="Show or hide details">${CHEV}</button><button type="button" class="sw__min sw__x" aria-label="Close" hidden>${X}</button></div><div class="sw__bar"><i></i></div><div class="sw__body"><div class="sw__past"></div><ul class="sw__steps"></ul><p class="sw__say" role="status" aria-live="polite"></p><div class="sw__grid"></div></div><div class="sw__foot"></div>`;
      el.querySelector('.sw__min').addEventListener('click', () => { st.min = !st.min; el.classList.toggle('is-min', st.min); });
      el.querySelector('.sw__x').addEventListener('click', () => { st.stop(); el.remove(); if (cur === st) cur = null; });
      if (h.kind === 'dock') h.el.appendChild(el);
      else if (h.kind === 'inline') h.el.insertBefore(el, h.el.firstChild);
      else h.el.appendChild(el);
      st.el = el;
      st.kind = h.kind;
      paintAll();
      return true;
    }
    const q = (sel) => st.el && st.el.querySelector(sel);

    function paintHead() {
      if (!st.el) return;
      st.el.dataset.s = st.status;
      st.el.classList.toggle('is-min', st.min);
      q('.sw__title').textContent = st.title;
      q('.sw__sub').textContent = st.sub;
      q('.sw__time').textContent = dur((st.tEnd || Date.now()) - st.t0);
      q('.sw__x').hidden = st.status === 'running';
      q('.sw__bar i').style.width = `${Math.round((st.status === 'done' ? 1 : st.progress) * 100)}%`;
    }
    function paintSteps() {
      if (!st.el) return;
      q('.sw__past').innerHTML = st.past.map((p) => `<div>${CHECK}<span>${esc(p)}</span></div>`).join('');
      const ph = st.phase;
      q('.sw__steps').innerHTML = ph ? ph.steps.map((s, i) => {
        const over = ph.closed || st.status === 'done';
        let state = 'todo';
        if (over) state = ph.seen.has(i) || i > ph.max ? 'done' : 'skipped';
        else if (st.status === 'running') state = i === ph.active ? 'active' : ph.seen.has(i) ? 'done' : i < ph.max ? 'skipped' : 'todo';
        else state = ph.seen.has(i) && i !== ph.active ? 'done' : 'todo';
        const meta = state === 'active' ? detailOf(s, ph.last) : '';
        return `<li class="sw__step" data-st="${state}"><span class="sw__mk">${state === 'done' ? CHECK : ''}</span><span>${esc(s.label)}</span>${meta ? `<span class="sw__meta">${esc(meta)}</span>` : ''}</li>`;
      }).join('') : '';
      q('.sw__say').textContent = st.say;
    }
    function paintGrid() {
      if (!st.el) return;
      const grid = q('.sw__grid');
      const n = Math.max(st.total, st.outline.length, st.slides.filter(Boolean).length, st.urls.length);
      grid.style.display = n ? '' : 'none';
      grid.style.setProperty('--sw-r', st.ratio);
      for (let i = 0; i < n; i += 1) {
        let tile = grid.children[i];
        const final = st.urls[i] && safeSrc(st.urls[i]);
        if (!tile) {
          tile = document.createElement(final ? 'a' : 'div');
          tile.className = 'sw__tile';
          tile.innerHTML = '<span class="sw__plan"></span><span class="sw__n"></span>';
          grid.appendChild(tile);
        }
        if (final && tile.tagName !== 'A') {
          const a = document.createElement('a');
          a.className = tile.className;
          while (tile.firstChild) a.appendChild(tile.firstChild);
          tile.replaceWith(a);
          tile = a;
        }
        if (final) { tile.href = final; tile.target = '_blank'; tile.rel = 'noopener'; }
        tile.querySelector('.sw__plan').textContent = st.outline[i] || '';
        const s = st.slides[i];
        tile.querySelector('.sw__n').textContent = String(i + 1);
        const want = final || (s && s.src) || '';
        let img = tile.querySelector('img');
        if (want && (!img || img.dataset.src !== want)) {
          if (final && img && img.dataset.src !== want) {
            // The finished picture replaces the small one only once it has loaded, so the tile never goes blank.
            const pre = new Image();
            pre.onload = () => { const im = tile.querySelector('img') || tile.insertBefore(document.createElement('img'), tile.firstChild); im.src = want; im.dataset.src = want; im.alt = `Slide ${i + 1}`; im.style.animation = 'none'; };
            pre.src = want;
          } else {
            if (!img) { img = document.createElement('img'); img.alt = `Slide ${i + 1}`; tile.insertBefore(img, tile.firstChild); }
            img.src = want; img.dataset.src = want;
            tile.classList.add('has-img');
          }
        }
      }
      while (grid.children.length > n) grid.lastChild.remove();
    }
    function paintFoot() {
      if (!st.el) return;
      const foot = q('.sw__foot');
      if (st.status === 'done') {
        const t = TABS[tabKey(st.tab)];
        foot.innerHTML = `${st.note ? `<p class="sw__note">${esc(st.note)}</p>` : ''}${t ? `<button type="button" class="sw-btn" data-go>Open in ${esc(t.label)} ${ARROW}</button>` : ''}`;
        const b = foot.querySelector('[data-go]');
        if (b) b.addEventListener('click', () => openTab(st.tab));
      } else if (st.status === 'failed') {
        foot.innerHTML = `<p class="sw__err">${esc(st.error || 'This did not finish.')}</p>`;
      } else foot.innerHTML = '';
    }
    function paintAll() { paintHead(); paintSteps(); paintGrid(); paintFoot(); }
    function repaint(parts) {
      if (!ensure()) return;
      if (parts.head) paintHead();
      if (parts.steps) paintSteps();
      if (parts.grid) paintGrid();
      if (parts.foot) paintFoot();
    }

    st.timer = setInterval(() => {
      if (cur !== st || st.status !== 'running') { st.stop(); return; }
      if (st.el && document.body.contains(st.el)) { const t = q('.sw__time'); if (t) t.textContent = dur(Date.now() - st.t0); }
    }, 1000);

    // ── what the work reports ──
    const handle = {
      el: () => st.el,
      alive: () => cur === st,
      say(text) { if (cur !== st) return; st.say = String(text || '').slice(0, 160); repaint({ steps: true }); },
      title(title, sub) { if (cur !== st) return; if (title != null) st.title = String(title).slice(0, 80); if (sub != null) st.sub = String(sub).slice(0, 100); repaint({ head: true }); },
      /** A stretch of work with its own steps: [{ id, label, stages: ['plan'] }]. */
      phase(o = {}) {
        if (cur !== st) return;
        st.outline = []; st.slides = []; st.total = 0; st.urls = []; st.say = '';
        if (o.ratio) st.ratio = String(o.ratio).replace(':', '/');
        st.phase = { steps: (o.steps || []).map((s) => ({ id: s.id, label: s.label, stages: s.stages || [s.id], rounds: !!s.rounds })), active: -1, max: -1, seen: new Set(), last: null, closed: false, base: Number(o.from) || 0, span: Number(o.span) || 1 };
        if (o.title) st.title = String(o.title).slice(0, 80);
        if (o.sub != null) st.sub = String(o.sub).slice(0, 100);
        st.progress = st.phase.base;
        if (st.el) st.el.querySelectorAll('.sw__grid > *').forEach((n) => n.remove());
        repaint({ head: true, steps: true, grid: true, foot: true });
      },
      progress(p) {
        if (cur !== st || !st.phase || !p) return;
        const ph = st.phase;
        const i = ph.steps.findIndex((s) => s.stages.includes(p.stage));
        if (p.stage === 'queued') { ph.active = -1; }
        else if (i >= 0) { ph.active = i; ph.max = Math.max(ph.max, i); ph.seen.add(i); }
        ph.last = p;
        st.say = p.stage === 'queued' ? (Number(p.ahead) > 0 ? `In line for a free designer. ${p.ahead} ahead of you.` : 'Next in line for a free designer.') : '';
        if (Number(p.total) > st.total) st.total = Number(p.total);
        const stepFrac = i >= 0 ? (i + 0.5) / ph.steps.length : 0;
        st.progress = Math.max(st.progress, ph.base + ph.span * stepFrac);
        repaint({ head: true, steps: true, grid: true });
      },
      outline(lines) {
        if (cur !== st || !Array.isArray(lines)) return;
        st.outline = lines.map(String);
        st.total = Math.max(st.total, st.outline.length);
        repaint({ grid: true });
      },
      slides(list) {
        if (cur !== st || !Array.isArray(list)) return;
        list.forEach((s) => { const i = Number(s && s.n) - 1; if (i >= 0 && i < 24 && safeSrc(s.src)) st.slides[i] = { src: s.src, label: s.label || '' }; });
        st.total = Math.max(st.total, st.slides.length);
        repaint({ grid: true });
      },
      /** The phase is over: its steps tick off and the next phase starts below a line saying what it made. */
      endPhase(note) {
        if (cur !== st || !st.phase) return;
        st.phase.closed = true;
        if (note) st.past.push(String(note).slice(0, 120));
        repaint({ steps: true });
      },
      finish(o = {}) {
        if (cur !== st) return;
        st.status = 'done'; st.tEnd = Date.now(); st.stop();
        if (st.phase) st.phase.closed = true;
        st.urls = (o.urls || []).filter((u) => safeSrc(u));
        st.tab = tabKey(o.tab);
        st.note = String(o.note || '').slice(0, 160);
        st.say = '';
        if (o.title) st.title = String(o.title).slice(0, 80);
        st.progress = 1;
        repaint({ head: true, steps: true, grid: true, foot: true });
      },
      fail(text) {
        if (cur !== st) return;
        st.status = 'failed'; st.tEnd = Date.now(); st.stop();
        st.error = String(text || '').slice(0, 220);
        st.say = '';
        repaint({ head: true, steps: true, foot: true });
      },
    };
    st.handle = handle;
    ensure();
    return handle;
  }

  /** Draws the current panel again on a Coach page that was just drawn (it was on another tab). */
  function attach() {
    if (!cur || !cur.handle) return false;
    if (cur.el && document.body.contains(cur.el)) return true;
    cur.el = null;
    cur.handle.say(cur.say);
    return true;
  }

  function button(label, fn) {
    css();
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw-btn sw-btn--chip';
    b.innerHTML = `${esc(label)} ${ARROW}`;
    b.addEventListener('click', fn);
    return b;
  }
  /** A button to a tab, for the chat. */
  function chip(tab) {
    const t = TABS[tabKey(tab)];
    if (!t) return null;
    const b = button(`Open ${t.label}`, () => openTab(tab));
    b.dataset.swTab = tab;
    return b;
  }

  // Tab names written in the Coach's replies are links (set up by coach-create-session.js's formatter).
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('[data-sw-tab]') : null;
    if (!a || a.tagName === 'BUTTON') return;
    e.preventDefault();
    openTab(a.getAttribute('data-sw-tab'));
  });

  css(); // the tab links in the Coach's replies are styled from the start

  global.seWork = { start, attach, button, chip, openTab, tabs: Object.keys(TABS), current: () => cur };
})(window);
