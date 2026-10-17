/* New look: the calendar's side panels (the day panel and the post detail panel).
   portal.html computes everything (which posts, which actions apply) and calls these
   builders for the markup when html.nl is on; the old look keeps its own markup.
   Every button keeps the same onclick handler as the old look. */
(function (global) {
  'use strict';

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // A value inside a single-quoted JS string inside a double-quoted onclick attribute.
  const js = (v) => String(v == null ? '' : v)
    .replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n').replace(/</g, '\\x3c')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  const ICON = {
    x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    back: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    out: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>',
    play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
    image: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-9 9"/></svg>',
    plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
    clock: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  };

  /** The platforms a post goes to, as small coloured dots plus a short label. */
  function platforms(p) {
    const raw = [
      ...(Array.isArray(p._platforms) ? p._platforms : []),
      ...(Array.isArray(p.platforms) ? p.platforms : [String(p.platforms || '')]),
      String(p.platform || ''),
    ].join(',').toLowerCase();
    const list = [];
    if (/instagram|\big\b/.test(raw)) list.push('Instagram');
    if (/facebook|\bfb\b/.test(raw)) list.push('Facebook');
    if (/tiktok/.test(raw)) list.push('TikTok');
    return list;
  }
  function platHtml(p) {
    const list = platforms(p);
    if (!list.length) return '<span class="nl-dpc__plat">Post</span>';
    return `<span class="nl-dpc__dots" aria-hidden="true">${list.map((x) => `<i data-p="${x.toLowerCase()}"></i>`).join('')}</span><span class="nl-dpc__plat">${list.length > 1 ? list.map((x) => (x === 'Instagram' ? 'IG' : x === 'Facebook' ? 'FB' : x)).join(' + ') : list[0]}</span>`;
  }

  function statusPill(p, isSocial) {
    if (isSocial) return '<span class="nl-pill nl-pill--live">Live</span>';
    const s = String(p.status || 'Scheduled');
    const kind = /error|fail/i.test(s) ? 'bad' : /publish(ed)?$|live/i.test(s) && !/publishing/i.test(s) ? 'live' : /publishing/i.test(s) ? 'busy' : /draft|pending|review/i.test(s) ? 'muted' : 'sched';
    const label = /publish_error/i.test(s) ? 'Failed' : kind === 'live' ? 'Live' : s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
    return `<span class="nl-pill nl-pill--${kind}">${esc(label)}</span>`;
  }

  function dayHead({ dateLabel, isPast, isToday, count, igCount, fbCount, hasSocial }) {
    const when = isPast ? 'Past' : isToday ? 'Today' : 'Upcoming';
    const bits = [count ? `${count} post${count === 1 ? '' : 's'}` : 'Nothing yet'];
    return `<div class="nl-dp">
      <header class="nl-dp__head">
        <div class="nl-dp__headtext">
          <div class="nl-dp__eyebrow nl-dp__eyebrow--${when.toLowerCase()}">${when}</div>
          <h2 class="nl-dp__title">${esc(dateLabel)}</h2>
          <div class="nl-dp__meta">${esc(bits.join(' · '))}</div>
        </div>
        <button type="button" class="nl-dp__x" onclick="closeDatePanel()" aria-label="Close">${ICON.x}</button>
      </header>`;
  }

  function dayActions() {
    return `<div class="nl-dp__dayacts">
        <button type="button" class="nl-dpb" onclick="_datePanelRepostAll()">Repost the best one</button>
        <button type="button" class="nl-dpb nl-dpb--ghost" onclick="_datePanelAnalyze()">Analyze the day</button>
      </div>
      <div id="day-analyze-area" class="nl-dp__insight"></div>`;
  }

  function section(title) {
    return `<h3 class="nl-dp__sec">${esc(title)}</h3>`;
  }

  function thumb({ idx, playUrl, thumbUrl, isVideo }) {
    const inner = playUrl
      ? `<video src="${esc(playUrl)}" muted preload="metadata" playsinline></video><span class="nl-dpc__badge">${ICON.play}</span>`
      : thumbUrl
        ? `<img src="${esc(thumbUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">${isVideo ? `<span class="nl-dpc__badge">${ICON.play}</span>` : ''}`
        : `<span class="nl-dpc__ph">${isVideo ? ICON.play : ICON.image}</span>`;
    return `<button type="button" class="nl-dpc__thumb" onclick="_datePanelView(${idx})" aria-label="Open this post">${inner}</button>`;
  }

  /** The time of day only; the panel header already carries the date. */
  function timeOf(label, stamp) {
    const m = String(label || '').match(/\b\d{1,2}:\d{2}\s*[AP]M\b/i);
    if (m) return m[0].toUpperCase();
    if (/^\d{1,2}:\d{2}$/.test(String(label || '').trim())) {
      const [h, mi] = String(label).trim().split(':').map(Number);
      return `${((h + 11) % 12) + 1}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    }
    if (stamp && /T\d{2}:\d{2}/.test(String(stamp))) {
      const d = new Date(stamp);
      if (!isNaN(d)) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    return '';
  }

  /** One post on the day: thumbnail, platform and time, caption, numbers, then what you can do. */
  function dayCard(o) {
    const { p, idx, dateStr, isSocial, caption, whenLabel, isVidCard, metrics, pubErr, canRetry, canPostFacebook, canPostInstagram, listedFb } = o;
    const id = js(p.id || '');
    const type = p.media_type || (isVidCard ? 'Video' : '');
    const sub = [type, timeOf(whenLabel, isSocial ? (p.timestamp || p.published_at || p.created_time) : '')].filter(Boolean).join(' · ');
    const notes = [];
    if (pubErr) notes.push(`<div class="nl-dpc__note nl-dpc__note--bad">${esc(pubErr)}</div>`);
    if (canPostFacebook && !listedFb) notes.push('<div class="nl-dpc__note">Went out on Instagram only. You can add it to Facebook below.</div>');
    if (canPostInstagram) notes.push('<div class="nl-dpc__note">Went out on Facebook only. You can add it to Instagram below; the Facebook post stays as it is.</div>');
    const nums = [['likes', 'like'], ['comments', 'comment'], ['views', 'view'], ['shares', 'share']]
      .filter(([k]) => Number(p[k]) > 0)
      .map(([k, one]) => { const n = Number(p[k]); return `<span><b>${esc(n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : n.toLocaleString())}</b> ${n === 1 ? one : k}</span>`; });
    const stats = nums.length
      ? `<div class="nl-dpc__stats">${nums.join('')}</div>`
      : metrics.length ? `<div class="nl-dpc__stats">${metrics.map((m) => `<span>${esc(m)}</span>`).join('')}</div>`
        : isSocial ? '<div class="nl-dpc__stats nl-dpc__stats--none">No engagement yet</div>' : '';
    let acts = '';
    if (isSocial) {
      acts = `<div class="nl-dpc__acts">
          <button type="button" class="nl-dpb nl-dpb--primary" onclick="_datePanelRepost(${idx})">Repost</button>
          <button type="button" class="nl-dpb nl-dpb--ghost" id="remix-btn-${idx}" onclick="_datePanelRemix(${idx})">Remix</button>
          <button type="button" class="nl-dpb nl-dpb--ghost" onclick="_datePanelPromote(${idx})">Promote</button>
        </div>`;
    } else {
      const tryLabel = /publish_error/i.test(String(p.status || '')) ? 'Try again' : 'Publish now';
      const main = [
        canRetry ? `<button type="button" class="nl-dpb nl-dpb--primary" onclick="_retryPublishPost('${id}', '${js(dateStr)}')">${tryLabel}</button>` : '',
        canPostFacebook ? `<button type="button" class="nl-dpb" onclick="_retryPublishPost('${id}', '${js(dateStr)}', 'Facebook')"><i class="nl-dpb__dot" data-p="facebook"></i>Post to Facebook</button>` : '',
        canPostInstagram ? `<button type="button" class="nl-dpb" onclick="_retryPublishPost('${id}', '${js(dateStr)}', 'Instagram')"><i class="nl-dpb__dot" data-p="instagram"></i>Post to Instagram</button>` : '',
        `<button type="button" class="nl-dpb nl-dpb--ghost" onclick="_datePanelView(${idx})">Open post</button>`,
      ].filter(Boolean).join('');
      acts = `<div class="nl-dpc__acts">${main}<button type="button" class="nl-dpb nl-dpb--ghost nl-dpb--icon" onclick="_deleteCalPost('${id}',{returnDate:'${js(dateStr)}'})" aria-label="Delete this post" title="Delete this post">${ICON.trash}</button></div>`;
    }
    const del = isSocial
      ? `_deleteSocialPost('${id}', '${js(p.platform || (p._platforms || []).join('+') || '')}', {returnDate:'${js(dateStr)}', twinId:'${js(p._twinId || '')}', permalink:'${js(p.permalink || '')}'})`
      : `_deleteCalPost('${id}',{returnDate:'${js(dateStr)}'})`;
    const links = isSocial ? `<div class="nl-dpc__links">
        <button type="button" class="nl-dpl" onclick="_datePanelWhy(${idx})">Why it worked</button>
        ${p.permalink ? `<a class="nl-dpl" href="${esc(p.permalink)}" target="_blank" rel="noopener">Open on ${esc(platforms(p)[0] || 'social')} ${ICON.out}</a>` : ''}
        <button type="button" class="nl-dpl nl-dpl--bad" onclick="${del}">Delete</button>
      </div>` : '';
    return `<article class="nl-dpc">
        <div class="nl-dpc__top">
          ${thumb({ idx, playUrl: o.playUrl, thumbUrl: o.thumbUrl, isVideo: isVidCard })}
          <div class="nl-dpc__body">
            <div class="nl-dpc__line">${platHtml(p)}${sub ? `<span class="nl-dpc__sub">${esc(sub)}</span>` : ''}${statusPill(p, isSocial)}</div>
            ${caption ? `<p class="nl-dpc__cap" onclick="_datePanelView(${idx})" title="Open this post">${esc(caption)}</p>` : `<p class="nl-dpc__cap nl-dpc__cap--none">${isVidCard ? 'Video' : 'Post'} with no caption</p>`}
            ${stats}
          </div>
        </div>
        ${notes.join('')}
        ${acts}
        ${links}
        <div id="day-post-insight-${idx}" class="nl-dp__insight" style="display:none;"></div>
      </article>`;
  }

  function batchCard({ p, dateStr, caption, thumbUrl, st }) {
    const i = Number(p._batchIdx);
    const scheduled = st === 'Scheduled';
    return `<article class="nl-dpc nl-dpc--batch">
        <div class="nl-dpc__top">
          <button type="button" class="nl-dpc__thumb" onclick="_batchFocusFromDayPanel(${i})" aria-label="Edit in the batch queue">${p.video_url ? `<video src="${esc(p.video_url)}" muted preload="metadata" playsinline></video><span class="nl-dpc__badge">${ICON.play}</span>` : thumbUrl ? `<img src="${esc(thumbUrl)}" alt="" onerror="this.remove()">` : `<span class="nl-dpc__ph">${ICON.image}</span>`}</button>
          <div class="nl-dpc__body">
            <div class="nl-dpc__line"><span class="nl-dpc__plat">From your batch</span><span class="nl-dpc__sub">${esc(p.scheduled_time || '09:00')}</span><span class="nl-pill nl-pill--${scheduled ? 'sched' : 'muted'}">${esc(st)}</span></div>
            <div class="nl-dpc__file">${esc(p._fileName || 'Upload')}</div>
            ${caption ? `<p class="nl-dpc__cap">${esc(caption)}</p>` : '<p class="nl-dpc__cap nl-dpc__cap--none">No caption yet</p>'}
          </div>
        </div>
        <div class="nl-dpc__acts">
          ${scheduled
            ? `<button type="button" class="nl-dpb nl-dpb--primary" onclick="_batchPublishNowFromDay(${i},'${js(dateStr)}')">Publish now</button>`
            : `<button type="button" class="nl-dpb nl-dpb--primary" onclick="_batchScheduleOne(${i});setTimeout(()=>openDatePanel('${js(dateStr)}'),800);">Schedule</button>`}
          <button type="button" class="nl-dpb nl-dpb--ghost" onclick="_batchFocusFromDayPanel(${i})">Edit in queue</button>
        </div>
      </article>`;
  }

  function empty(isPast) {
    if (!isPast) return ''; // the header already says "Nothing yet" and the scheduler sits right below
    return `<div class="nl-dp__empty">
        <div class="nl-dp__emptyt">Nothing on this day</div>
        <div class="nl-dp__emptys">No published posts found for this date.</div>
      </div>`;
  }

  function ready(list, dateStr) {
    return `<section class="nl-dp__block">${section(`Ready to schedule · ${list.length}`)}
        <div class="nl-dpr">${list.slice(0, 8).map((p, idx) => {
          const cap = String(p.caption || p.full_post_text || p.title || 'Untitled').replace(/\s+/g, ' ').slice(0, 80);
          const pending = String(global._pendingOpenPostId || '') === String(p.id || '');
          return `<div class="nl-dpr__row${pending ? ' nl-dpr__row--on' : ''}"><span class="nl-dpr__cap">${esc(cap)}</span><button type="button" class="nl-dpb nl-dpb--sm" onclick="schedulePostToDate('${js(dateStr)}',${idx})">${ICON.plus}Add to this day</button></div>`;
        }).join('')}</div>
      </section>`;
  }

  /** The quick scheduler. Ids and the submitQuickSchedule call stay as they were. */
  function schedule({ dateStr, rec, dayOfWeek, time24 }) {
    return `<section class="nl-dp__block nl-dps">
        ${section('Schedule for this day')}
        <div class="nl-dps__tip">${ICON.clock}Best time on ${esc(dayOfWeek)}s: <b>${esc(rec)}</b></div>
        <textarea id="quick-schedule-caption" rows="4" placeholder="Write the caption…" aria-label="Caption"></textarea>
        <label class="nl-dps__file">
          <input type="file" id="quick-schedule-file" accept="image/*,video/*" class="nl-sr" onchange="(function(i){var n=i.closest('.nl-dps__file');n.querySelector('.nl-dps__fname').textContent=i.files&&i.files[0]?i.files[0].name:'';n.classList.toggle('nl-dps__file--set',!!(i.files&&i.files[0]));})(this)">
          <span class="nl-dps__fbtn">${ICON.image}<span>Add photo or video</span></span>
          <span class="nl-dps__fname"></span>
        </label>
        <div class="nl-dps__hint">A post needs a photo or video. Repost keeps the original media.</div>
        <div class="nl-dps__row">
          <input type="time" id="quick-schedule-time" value="${esc(time24)}" aria-label="Time">
          <button type="button" class="nl-dpb nl-dpb--primary nl-dpb--wide" onclick="submitQuickSchedule('${js(dateStr)}')">Schedule post</button>
        </div>
      </section>`;
  }

  function close() { return '</div>'; }

  /* Post detail panel (#cal-panel) */
  function detailHead({ returnDate, eyebrow, title }) {
    return `<div class="nl-dp nl-dp--detail">
      <header class="nl-dp__head">
        ${returnDate ? `<button type="button" class="nl-dp__back" onclick="_backToDatePanel()" aria-label="Back to the day">${ICON.back}</button>` : ''}
        <div class="nl-dp__headtext">
          <div class="nl-dp__eyebrow">${esc(eyebrow)}</div>
          <h2 class="nl-dp__title nl-dp__title--sm">${esc(title)}</h2>
        </div>
        <button type="button" class="nl-dp__x" onclick="_closeCalPanel()" aria-label="Close">${ICON.x}</button>
      </header>`;
  }

  function media({ videoUrl, imageUrl }) {
    if (videoUrl) return `<div class="nl-dpd__media"><video src="${esc(videoUrl)}" controls playsinline preload="metadata"></video></div>`;
    if (imageUrl) return `<div class="nl-dpd__media"><img src="${esc(imageUrl)}" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></div>`;
    return '<div class="nl-dpd__media nl-dpd__media--none">No preview</div>';
  }

  function postPanel({ postId, returnDate, status, statusLabel, platformText, formatLabel, dateLabel, caption, videoUrl, imageUrl }) {
    const id = js(postId);
    const publishing = /^publishing$/i.test(String(status || ''));
    const canPublish = /^(approved|scheduled|publish_error)$/i.test(String(status || ''));
    const p = { platform: platformText, status };
    return `${detailHead({ returnDate, eyebrow: 'Post', title: dateLabel || 'Not scheduled' })}
      ${media({ videoUrl, imageUrl })}
      <div class="nl-dpd__tags">${statusPill({ status: statusLabel || status }, false)}<span class="nl-dpd__plat">${platHtml(p)}</span>${formatLabel ? `<span class="nl-dpd__fmt">${esc(formatLabel)}</span>` : ''}</div>
      <section class="nl-dp__block">${section('Caption')}<div class="nl-dpd__cap">${caption ? esc(caption) : '<span class="nl-dpd__none">No caption</span>'}</div></section>
      ${publishing ? '<div class="nl-dpc__note">Publishing now. Refresh in a minute.</div>' : ''}
      <div class="nl-dpd__acts">
        ${canPublish ? `<button type="button" class="nl-dpb nl-dpb--primary nl-dpb--wide" onclick="_retryPublishPost('${id}')">${/publish_error/i.test(String(status)) ? 'Try again' : 'Publish now'}</button>` : ''}
        <button type="button" class="nl-dpl nl-dpl--bad" onclick="_deleteCalPost('${id}')">Delete post</button>
      </div>
    </div>`;
  }

  function socialPanel({ post, platLabel, dateLabel, returnDate }) {
    const id = js(post.id || '');
    const stat = (n, label) => (n != null && !(label === 'Shares' && !(Number(n) > 0))
      ? `<div class="nl-dpd__stat"><b>${Number(n).toLocaleString()}</b><span>${label}</span></div>` : '');
    const stats = [stat(post.likes, 'Likes'), stat(post.comments, 'Comments'), stat(post.shares, 'Shares'), stat(post.views, 'Views')].filter(Boolean).join('');
    const thumbUrl = post.thumbnail_url || '';
    return `${detailHead({ returnDate, eyebrow: `${platLabel} · ${post.media_type || 'Post'}`, title: dateLabel })}
      ${thumbUrl ? media({ imageUrl: thumbUrl }) : ''}
      ${stats ? `<div class="nl-dpd__stats">${stats}</div>` : ''}
      ${post.caption ? `<section class="nl-dp__block">${section('Caption')}<div class="nl-dpd__cap">${esc(post.caption)}</div></section>` : ''}
      <div class="nl-dpd__acts">
        <button type="button" class="nl-dpb nl-dpb--primary nl-dpb--wide" onclick="_repostSocialPost('${id}')">Repost</button>
        <div class="nl-dpc__acts nl-dpc__acts--three">
          <button type="button" class="nl-dpb nl-dpb--ghost" id="cal-remix-btn" onclick="_calPanelRemix('${id}')">Remix</button>
          <button type="button" class="nl-dpb nl-dpb--ghost" onclick="_calPanelPromote('${id}')">Promote</button>
          <button type="button" class="nl-dpb nl-dpb--ghost" onclick="_calPanelWhy('${id}')">Why it worked</button>
        </div>
        <div id="cal-post-insight" class="nl-dp__insight" style="display:none;"></div>
        <div class="nl-dpc__links">
          ${post.permalink ? `<a class="nl-dpl" href="${esc(post.permalink)}" target="_blank" rel="noopener">Open on ${esc(platLabel)} ${ICON.out}</a>` : ''}
          <button type="button" class="nl-dpl nl-dpl--bad" onclick="_deleteSocialPost('${id}', '${js(post.platform || platLabel)}', {returnDate:'${js(returnDate || '')}', twinId:'${js(post._twinId || '')}', permalink:'${js(post.permalink || '')}'})">Delete from ${esc(platLabel)}${post._twinId ? ' and Instagram' : ''}</button>
        </div>
      </div>
    </div>`;
  }

  global.seNlCal = {
    on: () => document.documentElement.classList.contains('nl'),
    dayHead, dayActions, section, dayCard, batchCard, empty, ready, schedule, close, postPanel, socialPanel,
  };
})(window);
