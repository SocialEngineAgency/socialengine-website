/* Coach agent: a live card for one project.
 *
 * The Coach hands a project to the agent (coach action `agent_run`). This card follows that run:
 * the plan, each step as it happens, a question when the agent needs a decision, and the finished
 * work with a way to open the approval queue. It only reads: GET /api/agent/runs/:id.
 *
 *   seAgentRun.mount(hostEl, runId, { reply(text), scroll(), onDone(run) })  -> { stop() }
 *   seAgentRun.resume(hostEl, opts)    pick up the latest project if it is still running
 */
(function (global) {
  'use strict';

  function api() { return (typeof global.API !== 'undefined' && global.API) || global._seAPI || ''; }
  function headers() {
    const h = global.seApi && typeof global.seApi.headers === 'function' ? global.seApi.headers() : {};
    return Object.assign({ 'Content-Type': 'application/json' }, h);
  }
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const httpsOnly = (u) => (/^https:\/\//i.test(String(u || '')) ? String(u) : '');

  function css() {
    if (document.getElementById('se-agent-run-css')) return;
    const s = document.createElement('style');
    s.id = 'se-agent-run-css';
    s.textContent = `
.se-agent{margin-top:10px;border:1px solid rgba(167,139,250,0.28);background:rgba(124,58,237,0.07);border-radius:12px;padding:12px 13px;font-size:0.8rem;line-height:1.5;color:rgba(255,255,255,0.88);max-width:560px}
.se-agent__head{display:flex;align-items:center;gap:9px;font-weight:700}
.se-agent__dot{width:9px;height:9px;border-radius:50%;background:#A78BFA;flex:none}
.se-agent[data-status=done] .se-agent__dot{background:#34D399}.se-agent[data-status=failed] .se-agent__dot{background:#F87171}.se-agent[data-status=needs_you] .se-agent__dot{background:#FBBF24}
.se-agent__spin{width:13px;height:13px;border:2px solid rgba(255,255,255,0.18);border-top-color:#C4B5FD;border-radius:50%;animation:se-agent-spin .8s linear infinite;flex:none}
@keyframes se-agent-spin{to{transform:rotate(360deg)}}
.se-agent__time{margin-left:auto;font-weight:500;font-size:0.7rem;color:rgba(255,255,255,0.45)}
.se-agent__steps{list-style:none;margin:9px 0 0;padding:0;display:flex;flex-direction:column;gap:4px}
.se-agent__steps li{display:flex;gap:8px;align-items:flex-start;font-size:0.76rem;color:rgba(255,255,255,0.75)}
.se-agent__steps li[data-s=say]{color:rgba(255,255,255,0.55);font-style:italic}
.se-agent__ic{width:14px;flex:none;text-align:center;color:#A78BFA}
.se-agent__steps li[data-s=ok] .se-agent__ic{color:#34D399}.se-agent__steps li[data-s=error] .se-agent__ic{color:#F87171}.se-agent__steps li[data-s=refused] .se-agent__ic{color:#FBBF24}
.se-agent__ms{margin-left:auto;color:rgba(255,255,255,0.35);font-size:0.68rem;white-space:nowrap;padding-left:6px}
.se-agent details{margin-top:8px}
.se-agent summary{cursor:pointer;font-size:0.72rem;color:rgba(255,255,255,0.55);font-weight:600}
.se-agent__plan{margin:6px 0 0;padding-left:16px;font-size:0.74rem;color:rgba(255,255,255,0.7)}
.se-agent__plan li{margin:2px 0}
.se-agent__sum{margin-top:10px;font-size:0.82rem;color:rgba(255,255,255,0.92)}
.se-agent__q{margin-top:10px;padding:9px 11px;border-radius:9px;background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3)}
.se-agent__opts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.se-agent__btn{background:#7C3AED;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:0.74rem;font-weight:700;cursor:pointer;font-family:inherit}
.se-agent__btn--ghost{background:transparent;border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.85);font-weight:600}
.se-agent__work{display:flex;flex-direction:column;gap:10px;margin-top:10px}
.se-agent__item{border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:9px;background:rgba(0,0,0,0.18)}
.se-agent__strip{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px}
.se-agent__strip img{height:120px;width:auto;border-radius:6px;flex:none;background:rgba(255,255,255,0.05)}
.se-agent__item video{max-width:100%;max-height:260px;border-radius:8px;display:block}
.se-agent__badge{display:inline-block;font-size:0.66rem;font-weight:700;padding:2px 8px;border-radius:99px;background:rgba(52,211,153,0.15);color:#6EE7B7;margin-top:7px}
.se-agent__warn{margin-top:6px;font-size:0.72rem;color:#FCD34D}
.se-agent__cap{margin-top:6px;font-size:0.72rem;color:rgba(255,255,255,0.6);white-space:pre-wrap}
.se-agent__note{margin-top:8px;font-size:0.72rem;color:rgba(255,255,255,0.5)}
`;
    document.head.appendChild(s);
  }

  const TITLES = {
    queued: 'Getting started',
    running: 'Working on your project',
    done: 'Finished',
    needs_you: 'Needs a decision from you',
    failed: 'Stopped',
  };
  const ICON = { running: '◌', ok: '✓', error: '✕', refused: '!', say: '•' };

  function dur(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  }

  function stepsHtml(run, finished) {
    const items = (run.steps || []).filter((s) => (s.t === 'step' && s.label) || (s.t === 'say' && s.text));
    if (!items.length) return run.status === 'queued' ? '' : '<ul class="se-agent__steps"><li data-s="running"><span class="se-agent__ic">◌</span>Reading the brand and planning</li></ul>';
    const shown = finished ? items : items.slice(-7);
    const li = shown.map((s) => (s.t === 'say'
      ? `<li data-s="say"><span class="se-agent__ic">${ICON.say}</span><span>${esc(s.text)}</span></li>`
      : `<li data-s="${esc(s.status)}"><span class="se-agent__ic">${ICON[s.status] || ICON.ok}</span><span>${esc(s.label)}${s.status === 'error' || s.status === 'refused' ? ` <em style="color:rgba(255,255,255,0.45)">${esc(s.summary)}</em>` : ''}</span>${s.ms ? `<span class="se-agent__ms">${dur(s.ms)}</span>` : ''}</li>`)).join('');
    const list = `<ul class="se-agent__steps">${li}</ul>`;
    if (!finished) return list;
    return `<details><summary>${items.filter((s) => s.t === 'step').length} steps taken</summary>${list}</details>`;
  }

  function planHtml(plan) {
    if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) return '';
    const steps = plan.steps.map((s) => `<li><strong>${esc(s.tool)}</strong>: ${esc(s.why)}${s.reuse && s.reuse !== 'none' ? ` <em style="color:rgba(255,255,255,0.45)">(reusing ${esc(s.reuse)})</em>` : ''}</li>`).join('');
    const rej = (plan.rejected_cheaper || []).length
      ? `<div class="se-agent__note">Cheaper options I ruled out: ${plan.rejected_cheaper.map(esc).join('; ')}</div>` : '';
    return `<details><summary>The plan</summary><div class="se-agent__note" style="margin-top:6px">${esc(plan.goal)}</div><ol class="se-agent__plan">${steps}</ol>${rej}</details>`;
  }

  function workHtml(run) {
    const r = run.result || {};
    const items = (r.deliverables && r.deliverables.length ? r.deliverables : (r.assets || []).filter((a) => a.queued)).slice(0, 6);
    if (!items.length) return '';
    return `<div class="se-agent__work">${items.map((d) => {
      const urls = (d.urls || []).map(httpsOnly).filter(Boolean);
      const video = httpsOnly(d.video_url);
      const media = video
        ? `<video src="${esc(video)}" controls preload="metadata" playsinline></video>`
        : urls.length ? `<div class="se-agent__strip">${urls.slice(0, 8).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Slide ${i + 1}" referrerpolicy="no-referrer" loading="lazy"></a>`).join('')}</div>` : '';
      const audit = d.audit ? ` <span style="color:rgba(255,255,255,0.45);font-size:0.7rem">checked ${d.audit.overall}/10${d.audit.pass ? '' : ', not perfect'}</span>` : '';
      return `<div class="se-agent__item"><div style="font-weight:700">${esc(d.title || d.kind || 'Your content')}${audit}</div>${media}`
        + (d.caption ? `<details><summary>Caption</summary><div class="se-agent__cap">${esc(d.caption)}${(d.hashtags || []).length ? `\n\n${esc(d.hashtags.join(' '))}` : ''}</div></details>` : '')
        + (d.caveat || d.note ? `<div class="se-agent__warn">${esc(d.caveat || d.note)}</div>` : '')
        + (d.record_id || d.queued ? '<span class="se-agent__badge">In your approval queue. Not posted.</span>' : (d.kind === 'style' ? '<span class="se-agent__badge">Style saved</span>' : ''))
        + '</div>';
    }).join('')}</div>`;
  }

  function mount(host, runId, opts = {}) {
    css();
    const card = document.createElement('div');
    card.className = 'se-agent';
    card.dataset.agentRun = runId;
    card.dataset.status = 'queued';
    card.innerHTML = '<div class="se-agent__head"><span class="se-agent__spin"></span><span>Getting started</span></div>';
    host.insertBefore(card, opts.before && opts.before.parentNode === host ? opts.before : null);
    if (opts.scroll) opts.scroll();

    let stopped = false;
    let timer = null;
    let misses = 0;
    const t0 = Date.now();

    function paint(run) {
      const status = run.status;
      const live = status === 'queued' || status === 'running';
      card.dataset.status = status;
      const r = run.result || {};
      const q = r.question && r.question.question ? r.question : null;
      const elapsed = run.stats && run.stats.ms ? run.stats.ms : (Date.now() - t0);
      let html = `<div class="se-agent__head">${live ? '<span class="se-agent__spin"></span>' : '<span class="se-agent__dot"></span>'}<span>${esc(TITLES[status] || 'Project')}</span><span class="se-agent__time">${dur(elapsed)}</span></div>`;
      html += stepsHtml(run, !live);
      html += planHtml(run.plan);
      if (!live) {
        if (status === 'failed') html += `<div class="se-agent__sum">${esc(run.error || 'Something went wrong and nothing was posted.')} You can ask the Coach to try again.</div>`;
        else html += `<div class="se-agent__sum">${esc(r.summary || '')}</div>`;
        if (q) {
          html += `<div class="se-agent__q"><div style="font-weight:700">${esc(q.question)}</div>${(q.options || []).length ? `<div class="se-agent__opts">${q.options.map((o, i) => `<button type="button" class="se-agent__btn se-agent__btn--ghost" data-opt="${i}">${esc(o)}</button>`).join('')}</div>` : ''}<div class="se-agent__note">Reply in the chat and the Coach will carry on.</div></div>`;
        }
        html += workHtml(run);
        if (r.note) html += `<div class="se-agent__note">${esc(r.note)}</div>`;
        const queued = (r.queued || []).length;
        if (queued) html += '<div class="se-agent__opts"><button type="button" class="se-agent__btn" data-open-review>Open Content Review</button></div>';
      }
      card.innerHTML = html;
      const review = card.querySelector('[data-open-review]');
      if (review) review.addEventListener('click', () => { const n = document.querySelector('[data-nav="content"]'); if (n) n.click(); });
      card.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => {
        const text = (q.options || [])[Number(b.dataset.opt)];
        if (text && typeof opts.reply === 'function') opts.reply(text);
      }));
      if (opts.scroll) opts.scroll();
    }

    async function tick() {
      if (stopped) return;
      if (!document.body.contains(card)) { stopped = true; return; }
      let run = null;
      try {
        const res = await fetch(`${api()}/api/agent/runs/${encodeURIComponent(runId)}`, { headers: headers() });
        if (res.status === 404) { card.dataset.status = 'failed'; card.innerHTML = '<div class="se-agent__head"><span class="se-agent__dot"></span><span>This project is gone</span></div><div class="se-agent__sum">The server may have restarted. Ask the Coach again.</div>'; stopped = true; return; }
        const data = await res.json().catch(() => ({}));
        run = data && data.run;
        misses = 0;
      } catch (_) {
        misses += 1;
      }
      if (run) {
        paint(run);
        if (run.status !== 'queued' && run.status !== 'running') { stopped = true; if (typeof opts.onDone === 'function') opts.onDone(run); return; }
      } else if (misses >= 6) {
        card.innerHTML = '<div class="se-agent__head"><span class="se-agent__dot" style="background:#FBBF24"></span><span>Lost touch with the project</span></div><div class="se-agent__sum">Reload the page to see where it got to.</div>';
        stopped = true;
        return;
      }
      timer = setTimeout(tick, Date.now() - t0 > 120000 ? 4000 : 2200);
    }
    setTimeout(tick, 0); // the caller may still be putting the card's parent on the page
    return { stop() { stopped = true; if (timer) clearTimeout(timer); }, el: card };
  }

  /** Picks up the latest project (after a reload) when it is still going. */
  async function resume(host, opts = {}) {
    try {
      const res = await fetch(`${api()}/api/agent/runs`, { headers: headers() });
      const data = await res.json().catch(() => ({}));
      const latest = data && data.runs && data.runs[0];
      if (!latest || (latest.status !== 'queued' && latest.status !== 'running')) return null;
      if (document.querySelector(`[data-agent-run="${latest.id}"]`)) return null;
      const el = typeof host === 'function' ? host() : host;
      return el ? mount(el, latest.id, opts) : null;
    } catch (_) {
      return null;
    }
  }

  global.seAgentRun = { mount, resume };
})(window);
