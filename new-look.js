/* New look (graphite redesign), part 2 of 2. new-look.css owns tokens, fonts and the shell.
 * The portal also paints thousands of colours straight into inline styles and older style
 * blocks (navy panels, white-alpha text, purple tints). This file maps those colours to the
 * new palette as they appear, so every page follows the look without being rewritten:
 *   dark navy surfaces → graphite        slate greys → warm greys
 *   purple tints → neutral tints         solid purples → the one signal violet
 * and for Day, the same values flipped onto light surfaces with dark text.
 *
 * Default on. Off: ?look=old or the account menu (remembered in this browser). On again: ?look=new
 * Theme: the sun/moon button in the top bar (remembered).
 */
(function () {
  'use strict';
  var html = document.documentElement;
  var LOOK_KEY = 'se-look2';
  var THEME_KEY = 'se-nl-theme';

  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {} }
  function read(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }

  window.seNewLook = {
    on: function () { store(LOOK_KEY, 'new'); location.reload(); },
    off: function () { store(LOOK_KEY, 'old'); var u = new URL(location.href); u.searchParams.delete('look'); location.replace(u.toString()); },
  };
  if (!html.classList.contains('nl')) return;

  // ── Colour maths ──
  var NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1] };
  var COLOR_RE = /rgba?\(\s*[\d.]+%?\s*[,\s]\s*[\d.]+%?\s*[,\s]\s*[\d.]+%?\s*(?:[,/]\s*[\d.]+%?\s*)?\)|#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|\bwhite\b|\bblack\b/g;

  function parse(tok) {
    if (NAMED[tok]) return NAMED[tok].slice();
    if (tok[0] === '#') {
      var h = tok.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), a];
    }
    var parts = tok.replace(/rgba?\(|\)/g, '').split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    var ch = function (x) { return /%$/.test(x) ? parseFloat(x) * 2.55 : parseFloat(x); };
    var alpha = 1;
    if (parts.length > 3) alpha = /%$/.test(parts[3]) ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    return [ch(parts[0]), ch(parts[1]), ch(parts[2]), alpha];
  }
  function fmt(r, g, b, a) {
    var c = function (v) { return Math.max(0, Math.min(255, Math.round(v))); };
    a = Math.round(Math.max(0, Math.min(1, a)) * 1000) / 1000;
    return a >= 1 ? 'rgb(' + c(r) + ', ' + c(g) + ', ' + c(b) + ')' : 'rgba(' + c(r) + ', ' + c(g) + ', ' + c(b) + ', ' + a + ')';
  }
  function hsl(r, g, b) {
    var max = Math.max(r, g, b) / 255; var min = Math.min(r, g, b) / 255; var l = (max + min) / 2; var d = max - min;
    var s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)); var h = 0;
    if (d) {
      var R = r / 255; var G = g / 255; var B = b / 255;
      h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, s, l];
  }
  var luma = function (r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

  /**
   * One colour → the new palette. kind: 'text' | 'fill' (backgrounds, borders, shadows, svg).
   * keepText: a text colour sitting on a solid accent (a button label) stays as it is.
   */
  function mapColor(rgba, kind, day, keepText) {
    var r = rgba[0]; var g = rgba[1]; var b = rgba[2]; var a = rgba[3];
    if (a === 0) return null;
    var H = hsl(r, g, b); var h = H[0]; var s = H[1]; var l = H[2];
    var v = luma(r, g, b);
    var accent = s > 0.32 && l > 0.3 && l < 0.97 && (h >= 228 && h <= 305);
    var cyan = s > 0.45 && l > 0.3 && h >= 172 && h <= 200;

    if (accent || cyan) {
      if (a < 0.5) {
        // Purple washes and outlines become neutral; purple is kept for things that matter.
        return day ? fmt(27, 26, 23, Math.min(0.14, a * 0.55)) : fmt(255, 255, 255, Math.min(0.12, a * 0.6));
      }
      if (day) return kind === 'fill' && l > 0.86 ? fmt(236, 232, 255, a) : fmt(91, 71, 214, a);
      if (l > 0.82) return fmt(214, 207, 255, a);
      if (l > 0.68) return fmt(184, 172, 255, a);
      return fmt(157, 140, 255, a);
    }
    if (kind === 'text' && keepText) return null;

    // Black washes: shadows, insets, scrims.
    if (v < 8) {
      if (a >= 0.5 || !day) return null;
      return fmt(27, 26, 23, a * 0.3);
    }

    // Navy, slate and deep purple panels count as surfaces; dark reds and greens keep their meaning.
    var surfaceHue = (h >= 195 && h <= 305);
    if (s < 0.38 || (v < 70 && surfaceHue)) {
      if (v < 70) {
        // Dark surfaces (navy, slate-900): graphite, or warm paper in Day.
        if (day) {
          var p = Math.min(255, 242 + Math.max(0, v - 10) * 0.42);
          return fmt(p, p - 1, p - 5, a);
        }
        return fmt(v * 0.93, v * 0.98, v * 1.1 + 2, a);
      }
      // Greys and whites: warm them; in Day, flip them to ink.
      if (day) {
        var ink = Math.max(24, Math.min(200, 85 + (160 - v) * 0.787));
        if (r > 250 && g > 250 && b > 250 && a < 0.35) return fmt(27, 26, 23, a);
        return fmt(ink + 1, ink, ink - 4, a);
      }
      if (r > 250 && g > 250 && b > 250) return a >= 0.3 ? fmt(232, 230, 225, a) : null;
      return fmt(v + 3, v + 1, v - 4, a);
    }

    // Dark coloured panels (deep red, green, amber) become light tints of the same hue in Day.
    if (day && kind === 'fill' && v < 110 && a > 0.3) {
      var t = 0.84;
      return fmt(r * (1 - t) + 250 * t, g * (1 - t) + 249 * t, b * (1 - t) + 246 * t, a);
    }
    // Status colours stay; in Day the light ones get darker so they read on paper.
    if (day && kind === 'text' && l > 0.62) return fmt(r * 0.58, g * 0.58, b * 0.58, a);
    return null;
  }

  function mapValue(value, kind, day, keepText) {
    if (!value || value.indexOf('var(') !== -1 && !/#|rgb/.test(value)) return value;
    var changed = false;
    var out = value.replace(COLOR_RE, function (tok) {
      var c = parse(tok.toLowerCase());
      if (!c) return tok;
      var m = mapColor(c, kind, day, keepText);
      if (m == null) return tok;
      changed = true;
      return m;
    });
    return changed ? out : value;
  }

  function mapFont(value) {
    var out = value
      .replace(/(['"]?)Plus Jakarta Sans\1/g, "'Figtree'")
      .replace(/(['"]?)\bInter\b\1/g, "'Instrument Sans'")
      .replace(/(['"]?)Space Grotesk\1/g, "'Figtree'");
    return out;
  }

  var TEXT_PROPS = { color: 1, 'caret-color': 1, '-webkit-text-fill-color': 1, 'text-decoration-color': 1 };
  function isColorProp(p) {
    return TEXT_PROPS[p] || /^(background-color|background-image|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?-color|outline-color|box-shadow|text-shadow|fill|stroke|stop-color|column-rule-color|accent-color)$/.test(p);
  }
  function solidAccentBehind(style) {
    var bg = (style.getPropertyValue('background-color') || '') + ' ' + (style.getPropertyValue('background-image') || '');
    var toks = bg.match(COLOR_RE) || [];
    for (var i = 0; i < toks.length; i += 1) {
      var c = parse(toks[i].toLowerCase());
      if (!c || c[3] < 0.75) continue;
      var H = hsl(c[0], c[1], c[2]);
      if (H[1] > 0.35 && H[2] > 0.18 && H[2] < 0.8) return true;
    }
    return false;
  }

  /** Maps one CSSStyleDeclaration in place. rec (optional) remembers what we wrote. */
  function mapDeclaration(style, day, rec) {
    var keepText = solidAccentBehind(style);
    var names = [];
    for (var i = 0; i < style.length; i += 1) names.push(style[i]);
    for (var j = 0; j < names.length; j += 1) {
      var p = names[j];
      var cur = style.getPropertyValue(p);
      if (rec && rec.has(p) && rec.get(p)[1] === cur) continue; // ours already
      var orig = cur;
      var next = cur;
      if (p.slice(0, 2) === '--') {
        if (/#|rgb|white|black/.test(cur) && !/var\(/.test(cur)) next = mapValue(cur.trim(), /text|fg|muted|faint/.test(p) ? 'text' : 'fill', day, false);
      } else if (p === 'font-family') {
        next = mapFont(cur);
      } else if (isColorProp(p)) {
        next = mapValue(cur, TEXT_PROPS[p] ? 'text' : 'fill', day, keepText);
      }
      if (next !== cur) {
        style.setProperty(p, next, style.getPropertyPriority(p));
        if (rec) rec.set(p, [orig, style.getPropertyValue(p)]);
      } else if (rec) {
        rec.delete(p);
      }
    }
  }

  var day = (read(THEME_KEY) || 'dark') === 'day';
  html.setAttribute('data-nl-theme', day ? 'day' : 'dark');

  // ── Style sheets ──
  var ruleOrig = new Map(); // CSSStyleRule → original cssText
  function own(sheet) {
    var n = sheet.ownerNode;
    return n && (n.id === 'nl-css' || (n.getAttribute && /new-look\.css/.test(n.getAttribute('href') || '')));
  }
  function walkRules(rules, fn) {
    for (var i = 0; i < rules.length; i += 1) {
      var r = rules[i];
      if (r.style && r.selectorText != null) fn(r);
      else if (r.cssRules && !(r.type === 7)) walkRules(r.cssRules, fn); // skip @keyframes
    }
  }
  function mapSheet(sheet) {
    if (own(sheet)) return;
    var rules;
    try { rules = sheet.cssRules; } catch (_) { return; } // cross-origin
    if (!rules) return;
    walkRules(rules, function (rule) {
      if (!ruleOrig.has(rule)) ruleOrig.set(rule, rule.style.cssText);
      else rule.style.cssText = ruleOrig.get(rule);
      mapDeclaration(rule.style, day, null);
    });
  }
  function mapAllSheets() {
    for (var i = 0; i < document.styleSheets.length; i += 1) mapSheet(document.styleSheets[i]);
  }

  // ── Inline styles and SVG paint ──
  var recs = new WeakMap(); // element → Map(prop → [original, written])
  var SVG_ATTRS = ['fill', 'stroke', 'stop-color'];
  function mapElement(el) {
    if (el.nodeType !== 1) return;
    if (el.hasAttribute('style') && el.style && el.style.length) {
      var rec = recs.get(el);
      if (!rec) { rec = new Map(); recs.set(el, rec); }
      mapDeclaration(el.style, day, rec);
    }
    if (el.namespaceURI === 'http://www.w3.org/2000/svg') {
      for (var i = 0; i < SVG_ATTRS.length; i += 1) {
        var at = SVG_ATTRS[i];
        var v = el.getAttribute(at);
        if (!v || v === 'none' || v === 'currentColor' || /url\(/.test(v)) continue;
        var key = 'data-nl-' + at;
        var orig = el.getAttribute(key);
        if (orig != null && el.getAttribute('data-nl-w-' + at) === v) continue;
        var src = v;
        var mapped = mapValue(src, at === 'fill' && el.tagName.toLowerCase() === 'text' ? 'text' : 'fill', day, false);
        if (mapped !== src) {
          el.setAttribute(key, src);
          el.setAttribute('data-nl-w-' + at, mapped);
          el.setAttribute(at, mapped);
        }
      }
    }
  }
  function mapTree(root) {
    if (root.nodeType !== 1) return;
    mapElement(root);
    var list = root.querySelectorAll('[style], svg [fill], svg [stroke], svg stop');
    for (var i = 0; i < list.length; i += 1) mapElement(list[i]);
  }

  // Theme switch: put every original back, then map again.
  function remapEverything() {
    ruleOrig.forEach(function (text, rule) { try { rule.style.cssText = text; } catch (_) {} });
    var list = document.querySelectorAll('[style]');
    for (var i = 0; i < list.length; i += 1) {
      var el = list[i]; var rec = recs.get(el);
      if (!rec) continue;
      rec.forEach(function (pair, p) {
        if (el.style.getPropertyValue(p) === pair[1]) el.style.setProperty(p, pair[0], el.style.getPropertyPriority(p));
      });
      rec.clear();
    }
    var svgs = document.querySelectorAll('[data-nl-fill], [data-nl-stroke], [data-nl-stop-color]');
    for (var j = 0; j < svgs.length; j += 1) {
      SVG_ATTRS.forEach(function (at) {
        var o = svgs[j].getAttribute('data-nl-' + at);
        if (o != null) { svgs[j].setAttribute(at, o); svgs[j].removeAttribute('data-nl-' + at); svgs[j].removeAttribute('data-nl-w-' + at); }
      });
    }
    mapAllSheets();
    mapTree(document.body);
  }

  function setTheme(next) {
    day = next === 'day';
    store(THEME_KEY, day ? 'day' : 'dark');
    html.setAttribute('data-nl-theme', day ? 'day' : 'dark');
    remapEverything();
    paintThemeButton();
  }
  window.seNewLook.theme = function (t) { setTheme(t || (day ? 'dark' : 'day')); };

  var observer = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i += 1) {
      var m = muts[i];
      if (m.type === 'attributes') { mapElement(m.target); continue; }
      for (var k = 0; k < m.addedNodes.length; k += 1) {
        var n = m.addedNodes[k];
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'STYLE') { if (n.sheet) mapSheet(n.sheet); continue; }
        if (n.tagName === 'LINK') { n.addEventListener('load', function () { if (this.sheet) mapSheet(this.sheet); }, { once: true }); continue; }
        mapTree(n);
      }
    }
  });

  // ── Shell: rail labels, ⌘K bar, theme button ──
  var ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
  var themeBtn = null;
  function paintThemeButton() {
    if (!themeBtn) return;
    themeBtn.innerHTML = (day ? ICON_MOON : ICON_SUN) + '<span>' + (day ? 'Dark' : 'Day') + '</span>';
    themeBtn.setAttribute('aria-label', day ? 'Switch to the dark theme' : 'Switch to the day theme');
  }

  function navItems() {
    return Array.prototype.slice.call(document.querySelectorAll('.dash-sidebar__nav .dash-nav-item')).filter(function (b) { return b.style.display !== 'none'; });
  }

  // ── Sidebar: the redesign's labelled, grouped menu. The portal's own buttons are kept (their
  // click handlers drive every page); they are relabelled, grouped and given badges. ──
  var LABELS = { content: 'Review', 'ai-studio': 'All tools', 'ad-studio': 'Ads', 'ai-coach': 'Coach', 'competitor-intel': 'Intel' };
  var GROUPS = [['dashboard', 'content', 'schedule', 'create'], ['inbox', 'analytics', 'ai-coach'], ['ad-studio', 'competitor-intel', 'fundraise', 'library', 'ai-studio'], ['nl-brand', 'settings']];
  var WORK = { create: 1, schedule: 1, content: 1, 'creation-studio': 1, 'design-studio': 1, 'brand-design': 1, 'animation-studio': 1 };
  var RAIL_KEY = 'se-nl-rail';
  var ICON = {
    tog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>',
    cmd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/></svg>',
    brand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/></svg>',
  };
  function navKey(b) { return b.getAttribute('data-nav') || (b.hasAttribute('data-nl-brand') ? 'nl-brand' : ''); }
  function wrapLabel(b) {
    var key = navKey(b);
    var lbl = b.querySelector('.nl-lbl');
    if (!lbl) {
      var text = '';
      Array.prototype.slice.call(b.childNodes).forEach(function (n) {
        if (n.nodeType === 3 && n.textContent.trim()) { text += n.textContent.trim(); n.remove(); }
      });
      lbl = document.createElement('span');
      lbl.className = 'nl-lbl';
      lbl.textContent = LABELS[key] || text;
      var icon = b.querySelector('i, svg');
      if (icon && icon.nextSibling) b.insertBefore(lbl, icon.nextSibling); else b.appendChild(lbl);
    }
    b.setAttribute('data-nl-label', lbl.textContent);
    b.setAttribute('aria-label', lbl.textContent);
  }
  function clientData() { return window.__clientData || window.clientData || null; }
  function pendingCount() {
    if (window.__greetData && typeof window.__greetData.pendingCount === 'number') return window.__greetData.pendingCount;
    var cd = clientData();
    var rows = (cd && cd.content) || [];
    return rows.filter(function (r) {
      var st = String((r.fields || r).status || '').toLowerCase();
      return st === 'pending' || st === 'draft' || st === 'ready for review';
    }).length;
  }
  function paintCounts() {
    var review = document.querySelector('.dash-nav-item[data-nav="content"] .nl-badge');
    if (review) { var n = pendingCount(); review.textContent = String(n); review.hidden = !n; }
    var plan = document.querySelector('.nl-plan');
    var cd = clientData();
    if (plan && cd && cd.client) {
      var tier = String(cd.client.tier || '').replace(/^./, function (c) { return c.toUpperCase(); });
      var credits = (document.getElementById('sidebar-credit-count') || {}).textContent || '';
      plan.textContent = [tier ? tier + ' plan' : '', /\d/.test(credits) ? credits.trim() + ' credits' : ''].filter(Boolean).join(' · ');
    }
    var pill = document.querySelector('.nl-conn');
    if (pill && cd && cd.client) {
      var raw = cd.client.social_connected_platforms;
      var list = Array.isArray(raw) ? raw : String(raw || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      pill.classList.toggle('is-off', !list.length);
      pill.querySelector('span').textContent = list.length ? 'Connected' : 'Connect accounts';
      pill.title = list.length ? 'Connected: ' + list.join(', ') : 'No social accounts connected yet';
    }
  }
  function applyRail() {
    var dash = document.getElementById('dashboard-view');
    if (!dash) return;
    var active = document.querySelector('.dash-sidebar__nav .dash-nav-item.active');
    var pref = read(RAIL_KEY);
    var narrow = window.matchMedia('(max-width: 1100px)').matches;
    var min = narrow || (pref ? pref === 'min' : !!(active && WORK[navKey(active)]));
    dash.classList.toggle('nl-min', min);
    var tog = document.querySelector('.nl-railtog');
    if (tog) { var l = min ? 'Expand menu' : 'Collapse menu'; tog.title = l; tog.setAttribute('aria-label', l); }
  }
  function buildSidebar() {
    var side = document.getElementById('dash-sidebar');
    var nav = side && side.querySelector('.dash-sidebar__nav');
    if (!side || !nav || side.dataset.nlBuilt) return;
    side.dataset.nlBuilt = '1';
    // Brand row with the collapse toggle.
    var logo = side.querySelector('.dash-sidebar__logo');
    if (logo) {
      Array.prototype.slice.call(logo.childNodes).forEach(function (n) {
        if (n.nodeType === 3 && n.textContent.trim()) { var sp = document.createElement('span'); sp.textContent = n.textContent.trim(); n.replaceWith(sp); }
      });
      var row = document.createElement('div');
      row.className = 'nl-brand';
      logo.replaceWith(row);
      row.appendChild(logo);
      var tog = document.createElement('button');
      tog.type = 'button';
      tog.className = 'nl-railtog';
      tog.innerHTML = ICON.tog;
      tog.addEventListener('click', function () {
        var dash = document.getElementById('dashboard-view');
        store(RAIL_KEY, dash && dash.classList.contains('nl-min') ? 'open' : 'min');
        applyRail();
      });
      row.appendChild(tog);
    }
    // Brand: opens Settings on its Brand tab.
    var brand = document.createElement('button');
    brand.type = 'button';
    brand.className = 'dash-nav-item';
    brand.setAttribute('data-nl-brand', '');
    brand.innerHTML = ICON.brand + '<span class="nl-lbl">Brand</span>';
    brand.addEventListener('click', function () { location.hash = '#settings/brand'; });
    nav.appendChild(brand);
    // Settings opens on Account in the new look (Brand has its own item), unless Brand sent us.
    var settingsBtn = nav.querySelector('.dash-nav-item[data-nav="settings"]');
    if (settingsBtn) settingsBtn.addEventListener('click', function (e) {
      if (e.isTrusted && /^#settings\/brand/.test(location.hash)) history.replaceState(null, '', '#settings/account');
    }, true);
    // Groups, in the redesign's order. Anything not listed keeps its place at the end.
    var byKey = {};
    Array.prototype.slice.call(nav.querySelectorAll('.dash-nav-item')).forEach(function (b) { byKey[navKey(b)] = b; wrapLabel(b); });
    var frag = document.createDocumentFragment();
    var placed = {};
    GROUPS.forEach(function (g, gi) {
      if (gi) { var gap = document.createElement('div'); gap.className = 'nl-gap'; gap.setAttribute('aria-hidden', 'true'); frag.appendChild(gap); }
      g.forEach(function (k) { if (byKey[k]) { frag.appendChild(byKey[k]); placed[k] = 1; } });
    });
    Object.keys(byKey).forEach(function (k) { if (!placed[k]) frag.appendChild(byKey[k]); });
    nav.appendChild(frag);
    // Review badge.
    var review = byKey.content;
    if (review && !review.querySelector('.nl-badge')) { var bd = document.createElement('span'); bd.className = 'nl-badge'; bd.hidden = true; review.appendChild(bd); }
    // Foot: Search and tools, then the account with its menu.
    var foot = document.createElement('div');
    foot.className = 'nl-foot';
    var search = document.createElement('button');
    search.type = 'button';
    search.className = 'nl-foot__link';
    search.innerHTML = ICON.cmd + '<span class="nl-lbl">Search and tools</span>';
    search.addEventListener('click', function () { var i = document.getElementById('nl-cmd-input'); if (i) { i.focus(); i.select(); } });
    foot.appendChild(search);
    var user = side.querySelector('.dash-sidebar__user');
    if (user) {
      user.parentNode.insertBefore(foot, user);
      foot.appendChild(user);
      var info = user.querySelector('.dash-sidebar__user-info');
      if (info && !info.querySelector('.nl-plan')) { var pl = document.createElement('span'); pl.className = 'nl-plan'; info.appendChild(pl); }
      user.setAttribute('role', 'button');
      user.setAttribute('tabindex', '0');
      user.setAttribute('aria-haspopup', 'menu');
      user.title = 'Account, credits and help';
      var menu = document.createElement('div');
      menu.className = 'nl-acctmenu';
      menu.hidden = true;
      menu.setAttribute('role', 'menu');
      user.appendChild(menu);
      var openMenu = function (ev) {
        if (ev && ev.target.closest('.nl-acctmenu')) return;
        var name = (document.getElementById('dash-user-name') || {}).textContent || '';
        var plan = (user.querySelector('.nl-plan') || {}).textContent || '';
        menu.innerHTML = '<div class="nl-acctmenu__hd"><b></b><span></span></div>'
          + '<button type="button" data-a="billing" role="menuitem">Plan and credits<span></span></button>'
          + '<button type="button" data-a="connections" role="menuitem">Account and connections</button>'
          + '<button type="button" data-a="look" role="menuitem">Back to the old look</button>'
          + '<button type="button" data-a="out" role="menuitem">Sign out</button>';
        menu.querySelector('b').textContent = name;
        menu.querySelector('.nl-acctmenu__hd span').textContent = plan;
        menu.querySelector('[data-a="billing"] span').textContent = ((document.getElementById('sidebar-credit-count') || {}).textContent || '').trim() + ' left';
        menu.hidden = !menu.hidden;
      };
      user.addEventListener('click', openMenu);
      user.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openMenu(ev); } });
      menu.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-a]');
        if (!b) return;
        menu.hidden = true;
        var a = b.getAttribute('data-a');
        if (a === 'billing' || a === 'connections') location.hash = '#settings/' + a;
        else if (a === 'look') window.seNewLook.off();
        else if (a === 'out') { var lo = document.getElementById('dash-logout'); if (lo) lo.click(); }
      });
      document.addEventListener('click', function (ev) { if (!user.contains(ev.target)) menu.hidden = true; });
    }
    // Keep labels, badges and the collapsed state right as pages change.
    new MutationObserver(function () { applyRail(); paintCounts(); }).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', applyRail);
    applyRail();
    [0, 600, 1800].forEach(function (t) { setTimeout(paintCounts, t); });
    setInterval(paintCounts, 4000);
  }

  var EXTRA = [
    { label: 'Schedule a post', hint: 'Calendar', go: function () { clickNav('schedule'); } },
    { label: 'Make a Reel', hint: 'Create', go: function () { clickNav('create'); } },
    { label: 'Switch to ' + 'day / dark', hint: 'Theme', go: function () { setTheme(day ? 'dark' : 'day'); } },
    { label: 'Back to the old look', hint: 'Look', go: function () { window.seNewLook.off(); } },
  ];
  function clickNav(id) { var b = document.querySelector('.dash-nav-item[data-nav="' + id + '"]'); if (b) b.click(); }

  function buildCmd(topbar) {
    var wrap = document.createElement('div');
    wrap.className = 'nl-cmd';
    wrap.innerHTML = '<label class="nl-cmd__box"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4"/></svg>'
      + '<input type="text" id="nl-cmd-input" placeholder="Jump to a page or tool" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="nl-cmd-list" aria-label="Jump to a page or tool">'
      + '<span class="nl-kbd">' + (/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K') + '</span></label>'
      + '<ul class="nl-cmd__list" id="nl-cmd-list" role="listbox" hidden></ul>';
    var input = wrap.querySelector('input');
    var list = wrap.querySelector('ul');
    var items = [];
    var sel = 0;
    function entries() {
      var pages = navItems().map(function (b) {
        return { label: b.getAttribute('data-nl-label') || b.textContent.trim(), hint: 'Page', go: function () { b.click(); } };
      });
      return pages.concat(EXTRA);
    }
    function render() {
      var q = input.value.trim().toLowerCase();
      items = entries().filter(function (e) { return !q || e.label.toLowerCase().indexOf(q) !== -1 || e.hint.toLowerCase().indexOf(q) !== -1; }).slice(0, 10);
      if (sel >= items.length) sel = 0;
      list.innerHTML = items.length
        ? items.map(function (e, i) { return '<li><button type="button" class="nl-cmd__item" role="option" data-i="' + i + '" aria-selected="' + (i === sel) + '">' + e.label.replace(/</g, '&lt;') + '<small>' + e.hint + '</small></button></li>'; }).join('')
        : '<li class="nl-cmd__empty">Nothing matches.</li>';
    }
    function open() { render(); list.hidden = false; input.setAttribute('aria-expanded', 'true'); }
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); }
    function run(i) { var e = items[i]; close(); input.value = ''; input.blur(); if (e) e.go(); }
    input.addEventListener('focus', open);
    input.addEventListener('input', function () { sel = 0; open(); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); render(); ev.preventDefault(); }
      else if (ev.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); ev.preventDefault(); }
      else if (ev.key === 'Enter') { run(sel); ev.preventDefault(); }
      else if (ev.key === 'Escape') { close(); input.blur(); }
    });
    list.addEventListener('mousedown', function (ev) {
      var b = ev.target.closest('[data-i]');
      if (b) { ev.preventDefault(); run(Number(b.getAttribute('data-i'))); }
    });
    input.addEventListener('blur', function () { setTimeout(close, 120); });
    document.addEventListener('keydown', function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'k' || ev.key === 'K')) { ev.preventDefault(); input.focus(); input.select(); }
    });
    var actions = topbar.querySelector('.dash-topbar__actions');
    topbar.insertBefore(wrap, actions || null);
  }

  function buildShell() {
    var topbar = document.querySelector('.dash-topbar');
    if (topbar && !topbar.querySelector('.nl-cmd')) buildCmd(topbar);
    var actions = document.querySelector('.dash-topbar__actions');
    if (actions && !actions.querySelector('.nl-theme-btn')) {
      themeBtn = document.createElement('button');
      themeBtn.type = 'button';
      themeBtn.className = 'nl-theme-btn';
      themeBtn.addEventListener('click', function () { setTheme(day ? 'dark' : 'day'); });
      actions.insertBefore(themeBtn, actions.firstChild);
      paintThemeButton();
    }
    if (actions && !actions.querySelector('.nl-conn')) {
      var conn = document.createElement('button');
      conn.type = 'button';
      conn.className = 'nl-conn';
      conn.innerHTML = '<i></i><span>Connected</span>';
      conn.addEventListener('click', function () { location.hash = '#settings/connections'; });
      actions.insertBefore(conn, actions.firstChild);
    }
    buildSidebar();
  }

  function start() {
    mapAllSheets();
    mapTree(document.body);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'fill', 'stroke', 'stop-color'] });
    var headObs = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.tagName === 'STYLE' && n.sheet) mapSheet(n.sheet);
          if (n.tagName === 'LINK') n.addEventListener('load', function () { if (n.sheet) mapSheet(n.sheet); }, { once: true });
        });
      });
    });
    headObs.observe(document.head, { childList: true });
    buildShell();
    // Stylesheets that finish loading after us.
    window.addEventListener('load', mapAllSheets, { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  // Test hooks.
  window.seNewLook._mapColor = function (css, kind, d) { return mapValue(css, kind || 'fill', !!d, false); };
})();
