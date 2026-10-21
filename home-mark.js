/* SocialEngine homepage mark: a liquid-chrome WebGL render of the logo.
 * Ported unchanged from the approved Homepage-mark design (mountMark).
 * Usage: var mk = SEMountMark(canvas, { look, zoom, liquid, speed });
 * Returns null when WebGL is unavailable, otherwise { set, pulse, down, move, up, destroy }.
 * prefers-reduced-motion is honoured: the mark holds still (it still responds to touch). */
(function (root) {
  'use strict';

  function mountMark(canvas, init) {
    // Liquid chrome SE mark: one larger sphere joined to two smaller ones,
    // ray-marched in WebGL. Returns { set, pulse, down, move, up, destroy }.
    var BIG = [-0.56, 0, 0], BIG_R = 0.50, SA = [0.60, 0.70, 0], SB = [0.60, -0.70, 0], SR = 0.355;
    var CAMZ = 4.2, TANH = 0.40;
    var LOOKS = { 'Chrome': [0, 0], 'Chrome + SE': [0.6, 0.1], 'Brand tint': [1.0, 0.7] };
    var f3 = function (v) { return v.map(function (x) { return x.toFixed(3); }).join(','); };
    var VERT = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }';
    var FRAG = [
      'precision highp float;',
      'uniform vec2 uRes; uniform float uTime; uniform mat3 uRot; uniform float uNeck; uniform float uLiquid;',
      'uniform vec2 uLight; uniform float uGlow; uniform float uPart; uniform vec4 uPulse; uniform float uPulseAmp; uniform float uZoom;',
      'const vec3 PURPLE = vec3(0.42, 0.20, 1.00); const vec3 CYAN = vec3(0.00, 0.78, 1.00);',
      'const float CAMZ = ' + CAMZ.toFixed(2) + '; const float TANH = ' + TANH.toFixed(2) + ';',
      'vec3 gB; vec3 gS1; vec3 gS2; float gRb; float gRs;',
      'void setup(){ float t = uTime; float w = uLiquid;',
      '  gB  = vec3(' + f3(BIG) + ') + w*vec3(0.025*sin(t*0.9), 0.030*sin(t*0.7+1.0), 0.030*cos(t*0.8));',
      '  gS1 = vec3(' + f3(SA) + ') + w*vec3(0.040*sin(t*1.1+1.0), 0.035*sin(t*0.83), 0.050*cos(t*0.95));',
      '  gS2 = vec3(' + f3(SB) + ') + w*vec3(0.040*cos(t*1.03), 0.035*sin(t*1.21+2.0), 0.050*sin(t*0.71));',
      '  gRb = ' + BIG_R.toFixed(3) + ' + w*0.012*sin(t*1.3); gRs = ' + SR.toFixed(3) + ' + w*0.012*sin(t*1.7+0.5); }',
      'float smin(float a, float b, float k){ float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h*h*k*0.25; }',
      'float capsule(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0); return length(pa - ba*h) - r; }',
      'float sdf(vec3 q){',
      '  float nr = mix(0.07, 0.17, uNeck); float k = mix(0.10, 0.30, uNeck);',
      '  float d = length(q - gB) - gRb;',
      '  d = smin(d, capsule(q, gB, gS1, nr), k); d = smin(d, capsule(q, gB, gS2, nr), k);',
      '  d = smin(d, length(q - gS1) - gRs, k); d = smin(d, length(q - gS2) - gRs, k);',
      '  d += uLiquid*0.010*sin(q.x*9.0 + uTime*2.1)*sin(q.y*8.0 - uTime*1.7)*sin(q.z*10.0 + uTime*1.3);',
      '  if (uPulse.w >= 0.0) { float r = length(q - uPulse.xyz); float a = uPulse.w; float front = r - a*1.5;',
      '    d += uPulseAmp*0.022*exp(-a*1.8)*sin(front*28.0)*exp(-front*front*34.0); }',
      '  return d; }',
      'float map(vec3 p){ return sdf(uRot*p); }',
      'vec3 calcNormal(vec3 p){ const vec2 e = vec2(0.0015, -0.0015);',
      '  return normalize(e.xyy*map(p + e.xyy) + e.yyx*map(p + e.yyx) + e.yxy*map(p + e.yxy) + e.xxx*map(p + e.xxx)); }',
      'float calcAO(vec3 p, vec3 n){ float occ = 0.0, sca = 1.0;',
      '  for (int i = 0; i < 4; i++) { float h = 0.02 + 0.08*float(i); occ += (h - map(p + n*h))*sca; sca *= 0.7; }',
      '  return clamp(1.0 - 2.0*occ, 0.0, 1.0); }',
      'vec3 env(vec3 d){ float y = d.y; float az = atan(d.x, d.z);',
      '  vec3 c = mix(vec3(0.002, 0.002, 0.003), vec3(0.016, 0.017, 0.022), smoothstep(-0.4, 1.0, y));',
      '  c += vec3(0.30, 0.31, 0.36) * exp(-pow(y*4.0, 2.0)) * 0.28;',
      '  c += vec3(0.85) * exp(-pow((y - 0.02)*26.0, 2.0));',
      '  c += vec3(1.25) * smoothstep(0.70, 0.75, y) * (0.6 + 0.4*smoothstep(0.75, 0.97, y));',
      '  c += vec3(0.55) * smoothstep(0.035, 0.0, abs(y - 0.48)) * smoothstep(1.4, 0.6, abs(az));',
      '  c += vec3(1.55) * smoothstep(0.075, 0.03, abs(az - 1.05)) * smoothstep(-0.30, -0.05, y) * smoothstep(0.62, 0.40, y);',
      '  c += vec3(0.95) * smoothstep(0.055, 0.02, abs(az + 1.95)) * smoothstep(-0.15, 0.10, y) * smoothstep(0.75, 0.50, y);',
      '  c += vec3(0.07, 0.075, 0.10) * pow(max(d.z, 0.0), 2.0) * smoothstep(-0.6, 0.2, y);',
      '  c += vec3(1.00, 1.01, 1.08) * pow(max(dot(d, normalize(vec3(uLight*1.3, 0.75))), 0.0), 20.0) * 1.15;',
      '  c += PURPLE * pow(max(dot(d, normalize(vec3(-1.0, -0.10, 0.30))), 0.0), 4.0) * uGlow * 0.85;',
      '  c += CYAN * pow(max(dot(d, normalize(vec3(0.85, -0.45, 0.30))), 0.0), 7.0) * uGlow * 0.80;',
      '  vec3 floorC = mix(vec3(0.045, 0.048, 0.062), vec3(0.004, 0.004, 0.007), smoothstep(-0.02, -0.75, y));',
      '  c = mix(c, floorC + c*0.25, smoothstep(-0.02, -0.20, y));',
      '  return c; }',
      'vec3 metal(vec3 p){ vec3 q = uRot*p; float db = length(q - gB) - gRb; float ds = min(length(q - gS1), length(q - gS2)) - gRs;',
      '  float m = smoothstep(-0.20, 0.20, db - ds);',
      '  return mix(vec3(0.93, 0.94, 0.97), mix(vec3(0.68, 0.52, 1.00), vec3(0.50, 0.92, 1.00), m), uPart); }',
      'vec3 fresnel(vec3 F0, vec3 rd, vec3 n){ float c = clamp(1.0 + dot(rd, n), 0.0, 1.0); return F0 + (1.0 - F0)*pow(c, 5.0); }',
      'vec3 shade(vec3 p, vec3 n, vec3 rd){ float rim = pow(clamp(1.0 + dot(rd, n), 0.0, 1.0), 3.0); vec3 col = env(reflect(rd, n))*fresnel(metal(p), rd, n)*mix(0.35, 1.0, calcAO(p, n)); return col + rim*vec3(0.40, 0.42, 0.56)*0.55; }',
      'vec3 aces(vec3 x){ return clamp((x*(2.51*x + 0.03))/(x*(2.43*x + 0.59) + 0.14), 0.0, 1.0); }',
      'void main(){ setup();',
      '  float m = min(uRes.x, uRes.y)*uZoom;',
      '  vec2 uv = (2.0*gl_FragCoord.xy - uRes)/m;',
      '  vec3 ro = vec3(0.0, 0.0, CAMZ); vec3 rd = normalize(vec3(uv*TANH, -1.0));',
      '  float pix = 2.0*TANH/m; vec4 outc = vec4(0.0);',
      '  float b = dot(ro, rd); float c = dot(ro, ro) - 2.25; float hh = b*b - c;',
      '  if (hh > 0.0) { hh = sqrt(hh); float t = max(-b - hh, 0.0), t1 = -b + hh; float mind = 1e9, tm = t; bool hit = false;',
      '    for (int i = 0; i < 96; i++) { vec3 p = ro + rd*t; float d = map(p); float ad = d/t; if (ad < mind) { mind = ad; tm = t; }',
      '      if (d < 0.0006*t) { hit = true; break; } t += d*0.9; if (t > t1) break; }',
      '    if (hit) { vec3 p = ro + rd*t; outc = vec4(shade(p, calcNormal(p), rd), 1.0); }',
      '    else if (mind < pix*1.2) { vec3 p = ro + rd*tm; outc = vec4(shade(p, calcNormal(p), rd), 1.0 - smoothstep(0.0, pix*1.2, mind)); } }',
      '  vec3 col = pow(aces(outc.rgb*1.15), vec3(1.0/2.2));',
      '  gl_FragColor = vec4(col*outc.a, outc.a); }'
    ].join('\n');

    var gl = null;
    try { gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false }); } catch (e) { gl = null; }
    if (!gl) return null;
    var compile = function (type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    var prog = gl.createProgram();
    try {
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) { if (window.console) console.error(e); return null; }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var aLoc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(aLoc);
    gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
    var U = {};
    ['uRes', 'uTime', 'uRot', 'uNeck', 'uLiquid', 'uLight', 'uGlow', 'uPart', 'uPulse', 'uPulseAmp', 'uZoom'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

    // Matrices are row-major 3x3, object to world.
    var mul = function (A, B) {
      var C = new Array(9);
      for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
      return C;
    };
    var rotX = function (a) { var c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
    var rotY = function (a) { var c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
    var tidy = function (M) {
      var n = function (v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
      var a = n([M[0], M[1], M[2]]);
      var d = a[0] * M[3] + a[1] * M[4] + a[2] * M[5];
      var b = n([M[3] - d * a[0], M[4] - d * a[1], M[5] - d * a[2]]);
      return [a[0], a[1], a[2], b[0], b[1], b[2], a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    };
    var toObj = function (R, p) { return [R[0] * p[0] + R[3] * p[1] + R[6] * p[2], R[1] * p[0] + R[4] * p[1] + R[7] * p[2], R[2] * p[0] + R[5] * p[1] + R[8] * p[2]]; };

    var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var look = LOOKS[init.look] || LOOKS['Chrome + SE'];
    var st = {
      R: mul(rotY(init.yaw == null ? -0.35 : init.yaw), rotX(0.12)), vel: [0, 0], axis: [0, 1],
      time: 0, liquid: init.liquid || 0.25, tLiquid: init.liquid || 0.25, speed: init.speed || 0.35, tSpeed: init.speed || 0.35,
      lx: -0.55, ly: 0.55, tlx: -0.55, tly: 0.55, glow: look[0], tGlow: look[0], part: look[1], tPart: look[1], boost: 0, tBoost: 0, timeScale: 1, tTimeScale: 1,
      neck: init.neck == null ? 0.55 : init.neck, zoom: init.zoom || 1,
      pulseAt: -1, pulseP: [0, 0, 0], pulseAmp: 1, dragging: false, visible: true, dead: false,
    };
    var quality = 1, raf = 0, last = 0, slow = 0, fast = 0, activeUntil = 0;
    var resize = function () {
      var s = Math.min(2, Math.max(1, window.devicePixelRatio || 1)) * quality;
      var w = Math.max(1, Math.round(canvas.clientWidth * s)), h = Math.max(1, Math.round(canvas.clientHeight * s));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
    };
    var ease = function (cur, tgt, rate, dt) { return cur + (tgt - cur) * (1 - Math.exp(-dt * rate)); };
    var moving = function () {
      if (st.dead || !st.visible) return false;
      if (st.dragging || performance.now() < activeUntil || st.pulseAt >= 0) return true;
      return !reduce;
    };
    var frame = function (now) {
      raf = 0;
      if (st.dead) return;
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      st.liquid = ease(st.liquid, reduce ? 0 : st.tLiquid, 2.2, dt);
      st.speed = ease(st.speed, reduce ? 0 : st.tSpeed, 1.8, dt);
      st.glow = ease(st.glow, st.tGlow, 4, dt);
      st.part = ease(st.part, st.tPart, 4, dt);
      st.boost = ease(st.boost, st.tBoost, 3, dt);
      st.lx = ease(st.lx, st.tlx, 5, dt); st.ly = ease(st.ly, st.tly, 5, dt);
      st.timeScale = ease(st.timeScale, st.tTimeScale, 2, dt);
      st.time += dt * st.timeScale;
      if (!st.dragging) {
        var al = Math.hypot(st.axis[0], st.axis[1]) || 1;
        st.vel = [ease(st.vel[0], st.axis[0] / al * st.speed, 1.6, dt), ease(st.vel[1], st.axis[1] / al * st.speed, 1.6, dt)];
        st.R = tidy(mul(rotX(st.vel[0] * dt), mul(rotY(st.vel[1] * dt), st.R)));
      }
      var age = st.pulseAt >= 0 ? st.time - st.pulseAt : -1;
      if (age > 2.6) st.pulseAt = -1;
      resize();
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uTime, st.time);
      gl.uniformMatrix3fv(U.uRot, false, new Float32Array(st.R));
      gl.uniform1f(U.uNeck, st.neck);
      gl.uniform1f(U.uLiquid, st.liquid);
      gl.uniform2f(U.uLight, st.lx, st.ly);
      gl.uniform1f(U.uGlow, st.glow + st.boost);
      gl.uniform1f(U.uPart, st.part);
      gl.uniform4f(U.uPulse, st.pulseP[0], st.pulseP[1], st.pulseP[2], st.pulseAt >= 0 ? age : -1);
      gl.uniform1f(U.uPulseAmp, st.pulseAmp);
      gl.uniform1f(U.uZoom, st.zoom);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (dt > 0.026) { slow++; fast = 0; } else if (dt < 0.018) { fast++; slow = 0; }
      if (slow > 20 && quality > 0.7) { quality = Math.max(0.7, quality - 0.1); slow = 0; }
      if (fast > 240 && quality < 1) { quality = Math.min(1, quality + 0.1); fast = 0; }
      if (moving()) raf = requestAnimationFrame(frame);
    };
    var kick = function () {
      activeUntil = performance.now() + 1500;
      if (!raf && !st.dead && st.visible) { last = performance.now(); raf = requestAnimationFrame(frame); }
    };

    var ro = window.ResizeObserver ? new ResizeObserver(kick) : null;
    if (ro) ro.observe(canvas);
    var io = window.IntersectionObserver ? new IntersectionObserver(function (es) { st.visible = es[0].isIntersecting; if (st.visible) kick(); }) : null;
    if (io) io.observe(canvas);
    var onVis = function () { st.visible = !document.hidden; if (st.visible) kick(); };
    document.addEventListener('visibilitychange', onVis);

    // Where a point on screen lands on the mark (no wobble), in object space.
    var len = Math.hypot;
    var capD = function (p, a, b, r) {
      var pa = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      var h = Math.min(1, Math.max(0, (pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]) / (ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2])));
      return len(pa[0] - ba[0] * h, pa[1] - ba[1] * h, pa[2] - ba[2] * h) - r;
    };
    var smin = function (a, b, k) { var h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
    var sdf = function (q) {
      var nr = 0.07 + 0.10 * st.neck, k = 0.10 + 0.20 * st.neck;
      var d = len(q[0] - BIG[0], q[1] - BIG[1], q[2] - BIG[2]) - BIG_R;
      d = smin(d, capD(q, BIG, SA, nr), k); d = smin(d, capD(q, BIG, SB, nr), k);
      d = smin(d, len(q[0] - SA[0], q[1] - SA[1], q[2] - SA[2]) - SR, k);
      return smin(d, len(q[0] - SB[0], q[1] - SB[1], q[2] - SB[2]) - SR, k);
    };
    var pick = function (cx, cy) {
      var r = canvas.getBoundingClientRect();
      var m = Math.min(r.width, r.height) * st.zoom;
      var ux = (2 * (cx - r.left) - r.width) / m, uy = (r.height - 2 * (cy - r.top)) / m;
      var rd = [ux * TANH, uy * TANH, -1], l = len(rd[0], rd[1], rd[2]);
      rd = [rd[0] / l, rd[1] / l, rd[2] / l];
      var t = 2;
      for (var i = 0; i < 120 && t < 7; i++) {
        var q = toObj(st.R, [rd[0] * t, rd[1] * t, CAMZ + rd[2] * t]);
        var d = sdf(q);
        if (d < 0.002) return q;
        t += d * 0.9;
      }
      return null;
    };

    var downAt = null, lastMove = null;
    var api = {
      set: function (o) {
        if (o.liquid != null) st.tLiquid = o.liquid;
        if (o.speed != null) st.tSpeed = o.speed;
        if (o.axis) st.axis = o.axis;
        if (o.boost != null) st.tBoost = o.boost;
        if (o.timeScale != null) st.tTimeScale = o.timeScale;
        if (o.look && LOOKS[o.look]) { st.tGlow = LOOKS[o.look][0]; st.tPart = LOOKS[o.look][1]; }
        kick();
      },
      // A ripple from the point facing the viewer (or from p, in object space).
      pulse: function (amp, p) {
        st.pulseP = p || toObj(st.R, [0.15, 0.1, 0.6]);
        st.pulseAmp = amp == null ? 1 : amp;
        st.pulseAt = st.time;
        kick();
      },
      down: function (e) {
        if (e.currentTarget && e.currentTarget.setPointerCapture) { try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
        downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
        lastMove = { x: e.clientX, y: e.clientY, t: performance.now() };
        st.dragging = true; st.vel = [0, 0]; kick();
      },
      move: function (e) {
        if (!st.dragging) {
          var rr = canvas.getBoundingClientRect(), mm = Math.min(rr.width, rr.height) * st.zoom;
          st.tlx = Math.max(-1.4, Math.min(1.4, (2 * (e.clientX - rr.left) - rr.width) / mm));
          st.tly = Math.max(-1.4, Math.min(1.4, (rr.height - 2 * (e.clientY - rr.top)) / mm));
          kick(); return;
        }
        if (!lastMove) return;
        var r = canvas.getBoundingClientRect(), now = performance.now();
        var dx = e.clientX - lastMove.x, dy = e.clientY - lastMove.y, k = 5.5 / Math.max(80, Math.min(r.width, r.height));
        st.R = tidy(mul(rotX(dy * k), mul(rotY(dx * k), st.R)));
        var dt = Math.max(8, now - lastMove.t) / 1000;
        st.vel = [0.6 * st.vel[0] + 0.4 * (dy * k / dt), 0.6 * st.vel[1] + 0.4 * (dx * k / dt)];
        lastMove = { x: e.clientX, y: e.clientY, t: now }; kick();
      },
      up: function (e) {
        if (!st.dragging) return;
        st.dragging = false;
        if (performance.now() - lastMove.t > 90) st.vel = [0, 0];
        var sp = Math.hypot(st.vel[0], st.vel[1]);
        if (sp > 9) st.vel = [st.vel[0] * 9 / sp, st.vel[1] * 9 / sp];
        if (sp > 0.8) st.axis = [st.vel[0] / sp, st.vel[1] / sp];
        if (downAt && e && e.type === 'pointerup' && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6 && performance.now() - downAt.t < 350) {
          var q = pick(e.clientX, e.clientY);
          if (q) api.pulse(1, q);
        }
        downAt = null; kick();
      },
      destroy: function () {
        st.dead = true;
        if (raf) cancelAnimationFrame(raf);
        if (ro) ro.disconnect();
        if (io) io.disconnect();
        document.removeEventListener('visibilitychange', onVis);
      },
      _st: st,
    };
    kick();
    return api;
  }

  root.SEMountMark = mountMark;
})(typeof window !== 'undefined' ? window : globalThis);
