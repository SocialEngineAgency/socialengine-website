/* Live updates for the portal (Server-Sent Events from the API).
 *
 * window.seLive.start({ api, getTicket, onPost, onClient, onResync, onLogout })
 *   api       API origin, e.g. https://api.example.com
 *   getTicket async () => '/api/events?ticket=…' (or null to give up)
 *   onPost    (ids[]) posts that changed, batched over ~0.4 s
 *   onClient  (fields[]) account fields that changed, batched over ~1.5 s
 *   onResync  () after a gap of 20 s+ without a connection (events may be missed)
 *   onLogout  () the server ended the session
 * window.seLive.stop()
 *
 * The stream only carries hints ("post X changed"). Reads go through the
 * normal authenticated endpoints. A ticket is single use, so every reconnect
 * asks for a new one; the browser's own EventSource retry is not used.
 */
(function () {
  'use strict';
  var BACKOFF = [1000, 2000, 5000, 10000, 30000];
  var HIDDEN_CLOSE_MS = 10 * 60 * 1000;
  var RESYNC_GAP_MS = 20000;

  var opts = null;
  var es = null;
  var attempt = 0;
  var retryTimer = null;
  var hiddenTimer = null;
  var gapSince = null;
  var paused = false;
  var postIds = new Set();
  var postTimer = null;
  var clientFields = new Set();
  var clientTimer = null;
  var running = false;

  function safe(fn, arg) { try { if (typeof fn === 'function') fn(arg); } catch (e) { /* a handler must never break the stream */ } }

  function closeStream() {
    if (es) { try { es.close(); } catch (e) { /* closed */ } es = null; }
  }

  function scheduleReconnect(delay) {
    if (!running || paused) return;
    clearTimeout(retryTimer);
    var wait = delay != null ? delay : BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
    attempt += 1;
    retryTimer = setTimeout(connect, wait);
  }

  function parse(e) { try { return JSON.parse(e.data || '{}'); } catch (x) { return {}; } }

  async function connect() {
    if (!running || paused || es) return;
    if (typeof EventSource === 'undefined') return;
    var path;
    try {
      path = await opts.getTicket();
    } catch (e) {
      // Network or server trouble: try again later.
      if (gapSince == null) gapSince = Date.now();
      return scheduleReconnect();
    }
    if (!path) { stop(); return; } // live updates not available here: stay off
    if (!running || paused) return;
    var src;
    try { src = new EventSource(opts.api + path); } catch (e) { return scheduleReconnect(); }
    es = src;
    src.addEventListener('ready', function () {
      attempt = 0;
      if (gapSince != null && Date.now() - gapSince > RESYNC_GAP_MS) safe(opts.onResync);
      gapSince = null;
    });
    src.addEventListener('post', function (e) {
      var d = parse(e);
      if (!d.id) return;
      postIds.add(String(d.id));
      clearTimeout(postTimer);
      postTimer = setTimeout(function () {
        var ids = Array.from(postIds); postIds.clear();
        if (ids.length) safe(opts.onPost, ids);
      }, 400);
    });
    src.addEventListener('client', function (e) {
      var d = parse(e);
      (d.fields || []).forEach(function (f) { clientFields.add(String(f)); });
      clearTimeout(clientTimer);
      clientTimer = setTimeout(function () {
        var fields = Array.from(clientFields); clientFields.clear();
        safe(opts.onClient, fields);
      }, 1500);
    });
    src.addEventListener('logout', function () { stop(); safe(opts.onLogout); });
    src.addEventListener('reconnect', function () {
      // The server is restarting (a deploy): come back shortly, spread out.
      if (es === src) closeStream();
      if (gapSince == null) gapSince = Date.now();
      scheduleReconnect(500 + Math.floor(Math.random() * 2500));
    });
    src.onerror = function () {
      if (es !== src) return;
      closeStream();
      if (gapSince == null) gapSince = Date.now();
      scheduleReconnect();
    };
  }

  function onVisibility() {
    if (!running) return;
    if (document.hidden) {
      clearTimeout(hiddenTimer);
      hiddenTimer = setTimeout(function () {
        paused = true;
        clearTimeout(retryTimer);
        closeStream();
        if (gapSince == null) gapSince = Date.now();
      }, HIDDEN_CLOSE_MS);
    } else {
      clearTimeout(hiddenTimer);
      if (paused) { paused = false; attempt = 0; connect(); }
    }
  }

  function start(o) {
    stop();
    if (!o || typeof o.getTicket !== 'function' || typeof EventSource === 'undefined') return false;
    opts = o;
    running = true;
    paused = false;
    attempt = 0;
    gapSince = null;
    document.addEventListener('visibilitychange', onVisibility);
    connect();
    return true;
  }

  function stop() {
    running = false;
    clearTimeout(retryTimer); clearTimeout(hiddenTimer); clearTimeout(postTimer); clearTimeout(clientTimer);
    postIds.clear(); clientFields.clear();
    closeStream();
    document.removeEventListener('visibilitychange', onVisibility);
  }

  window.seLive = { start: start, stop: stop, get connected() { return !!es && es.readyState === 1; } };
})();
