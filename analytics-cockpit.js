/* Analytics operator cockpit — layout B. Loaded by portal.html. */
(function (global) {
  let _book = 'organic';
  let _period = '30d';
  let _chartsOpen = false;
  let _card = null;
  let _deps = {};
  let _clientData = null;
  let _insights = null;
  let _insightsGoal = '';
  let _briefBusy = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    }[c]));
  }

  function fmtNum(n) {
    if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
    return Number(n).toLocaleString();
  }

  function fmtDelta(pct, unit) {
    if (pct == null) return '<span style="color:rgba(255,255,255,.35)">— vs prior</span>';
    const up = pct >= 0;
    const color = pct === 0 ? 'rgba(255,255,255,.35)' : up ? '#4ADE80' : '#F87171';
    const arrow = pct === 0 ? '→' : up ? '↗' : '↘';
    const val = unit === 'pp' ? `${up ? '+' : ''}${pct}pp` : `${up ? '+' : ''}${pct}%`;
    return `<span style="color:${color}">${arrow} ${val}</span>`;
  }

  // Session headers come from the portal (deps.seApi / window.seApi); this
  // script never sees a credential.
  function authHeaders() {
    const api = _deps.seApi || global.seApi;
    return (api && typeof api.headers === 'function') ? api.headers() : {};
  }

  function apiBase() {
    return _deps.api || global.API || global._seAPI || '';
  }

  function sourceDot(status) {
    if (status === 'connected') return '<span style="color:#4ADE80">●</span>';
    if (status === 'thin') return '<span style="color:#FBBF24">●</span>';
    return '<span style="color:rgba(255,255,255,.3)">○</span>';
  }

  function sourceLabel(id) {
    const map = {
      instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok',
      youtube: 'YouTube', justgiving: 'JustGiving', shopify: 'Shopify', ads: 'Ads',
    };
    return map[id] || id;
  }

  function bookLabel(book, clientType) {
    if (book === 'insights') return 'Meta Insights';
    if (book === 'commerce') return 'Commerce';
    if (book === 'fundraising') return clientType === 'commerce' ? 'Commerce' : 'Fundraising';
    if (book === 'paid') return 'Paid';
    return 'Organic';
  }

  function emptyCopy(book) {
    if (book === 'paid') {
      return {
        title: 'No paid activity in this period',
        body: 'Ads and boosts will land here. Organic rankings stay in the Organic book.',
        cta: 'Open Ads',
        nav: 'ad-studio',
      };
    }
    if (book === 'fundraising' || book === 'commerce') {
      return {
        title: book === 'commerce' ? 'Commerce not linked' : 'JustGiving not linked',
        body: 'This book is empty on purpose until the source is connected. Organic still works.',
        cta: book === 'commerce' ? 'Open settings' : 'Open Fundraise',
        nav: book === 'commerce' ? 'settings' : 'fundraise',
      };
    }
    return {
      title: 'Connect Instagram to see organic performance',
      body: 'Organic rankings need a live Instagram connection. Nothing is invented while it is off.',
      cta: 'Connect Instagram',
      nav: null,
    };
  }

  function lineChartHtml(labels, fb, ig, emptyCopy) {
    if (typeof _deps.lineChart === 'function' && labels && (ig || fb)) {
      return _deps.lineChart(labels, fb || [], ig || []);
    }
    return `<p style="color:rgba(255,255,255,.4);font-size:0.82rem;padding:24px 0;text-align:center">${esc(emptyCopy || 'No chart series for this period.')}</p>`;
  }

  function intentSplitHtml(rows) {
    return formatSplitHtml((rows || []).map((r) => ({ format: r.intent || 'unknown' })));
  }

  function startRemix(item) {
    const remix = item && item.remix;
    if (!remix || !remix.still_url) {
      if (typeof _deps.toast === 'function') _deps.toast('Need a still from this post to remix', 'warning');
      return;
    }
    if (typeof _deps.openAnimRemix === 'function') _deps.openAnimRemix(remix);
    else if (typeof global.openAnimationFromRemix === 'function') global.openAnimationFromRemix(remix);
  }

  function openPermalink(url) {
    if (url) {
      global.open(url, '_blank', 'noopener');
      return;
    }
    if (typeof _deps.toast === 'function') _deps.toast('No live post link for this item', 'warning');
  }

  function formatSplitHtml(rows) {
    const counts = {};
    (rows || []).forEach((r) => {
      const k = r.format || 'other';
      counts[k] = (counts[k] || 0) + 1;
    });
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    const colors = { reel: '#A855F7', photo: '#3B9EFF', carousel: '#64748B', video: '#A855F7', views: '#A855F7', engagement: '#3B9EFF', followers: '#4ADE80', donations: '#FBBF24' };
    return Object.entries(counts).map(([k, n]) => {
      const pct = Math.round((n / total) * 100);
      return `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:11px;color:rgba(255,255,255,.45);margin-bottom:4px"><span>${esc(k)}</span><span>${pct}%</span></div><div style="height:6px;background:rgba(255,255,255,.06);border-radius:99px"><div style="height:6px;width:${pct}%;background:${colors[k] || '#64748B'};border-radius:99px"></div></div></div>`;
    }).join('') || '<p style="color:rgba(255,255,255,.35);font-size:12px">No format split yet.</p>';
  }

  // ── New look (html.nl): the Analytics redesign layout. Same data, ids and handlers. ──
  function isNL() { return !!(global.document && global.document.documentElement.classList.contains('nl')); }
  const NL_REFRESH = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7"/></svg>';
  function nlPeriodWords() { return _period === '7d' ? 'Last 7 days' : _period === '90d' ? 'Last 90 days' : 'Last 30 days'; }
  function nlSubline(card) {
    const live = ((card && card.sources) || []).filter((x) => x.status === 'connected' || x.status === 'thin').map((x) => sourceLabel(x.id));
    const where = live.length ? live.join(', ') : 'no sources connected yet';
    return `${nlPeriodWords()}, ${where}.`;
  }
  // ── New look: the daily chart (reach or interactions per day, by platform) ──
  // Reads charts.{labels,keys,reach,interactions,posts,totals}. Everything it shows is derived
  // from those series: totals and the change on the previous period, daily average, best day,
  // what posting days earned against quiet days, platform share, and what went out each day.
  let _nlMetric = 'reach';
  const NL_PLAT = { instagram: 'Instagram', facebook: 'Facebook' };
  function nlCompact(n) {
    const v = Number(n) || 0;
    const a = Math.abs(v);
    if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
    if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K`;
    return String(Math.round(v));
  }
  function nlDay(key, label, opts) {
    if (key) {
      const d = new Date(`${key}T12:00:00Z`);
      if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('en-US', Object.assign({ month: 'short', day: 'numeric', timeZone: 'UTC' }, opts || {}));
    }
    return String(label || '');
  }
  function nlNiceStep(raw) {
    if (!(raw > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function nlDailyData(card, metric) {
    const ch = (card && card.charts) || {};
    const src = metric === 'interactions'
      ? { instagram: ch.interactions && ch.interactions.instagram, facebook: ch.interactions && ch.interactions.facebook }
      : { instagram: (ch.reach && ch.reach.instagram) || ch.instagram, facebook: (ch.reach && ch.reach.facebook) || ch.facebook };
    const series = ['instagram', 'facebook']
      .filter((id) => Array.isArray(src[id]) && src[id].some((v) => Number(v) > 0))
      .map((id) => ({ id, label: NL_PLAT[id], vals: src[id].map((v) => Number(v) || 0) }));
    const n = Math.max(0, ...series.map((s) => s.vals.length));
    if (!series.length || !n) return null;
    const labels = ch.labels || [];
    const keys = Array.isArray(ch.keys) ? ch.keys : [];
    const posts = Array.isArray(ch.posts) ? ch.posts : null;
    const days = [];
    for (let i = 0; i < n; i += 1) {
      const parts = series.map((s) => s.vals[i] || 0);
      const p = posts && posts[i] ? posts[i] : null;
      days.push({ i, key: keys[i] || '', label: labels[i] || '', parts, total: parts.reduce((a, b) => a + b, 0), posts: p ? (p.items || []) : [], postCount: p ? (Number(p.count) || 0) : 0 });
    }
    const total = days.reduce((a, d) => a + d.total, 0);
    const avg = total / n;
    const best = days.reduce((b, d) => (d.total > b.total ? d : b), days[0]);
    const sums = series.map((s) => s.vals.reduce((a, b) => a + b, 0));
    let lift = null;
    if (posts) {
      const on = days.filter((d) => d.postCount > 0);
      const off = days.filter((d) => d.postCount === 0);
      if (on.length >= 2 && off.length >= 2) {
        const aOn = on.reduce((a, d) => a + d.total, 0) / on.length;
        const aOff = off.reduce((a, d) => a + d.total, 0) / off.length;
        lift = { on: aOn, off: aOff, ratio: aOff > 0 ? aOn / aOff : null, days: on.length };
      }
    }
    const totals = ch.totals || {};
    const t = metric === 'interactions' ? totals.interactions : totals.reach;
    const delta = t && typeof t.delta_pct === 'number' ? t.delta_pct : null;
    const step = nlNiceStep((best.total || 1) / 4);
    const top = Math.max(step, Math.ceil((best.total || 1) / step) * step);
    return { metric, series, days, n, total, avg, best, sums, lift, delta, step, top, hasPosts: !!posts };
  }
  function nlDailyHtml(card) {
    const metrics = ['reach', 'interactions'].filter((m) => nlDailyData(card, m));
    if (!metrics.length) return '<div class="nl-an-card__t">Daily performance</div><p class="nl-an-none">Daily numbers show here once Instagram or Facebook insights are connected for this period.</p>';
    if (!metrics.includes(_nlMetric)) _nlMetric = metrics[0];
    const d = nlDailyData(card, _nlMetric);
    const word = _nlMetric === 'interactions' ? 'interactions' : 'reach';
    const Word = word[0].toUpperCase() + word.slice(1);
    const periodDays = { '7d': 7, '30d': 30, '90d': 90 }[_period] || d.n;
    const names = d.series.map((s) => s.label).join(' and ');
    const pct = (v) => (d.total > 0 ? Math.round((v / d.total) * 100) : 0);
    const deltaHtml = d.delta == null ? '<em>No earlier period to compare</em>'
      : `<em class="${d.delta > 0 ? 'is-up' : d.delta < 0 ? 'is-down' : ''}">${d.delta > 0 ? '+' : ''}${d.delta}% vs previous ${periodDays} days</em>`;
    const bestDay = nlDay(d.best.key, d.best.label, { weekday: 'short' });
    const seg = metrics.length > 1
      ? `<div class="nl-seg" role="group" aria-label="Metric">${metrics.map((m) => `<button type="button" data-nl-metric="${m}" aria-pressed="${m === _nlMetric ? 'true' : 'false'}">${m === 'reach' ? 'Reach' : 'Interactions'}</button>`).join('')}</div>`
      : '';
    const ticks = [];
    for (let v = 0; v <= d.top + 1e-9; v += d.step) ticks.push(v);
    const yPct = (v) => (d.top > 0 ? (v / d.top) * 100 : 0);
    const xStep = Math.max(1, Math.ceil(d.n / 8));
    const cols = d.days.map((day) => {
      const h = yPct(day.total);
      const segs = day.parts.map((v, si) => (v > 0 ? `<i class="nl-dc__seg nl-dc__seg--${d.series[si].id}" style="flex:${v}"></i>` : '')).join('');
      const when = nlDay(day.key, day.label, { weekday: 'short' });
      const aria = `${when}: ${d.series.map((s, si) => `${s.label} ${fmtNum(day.parts[si])}`).join(', ')}${d.series.length > 1 ? `, total ${fmtNum(day.total)}` : ''} ${word}${day.postCount ? `. ${day.postCount} post${day.postCount === 1 ? '' : 's'} went out` : ''}`;
      return `<button type="button" class="nl-dc__col${day.i === d.best.i ? ' is-best' : ''}" data-i="${day.i}" aria-label="${esc(aria)}">
        <span class="nl-dc__bar">${day.total > 0 ? `<span class="nl-dc__stack" style="height:${h.toFixed(2)}%">${segs}</span>` : ''}${day.i === d.best.i && day.total > 0 ? `<span class="nl-dc__peak" style="bottom:calc(${h.toFixed(2)}% + 4px)">${nlCompact(day.total)}</span>` : ''}</span>
        <span class="nl-dc__mk">${day.postCount ? `<i title="${day.postCount} post${day.postCount === 1 ? '' : 's'}"></i>` : ''}</span>
      </button>`;
    }).join('');
    const xs = d.days.map((day) => `<span>${day.i % xStep === 0 || day.i === d.n - 1 ? esc(nlDay(day.key, day.label)) : ''}</span>`).join('');
    const legend = d.series.length > 1
      ? d.series.map((s, si) => `<span><i class="nl-dc__key nl-dc__key--${s.id}"></i>${esc(s.label)} <b>${fmtNum(d.sums[si])}</b> <em>${pct(d.sums[si])}%</em></span>`).join('')
      : '';
    // Plain-English findings, all computed from the series above.
    const finds = [];
    if (d.delta != null) finds.push(`${Word} is ${d.delta > 0 ? 'up' : d.delta < 0 ? 'down' : 'flat'}${d.delta ? ` ${Math.abs(d.delta)}%` : ''} on the previous ${periodDays} days.`);
    if (d.best.total > 0) {
      const x = d.avg > 0 ? d.best.total / d.avg : null;
      const what = d.best.posts.length ? ` That was the day "${d.best.posts[0].title}" went out${d.best.postCount > 1 ? `, with ${d.best.postCount - 1} other post${d.best.postCount > 2 ? 's' : ''}` : ''}.` : (d.hasPosts ? ' Nothing new went out that day, so it was older posts still travelling.' : '');
      finds.push(`Best day was ${bestDay}: ${fmtNum(d.best.total)} ${word}${x && x >= 1.2 ? `, ${x.toFixed(1)}× your daily average` : ''}.${what}`);
    }
    if (d.lift && d.lift.ratio) {
      finds.push(d.lift.ratio >= 1.1
        ? `Days you posted averaged ${fmtNum(Math.round(d.lift.on))} ${word}, against ${fmtNum(Math.round(d.lift.off))} on days you didn't (${d.lift.ratio.toFixed(1)}×). Posting more often should lift this.`
        : `Posting days averaged ${fmtNum(Math.round(d.lift.on))} ${word}, about the same as quiet days (${fmtNum(Math.round(d.lift.off))}). What you post matters more here than how often.`);
    }
    if (d.series.length > 1 && d.total > 0) {
      const lead = d.sums[0] >= d.sums[1] ? 0 : 1;
      finds.push(`${d.series[lead].label} brought ${pct(d.sums[lead])}% of ${word}.`);
    }
    const rows = d.days.slice().reverse().map((day) => `<tr><td>${esc(nlDay(day.key, day.label, { weekday: 'short' }))}</td>${d.series.map((s, si) => `<td class="nl-dc__num">${fmtNum(day.parts[si])}</td>`).join('')}${d.series.length > 1 ? `<td class="nl-dc__num">${fmtNum(day.total)}</td>` : ''}<td>${day.posts.length ? esc(day.posts.map((p) => p.title).join('; ')) + (day.postCount > day.posts.length ? ` +${day.postCount - day.posts.length}` : '') : ''}</td></tr>`).join('');
    return `
      <div class="nl-dc__head">
        <div>
          <h2 class="nl-dc__title">Daily ${word}${d.series.length > 1 ? ', by platform' : ` on ${esc(d.series[0].label)}`}</h2>
          <p class="nl-dc__sub">${esc(nlPeriodWords())} · ${esc(names)}${d.hasPosts ? ' · dots mark days you posted' : ''}</p>
        </div>
        ${seg}
      </div>
      <div class="nl-dc__stats">
        <div><span>Total ${word}</span><b>${fmtNum(d.total)}</b>${deltaHtml}</div>
        <div><span>Daily average</span><b>${fmtNum(Math.round(d.avg))}</b><em>${d.n} days</em></div>
        <div><span>Best day</span><b>${esc(nlDay(d.best.key, d.best.label))}</b><em>${fmtNum(d.best.total)} ${word}</em></div>
        ${d.lift && d.lift.ratio ? `<div><span>Days you posted</span><b>${d.lift.ratio.toFixed(1)}×</b><em>${nlCompact(d.lift.on)} vs ${nlCompact(d.lift.off)} a day</em></div>` : ''}
      </div>
      ${legend || d.avg > 0 ? `<div class="nl-dc__legend">${legend}${d.avg > 0 ? '<span><i class="nl-dc__key nl-dc__key--avg"></i>Daily average</span>' : ''}</div>` : ''}
      <div class="nl-dc__chart">
        <div class="nl-dc__y" aria-hidden="true">${ticks.map((v) => `<span style="bottom:${yPct(v).toFixed(2)}%">${nlCompact(v)}</span>`).join('')}</div>
        <div class="nl-dc__plot" role="group" aria-label="Daily ${word}. Use Tab to move between days.">
          <div class="nl-dc__area" aria-hidden="true">
            ${ticks.map((v) => `<i class="nl-dc__grid" style="bottom:${yPct(v).toFixed(2)}%"></i>`).join('')}
            ${d.avg > 0 ? `<i class="nl-dc__avg" style="bottom:${yPct(d.avg).toFixed(2)}%"><span>Avg ${nlCompact(d.avg)}</span></i>` : ''}
          </div>
          <div class="nl-dc__cols" style="--n:${d.n}">${cols}</div>
          <div class="nl-dc__tip" role="status" aria-live="polite" hidden></div>
        </div>
        <div class="nl-dc__x" aria-hidden="true" style="--n:${d.n}">${xs}</div>
      </div>
      ${finds.length ? `<ul class="nl-dc__finds">${finds.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      <details class="nl-dc__table">
        <summary>Show the numbers</summary>
        <div class="nl-dc__tablewrap"><table>
          <thead><tr><th>Day</th>${d.series.map((s) => `<th class="nl-dc__num">${esc(s.label)}</th>`).join('')}${d.series.length > 1 ? '<th class="nl-dc__num">Total</th>' : ''}<th>Posts that day</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </details>`;
  }
  function nlPaintDaily(card) {
    const host = document.getElementById('nl-daily');
    if (!host) return;
    host.innerHTML = nlDailyHtml(card);
    const d = nlDailyData(card, _nlMetric);
    host.querySelectorAll('[data-nl-metric]').forEach((b) => b.addEventListener('click', () => {
      _nlMetric = b.getAttribute('data-nl-metric');
      nlPaintDaily(card);
    }));
    if (!d) return;
    const plot = host.querySelector('.nl-dc__plot');
    const tip = host.querySelector('.nl-dc__tip');
    const word = _nlMetric === 'interactions' ? 'interactions' : 'reach';
    const show = (col) => {
      const day = d.days[Number(col.dataset.i)];
      if (!day || !tip) return;
      host.querySelectorAll('.nl-dc__col.is-on').forEach((c) => c.classList.remove('is-on'));
      col.classList.add('is-on');
      tip.textContent = '';
      const h = document.createElement('div');
      h.className = 'nl-dc__tip-h';
      h.textContent = nlDay(day.key, day.label, { weekday: 'long' });
      tip.appendChild(h);
      const row = (key, value, label) => {
        const r = document.createElement('div');
        r.className = 'nl-dc__tip-r';
        const k = document.createElement('i');
        k.className = `nl-dc__tip-k${key ? ` nl-dc__tip-k--${key}` : ''}`;
        const v = document.createElement('b');
        v.textContent = value;
        const l = document.createElement('span');
        l.textContent = label;
        r.append(k, v, l);
        tip.appendChild(r);
      };
      d.series.forEach((s, si) => row(s.id, fmtNum(day.parts[si]), s.label));
      if (d.series.length > 1) row('', fmtNum(day.total), `total ${word}`);
      const vs = document.createElement('div');
      vs.className = 'nl-dc__tip-vs';
      if (d.avg > 0) {
        const diff = Math.round(((day.total - d.avg) / d.avg) * 100);
        vs.textContent = diff === 0 ? 'Same as your daily average' : `${Math.abs(diff)}% ${diff > 0 ? 'above' : 'below'} your daily average`;
        tip.appendChild(vs);
      }
      if (day.postCount) {
        const p = document.createElement('div');
        p.className = 'nl-dc__tip-posts';
        const t = document.createElement('div');
        t.className = 'nl-dc__tip-pt';
        t.textContent = `${day.postCount} post${day.postCount === 1 ? '' : 's'} went out`;
        p.appendChild(t);
        day.posts.forEach((post) => {
          const li = document.createElement('div');
          li.textContent = `${post.title} · ${post.format || ''}${post.platform ? ` · ${NL_PLAT[post.platform] || post.platform}` : ''}`;
          p.appendChild(li);
        });
        tip.appendChild(p);
      } else if (d.hasPosts) {
        const p = document.createElement('div');
        p.className = 'nl-dc__tip-pt';
        p.textContent = 'No new posts this day';
        tip.appendChild(p);
      }
      tip.hidden = false;
      const pr = plot.getBoundingClientRect();
      const cr = col.getBoundingClientRect();
      const tw = tip.offsetWidth;
      let x = cr.left - pr.left + cr.width / 2 + 10;
      if (x + tw > pr.width) x = cr.left - pr.left + cr.width / 2 - tw - 10;
      tip.style.left = `${Math.max(0, x)}px`;
    };
    const hide = () => {
      if (tip) tip.hidden = true;
      host.querySelectorAll('.nl-dc__col.is-on').forEach((c) => c.classList.remove('is-on'));
    };
    host.querySelectorAll('.nl-dc__col').forEach((col) => {
      col.addEventListener('pointerenter', () => show(col));
      col.addEventListener('focus', () => show(col));
      col.addEventListener('blur', hide);
    });
    plot.addEventListener('pointerleave', hide);
  }

  function nlCall(row, moves) {
    const same = (x) => x && ((x.permalink && x.permalink === row.permalink) || (x.title && x.title === row.title));
    if ((moves.scale || []).some(same)) return ['ok', 'Scale'];
    if ((moves.kill || []).some(same)) return ['bad', 'Kill'];
    if ((moves.test || []).some(same)) return ['info', 'Test'];
    return row.taxonomy_status === 'unknown' ? ['muted', 'Unknown'] : ['muted', 'Proven'];
  }
  function nlMainHtml(card) {
    const k = card.kpis || {};
    const moves = card.moves || { scale: [], kill: [], test: [] };
    const rows = (card.ranked && card.ranked.length ? card.ranked : card.rows) || [];
    const charts = card.charts || {};
    const labels = charts.labels;
    const reachIg = charts.reach?.instagram || charts.instagram;
    const reachFb = charts.reach?.facebook || charts.facebook;
    const intIg = charts.interactions?.instagram;
    const intFb = charts.interactions?.facebook;
    const kpi = (label, value) => `<div class="nl-an-kpi"><span>${label}</span><b class="analytics-kpi-card__value">${value}</b></div>`;
    const move = (id, label, tone, item, hint) => item
      ? `<button type="button" id="${id}" class="nl-an-move nl-an-move--${tone}"><span class="nl-an-move__l">${label}</span><b>${esc(item.title || 'Untitled')}</b><span class="nl-an-move__m">${esc(item.intent || '')}${item.views != null ? ` · ${fmtNum(item.views)} views` : ''}${item.eng_rate != null ? ` · ${item.eng_rate}% eng` : ''}</span><span class="nl-an-move__go">${hint}</span></button>`
      : `<button type="button" id="${id}" class="nl-an-move nl-an-move--${tone}" disabled><span class="nl-an-move__l">${label}</span><span class="nl-an-move__m">None this period</span></button>`;
    const table = rows.map((r, i) => {
      const [tone, call] = nlCall(r, moves);
      return `<div class="analytics-row nl-an-row" id="analytics-row-${i}" data-permalink="${esc(r.permalink || '')}"${r.permalink ? ' tabindex="0"' : ''}>
        <span class="nl-an-row__t">${esc(r.title)}<em>${esc(r.intent || '')}</em></span><span class="nl-an-num">${fmtNum(r.views)}</span><span class="nl-an-num">${r.eng_rate != null ? r.eng_rate + '%' : '—'}</span><span><i class="nl-an-call nl-an-call--${tone}">${call}</i></span>
      </div>`;
    }).join('') || '<p class="nl-an-none">No proven posts in this book yet.</p>';
    const chartBox = (id, title, inner) => `<div id="${id}" class="nl-an-card nl-an-mini"><div class="nl-an-card__t">${title}</div>${inner}</div>`;
    const chartsPanel = _chartsOpen ? `<div id="analytics-charts-panel" class="nl-an-charts">
        ${chartBox('analytics-chart-reach', 'Reach', lineChartHtml(labels, reachFb, reachIg, 'No reach series for this period.'))}
        ${chartBox('analytics-chart-interactions', 'Interactions', lineChartHtml(labels, intFb, intIg, 'No interaction series for this period.'))}
        ${chartBox('analytics-chart-format', 'By format', formatSplitHtml(rows))}
        ${chartBox('analytics-chart-intent', 'By intent', intentSplitHtml(rows))}
      </div>` : '<div id="analytics-charts-panel" hidden></div>';
    return `<div class="nl-an-main">
      <section class="nl-an-verdict"><b>${esc(card.verdict || 'Proven posts in this book.')}</b> <span>Three moves, ranked only on proven data.</span></section>
      <div class="nl-an-kpis">${kpi('Views', fmtNum(k.views))}${kpi('Followers', fmtNum(k.followers))}${kpi('Engagement rate', k.eng_rate != null ? k.eng_rate + '%' : '—')}${kpi('Needs review', fmtNum(k.untagged))}</div>
      <section class="nl-an-card nl-dc" id="nl-daily" aria-label="Daily performance"></section>
      <div class="nl-an-two">
        <div class="nl-an-left">
          <div class="nl-an-moves">
            ${move('analytics-scale', 'Scale', 'ok', moves.scale[0], 'Remix it')}
            ${move('analytics-test', 'Test', 'info', moves.test[0], 'Remix it')}
            ${move('analytics-kill', 'Kill', 'bad', moves.kill[0], 'Open the post')}
          </div>
          ${chartsPanel}
        </div>
        <section class="nl-an-card nl-an-table">
          <div class="nl-an-table__h"><span>Posts, best to worst</span></div>
          <div class="nl-an-row nl-an-row--head"><span>Post</span><span class="nl-an-num">Views</span><span class="nl-an-num">Eng.</span><span>Call</span></div>
          ${table}
        </section>
      </div>
    </div>`;
  }

  function renderShell() {
    const content = document.getElementById('dash-content');
    if (!content) return;
    const biz = (_clientData && _clientData.client && (_clientData.client.business_name || _clientData.client.contact_name)) || 'Your brand';
    if (isNL()) {
      const pill = (v) => `<button type="button" class="grow-pill${_period === v ? ' active' : ''}" data-period="${v}">${v}</button>`;
      content.innerHTML = `
      <div id="analytics-cockpit" class="nl-an">
        <div class="nl-an-head">
          <div><h1 class="nl-h1">Analytics</h1><p class="nl-an-sub" id="nl-an-sub">${nlPeriodWords()}.</p></div>
          <div class="nl-an-tools">
            <span class="grow-updated" id="analytics-updated"></span>
            <div class="nl-seg" id="analytics-period-pills" role="group" aria-label="Period">${pill('7d')}${pill('30d')}${pill('90d')}</div>
            <button type="button" class="nl-btn" id="analytics-charts-toggle" aria-pressed="false">More charts</button>
            <button type="button" class="nl-btn nl-btn--icon" id="analytics-refresh" aria-label="Refresh" title="Refresh">${NL_REFRESH}</button>
          </div>
        </div>
        <div id="analytics-body" class="nl-an-body"><div class="dash-loading" style="flex:1"><div class="dash-loading__spinner"></div></div></div>
      </div>`;
    } else
    content.innerHTML = `
      <div id="analytics-cockpit">
        <div class="grow-header">
          <div class="grow-header__left">
            <div>
              <div class="grow-field-label">Client</div>
              <div class="grow-business">${esc(biz)}</div>
            </div>
            <div>
              <div class="grow-field-label">Period</div>
              <div class="grow-pills" id="analytics-period-pills">
                <button type="button" class="grow-pill${_period === '7d' ? ' active' : ''}" data-period="7d">7d</button>
                <button type="button" class="grow-pill${_period === '30d' ? ' active' : ''}" data-period="30d">30d</button>
                <button type="button" class="grow-pill${_period === '90d' ? ' active' : ''}" data-period="90d">90d</button>
              </div>
            </div>
          </div>
          <div class="grow-header__right">
            <span class="grow-updated" id="analytics-updated"></span>
            <button type="button" class="grow-refresh-btn" id="analytics-refresh">Refresh</button>
            <button type="button" class="grow-ghost-btn" id="analytics-charts-toggle">Charts</button>
          </div>
        </div>
        <div id="analytics-body" style="display:flex;gap:0;min-height:520px;border:1px solid rgba(255,255,255,.06);border-radius:16px;overflow:hidden;background:#070B14">
          <div class="dash-loading" style="flex:1"><div class="dash-loading__spinner"></div></div>
        </div>
      </div>`;
    document.getElementById('analytics-period-pills')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-period]');
      if (!btn) return;
      _period = btn.dataset.period;
      document.querySelectorAll('#analytics-period-pills .grow-pill').forEach((b) => {
        b.classList.toggle('active', b.dataset.period === _period);
      });
      loadCard();
    });
    document.getElementById('analytics-refresh')?.addEventListener('click', () => loadCard({ refresh: true }));
    document.getElementById('analytics-charts-toggle')?.addEventListener('click', () => {
      _chartsOpen = !_chartsOpen;
      paintCard(_card);
    });
  }

  function paintCard(card) {
    const body = document.getElementById('analytics-body');
    if (!body) return;
    const clientType = card?.clientType || 'charity';
    const thirdBook = clientType === 'commerce' ? 'commerce' : 'fundraising';
    const sources = card?.sources || [];
    const books = ['organic', 'insights', 'paid', thirdBook];
    const rail = books.map((b) => {
      const on = (_book === 'organic' && b === 'organic') || _book === b;
      return `<button type="button" data-book="${esc(b)}" style="display:block;width:100%;text-align:left;border:0;border-radius:10px;padding:12px 10px;margin-bottom:6px;font-weight:700;cursor:pointer;font-family:inherit;${on ? 'background:#fff;color:#070B14' : 'background:transparent;color:rgba(255,255,255,.4)'}">${esc(bookLabel(b, clientType))}</button>`;
    }).join('');
    const srcHtml = sources.map((s) => {
      const thin = s.status === 'thin' ? ' <span style="color:rgba(255,255,255,.35)">limited</span>' : '';
      const off = s.status === 'disconnected' ? ' <span style="color:rgba(255,255,255,.3)">connect</span>' : '';
      return `<div style="font-size:12px;margin-bottom:6px">${sourceDot(s.status)} ${esc(sourceLabel(s.id))}${thin}${off}</div>`;
    }).join('');

    let main;
    if (_book === 'insights') {
      main = insightsMainHtml(_insights);
    } else if (!card || (card.empty && _book === 'organic' && !card.meta_connected)) {
      const cta = emptyCopy('organic');
      main = `<div style="padding:48px 32px;max-width:520px">
        <div style="font-size:22px;font-weight:650;letter-spacing:-.03em;margin-bottom:8px">${esc(cta.title)}</div>
        <div style="color:rgba(255,255,255,.5);margin-bottom:18px">${esc(cta.body)}</div>
        <button type="button" class="grow-cta-btn" id="analytics-connect-ig">Connect Instagram</button>
        <button type="button" class="grow-ghost-btn" id="analytics-connect-fb" style="margin-left:8px">Connect Facebook</button>
        <div style="display:flex;gap:28px;margin-top:28px">
          <div><div style="font-size:11px;color:rgba(255,255,255,.4)">Views</div><div class="analytics-kpi-card__value" style="font-size:28px;font-weight:700">—</div></div>
          <div><div style="font-size:11px;color:rgba(255,255,255,.4)">Followers</div><div class="analytics-kpi-card__value" style="font-size:28px;font-weight:700">—</div></div>
        </div>
      </div>`;
    } else if (card.empty) {
      const cta = (_book === 'organic')
        ? { title: 'No proven organic posts in this period', body: 'When Reels and posts land, they will rank here against the job they were hired to do.', cta: 'Refresh', nav: null }
        : emptyCopy(_book);
      main = `<div style="padding:48px 32px;max-width:520px">
        <div style="font-size:22px;font-weight:650;letter-spacing:-.03em;margin-bottom:8px">${esc(cta.title)}</div>
        <div style="color:rgba(255,255,255,.5);margin-bottom:18px">${esc(cta.body)}</div>
        <button type="button" class="grow-cta-btn" id="analytics-empty-cta">${esc(cta.cta)}</button>
        <div style="display:flex;gap:28px;margin-top:28px">
          <div><div style="font-size:11px;color:rgba(255,255,255,.4)">Views</div><div class="analytics-kpi-card__value" style="font-size:28px;font-weight:700">—</div></div>
          <div><div style="font-size:11px;color:rgba(255,255,255,.4)">Followers</div><div class="analytics-kpi-card__value" style="font-size:28px;font-weight:700">—</div></div>
        </div>
      </div>`;
    } else if (isNL()) {
      main = nlMainHtml(card);
    } else {
      const k = card.kpis || {};
      const moves = card.moves || { scale: [], kill: [], test: [] };
      const moveCard = (id, label, color, border, bg, item) => {
        if (!item) {
          return `<button type="button" id="${id}" disabled style="text-align:left;width:100%;font-family:inherit;color:inherit;background:${bg};border:1px solid ${border};border-radius:12px;padding:14px 16px;opacity:.4;cursor:default"><div style="font-size:10px;letter-spacing:.1em;color:${color}">${label}</div><div>None this period</div></button>`;
        }
        return `<button type="button" id="${id}" style="text-align:left;width:100%;cursor:pointer;font-family:inherit;color:inherit;background:${bg};border:1px solid ${border};border-radius:12px;padding:14px 16px">
          <div style="font-size:10px;letter-spacing:.1em;color:${color};margin-bottom:6px">${label}</div>
          <div style="font-weight:700">${esc(item.title || 'Untitled')}</div>
          <div style="color:rgba(255,255,255,.5);font-size:12px">${esc(item.intent || '')}${item.views != null ? ' · ' + fmtNum(item.views) + ' views' : ''}${item.eng_rate != null ? ' · ' + item.eng_rate + '% eng' : ''}</div>
        </button>`;
      };
      const rows = (card.ranked && card.ranked.length ? card.ranked : card.rows) || [];
      const table = rows.map((r, i) => `<div class="analytics-row" id="analytics-row-${i}" data-permalink="${esc(r.permalink || '')}" style="display:grid;grid-template-columns:1.6fr .6fr .5fr .5fr .7fr;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:13px;cursor:${r.permalink ? 'pointer' : 'default'}">
        <span>${esc(r.title)}</span><span>${esc(r.intent || '—')}</span><span>${fmtNum(r.views)}</span><span>${r.eng_rate != null ? r.eng_rate + '%' : '—'}</span><span style="color:${r.taxonomy_status === 'unknown' ? 'rgba(255,255,255,.4)' : '#4ADE80'}">${esc(r.taxonomy_status === 'unknown' ? 'unknown' : 'proven')}</span>
      </div>`).join('') || '<p style="color:rgba(255,255,255,.4)">No proven posts in this book yet.</p>';
      const charts = card.charts || {};
      const labels = charts.labels;
      const reachIg = charts.reach?.instagram || charts.instagram;
      const reachFb = charts.reach?.facebook || charts.facebook;
      const intIg = charts.interactions?.instagram;
      const intFb = charts.interactions?.facebook;
      const chartBox = (id, title, inner) => `<div id="${id}" style="background:#121A2B;border:1px solid #243049;border-radius:12px;padding:12px"><div style="font-size:10px;letter-spacing:.08em;color:rgba(255,255,255,.4);margin-bottom:10px">${title}</div>${inner}</div>`;
      const chartsPanel = _chartsOpen ? `<div id="analytics-charts-panel" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
        ${chartBox('analytics-chart-reach', 'REACH', lineChartHtml(labels, reachFb, reachIg, 'No reach series for this period.'))}
        ${chartBox('analytics-chart-interactions', 'INTERACTIONS', lineChartHtml(labels, intFb, intIg, 'No interaction series for this period.'))}
        ${chartBox('analytics-chart-format', 'BY FORMAT', formatSplitHtml(rows))}
        ${chartBox('analytics-chart-intent', 'BY INTENT', intentSplitHtml(rows))}
      </div>` : '<div id="analytics-charts-panel" hidden></div>';
      main = `<div style="padding:28px 32px;flex:1;min-width:0">
        <div style="font-size:11px;letter-spacing:.08em;color:rgba(255,255,255,.4);margin-bottom:8px">${esc(bookLabel(_book, clientType)).toUpperCase()} · LAST ${_period.toUpperCase()}</div>
        <h3 style="font-size:26px;font-weight:650;letter-spacing:-.03em;line-height:1.25;margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;color:#fff">${esc(card.verdict || 'Proven posts in this book.')}</h3>
        <p style="color:rgba(255,255,255,.5);margin:0 0 22px;font-size:13px">Three moves. Ranked only on proven data.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:22px">
          ${moveCard('analytics-scale', 'SCALE', '#4ADE80', '#166534', '#12261C', moves.scale[0])}
          ${moveCard('analytics-kill', 'KILL', '#F87171', '#7F1D1D', '#2A1212', moves.kill[0])}
          ${moveCard('analytics-test', 'TEST', '#C4B5FD', '#5B21B6', '#1A1730', moves.test[0])}
        </div>
        <div style="display:flex;gap:28px;margin-bottom:20px;flex-wrap:wrap">
          <div><div style="font-size:11px;color:rgba(255,255,255,.4)">Views</div><div class="analytics-kpi-card__value" style="font-size:28px;font-weight:700">${fmtNum(k.views)}</div></div>
          <div><div style="font-size:11px;color:rgba(255,255,255,.4)">Followers</div><div class="analytics-kpi-card__value" style="font-size:28px;font-weight:700">${fmtNum(k.followers)}</div></div>
          <div><div style="font-size:11px;color:rgba(255,255,255,.4)">Engagement</div><div class="analytics-kpi-card__value" style="font-size:28px;font-weight:700">${k.eng_rate != null ? k.eng_rate + '%' : '—'}</div></div>
          <div><div style="font-size:11px;color:rgba(255,255,255,.4)">Needs review</div><div class="analytics-kpi-card__value" style="font-size:28px;font-weight:700">${fmtNum(k.untagged)}</div></div>
        </div>
        ${chartsPanel}
        <div style="border-top:1px solid rgba(255,255,255,.06);padding-top:8px">
          <div style="display:grid;grid-template-columns:1.6fr .6fr .5fr .5fr .7fr;padding:8px 0;font-size:10px;letter-spacing:.06em;color:rgba(255,255,255,.35)">POST · INTENT · VIEWS · ENG · STATUS</div>
          ${table}
        </div>
      </div>`;
    }

    if (isNL()) {
      const tabs = books.map((b) => {
        const on = _book === b;
        return `<button type="button" data-book="${esc(b)}" class="${on ? 'is-on' : ''}" aria-pressed="${on ? 'true' : 'false'}">${esc(bookLabel(b, clientType))}</button>`;
      }).join('');
      const live = sources.map((s) => `<span class="nl-an-src nl-an-src--${esc(s.status || 'off')}" title="${esc(s.status || '')}"><i></i>${esc(sourceLabel(s.id))}${s.status === 'thin' ? ' · limited' : ''}</span>`).join('');
      const plain = _book === 'insights' || !card || card.empty;
      body.innerHTML = `
        <div class="nl-an-lens"><div class="nl-seg" role="group" aria-label="Lens">${tabs}</div><div class="nl-an-live">${live}</div></div>
        ${plain ? `<div class="nl-an-card nl-an-plain">${main}</div>` : main}`;
      const sub = document.getElementById('nl-an-sub');
      if (sub) sub.textContent = nlSubline(card);
      if (!plain) nlPaintDaily(card);
    } else
    body.innerHTML = `
      <aside style="width:160px;flex-shrink:0;border-right:1px solid rgba(255,255,255,.06);padding:20px 14px">
        <div style="font-size:10px;letter-spacing:.12em;color:rgba(255,255,255,.35);margin-bottom:12px">LENS</div>
        ${rail}
        <div style="font-size:10px;letter-spacing:.12em;color:rgba(255,255,255,.35);margin:22px 0 10px">LIVE</div>
        ${srcHtml}
      </aside>
      <main style="flex:1;min-width:0;display:flex">${main}</main>`;

    const toggle = document.getElementById('analytics-charts-toggle');
    if (toggle && isNL()) {
      toggle.setAttribute('aria-pressed', _chartsOpen ? 'true' : 'false');
    } else if (toggle) {
      toggle.style.background = _chartsOpen ? '#7C3AED' : 'transparent';
      toggle.style.color = _chartsOpen ? '#fff' : '';
    }
    const upd = document.getElementById('analytics-updated');
    if (upd && card?.last_updated) {
      const t = new Date(card.last_updated);
      upd.textContent = Number.isNaN(t.getTime()) ? '' : `Updated ${t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    }

    body.querySelectorAll('[data-book]').forEach((btn) => {
      btn.addEventListener('click', () => {
        _book = btn.getAttribute('data-book');
        _chartsOpen = false;
        loadCard();
      });
    });
    document.getElementById('analytics-connect-ig')?.addEventListener('click', () => {
      if (typeof _deps.connectIg === 'function') _deps.connectIg();
    });
    document.getElementById('analytics-connect-fb')?.addEventListener('click', () => {
      if (typeof _deps.connectFb === 'function') _deps.connectFb();
    });
    document.getElementById('analytics-empty-cta')?.addEventListener('click', () => {
      const label = (document.getElementById('analytics-empty-cta')?.textContent || '').trim();
      if (label === 'Refresh') {
        loadCard();
        return;
      }
      const nav = emptyCopy(_book).nav;
      if (nav && typeof _deps.switchNav === 'function') _deps.switchNav(nav);
      else if (nav) document.querySelector(`[data-nav="${nav}"]`)?.click();
    });
    document.getElementById('analytics-scale')?.addEventListener('click', () => {
      startRemix((_card?.moves?.scale || [])[0]);
    });
    document.getElementById('analytics-test')?.addEventListener('click', () => {
      startRemix((_card?.moves?.test || [])[0]);
    });
    document.getElementById('analytics-kill')?.addEventListener('click', () => {
      openPermalink((_card?.moves?.kill || [])[0]?.permalink);
    });
    if (_book === 'insights') bindInsights(body);
    body.querySelectorAll('.analytics-row').forEach((el) => {
      el.addEventListener('click', () => openPermalink(el.getAttribute('data-permalink')));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openPermalink(el.getAttribute('data-permalink')); });
    });
    if (typeof global.lucide !== 'undefined') global.lucide.createIcons();
  }

  // Scorecards already fetched this session, by book and period. The portal warms the default
  // one in the background after sign-in (seWarmAnalytics), so opening Analytics paints at once;
  // the page then checks for newer numbers quietly. One request per scorecard at a time.
  const WARM_FRESH_MS = 10 * 60 * 1000;
  const _cards = new Map(); // `${book}:${period}` -> { data, at }
  const _cardJobs = new Map(); // `${book}:${period}` -> in-flight promise

  function fetchCard(book, period, { refresh = false } = {}) {
    const key = `${book}:${period}`;
    if (!refresh && _cardJobs.has(key)) return _cardJobs.get(key);
    const job = fetch(`${apiBase()}/api/analytics/scorecard?book=${encodeURIComponent(book)}&period=${encodeURIComponent(period)}${refresh ? '&refresh=1' : ''}`, {
      headers: authHeaders(),
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        _cards.set(key, { data, at: Date.now() });
        return data;
      })
      .catch(() => null)
      .finally(() => { if (_cardJobs.get(key) === job) _cardJobs.delete(key); });
    _cardJobs.set(key, job);
    return job;
  }

  /** Load the scorecard Analytics opens with, unless a fresh one is already here. */
  function warmAnalytics() {
    const hit = _cards.get('organic:30d');
    if (hit && Date.now() - hit.at < WARM_FRESH_MS) return Promise.resolve(hit.data);
    return fetchCard('organic', '30d');
  }

  async function loadCard(opts) {
    if (_book === 'insights') return loadInsights(opts);
    const refresh = !!(opts && opts.refresh);
    const book = _book;
    const period = _period;
    const body = document.getElementById('analytics-body');
    const hit = refresh ? null : _cards.get(`${book}:${period}`);
    const stillHere = () => book === _book && period === _period && !!document.getElementById('analytics-body');
    if (hit) {
      // Paint what is already here, then look for newer numbers without a spinner.
      _card = hit.data;
      paintCard(_card);
      if (Date.now() - hit.at < 60 * 1000) return;
      const fresh = await fetchCard(book, period);
      if (fresh && stillHere() && JSON.stringify(fresh) !== JSON.stringify(_card)) {
        _card = fresh;
        paintCard(_card);
      }
      return;
    }
    if (body && !_card) {
      body.innerHTML = '<div class="dash-loading" style="flex:1"><div class="dash-loading__spinner"></div></div>';
    }
    const data = await fetchCard(book, period, { refresh });
    if (!stillHere()) return;
    _card = data || { empty: true, sources: [], rows: [], clientType: 'charity' };
    paintCard(_card);
  }

  // ── Meta Insights lens ──
  const STORY_LABELS = {
    tutorial: 'Tutorial', qa: 'Q&A', listicle: 'Listicle', pov: 'POV', types_of: 'Types of…',
    bts: 'Behind the scenes', town_hall: 'Town hall', before_after: 'Before / after', facts_list: 'Facts list',
  };
  const OPENER_LABELS = {
    generic: 'generic openers ("Check this out…")', pov: 'POV openers', question: 'question openers',
    number: 'number openers', quote: 'quote openers', statement: 'direct statements',
  };
  const FORMAT_LABELS = { reel: 'Reel', carousel: 'Carousel', image: 'Photo' };

  function defOf(id) {
    const d = (_insights && _insights.definitions && _insights.definitions[id]) || {};
    return { label: d.label || id, def: d.def || '' };
  }

  function fmtMetric(id, v) {
    if (v == null) return '—';
    if (/_per_reach$/.test(id)) return `${(v * 100).toFixed(1)}%`;
    if (/_sec$/.test(id)) return `${v}s`;
    return fmtNum(v);
  }

  function patternText(p) {
    if (p.kind === 'story_type') return `${STORY_LABELS[p.value] || p.value} posts (${p.count})`;
    if (p.kind === 'opener') return `${OPENER_LABELS[p.value] || p.value} (${p.count})`;
    if (p.kind === 'fatigue') return `Resting ${STORY_LABELS[p.value] || p.value} — ${p.count} of your last ${p.of} posts`;
    return String(p.value || '');
  }

  function kpiTile(item, primary) {
    const d = defOf(item.id);
    const share = item.share != null ? `<div style="font-size:11px;color:rgba(255,255,255,.45)">${Math.round(item.share * 100)}% of reach</div>` : '';
    return `<div class="mi-kpi" title="${esc(d.def)}" style="flex:1;min-width:120px;padding:12px 14px;border-radius:10px;background:${primary ? '#121A2B' : 'transparent'};border:1px solid ${primary ? '#243049' : 'rgba(255,255,255,.06)'}">
      <div style="font-size:11px;color:rgba(255,255,255,.45);border-bottom:1px dotted rgba(255,255,255,.25);display:inline-block;cursor:help">${esc(d.label)}${item.median ? ' · median' : ''}</div>
      <div class="analytics-kpi-card__value" style="font-size:22px;font-weight:700;margin-top:4px">${fmtMetric(item.id, item.value)}</div>${share}
    </div>`;
  }

  const VERDICT_STYLE = {
    scale: { label: 'Scale', color: '#4ADE80' },
    hold: { label: 'Hold', color: '#FBBF24' },
    rest: { label: 'Rest', color: '#F87171' },
  };

  function verdictBadge(p) {
    const v = VERDICT_STYLE[p.verdict];
    if (!v) return '';
    return `<span class="mi-verdict" data-verdict="${esc(p.verdict)}" title="${esc(p.verdict_action || '')}" style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:.04em;color:${v.color};border:1px solid ${v.color}55;margin-left:6px">${v.label}</span>`;
  }

  function trendHtml(data) {
    const t = data.trend || {};
    const warn = t.tracking_warning ? `<div id="mi-tracking-warning" style="margin:0 0 14px;padding:10px 12px;border-radius:10px;border:1px solid rgba(251,146,60,.4);background:rgba(251,146,60,.08);font-size:12px;color:#FDBA74">${esc(t.tracking_warning)}</div>` : '';
    if (t.avg_score_last7 == null) return warn;
    const word = t.direction === 'up' ? 'better than' : t.direction === 'down' ? 'worse than' : 'about the same as';
    const color = t.direction === 'up' ? '#4ADE80' : t.direction === 'down' ? '#F87171' : 'rgba(255,255,255,.6)';
    const before = t.avg_score_before != null ? `, <span style="color:${color}">${word}</span> before (${t.avg_score_before})` : '';
    return `${warn}<div id="mi-trend" style="margin:0 0 14px;font-size:12px;color:rgba(255,255,255,.6)">Last 7 days: ${fmtNum(t.posts_last7)} post${t.posts_last7 === 1 ? '' : 's'}, average score ${t.avg_score_last7}${before}.</div>`;
  }

  function verdictKeyHtml(data) {
    const rules = data.verdict_rules || [];
    if (!rules.length) return '';
    return `<div style="font-size:11px;color:rgba(255,255,255,.4);margin:-6px 0 14px">${rules.map((r) => `<span style="color:${(VERDICT_STYLE[r.id] || {}).color || '#fff'};font-weight:700">${esc(r.label)}</span> ${esc(r.note)}`).join(' · ')}</div>`;
  }

  function recentPostsHtml(data) {
    const posts = (data.posts || []).filter((p) => p.verdict);
    if (!posts.length) return '';
    return `<details id="mi-all-posts" style="margin-top:18px"><summary style="cursor:pointer;font-size:12px;color:rgba(255,255,255,.6)">Every scored post (${posts.length})</summary>
      ${posts.map((p) => insightPostRow(p, p.verdict === 'rest' ? 'lose' : p.verdict === 'scale' ? 'win' : 'hold')).join('')}
    </details>`;
  }

  function insightPostRow(p, tone) {
    const m = p.metrics || {};
    const color = tone === 'win' ? '#4ADE80' : tone === 'hold' ? '#FBBF24' : '#F87171';
    const tags = [FORMAT_LABELS[p.format] || p.format, STORY_LABELS[p.story_type] || '', p.opener && p.opener !== 'statement' ? (OPENER_LABELS[p.opener] || p.opener).split(' (')[0] : '']
      .filter(Boolean).join(' · ');
    const stats = [`reach ${fmtNum(m.reach)}`, m.sends_per_reach != null ? `sends ${fmtMetric('sends_per_reach', m.sends_per_reach)}` : '', m.avg_watch_sec != null ? `watch ${m.avg_watch_sec}s` : '', m.comments != null ? `${fmtNum(m.comments)} comments` : '']
      .filter(Boolean).join(' · ');
    return `<div class="mi-post" data-permalink="${esc(p.permalink || '')}" style="display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06);cursor:${p.permalink ? 'pointer' : 'default'}">
      <div style="font-weight:700;color:${color};min-width:34px">${p.goal_score != null ? p.goal_score : '—'}</div>
      <div style="min-width:0">
        <div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.first_line || '(no caption)')}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.45)">${esc(tags)}${tags && stats ? ' · ' : ''}${esc(stats)}${verdictBadge(p)}</div>
        ${p.verdict_action ? `<div class="mi-verdict-action" style="font-size:11px;color:rgba(255,255,255,.6);margin-top:3px">${esc(p.verdict_action)}</div>` : ''}
      </div>
    </div>`;
  }

  function briefHtml(brief, data) {
    const btnLabel = _briefBusy ? 'Reading your posts…' : (brief ? 'Regenerate next week' : 'Generate next week from Insights');
    const btn = `<button type="button" class="grow-cta-btn" id="mi-brief-btn" style="width:auto;flex:none;white-space:nowrap"${_briefBusy || (data && data.eligible < 4) ? ' disabled' : ''}>${esc(btnLabel)}</button>`;
    const thin = data && data.eligible < 4 ? `<div style="font-size:12px;color:rgba(255,255,255,.45);margin-top:8px">Needs at least 4 posts that are 2+ days old (have ${data.eligible}).</div>` : '';
    if (!brief) {
      return `<div id="mi-brief" style="margin-top:22px;padding:16px;border:1px dashed #243049;border-radius:12px">
        <div style="font-weight:650;margin-bottom:4px">Next week, from what worked</div>
        <div style="font-size:12px;color:rgba(255,255,255,.5);margin-bottom:12px">Reads your winners, losers and top comments, then fills next week's open slots with ideas.</div>
        ${btn}${thin}
      </div>`;
    }
    const list = (arr, label, color) => (arr && arr.length) ? `<div style="margin-bottom:10px"><div style="font-size:10px;letter-spacing:.08em;color:${color};margin-bottom:4px">${label}</div>${arr.map((x) => `<div style="font-size:13px;margin-bottom:3px">• ${esc(x)}</div>`).join('')}</div>` : '';
    const ideas = (brief.ideas || []).map((idea, i) => `<div class="mi-idea" style="padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:10px;margin-bottom:8px">
        <div style="font-size:11px;color:rgba(255,255,255,.45);margin-bottom:4px">${esc(idea.date)} · ${esc(idea.format === 'feed' ? 'Feed post' : 'Reel')} · ${esc(STORY_LABELS[idea.story_type] || 'any type')} · ${idea.goal === 'engage' ? 'Engage' : 'Grow'}</div>
        <div style="font-weight:650;margin-bottom:2px">${esc(idea.hook)}</div>
        <div style="font-size:12px;color:rgba(255,255,255,.6)">${esc(idea.angle)}</div>
        ${idea.why ? `<div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:4px">Why: ${esc(idea.why)}</div>` : ''}
        <div style="margin-top:8px;display:flex;gap:8px">
          <button type="button" class="grow-ghost-btn" style="width:auto" data-mi-make="animate" data-mi-idea="${i}">Make in Reels</button>
          <button type="button" class="grow-ghost-btn" style="width:auto" data-mi-make="design" data-mi-idea="${i}">Make in Design</button>
        </div>
      </div>`).join('');
    return `<div id="mi-brief" style="margin-top:22px;padding:16px;border:1px solid #243049;border-radius:12px;background:#0B1120">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px">
        <div><div style="font-weight:650">Next week (${esc(brief.week_start || '')}) · ${brief.goal === 'engage' ? 'Engage' : 'Grow'}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.4)">Built ${esc(String(brief.generated_at || '').slice(0, 10))} · Coach and Reels use this for 14 days</div></div>
        ${btn}
      </div>
      ${brief.summary ? `<div style="font-size:14px;margin-bottom:12px">${esc(brief.summary)}</div>` : ''}
      ${list(brief.keep, 'KEEP', '#4ADE80')}${list(brief.avoid, 'AVOID', '#F87171')}${list(brief.hooks_from_comments, 'HOOKS FROM YOUR COMMENTS', '#C4B5FD')}
      <div id="mi-ideas" style="margin-top:12px">${ideas || '<div style="font-size:12px;color:rgba(255,255,255,.45)">No ideas returned.</div>'}</div>
    </div>`;
  }

  function insightsMainHtml(data) {
    if (!data) return '<div class="dash-loading" style="flex:1"><div class="dash-loading__spinner"></div></div>';
    const exportNote = '<div id="mi-export-note" style="font-size:11px;color:rgba(255,255,255,.4);margin-top:22px">Threads and WhatsApp Channel insights aren\'t available to apps yet — export them from Meta Business Suite.</div>';
    if (!data.connected) {
      return `<div style="padding:48px 32px;max-width:560px">
        <div style="font-size:22px;font-weight:650;letter-spacing:-.03em;margin-bottom:8px">Connect Instagram to read Meta Insights</div>
        <div id="mi-not-connected" style="color:rgba(255,255,255,.5);margin-bottom:18px">${esc(data.reason || 'Insights need a direct Instagram connection.')}</div>
        <button type="button" class="grow-cta-btn" id="analytics-connect-ig">Connect Instagram</button>
        ${exportNote}
      </div>`;
    }
    const sc = data.scorecard || {};
    const goal = sc.primary || data.goal || 'grow';
    const panel = (id, title, sub, items) => `<div id="mi-panel-${id}" style="margin-bottom:16px;${goal === id ? '' : 'opacity:.7'}">
      <div style="font-size:11px;letter-spacing:.08em;color:${goal === id ? '#fff' : 'rgba(255,255,255,.4)'};margin-bottom:8px">${title}${goal === id ? ' · THIS GOAL' : ''} <span style="letter-spacing:0;color:rgba(255,255,255,.35)">${sub}</span></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">${(items || []).map((it) => kpiTile(it, goal === id)).join('')}</div>
    </div>`;
    const reels = sc.reels_measured ? panel('reels', 'REELS', `${sc.reels_measured} measured`, sc.reels) : '';
    const pat = data.patterns || { keep: [], avoid: [] };
    const patHtml = (pat.keep.length || pat.avoid.length) ? `<div id="mi-patterns" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:6px 0 16px">
        <div><div style="font-size:10px;letter-spacing:.08em;color:#4ADE80;margin-bottom:4px">WORKING</div>${pat.keep.map((p) => `<div style="font-size:12px">• ${esc(patternText(p))}</div>`).join('') || '<div style="font-size:12px;color:rgba(255,255,255,.4)">No clear pattern yet</div>'}</div>
        <div><div style="font-size:10px;letter-spacing:.08em;color:#F87171;margin-bottom:4px">NOT WORKING</div>${pat.avoid.map((p) => `<div style="font-size:12px">• ${esc(patternText(p))}</div>`).join('') || '<div style="font-size:12px;color:rgba(255,255,255,.4)">Nothing flagged</div>'}</div>
      </div>` : '';
    const goalPill = (g, label) => `<button type="button" class="grow-pill${goal === g ? ' active' : ''}" data-mi-goal="${g}">${label}</button>`;
    return `<div id="mi-root" style="padding:28px 32px;flex:1;min-width:0">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px">
        <div>
          <div style="font-size:11px;letter-spacing:.08em;color:rgba(255,255,255,.4);margin-bottom:6px">META INSIGHTS · LAST ${esc(String(data.period || _period).toUpperCase())} · ${fmtNum(sc.posts_measured)} POSTS MEASURED</div>
          <div style="font-size:13px;color:rgba(255,255,255,.55)">Each post is scored 0–100 against this account's own posts, on the KPIs for the goal. Hover a metric for what it means.</div>
        </div>
        <div class="grow-pills" id="mi-goal-pills">${goalPill('grow', 'Grow')}${goalPill('engage', 'Engage')}</div>
      </div>
      ${trendHtml(data)}
      ${panel('grow', 'GROW', 'reach people who don\'t follow you', sc.grow)}
      ${panel('engage', 'ENGAGE', 'deepen it with followers', sc.engage)}
      ${reels}
      ${patHtml}
      ${verdictKeyHtml(data)}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div id="mi-winners"><div style="font-size:10px;letter-spacing:.08em;color:#4ADE80;margin-bottom:4px">WINNERS</div>${(data.winners || []).map((p) => insightPostRow(p, 'win')).join('') || '<div style="font-size:12px;color:rgba(255,255,255,.4)">Not enough posts yet.</div>'}</div>
        <div id="mi-losers"><div style="font-size:10px;letter-spacing:.08em;color:#F87171;margin-bottom:4px">LOSERS</div>${(data.losers || []).map((p) => insightPostRow(p, 'lose')).join('') || '<div style="font-size:12px;color:rgba(255,255,255,.4)">Not enough posts yet.</div>'}</div>
      </div>
      ${recentPostsHtml(data)}
      ${briefHtml(data.brief, data)}
      ${exportNote}
    </div>`;
  }

  function makeFromIdea(idea, where) {
    if (!idea) return;
    const prompt = [idea.hook, idea.angle].filter(Boolean).join('\n\n');
    if (where === 'animate') {
      if (idea.story_type) global.__SE_ANIM_STORY_PRESET = { story_type: idea.story_type };
      global.__SE_COACH_CREATE_SESSION = { destination: 'animate', prompt };
      if (typeof _deps.switchNav === 'function') _deps.switchNav('animation-studio');
    } else {
      global.__SE_COACH_CREATE_SESSION = { destination: 'design', mode: 'image', aspect_ratio: '4:5', prompt };
      if (typeof _deps.switchNav === 'function') _deps.switchNav('design-studio');
    }
  }

  async function generateBrief() {
    if (_briefBusy) return;
    _briefBusy = true;
    paintCard(_card);
    try {
      const res = await fetch(`${apiBase()}/api/meta-insights/next-week-brief`, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify({ goal: _insightsGoal }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.brief) throw new Error(out.error || 'Could not build next week');
      if (_insights) _insights.brief = out.brief;
      if (typeof _deps.toast === 'function') _deps.toast('Next week is ready. Coach and Reels will use it.', 'success');
    } catch (e) {
      if (typeof _deps.toast === 'function') _deps.toast(e.message, 'error');
    } finally {
      _briefBusy = false;
      paintCard(_card);
    }
  }

  function bindInsights(body) {
    body.querySelectorAll('[data-mi-goal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        _insightsGoal = btn.getAttribute('data-mi-goal');
        loadInsights();
      });
    });
    body.querySelectorAll('.mi-post').forEach((el) => {
      el.addEventListener('click', () => openPermalink(el.getAttribute('data-permalink')));
    });
    document.getElementById('mi-brief-btn')?.addEventListener('click', generateBrief);
    body.querySelectorAll('[data-mi-make]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idea = (_insights?.brief?.ideas || [])[Number(btn.getAttribute('data-mi-idea'))];
        makeFromIdea(idea, btn.getAttribute('data-mi-make'));
      });
    });
  }

  async function loadInsights(opts) {
    _insights = null;
    paintCard(_card);
    try {
      const q = `period=${encodeURIComponent(_period)}${_insightsGoal ? `&goal=${encodeURIComponent(_insightsGoal)}` : ''}${opts && opts.refresh ? '&refresh=1' : ''}`;
      const res = await fetch(`${apiBase()}/api/meta-insights?${q}`, { headers: authHeaders() });
      _insights = res.ok ? await res.json() : { connected: false, reason: 'Could not load Meta insights. Try Refresh.' };
    } catch (e) {
      _insights = { connected: false, reason: 'Could not load Meta insights. Try Refresh.' };
    }
    if (_book === 'insights') paintCard(_card);
  }

  function renderAnalyticsCockpit(data, deps) {
    _clientData = data || {};
    _deps = deps || {};
    _book = 'organic';
    _chartsOpen = false;
    _insights = null;
    _insightsGoal = '';
    const content = document.getElementById('dash-content');
    if (!content) return;
    if (_deps.isPaid === false) {
      content.innerHTML = _deps.upgradeHTML || '<p>Upgrade to unlock Analytics.</p>';
      return;
    }
    renderShell();
    loadCard();
  }

  global.renderAnalyticsCockpit = renderAnalyticsCockpit;
  global.seWarmAnalytics = warmAnalytics;
})(typeof window !== 'undefined' ? window : global);
