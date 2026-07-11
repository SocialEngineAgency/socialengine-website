/**
 * Creation Studio — Fabric.js enterprise canvas editor
 * Loaded by portal.html. Uses portal globals: API, clientEmail, clientHash, clientData.
 */
(function (global) {
  'use strict';

  const STUDIO_FORMATS = {
    '9:16': { w: 1080, h: 1920, displayW: 340, displayH: 604 },
    '1:1':  { w: 1080, h: 1080, displayW: 520, displayH: 520 },
    '4:5':  { w: 1080, h: 1350, displayW: 468, displayH: 585 },
  };

  let studioCanvas = null;
  let studioFormat = '9:16';
  let studioPost = null;
  let studioHistory = [];
  let studioHistoryIdx = -1;
  let studioSaved = { '9:16': null, '1:1': null, '4:5': null };
  let studioChatHistory = [];
  let studioPendingOps = [];
  let studioZoom = 1;
  let studioKeyBound = false;
  let studioVideoLoop = false;
  let studioVideoLoopId = null;
  let studioVideoElements = [];
  let studioVideoBlobUrls = [];
  let studioVideoManifest = null;
  let studioServerVideoUrl = null;
  let studioAnalysisInProgress = false;
  let studioAnalysisMode = 'lite';
  let studioManifestCache = {};
  let studioPendingFrameDataUrl = null;
  let studioActiveElement = null;
  let studioInpaintJobs = {};
  let studioSAMModeActive = false;

  function postFields(post) {
    if (!post) return {};
    return post.fields || post;
  }

  function authHeaders(extra) {
    const email = global.__clientEmail || global.clientEmail || global._seEmail || '';
    const hash = global.__clientHash || global.clientHash || global._seHash || '';
    return Object.assign({
      'x-client-email': email,
      'x-client-hash': hash,
    }, extra || {});
  }

  function apiBase() {
    return global.API || global._seAPI || 'https://socialengine-api-production-18e0.up.railway.app';
  }

  async function studioFetch(path, opts) {
    opts = opts || {};
    const headers = authHeaders(Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}));
    const resp = await fetch(apiBase() + path, Object.assign({}, opts, { headers: headers }));
    if (!resp.ok) {
      let errMsg = resp.statusText;
      try {
        const j = await resp.json();
        errMsg = j.error || errMsg;
      } catch (_) { /* keep statusText */ }
      throw new Error(resp.status + ': ' + errMsg);
    }
    return resp.json();
  }

  function toHex(color) {
    if (!color || typeof color !== 'string') return '#000000';
    if (color.startsWith('#')) return color;
    const d = document.createElement('div');
    d.style.color = color;
    document.body.appendChild(d);
    const rgb = window.getComputedStyle(d).color;
    document.body.removeChild(d);
    const m = rgb.match(/\d+/g);
    if (!m) return '#000000';
    return '#' + m.slice(0, 3).map(function (n) { return parseInt(n, 10).toString(16).padStart(2, '0'); }).join('');
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── HTML shell ──────────────────────────────────────────────────────────
  function creationStudioMarkup() {
    return `
<div id="ctab-studio" class="ctab-panel cs-root">
  <div class="cs-topbar">
    <div class="cs-topbar-left">
      <span class="cs-brand-lock">✓ Brand locked · logo, palette &amp; type locked</span>
      <select id="cs-post-select" class="cs-post-select" title="Select post"></select>
      <span class="cs-post-name" id="cs-post-name">No post selected</span>
    </div>
    <div class="cs-format-tabs" id="cs-format-tabs">
      <button type="button" class="cs-fmt active" data-fmt="9:16">9:16 Story/Reel</button>
      <button type="button" class="cs-fmt" data-fmt="1:1">1:1 Feed</button>
      <button type="button" class="cs-fmt" data-fmt="4:5">4:5 Feed</button>
    </div>
    <div class="cs-topbar-right">
      <button type="button" class="cs-btn-icon" onclick="studioUndo()" title="Undo (⌘Z)">↩</button>
      <button type="button" class="cs-btn-icon" onclick="studioRedo()" title="Redo (⌘Y)">↪</button>
      <div class="cs-topbar-divider"></div>
      <button type="button" class="cs-btn-icon" onclick="toggleVersionHistory()" title="Version history">🕐</button>
      <button type="button" class="cs-btn-secondary" id="btn-studio-export" onclick="exportStudioOutput()">↓ Download</button>
      <button type="button" class="cs-btn-approve" id="cs-approve-btn" onclick="studioApprove()">✓ Approve</button>
    </div>
  </div>

  <div class="cs-main">
    <div class="cs-layers" id="cs-layers">
      <div class="cs-panel-title">LAYERS</div>
      <div id="cs-layer-list"></div>
      <div class="cs-layer-actions">
        <button type="button" onclick="studioAddText()" class="cs-add-btn">+ Text</button>
        <button type="button" onclick="studioAddRect()" class="cs-add-btn">+ Shape</button>
        <button type="button" onclick="document.getElementById('cs-img-upload').click()" class="cs-add-btn">+ Image</button>
        <button type="button" id="btn-sam-mode" onclick="toggleSAMMode()" class="cs-add-btn" title="Click canvas to segment an element">🎯 Segment</button>
        <button type="button" onclick="studioClearCanvas()" class="cs-add-btn" style="color:#ef4444;border-color:#7f1d1d">✕ Clear</button>
        <input type="file" id="cs-img-upload" accept="image/*,video/mp4,video/quicktime,video/webm,video/x-msvideo,.mp4,.mov,.webm,.avi,.mkv,.m4v" style="display:none" onchange="studioAddImage(this)">
      </div>
    </div>

    <div class="cs-canvas-area">
      <div class="cs-canvas-outer" id="cs-canvas-outer">
        <div class="cs-canvas-wrapper" id="cs-canvas-wrapper">
          <video
            id="studio-video-player"
            muted
            loop
            playsinline
            preload="auto"
            style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;display:none;pointer-events:none;z-index:0;"
          ></video>
          <canvas id="studio-canvas"></canvas>
        </div>
      </div>
      <div class="cs-canvas-toolbar">
        <div class="cs-tool-group">
          <button type="button" class="cs-tool" onclick="studioAddText()" title="Text (T)">T</button>
          <button type="button" class="cs-tool" onclick="studioAddRect()" title="Rectangle (R)">□</button>
          <button type="button" class="cs-tool" onclick="studioAddEllipse()" title="Ellipse (O)">○</button>
          <button type="button" class="cs-tool" onclick="studioAddLine()" title="Line">—</button>
        </div>
        <div class="cs-tool-group">
          <button type="button" class="cs-tool" onclick="studioZoomIn()">+</button>
          <span class="cs-zoom-label" id="cs-zoom-label">100%</span>
          <button type="button" class="cs-tool" onclick="studioZoomOut()">−</button>
          <button type="button" class="cs-tool cs-tool-sm" onclick="studioZoomFit()">Fit</button>
        </div>
        <div class="cs-tool-group">
          <button type="button" class="cs-tool" onclick="studioTriggerHiggsfield()" title="Generate background with Higgsfield">✦ Generate BG</button>
          <input type="file" id="cs-design-upload" accept="image/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.avi,.m4v" style="display:none" onchange="studioAddImage(this)">
          <button type="button" class="cs-tool" onclick="document.getElementById('cs-design-upload').click()" title="Upload a design to clone as editable layers" style="background:#7C3AED22;color:#a78bfa;border:1px solid #7C3AED;">↑ Clone design</button>
        </div>
      </div>
    </div>

    <div class="cs-right-panel">
      <div class="cs-right-tabs">
        <button type="button" class="cs-rtab active" onclick="showRightTab('props')" id="rtab-props">Properties</button>
        <button type="button" class="cs-rtab" onclick="showRightTab('chat')" id="rtab-chat">AI Chat <span class="cs-chat-badge" id="cs-chat-badge" style="display:none">●</span></button>
      </div>

      <div id="cs-props-panel" class="cs-props-content">
        <div id="props-empty" class="props-section">
          <p class="props-hint">Select an object to edit its properties.<br>Or click <strong>+ Text</strong> / <strong>+ Shape</strong> to add elements.</p>
          <div class="props-group">
            <label>Canvas background</label>
            <div class="color-row">
              <input type="color" id="prop-canvas-bg" value="#0E1A63" onchange="setCanvasBg(this.value)">
              <span id="prop-canvas-bg-hex">#0E1A63</span>
            </div>
          </div>
        </div>

        <div id="props-text" class="props-section" style="display:none">
          <div class="props-group">
            <label>Font</label>
            <select id="prop-font-family" onchange="applyProp('fontFamily', this.value)">
              <optgroup label="Brand fonts">
                <option value="Newsreader">Newsreader</option>
                <option value="Instrument Sans">Instrument Sans</option>
              </optgroup>
              <optgroup label="System fonts">
                <option value="Georgia">Georgia</option>
                <option value="Arial">Arial</option>
                <option value="Helvetica">Helvetica</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Courier New">Courier New</option>
                <option value="Impact">Impact</option>
              </optgroup>
            </select>
          </div>
          <div class="props-row">
            <div class="props-group props-half">
              <label>Size</label>
              <input type="number" id="prop-font-size" min="8" max="400" onchange="applyProp('fontSize', +this.value)">
            </div>
            <div class="props-group props-half">
              <label>Color</label>
              <div class="color-row">
                <input type="color" id="prop-text-color" onchange="applyProp('fill', this.value)">
                <input type="text" id="prop-text-color-hex" maxlength="7" onchange="applyProp('fill', this.value)" style="width:70px">
              </div>
            </div>
          </div>
          <div class="props-row">
            <button type="button" class="prop-toggle" id="prop-bold" onclick="toggleTextStyle('bold')"><b>B</b></button>
            <button type="button" class="prop-toggle" id="prop-italic" onclick="toggleTextStyle('italic')"><i>I</i></button>
            <button type="button" class="prop-toggle" id="prop-underline" onclick="toggleTextStyle('underline')"><u>U</u></button>
          </div>
          <div class="props-group">
            <label>Alignment</label>
            <div class="props-row">
              <button type="button" class="prop-align" onclick="applyProp('textAlign','left')">Left</button>
              <button type="button" class="prop-align" onclick="applyProp('textAlign','center')">Center</button>
              <button type="button" class="prop-align" onclick="applyProp('textAlign','right')">Right</button>
            </div>
          </div>
          <div class="props-row">
            <div class="props-group props-half">
              <label>Line height</label>
              <input type="number" id="prop-line-height" step="0.1" min="0.5" max="3" onchange="applyProp('lineHeight', +this.value)">
            </div>
            <div class="props-group props-half">
              <label>Letter spacing</label>
              <input type="number" id="prop-char-spacing" step="10" min="-200" max="800" onchange="applyProp('charSpacing', +this.value)">
            </div>
          </div>
          <div class="props-group">
            <label>Shadow</label>
            <div class="props-row">
              <input type="color" id="prop-shadow-color" value="#000000" onchange="applyTextShadow()">
              <input type="number" id="prop-shadow-blur" value="0" min="0" max="50" placeholder="Blur" onchange="applyTextShadow()" style="width:60px">
              <input type="number" id="prop-shadow-x" value="0" min="-30" max="30" placeholder="X" onchange="applyTextShadow()" style="width:50px">
              <input type="number" id="prop-shadow-y" value="2" min="-30" max="30" placeholder="Y" onchange="applyTextShadow()" style="width:50px">
            </div>
          </div>
        </div>

        <div id="props-image" class="props-section" style="display:none">
          <div class="props-group">
            <label>Opacity</label>
            <input type="range" id="prop-img-opacity" min="0" max="1" step="0.01" value="1" oninput="applyPropNum('opacity', +this.value); document.getElementById('prop-img-opacity-val').textContent=Math.round(+this.value*100)+'%'">
            <span id="prop-img-opacity-val">100%</span>
          </div>
          <div class="props-group">
            <label>Blend mode</label>
            <select id="prop-blend" onchange="applyProp('globalCompositeOperation', this.value)">
              <option value="source-over">Normal</option>
              <option value="multiply">Multiply</option>
              <option value="overlay">Overlay</option>
              <option value="screen">Screen</option>
              <option value="darken">Darken</option>
              <option value="lighten">Lighten</option>
              <option value="color-dodge">Color Dodge</option>
              <option value="color-burn">Color Burn</option>
              <option value="soft-light">Soft Light</option>
              <option value="hard-light">Hard Light</option>
              <option value="difference">Difference</option>
            </select>
          </div>
          <div class="props-group">
            <label>Filters</label>
            <div class="filter-sliders">
              <div class="filter-row"><span>Brightness</span><input type="range" id="filt-brightness" min="-1" max="1" step="0.05" value="0" oninput="applyImageFilter()"><span id="filt-brightness-val">0</span></div>
              <div class="filter-row"><span>Contrast</span><input type="range" id="filt-contrast" min="-1" max="1" step="0.05" value="0" oninput="applyImageFilter()"><span id="filt-contrast-val">0</span></div>
              <div class="filter-row"><span>Saturation</span><input type="range" id="filt-saturation" min="-1" max="1" step="0.05" value="0" oninput="applyImageFilter()"><span id="filt-saturation-val">0</span></div>
              <div class="filter-row"><span>Blur</span><input type="range" id="filt-blur" min="0" max="1" step="0.05" value="0" oninput="applyImageFilter()"><span id="filt-blur-val">0</span></div>
            </div>
          </div>
          <div class="props-group">
            <button type="button" class="cs-btn-secondary cs-full-width" onclick="studioTriggerHiggsfield()">✦ Regenerate with AI</button>
          </div>
          <div class="props-group">
            <button type="button" class="cs-btn-secondary cs-full-width" onclick="document.getElementById('cs-img-upload').click()">↑ Replace image</button>
          </div>
        </div>

        <div id="props-shape" class="props-section" style="display:none">
          <div class="props-row">
            <div class="props-group props-half">
              <label>Fill</label>
              <div class="color-row">
                <input type="color" id="prop-shape-fill" onchange="applyProp('fill', this.value)">
                <input type="text" id="prop-shape-fill-hex" maxlength="7" onchange="applyProp('fill', this.value)" style="width:70px">
              </div>
            </div>
            <div class="props-group props-half">
              <label>Stroke</label>
              <div class="color-row">
                <input type="color" id="prop-shape-stroke" onchange="applyProp('stroke', this.value)">
                <input type="number" id="prop-stroke-width" min="0" max="20" value="0" placeholder="W" onchange="applyProp('strokeWidth', +this.value)" style="width:45px">
              </div>
            </div>
          </div>
          <div class="props-group">
            <label>Opacity</label>
            <input type="range" id="prop-shape-opacity" min="0" max="1" step="0.01" value="1" oninput="applyPropNum('opacity', +this.value)">
          </div>
          <div class="props-group">
            <label>Corner radius</label>
            <input type="number" id="prop-border-radius" min="0" max="500" value="0" onchange="applyProp('rx', +this.value); applyProp('ry', +this.value)">
          </div>
        </div>

        <div id="props-transform" class="props-section" style="display:none">
          <div class="props-group">
            <label>Position &amp; Size</label>
            <div class="props-row">
              <div class="props-mini"><label>X</label><input type="number" id="prop-x" onchange="applyTransform()"></div>
              <div class="props-mini"><label>Y</label><input type="number" id="prop-y" onchange="applyTransform()"></div>
              <div class="props-mini"><label>W</label><input type="number" id="prop-w" onchange="applyTransform()"></div>
              <div class="props-mini"><label>H</label><input type="number" id="prop-h" onchange="applyTransform()"></div>
              <div class="props-mini"><label>°</label><input type="number" id="prop-angle" min="-360" max="360" onchange="applyProp('angle', +this.value)"></div>
            </div>
          </div>
          <div class="props-group">
            <label>Layer order</label>
            <div class="props-row">
              <button type="button" class="cs-btn-icon-sm" onclick="studioLayerOrder('front')">⤒ Top</button>
              <button type="button" class="cs-btn-icon-sm" onclick="studioLayerOrder('forward')">↑ Fwd</button>
              <button type="button" class="cs-btn-icon-sm" onclick="studioLayerOrder('backward')">↓ Back</button>
              <button type="button" class="cs-btn-icon-sm" onclick="studioLayerOrder('back')">⤓ Bot</button>
            </div>
          </div>
          <div class="props-group">
            <div class="props-row">
              <button type="button" class="cs-btn-danger" onclick="studioDeleteSelected()">🗑 Delete</button>
              <button type="button" class="cs-btn-secondary" onclick="studioDuplicate()">⧉ Duplicate</button>
            </div>
          </div>
        </div>

        <div class="props-section">
          <div class="props-group">
            <label>Brand colours</label>
            <div class="brand-swatches">
              <div class="swatch" style="background:#0E1A63" onclick="applySwatchToSelected('#0E1A63')" title="Navy #0E1A63"></div>
              <div class="swatch" style="background:#7C3AED" onclick="applySwatchToSelected('#7C3AED')" title="Purple #7C3AED"></div>
              <div class="swatch" style="background:#FAFCF9" onclick="applySwatchToSelected('#FAFCF9')" title="Off-white #FAFCF9"></div>
              <div class="swatch" style="background:#FFFFFF;border:1px solid #e2e8f0" onclick="applySwatchToSelected('#FFFFFF')" title="White"></div>
              <div class="swatch" style="background:#000000" onclick="applySwatchToSelected('#000000')" title="Black"></div>
            </div>
          </div>
        </div>

        <div id="props-video-analyze" class="props-section" style="display:none">
          <div class="props-group">
            <label>Video analysis</label>
            <div style="margin-bottom:8px;">
              <div style="display:flex; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:2px; margin-bottom:6px;">
                <button type="button" id="btn-mode-lite" onclick="setAnalysisMode('lite')"
                  style="flex:1; padding:5px 0; border:none; border-radius:6px; font-size:10px; font-weight:600; cursor:pointer; background:#7C3AED; color:#fff; transition:all .15s;">
                  ⚡ Lite
                </button>
                <button type="button" id="btn-mode-deep" onclick="setAnalysisMode('deep')"
                  style="flex:1; padding:5px 0; border:none; border-radius:6px; font-size:10px; font-weight:600; cursor:pointer; background:transparent; color:#64748b; transition:all .15s;">
                  🧠 Deep
                </button>
              </div>
              <div id="studio-analyze-mode-desc"
                style="font-size:9px; color:#64748b; text-align:center; margin-bottom:6px; min-height:24px; line-height:1.4;">
                ⚡ <strong style="color:#94a3b8;">Lite:</strong> 3 frames · text &amp; colors only · ~$0.01
              </div>
              <button type="button" id="btn-run-analyze" onclick="triggerAnalysis()"
                style="width:100%; background:#7C3AED; color:#fff; border:none; border-radius:6px; padding:7px; font-size:11px; font-weight:600; cursor:pointer;">
                ⚡ Run Lite Analysis
              </button>
            </div>
            <div id="studio-cache-notice" style="display:none; font-size:9px; color:#10B981; text-align:center; margin-top:4px;">
              ✅ Using cached analysis · <a href="#" onclick="return clearAnalysisCache()" style="color:#64748b; text-decoration:underline;">Re-run</a>
            </div>
            <div id="studio-analyze-progress" style="display:none; margin-top:8px;">
              <div id="studio-analyze-status" style="font-size:10px; color:#94a3b8; line-height:1.4;"></div>
            </div>
            <div id="studio-element-list-section" style="display:none; margin-top:10px;">
              <div style="font-size:10px; font-weight:700; color:#a78bfa; letter-spacing:.05em; margin-bottom:6px;">
                DETECTED ELEMENTS
              </div>
              <div id="studio-element-list"
                style="display:flex; flex-direction:column; gap:4px; max-height:300px; overflow-y:auto;">
              </div>
              <div id="studio-element-editor"
                style="display:none; margin-top:8px; padding:10px; background:#1e293b; border-radius:8px; border:1px solid #334155;">
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="cs-chat-panel" class="cs-chat-content" style="display:none">
        <div id="cs-chat-messages" class="chat-messages">
          <div class="chat-msg assistant">
            <div class="chat-bubble">Hi! I'm your design assistant. Tell me what to change — "make the headline bigger", "try a darker background", "move the logo to the top right" — I'll handle it.</div>
          </div>
        </div>
        <div id="cs-variation-picker" style="display:none" class="variation-picker">
          <p class="variation-title">Choose a direction:</p>
          <div id="cs-variation-thumbs" class="variation-thumbs"></div>
        </div>
        <div id="cs-preview-modal" class="preview-modal" style="display:none">
          <div class="preview-modal-inner">
            <p id="cs-preview-desc" class="preview-desc"></p>
            <div class="preview-modal-actions">
              <button type="button" onclick="applyPendingOps()" class="cs-btn-approve">Apply</button>
              <button type="button" onclick="cancelPendingOps()" class="cs-btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
        <div class="chat-input-area">
          <textarea id="cs-chat-input" placeholder="Describe a change..." rows="2" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendStudioChat();}"></textarea>
          <button type="button" onclick="sendStudioChat()" class="chat-send-btn" id="cs-chat-send">→</button>
        </div>
      </div>

      <div id="cs-history-panel" class="cs-history-content" style="display:none">
        <div class="cs-panel-title">VERSION HISTORY</div>
        <div id="cs-history-list"></div>
      </div>
    </div>
  </div>
</div>`;
  }

  function monthPosts(data) {
    const monthStr = new Date().toISOString().substring(0, 7);
    const all = (data && data.content || []).filter(function (p) { return p.status !== 'Rejected'; });
    const monthOrCharity = all.filter(function (p) {
      return String(p.scheduled_date || '').startsWith(monthStr) || String(p.client_type_mode || '') === 'charity';
    });
    const list = monthOrCharity.length ? monthOrCharity : all.slice(0, 24);
    return list.sort(function (a, b) {
      return String(a.scheduled_date || '').localeCompare(String(b.scheduled_date || ''));
    });
  }

  function resolvePostImage(post) {
    if (typeof global.resolveImageUrl === 'function') return global.resolveImageUrl(post) || '';
    const f = postFields(post);
    return f.image_url || (Array.isArray(f.media) && f.media[0] && f.media[0].url) || '';
  }

  // ── Public: render into #dash-content ───────────────────────────────────
  function renderCreationStudio(data) {
    const content = document.getElementById('dash-content');
    if (!content) return;
    if (typeof fabric === 'undefined') {
      content.innerHTML = '<div style="padding:40px;color:#fff;">Loading Fabric.js…</div>';
      setTimeout(function () { renderCreationStudio(data); }, 200);
      return;
    }

    global.__clientData = data;
    global.__clientEmail = global.clientEmail || global._seEmail || '';
    global.__clientHash = global.clientHash || global._seHash || '';

    const posts = monthPosts(data);
    content.innerHTML = creationStudioMarkup();

    const sel = document.getElementById('cs-post-select');
    sel.innerHTML = posts.length
      ? posts.map(function (p) {
          const f = postFields(p);
          const label = f.post_label || String(f.caption || '').split('\n')[0] || 'Untitled';
          return '<option value="' + esc(p.id) + '">' + esc(label) + ' · ' + esc(f.status || '') + '</option>';
        }).join('')
      : '<option value="">No posts yet</option>';

    let post = posts[0] || null;
    if (global._csSelectedPostId) {
      post = posts.find(function (p) { return p.id === global._csSelectedPostId; }) || post;
    }
    if (post) {
      sel.value = post.id;
      global._csSelectedPostId = post.id;
    }

    sel.onchange = function () {
      const next = posts.find(function (p) { return p.id === sel.value; });
      if (!next) return;
      global._csSelectedPostId = next.id;
      studioSaved = { '9:16': null, '1:1': null, '4:5': null };
      studioHistory = [];
      studioHistoryIdx = -1;
      initCreationStudio(next);
    };

    document.querySelectorAll('.cs-fmt').forEach(function (btn) {
      btn.addEventListener('click', function () { switchFormat(btn.dataset.fmt); });
    });

    initCreationStudio(post);
  }

  function initCreationStudio(post) {
    studioPost = post;
    const f = postFields(post);
    const nameEl = document.getElementById('cs-post-name');
    if (nameEl) nameEl.textContent = f.post_label || f.theme || 'Untitled post';

    const fmt = STUDIO_FORMATS[studioFormat];
    const wrapper = document.getElementById('cs-canvas-wrapper');
    if (!wrapper) return;
    wrapper.style.width = fmt.displayW + 'px';
    wrapper.style.height = fmt.displayH + 'px';
    wrapper.style.transform = 'scale(1)';
    studioZoom = 1;

    if (studioCanvas) {
      studioVideoBlobUrls.forEach(function (url) { try { URL.revokeObjectURL(url); } catch (_) {} });
      studioVideoBlobUrls = [];
      stopVideoRenderLoop();
      updateVideoToolbar(false);
      try { studioCanvas.dispose(); } catch (e) {}
      studioCanvas = null;
    }

    studioCanvas = new fabric.Canvas('studio-canvas', {
      width: fmt.displayW,
      height: fmt.displayH,
      backgroundColor: '#0E1A63',
      preserveObjectStacking: true,
      selection: true,
      enableRetinaScaling: false,
    });
    global.studioCanvas = studioCanvas;
    if (studioCanvas.wrapperEl) {
      studioCanvas.wrapperEl.style.background = 'transparent';
      studioCanvas.wrapperEl.style.zIndex = '1';
    }

    studioCanvas.on('selection:created', updatePropsPanel);
    studioCanvas.on('selection:updated', updatePropsPanel);
    studioCanvas.on('selection:cleared', clearPropsPanel);
    studioCanvas.on('object:modified', function () { saveHistory('Manual edit'); updateLayerPanel(); });
    studioCanvas.on('object:added', updateLayerPanel);
    studioCanvas.on('object:removed', updateLayerPanel);
    studioCanvas.on('mouse:down', function (opt) { handleSAMClick(opt); });

    if (!studioKeyBound) {
      document.addEventListener('keydown', studioKeyHandler, false);
      studioKeyBound = true;
    }

    const imageUrl = resolvePostImage(post);
    if (imageUrl) {
      loadBackgroundImage(imageUrl);
    }
    // Always add text elements on top — they render over the background
    // Small timeout lets Fabric finish initializing before we add objects
    setTimeout(function () {
      if (!studioCanvas) return;
      if (studioCanvas.getObjects().filter(function (o) { return ['i-text', 'text'].includes(o.type); }).length === 0) {
        addHeadlineFromPost();
      }
    }, 800);

    updateLayerPanel();
    saveHistory('Initial load');
    updateZoomLabel();
    clearPropsPanel();
  }

  function switchFormat(newFmt) {
    if (!studioCanvas || newFmt === studioFormat) return;

    studioVideoBlobUrls.forEach(function (url) { try { URL.revokeObjectURL(url); } catch (_) {} });
    studioVideoBlobUrls = [];
    stopVideoRenderLoop();
    updateVideoToolbar(false);

    const prevFmtKey = studioFormat;
    studioSaved[prevFmtKey] = studioCanvas.toJSON(['name', 'locked', 'selectable', 'evented', 'hfPrompt', 'isVideo']);

    document.querySelectorAll('.cs-fmt').forEach(function (b) {
      b.classList.toggle('active', b.dataset.fmt === newFmt);
    });
    studioFormat = newFmt;

    const fmt = STUDIO_FORMATS[newFmt];
    const wrapper = document.getElementById('cs-canvas-wrapper');
    wrapper.style.width = fmt.displayW + 'px';
    wrapper.style.height = fmt.displayH + 'px';
    studioCanvas.setWidth(fmt.displayW);
    studioCanvas.setHeight(fmt.displayH);

    if (studioSaved[newFmt]) {
      studioCanvas.loadFromJSON(studioSaved[newFmt], function () {
        studioCanvas.renderAll();
        updateLayerPanel();
      });
    } else {
      const currentJson = JSON.parse(JSON.stringify(studioSaved[prevFmtKey] || { objects: [], background: '#0E1A63' }));
      const prevFmt = STUDIO_FORMATS[prevFmtKey];
      const scaleX = fmt.displayW / prevFmt.displayW;
      const scaleY = fmt.displayH / prevFmt.displayH;
      (currentJson.objects || []).forEach(function (obj) {
        obj.left = (obj.left || 0) * scaleX;
        obj.top = (obj.top || 0) * scaleY;
        if (obj.width) obj.width *= scaleX;
        if (obj.height) obj.height *= scaleY;
      });
      studioCanvas.loadFromJSON(currentJson, function () {
        studioCanvas.renderAll();
        updateLayerPanel();
      });
    }
    updateZoomLabel();
  }

  function loadBackgroundImage(url) {
    fabric.Image.fromURL(url, function (img) {
      if (!img || (img.width === 0 && img.height === 0)) {
        // Image failed to load (CORS, expired URL, etc) — add text instead
        console.warn('[Studio] Background image failed to load:', url);
        if (studioCanvas && studioCanvas.getObjects().filter(function (o) { return ['i-text', 'text'].includes(o.type); }).length === 0) {
          addHeadlineFromPost();
        }
        return;
      }
      if (!studioCanvas) return;
      img.set({ name: 'background', selectable: true, evented: true, locked: false, left: 0, top: 0 });
      const scaleX = studioCanvas.width / img.width;
      const scaleY = studioCanvas.height / img.height;
      const s = Math.max(scaleX, scaleY);
      img.set({ scaleX: s, scaleY: s });
      const existing = studioCanvas.getObjects().find(function (o) { return o.name === 'background'; });
      if (existing) studioCanvas.remove(existing);
      studioCanvas.insertAt(img, 0, false);
      studioCanvas.renderAll();
      updateLayerPanel();
      saveHistory('Background loaded');
    }, { crossOrigin: 'anonymous' });
  }

  function addHeadlineFromPost() {
    if (!studioPost || !studioCanvas) return;
    const f = postFields(studioPost);
    const caption = f.caption || '';
    const headline = caption.split('\n')[0] || f.post_label || 'Add your headline here';
    const fmt = STUDIO_FORMATS[studioFormat];
    const text = new fabric.IText(String(headline).substring(0, 80), {
      name: 'headline',
      left: fmt.displayW * 0.05,
      top: fmt.displayH * 0.55,
      width: fmt.displayW * 0.9,
      fontFamily: 'Newsreader',
      fontSize: fmt.displayW * 0.065,
      fill: '#FAFCF9',
      fontWeight: 'bold',
      lineHeight: 1.2,
      selectable: true,
      evented: true,
      locked: false,
    });
    studioCanvas.add(text);
    studioCanvas.renderAll();
  }

  function updateLayerPanel() {
    const list = document.getElementById('cs-layer-list');
    if (!list || !studioCanvas) return;
    const objects = studioCanvas.getObjects().slice().reverse();
    const selected = studioCanvas.getActiveObject();
    list.innerHTML = objects.map(function (obj, i) {
      const realIdx = studioCanvas.getObjects().length - 1 - i;
      const isSelected = obj === selected;
      const typeIcon = obj.isVideo ? '🎬' : ({ 'i-text': 'T', 'text': 'T', 'image': '🖼', 'rect': '□', 'ellipse': '○', 'line': '—', 'group': '⊞' }[obj.type] || '◆');
      const name = obj.name || obj.type || 'Object';
      const isVisible = obj.visible !== false;
      const isLocked = obj.locked || !obj.selectable;
      return '<div class="layer-item ' + (isSelected ? 'selected' : '') + (isLocked ? ' layer-locked' : '') + '" onclick="selectLayerObject(' + realIdx + ')">' +
        '<span class="layer-icon">' + typeIcon + '</span>' +
        '<span class="layer-name">' + esc(name) + '</span>' +
        '<span class="layer-vis" onclick="event.stopPropagation();toggleLayerVisibility(' + realIdx + ')">' + (isVisible ? '👁' : '○') + '</span>' +
        '<span class="layer-lock" onclick="event.stopPropagation();toggleLayerLock(' + realIdx + ')">' + (isLocked ? '🔒' : '🔓') + '</span>' +
        '</div>';
    }).join('');
  }

  function selectLayerObject(idx) {
    const obj = studioCanvas.getObjects()[idx];
    if (!obj || !obj.selectable) return;
    studioCanvas.setActiveObject(obj);
    studioCanvas.renderAll();
    updatePropsPanel();
  }

  function toggleLayerVisibility(idx) {
    const obj = studioCanvas.getObjects()[idx];
    if (!obj) return;
    obj.set('visible', !obj.visible);
    studioCanvas.renderAll();
    updateLayerPanel();
  }

  function toggleLayerLock(idx) {
    const obj = studioCanvas.getObjects()[idx];
    if (!obj) return;
    const lock = !obj.locked;
    obj.set({ locked: lock, selectable: !lock, evented: !lock });
    studioCanvas.renderAll();
    updateLayerPanel();
  }

  function updatePropsPanel() {
    const obj = studioCanvas && studioCanvas.getActiveObject();
    if (!obj) { clearPropsPanel(); return; }
    document.getElementById('props-empty').style.display = 'none';
    document.getElementById('props-transform').style.display = 'block';
    const isText = ['i-text', 'text'].includes(obj.type);
    const isImage = obj.type === 'image';
    const isShape = ['rect', 'circle', 'ellipse', 'polygon', 'triangle', 'line'].includes(obj.type);
    document.getElementById('props-text').style.display = isText ? 'block' : 'none';
    document.getElementById('props-image').style.display = isImage ? 'block' : 'none';
    document.getElementById('props-shape').style.display = isShape ? 'block' : 'none';

    const fmt = STUDIO_FORMATS[studioFormat];
    const scale = fmt.w / fmt.displayW;
    document.getElementById('prop-x').value = Math.round((obj.left || 0) * scale);
    document.getElementById('prop-y').value = Math.round((obj.top || 0) * scale);
    document.getElementById('prop-w').value = Math.round((obj.getScaledWidth() || 0) * scale);
    document.getElementById('prop-h').value = Math.round((obj.getScaledHeight() || 0) * scale);
    document.getElementById('prop-angle').value = Math.round(obj.angle || 0);

    if (isText) {
      document.getElementById('prop-font-family').value = obj.fontFamily || 'Newsreader';
      document.getElementById('prop-font-size').value = Math.round(obj.fontSize || 40);
      document.getElementById('prop-text-color').value = toHex(obj.fill) || '#FAFCF9';
      document.getElementById('prop-text-color-hex').value = toHex(obj.fill) || '#FAFCF9';
      document.getElementById('prop-line-height').value = obj.lineHeight || 1.2;
      document.getElementById('prop-char-spacing').value = obj.charSpacing || 0;
      document.getElementById('prop-bold').classList.toggle('active', obj.fontWeight === 'bold');
      document.getElementById('prop-italic').classList.toggle('active', obj.fontStyle === 'italic');
      document.getElementById('prop-underline').classList.toggle('active', !!obj.underline);
    }
    if (isImage) {
      document.getElementById('prop-img-opacity').value = obj.opacity ?? 1;
      document.getElementById('prop-img-opacity-val').textContent = Math.round((obj.opacity ?? 1) * 100) + '%';
      document.getElementById('prop-blend').value = obj.globalCompositeOperation || 'source-over';
    }
    if (isShape) {
      document.getElementById('prop-shape-fill').value = toHex(obj.fill) || '#7C3AED';
      document.getElementById('prop-shape-fill-hex').value = toHex(obj.fill) || '#7C3AED';
      document.getElementById('prop-shape-stroke').value = toHex(obj.stroke) || '#000000';
      document.getElementById('prop-stroke-width').value = obj.strokeWidth || 0;
      document.getElementById('prop-shape-opacity').value = obj.opacity ?? 1;
      if (obj.type === 'rect') document.getElementById('prop-border-radius').value = obj.rx || 0;
    }
    updateLayerPanel();
  }

  function clearPropsPanel() {
    const empty = document.getElementById('props-empty');
    if (!empty) return;
    empty.style.display = 'block';
    document.getElementById('props-text').style.display = 'none';
    document.getElementById('props-image').style.display = 'none';
    document.getElementById('props-shape').style.display = 'none';
    document.getElementById('props-transform').style.display = 'none';
  }

  function applyProp(prop, value) {
    const obj = studioCanvas && studioCanvas.getActiveObject();
    if (!obj) return;
    obj.set(prop, value);
    studioCanvas.renderAll();
    saveHistory('Set ' + prop);
    updateLayerPanel();
  }
  function applyPropNum(prop, value) { applyProp(prop, value); }

  function applyTransform() {
    const obj = studioCanvas && studioCanvas.getActiveObject();
    if (!obj) return;
    const fmt = STUDIO_FORMATS[studioFormat];
    const scale = fmt.displayW / fmt.w;
    obj.set({
      left: parseInt(document.getElementById('prop-x').value, 10) * scale,
      top: parseInt(document.getElementById('prop-y').value, 10) * scale,
    });
    obj.setCoords();
    studioCanvas.renderAll();
    saveHistory('Transform');
  }

  function applyTextShadow() {
    const obj = studioCanvas && studioCanvas.getActiveObject();
    if (!obj) return;
    const blur = parseInt(document.getElementById('prop-shadow-blur').value, 10) || 0;
    const offsetX = parseInt(document.getElementById('prop-shadow-x').value, 10) || 0;
    const offsetY = parseInt(document.getElementById('prop-shadow-y').value, 10) || 2;
    const color = document.getElementById('prop-shadow-color').value;
    if (blur === 0 && offsetX === 0 && offsetY === 0) obj.set('shadow', null);
    else obj.set('shadow', new fabric.Shadow({ color: color, blur: blur, offsetX: offsetX, offsetY: offsetY }));
    studioCanvas.renderAll();
    saveHistory('Shadow');
  }

  function applyImageFilter() {
    const obj = studioCanvas && studioCanvas.getActiveObject();
    if (!obj || obj.type !== 'image') return;
    const b = parseFloat(document.getElementById('filt-brightness').value);
    const c = parseFloat(document.getElementById('filt-contrast').value);
    const s = parseFloat(document.getElementById('filt-saturation').value);
    const bl = parseFloat(document.getElementById('filt-blur').value);
    document.getElementById('filt-brightness-val').textContent = b;
    document.getElementById('filt-contrast-val').textContent = c;
    document.getElementById('filt-saturation-val').textContent = s;
    document.getElementById('filt-blur-val').textContent = bl;
    obj.filters = [
      new fabric.Image.filters.Brightness({ brightness: b }),
      new fabric.Image.filters.Contrast({ contrast: c }),
      new fabric.Image.filters.Saturation({ saturation: s }),
      new fabric.Image.filters.Blur({ blur: bl }),
    ];
    obj.applyFilters();
    studioCanvas.renderAll();
  }

  function toggleTextStyle(style) {
    const obj = studioCanvas && studioCanvas.getActiveObject();
    if (!obj) return;
    if (style === 'bold') obj.set('fontWeight', obj.fontWeight === 'bold' ? 'normal' : 'bold');
    if (style === 'italic') obj.set('fontStyle', obj.fontStyle === 'italic' ? 'normal' : 'italic');
    if (style === 'underline') obj.set('underline', !obj.underline);
    studioCanvas.renderAll();
    saveHistory('Toggle ' + style);
    updatePropsPanel();
  }

  function setCanvasBg(color) {
    document.getElementById('prop-canvas-bg-hex').textContent = color;
    studioCanvas.setBackgroundColor(color, studioCanvas.renderAll.bind(studioCanvas));
    saveHistory('Canvas background');
  }

  function applySwatchToSelected(hex) {
    const obj = studioCanvas && studioCanvas.getActiveObject();
    if (!obj) return;
    if (['i-text', 'text'].includes(obj.type)) applyProp('fill', hex);
    else if (obj.type !== 'image') applyProp('fill', hex);
  }

  function showRightTab(tab) {
    document.getElementById('cs-props-panel').style.display = tab === 'props' ? 'block' : 'none';
    document.getElementById('cs-chat-panel').style.display = tab === 'chat' ? 'flex' : 'none';
    document.getElementById('cs-history-panel').style.display = tab === 'history' ? 'block' : 'none';
    document.querySelectorAll('.cs-rtab').forEach(function (b) { b.classList.remove('active'); });
    const rtab = document.getElementById('rtab-' + (tab === 'history' ? 'props' : tab));
    if (rtab) rtab.classList.add('active');
    if (tab === 'chat') document.getElementById('cs-chat-badge').style.display = 'none';
  }

  function studioAddText() {
    const fmt = STUDIO_FORMATS[studioFormat];
    const t = new fabric.IText('Type something', {
      name: 'text-' + Date.now(),
      left: fmt.displayW * 0.1,
      top: fmt.displayH * 0.4,
      fontFamily: 'Instrument Sans',
      fontSize: Math.round(fmt.displayW * 0.045),
      fill: '#FAFCF9',
      selectable: true, evented: true, locked: false,
    });
    studioCanvas.add(t);
    studioCanvas.setActiveObject(t);
    t.enterEditing();
    studioCanvas.renderAll();
    updateLayerPanel();
  }

  function studioAddRect() {
    const fmt = STUDIO_FORMATS[studioFormat];
    const r = new fabric.Rect({
      name: 'shape-' + Date.now(),
      left: fmt.displayW * 0.1,
      top: fmt.displayH * 0.45,
      width: fmt.displayW * 0.3,
      height: Math.max(4, fmt.displayH * 0.02),
      fill: '#7C3AED',
      rx: 0, ry: 0,
      selectable: true, evented: true, locked: false,
    });
    studioCanvas.add(r);
    studioCanvas.setActiveObject(r);
    studioCanvas.renderAll();
    updateLayerPanel();
  }

  function studioAddEllipse() {
    const fmt = STUDIO_FORMATS[studioFormat];
    const e = new fabric.Ellipse({
      name: 'ellipse-' + Date.now(),
      left: fmt.displayW * 0.3,
      top: fmt.displayH * 0.4,
      rx: fmt.displayW * 0.1,
      ry: fmt.displayW * 0.1,
      fill: '#7C3AED',
      selectable: true, evented: true, locked: false,
    });
    studioCanvas.add(e);
    studioCanvas.setActiveObject(e);
    studioCanvas.renderAll();
    updateLayerPanel();
  }

  function studioAddLine() {
    const fmt = STUDIO_FORMATS[studioFormat];
    const l = new fabric.Line([fmt.displayW * 0.05, fmt.displayH * 0.5, fmt.displayW * 0.35, fmt.displayH * 0.5], {
      name: 'line-' + Date.now(),
      stroke: '#7C3AED',
      strokeWidth: 3,
      selectable: true, evented: true, locked: false,
    });
    studioCanvas.add(l);
    studioCanvas.setActiveObject(l);
    studioCanvas.renderAll();
    updateLayerPanel();
  }

  function studioAddImage(input) {
    const file = input.files && input.files[0];
    if (!file) return;

    const isVideo = (file.type && file.type.startsWith('video/')) ||
      /\.(mp4|mov|webm|avi|mkv|m4v|mts)$/i.test(file.name || '');

    if (isVideo) {
      handleVideoUpload(file);
      input.value = '';
      return;
    }

    const modal = document.createElement('div');
    modal.id = 'studio-analyze-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML =
      '<div style="background:#1e293b;border:1px solid #334155;border-radius:16px;padding:32px;max-width:420px;width:90%;">' +
      '<h3 style="color:#e2e8f0;margin:0 0 8px;font-size:18px;">How do you want to add this image?</h3>' +
      '<p style="color:#64748b;font-size:13px;margin:0 0 24px;line-height:1.5;">' +
      '"Analyze &amp; Clone" uses AI to detect all text, shapes, and layers — so you can edit each element separately. ' +
      '"Add as flat layer" drops it in as a single uneditable image.</p>' +
      '<div style="display:flex;flex-direction:column;gap:10px;">' +
      '<button type="button" id="btn-analyze" style="padding:14px;border-radius:10px;background:#7C3AED;border:none;color:#fff;font-weight:700;font-size:14px;cursor:pointer;text-align:left;">' +
      '✦ Analyze &amp; Clone — extract editable layers' +
      '<span style="display:block;font-size:12px;font-weight:400;opacity:.8;margin-top:3px;">AI reads every text element, detects colors, reconstructs as editable layers</span></button>' +
      '<button type="button" id="btn-flat" style="padding:14px;border-radius:10px;background:transparent;border:1px solid #334155;color:#cbd5e1;font-weight:600;font-size:14px;cursor:pointer;text-align:left;">' +
      'Add as flat image layer' +
      '<span style="display:block;font-size:12px;font-weight:400;opacity:.7;margin-top:3px;">Drops it in as a single object — position and scale only</span></button>' +
      '<button type="button" id="btn-cancel" style="padding:10px;border-radius:8px;background:transparent;border:none;color:#475569;font-size:13px;cursor:pointer;">Cancel</button>' +
      '</div></div>';
    document.body.appendChild(modal);

    // Read file once up front so button handlers don't race FileReader
    const dataUrlPromise = new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function (e) { resolve(e.target.result); };
      reader.onerror = function () { reject(new Error('Failed to read file')); };
      reader.readAsDataURL(file);
    });

    function addFlatFromDataUrl(dataUrl) {
      fabric.Image.fromURL(dataUrl, function (img) {
        const fmt = STUDIO_FORMATS[studioFormat];
        const scale = Math.min(fmt.displayW / img.width, fmt.displayH / img.height);
        img.set({
          name: file.name.replace(/\.[^.]+$/, '') || 'image-' + Date.now(),
          left: 0, top: 0, scaleX: scale, scaleY: scale,
          selectable: true, evented: true, locked: false,
        });
        studioCanvas.add(img);
        studioCanvas.setActiveObject(img);
        studioCanvas.renderAll();
        updateLayerPanel();
        saveHistory('Image added');
      });
    }

    document.getElementById('btn-cancel').onclick = function () {
      modal.remove();
      input.value = '';
    };

    document.getElementById('btn-flat').onclick = async function () {
      modal.remove();
      try {
        const dataUrl = await dataUrlPromise;
        addFlatFromDataUrl(dataUrl);
      } catch (e) {
        if (typeof global.showToast === 'function') global.showToast('Could not load image');
      }
      input.value = '';
    };

    document.getElementById('btn-analyze').onclick = async function () {
      modal.remove();
      showRightTab('chat');
      addChatMsg('assistant', '✦ Analyzing your design… extracting all text, colors, and layers. This takes 5-10 seconds.');
      try {
        const dataUrl = await dataUrlPromise;
        const blob = await fetch(dataUrl).then(function (r) { return r.blob(); });
        const formData = new FormData();
        formData.append('image', blob, file.name || 'design.png');

        const email = global.__clientEmail || global.clientEmail || global._seEmail || '';
        const hash = global.__clientHash || global.clientHash || global._seHash || '';
        const uploadResp = await fetch(apiBase() + '/api/studio/upload-image', {
          method: 'POST',
          headers: { 'x-client-email': email, 'x-client-hash': hash },
          body: formData,
        });
        const uploadData = await uploadResp.json();
        if (!uploadData.url) throw new Error('Image upload failed');

        const analyzeResp = await studioFetch('/api/studio/analyze-image', {
          method: 'POST',
          body: JSON.stringify({ imageUrl: uploadData.url, format: studioFormat }),
        });

        await reconstructCanvasFromAnalysis(dataUrl, analyzeResp);
        addChatMsg('assistant', '✓ Done! Found ' + (analyzeResp.layers || []).length + ' layers — all text is now editable. Click any element to select and edit it.');
      } catch (err) {
        addChatMsg('assistant', '❌ Analysis failed: ' + err.message + '. Adding as flat layer instead.');
        try {
          const dataUrl = await dataUrlPromise;
          addFlatFromDataUrl(dataUrl);
        } catch (_) {}
      }
      input.value = '';
    };
  }

  // ── Video: native HTML5 <video> behind Fabric canvas ───────────────────
  function startVideoRenderLoop() {
    // No-op — browser renders <video> natively; no RAF needed
    studioVideoLoop = true;
  }

  function stopVideoRenderLoop() {
    studioVideoLoop = false;
    studioVideoLoopId = null;
    global._studioActiveVideo = null;
    const v = document.getElementById('studio-video-player');
    if (v) {
      try { v.pause(); } catch (_) {}
      v.style.display = 'none';
      v.removeAttribute('src');
      try { v.load(); } catch (_) {}
    }
    studioVideoElements = [];
    if (studioCanvas) {
      studioCanvas.backgroundColor = '#0E1A63';
      if (studioCanvas.lowerCanvasEl) studioCanvas.lowerCanvasEl.style.background = '';
      studioCanvas.renderAll();
    }
  }

  async function addVideoToCanvas(videoUrl, videoMime, label) {
    const videoEl = document.getElementById('studio-video-player');
    if (!videoEl) {
      addChatMsg('assistant', '❌ Video element missing from HTML — check portal.html has <video id="studio-video-player"> inside cs-canvas-wrapper.');
      return;
    }

    addChatMsg('assistant', '📹 Loading ' + (label || 'video') + '…');

    videoEl.pause();
    videoEl.removeAttribute('src');
    videoEl.load();
    studioVideoElements = [videoEl];

    videoEl.src = videoUrl;

    const canPlay = await new Promise(function (resolve) {
      function onOk() {
        videoEl.removeEventListener('canplay', onOk);
        videoEl.removeEventListener('error', onErr);
        resolve(true);
      }
      function onErr() {
        videoEl.removeEventListener('canplay', onOk);
        videoEl.removeEventListener('error', onErr);
        resolve(false);
      }
      videoEl.addEventListener('canplay', onOk, { once: true });
      videoEl.addEventListener('error', onErr, { once: true });
      videoEl.load();
    });

    if (!canPlay) {
      addChatMsg('assistant', '❌ "' + (label || 'video') + '" failed to load. Check the file isn\'t corrupted and is a supported format (MP4, WebM, MOV).');
      return;
    }

    videoEl.style.display = 'block';

    studioCanvas.backgroundColor = 'rgba(0,0,0,0)';
    if (studioCanvas.lowerCanvasEl) studioCanvas.lowerCanvasEl.style.background = 'transparent';
    if (studioCanvas.wrapperEl) studioCanvas.wrapperEl.style.background = 'transparent';
    studioCanvas.renderAll();

    try {
      await videoEl.play();
    } catch (e) {
      console.warn('[Studio] Autoplay:', e.message);
    }

    global._studioActiveVideo = videoEl;

    studioCanvas.getObjects().filter(function (o) { return o.isVideo; }).forEach(function (o) {
      studioCanvas.remove(o);
    });
    const placeholder = new fabric.Rect({
      name: label || 'video',
      width: 1,
      height: 1,
      opacity: 0,
      selectable: false,
      evented: false,
      isVideo: true,
    });
    studioCanvas.add(placeholder);
    studioCanvas.renderAll();

    updateLayerPanel();
    updateVideoToolbar(true);
    saveHistory('Video added');

    const dur = isFinite(videoEl.duration) ? Math.round(videoEl.duration) + 's' : '';
    addChatMsg('assistant',
      '✓ "' + (label || 'video') + '" playing' + (dur ? ' (' + dur + ')' : '') + '. ' +
      'Add text/shapes — they overlay the video. ' +
      '💡 Want me to detect text in this video?'
    );
    const msgs = document.getElementById('cs-chat-messages');
    if (msgs) {
      const wrap = document.createElement('div');
      wrap.className = 'chat-msg assistant';
      wrap.innerHTML = '<div class="chat-bubble" style="padding-top:4px">' +
        '<button type="button" onclick="captureFrameAndAnalyze()" ' +
        'style="background:#7C3AED;border:none;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;">' +
        '✦ Analyze frame</button></div>';
      msgs.appendChild(wrap);
      msgs.scrollTop = msgs.scrollHeight;
    }
  }

  function extractFrameFromVideo(videoEl, timeSeconds) {
    timeSeconds = timeSeconds == null ? 1.5 : timeSeconds;
    return new Promise(function (resolve) {
      const tmp = document.createElement('canvas');
      tmp.width = videoEl.videoWidth || 1080;
      tmp.height = videoEl.videoHeight || 1920;
      const ctx = tmp.getContext('2d');
      function seek() {
        ctx.drawImage(videoEl, 0, 0, tmp.width, tmp.height);
        resolve(tmp.toDataURL('image/jpeg', 0.88));
      }
      if (Math.abs(videoEl.currentTime - timeSeconds) < 0.1) {
        seek();
      } else {
        videoEl.addEventListener('seeked', seek, { once: true });
        videoEl.currentTime = Math.min(timeSeconds, (videoEl.duration || 2) - 0.1);
      }
    });
  }

  function updateVideoToolbar(hasVideo) {
    let vbar = document.getElementById('cs-video-toolbar');
    const analyzePanel = document.getElementById('props-video-analyze');
    if (analyzePanel) analyzePanel.style.display = hasVideo ? 'block' : 'none';

    if (!hasVideo) {
      if (vbar) {
        if (vbar._timeInterval) clearInterval(vbar._timeInterval);
        vbar.style.display = 'none';
      }
      return;
    }
    if (!vbar) {
      vbar = document.createElement('div');
      vbar.id = 'cs-video-toolbar';
      vbar.className = 'cs-video-toolbar';
      const canvasArea = document.querySelector('.cs-canvas-area');
      const bottomBar = document.querySelector('.cs-canvas-toolbar');
      if (canvasArea && bottomBar) canvasArea.insertBefore(vbar, bottomBar);
      else if (canvasArea) canvasArea.appendChild(vbar);
    }
    vbar.style.display = 'flex';
    vbar.innerHTML =
      '<span class="vt-label">▶ VIDEO</span>' +
      '<button type="button" class="cs-tool vt-btn" id="vt-play" onclick="toggleVideoPlay()" title="Play/Pause (Space)">⏸ Pause</button>' +
      '<button type="button" class="cs-tool vt-btn" onclick="seekVideo(-5)" title="Back 5s">⏮ 5s</button>' +
      '<button type="button" class="cs-tool vt-btn" onclick="seekVideo(5)" title="Fwd 5s">5s ⏭</button>' +
      '<input type="range" id="vt-seek" min="0" max="100" value="0" step="0.1" oninput="scrubVideo(+this.value)" style="flex:1;accent-color:#7C3AED">' +
      '<span id="vt-time" style="font-size:11px;color:#64748b;min-width:50px;text-align:right">0:00</span>' +
      '<div class="vt-divider"></div>' +
      '<button type="button" class="cs-tool vt-btn" onclick="muteToggleVideo()" id="vt-mute" title="Mute/Unmute">🔇</button>' +
      '<button type="button" class="cs-tool vt-btn" onclick="exportVideoWithOverlays()" title="Export video with overlays as WebM">⬇ Export video</button>' +
      '<button type="button" class="cs-tool vt-btn" onclick="exportVideoFrame()" title="Export current frame as PNG">⬇ Frame PNG</button>';

    const primaryVid = document.getElementById('studio-video-player');
    if (primaryVid) {
      if (vbar._timeInterval) clearInterval(vbar._timeInterval);
      vbar._timeInterval = setInterval(function () {
        if (!primaryVid.duration) return;
        const pct = (primaryVid.currentTime / primaryVid.duration) * 100;
        const seekEl = document.getElementById('vt-seek');
        const timeEl = document.getElementById('vt-time');
        if (seekEl) seekEl.value = pct;
        if (timeEl) {
          const m = Math.floor(primaryVid.currentTime / 60);
          const s = Math.floor(primaryVid.currentTime % 60).toString().padStart(2, '0');
          timeEl.textContent = m + ':' + s;
        }
      }, 250);
    }
  }

  function toggleVideoPlay() {
    const v = document.getElementById('studio-video-player');
    const btn = document.getElementById('vt-play');
    if (!v) return;
    if (v.paused) {
      v.play().catch(function () {});
      if (btn) btn.textContent = '⏸ Pause';
    } else {
      v.pause();
      if (btn) btn.textContent = '▶ Play';
    }
  }

  function seekVideo(delta) {
    const v = document.getElementById('studio-video-player');
    if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
  }

  function scrubVideo(pct) {
    const v = document.getElementById('studio-video-player');
    if (v && v.duration) v.currentTime = (pct / 100) * v.duration;
  }

  function muteToggleVideo() {
    const v = document.getElementById('studio-video-player');
    const btn = document.getElementById('vt-mute');
    if (!v) return;
    v.muted = !v.muted;
    if (btn) btn.textContent = v.muted ? '🔇' : '🔊';
  }

  async function exportVideoWithOverlays() {
    const vid = document.getElementById('studio-video-player') || global._studioActiveVideo;
    if (!vid || vid.style.display === 'none') {
      addChatMsg('assistant', '❌ No video loaded.');
      return;
    }

    const fmt = STUDIO_FORMATS[studioFormat];
    const duration = vid.duration || 15;

    const compCanvas = document.createElement('canvas');
    compCanvas.width = fmt.displayW;
    compCanvas.height = fmt.displayH;
    const compCtx = compCanvas.getContext('2d');

    addChatMsg('assistant', '⏺ Recording ' + Math.round(duration) + 's…');

    try {
      const stream = compCanvas.captureStream(30);
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9' : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType: mimeType, videoBitsPerSecond: 8000000 });
      const chunks = [];
      recorder.ondataavailable = function (e) {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      let recording = true;
      function recordTick() {
        if (!recording) return;
        compCtx.clearRect(0, 0, compCanvas.width, compCanvas.height);
        if (vid.readyState >= 2) compCtx.drawImage(vid, 0, 0, compCanvas.width, compCanvas.height);
        if (studioCanvas && studioCanvas.lowerCanvasEl) {
          compCtx.drawImage(studioCanvas.lowerCanvasEl, 0, 0);
        }
        requestAnimationFrame(recordTick);
      }

      await new Promise(function (resolve, reject) {
        recorder.onstop = resolve;
        recorder.onerror = reject;
        recorder.start(100);
        vid.currentTime = 0;
        vid.play().catch(function () {});
        recordTick();
        setTimeout(function () {
          recording = false;
          recorder.stop();
        }, duration * 1000 + 300);
      });

      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const f = postFields(studioPost);
      a.download = (f.post_label || 'reel') + '-with-overlays.webm';
      a.click();
      URL.revokeObjectURL(url);
      addChatMsg('assistant', '✓ Video exported with overlays!');
    } catch (e) {
      addChatMsg('assistant', '❌ Export failed: ' + e.message + '. Try the "Frame PNG" option instead.');
    }
  }

  function buildCompositeCanvas() {
    const fmt = STUDIO_FORMATS[studioFormat];
    const out = document.createElement('canvas');
    out.width = fmt.w;
    out.height = fmt.h;
    const ctx = out.getContext('2d');
    const v = document.getElementById('studio-video-player');
    const scale = fmt.w / fmt.displayW;

    if (v && v.style.display !== 'none' && v.readyState >= 2) {
      ctx.drawImage(v, 0, 0, fmt.w, fmt.h);
    } else {
      ctx.fillStyle = '#0E1A63';
      ctx.fillRect(0, 0, fmt.w, fmt.h);
    }

    if (studioCanvas && studioCanvas.lowerCanvasEl) {
      ctx.save();
      ctx.scale(scale, scale);
      ctx.drawImage(studioCanvas.lowerCanvasEl, 0, 0);
      ctx.restore();
    }
    return out;
  }

  function exportVideoFrame() {
    const exportCanvas = buildCompositeCanvas();
    const a = document.createElement('a');
    a.href = exportCanvas.toDataURL('image/png');
    const f = postFields(studioPost);
    a.download = (f.post_label || 'frame') + '-thumbnail.png';
    a.click();
    addChatMsg('assistant', '✓ Frame exported as PNG — great for thumbnails!');
  }

  async function handleVideoUpload(file) {
    showRightTab('chat');
    addChatMsg('assistant', '📹 Loading ' + file.name + ' (' + (file.size / 1024 / 1024).toFixed(1) + 'MB)…');

    // Blob URL for instant same-origin playback — avoids Atlas Content-Disposition:attachment
    const blobUrl = URL.createObjectURL(file);
    studioVideoBlobUrls.push(blobUrl);

    try {
      await addVideoToCanvas(blobUrl, file.type, file.name.replace(/\.[^.]+$/, ''));
    } catch (e) {
      addChatMsg('assistant', '❌ Video failed to load: ' + e.message);
      return;
    }

    // CDN upload in background for persistence only
    uploadVideoToServerBackground(file).catch(function (e) {
      console.warn('[Studio] Background video upload failed:', e.message);
    });
  }

  async function uploadVideoToServerBackground(file) {
    const formData = new FormData();
    formData.append('video', file, file.name);
    const email = global.__clientEmail || global.clientEmail || global._seEmail || '';
    const hash = global.__clientHash || global.clientHash || global._seHash || '';
    const resp = await fetch(apiBase() + '/api/studio/upload-video', {
      method: 'POST',
      headers: { 'x-client-email': email, 'x-client-hash': hash },
      body: formData,
    });
    if (!resp.ok) return;
    const data = await resp.json();
    if (data && (data.url || data.atlasUrl || data.videoUrl)) {
      studioServerVideoUrl = data.url || data.atlasUrl || data.videoUrl;
    }
    const vidObj = studioCanvas && studioCanvas.getObjects().find(function (o) { return o.isVideo; });
    if (vidObj) vidObj.cdnUrl = studioServerVideoUrl;

    if (data.frameDataUrl) {
      studioPendingFrameDataUrl = data.frameDataUrl;
    }
    if (studioServerVideoUrl) {
      showStudioToast('Video uploaded — Deep analysis available');
    }
  }

  async function captureFrameAndAnalyze() {
    const v = document.getElementById('studio-video-player');
    if (!v || v.readyState < 2) {
      addChatMsg('assistant', '❌ Video not ready yet.');
      return;
    }
    if (studioAnalysisInProgress) {
      addChatMsg('assistant', '⏳ Analysis in progress…');
      return;
    }
    studioAnalysisInProgress = true;
    showRightTab('chat');
    addChatMsg('assistant', '✦ Capturing frame and analyzing for text…');

    try {
      const tmp = document.createElement('canvas');
      tmp.width = v.videoWidth || 1080;
      tmp.height = v.videoHeight || 1920;
      tmp.getContext('2d').drawImage(v, 0, 0, tmp.width, tmp.height);
      const dataUrl = tmp.toDataURL('image/jpeg', 0.88);

      const blob = await fetch(dataUrl).then(function (r) { return r.blob(); });
      const fd = new FormData();
      fd.append('image', blob, 'frame.jpg');
      const email = global.__clientEmail || global.clientEmail || global._seEmail || '';
      const hash = global.__clientHash || global.clientHash || global._seHash || '';
      const upResp = await fetch(apiBase() + '/api/studio/upload-image', {
        method: 'POST',
        headers: { 'x-client-email': email, 'x-client-hash': hash },
        body: fd,
      });
      const upData = await upResp.json();
      if (!upData.url) throw new Error('Frame upload failed');

      const analysis = await studioFetch('/api/studio/analyze-image', {
        method: 'POST',
        body: JSON.stringify({ imageUrl: upData.url, format: studioFormat }),
      });

      const fmt = STUDIO_FORMATS[studioFormat];
      const fsMap = {
        small: fmt.displayH * 0.025,
        medium: fmt.displayH * 0.04,
        large: fmt.displayH * 0.06,
        xlarge: fmt.displayH * 0.09,
        xxlarge: fmt.displayH * 0.13,
      };
      let added = 0;
      const layers = analysis.layers || [];
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        if (layer.type !== 'text') continue;
        const t = new fabric.IText(String(layer.content || '').replace(/\\n/g, '\n'), {
          name: (layer.isHeadline ? 'headline' : 'text') + '-' + Date.now() + '-' + i,
          left: (layer.left / 100) * fmt.displayW,
          top: (layer.top / 100) * fmt.displayH,
          width: fmt.displayW * 0.88,
          fontFamily: layer.isHeadline ? 'Newsreader' : 'Instrument Sans',
          fontSize: fsMap[layer.fontSize] || fsMap.medium,
          fill: layer.color || '#FFFFFF',
          fontWeight: layer.fontWeight || 'normal',
          textAlign: layer.textAlign || 'left',
          lineHeight: 1.15,
          selectable: true,
          evented: true,
        });
        studioCanvas.add(t);
        added++;
      }
      studioCanvas.renderAll();
      updateLayerPanel();
      saveHistory('AI: text from video');
      addChatMsg('assistant', '✓ Found ' + added + ' text element' + (added === 1 ? '' : 's') + ' — all editable on top of video.');
    } catch (e) {
      addChatMsg('assistant', '❌ Analysis failed: ' + e.message);
    } finally {
      studioAnalysisInProgress = false;
    }
  }

  // Back-compat alias
  async function analyzeVideoFrame() {
    return captureFrameAndAnalyze();
  }

  // ── Lite / Deep video analysis ─────────────────────────────────────────
  const ANALYSIS_MODE_CONFIG = {
    lite: {
      frameCount: 3,
      batchSize: 3,
      elementTypes: 'text, dominant colors, and obvious logos only',
      label: '⚡ Lite',
      desc: '⚡ <strong style="color:#94a3b8;">Lite:</strong> 3 frames · text &amp; colors only · ~$0.01',
      btnText: '⚡ Run Lite Analysis',
      model: 'claude-haiku-4-5-20251001',
    },
    deep: {
      frameCount: 30,
      batchSize: 10,
      elementTypes: 'every element: text, logos, backgrounds, subjects, overlays, graphics, and visual effects',
      label: '🧠 Deep',
      desc: '🧠 <strong style="color:#94a3b8;">Deep:</strong> 30 frames · all elements · ~$0.10–0.15',
      btnText: '🧠 Run Deep Analysis',
      model: 'claude-opus-4-5',
    },
  };

  function showStudioToast(message, type) {
    type = type || 'success';
    const existing = document.getElementById('studio-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'studio-toast';
    const bg = type === 'error' ? '#7f1d1d' : '#064e3b';
    const border = type === 'error' ? '#ef4444' : '#10B981';
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
      'background:' + bg + ';border:1px solid ' + border + ';color:#e2e8f0;' +
      'padding:10px 20px;border-radius:8px;font-size:12px;font-weight:600;' +
      'z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,.4);max-width:90%;text-align:center;';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 4000);
  }

  function setAnalysisMode(mode) {
    studioAnalysisMode = mode;
    const config = ANALYSIS_MODE_CONFIG[mode];
    const desc = document.getElementById('studio-analyze-mode-desc');
    const btn = document.getElementById('btn-run-analyze');
    const liteBtn = document.getElementById('btn-mode-lite');
    const deepBtn = document.getElementById('btn-mode-deep');
    if (desc) desc.innerHTML = config.desc;
    if (btn) btn.textContent = config.btnText;
    if (liteBtn) {
      liteBtn.style.background = mode === 'lite' ? '#7C3AED' : 'transparent';
      liteBtn.style.color = mode === 'lite' ? '#fff' : '#64748b';
    }
    if (deepBtn) {
      deepBtn.style.background = mode === 'deep' ? '#7C3AED' : 'transparent';
      deepBtn.style.color = mode === 'deep' ? '#fff' : '#64748b';
    }
  }

  function clearAnalysisCache() {
    const cacheKey = studioServerVideoUrl || 'local';
    delete studioManifestCache[cacheKey];
    const notice = document.getElementById('studio-cache-notice');
    if (notice) notice.style.display = 'none';
    studioVideoManifest = null;
    studioActiveElement = null;
    const list = document.getElementById('studio-element-list');
    if (list) list.innerHTML = '';
    const section = document.getElementById('studio-element-list-section');
    if (section) section.style.display = 'none';
    const editor = document.getElementById('studio-element-editor');
    if (editor) editor.style.display = 'none';
    return false;
  }

  const ELEMENT_TYPE_ICONS = {
    text: '✏️', logo: '🏷️', background: '🖼️', subject: '👤',
    overlay: '📐', graphic: '🎨', effect: '✨', rectangle: '📐',
  };
  const ELEMENT_TYPE_COLORS = {
    text: '#7C3AED', logo: '#10B981', background: '#334155',
    subject: '#F59E0B', overlay: '#3B82F6', graphic: '#EC4899', effect: '#64748b',
    rectangle: '#3B82F6',
  };

  function normalizeManifestElements(elements) {
    return (Array.isArray(elements) ? elements : []).map(function (el, i) {
      const type = el.type || 'text';
      const left = el.left != null ? el.left : (el.boundingBox && el.boundingBox.xPct != null ? el.boundingBox.xPct * 100 : 5);
      const top = el.top != null ? el.top : (el.boundingBox && el.boundingBox.yPct != null ? el.boundingBox.yPct * 100 : 5);
      const width = el.width != null ? el.width : (el.boundingBox && el.boundingBox.wPct != null ? el.boundingBox.wPct * 100 : (type === 'text' ? 60 : 20));
      const height = el.height != null ? el.height : (el.boundingBox && el.boundingBox.hPct != null ? el.boundingBox.hPct * 100 : (type === 'text' ? 8 : 10));
      const content = el.content || '';
      const label = el.label || (type === 'text' ? String(content).slice(0, 40) || 'Text' : (type.charAt(0).toUpperCase() + type.slice(1)));
      const fontSizeMap = { small: 28, medium: 42, large: 64, xlarge: 96, xxlarge: 128 };
      return {
        id: el.id || ('el_' + i + '_' + Date.now()),
        type: type,
        label: label,
        content: content,
        boundingBox: el.boundingBox || {
          xPct: left / 100,
          yPct: top / 100,
          wPct: width / 100,
          hPct: height / 100,
        },
        style: el.style || {
          color: el.color || '#ffffff',
          fontSize: typeof el.fontSize === 'number' ? el.fontSize : (fontSizeMap[el.fontSize] || 48),
          fontFamily: el.fontFamily || (el.isHeadline ? 'Newsreader' : 'Instrument Sans'),
          fontWeight: el.fontWeight || 'normal',
          textAlign: el.textAlign || 'left',
          backgroundColor: el.fill || '#000000',
        },
      };
    });
  }

  function renderElementList(elements) {
    const container = document.getElementById('studio-element-list');
    const section = document.getElementById('studio-element-list-section');
    if (!container) return;
    const items = normalizeManifestElements(elements);
    if (studioVideoManifest) studioVideoManifest.elements = items;
    container.innerHTML = '';
    if (section) section.style.display = 'block';

    if (!items.length) {
      container.innerHTML = '<div style="font-size:10px;color:#64748b;padding:6px 0;">No elements found.</div>';
      return;
    }

    items.forEach(function (el) {
      const icon = ELEMENT_TYPE_ICONS[el.type] || '◼';
      const color = ELEMENT_TYPE_COLORS[el.type] || '#64748b';
      const chip = document.createElement('div');
      chip.dataset.elementId = el.id;
      chip.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 8px;' +
        'background:#0f172a;border:1px solid #334155;border-radius:6px;cursor:pointer;transition:border-color .15s;';
      chip.innerHTML =
        '<span style="font-size:13px;">' + icon + '</span>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:11px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(el.label) + '</div>' +
          '<div style="font-size:9px;color:' + color + ';font-weight:700;text-transform:uppercase;letter-spacing:.05em;">' + esc(el.type) + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:3px;flex-shrink:0;">' +
          '<button type="button" onclick="event.stopPropagation();openElementEditor(\'' + el.id + '\')" ' +
          'style="background:#1e293b;border:none;border-radius:4px;color:#94a3b8;padding:3px 6px;cursor:pointer;font-size:10px;">✏️</button>' +
          '<button type="button" onclick="event.stopPropagation();removeElementWithInpaint(\'' + el.id + '\')" ' +
          'style="background:#1e293b;border:none;border-radius:4px;color:#ef4444;padding:3px 6px;cursor:pointer;font-size:10px;">🗑️</button>' +
        '</div>';
      chip.addEventListener('mouseenter', function () { chip.style.borderColor = color; });
      chip.addEventListener('mouseleave', function () { chip.style.borderColor = '#334155'; });
      chip.addEventListener('click', function () { openElementEditor(el.id); });
      container.appendChild(chip);
    });
  }

  function openElementEditor(elementId) {
    if (!studioVideoManifest) return;
    const el = studioVideoManifest.elements.find(function (e) { return e.id === elementId; });
    if (!el) return;
    studioActiveElement = el;

    const editorDiv = document.getElementById('studio-element-editor');
    if (!editorDiv) return;
    editorDiv.style.display = 'block';

    const existingHL = studioCanvas.getObjects().find(function (o) { return o.isElementHighlight; });
    if (existingHL) studioCanvas.remove(existingHL);
    const fmt = STUDIO_FORMATS[studioFormat];
    const bb = el.boundingBox || { xPct: 0, yPct: 0, wPct: 0.2, hPct: 0.1 };
    const hlRect = new fabric.Rect({
      left: bb.xPct * fmt.displayW,
      top: bb.yPct * fmt.displayH,
      width: bb.wPct * fmt.displayW,
      height: bb.hPct * fmt.displayH,
      fill: 'transparent',
      stroke: ELEMENT_TYPE_COLORS[el.type] || '#7C3AED',
      strokeWidth: 2,
      strokeDashArray: [4, 3],
      selectable: false,
      evented: false,
      isElementHighlight: true,
    });
    studioCanvas.add(hlRect);
    studioCanvas.renderAll();
    setTimeout(function () {
      try { studioCanvas.remove(hlRect); studioCanvas.renderAll(); } catch (_) {}
    }, 4000);

    if (el.type === 'text') {
      editorDiv.innerHTML =
        '<div style="font-size:10px;font-weight:700;color:#a78bfa;margin-bottom:8px;">✏️ Edit Text</div>' +
        '<textarea id="ee-text-content" rows="2" ' +
        'style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;color:#e2e8f0;padding:4px 6px;font-size:11px;resize:none;box-sizing:border-box;">' +
        esc(el.content || '') + '</textarea>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;">' +
          '<div><label style="font-size:9px;color:#64748b;display:block;margin-bottom:2px;">Color</label>' +
          '<input type="color" id="ee-text-color" value="' + esc((el.style && el.style.color) || '#1a1a1a') + '" ' +
          'style="width:100%;height:28px;border:none;border-radius:4px;cursor:pointer;" /></div>' +
          '<div><label style="font-size:9px;color:#64748b;display:block;margin-bottom:2px;">Size (px)</label>' +
          '<input type="number" id="ee-font-size" value="' + ((el.style && el.style.fontSize) || 48) + '" ' +
          'style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;color:#e2e8f0;padding:3px 6px;font-size:11px;box-sizing:border-box;" /></div>' +
        '</div>' +
        '<select id="ee-font-family" style="width:100%;margin-top:6px;background:#0f172a;border:1px solid #334155;border-radius:4px;color:#e2e8f0;padding:5px 6px;font-size:11px;">' +
          '<option value="Newsreader">Newsreader</option>' +
          '<option value="Instrument Sans">Instrument Sans</option>' +
          '<option value="Inter">Inter</option>' +
          '<option value="Bebas Neue">Bebas Neue</option>' +
          '<option value="Montserrat">Montserrat</option>' +
          '<option value="Oswald">Oswald</option>' +
          '<option value="Anton">Anton</option>' +
          '<option value="Poppins">Poppins</option>' +
          '<option value="Raleway">Raleway</option>' +
          '<option value="Playfair Display">Playfair Display</option>' +
        '</select>' +
        '<button type="button" onclick="applyTextEdit()" ' +
        'style="width:100%;margin-top:8px;background:#7C3AED;color:#fff;border:none;border-radius:6px;padding:7px;font-size:11px;font-weight:600;cursor:pointer;">Apply to Canvas</button>' +
        '<button type="button" onclick="removeElementWithInpaint(\'' + el.id + '\')" ' +
        'style="width:100%;margin-top:4px;background:#1e293b;color:#ef4444;border:1px solid #ef444444;border-radius:6px;padding:6px;font-size:10px;cursor:pointer;">🗑️ Remove + AI Fill</button>' +
        '<button type="button" onclick="document.getElementById(\'studio-element-editor\').style.display=\'none\'" ' +
        'style="width:100%;margin-top:4px;background:none;border:none;color:#475569;font-size:10px;cursor:pointer;">✕ Close</button>';
      const ff = document.getElementById('ee-font-family');
      if (ff && el.style && el.style.fontFamily) ff.value = el.style.fontFamily;
    } else {
      editorDiv.innerHTML =
        '<div style="font-size:10px;font-weight:700;color:#a78bfa;margin-bottom:6px;">' +
        (ELEMENT_TYPE_ICONS[el.type] || '◼') + ' ' + esc(el.label) + '</div>' +
        '<p style="font-size:10px;color:#94a3b8;margin:0 0 8px;">Remove this element and AI will fill the area with content-aware inpainting.</p>' +
        '<button type="button" onclick="removeElementWithInpaint(\'' + el.id + '\')" ' +
        'style="width:100%;background:#ef4444;color:#fff;border:none;border-radius:6px;padding:7px;font-size:11px;font-weight:600;cursor:pointer;">🗑️ Remove + AI Fill</button>' +
        '<button type="button" onclick="document.getElementById(\'studio-element-editor\').style.display=\'none\'" ' +
        'style="width:100%;margin-top:4px;background:none;border:none;color:#475569;font-size:10px;cursor:pointer;">✕ Close</button>';
    }
  }

  function isLightColor(hex) {
    if (!hex || typeof hex !== 'string') return false;
    const raw = hex.trim();
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) return false;
    let h = raw.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
  }

  function resolveTextMaskFill(el, layer) {
    const detectedBg =
      (layer && layer.style && (layer.style.backgroundColor || layer.style.background)) ||
      (el && el.style && (el.style.backgroundColor || el.style.background)) ||
      null;
    const yPct =
      (el && el.boundingBox && el.boundingBox.yPct != null)
        ? el.boundingBox.yPct
        : (layer && layer.top != null ? layer.top / 100 : 0.5);
    const inBannerZone = yPct < 0.2 || yPct > 0.8;
    const canvasBg =
      (studioCanvas && typeof studioCanvas.backgroundColor === 'string')
        ? studioCanvas.backgroundColor
        : null;

    // Light detected bg always wins
    if (detectedBg && isLightColor(detectedBg)) return detectedBg;

    // Top/bottom banner zones: prefer detected banner bg when present
    if (inBannerZone && detectedBg) return detectedBg;

    if (detectedBg) {
      // Never paint a dark mask over an apparently light video/canvas bg
      if (!isLightColor(detectedBg) && canvasBg && isLightColor(canvasBg)) {
        return canvasBg;
      }
      return detectedBg;
    }

    if (canvasBg && isLightColor(canvasBg)) return canvasBg;
    return '#ffffff';
  }

  function applyTextEdit() {
    if (!studioActiveElement) return;
    const el = studioActiveElement;

    studioCanvas.getObjects().filter(function (o) {
      return o.name === 'mask_' + el.id || o.name === 'text_' + el.id;
    }).forEach(function (o) { studioCanvas.remove(o); });

    const contentEl = document.getElementById('ee-text-content');
    const colorEl = document.getElementById('ee-text-color');
    const sizeEl = document.getElementById('ee-font-size');
    const famEl = document.getElementById('ee-font-family');
    const content = (contentEl && contentEl.value) || el.content || '';
    const color = (colorEl && colorEl.value) || (el.style && el.style.color) || '#1a1a1a';
    const fontSize = parseInt((sizeEl && sizeEl.value) || 48, 10);
    const fontFamily = (famEl && famEl.value) || 'Instrument Sans';

    const fmt = STUDIO_FORMATS[studioFormat];
    const bb = el.boundingBox || { xPct: 0.05, yPct: 0.05, wPct: 0.6, hPct: 0.1 };
    const l = bb.xPct * fmt.displayW;
    const t = bb.yPct * fmt.displayH;
    const w = bb.wPct * fmt.displayW;
    const h = bb.hPct * fmt.displayH;
    const padX = Math.min(8, Math.max(4, w * 0.02));
    const padY = Math.min(8, Math.max(4, h * 0.05));
    const scaledFontSize = fontSize * (fmt.displayW / fmt.w);
    const maskFill = resolveTextMaskFill(el);
    const cornerRadius = (el.style && el.style.borderRadius) || 8;

    const maskRect = new fabric.Rect({
      name: 'mask_' + el.id,
      left: l - padX, top: t - padY,
      width: w + padX * 2, height: h + padY * 2,
      fill: maskFill,
      opacity: 1.0,
      rx: cornerRadius, ry: cornerRadius,
      selectable: false, evented: false, isMaskRect: true,
    });
    studioCanvas.add(maskRect);

    const textObj = new fabric.IText(content, {
      name: 'text_' + el.id,
      left: l, top: t, width: w,
      fontSize: scaledFontSize, fontFamily: fontFamily, fill: color,
      fontWeight: (el.style && el.style.fontWeight) || 'normal',
      textAlign: (el.style && el.style.textAlign) || 'left',
      selectable: true, editable: true, isTextOverlay: true,
    });
    studioCanvas.add(textObj);
    maskRect.moveTo(studioCanvas.getObjects().indexOf(textObj) - 1);
    studioCanvas.setActiveObject(textObj);
    textObj.on('moving', function () {
      maskRect.set({ left: textObj.left - padX, top: textObj.top - padY });
      studioCanvas.renderAll();
    });
    studioCanvas.renderAll();
    updateLayerPanel();
    saveHistory('Text edit applied');
    showStudioToast('Text applied to canvas');
  }

  async function removeElementWithInpaint(elementId) {
    if (!studioVideoManifest) return;
    const el = studioVideoManifest.elements.find(function (e) { return e.id === elementId; });
    if (!el) return;
    if (!studioServerVideoUrl) {
      showStudioToast('Video still uploading to server — please wait a moment then try again.', 'error');
      return;
    }
    if (!confirm('Remove "' + el.label + '" and use AI to fill the blank area?\n\nThis takes 1–3 minutes and costs ~$0.35.')) return;

    const chip = document.querySelector('[data-element-id="' + elementId + '"]');
    let tag = null;
    if (chip) {
      tag = document.createElement('span');
      tag.style.cssText = 'font-size:9px;color:#F59E0B;margin-left:4px;';
      tag.textContent = '⏳ Inpainting...';
      chip.appendChild(tag);
    }
    try {
      const maskData = await studioFetch('/api/studio/generate-mask-video', {
        method: 'POST',
        body: JSON.stringify({ videoUrl: studioServerVideoUrl, boundingBox: el.boundingBox }),
      });
      if (!maskData.success) throw new Error(maskData.error || 'Mask generation failed');
      const inpaintData = await studioFetch('/api/studio/inpaint-video', {
        method: 'POST',
        body: JSON.stringify({
          videoUrl: studioServerVideoUrl,
          maskVideoUrl: maskData.maskUrl,
          dilateRadius: 12,
        }),
      });
      if (!inpaintData.success) throw new Error(inpaintData.error || 'Inpainting failed');
      const videoEl = document.getElementById('studio-video-player');
      if (videoEl) {
        videoEl.src = inpaintData.url;
        await videoEl.play().catch(function () {});
      }
      studioServerVideoUrl = inpaintData.url;
      studioVideoManifest.elements = studioVideoManifest.elements.filter(function (e) { return e.id !== elementId; });
      renderElementList(studioVideoManifest.elements);
      const editor = document.getElementById('studio-element-editor');
      if (editor) editor.style.display = 'none';
      studioActiveElement = null;
      showStudioToast('✅ "' + el.label + '" removed and AI filled the area!');
    } catch (err) {
      showStudioToast('❌ Inpaint failed: ' + err.message, 'error');
      if (tag) tag.remove();
    }
  }

  async function exportStudioOutput() {
    if (!studioServerVideoUrl) { studioDownload(); return; }
    const btn = document.getElementById('btn-studio-export');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Exporting...'; }
    try {
      const data = await studioFetch('/api/studio/export-video', {
        method: 'POST',
        body: JSON.stringify({ videoUrl: studioServerVideoUrl, effects: global.studioEffectSettings || {} }),
      });
      if (!data.success) throw new Error(data.error || 'Export failed');
      const a = document.createElement('a');
      a.href = data.url;
      a.download = data.filename || 'export.mp4';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
      showStudioToast('✅ Video downloaded!');
    } catch (err) {
      showStudioToast('❌ Export failed: ' + err.message, 'error');
      studioDownload();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '↓ Download'; }
    }
  }

  function toggleSAMMode() {
    studioSAMModeActive = !studioSAMModeActive;
    const btn = document.getElementById('btn-sam-mode');
    if (btn) {
      btn.style.background = studioSAMModeActive ? '#7C3AED' : '';
      btn.style.color = studioSAMModeActive ? '#fff' : '';
      btn.textContent = studioSAMModeActive ? '🎯 Click…' : '🎯 Segment';
    }
    if (studioCanvas) studioCanvas.defaultCursor = studioSAMModeActive ? 'crosshair' : 'default';
  }

  async function handleSAMClick(opt) {
    if (!studioSAMModeActive || !studioCanvas) return;
    const fmt = STUDIO_FORMATS[studioFormat];
    const pointer = studioCanvas.getPointer(opt.e);
    const normX = pointer.x / fmt.displayW;
    const normY = pointer.y / fmt.displayH;
    toggleSAMMode();
    if (!studioServerVideoUrl) {
      showStudioToast('Segment works after video uploads to server', 'error');
      return;
    }
    showStudioToast('🎯 Segmenting element...');
    try {
      const data = await studioFetch('/api/studio/segment-image', {
        method: 'POST',
        body: JSON.stringify({ imageUrl: studioServerVideoUrl, points: [{ x: normX, y: normY }] }),
      });
      if (!data.success) throw new Error(data.error || 'Segment failed');
      fabric.Image.fromURL(data.maskUrl, function (maskImg) {
        if (!maskImg) return;
        maskImg.set({
          left: 0, top: 0,
          scaleX: fmt.displayW / (data.imageWidth || fmt.displayW),
          scaleY: fmt.displayH / (data.imageHeight || fmt.displayH),
          opacity: 0.4, selectable: true, isSAMMask: true,
          globalCompositeOperation: 'screen',
        });
        studioCanvas.add(maskImg);
        studioCanvas.renderAll();
        updateLayerPanel();
        showStudioToast('✅ Element segmented — mask added to canvas');
      }, { crossOrigin: 'anonymous' });
    } catch (err) {
      showStudioToast('❌ Segment failed: ' + err.message, 'error');
    }
  }

  function addManifestElement(idx) {
    if (!studioVideoManifest || !studioVideoManifest.elements) return;
    const el = studioVideoManifest.elements[idx];
    if (!el) return;
    studioActiveElement = el;
    openElementEditor(el.id);
    if (el.type === 'text') applyTextEdit();
  }

  async function triggerAnalysis() {
    const cacheKey = studioServerVideoUrl || 'local';
    if (studioManifestCache[cacheKey]) {
      studioVideoManifest = studioManifestCache[cacheKey];
      renderElementList(studioVideoManifest.elements);
      const notice = document.getElementById('studio-cache-notice');
      if (notice) notice.style.display = 'block';
      showStudioToast('Using cached analysis — no extra cost!');
      return;
    }

    if (!studioServerVideoUrl) {
      if (studioAnalysisMode === 'deep') {
        showStudioToast('⏳ Video still uploading to server — try Lite for now or wait a moment.', 'error');
        return;
      }
      await triggerLiteLocalAnalysis();
      return;
    }

    const config = ANALYSIS_MODE_CONFIG[studioAnalysisMode];
    const progressDiv = document.getElementById('studio-analyze-progress');
    const statusEl = document.getElementById('studio-analyze-status');
    const btn = document.getElementById('btn-run-analyze');

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Analyzing...'; }
    if (progressDiv) progressDiv.style.display = 'block';
    if (statusEl) {
      statusEl.textContent = studioAnalysisMode === 'lite'
        ? 'Capturing 3 frames & running quick analysis...'
        : 'Extracting 30 frames & running full analysis (this takes ~30s)...';
    }

    try {
      const data = await studioFetch('/api/studio/deep-analyze-video', {
        method: 'POST',
        body: JSON.stringify({
          videoUrl: studioServerVideoUrl,
          videoId: 'video_' + Date.now(),
          mode: studioAnalysisMode,
          frameCount: config.frameCount,
          model: config.model,
          elementTypes: config.elementTypes,
        }),
      });
      if (!data.success) throw new Error(data.error || 'Analysis failed');

      studioVideoManifest = data.manifest || { elements: [] };
      if (studioVideoManifest.elements) {
        studioVideoManifest.elements = normalizeManifestElements(studioVideoManifest.elements);
      }
      studioManifestCache[cacheKey] = studioVideoManifest;

      if (statusEl) statusEl.textContent = '✅ Found ' + (studioVideoManifest.elements || []).length + ' elements';
      setTimeout(function () {
        if (progressDiv) progressDiv.style.display = 'none';
      }, 2000);
      const notice = document.getElementById('studio-cache-notice');
      if (notice) notice.style.display = 'block';
      if (btn) { btn.textContent = config.btnText; btn.disabled = false; }

      renderElementList(studioVideoManifest.elements);
      showRightTab('props');
    } catch (err) {
      if (statusEl) statusEl.textContent = '❌ Error: ' + err.message;
      if (btn) { btn.disabled = false; btn.textContent = config.btnText; }
      showStudioToast(err.message, 'error');
    }
  }

  async function triggerLiteLocalAnalysis() {
    const v = document.getElementById('studio-video-player') || global._studioActiveVideo;
    if (!v) { showStudioToast('No video loaded', 'error'); return; }

    const btn = document.getElementById('btn-run-analyze');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Capturing frames...'; }

    try {
      const frames = [];
      const duration = v.duration || 10;
      const timestamps = [0.1, 0.5, 0.9].map(function (t) { return t * Math.min(duration, 30); });
      const wasPaused = v.paused;
      const prevTime = v.currentTime;

      for (let i = 0; i < timestamps.length; i++) {
        const t = timestamps[i];
        v.currentTime = t;
        await new Promise(function (r) {
          v.addEventListener('seeked', r, { once: true });
          setTimeout(r, 800);
        });
        const tmp = document.createElement('canvas');
        const vw = v.videoWidth || 640;
        const vh = v.videoHeight || 1138;
        tmp.width = 640;
        tmp.height = Math.max(1, Math.round(640 * vh / vw));
        tmp.getContext('2d').drawImage(v, 0, 0, tmp.width, tmp.height);
        frames.push(tmp.toDataURL('image/jpeg', 0.75));
      }

      v.currentTime = prevTime;
      if (!wasPaused) v.play().catch(function () {});

      const data = await studioFetch('/api/studio/analyze-video-frames', {
        method: 'POST',
        body: JSON.stringify({
          frames: frames.map(function (f, i) { return { time: timestamps[i], dataUrl: f }; }),
          mode: 'lite',
        }),
      });
      if (!data.success) throw new Error(data.error || 'Analysis failed');

      studioVideoManifest = { elements: data.layers || data.elements || [], videoId: 'local' };
      studioManifestCache.local = studioVideoManifest;
      renderElementList(studioVideoManifest.elements);
      const notice = document.getElementById('studio-cache-notice');
      if (notice) notice.style.display = 'block';
      showStudioToast('⚡ Lite analysis done — ' + studioVideoManifest.elements.length + ' elements found');
      showRightTab('props');
    } catch (err) {
      showStudioToast('❌ ' + err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = ANALYSIS_MODE_CONFIG[studioAnalysisMode].btnText;
      }
    }
  }

  function studioClearCanvas() {
    if (!confirm('Clear all layers and start fresh?')) return;
    studioCanvas.clear();
    stopVideoRenderLoop();
    studioCanvas.setBackgroundColor('#0E1A63', studioCanvas.renderAll.bind(studioCanvas));
    studioVideoBlobUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (_) {} });
    studioVideoBlobUrls = [];
    studioServerVideoUrl = null;
    studioVideoManifest = null;
    updateVideoToolbar(false);
    studioPendingFrameDataUrl = null;
    studioAnalysisInProgress = false;
    studioChatHistory = [];
    const list = document.getElementById('studio-element-list');
    if (list) list.innerHTML = '';
    const notice = document.getElementById('studio-cache-notice');
    if (notice) notice.style.display = 'none';
    updateLayerPanel();
    clearPropsPanel();
    studioHistory = [];
    studioHistoryIdx = -1;
    saveHistory('Canvas cleared');
  }

  async function reconstructCanvasFromAnalysis(originalDataUrl, analysis) {
    const layers = analysis.layers || [];
    const backgroundColor = analysis.backgroundColor || '#0E1A63';
    const fmt = STUDIO_FORMATS[studioFormat];

    // Clear canvas and set background color — do NOT load the composite as a full-opacity bg
    studioCanvas.clear();
    studioCanvas.setBackgroundColor(backgroundColor, function () {});

    const fontSizeMap = {
      small: fmt.displayH * 0.025,
      medium: fmt.displayH * 0.040,
      large: fmt.displayH * 0.060,
      xlarge: fmt.displayH * 0.090,
      xxlarge: fmt.displayH * 0.130,
    };

    // STEP 1: Dim locked reference of the original (position guide only)
    await new Promise(function (resolve) {
      fabric.Image.fromURL(originalDataUrl, function (img) {
        if (!img) { resolve(); return; }
        const scaleX = fmt.displayW / img.width;
        const scaleY = fmt.displayH / img.height;
        const s = Math.max(scaleX, scaleY);
        img.set({
          name: '🔒 Original (guide)',
          left: 0,
          top: 0,
          scaleX: s,
          scaleY: s,
          opacity: 0.15,
          selectable: false,
          evented: false,
          locked: true,
          hoverCursor: 'default',
        });
        studioCanvas.add(img);
        studioCanvas.sendToBack(img);
        studioCanvas.renderAll();
        resolve();
      });
    });

    // STEP 2: Editable layers on top (skip background_image — handled as guide above)
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      try {
        if (layer.type === 'background_image') {
          continue;
        } else if (layer.type === 'background_color') {
          studioCanvas.setBackgroundColor(layer.color || backgroundColor, function () {});
        } else if (layer.type === 'rectangle') {
          const isFullBleed = (layer.width > 90 && layer.height > 90);
          if (isFullBleed && (layer.opacity != null ? layer.opacity : 1) > 0.7) {
            continue;
          }
          const rect = new fabric.Rect({
            name: 'overlay-' + Date.now() + '-' + i,
            left: (layer.left / 100) * fmt.displayW,
            top: (layer.top / 100) * fmt.displayH,
            width: (layer.width / 100) * fmt.displayW,
            height: (layer.height / 100) * fmt.displayH,
            fill: layer.fill || 'transparent',
            opacity: layer.opacity != null ? layer.opacity : 0.5,
            globalCompositeOperation: layer.blendMode === 'multiply' ? 'multiply'
              : layer.blendMode === 'overlay' ? 'overlay'
              : 'source-over',
            selectable: true,
            evented: true,
          });
          studioCanvas.add(rect);
        } else if (layer.type === 'text') {
          const fontSize = fontSizeMap[layer.fontSize] || fontSizeMap.medium;
          const fontFamily = layer.isHeadline ? 'Newsreader' : 'Instrument Sans';
          const textObj = new fabric.IText(String(layer.content || '').replace(/\\n/g, '\n'), {
            name: (layer.isHeadline ? 'headline' : 'text') + '-' + Date.now() + '-' + i,
            left: (layer.left / 100) * fmt.displayW,
            top: (layer.top / 100) * fmt.displayH,
            width: fmt.displayW * 0.88,
            fontFamily: fontFamily,
            fontSize: fontSize,
            fill: layer.color || '#1a1a2e',
            fontWeight: layer.fontWeight || 'normal',
            fontStyle: layer.fontStyle || 'normal',
            textAlign: layer.textAlign || 'left',
            lineHeight: 1.15,
            selectable: true,
            evented: true,
            locked: false,
          });
          studioCanvas.add(textObj);
        } else if (layer.type === 'logo') {
          const logoPh = new fabric.Rect({
            name: 'logo-' + i,
            left: (layer.left / 100) * fmt.displayW,
            top: (layer.top / 100) * fmt.displayH,
            width: ((layer.width || 20) / 100) * fmt.displayW,
            height: ((layer.height || 10) / 100) * fmt.displayH,
            fill: 'transparent',
            stroke: '#7C3AED',
            strokeDashArray: [4, 4],
            strokeWidth: 1,
            selectable: true,
            evented: true,
          });
          studioCanvas.add(logoPh);
        }
      } catch (layerErr) {
        console.warn('[Studio] Layer reconstruction failed:', layer && layer.type, layerErr);
      }
    }

    studioCanvas.renderAll();
    updateLayerPanel();
    saveHistory('AI: cloned design layers');

    setTimeout(function () {
      addChatMsg('assistant',
        '💡 Tip: The original image is loaded as a faint guide (15% opacity, locked). ' +
        'Your text layers are editable — click any text to change color, size, or content. ' +
        'Click the 👁 next to "🔒 Original (guide)" in the Layers panel to hide it when you\'re done.'
      );
    }, 500);
  }

  function studioDeleteSelected() {
    const obj = studioCanvas && studioCanvas.getActiveObject();
    if (!obj || obj.locked) return;
    studioCanvas.remove(obj);
    studioCanvas.discardActiveObject();
    studioCanvas.renderAll();
    updateLayerPanel();
    saveHistory('Delete');
  }

  function studioDuplicate() {
    const obj = studioCanvas && studioCanvas.getActiveObject();
    if (!obj) return;
    obj.clone(function (clone) {
      clone.set({ left: obj.left + 20, top: obj.top + 20, name: (obj.name || 'copy') + '-copy', locked: false, selectable: true, evented: true });
      studioCanvas.add(clone);
      studioCanvas.setActiveObject(clone);
      studioCanvas.renderAll();
      updateLayerPanel();
      saveHistory('Duplicate');
    });
  }

  function studioLayerOrder(dir) {
    const obj = studioCanvas && studioCanvas.getActiveObject();
    if (!obj) return;
    if (dir === 'front') studioCanvas.bringToFront(obj);
    if (dir === 'forward') studioCanvas.bringForward(obj);
    if (dir === 'backward') studioCanvas.sendBackwards(obj);
    if (dir === 'back') studioCanvas.sendToBack(obj);
    studioCanvas.renderAll();
    saveHistory('Layer order');
    updateLayerPanel();
  }

  function saveHistory(label) {
    if (!studioCanvas) return;
    const json = JSON.stringify(studioCanvas.toJSON(['name', 'locked', 'selectable', 'evented', 'hfPrompt']));
    studioHistory = studioHistory.slice(0, studioHistoryIdx + 1);
    studioHistory.push({ json: json, label: label || 'Edit', time: new Date() });
    if (studioHistory.length > 50) studioHistory.shift();
    studioHistoryIdx = studioHistory.length - 1;
    renderVersionHistory();
  }

  function studioUndo() {
    if (studioHistoryIdx <= 0) return;
    studioHistoryIdx--;
    studioCanvas.loadFromJSON(studioHistory[studioHistoryIdx].json, function () {
      studioCanvas.renderAll();
      updateLayerPanel();
      clearPropsPanel();
    });
  }

  function studioRedo() {
    if (studioHistoryIdx >= studioHistory.length - 1) return;
    studioHistoryIdx++;
    studioCanvas.loadFromJSON(studioHistory[studioHistoryIdx].json, function () {
      studioCanvas.renderAll();
      updateLayerPanel();
      clearPropsPanel();
    });
  }

  function toggleVersionHistory() {
    const hp = document.getElementById('cs-history-panel');
    const showing = hp.style.display !== 'none';
    document.getElementById('cs-props-panel').style.display = showing ? 'block' : 'none';
    document.getElementById('cs-chat-panel').style.display = 'none';
    hp.style.display = showing ? 'none' : 'block';
  }

  function renderVersionHistory() {
    const list = document.getElementById('cs-history-list');
    if (!list) return;
    list.innerHTML = studioHistory.slice().reverse().map(function (h, ri) {
      const idx = studioHistory.length - 1 - ri;
      const isCurrent = idx === studioHistoryIdx;
      const timeStr = h.time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      return '<div class="history-item ' + (isCurrent ? 'current' : '') + '" onclick="restoreHistoryAt(' + idx + ')">' +
        '<div class="hist-label">' + esc(h.label) + '</div>' +
        '<div class="hist-time">' + timeStr + '</div></div>';
    }).join('');
  }

  function restoreHistoryAt(idx) {
    studioHistoryIdx = idx;
    studioCanvas.loadFromJSON(studioHistory[idx].json, function () {
      studioCanvas.renderAll();
      updateLayerPanel();
      clearPropsPanel();
      renderVersionHistory();
    });
  }

  function studioZoomIn() { studioZoom = Math.min(studioZoom * 1.25, 4); applyZoom(); }
  function studioZoomOut() { studioZoom = Math.max(studioZoom * 0.8, 0.25); applyZoom(); }
  function studioZoomFit() { studioZoom = 1; applyZoom(); }
  function applyZoom() {
    const wrapper = document.getElementById('cs-canvas-wrapper');
    if (wrapper) {
      wrapper.style.transform = 'scale(' + studioZoom + ')';
      wrapper.style.transformOrigin = 'center center';
    }
    updateZoomLabel();
  }
  function updateZoomLabel() {
    const el = document.getElementById('cs-zoom-label');
    if (el) el.textContent = Math.round(studioZoom * 100) + '%';
  }

  async function studioTriggerHiggsfield() {
    const obj = studioCanvas && studioCanvas.getActiveObject();
    const isImage = obj && obj.type === 'image';
    const f = postFields(studioPost);
    const current = (obj && obj.hfPrompt) || f.image_prompt || '';
    if (isImage && current) {
      const feedback = prompt('What should change about the background?\n(e.g. "more emotional", "darker", "try something abstract")');
      if (!feedback) return;
      await studioRegenBackground(feedback, current);
    } else {
      const promptText = f.image_prompt ||
        ('Social media graphic for ' + (f.theme || 'awareness') + ' post. Brand colors: navy, purple. Illustrated style. No real faces.');
      await studioGenerateBackground(promptText);
    }
  }

  async function studioGenerateBackground(promptText) {
    addChatMsg('assistant', '✦ Generating background with Higgsfield…');
    showRightTab('chat');
    try {
      const resp = await studioFetch('/api/studio/generate-image', {
        method: 'POST',
        body: JSON.stringify({
          postId: studioPost && studioPost.id,
          prompt: promptText,
          format: studioFormat,
          model: 'nano-banana-pro',
          saveToRecord: false,
        }),
      });
      if (!resp.url) throw new Error('No URL returned');
      loadBackgroundImage(resp.url);
      setTimeout(function () {
        const bg = studioCanvas.getObjects().find(function (o) { return o.name === 'background'; });
        if (bg) bg.hfPrompt = promptText;
      }, 1000);
      addChatMsg('assistant', '✓ Background generated. Select it and use "Regenerate with AI" to try variations.');
      saveHistory('Higgsfield generate');
    } catch (e) {
      addChatMsg('assistant', '❌ Generation failed: ' + e.message);
    }
  }

  async function studioRegenBackground(userFeedback, currentPrompt) {
    addChatMsg('assistant', '✦ Generating 3 variations based on: "' + userFeedback + '"…');
    showRightTab('chat');
    document.getElementById('cs-variation-picker').style.display = 'none';
    const f = postFields(studioPost);
    const client = (global.__clientData && global.__clientData.client) || {};
    try {
      const resp = await studioFetch('/api/studio/regen-background', {
        method: 'POST',
        body: JSON.stringify({
          postId: studioPost && studioPost.id,
          userFeedback: userFeedback,
          currentPrompt: currentPrompt,
          format: studioFormat,
          model: 'nano-banana-pro',
          postContext: {
            caption: f.caption,
            theme: f.theme,
            platform: f.platform,
            charityName: client.business_name,
            brandColors: 'navy #0E1A63, purple #7C3AED, off-white #FAFCF9',
          },
        }),
      });
      if (!resp.variations || !resp.variations.length) throw new Error('No variations returned');
      addChatMsg('assistant', 'Got ' + resp.variations.length + ' directions. Pick one:');
      const picker = document.getElementById('cs-variation-picker');
      const thumbs = document.getElementById('cs-variation-thumbs');
      thumbs.innerHTML = '';
      resp.variations.forEach(function (v) {
        const el = document.createElement('div');
        el.className = 'variation-thumb';
        el.innerHTML = '<img alt="" loading="lazy"><div class="var-label"></div>';
        el.querySelector('img').src = v.url;
        el.querySelector('img').alt = v.label || '';
        el.querySelector('.var-label').textContent = v.label || 'Option';
        el.onclick = function () { applyVariation(v.url, encodeURIComponent(v.prompt || '')); };
        thumbs.appendChild(el);
      });
      picker.style.display = 'block';
      saveHistory('Regen background variations');
    } catch (e) {
      addChatMsg('assistant', '❌ Regen failed: ' + e.message);
    }
  }

  function applyVariation(url, encodedPrompt) {
    loadBackgroundImage(url);
    document.getElementById('cs-variation-picker').style.display = 'none';
    setTimeout(function () {
      const bg = studioCanvas.getObjects().find(function (o) { return o.name === 'background'; });
      if (bg) bg.hfPrompt = decodeURIComponent(encodedPrompt);
    }, 1000);
    addChatMsg('assistant', '✓ Background applied. Looking good!');
    saveHistory('Applied variation');
  }

  async function sendStudioChat() {
    const email = global.__clientEmail || global.clientEmail || global._seEmail || '';
    const hash = global.__clientHash || global.clientHash || global._seHash || '';
    if (!email || !hash) {
      addChatMsg('assistant', '❌ Not authenticated — please reload the page and log in again.');
      return;
    }
    global.__clientEmail = email;
    global.__clientHash = hash;

    const input = document.getElementById('cs-chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    document.getElementById('cs-chat-send').disabled = true;
    addChatMsg('user', msg);
    studioChatHistory.push({ role: 'user', content: msg });
    const loadId = 'loading-' + Date.now();
    addChatMsg('assistant', '…', loadId, true);
    const f = postFields(studioPost);
    const client = (global.__clientData && global.__clientData.client) || {};
    try {
      const canvasState = studioCanvas.toJSON(['name', 'locked', 'selectable', 'evented', 'hfPrompt']);
      canvasState.objects = (canvasState.objects || []).map(function (o) {
        const clean = Object.assign({}, o);
        if (clean.src && clean.src.length > 200) clean.src = '[image data]';
        return clean;
      });
      const resp = await studioFetch('/api/studio/ai-chat', {
        method: 'POST',
        body: JSON.stringify({
          postId: studioPost && studioPost.id,
          canvasState: canvasState,
          message: msg,
          history: studioChatHistory.slice(-6),
          format: studioFormat,
          postContext: {
            caption: f.caption,
            theme: f.theme,
            platform: f.platform,
            charityName: client.business_name,
            brandColors: 'navy #0E1A63, purple #7C3AED, off-white #FAFCF9',
          },
        }),
      });
      const loadEl = document.getElementById(loadId);
      if (loadEl) loadEl.remove();
      studioChatHistory.push({ role: 'assistant', content: resp.reply });
      addChatMsg('assistant', resp.reply);
      if (resp.requiresPreview && resp.operations && resp.operations.length) {
        studioPendingOps = resp.operations;
        document.getElementById('cs-preview-desc').textContent = resp.previewDescription || resp.reply;
        document.getElementById('cs-preview-modal').style.display = 'block';
      } else if (resp.operations && resp.operations.length) {
        executeOperations(resp.operations);
      }
    } catch (e) {
      const loadEl = document.getElementById(loadId);
      if (loadEl) loadEl.remove();
      addChatMsg('assistant', '❌ Error: ' + e.message);
    } finally {
      document.getElementById('cs-chat-send').disabled = false;
    }
  }

  function addChatMsg(role, text, id, loading) {
    const msgs = document.getElementById('cs-chat-messages');
    if (!msgs) return;
    const div = document.createElement('div');
    div.className = 'chat-msg ' + role + (loading ? ' loading' : '');
    if (id) div.id = id;
    div.innerHTML = '<div class="chat-bubble">' + esc(text) + '</div>';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    if (role === 'assistant' && document.getElementById('cs-chat-panel').style.display === 'none') {
      document.getElementById('cs-chat-badge').style.display = 'inline';
    }
  }

  function applyPendingOps() {
    document.getElementById('cs-preview-modal').style.display = 'none';
    if (studioPendingOps.length) executeOperations(studioPendingOps);
    studioPendingOps = [];
  }

  function cancelPendingOps() {
    document.getElementById('cs-preview-modal').style.display = 'none';
    studioPendingOps = [];
    addChatMsg('assistant', 'No problem, cancelled. What would you like to try instead?');
  }

  function executeOperations(ops) {
    let changed = false;
    ops.forEach(function (op) {
      const obj = op.target ? studioCanvas.getObjects().find(function (o) { return o.name === op.target; }) : null;
      const s = STUDIO_FORMATS[studioFormat].displayW / STUDIO_FORMATS[studioFormat].w;
      switch (op.action) {
        case 'setFontSize': if (obj) { obj.set('fontSize', op.value); changed = true; } break;
        case 'setFontFamily': if (obj) { obj.set('fontFamily', op.value); changed = true; } break;
        case 'setColor': if (obj) { obj.set('fill', op.value); changed = true; } break;
        case 'setText': if (obj) { obj.set('text', op.value); changed = true; } break;
        case 'setOpacity': if (obj) { obj.set('opacity', op.value); changed = true; } break;
        case 'setPosition':
          if (obj) { obj.set({ left: (op.x || 0) * s, top: (op.y || 0) * s }); obj.setCoords(); changed = true; }
          break;
        case 'setSize':
          if (obj) {
            const sw = (op.width || obj.width) * s;
            const sh = (op.height || obj.height) * s;
            obj.set({ scaleX: sw / obj.width, scaleY: sh / obj.height });
            changed = true;
          }
          break;
        case 'setShadow':
          if (obj) { obj.set('shadow', new fabric.Shadow({ color: op.color, blur: op.blur, offsetX: op.offsetX, offsetY: op.offsetY })); changed = true; }
          break;
        case 'setBlend': if (obj) { obj.set('globalCompositeOperation', op.mode); changed = true; } break;
        case 'setBold': if (obj) { obj.set('fontWeight', op.value ? 'bold' : 'normal'); changed = true; } break;
        case 'setItalic': if (obj) { obj.set('fontStyle', op.value ? 'italic' : 'normal'); changed = true; } break;
        case 'setAlign': if (obj) { obj.set('textAlign', op.value); changed = true; } break;
        case 'setLineHeight': if (obj) { obj.set('lineHeight', op.value); changed = true; } break;
        case 'setLetterSpacing': if (obj) { obj.set('charSpacing', op.value); changed = true; } break;
        case 'bringForward': if (obj) { studioCanvas.bringForward(obj); changed = true; } break;
        case 'sendBackward': if (obj) { studioCanvas.sendBackwards(obj); changed = true; } break;
        case 'bringToFront': if (obj) { studioCanvas.bringToFront(obj); changed = true; } break;
        case 'sendToBack': if (obj) { studioCanvas.sendToBack(obj); changed = true; } break;
        case 'hide': if (obj) { obj.set('visible', false); changed = true; } break;
        case 'show': if (obj) { obj.set('visible', true); changed = true; } break;
        case 'delete': if (obj && !obj.locked) { studioCanvas.remove(obj); changed = true; } break;
        case 'duplicate':
          if (obj) obj.clone(function (c) {
            c.set({ name: (obj.name || 'obj') + '-copy', left: obj.left + 20, top: obj.top + 20 });
            studioCanvas.add(c); changed = true; studioCanvas.renderAll(); updateLayerPanel();
          });
          break;
        case 'addText': {
          const t = new fabric.IText(op.text || 'New text', {
            name: 'text-' + Date.now(), left: (op.x || 0) * s, top: (op.y || 0) * s,
            fontSize: (op.fontSize || 40) * s, fill: op.color || '#FAFCF9',
            fontFamily: op.fontFamily || 'Newsreader', selectable: true, evented: true,
          });
          studioCanvas.add(t); changed = true; break;
        }
        case 'addRect': {
          const r = new fabric.Rect({
            name: 'shape-' + Date.now(), left: (op.x || 0) * s, top: (op.y || 0) * s,
            width: (op.width || 100) * s, height: (op.height || 100) * s,
            fill: op.fill || '#7C3AED', opacity: op.opacity || 1, selectable: true, evented: true,
          });
          studioCanvas.add(r); changed = true; break;
        }
        case 'setCanvasBg':
          studioCanvas.setBackgroundColor(op.color, function () {}); changed = true; break;
        case 'regenBackground':
          studioRegenBackground(op.feedback || 'make it better', (obj && obj.hfPrompt) || postFields(studioPost).image_prompt || '');
          break;
        default:
          console.warn('[Studio] Unknown op:', op.action);
      }
    });
    if (changed) {
      studioCanvas.renderAll();
      updateLayerPanel();
      updatePropsPanel();
      saveHistory('AI edit');
    }
  }

  function studioDownload() {
    if (!studioCanvas) return;
    const exportCanvas = buildCompositeCanvas();
    const a = document.createElement('a');
    a.href = exportCanvas.toDataURL('image/png');
    const f = postFields(studioPost);
    a.download = (f.post_label || 'post') + '-' + studioFormat.replace(':', '-') + '.png';
    a.click();
  }

  async function studioApprove() {
    if (!studioPost || !studioPost.id || !studioCanvas) return;
    const exportCanvas = buildCompositeCanvas();
    const dataUrl = exportCanvas.toDataURL('image/png');
    const blob = await (await fetch(dataUrl)).blob();
    const formData = new FormData();
    formData.append('image', blob, 'studio-export.png');
    const email = global.__clientEmail || global.clientEmail || '';
    const hash = global.__clientHash || global.clientHash || '';
    try {
      const uploadResp = await fetch(apiBase() + '/api/studio/upload-image', {
        method: 'POST',
        headers: { 'x-client-email': email, 'x-client-hash': hash },
        body: formData,
      });
      const uploadData = await uploadResp.json();
      if (!uploadData.url) throw new Error('Upload failed');
      await studioFetch('/api/studio/import-to-content', {
        method: 'POST',
        body: JSON.stringify({ postId: studioPost.id, mediaUrl: uploadData.url }),
      });
      const f = postFields(studioPost);
      await studioFetch('/api/approve-post', {
        method: 'POST',
        body: JSON.stringify({
          postId: studioPost.id,
          clientEmail: email,
          clientHash: hash,
          editedCaption: f.caption || '',
        }),
      });
      document.getElementById('cs-approve-btn').textContent = '✓ Approved';
      document.getElementById('cs-approve-btn').style.background = '#059669';
      if (studioPost.status !== undefined) studioPost.status = 'Approved';
      if (studioPost.fields) studioPost.fields.status = 'Approved';
      addChatMsg('assistant', '🎉 Approved and saved! The graphic is now in your content calendar.');
      if (typeof global.showToast === 'function') global.showToast('✓ Post approved!');
    } catch (e) {
      alert('Approve failed: ' + e.message);
    }
  }

  function studioKeyHandler(e) {
    if (!studioCanvas || !document.getElementById('ctab-studio')) return;
    const meta = e.metaKey || e.ctrlKey;
    const tag = document.activeElement && document.activeElement.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    if (meta && e.key === 'z' && !e.shiftKey) { e.preventDefault(); studioUndo(); return; }
    if (meta && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); studioRedo(); return; }
    if (meta && e.key === 'd') { e.preventDefault(); studioDuplicate(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !meta) { studioDeleteSelected(); return; }
    if (e.key === 't' && !meta) { studioAddText(); return; }
    if (e.key === 'r' && !meta) { studioAddRect(); return; }
    if (e.key === 'o' && !meta) { studioAddEllipse(); return; }
    if (e.key === 'Escape') { studioCanvas.discardActiveObject(); studioCanvas.renderAll(); clearPropsPanel(); return; }
    if (e.key === ' ' && studioVideoElements.length && !['INPUT', 'TEXTAREA'].includes((e.target && e.target.tagName) || '')) {
      e.preventDefault();
      toggleVideoPlay();
      return;
    }
    const obj = studioCanvas.getActiveObject();
    if (obj && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowUp') obj.set('top', obj.top - step);
      if (e.key === 'ArrowDown') obj.set('top', obj.top + step);
      if (e.key === 'ArrowLeft') obj.set('left', obj.left - step);
      if (e.key === 'ArrowRight') obj.set('left', obj.left + step);
      obj.setCoords();
      studioCanvas.renderAll();
    }
  }

  // Export to window for onclick handlers + portal nav
  const api = {
    renderCreationStudio: renderCreationStudio,
    initCreationStudio: initCreationStudio,
    studioUndo: studioUndo,
    studioRedo: studioRedo,
    toggleVersionHistory: toggleVersionHistory,
    studioDownload: studioDownload,
    studioApprove: studioApprove,
    studioAddText: studioAddText,
    studioAddRect: studioAddRect,
    studioAddEllipse: studioAddEllipse,
    studioAddLine: studioAddLine,
    studioAddImage: studioAddImage,
    toggleVideoPlay: toggleVideoPlay,
    seekVideo: seekVideo,
    scrubVideo: scrubVideo,
    muteToggleVideo: muteToggleVideo,
    exportVideoWithOverlays: exportVideoWithOverlays,
    exportVideoFrame: exportVideoFrame,
    analyzeVideoFrame: analyzeVideoFrame,
    captureFrameAndAnalyze: captureFrameAndAnalyze,
    setAnalysisMode: setAnalysisMode,
    clearAnalysisCache: clearAnalysisCache,
    triggerAnalysis: triggerAnalysis,
    triggerLiteLocalAnalysis: triggerLiteLocalAnalysis,
    addManifestElement: addManifestElement,
    openElementEditor: openElementEditor,
    applyTextEdit: applyTextEdit,
    removeElementWithInpaint: removeElementWithInpaint,
    exportStudioOutput: exportStudioOutput,
    toggleSAMMode: toggleSAMMode,
    studioClearCanvas: studioClearCanvas,
    studioDeleteSelected: studioDeleteSelected,
    studioDuplicate: studioDuplicate,
    studioLayerOrder: studioLayerOrder,
    studioZoomIn: studioZoomIn,
    studioZoomOut: studioZoomOut,
    studioZoomFit: studioZoomFit,
    studioTriggerHiggsfield: studioTriggerHiggsfield,
    showRightTab: showRightTab,
    applyProp: applyProp,
    applyPropNum: applyPropNum,
    applyTransform: applyTransform,
    applyTextShadow: applyTextShadow,
    applyImageFilter: applyImageFilter,
    toggleTextStyle: toggleTextStyle,
    setCanvasBg: setCanvasBg,
    applySwatchToSelected: applySwatchToSelected,
    selectLayerObject: selectLayerObject,
    toggleLayerVisibility: toggleLayerVisibility,
    toggleLayerLock: toggleLayerLock,
    restoreHistoryAt: restoreHistoryAt,
    sendStudioChat: sendStudioChat,
    applyPendingOps: applyPendingOps,
    cancelPendingOps: cancelPendingOps,
    applyVariation: applyVariation,
  };
  Object.keys(api).forEach(function (k) { global[k] = api[k]; });
  // Portal wrapper calls this to avoid clobbering recursion with its own renderCreationStudio
  global.__renderCreationStudioImpl = renderCreationStudio;
  Object.defineProperty(global, 'studioCanvas', {
    get: function () { return studioCanvas; },
    configurable: true,
  });
})(window);
