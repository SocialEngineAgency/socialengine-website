/**
 * Claude Design Studio — Phase 1
 * Brief → on-brand square HTML → PNG → content queue
 */
(function () {
  'use strict';

  let _csGenerating = false;
  let _csHtml = '';
  let _csBrief = '';
  let _csSpec = { w: 1080, h: 1080 };
  let _csBrandName = '';

  function apiBase() {
    return (typeof window.API !== 'undefined' && window.API) || window._seAPI || '';
  }
  function authHeaders() {
    const email = window.clientEmail || window.__clientEmail || '';
    const hash = window.clientHash || window.__clientHash || '';
    return {
      'Content-Type': 'application/json',
      'x-client-email': email,
      'x-client-hash': hash,
    };
  }

  function renderClaudeStudio() {
    const content = document.getElementById('dash-content');
    if (!content) return;

    const data = window._studioClientData || window.__clientData || window.clientData || {};
    _csBrandName = data?.client?.business_name || data?.business_name || 'Your Brand';

    content.innerHTML = `
      <div style="display:flex;height:calc(100vh - 56px);overflow:hidden;">
        <div style="width:300px;min-width:300px;border-right:1px solid rgba(255,255,255,0.07);overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:14px;background:rgba(10,16,28,0.6);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div>
              <div style="font-family:var(--font-display);font-size:1.15rem;font-weight:700;color:#fff;">Claude Design</div>
              <div style="font-size:0.72rem;color:rgba(255,255,255,0.35);margin-top:2px;">Phase 1 · Instagram Square</div>
            </div>
            <button type="button" id="cs-back-video" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:rgba(255,255,255,0.5);font-size:0.7rem;font-weight:600;cursor:pointer;font-family:var(--font-body);">← Video</button>
          </div>

          <div>
            <div style="font-size:0.68rem;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">Describe your post</div>
            <textarea id="cs-brief" rows="5" placeholder="e.g. World Oesophageal Cancer Awareness Day — 3 warning signs people miss. Bold and urgent." style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:11px 12px;color:#fff;font-size:0.82rem;font-family:var(--font-body);line-height:1.5;resize:vertical;outline:none;"></textarea>
          </div>

          <div>
            <div style="font-size:0.68rem;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">Photo URL (optional)</div>
            <input id="cs-photo" type="url" placeholder="https://..." style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:9px 11px;color:#fff;font-size:0.79rem;font-family:var(--font-body);outline:none;">
          </div>

          <div>
            <div style="font-size:0.68rem;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">Style hint (optional)</div>
            <input id="cs-style" type="text" placeholder="Bold typographic, dark, minimal" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:9px 11px;color:#fff;font-size:0.79rem;font-family:var(--font-body);outline:none;">
          </div>

          <button type="button" id="cs-generate" style="width:100%;padding:13px;background:linear-gradient(135deg,#7C3AED,#4F46E5);border:none;border-radius:10px;color:#fff;font-size:0.85rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Generate design</button>

          <div style="margin-top:auto;padding:10px 12px;background:rgba(124,58,237,0.06);border:1px solid rgba(124,58,237,0.15);border-radius:9px;">
            <div style="font-size:0.65rem;font-weight:700;color:rgba(124,58,237,0.6);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:4px;">Auto-branded as</div>
            <div style="font-size:0.8rem;font-weight:600;color:rgba(255,255,255,0.7);" id="cs-brand-pill">${escapeHtml(_csBrandName)}</div>
            <div style="font-size:0.68rem;color:rgba(255,255,255,0.3);margin-top:2px;">Colors, logo & voice applied automatically</div>
          </div>
        </div>

        <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;background:rgba(8,14,24,0.8);">
          <div style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.06);font-size:0.72rem;color:rgba(255,255,255,0.35);">Preview · Instagram Square 1:1</div>
          <div id="cs-preview-wrap" style="flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;padding:32px;">
            <div id="cs-empty" style="text-align:center;max-width:420px;">
              <div style="font-family:var(--font-display);font-size:1.35rem;font-weight:700;color:rgba(255,255,255,0.7);margin-bottom:10px;">Claude Design Studio</div>
              <div style="font-size:0.88rem;color:rgba(255,255,255,0.3);line-height:1.6;">Describe a post, generate an on-brand square, then export PNG and add it to your queue.</div>
            </div>
            <div id="cs-loading" style="display:none;text-align:center;">
              <div style="width:52px;height:52px;border:3px solid rgba(124,58,237,0.2);border-top-color:#7C3AED;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 20px;"></div>
              <div style="font-size:0.9rem;color:rgba(255,255,255,0.5);">Generating on-brand design…</div>
            </div>
            <div id="cs-frame" style="display:none;position:relative;">
              <iframe id="cs-iframe" style="border:none;display:block;border-radius:4px;background:#fff;" scrolling="no"></iframe>
            </div>
          </div>
          <div id="cs-tweak-bar" style="display:none;padding:12px 16px;border-top:1px solid rgba(255,255,255,0.06);align-items:center;gap:10px;">
            <input id="cs-tweak" type="text" placeholder='Tweak: "bigger headline", "darker background"…' style="flex:1;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:9px 12px;color:#fff;font-size:0.81rem;font-family:var(--font-body);outline:none;">
            <button type="button" id="cs-tweak-btn" style="padding:9px 16px;background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.3);border-radius:8px;color:#C4B5FD;font-size:0.8rem;font-weight:600;cursor:pointer;font-family:var(--font-body);">Tweak</button>
          </div>
        </div>

        <div style="width:240px;min-width:240px;border-left:1px solid rgba(255,255,255,0.07);overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:rgba(10,16,28,0.6);">
          <div style="font-size:0.68rem;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.07em;">Actions</div>
          <button type="button" id="cs-export" disabled style="width:100%;padding:11px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:9px;color:rgba(255,255,255,0.35);font-size:0.8rem;font-weight:600;cursor:not-allowed;font-family:var(--font-body);text-align:left;">Export PNG</button>
          <button type="button" id="cs-queue" disabled style="width:100%;padding:11px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:9px;color:rgba(255,255,255,0.35);font-size:0.8rem;font-weight:600;cursor:not-allowed;font-family:var(--font-body);text-align:left;">Add to Queue</button>
          <button type="button" id="cs-regen" disabled style="width:100%;padding:11px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:9px;color:rgba(255,255,255,0.35);font-size:0.8rem;font-weight:600;cursor:not-allowed;font-family:var(--font-body);text-align:left;">Regenerate</button>
          <div style="height:1px;background:rgba(255,255,255,0.06);margin:4px 0;"></div>
          <div style="font-size:0.68rem;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.07em;">Caption</div>
          <div id="cs-caption-box" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:9px;padding:10px;min-height:72px;font-size:0.75rem;color:rgba(255,255,255,0.3);">Generate a design, then write a caption.</div>
          <button type="button" id="cs-caption" disabled style="width:100%;padding:9px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:rgba(255,255,255,0.35);font-size:0.77rem;font-weight:600;cursor:not-allowed;font-family:var(--font-body);">Get Caption</button>
        </div>
      </div>
      <!-- Offscreen full-res mount for html2canvas -->
      <div id="cs-export-mount" style="position:fixed;left:-10000px;top:0;width:1080px;height:1080px;overflow:hidden;pointer-events:none;"></div>
    `;

    document.getElementById('cs-back-video')?.addEventListener('click', () => {
      if (typeof window.renderVideoStudio === 'function') window.renderVideoStudio();
    });
    document.getElementById('cs-generate')?.addEventListener('click', () => generate());
    document.getElementById('cs-regen')?.addEventListener('click', () => generate());
    document.getElementById('cs-tweak-btn')?.addEventListener('click', () => tweak());
    document.getElementById('cs-tweak')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') tweak(); });
    document.getElementById('cs-export')?.addEventListener('click', () => exportPng(false));
    document.getElementById('cs-queue')?.addEventListener('click', () => exportPng(true));
    document.getElementById('cs-caption')?.addEventListener('click', () => getCaption());

    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function setBusy(busy, msg) {
    _csGenerating = busy;
    const gen = document.getElementById('cs-generate');
    if (gen) {
      gen.disabled = busy;
      gen.textContent = busy ? (msg || 'Generating…') : 'Generate design';
    }
    document.getElementById('cs-empty').style.display = busy || _csHtml ? 'none' : 'block';
    document.getElementById('cs-loading').style.display = busy ? 'block' : 'none';
    if (busy) document.getElementById('cs-frame').style.display = 'none';
  }

  function enableActions(on) {
    ['cs-export', 'cs-queue', 'cs-regen', 'cs-caption'].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.disabled = !on;
      btn.style.cursor = on ? 'pointer' : 'not-allowed';
      btn.style.color = on ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)';
      btn.style.borderColor = on ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.08)';
      if (id === 'cs-queue' && on) {
        btn.style.background = 'linear-gradient(135deg,rgba(124,58,237,0.35),rgba(79,70,229,0.25))';
        btn.style.borderColor = 'rgba(124,58,237,0.45)';
        btn.style.color = '#E9D5FF';
      }
    });
    const bar = document.getElementById('cs-tweak-bar');
    if (bar) bar.style.display = on ? 'flex' : 'none';
  }

  function showDesign(html, spec) {
    _csHtml = html;
    _csSpec = spec || _csSpec;
    document.getElementById('cs-empty').style.display = 'none';
    document.getElementById('cs-loading').style.display = 'none';
    const frame = document.getElementById('cs-frame');
    const iframe = document.getElementById('cs-iframe');
    frame.style.display = 'block';
    const maxW = 460;
    const scale = Math.min(maxW / _csSpec.w, 1);
    iframe.style.width = _csSpec.w + 'px';
    iframe.style.height = _csSpec.h + 'px';
    iframe.style.transform = `scale(${scale})`;
    iframe.style.transformOrigin = 'top left';
    frame.style.width = Math.round(_csSpec.w * scale) + 'px';
    frame.style.height = Math.round(_csSpec.h * scale) + 'px';
    iframe.srcdoc = html;
    enableActions(true);
  }

  async function generate() {
    if (_csGenerating) return;
    const briefEl = document.getElementById('cs-brief');
    let brief = briefEl?.value?.trim() || '';
    if (!brief) {
      if (typeof showToast === 'function') showToast('Describe your post first', 'warning');
      return;
    }
    _csBrief = brief;
    setBusy(true, 'Generating…');
    try {
      const res = await fetch(`${apiBase()}/api/studio/design-generate`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          brief,
          photo_url: document.getElementById('cs-photo')?.value?.trim() || undefined,
          style_hint: document.getElementById('cs-style')?.value?.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Generation failed');
      if (data.brand?.name) {
        _csBrandName = data.brand.name;
        const pill = document.getElementById('cs-brand-pill');
        if (pill) pill.textContent = _csBrandName;
      }
      showDesign(data.html, data.spec);
      if (typeof showToast === 'function') showToast('Design ready', 'success');
    } catch (e) {
      document.getElementById('cs-loading').style.display = 'none';
      document.getElementById('cs-empty').style.display = 'block';
      if (typeof showToast === 'function') showToast(e.message || 'Generation failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function tweak() {
    const t = document.getElementById('cs-tweak')?.value?.trim();
    if (!t) return;
    const briefEl = document.getElementById('cs-brief');
    const base = briefEl?.value?.trim() || _csBrief;
    briefEl.value = `${base} [MODIFICATION: ${t}]`;
    document.getElementById('cs-tweak').value = '';
    await generate();
  }

  async function rasterizePngBlob() {
    if (!_csHtml) throw new Error('No design to export');
    if (typeof html2canvas !== 'function') throw new Error('html2canvas not loaded — hard refresh');

    const mount = document.getElementById('cs-export-mount');
    mount.innerHTML = '';
    const host = document.createElement('div');
    host.style.cssText = `width:${_csSpec.w}px;height:${_csSpec.h}px;overflow:hidden;background:#fff;`;
    // Prefer iframe content for fidelity
    const iframe = document.createElement('iframe');
    iframe.style.cssText = `width:${_csSpec.w}px;height:${_csSpec.h}px;border:0;`;
    mount.appendChild(iframe);
    await new Promise((resolve) => {
      iframe.onload = resolve;
      iframe.srcdoc = _csHtml;
      setTimeout(resolve, 1200);
    });

    const doc = iframe.contentDocument;
    const target = doc?.body || host;
    const canvas = await html2canvas(target, {
      width: _csSpec.w,
      height: _csSpec.h,
      scale: 1,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      windowWidth: _csSpec.w,
      windowHeight: _csSpec.h,
    });
    mount.innerHTML = '';
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encode failed'))), 'image/png');
    });
  }

  async function exportPng(andQueue) {
    if (_csGenerating || !_csHtml) return;
    const btn = document.getElementById(andQueue ? 'cs-queue' : 'cs-export');
    const prev = btn?.textContent;
    if (btn) { btn.textContent = andQueue ? 'Queuing…' : 'Exporting…'; btn.disabled = true; }
    try {
      const blob = await rasterizePngBlob();
      if (!andQueue) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `claude-design-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
        if (typeof showToast === 'function') showToast('PNG downloaded', 'success');
        return;
      }

      // Upload then queue
      const fd = new FormData();
      fd.append('file', blob, `claude-design-${Date.now()}.png`);
      const up = await fetch(`${apiBase()}/api/studio/upload-image`, {
        method: 'POST',
        headers: {
          'x-client-email': window.clientEmail || window.__clientEmail || '',
          'x-client-hash': window.clientHash || window.__clientHash || '',
        },
        body: fd,
      });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok || !upData.url) throw new Error(upData.error || 'Upload failed');

      const captionBox = document.getElementById('cs-caption-box');
      const captionText = captionBox?.dataset?.caption || '';

      const q = await fetch(`${apiBase()}/api/studio/design-queue`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          image_url: upData.url,
          brief: _csBrief,
          caption: captionText || _csBrief,
          platform: 'Instagram',
          status: 'Approved',
        }),
      });
      const qData = await q.json().catch(() => ({}));
      if (!q.ok || !(qData.ok || qData.success)) throw new Error(qData.error || 'Queue failed');
      if (typeof showToast === 'function') showToast('Added to content queue', 'success');
      if (btn) btn.textContent = 'Added ✓';
      setTimeout(() => { if (btn) btn.textContent = prev || 'Add to Queue'; }, 1600);
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message || 'Export failed', 'error');
    } finally {
      if (btn && btn.textContent.includes('…')) btn.textContent = prev || (andQueue ? 'Add to Queue' : 'Export PNG');
      enableActions(true);
    }
  }

  async function getCaption() {
    const box = document.getElementById('cs-caption-box');
    const btn = document.getElementById('cs-caption');
    if (!_csBrief) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Writing…'; }
    if (box) box.innerHTML = '<span style="color:rgba(255,255,255,0.35);">Writing caption…</span>';
    try {
      const res = await fetch(`${apiBase()}/api/studio/generate-caption`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ description: _csBrief, platform: 'Instagram' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Caption failed');
      const caption = data.caption || '';
      if (box) {
        box.dataset.caption = caption;
        box.innerHTML = `<div style="font-size:0.77rem;color:rgba(255,255,255,0.75);line-height:1.5;white-space:pre-wrap;">${escapeHtml(caption)}</div>`;
      }
    } catch (e) {
      if (box) box.innerHTML = `<span style="color:#F87171;">${escapeHtml(e.message)}</span>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Get Caption'; btn.style.cursor = 'pointer'; btn.style.color = 'rgba(255,255,255,0.75)'; }
    }
  }

  window.renderClaudeStudio = renderClaudeStudio;
})();
