/* Key dates on the Calendar: public holidays + awareness and shopping days that fit
   the client kind. Strip above the calendar, a badge on each matching day, and
   "Post ideas" that hand a brief to Create. */
(function (global) {
  'use strict';

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const toast = (msg, kind) => { if (typeof global.showToast === 'function') global.showToast(msg, kind); };
  const TYPE_ICON = { holiday: '🎉', awareness: '💡', shopping: '🛍️' };
  let _data = null;
  let _loading = null;

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

  function niceDate(iso) {
    const d = new Date(`${iso}T12:00:00Z`);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  function injectStyles() {
    if (document.getElementById('kd-styles')) return;
    const st = document.createElement('style');
    st.id = 'kd-styles';
    st.textContent = `
      .kd-strip { margin: 0 0 16px; padding: 12px 14px; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; background: rgba(255,255,255,0.015); }
      .kd-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
      .kd-title { font-size: 0.78rem; font-weight: 700; color: #E2E8F0; }
      .kd-sub { font-size: 0.7rem; color: rgba(148,163,184,0.75); }
      .kd-country { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 0.7rem; color: rgba(148,163,184,0.85); }
      .kd-country select { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; color: #fff; padding: 4px 6px; font-size: 0.72rem; font-family: inherit; }
      .kd-country select option { background: #0f1a2e; }
      .kd-list { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; }
      .kd-chip { flex: none; display: flex; flex-direction: column; gap: 2px; min-width: 150px; max-width: 220px; padding: 8px 10px; border-radius: 9px; border: 1px solid rgba(167,139,250,0.22); background: rgba(124,58,237,0.07); color: #E9D5FF; cursor: pointer; text-align: left; font-family: inherit; width: auto; }
      .kd-chip:hover { border-color: rgba(167,139,250,0.5); }
      .kd-chip b { font-size: 0.74rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .kd-chip span { font-size: 0.66rem; color: rgba(196,181,253,0.8); }
      .kd-badge { display: block; margin: -2px 0 3px; padding: 1px 5px; border-radius: 4px; background: rgba(250,204,21,0.10); color: #FDE68A; font-size: 0.58rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; border: none; width: 100%; text-align: left; font-family: inherit; }
      .kd-overlay { position: fixed; inset: 0; z-index: 10001; background: rgba(0,0,0,0.7); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; padding: 16px; }
      .kd-modal { background: linear-gradient(135deg,#0f1a2e,#162237); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; width: min(560px,100%); max-height: 90vh; overflow: auto; padding: 22px; color: #E2E8F0; font-family: var(--font-body, Inter, sans-serif); }
      .kd-modal h3 { margin: 0 0 2px; font-size: 1.05rem; color: #fff; }
      .kd-x { float: right; background: none; border: none; color: rgba(148,163,184,0.7); font-size: 1.3rem; cursor: pointer; width: auto; }
      .kd-angle { font-size: 0.76rem; color: rgba(148,163,184,0.9); margin: 6px 0 14px; line-height: 1.5; }
      .kd-idea { border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 12px; margin-bottom: 10px; background: rgba(255,255,255,0.02); }
      .kd-idea h4 { margin: 0 0 4px; font-size: 0.86rem; color: #fff; }
      .kd-idea p { margin: 0 0 8px; font-size: 0.76rem; color: rgba(226,232,240,0.8); line-height: 1.45; }
      .kd-btn { padding: 7px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: transparent; color: #E2E8F0; font-size: 0.74rem; font-weight: 600; cursor: pointer; font-family: inherit; width: auto; }
      .kd-btn--primary { background: linear-gradient(135deg,#7C3AED,#6D28D9); border: none; color: #fff; }
      .kd-hint { font-size: 0.72rem; color: rgba(148,163,184,0.75); }
    `;
    document.head.appendChild(st);
  }

  function load(force) {
    if (_loading && !force) return _loading;
    _loading = api('/api/marketing/key-dates?days=60')
      .then((d) => { _data = d; return d; })
      .catch((e) => { _loading = null; throw e; });
    return _loading;
  }

  function byDate() {
    const m = {};
    for (const d of (_data && _data.dates) || []) (m[d.date] = m[d.date] || []).push(d);
    return m;
  }

  function renderStrip() {
    const host = document.getElementById('key-dates-strip');
    if (!host || !_data) return;
    const d = _data;
    const opts = (d.countries || []).map((c) => `<option value="${esc(c.code)}" ${c.code === d.country ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    host.innerHTML = `<div class="kd-strip">
      <div class="kd-head"><span class="kd-title">Key dates, next 60 days</span>
        <span class="kd-sub">${d.country_known ? 'Holidays and days worth a post for your kind of business.' : 'Pick your country to add public holidays.'}</span>
        <label class="kd-country">Country <select id="kd-country"><option value="">${d.country_known ? 'Not set' : 'Choose…'}</option>${opts}</select></label></div>
      <div class="kd-list">${d.dates.length ? d.dates.map((x, i) => `<button type="button" class="kd-chip" data-kd="${i}"><b>${TYPE_ICON[x.type] || ''} ${esc(x.name)}</b><span>${esc(niceDate(x.date))} · Post ideas</span></button>`).join('') : '<span class="kd-hint">Nothing coming up in the next 60 days.</span>'}</div>
    </div>`;
    host.querySelectorAll('[data-kd]').forEach((b) => b.addEventListener('click', () => openIdeas(d.dates[Number(b.dataset.kd)])));
    host.querySelector('#kd-country').addEventListener('change', async (e) => {
      try {
        await api('/api/marketing/key-dates/country', { method: 'PUT', body: JSON.stringify({ country: e.target.value }) });
        await load(true);
        renderStrip();
        badgeCalendar();
        toast('Country saved');
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  function badgeCalendar() {
    const wrap = document.getElementById('sched-cal-wrap');
    if (!wrap || !_data) return;
    const map = byDate();
    wrap.querySelectorAll('[data-bq-drop-day]').forEach((cell) => {
      const list = map[cell.getAttribute('data-bq-drop-day')];
      const old = cell.querySelector('.kd-badge');
      if (!list) { if (old) old.remove(); return; }
      if (old) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'kd-badge';
      b.textContent = `${TYPE_ICON[list[0].type] || ''} ${list.map((x) => x.name).join(', ')}`;
      b.title = `${list.map((x) => x.name).join(', ')}: click for post ideas`;
      b.addEventListener('click', (e) => { e.stopPropagation(); openIdeas(list[0]); });
      const dayNum = cell.firstElementChild;
      if (dayNum) dayNum.insertAdjacentElement('afterend', b);
      else cell.prepend(b);
    });
  }

  function openIdeas(day) {
    injectStyles();
    const ov = document.createElement('div');
    ov.className = 'kd-overlay';
    ov.innerHTML = `<div class="kd-modal" role="dialog" aria-label="Post ideas">
      <button type="button" class="kd-x" aria-label="Close">×</button>
      <h3>${TYPE_ICON[day.type] || ''} ${esc(day.name)}</h3>
      <div class="kd-hint">${esc(niceDate(day.date))}</div>
      <p class="kd-angle">${esc(day.angle || '')}</p>
      <div id="kd-ideas"><div class="kd-hint">Writing ideas…</div></div>
    </div>`;
    const close = () => ov.remove();
    ov.querySelector('.kd-x').addEventListener('click', close);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    const box = ov.querySelector('#kd-ideas');
    api('/api/marketing/key-dates/ideas', { method: 'POST', body: JSON.stringify({ date: day.date, name: day.name }) })
      .then((r) => {
        box.innerHTML = r.ideas.map((i, n) => `<div class="kd-idea"><h4>${esc(i.hook)}</h4><p>${esc(i.brief)}</p>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><button type="button" class="kd-btn kd-btn--primary" data-kd-make="${n}">Make this in Create</button><span class="kd-hint">Post on ${esc(niceDate(i.post_on))}</span></div></div>`).join('');
        box.querySelectorAll('[data-kd-make]').forEach((b) => b.addEventListener('click', () => {
          const i = r.ideas[Number(b.dataset.kdMake)];
          global.__SE_COACH_CREATE_SESSION = { destination: 'design', mode: 'image', aspect_ratio: '4:5', prompt: `${i.hook}\n\n${i.brief}\n\nFor ${day.name} (${day.date}). Post on ${i.post_on}.` };
          close();
          if (typeof global.switchNav === 'function') global.switchNav('design-studio');
        }));
      })
      .catch((e) => { box.innerHTML = `<div class="kd-hint" style="color:#FCD34D">${esc(e.message)}</div>`; });
  }

  function mount() {
    const col = document.getElementById('sched-cal-wrap');
    if (!col || document.getElementById('key-dates-strip')) return;
    injectStyles();
    const host = document.createElement('div');
    host.id = 'key-dates-strip';
    col.parentNode.insertBefore(host, col.parentNode.firstChild);
    load(true).then(() => { renderStrip(); badgeCalendar(); }).catch(() => { host.remove(); });
  }

  global.seKeyDates = { openIdeas, reload: () => load(true).then(() => { renderStrip(); badgeCalendar(); }) };

  function boot() {
    let pending = null;
    new MutationObserver(() => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; mount(); badgeCalendar(); }, 150);
    }).observe(document.body, { childList: true, subtree: true });
    mount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
