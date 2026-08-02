/**
 * Studio · Post — Phase 1.5
 * Reference picker (Products / Library / Uploads) → on-brand square → PNG → queue
 */
(function () {
  'use strict';

  let _csGenerating = false;
  let _csHtml = '';
  let _csBrief = '';
  let _csSpec = { w: 1080, h: 1080 };
  let _csBrandName = '';
  let _csRef = null; // { url, type, title, source, product_id?, video_url?, poster_url? }
  let _csPickerTab = 'products';

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
  function authHeadersMultipart() {
    return {
      'x-client-email': window.clientEmail || window.__clientEmail || '',
      'x-client-hash': window.clientHash || window.__clientHash || '',
    };
  }
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'info');
  }

  function setReference(ref) {
    if (!ref || !ref.url) {
      _csRef = null;
      window._studioReference = null;
    } else {
      _csRef = {
        url: String(ref.url),
        type: ref.type === 'video' ? 'video' : 'image',
        title: String(ref.title || 'Reference'),
        source: ref.source || 'upload',
        product_id: ref.product_id || undefined,
        video_url: ref.video_url || undefined,
        poster_url: ref.poster_url || undefined,
      };
      window._studioReference = { ..._csRef };
    }
    renderRefSummary();
  }

  function heroUrlForGenerate() {
    if (!_csRef) return '';
    if (_csRef.type === 'video') return _csRef.poster_url || _csRef.url || '';
    return _csRef.url || '';
  }

  function renderRefSummary() {
    const box = document.getElementById('cs-ref-summary');
    if (!box) return;
    if (!_csRef) {
      box.innerHTML = `
        <div style="font-size:0.78rem;color:rgba(255,255,255,0.35);line-height:1.45;">No reference yet — pick a Shopify product, past content, or upload.</div>
        <button type="button" id="cs-ref-open" style="margin-top:10px;width:100%;padding:10px;background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.35);border-radius:9px;color:#C4B5FD;font-size:0.8rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Choose reference</button>`;
      document.getElementById('cs-ref-open')?.addEventListener('click', openPicker);
      return;
    }
    const thumb = _csRef.poster_url || _csRef.url;
    box.innerHTML = `
      <div style="display:flex;gap:10px;align-items:flex-start;">
        <img src="${escapeHtml(thumb)}" alt="" style="width:56px;height:56px;border-radius:8px;object-fit:cover;border:1px solid rgba(255,255,255,0.1);background:#111;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.78rem;font-weight:700;color:#fff;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(_csRef.title)}</div>
          <div style="font-size:0.65rem;color:rgba(255,255,255,0.35);margin-top:3px;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(_csRef.source)} · ${_csRef.type}</div>
          ${_csRef.type === 'video' && !_csRef.poster_url ? '<div style="font-size:0.68rem;color:#FBBF24;margin-top:4px;">Video selected — Claude Design needs a still. Upload a frame or open Video Studio.</div>' : ''}
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button type="button" id="cs-ref-open" style="flex:1;padding:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:rgba(255,255,255,0.7);font-size:0.72rem;font-weight:600;cursor:pointer;font-family:var(--font-body);">Change</button>
        <button type="button" id="cs-ref-clear" style="padding:8px 10px;background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:rgba(255,255,255,0.4);font-size:0.72rem;font-weight:600;cursor:pointer;font-family:var(--font-body);">Clear</button>
      </div>`;
    document.getElementById('cs-ref-open')?.addEventListener('click', openPicker);
    document.getElementById('cs-ref-clear')?.addEventListener('click', () => setReference(null));
  }

  function openPicker() {
    const modal = document.getElementById('cs-picker-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    setPickerTab(_csPickerTab || 'products');
  }
  function closePicker() {
    const modal = document.getElementById('cs-picker-modal');
    if (modal) modal.style.display = 'none';
  }

  function setPickerTab(tab) {
    _csPickerTab = tab;
    ['products', 'library', 'uploads'].forEach((t) => {
      const btn = document.getElementById('cs-tab-' + t);
      const panel = document.getElementById('cs-panel-' + t);
      if (btn) {
        const on = t === tab;
        btn.style.background = on ? 'rgba(124,58,237,0.25)' : 'transparent';
        btn.style.color = on ? '#E9D5FF' : 'rgba(255,255,255,0.4)';
      }
      if (panel) panel.style.display = t === tab ? 'block' : 'none';
    });
    if (tab === 'products') loadProducts();
    if (tab === 'library') loadLibrary();
    if (tab === 'uploads') renderUploadsPanel();
  }

  async function loadProducts(q) {
    const grid = document.getElementById('cs-products-grid');
    if (!grid) return;
    grid.innerHTML = '<div style="padding:24px;color:rgba(255,255,255,0.35);font-size:0.8rem;">Loading products…</div>';
    try {
      const params = new URLSearchParams({ limit: '24', page: '1' });
      if (q) params.set('search', q);
      const res = await fetch(`${apiBase()}/api/studio/products?${params}`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      const products = Array.isArray(data.products) ? data.products : [];
      if (!products.length) {
        grid.innerHTML = '<div style="padding:24px;color:rgba(255,255,255,0.35);font-size:0.8rem;">No products found. Connect Shopify or try another search.</div>';
        return;
      }
      grid.innerHTML = products.map((p) => {
        const img = p.primary_image || '';
        const title = p.title || 'Product';
        const id = p.id || '';
        return `<button type="button" class="cs-pick-card" data-url="${escapeHtml(img)}" data-title="${escapeHtml(title)}" data-id="${escapeHtml(String(id))}" data-source="shopify" style="text-align:left;padding:0;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.03);cursor:pointer;overflow:hidden;">
          <div style="aspect-ratio:1;background:#111;"><img src="${escapeHtml(img)}" alt="" style="width:100%;height:100%;object-fit:cover;" loading="lazy"></div>
          <div style="padding:8px 9px;font-size:0.72rem;font-weight:600;color:rgba(255,255,255,0.8);line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(title)}</div>
        </button>`;
      }).join('');
      grid.querySelectorAll('.cs-pick-card').forEach((el) => {
        el.addEventListener('click', () => {
          const url = el.getAttribute('data-url');
          if (!url) { toast('Product has no image', 'warning'); return; }
          setReference({
            url,
            type: 'image',
            title: el.getAttribute('data-title') || 'Product',
            source: 'shopify',
            product_id: el.getAttribute('data-id') || undefined,
          });
          closePicker();
          toast('Product selected', 'success');
        });
      });
    } catch (e) {
      grid.innerHTML = `<div style="padding:24px;color:#F87171;font-size:0.8rem;">${escapeHtml(e.message || 'Failed to load products')}</div>`;
    }
  }

  async function loadLibrary() {
    const grid = document.getElementById('cs-library-grid');
    if (!grid) return;
    grid.innerHTML = '<div style="padding:24px;color:rgba(255,255,255,0.35);font-size:0.8rem;">Loading library…</div>';
    try {
      const res = await fetch(`${apiBase()}/api/studio/media-library?type=all&limit=40`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) {
        grid.innerHTML = '<div style="padding:24px;color:rgba(255,255,255,0.35);font-size:0.8rem;">No past content with media yet.</div>';
        return;
      }
      grid.innerHTML = items.map((it) => {
        const thumb = it.image_url || '';
        const isVideo = it.type === 'video' || (!!it.video_url && !it.image_url);
        const title = it.title || 'Content';
        return `<button type="button" class="cs-lib-card" data-url="${escapeHtml(thumb || it.video_url || '')}" data-poster="${escapeHtml(thumb)}" data-video="${escapeHtml(it.video_url || '')}" data-type="${isVideo ? 'video' : 'image'}" data-title="${escapeHtml(title)}" style="text-align:left;padding:0;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.03);cursor:pointer;overflow:hidden;position:relative;">
          <div style="aspect-ratio:1;background:#111;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.3);font-size:0.7rem;">
            ${thumb ? `<img src="${escapeHtml(thumb)}" alt="" style="width:100%;height:100%;object-fit:cover;" loading="lazy">` : (isVideo ? 'VIDEO' : '—')}
          </div>
          ${isVideo ? '<span style="position:absolute;top:6px;left:6px;font-size:0.58rem;font-weight:800;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,0.55);color:#fff;">VIDEO</span>' : ''}
          <div style="padding:8px 9px;font-size:0.72rem;font-weight:600;color:rgba(255,255,255,0.8);line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(title)}</div>
        </button>`;
      }).join('');
      grid.querySelectorAll('.cs-lib-card').forEach((el) => {
        el.addEventListener('click', () => {
          const type = el.getAttribute('data-type') || 'image';
          const poster = el.getAttribute('data-poster') || '';
          const video = el.getAttribute('data-video') || '';
          const url = poster || el.getAttribute('data-url') || '';
          if (type === 'video' && !poster) {
            setReference({
              url: video,
              type: 'video',
              title: el.getAttribute('data-title') || 'Video',
              source: 'library',
              video_url: video,
              poster_url: '',
            });
            closePicker();
            toast('Video needs a still for Claude Design — upload a frame or use Video Studio', 'warning');
            return;
          }
          if (!url) { toast('No usable image on that item', 'warning'); return; }
          setReference({
            url,
            type: 'image',
            title: el.getAttribute('data-title') || 'Content',
            source: 'library',
            video_url: video || undefined,
            poster_url: poster || undefined,
          });
          closePicker();
          toast('Library item selected', 'success');
        });
      });
    } catch (e) {
      grid.innerHTML = `<div style="padding:24px;color:#F87171;font-size:0.8rem;">${escapeHtml(e.message || 'Failed to load library')}</div>`;
    }
  }

  function renderUploadsPanel() {
    const sess = document.getElementById('cs-session-upload');
    if (!sess) return;
    const existing = window._studioReference && window._studioReference.source === 'upload' ? window._studioReference : null;
    const vsHint = (window.vsUploadedImageUrl || window._vsUploadedImageUrl)
      ? `<button type="button" id="cs-use-vs-upload" style="margin-top:10px;width:100%;padding:10px;border-radius:9px;border:1px solid rgba(16,185,129,0.35);background:rgba(16,185,129,0.1);color:#6EE7B7;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Use Video Studio upload</button>`
      : '';
    sess.innerHTML = `
      <div style="font-size:0.78rem;color:rgba(255,255,255,0.45);line-height:1.45;margin-bottom:12px;">Upload an image (preferred). Videos need a still frame for Claude Design.</div>
      <div id="cs-drop" style="border:2px dashed rgba(255,255,255,0.12);border-radius:12px;padding:28px 16px;text-align:center;cursor:pointer;background:rgba(255,255,255,0.02);">
        <div style="font-size:0.85rem;font-weight:600;color:rgba(255,255,255,0.7);">Drop image here or click</div>
        <div style="font-size:0.7rem;color:rgba(255,255,255,0.3);margin-top:6px;">PNG / JPG / WEBP · max 10MB</div>
      </div>
      <input type="file" id="cs-file" accept="image/*" style="display:none;">
      ${vsHint}
      ${existing ? `<div style="margin-top:12px;font-size:0.72rem;color:rgba(255,255,255,0.4);">Current: ${escapeHtml(existing.title)}</div>` : ''}`;
    const drop = document.getElementById('cs-drop');
    const file = document.getElementById('cs-file');
    drop?.addEventListener('click', () => file?.click());
    drop?.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.borderColor = 'rgba(124,58,237,0.45)'; });
    drop?.addEventListener('dragleave', () => { drop.style.borderColor = 'rgba(255,255,255,0.12)'; });
    drop?.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.style.borderColor = 'rgba(255,255,255,0.12)';
      const f = e.dataTransfer?.files?.[0];
      if (f) uploadLocalFile(f);
    });
    file?.addEventListener('change', () => { if (file.files?.[0]) uploadLocalFile(file.files[0]); });
    document.getElementById('cs-use-vs-upload')?.addEventListener('click', () => {
      const url = window.vsUploadedImageUrl || window._vsUploadedImageUrl;
      if (!url) return;
      setReference({ url, type: 'image', title: 'Studio upload', source: 'upload' });
      closePicker();
      toast('Using Video Studio upload', 'success');
    });
  }

  async function uploadLocalFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please upload an image file', 'warning'); return; }
    if (file.size > 10 * 1024 * 1024) { toast('Image must be under 10MB', 'warning'); return; }
    toast('Uploading…', 'info');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('image', file);
      const res = await fetch(`${apiBase()}/api/studio/upload-image`, {
        method: 'POST',
        headers: authHeadersMultipart(),
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
      setReference({ url: data.url, type: 'image', title: file.name || 'Upload', source: 'upload' });
      closePicker();
      toast('Upload ready', 'success');
    } catch (e) {
      toast(e.message || 'Upload failed', 'error');
    }
  }

  async function resolveAdvancedUrl() {
    const input = document.getElementById('cs-photo');
    const raw = input?.value?.trim() || '';
    if (!raw) { toast('Paste a URL first', 'warning'); return; }
    if (/\/products\//i.test(raw) && !/\.(jpe?g|png|webp|gif)(\?|$)/i.test(raw)) {
      toast('Resolving product URL…', 'info');
      try {
        const res = await fetch(`${apiBase()}/api/studio/product-from-url`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ url: raw }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.product?.primary_image) {
          throw new Error(data.error || 'Could not match that product URL in your catalog');
        }
        setReference({
          url: data.product.primary_image,
          type: 'image',
          title: data.product.title || 'Product',
          source: 'shopify',
          product_id: data.product.id ? String(data.product.id) : undefined,
        });
        toast('Product matched from URL', 'success');
        return;
      } catch (e) {
        toast(e.message, 'error');
        return;
      }
    }
    if (!/^https?:\/\//i.test(raw)) { toast('URL must start with https://', 'warning'); return; }
    setReference({ url: raw, type: 'image', title: 'Pasted URL', source: 'url' });
    toast('URL set as reference', 'success');
  }

  function renderClaudeStudio() {
    const content = document.getElementById('dash-content');
    if (!content) return;

    const data = window._studioClientData || window.__clientData || window.clientData || {};
    _csBrandName = data?.client?.business_name || data?.business_name || 'Your Brand';
    _csHtml = '';
    _csBrief = '';

    // Inherit shared reference (e.g. from Video Studio upload)
    if (window._studioReference && window._studioReference.url) {
      _csRef = { ...window._studioReference };
    } else if (window.vsUploadedImageUrl || window._vsUploadedImageUrl) {
      const url = window.vsUploadedImageUrl || window._vsUploadedImageUrl;
      _csRef = { url, type: 'image', title: 'Studio upload', source: 'upload' };
      window._studioReference = { ..._csRef };
    } else {
      _csRef = null;
    }

    content.innerHTML = `
      <div style="display:flex;height:calc(100vh - 56px);overflow:hidden;">
        <div style="width:300px;min-width:300px;border-right:1px solid rgba(255,255,255,0.07);overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:14px;background:rgba(10,16,28,0.6);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div>
              <div style="font-family:var(--font-display);font-size:1.15rem;font-weight:700;color:#fff;">Post</div>
              <div style="font-size:0.72rem;color:rgba(255,255,255,0.35);margin-top:2px;">Static square · brand + catalog</div>
            </div>
            <div style="display:inline-flex;padding:2px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:9px;gap:2px;">
              <button type="button" id="cs-back-video" style="padding:6px 10px;border:none;border-radius:7px;background:transparent;color:rgba(255,255,255,0.45);font-size:0.7rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Video</button>
              <button type="button" style="padding:6px 10px;border:none;border-radius:7px;background:rgba(124,58,237,0.28);color:#E9D5FF;font-size:0.7rem;font-weight:700;cursor:default;font-family:var(--font-body);">Post</button>
            </div>
          </div>

          <div>
            <div style="font-size:0.68rem;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">Reference</div>
            <div id="cs-ref-summary" style="padding:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;"></div>
          </div>

          <div>
            <div style="font-size:0.68rem;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">Describe your post</div>
            <textarea id="cs-brief" rows="5" placeholder="e.g. Bella Bustier launch — gothic elegance, shop now. Bold product-first square." style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:11px 12px;color:#fff;font-size:0.82rem;font-family:var(--font-body);line-height:1.5;resize:vertical;outline:none;"></textarea>
          </div>

          <div>
            <div style="font-size:0.68rem;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">Style hint (optional)</div>
            <input id="cs-style" type="text" placeholder="Bold typographic, dark, minimal" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:9px 11px;color:#fff;font-size:0.79rem;font-family:var(--font-body);outline:none;">
          </div>

          <details style="border:1px solid rgba(255,255,255,0.06);border-radius:9px;padding:8px 10px;">
            <summary style="font-size:0.7rem;color:rgba(255,255,255,0.35);cursor:pointer;font-weight:600;">Advanced · paste URL</summary>
            <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;">
              <input id="cs-photo" type="url" placeholder="Image URL or Shopify product URL" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:9px 11px;color:#fff;font-size:0.79rem;font-family:var(--font-body);outline:none;">
              <button type="button" id="cs-resolve-url" style="padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.65);font-size:0.72rem;font-weight:600;cursor:pointer;font-family:var(--font-body);">Use URL</button>
            </div>
          </details>

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
              <div style="font-size:0.88rem;color:rgba(255,255,255,0.3);line-height:1.6;">Pick a product, write a short brief, generate a branded square, queue it.</div>
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

      <div id="cs-picker-modal" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.65);align-items:center;justify-content:center;padding:24px;">
        <div style="width:min(820px,100%);max-height:min(80vh,720px);background:#0F172A;border:1px solid rgba(255,255,255,0.1);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;">
          <div style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div style="font-family:var(--font-display);font-size:1.05rem;font-weight:700;color:#fff;">Choose reference</div>
            <button type="button" id="cs-picker-close" style="background:none;border:none;color:rgba(255,255,255,0.45);font-size:1.2rem;cursor:pointer;">×</button>
          </div>
          <div style="display:flex;gap:6px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);">
            <button type="button" id="cs-tab-products" style="flex:1;padding:8px;border:none;border-radius:8px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Products</button>
            <button type="button" id="cs-tab-library" style="flex:1;padding:8px;border:none;border-radius:8px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Library</button>
            <button type="button" id="cs-tab-uploads" style="flex:1;padding:8px;border:none;border-radius:8px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Uploads</button>
          </div>
          <div style="flex:1;overflow:auto;padding:14px;">
            <div id="cs-panel-products">
              <input id="cs-product-search" type="search" placeholder="Search products…" style="width:100%;box-sizing:border-box;margin-bottom:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:#fff;font-size:0.8rem;font-family:var(--font-body);outline:none;">
              <div id="cs-products-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;"></div>
            </div>
            <div id="cs-panel-library" style="display:none;">
              <div id="cs-library-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;"></div>
            </div>
            <div id="cs-panel-uploads" style="display:none;">
              <div id="cs-session-upload"></div>
            </div>
          </div>
        </div>
      </div>

      <div id="cs-export-mount" style="position:fixed;left:-10000px;top:0;width:1080px;height:1080px;overflow:hidden;pointer-events:none;"></div>
    `;

    renderRefSummary();

    document.getElementById('cs-back-video')?.addEventListener('click', () => {
      if (typeof window.renderVideoStudio === 'function') {
        window.renderVideoStudio();
      } else if (typeof showToast === 'function') {
        showToast('Video Studio unavailable — refresh and try again', 'error');
      }
    });
    document.getElementById('cs-generate')?.addEventListener('click', () => generate());
    document.getElementById('cs-regen')?.addEventListener('click', () => generate());
    document.getElementById('cs-tweak-btn')?.addEventListener('click', () => tweak());
    document.getElementById('cs-tweak')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') tweak(); });
    document.getElementById('cs-export')?.addEventListener('click', () => exportPng(false));
    document.getElementById('cs-queue')?.addEventListener('click', () => exportPng(true));
    document.getElementById('cs-caption')?.addEventListener('click', () => getCaption());
    document.getElementById('cs-resolve-url')?.addEventListener('click', () => resolveAdvancedUrl());
    document.getElementById('cs-picker-close')?.addEventListener('click', closePicker);
    document.getElementById('cs-picker-modal')?.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'cs-picker-modal') closePicker();
    });
    document.getElementById('cs-tab-products')?.addEventListener('click', () => setPickerTab('products'));
    document.getElementById('cs-tab-library')?.addEventListener('click', () => setPickerTab('library'));
    document.getElementById('cs-tab-uploads')?.addEventListener('click', () => setPickerTab('uploads'));

    let searchTimer = null;
    document.getElementById('cs-product-search')?.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadProducts(e.target.value.trim()), 280);
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();
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
      toast('Describe your post first', 'warning');
      return;
    }
    const hero = heroUrlForGenerate();
    if (_csRef && _csRef.type === 'video' && !hero) {
      toast('This video has no still — upload a frame or use Video Studio', 'warning');
      return;
    }
    _csBrief = brief;
    setBusy(true, 'Generating…');
    try {
      const payload = {
        brief,
        style_hint: document.getElementById('cs-style')?.value?.trim() || undefined,
      };
      if (_csRef && hero) {
        payload.reference = { ..._csRef, url: hero };
        payload.photo_url = hero;
      }
      const res = await fetch(`${apiBase()}/api/studio/design-generate`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (data.code === 'USE_VIDEO_STUDIO') {
          toast(data.error || 'Use Video Studio for animation', 'warning');
          throw new Error(data.error || 'Use Video Studio');
        }
        throw new Error(data.error || 'Generation failed');
      }
      if (data.brand?.name) {
        _csBrandName = data.brand.name;
        const pill = document.getElementById('cs-brand-pill');
        if (pill) pill.textContent = _csBrandName;
      }
      showDesign(data.html, data.spec);
      toast('Design ready', 'success');
    } catch (e) {
      document.getElementById('cs-loading').style.display = 'none';
      document.getElementById('cs-empty').style.display = _csHtml ? 'none' : 'block';
      toast(e.message || 'Generation failed', 'error');
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
    const iframe = document.createElement('iframe');
    iframe.style.cssText = `width:${_csSpec.w}px;height:${_csSpec.h}px;border:0;`;
    mount.appendChild(iframe);
    await new Promise((resolve) => {
      iframe.onload = resolve;
      iframe.srcdoc = _csHtml;
      setTimeout(resolve, 1800);
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
        toast('PNG downloaded', 'success');
        return;
      }

      const fd = new FormData();
      fd.append('file', blob, `claude-design-${Date.now()}.png`);
      const up = await fetch(`${apiBase()}/api/studio/upload-image`, {
        method: 'POST',
        headers: authHeadersMultipart(),
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
      toast('Added to content queue', 'success');
      if (btn) btn.textContent = 'Added ✓';
      setTimeout(() => { if (btn) btn.textContent = prev || 'Add to Queue'; }, 1600);
    } catch (e) {
      toast(e.message || 'Export failed', 'error');
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
  window.openClaudeDesignStudio = function openClaudeDesignStudio() {
    try {
      const url = window.vsUploadedImageUrl || window._vsUploadedImageUrl;
      if (url && (!window._studioReference || !window._studioReference.url)) {
        window._studioReference = { url, type: 'image', title: 'Studio upload', source: 'upload' };
      }
    } catch (_) {}
    renderClaudeStudio();
  };
})();
