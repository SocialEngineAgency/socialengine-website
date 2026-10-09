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

  function renderShell() {
    const content = document.getElementById('dash-content');
    if (!content) return;
    const biz = (_clientData && _clientData.client && (_clientData.client.business_name || _clientData.client.contact_name)) || 'Your brand';
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

    body.innerHTML = `
      <aside style="width:160px;flex-shrink:0;border-right:1px solid rgba(255,255,255,.06);padding:20px 14px">
        <div style="font-size:10px;letter-spacing:.12em;color:rgba(255,255,255,.35);margin-bottom:12px">LENS</div>
        ${rail}
        <div style="font-size:10px;letter-spacing:.12em;color:rgba(255,255,255,.35);margin:22px 0 10px">LIVE</div>
        ${srcHtml}
      </aside>
      <main style="flex:1;min-width:0;display:flex">${main}</main>`;

    const toggle = document.getElementById('analytics-charts-toggle');
    if (toggle) {
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
    });
    if (typeof global.lucide !== 'undefined') global.lucide.createIcons();
  }

  async function loadCard(opts) {
    if (_book === 'insights') return loadInsights(opts);
    const body = document.getElementById('analytics-body');
    if (body && !_card) {
      body.innerHTML = '<div class="dash-loading" style="flex:1"><div class="dash-loading__spinner"></div></div>';
    }
    try {
      const res = await fetch(`${apiBase()}/api/analytics/scorecard?book=${encodeURIComponent(_book)}&period=${encodeURIComponent(_period)}`, {
        headers: authHeaders(),
      });
      _card = res.ok ? await res.json() : { empty: true, sources: [], rows: [], clientType: 'charity' };
    } catch (e) {
      _card = { empty: true, sources: [], rows: [], clientType: 'charity' };
    }
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

  function insightPostRow(p, tone) {
    const m = p.metrics || {};
    const color = tone === 'win' ? '#4ADE80' : '#F87171';
    const tags = [FORMAT_LABELS[p.format] || p.format, STORY_LABELS[p.story_type] || '', p.opener && p.opener !== 'statement' ? (OPENER_LABELS[p.opener] || p.opener).split(' (')[0] : '']
      .filter(Boolean).join(' · ');
    const stats = [`reach ${fmtNum(m.reach)}`, m.sends_per_reach != null ? `sends ${fmtMetric('sends_per_reach', m.sends_per_reach)}` : '', m.avg_watch_sec != null ? `watch ${m.avg_watch_sec}s` : '', m.comments != null ? `${fmtNum(m.comments)} comments` : '']
      .filter(Boolean).join(' · ');
    return `<div class="mi-post" data-permalink="${esc(p.permalink || '')}" style="display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06);cursor:${p.permalink ? 'pointer' : 'default'}">
      <div style="font-weight:700;color:${color};min-width:34px">${p.goal_score != null ? p.goal_score : '—'}</div>
      <div style="min-width:0">
        <div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.first_line || '(no caption)')}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.45)">${esc(tags)}${tags && stats ? ' · ' : ''}${esc(stats)}</div>
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
          <button type="button" class="grow-ghost-btn" style="width:auto" data-mi-make="animate" data-mi-idea="${i}">Make in Animate</button>
          <button type="button" class="grow-ghost-btn" style="width:auto" data-mi-make="design" data-mi-idea="${i}">Make in Design</button>
        </div>
      </div>`).join('');
    return `<div id="mi-brief" style="margin-top:22px;padding:16px;border:1px solid #243049;border-radius:12px;background:#0B1120">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px">
        <div><div style="font-weight:650">Next week (${esc(brief.week_start || '')}) · ${brief.goal === 'engage' ? 'Engage' : 'Grow'}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.4)">Built ${esc(String(brief.generated_at || '').slice(0, 10))} · Coach and Animate use this for 14 days</div></div>
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
      ${panel('grow', 'GROW', 'reach people who don\'t follow you', sc.grow)}
      ${panel('engage', 'ENGAGE', 'deepen it with followers', sc.engage)}
      ${reels}
      ${patHtml}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div id="mi-winners"><div style="font-size:10px;letter-spacing:.08em;color:#4ADE80;margin-bottom:4px">WINNERS</div>${(data.winners || []).map((p) => insightPostRow(p, 'win')).join('') || '<div style="font-size:12px;color:rgba(255,255,255,.4)">Not enough posts yet.</div>'}</div>
        <div id="mi-losers"><div style="font-size:10px;letter-spacing:.08em;color:#F87171;margin-bottom:4px">LOSERS</div>${(data.losers || []).map((p) => insightPostRow(p, 'lose')).join('') || '<div style="font-size:12px;color:rgba(255,255,255,.4)">Not enough posts yet.</div>'}</div>
      </div>
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
      if (typeof _deps.toast === 'function') _deps.toast('Next week is ready — Coach and Animate will use it.', 'success');
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
})(typeof window !== 'undefined' ? window : global);
