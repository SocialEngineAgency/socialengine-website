/**
 * Studio · Post — Phase 1.5
 * Reference picker (Products / Library / Uploads) → on-brand 9:16 (or specified) → PNG → queue
 * Infographic upload → split into IG+FB carousel slides
 * Or upload 2–10 already-cut squares (filename order) and queue as a carousel
 */
(function () {
  'use strict';

  let _csGenerating = false;
  let _csHtml = '';
  let _csBrief = '';
  let _csSpec = { w: 1080, h: 1920, ratio: '9:16', label: '9:16', format: 'portrait' };
  let _csGeneratedUrl = null;
  let _csBrandName = '';
  let _csRef = null; // { url, type, title, source, product_id?, video_url?, poster_url? }
  let _csPickerTab = 'products';
  let _csCarousel = null; // { originalUrl, width, height, method, slides: [{ url, y0, y1 }], queueOrder: number[], selected: 0 }
  let _csOriginalPreviewUrl = null;
  let _csCutTimer = null;
  let _csQueueSingleUrl = null;
  let _csSplitSeq = 0;
  let _csCoachPending = null;
  let _csCoachSending = false;
  const CS_MAX_STYLE_REFS = 10;
  const CS_CAROUSEL_SEED = 'Redesign this infographic into a 9:16 Instagram carousel. Look at the image. If reference slides are attached, propose exactly that many slides (Instagram max 10). If none are attached, propose 4 to 6 complete slides. Do not crop strips.';
  let _csCoachStyleUrls = [];

  function queueReady() {
    return (typeof window !== 'undefined' && window.studioQueueReady) || {
      queueableSingleImage({ carousel, designed, imageUrl, type }) {
        if (carousel || designed || type === 'video') return '';
        return String(imageUrl || '').trim();
      },
      captionForQueue({ typedCaption, generatedCaption, brief }) {
        return String(typedCaption || generatedCaption || brief || '').trim();
      },
      queueReviewStatus() { return 'Pending'; },
      openContentReviewAfterQueue() { return false; },
    };
  }

  function afterQueued() {
    toast('Added to content queue', 'success');
    queueReady().openContentReviewAfterQueue();
  }

  function readQueueCaption() {
    const box = document.getElementById('cs-caption-box');
    const typed = box && 'value' in box ? box.value : '';
    return queueReady().captionForQueue({
      typedCaption: typed,
      generatedCaption: box?.dataset?.caption || '',
      brief: document.getElementById('cs-brief')?.value || _csBrief,
    });
  }

  function apiBase() {
    return (typeof window.API !== 'undefined' && window.API) || window._seAPI || '';
  }
  // Session headers come from the portal (window.seApi, set up in portal.html);
  // this script never sees a credential.
  function seHeaders() {
    return (window.seApi && typeof window.seApi.headers === 'function') ? window.seApi.headers() : {};
  }
  function authHeaders() {
    return Object.assign({ 'Content-Type': 'application/json' }, seHeaders());
  }
  function authHeadersMultipart() {
    return seHeaders();
  }
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'info');
  }

  /** Atlas / Aliyun OSS hotlink-blocks portal Referers — display via API proxy. Keep canonical URLs for queue/export. */
  function mediaSrc(url) {
    if (!url) return '';
    if (/\/api\/media(\/|-fetch)/i.test(url)) return url;
    if (/(aliyuncs\.com|atlascloud\.ai|higgsfield\.ai)/i.test(url)) {
      return `${apiBase()}/api/media-fetch?url=${encodeURIComponent(url)}`;
    }
    return url;
  }

  function designStoreKey() {
    const data = window._studioClientData || window.__clientData || window.clientData || {};
    const id = data?.client?.id || data?.client?.contact_email || data?.email || _csBrandName || 'client';
    return `se-design-last:${id}`;
  }

  function persistLastDesign() {
    try {
      if (!_csGeneratedUrl) return;
      localStorage.setItem(designStoreKey(), JSON.stringify({
        image_url: _csGeneratedUrl,
        spec: _csSpec,
        brief: (document.getElementById('cs-brief') && document.getElementById('cs-brief').value) || _csBrief,
        saved_at: Date.now(),
      }));
    } catch (_) {}
  }

  function restoreLastDesign() {
    if (_csGeneratedUrl || _csHtml || hasCarousel() || window.__SE_CAROUSEL_REDESIGN) return false;
    try {
      const raw = localStorage.getItem(designStoreKey());
      if (!raw) return false;
      const row = JSON.parse(raw);
      if (!row || !/^https?:\/\//i.test(row.image_url)) return false;
      if (row.spec) _csSpec = Object.assign({}, _csSpec, row.spec);
      if (row.brief) {
        const briefEl = document.getElementById('cs-brief');
        if (briefEl && !String(briefEl.value || '').trim()) briefEl.value = row.brief;
        _csBrief = row.brief;
      }
      showGeneratedImage(row.image_url, row.spec);
      return true;
    } catch (_) {
      return false;
    }
  }

  function queuePlatform() {
    const data = window.__clientData || window.clientData || window._studioClientData || {};
    const c = data?.client || {};
    const raw = c.social_connected_platforms;
    const list = Array.isArray(raw)
      ? raw
      : String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
    const lower = list.map((p) => String(p || '').toLowerCase());
    const fbFlag = String(c.facebook_connected || '').toLowerCase();
    const fbOff = fbFlag === 'false' || fbFlag === '0' || fbFlag === 'no';
    const hasIg = lower.includes('instagram') || !!String(c.instagram_user_id || '').trim();
    const hasFb = lower.includes('facebook') || (!fbOff && !!(c.meta_page_id && c.meta_page_token));
    if (hasIg && hasFb) return 'Instagram,Facebook';
    if (hasIg) return 'Instagram';
    if (hasFb) return 'Facebook';
    return 'Instagram,Facebook';
  }

  function hasCarousel() {
    return !!( _csCarousel && Array.isArray(_csCarousel.slides) && _csCarousel.slides.length >= 2 );
  }

  function isAssembledCarousel() {
    return hasCarousel() && (_csCarousel.method === 'assembled' || _csCarousel.method === 'redesign');
  }

  function identityQueueOrder(n) {
    return Array.from({ length: n }, (_, i) => i);
  }

  function carouselQueueOrder() {
    if (!_csCarousel || !Array.isArray(_csCarousel.slides)) return [];
    const n = _csCarousel.slides.length;
    if (!_csCarousel.queueOrder || _csCarousel.queueOrder.length !== n) {
      _csCarousel.queueOrder = identityQueueOrder(n);
    }
    return _csCarousel.queueOrder;
  }

  function slidesInQueueOrder() {
    const slides = _csCarousel.slides || [];
    return carouselQueueOrder().map((idx) => slides[idx]).filter(Boolean);
  }

  function masterImageUrl() {
    if (_csGeneratedUrl) return _csGeneratedUrl;
    if (_csRef && _csRef.type === 'image' && _csRef.url) return _csRef.url;
    return _csOriginalPreviewUrl || '';
  }

  function syncSplitButton() {
    const btn = document.getElementById('cs-split-carousel');
    if (!btn) return;
    const on = /^https?:\/\//i.test(masterImageUrl());
    btn.disabled = !on;
    btn.style.cursor = on ? 'pointer' : 'not-allowed';
    btn.style.opacity = on ? '1' : '0.5';
    btn.style.color = on ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)';
  }

  function setPreviewHeader(text) {
    const el = document.getElementById('cs-preview-header');
    if (el) el.textContent = text;
  }

  function previewLabel(spec) {
    const ratio = (spec && (spec.ratio || spec.label)) || '9:16';
    return `Preview · ${ratio}`;
  }

  function fitPreviewFrame(w, h) {
    const maxW = 360;
    const maxH = 640;
    const scale = Math.min(maxW / (w || 1080), maxH / (h || 1920), 1);
    return { scale, frameW: Math.round((w || 1080) * scale), frameH: Math.round((h || 1920) * scale) };
  }

  function hidePreviewPanes() {
    const empty = document.getElementById('cs-empty');
    const loading = document.getElementById('cs-loading');
    const frame = document.getElementById('cs-frame');
    const original = document.getElementById('cs-original-preview');
    const carousel = document.getElementById('cs-carousel');
    if (empty) empty.style.display = 'none';
    if (loading) loading.style.display = 'none';
    if (frame) frame.style.display = 'none';
    if (original) original.style.display = 'none';
    if (carousel) carousel.style.display = 'none';
  }

  function showOriginalPreview(url) {
    const src = url || _csOriginalPreviewUrl || _csRef?.url;
    if (!src) return;
    _csOriginalPreviewUrl = src;
    hidePreviewPanes();
    setPreviewHeader('Preview · Uploaded');
    const wrap = document.getElementById('cs-original-preview');
    const img = document.getElementById('cs-original-preview-img');
    if (img) {
      img.referrerPolicy = 'no-referrer';
      img.src = mediaSrc(src);
    }
    if (wrap) wrap.style.display = 'block';
    refreshActionButtons();
  }

  function setReference(ref) {
    const prevUrl = _csRef?.url || '';
    let clearedCarouselForNewRef = false;
    if (!ref || !ref.url) {
      _csRef = null;
      window._studioReference = null;
      _csCarousel = null;
      _csOriginalPreviewUrl = null;
      _csQueueSingleUrl = null;
      _csSplitSeq += 1;
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
      if (_csCarousel && _csCarousel.originalUrl !== _csRef.url) {
        _csCarousel = null;
        clearedCarouselForNewRef = true;
        _csSplitSeq += 1;
      }
      if (!_csCarousel && _csRef.type === 'image') {
        _csHtml = '';
        _csGeneratedUrl = null;
        _csQueueSingleUrl = _csRef.url;
      } else if (_csRef.type !== 'image') {
        _csQueueSingleUrl = null;
      }
      if (prevUrl && prevUrl !== _csRef.url && _csOriginalPreviewUrl === prevUrl) {
        _csOriginalPreviewUrl = null;
      }
    }
    renderRefSummary();
    syncSplitButton();
    if (!ref || !ref.url) {
      restorePreview();
    } else if (_csRef.type === 'image' && !_csCarousel) {
      showOriginalPreview(_csRef.url);
    } else if (clearedCarouselForNewRef) {
      restorePreview();
    }
    refreshActionButtons();
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
        <img src="${escapeHtml(mediaSrc(thumb))}" alt="" referrerpolicy="no-referrer" style="width:56px;height:56px;border-radius:8px;object-fit:cover;border:1px solid rgba(255,255,255,0.1);background:#111;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.78rem;font-weight:700;color:#fff;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(_csRef.title)}</div>
          <div style="font-size:0.65rem;color:rgba(255,255,255,0.35);margin-top:3px;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(_csRef.source)} · ${_csRef.type}</div>
          ${_csRef.type === 'video' && !_csRef.poster_url ? '<div style="font-size:0.68rem;color:#FBBF24;margin-top:4px;">Video selected — Design Studio needs a still. Upload a frame or open Video Studio.</div>' : ''}
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
          <div style="aspect-ratio:1;background:#111;"><img src="${escapeHtml(mediaSrc(img))}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;" loading="lazy"></div>
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
            ${thumb ? `<img src="${escapeHtml(mediaSrc(thumb))}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;" loading="lazy">` : (isVideo ? 'VIDEO' : '—')}
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
            toast('Video needs a still for Design Studio — upload a frame or use Video Studio', 'warning');
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
      <div style="font-size:0.78rem;color:rgba(255,255,255,0.45);line-height:1.45;margin-bottom:12px;">Upload an image (preferred). Videos need a still frame for Design Studio.</div>
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

  function applyDesignCoachSession() {
    const s = window.__SE_COACH_CREATE_SESSION;
    if (!s || s.destination !== 'design' || !s.prompt) return;
    const apply = typeof window.applyCoachCreateFields === 'function' ? window.applyCoachCreateFields : null;
    const briefEl = document.getElementById('cs-brief');
    const result = apply
      ? apply(s, { csBrief: briefEl })
      : { applied: !!briefEl, keep: true, prompt: s.prompt, attached_image_url: s.attached_image_url };
    if (!result.applied) return;
    if (briefEl) briefEl.value = result.prompt;
    _csBrief = result.prompt;
    if (result.attached_image_url) {
      setReference({
        url: result.attached_image_url,
        type: 'image',
        title: s.product_name || 'Coach still',
        source: 'coach',
      });
    }
    const aspectEl = document.getElementById('cs-aspect');
    if (aspectEl && ['9:16', '1:1', '4:5'].includes(String(s.aspect_ratio || ''))) {
      aspectEl.value = s.aspect_ratio;
    }
    toast('Coach brief loaded — Generate design, or Redesign as carousel.', 'success');
    applyRedesignedSlides();
  }

  function applyRedesignedSlides() {
    const pack = window.__SE_CAROUSEL_REDESIGN;
    if (!pack || !Array.isArray(pack.slides) || pack.slides.length < 2) return false;
    const slides = pack.slides.map((s, i) => ({
      url: s.url,
      y0: 0,
      y1: 1,
      title: s.title || `Slide ${i + 1}`,
    })).filter((s) => /^https?:\/\//i.test(s.url));
    if (slides.length < 2) return false;
    _csCarousel = {
      originalUrl: pack.master_image_url || slides[0].url,
      method: 'redesign',
      slides,
      selected: 0,
      queueOrder: identityQueueOrder(slides.length),
    };
    _csOriginalPreviewUrl = _csCarousel.originalUrl;
    _csQueueSingleUrl = null;
    if (pack.master_image_url) {
      setReference({
        url: pack.master_image_url,
        type: 'image',
        title: 'Carousel master',
        source: 'coach',
      });
    }
    renderCarouselPreview();
    return true;
  }

  function renderClaudeStudio() {
    const content = document.getElementById('dash-content');
    if (!content) return;

    const data = window._studioClientData || window.__clientData || window.clientData || {};
    _csBrandName = data?.client?.business_name || data?.business_name || 'Your Brand';
    _csHtml = '';
    _csGeneratedUrl = null;
    _csBrief = '';
    _csCarousel = null;
    _csOriginalPreviewUrl = null;
    _csQueueSingleUrl = null;

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
            <div style="font-size:0.68rem;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">Carousel</div>
            <input id="cs-infographic-file" type="file" accept="image/png,image/jpeg,image/webp" multiple style="display:none;">
            <input id="cs-slides-file" type="file" accept="image/png,image/jpeg,image/webp" multiple style="display:none;">
            <button type="button" id="cs-upload-infographic" style="width:100%;padding:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:9px;color:rgba(255,255,255,0.8);font-size:0.78rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Upload infographic</button>
            <button type="button" id="cs-upload-slides" style="width:100%;margin-top:8px;padding:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:9px;color:rgba(255,255,255,0.8);font-size:0.78rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Upload slides</button>
            <button type="button" id="cs-split-carousel" disabled style="width:100%;margin-top:8px;padding:10px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.28);border-radius:9px;color:rgba(255,255,255,0.35);font-size:0.78rem;font-weight:700;cursor:not-allowed;font-family:var(--font-body);opacity:0.5;">Redesign as carousel</button>
            <div style="font-size:0.65rem;color:rgba(255,255,255,0.32);line-height:1.45;margin-top:8px;">Tall graphic → Coach redesigns each slide as a 9:16 frame. Or pick 2–10 slides (filename order) if they are already cut. Instagram max is 10.</div>
          </div>

          <div>
            <div style="font-size:0.68rem;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">Describe your post</div>
            <textarea id="cs-brief" rows="5" placeholder="Already have the graphic? Paste the caption here, then Add to Queue. Or describe a new design to generate." style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:11px 12px;color:#fff;font-size:0.82rem;font-family:var(--font-body);line-height:1.5;resize:vertical;outline:none;"></textarea>
          </div>

          <div>
            <div style="font-size:0.68rem;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">Style hint (optional)</div>
            <input id="cs-style" type="text" placeholder="Bold typographic, dark, minimal" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:9px 11px;color:#fff;font-size:0.79rem;font-family:var(--font-body);outline:none;">
          </div>

          <div>
            <div style="font-size:0.68rem;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">Aspect</div>
            <select id="cs-aspect" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:9px 11px;color:#fff;font-size:0.79rem;font-family:var(--font-body);outline:none;">
              <option value="9:16" selected>9:16 portrait</option>
              <option value="1:1">1:1 square</option>
              <option value="4:5">4:5 portrait</option>
            </select>
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
          <div id="cs-preview-header" style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.06);font-size:0.72rem;color:rgba(255,255,255,0.35);">Preview · 9:16</div>
          <div id="cs-preview-wrap" style="flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;padding:32px;">
            <div id="cs-empty" style="text-align:center;max-width:420px;">
              <div style="font-family:var(--font-display);font-size:1.35rem;font-weight:700;color:rgba(255,255,255,0.7);margin-bottom:10px;">Design Studio</div>
              <div style="font-size:0.88rem;color:rgba(255,255,255,0.3);line-height:1.6;">Upload a finished photo, paste the caption, Add to Queue — or generate a 9:16 design, redesign a tall infographic as a carousel, or drop 2–10 already-cut slides.</div>
            </div>
            <div id="cs-loading" style="display:none;text-align:center;">
              <div style="width:52px;height:52px;border:3px solid rgba(124,58,237,0.2);border-top-color:#7C3AED;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 20px;"></div>
              <div id="cs-loading-msg" style="font-size:0.9rem;color:rgba(255,255,255,0.5);">Generating on-brand design…</div>
            </div>
            <div id="cs-frame" style="display:none;position:relative;">
              <iframe id="cs-iframe" style="border:none;display:block;border-radius:4px;background:#fff;" scrolling="no"></iframe>
            </div>
            <div id="cs-original-preview" style="display:none;max-width:min(420px,100%);text-align:center;">
              <img id="cs-original-preview-img" alt="Infographic" style="max-width:100%;max-height:min(70vh,640px);border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:#111;">
            </div>
            <div id="cs-carousel" style="display:none;width:min(640px,100%);">
              <div id="cs-slide-hero" style="display:none;margin:0 auto 16px;max-width:min(420px,100%);text-align:center;"></div>
              <div id="cs-slide-strip" style="display:flex;gap:8px;overflow-x:auto;padding-bottom:8px;"></div>
              <div id="cs-cut-canvas" style="margin-top:12px;"></div>
              <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px;">
                <button type="button" id="cs-slide-delete" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(248,113,113,0.35);background:rgba(248,113,113,0.1);color:#FCA5A5;font-size:0.72rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Delete selected</button>
                <button type="button" id="cs-slide-redo" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(16,185,129,0.35);background:rgba(16,185,129,0.1);color:#6EE7B7;font-size:0.72rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Redo selected</button>
                <button type="button" id="cs-slide-left" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.75);font-size:0.72rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Move left</button>
                <button type="button" id="cs-slide-right" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.75);font-size:0.72rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Move right</button>
                <label id="cs-slide-count-wrap" style="margin-left:auto;font-size:0.72rem;color:rgba(255,255,255,0.45);display:flex;align-items:center;gap:8px;">Slides
                  <select id="cs-slide-count" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:7px;color:#fff;padding:6px 8px;font-size:0.75rem;font-family:var(--font-body);">
                    <option value="3">3</option>
                    <option value="4">4</option>
                    <option value="5">5</option>
                    <option value="6">6</option>
                    <option value="7">7</option>
                    <option value="8">8</option>
                    <option value="9">9</option>
                    <option value="10">10</option>
                  </select>
                </label>
              </div>
            </div>
          </div>
          <div id="cs-finish-bar" style="padding:12px 16px;border-top:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              <button type="button" id="cs-export" disabled style="padding:9px 12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:rgba(255,255,255,0.35);font-size:0.78rem;font-weight:600;cursor:not-allowed;font-family:var(--font-body);">Export PNG</button>
              <button type="button" id="cs-queue" disabled style="padding:9px 12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:rgba(255,255,255,0.35);font-size:0.78rem;font-weight:600;cursor:not-allowed;font-family:var(--font-body);">Add to Queue</button>
              <button type="button" id="cs-regen" disabled style="padding:9px 12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:rgba(255,255,255,0.35);font-size:0.78rem;font-weight:600;cursor:not-allowed;font-family:var(--font-body);">Regenerate</button>
              <button type="button" id="cs-caption" disabled style="padding:9px 12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:rgba(255,255,255,0.35);font-size:0.78rem;font-weight:600;cursor:not-allowed;font-family:var(--font-body);">Get Caption</button>
            </div>
            <textarea id="cs-caption-box" rows="3" placeholder="Paste your caption here — or Get Caption after you describe the post." style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:9px;padding:10px;min-height:56px;font-size:0.75rem;color:rgba(255,255,255,0.75);font-family:var(--font-body);line-height:1.5;resize:vertical;outline:none;"></textarea>
          </div>
        </div>

        <div id="cs-coach-rail" style="width:340px;min-width:300px;border-left:1px solid rgba(255,255,255,0.07);display:flex;flex-direction:column;background:rgba(10,16,28,0.6);min-height:0;">
          <div style="padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.06);font-size:0.68rem;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.07em;">Coach</div>
          <div id="cs-coach-log" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;min-height:0;"></div>
          <div id="cs-coach-apply-wrap" style="display:none;padding:0 12px 8px;">
            <button type="button" id="cs-coach-apply" style="width:100%;padding:10px;background:linear-gradient(135deg,#059669,#34D399);border:none;border-radius:8px;color:#fff;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Apply</button>
          </div>
          <div style="padding:10px 12px 14px;border-top:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;gap:8px;">
            <div id="cs-coach-style-chip" style="display:none;flex-direction:column;gap:6px;"></div>
            <input id="cs-coach-style-file" type="file" accept="image/png,image/jpeg,image/webp" multiple style="display:none;">
            <textarea id="cs-coach-input" rows="2" placeholder="Ask your coach…" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:9px 10px;color:#fff;font-size:0.78rem;font-family:var(--font-body);line-height:1.45;resize:none;outline:none;"></textarea>
            <div style="display:flex;gap:8px;">
              <button type="button" id="cs-coach-style" style="flex:1;padding:9px 10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:rgba(255,255,255,0.75);font-size:0.74rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">+ Reference photo</button>
              <button type="button" id="cs-coach-send" style="flex:1;padding:9px 12px;background:linear-gradient(135deg,#7C3AED,#4F46E5);border:none;border-radius:8px;color:#fff;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:var(--font-body);">Send</button>
            </div>
          </div>
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
    syncSplitButton();

    document.getElementById('cs-back-video')?.addEventListener('click', () => {
      if (typeof window.renderVideoStudio === 'function') {
        window.renderVideoStudio();
      } else if (typeof showToast === 'function') {
        showToast('Video Studio unavailable — refresh and try again', 'error');
      }
    });
    document.getElementById('cs-generate')?.addEventListener('click', () => generate());
    document.getElementById('cs-regen')?.addEventListener('click', () => generate());
    document.getElementById('cs-export')?.addEventListener('click', () => exportPng(false));
    document.getElementById('cs-coach-send')?.addEventListener('click', () => designCoachAsk());
    document.getElementById('cs-coach-style')?.addEventListener('click', () => {
      if (_csCoachStyleUrls.length >= CS_MAX_STYLE_REFS) {
        toast('10 reference photos max', 'error');
        return;
      }
      document.getElementById('cs-coach-style-file')?.click();
    });
    document.getElementById('cs-coach-style-file')?.addEventListener('change', async (e) => {
      const files = Array.from(e.target?.files || []);
      e.target.value = '';
      if (!files.length) return;
      try {
        let added = 0;
        for (const file of files) {
          if (_csCoachStyleUrls.length >= CS_MAX_STYLE_REFS) {
            toast('10 reference photos max', 'error');
            break;
          }
          const url = await uploadStudioImage(file);
          if (!url) throw new Error('Upload failed');
          if (_csCoachStyleUrls.includes(url)) continue;
          _csCoachStyleUrls.push(url);
          added += 1;
        }
        renderCoachStyleChip();
        if (added === 1) toast('Style reference attached', 'success');
        else if (added > 1) toast(`${added} style references attached`, 'success');
      } catch (err) {
        toast(err.message || 'Upload failed', 'error');
      }
    });
    document.getElementById('cs-coach-apply')?.addEventListener('click', () => applyPendingDesignCoach());
    document.getElementById('cs-coach-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        designCoachAsk();
      }
    });
    document.getElementById('cs-queue')?.addEventListener('click', () => exportPng(true));
    document.getElementById('cs-caption')?.addEventListener('click', () => getCaption());
    document.getElementById('cs-resolve-url')?.addEventListener('click', () => resolveAdvancedUrl());
    document.getElementById('cs-upload-infographic')?.addEventListener('click', () => {
      document.getElementById('cs-infographic-file')?.click();
    });
    document.getElementById('cs-infographic-file')?.addEventListener('change', (e) => {
      const files = e.target?.files ? Array.from(e.target.files) : [];
      if (files.length >= 2) uploadSlideFiles(files);
      else if (files[0]) uploadInfographicFile(files[0]);
      e.target.value = '';
    });
    document.getElementById('cs-upload-slides')?.addEventListener('click', () => {
      document.getElementById('cs-slides-file')?.click();
    });
    document.getElementById('cs-slides-file')?.addEventListener('change', (e) => {
      const files = e.target?.files ? Array.from(e.target.files) : [];
      if (files.length) uploadSlideFiles(files);
      e.target.value = '';
    });
    document.getElementById('cs-split-carousel')?.addEventListener('click', () => {
      const url = masterImageUrl();
      const seed = CS_CAROUSEL_SEED;
      window._seCoachAttachedImage = url;
      window.__SE_COACH_MASTER_IMAGE = url;
      designCoachAsk(seed);
    });
    document.getElementById('cs-slide-delete')?.addEventListener('click', () => deleteSelectedSlide());
    document.getElementById('cs-slide-redo')?.addEventListener('click', () => redoSelectedSlide());
    document.getElementById('cs-slide-left')?.addEventListener('click', () => moveSelectedSlide(-1));
    document.getElementById('cs-slide-right')?.addEventListener('click', () => moveSelectedSlide(1));
    document.getElementById('cs-picker-close')?.addEventListener('click', closePicker);
    document.getElementById('cs-picker-modal')?.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'cs-picker-modal') closePicker();
    });
    document.getElementById('cs-tab-products')?.addEventListener('click', () => setPickerTab('products'));
    document.getElementById('cs-tab-library')?.addEventListener('click', () => setPickerTab('library'));
    document.getElementById('cs-tab-uploads')?.addEventListener('click', () => setPickerTab('uploads'));

    applyDesignCoachSession();
    applyRedesignedSlides();
    restoreLastDesign();
    if (window.__SE_COACH_MASTER_IMAGE && !masterImageUrl()) {
      setReference({
        url: window.__SE_COACH_MASTER_IMAGE,
        type: 'image',
        title: 'Carousel master',
        source: 'coach',
      });
    }
    hydrateDesignCoachLog();
    const seed = window.__SE_DESIGN_COACH_SEED;
    if (seed) {
      window.__SE_DESIGN_COACH_SEED = '';
      designCoachAsk(seed);
    }

    let searchTimer = null;
    document.getElementById('cs-product-search')?.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadProducts(e.target.value.trim()), 280);
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function setActionEnabled(id, on, extra) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = !on;
    btn.style.cursor = on ? 'pointer' : 'not-allowed';
    btn.style.color = on ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)';
    btn.style.borderColor = on ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.08)';
    if (id === 'cs-queue') {
      if (on) {
        btn.style.background = 'linear-gradient(135deg,rgba(124,58,237,0.35),rgba(79,70,229,0.25))';
        btn.style.borderColor = 'rgba(124,58,237,0.45)';
        btn.style.color = '#E9D5FF';
      } else {
        btn.style.background = 'rgba(255,255,255,0.04)';
      }
    }
    if (extra && extra.label) btn.textContent = extra.label;
  }

  function refreshActionButtons() {
    const carousel = hasCarousel();
    const designed = !!_csHtml || !!_csGeneratedUrl;
    const singleUrl = queueReady().queueableSingleImage({
      carousel,
      designed,
      imageUrl: _csQueueSingleUrl || (_csRef?.type === 'image' ? _csRef.url : ''),
      type: _csRef?.type || 'image',
    });
    const single = !!singleUrl;
    if (single) _csQueueSingleUrl = singleUrl;
    setActionEnabled('cs-export', carousel || designed, { label: carousel ? 'Export ZIP' : 'Export PNG' });
    setActionEnabled('cs-queue', carousel || designed || single);
    setActionEnabled('cs-regen', designed && !carousel);
    setActionEnabled('cs-caption', carousel || designed || !!_csOriginalPreviewUrl || single);
  }

  function setBusy(busy, msg) {
    _csGenerating = busy;
    const gen = document.getElementById('cs-generate');
    if (gen) {
      gen.disabled = busy;
      gen.textContent = busy ? (msg || 'Generating…') : 'Generate design';
    }
    const loadMsg = document.getElementById('cs-loading-msg');
    if (loadMsg && msg) loadMsg.textContent = msg;
    if (busy) {
      hidePreviewPanes();
      const loading = document.getElementById('cs-loading');
      if (loading) loading.style.display = 'block';
    } else {
      const loading = document.getElementById('cs-loading');
      const loadingOn = loading && loading.style.display === 'block';
      if (loading) loading.style.display = 'none';
      const shown = ['cs-frame', 'cs-carousel', 'cs-original-preview'].some((id) => {
        const el = document.getElementById(id);
        return el && el.style.display && el.style.display !== 'none';
      });
      if (loadingOn && !shown) restorePreview();
    }
  }

  function restorePreview() {
    if (hasCarousel()) {
      renderCarouselPreview();
      return;
    }
    if (_csGeneratedUrl) {
      showGeneratedImage(_csGeneratedUrl, _csSpec);
      return;
    }
    if (_csHtml) {
      showDesign(_csHtml, _csSpec);
      return;
    }
    if (_csOriginalPreviewUrl) {
      showOriginalPreview(_csOriginalPreviewUrl);
      return;
    }
    hidePreviewPanes();
    setPreviewHeader('Preview · 9:16');
    const empty = document.getElementById('cs-empty');
    if (empty) empty.style.display = 'block';
    refreshActionButtons();
  }

  function enableActions(on) {
    if (on) {
      refreshActionButtons();
      return;
    }
    setActionEnabled('cs-export', false, { label: 'Export PNG' });
    setActionEnabled('cs-queue', false);
    setActionEnabled('cs-regen', false);
    setActionEnabled('cs-caption', !!_csOriginalPreviewUrl || hasCarousel());
  }

  function showDesign(html, spec) {
    _csHtml = html;
    _csGeneratedUrl = null;
    _csSpec = spec || _csSpec;
    _csCarousel = null;
    _csQueueSingleUrl = null;
    hidePreviewPanes();
    setPreviewHeader(previewLabel(_csSpec));
    const frame = document.getElementById('cs-frame');
    const iframe = document.getElementById('cs-iframe');
    frame.style.display = 'block';
    const fit = fitPreviewFrame(_csSpec.w, _csSpec.h);
    iframe.style.width = _csSpec.w + 'px';
    iframe.style.height = _csSpec.h + 'px';
    iframe.style.transform = `scale(${fit.scale})`;
    iframe.style.transformOrigin = 'top left';
    frame.style.width = fit.frameW + 'px';
    frame.style.height = fit.frameH + 'px';
    iframe.srcdoc = html;
    refreshActionButtons();
  }

  function showGeneratedImage(url, spec) {
    _csHtml = '';
    _csGeneratedUrl = url;
    _csSpec = spec || _csSpec;
    _csCarousel = null;
    _csQueueSingleUrl = url;
    _csOriginalPreviewUrl = url;
    hidePreviewPanes();
    setPreviewHeader(previewLabel(_csSpec));
    const wrap = document.getElementById('cs-original-preview');
    const img = document.getElementById('cs-original-preview-img');
    if (img) {
      img.referrerPolicy = 'no-referrer';
      img.src = mediaSrc(url);
    }
    if (wrap) wrap.style.display = 'block';
    _csRef = {
      url,
      type: 'image',
      title: 'Generated design',
      source: 'generate',
    };
    window._studioReference = { ..._csRef };
    renderRefSummary();
    syncSplitButton();
    refreshActionButtons();
    persistLastDesign();
  }

  async function uploadStudioImage(file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${apiBase()}/api/studio/upload-image`, {
      method: 'POST',
      headers: authHeadersMultipart(),
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
    return data.url;
  }

  async function uploadInfographicFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please upload an image file', 'warning'); return; }
    if (file.size > 10 * 1024 * 1024) { toast('Image must be under 10MB', 'warning'); return; }
    toast('Uploading infographic…', 'info');
    try {
      const url = await uploadStudioImage(file);
      _csCarousel = null;
      _csHtml = '';
      _csQueueSingleUrl = null;
      _csOriginalPreviewUrl = url;
      setReference({ url, type: 'image', title: 'Infographic', source: 'upload' });
      showOriginalPreview(url);
      toast('Infographic uploaded', 'success');
    } catch (e) {
      toast(e.message || 'Upload failed', 'error');
    }
  }

  async function uploadSlideFiles(files) {
    const list = (files || [])
      .filter((f) => {
        const t = String(f?.type || '').toLowerCase();
        const name = String(f?.name || '').toLowerCase();
        return t === 'image/png' || t === 'image/jpeg' || t === 'image/jpg' || t === 'image/webp'
          || /\.(png|jpe?g|webp)$/.test(name);
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' }));
    if (!list.length) {
      toast('Only PNG, JPG, or WebP slides are allowed', 'warning');
      return;
    }
    if (list.length < 2 || list.length > 10) {
      toast('Pick 2–10 slide images (Instagram carousel max is 10)', 'warning');
      return;
    }
    if (list.some((f) => f.size > 10 * 1024 * 1024)) {
      toast('Each slide must be under 10MB', 'warning');
      return;
    }
    const seq = ++_csSplitSeq;
    _csHtml = '';
    setBusy(true, `Uploading slides 1/${list.length}…`);
    try {
      const urls = [];
      for (let i = 0; i < list.length; i++) {
        if (seq !== _csSplitSeq) throw new Error('__aborted__');
        setBusy(true, `Uploading slides ${i + 1}/${list.length}…`);
        urls.push(await uploadStudioImage(list[i]));
      }
      if (seq !== _csSplitSeq) throw new Error('__aborted__');
      const n = urls.length;
      const slides = urls.map((url, i) => ({
        url,
        y0: i / n,
        y1: (i + 1) / n,
      }));
      _csCarousel = {
        originalUrl: urls[0],
        width: 1080,
        height: 1080,
        method: 'assembled',
        slides,
        selected: 0,
        queueOrder: identityQueueOrder(n),
      };
      _csOriginalPreviewUrl = urls[0];
      _csQueueSingleUrl = null;
      _csRef = { url: urls[0], type: 'image', title: `${n} carousel slides`, source: 'upload' };
      window._studioReference = { ..._csRef };
      renderRefSummary();
      syncSplitButton();
      renderCarouselPreview();
      toast(`${n} slides uploaded. Add to Queue to save them — they are not posted yet.`, 'success');
    } catch (e) {
      if (e && e.message === '__aborted__') return;
      toast(e.message || 'Slide upload failed', 'error');
    } finally {
      if (seq === _csSplitSeq) {
        setBusy(false);
        if (hasCarousel()) renderCarouselPreview();
      }
    }
  }

  async function splitCarousel(opts) {
    if (isAssembledCarousel() && !(opts && Array.isArray(opts.cuts))) {
      toast('These are already separate slides — reorder or delete instead', 'info');
      return;
    }
    const slideCount = opts && opts.slideCount;
    const cuts = opts && opts.cuts;
    const quiet = Array.isArray(cuts) && cuts.length >= 2;
    const imageUrl = (quiet ? _csCarousel?.originalUrl : null) || _csRef?.url || _csOriginalPreviewUrl;
    if (!imageUrl) { toast('Upload or pick an image first', 'warning'); return; }
    if (_csRef && _csRef.type === 'video') { toast('Split needs an image, not a video', 'warning'); return; }
    const splitBtn = document.getElementById('cs-split-carousel');
    if (splitBtn) { splitBtn.disabled = true; splitBtn.textContent = 'Splitting…'; }
    const seq = ++_csSplitSeq;
    if (!quiet) _csHtml = '';
    if (!quiet) setBusy(true, 'Splitting into carousel…');
    try {
      const body = { image_url: imageUrl };
      if (quiet) body.cuts = cuts;
      else if (slideCount) body.slide_count = slideCount;
      const res = await fetch(`${apiBase()}/api/studio/split-carousel`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (seq !== _csSplitSeq) return;
      if (!res.ok || !data.ok) throw new Error(data.error || 'Split failed');
      if (data.split === false) {
        _csCarousel = null;
        _csOriginalPreviewUrl = imageUrl;
        _csQueueSingleUrl = imageUrl;
        if (!quiet) setBusy(false);
        else restorePreview();
        toast('Already square — queue as a single post', 'info');
        return;
      }
      const slides = Array.isArray(data.slides) ? data.slides : [];
      if (slides.length < 2) throw new Error('Split did not return enough slides');
      const selected = _csCarousel ? Math.min(_csCarousel.selected || 0, slides.length - 1) : 0;
      _csCarousel = {
        originalUrl: data.original_url || imageUrl,
        width: data.width,
        height: data.height,
        method: data.method || (quiet ? 'cuts' : 'even'),
        slides,
        selected,
        queueOrder: identityQueueOrder(slides.length),
      };
      _csOriginalPreviewUrl = _csCarousel.originalUrl;
      _csQueueSingleUrl = null;
      if (!quiet) setBusy(false);
      else renderCarouselPreview();
      if (_csCarousel.method === 'even' && !quiet && !slideCount) {
        toast('used even split — drag cuts if needed', 'info');
      } else if (!quiet) {
        toast('Carousel ready', 'success');
      }
    } catch (e) {
      if (seq !== _csSplitSeq) return;
      if (!quiet) setBusy(false);
      toast(e.message || 'Split failed', 'error');
    } finally {
      if (splitBtn && seq === _csSplitSeq) {
        splitBtn.textContent = 'Redesign as carousel';
        syncSplitButton();
      }
    }
  }

  function scheduleResplitFromCuts() {
    clearTimeout(_csCutTimer);
    _csCutTimer = setTimeout(() => {
      if (!hasCarousel() || isAssembledCarousel()) return;
      const cuts = _csCarousel.slides
        .slice()
        .sort((a, b) => (Number(a.y0) || 0) - (Number(b.y0) || 0))
        .map((s) => ({ y0: s.y0, y1: s.y1 }));
      splitCarousel({ cuts });
    }, 400);
  }

  function renderCarouselPreview() {
    if (!hasCarousel()) return;
    hidePreviewPanes();
    const wrap = document.getElementById('cs-carousel');
    if (wrap) wrap.style.display = 'block';
    const slides = _csCarousel.slides;
    const order = carouselQueueOrder();
    setPreviewHeader(`Preview · Carousel · ${order.length} slides · not queued yet`);
    if (_csCarousel.selected == null || _csCarousel.selected < 0 || _csCarousel.selected >= order.length) {
      _csCarousel.selected = 0;
    }
    const selectedSlide = slides[order[_csCarousel.selected]];
    const hero = document.getElementById('cs-slide-hero');
    if (hero) {
      if (isAssembledCarousel() && selectedSlide?.url) {
        hero.style.display = 'block';
        hero.innerHTML = `<img src="${escapeHtml(mediaSrc(selectedSlide.url))}" alt="Selected slide" referrerpolicy="no-referrer" style="width:100%;max-height:min(70vh,640px);object-fit:contain;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:#111;">`;
      } else {
        hero.style.display = 'none';
        hero.innerHTML = '';
      }
    }
    const strip = document.getElementById('cs-slide-strip');
    if (strip) {
      strip.innerHTML = order.map((slideIdx, i) => {
        const s = slides[slideIdx];
        if (!s) return '';
        const on = i === _csCarousel.selected;
        return `<button type="button" class="cs-slide-btn" data-i="${i}" style="flex:0 0 auto;width:88px;padding:0;border:${on ? '2px solid #A78BFA' : '1px solid rgba(255,255,255,0.12)'};border-radius:8px;background:#111;cursor:pointer;overflow:hidden;outline:none;">
          <img src="${escapeHtml(mediaSrc(s.url))}" alt="Slide ${i + 1}" referrerpolicy="no-referrer" style="width:88px;height:88px;object-fit:cover;display:block;">
        </button>`;
      }).join('');
      strip.querySelectorAll('.cs-slide-btn').forEach((el) => {
        el.addEventListener('click', () => {
          _csCarousel.selected = Number(el.getAttribute('data-i')) || 0;
          renderCarouselPreview();
        });
      });
    }
    const countWrap = document.getElementById('cs-slide-count-wrap');
    if (countWrap) countWrap.style.display = isAssembledCarousel() ? 'none' : 'flex';
    const countSel = document.getElementById('cs-slide-count');
    if (countSel && !isAssembledCarousel()) {
      const n = Math.min(8, Math.max(3, slides.length));
      countSel.value = String(n);
    }
    renderCutCanvas();
    refreshActionButtons();
  }

  function renderCutCanvas() {
    const canvas = document.getElementById('cs-cut-canvas');
    if (!canvas || !hasCarousel()) return;
    if (isAssembledCarousel()) {
      canvas.innerHTML = `<div style="font-size:0.68rem;color:rgba(255,255,255,0.35);line-height:1.5;">${_csCarousel.method === 'redesign' ? 'These slides were redesigned as complete 9:16 frames. Reorder, delete, or Redo selected. Ask Coach to change the plan.' : 'These slides were uploaded separately. Reorder with Move left/right, or delete a slide.'}</div>`;
      return;
    }
    const orig = _csCarousel.originalUrl;
    const slides = _csCarousel.slides;
    const lines = slides.slice(0, -1).map((s, i) => {
      const pct = Math.min(100, Math.max(0, (Number(s.y1) || 0) * 100));
      return `<div data-cut-line="${i}" style="position:absolute;left:0;right:0;top:${pct}%;height:0;border-top:2px solid rgba(167,139,250,0.9);pointer-events:none;">
        <span style="position:absolute;right:4px;top:-11px;font-size:0.58rem;font-weight:700;color:#E9D5FF;background:rgba(15,23,42,0.85);padding:1px 5px;border-radius:4px;">${Math.round(pct)}%</span>
      </div>`;
    }).join('');
    const sliders = slides.slice(0, -1).map((s, i) => {
      const pct = Math.min(100, Math.max(0, (Number(s.y1) || 0) * 100));
      const prev = i === 0 ? 1 : Math.min(99, Math.max(1, (Number(slides[i - 1].y1) || 0) * 100 + 1));
      const next = i >= slides.length - 2 ? 99 : Math.min(99, Math.max(1, (Number(slides[i + 1].y1) || 1) * 100 - 1));
      const min = Math.min(prev, pct);
      const max = Math.max(next, pct);
      return `<label style="display:flex;align-items:center;gap:10px;font-size:0.7rem;color:rgba(255,255,255,0.5);">
        Cut ${i + 1}
        <input type="range" class="cs-cut-range" data-i="${i}" min="${Math.round(min)}" max="${Math.round(max)}" value="${Math.round(pct)}" style="flex:1;accent-color:#A78BFA;">
        <span class="cs-cut-pct" data-i="${i}" style="width:36px;text-align:right;color:rgba(255,255,255,0.7);">${Math.round(pct)}%</span>
      </label>`;
    }).join('');
    canvas.innerHTML = `
      <div style="max-height:280px;overflow:auto;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:#111;">
        <div style="position:relative;">
          <img src="${escapeHtml(mediaSrc(orig))}" alt="Original cuts" referrerpolicy="no-referrer" style="width:100%;display:block;">
          ${lines}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">${sliders}</div>
      <div style="font-size:0.65rem;color:rgba(255,255,255,0.3);margin-top:6px;">Adjust cut handles (0–100%) to redraw slides. Updates debounce 400ms.</div>`;
    canvas.querySelectorAll('.cs-cut-range').forEach((input) => {
      input.addEventListener('input', (e) => {
        if (!hasCarousel()) return;
        const i = Number(e.target.getAttribute('data-i'));
        const pct = Number(e.target.value);
        const frac = pct / 100;
        _csCarousel.slides[i].y1 = frac;
        if (_csCarousel.slides[i + 1]) _csCarousel.slides[i + 1].y0 = frac;
        const line = canvas.querySelector(`[data-cut-line="${i}"]`);
        if (line) line.style.top = pct + '%';
        const label = canvas.querySelector(`.cs-cut-pct[data-i="${i}"]`);
        if (label) label.textContent = Math.round(pct) + '%';
        scheduleResplitFromCuts();
      });
    });
  }

  async function redoSelectedSlide() {
    if (!hasCarousel()) return;
    const pack = window.__SE_CAROUSEL_REDESIGN || {};
    const master = pack.master_image_url || _csCarousel.originalUrl;
    const order = carouselQueueOrder();
    const displayI = _csCarousel.selected || 0;
    const slideI = order[displayI];
    const current = _csCarousel.slides[slideI];
    const brief = (pack.slides || []).find((s) => Number(s.index) === displayI + 1)
      || { index: displayI + 1, title: current && current.title, role: 'other' };
    if (!/^https:\/\//i.test(master)) {
      toast('Need the stored master to redo a slide', 'warning');
      return;
    }
    setBusy(true, `Redoing slide ${displayI + 1}…`);
    try {
      const res = await fetch(`${apiBase()}/api/studio/carousel-redesign/slide`, {
        method: 'POST',
        headers: authHeaders(),
        signal: AbortSignal.timeout(180_000),
        body: JSON.stringify({
          master_image_url: master,
          session_id: pack.session_id || '',
          slide: brief,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Redo failed');
      _csCarousel.slides[slideI] = { ...current, url: data.url, title: brief.title || current.title };
      if (window.__SE_CAROUSEL_REDESIGN) {
        window.__SE_CAROUSEL_REDESIGN.session_id = data.session_id || pack.session_id;
        if (Array.isArray(window.__SE_CAROUSEL_REDESIGN.slides)) {
          window.__SE_CAROUSEL_REDESIGN.slides = window.__SE_CAROUSEL_REDESIGN.slides.map((s) => (
            Number(s.index) === displayI + 1 ? { ...s, url: data.url } : s
          ));
        }
      }
      renderCarouselPreview();
      toast('Slide updated', 'success');
    } catch (e) {
      toast(e.message || 'Redo failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  function deleteSelectedSlide() {
    if (!hasCarousel()) return;
    const displayI = _csCarousel.selected || 0;
    const order = carouselQueueOrder();
    const slideI = order[displayI];
    if (slideI == null) return;
    _csCarousel.slides.splice(slideI, 1);
    if (_csCarousel.slides.length < 2) {
      const surviving = _csCarousel.slides[0];
      const survivingUrl = surviving?.url || '';
      _csCarousel = null;
      _csHtml = '';
      _csSplitSeq += 1;
      if (survivingUrl) {
        _csQueueSingleUrl = survivingUrl;
        showOriginalPreview(survivingUrl);
      } else {
        restorePreview();
      }
      refreshActionButtons();
      toast('Carousel cleared — one slide left', 'info');
      return;
    }
    _csCarousel.queueOrder = order
      .filter((idx) => idx !== slideI)
      .map((idx) => (idx > slideI ? idx - 1 : idx));
    _csCarousel.selected = Math.min(displayI, _csCarousel.queueOrder.length - 1);
    renderCarouselPreview();
  }

  function moveSelectedSlide(dir) {
    if (!hasCarousel()) return;
    const order = carouselQueueOrder();
    const i = _csCarousel.selected || 0;
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
    _csCarousel.selected = j;
    renderCarouselPreview();
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
    setBusy(true, 'Generating… FigureLabs then 4K upscale');
    try {
      const payload = {
        brief,
        style_hint: document.getElementById('cs-style')?.value?.trim() || undefined,
        aspect_ratio: document.getElementById('cs-aspect')?.value || '9:16',
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
          return;
        }
        throw new Error(data.error || 'Generation failed');
      }
      if (data.brand?.name) {
        _csBrandName = data.brand.name;
        const pill = document.getElementById('cs-brand-pill');
        if (pill) pill.textContent = _csBrandName;
      }
      if (data.image_url) showGeneratedImage(data.image_url, data.spec);
      else if (data.html) showDesign(data.html, data.spec);
      else throw new Error('Generation failed');
      toast('Design ready', 'success');
    } catch (e) {
      toast(e.message || 'Generation failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  function sharedCoachStorageKey() {
    const email = window.__clientEmail || window.clientEmail || window._seEmail || '';
    return email ? 'se_chat_history_' + email : '';
  }

  function persistSharedCoach(role, text, extra) {
    const key = sharedCoachStorageKey();
    if (!key) return;
    let hist = [];
    try { hist = JSON.parse(localStorage.getItem(key) || '[]'); } catch { hist = []; }
    const make = typeof window.persistCoachHistoryEntry === 'function'
      ? window.persistCoachHistoryEntry
      : (r, t, e) => ({ role: r, text: t, time: (e && e.time) || '' });
    hist.push(make(role, text, extra || {}));
    if (hist.length > 50) hist = hist.slice(-50);
    try { localStorage.setItem(key, JSON.stringify(hist)); } catch {}
  }

  function appendDesignCoachBubble(role, text) {
    const log = document.getElementById('cs-coach-log');
    if (!log) return;
    const mine = role === 'user';
    const row = document.createElement('div');
    row.style.cssText = mine
      ? 'align-self:flex-end;max-width:92%;background:#7C3AED;color:#fff;border-radius:14px 14px 4px 14px;padding:8px 11px;font-size:0.78rem;line-height:1.55;'
      : 'align-self:flex-start;max-width:92%;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.86);border-radius:14px 14px 14px 4px;padding:8px 11px;font-size:0.78rem;line-height:1.55;';
    if (mine) {
      row.style.whiteSpace = 'pre-wrap';
      row.textContent = text;
    } else {
      const fmt = typeof window.formatCoachReplyHtml === 'function' ? window.formatCoachReplyHtml : null;
      if (fmt) row.innerHTML = fmt(text);
      else {
        row.style.whiteSpace = 'pre-wrap';
        row.textContent = text;
      }
    }
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return row;
  }

  function coachStyleHttpsUrls() {
    return _csCoachStyleUrls.filter((u) => /^https:\/\//i.test(u));
  }

  function alignCarouselPlanToStyleRefs(plan, styleUrls) {
    const n = Math.min(10, (Array.isArray(styleUrls) ? styleUrls : []).filter((u) => /^https:\/\//i.test(u)).length);
    if (!plan || !Array.isArray(plan.slides) || n < 4) return plan;
    if (plan.slides.length >= n) return plan;
    const slides = plan.slides.slice();
    while (slides.length < n) {
      const i = slides.length;
      slides.push({
        index: i + 1,
        role: 'other',
        title: `Slide ${i + 1}`,
        keep: 'Facts from the source infographic; layout trained from the format-set references.',
        do_not_invent: 'only facts visible on the source infographic; do not invent stats or claims',
        composition: 'complete 9:16 slide matching the attached format set; do not crop a strip from the poster',
      });
    }
    return { ...plan, slides: slides.map((s, i) => ({ ...s, index: i + 1 })) };
  }

  function renderCoachStyleChip() {
    const chip = document.getElementById('cs-coach-style-chip');
    if (!chip) return;
    if (!_csCoachStyleUrls.length) {
      chip.style.display = 'none';
      chip.innerHTML = '';
      return;
    }
    chip.style.display = 'flex';
    chip.innerHTML = _csCoachStyleUrls.map((url, i) => (
      `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.28);border-radius:8px;font-size:0.72rem;color:#E9D5FF;">`
      + `<img src="${escapeHtml(mediaSrc(url))}" alt="" referrerpolicy="no-referrer" style="width:28px;height:28px;border-radius:5px;object-fit:cover;background:#111;">`
      + `<span style="flex:1;">Style ${i + 1} — match this format</span>`
      + `<button type="button" data-style-clear="${i}" style="background:none;border:none;color:#E9D5FF;cursor:pointer;font-size:1.1em;line-height:1;">×</button>`
      + `</div>`
    )).join('');
    chip.querySelectorAll('[data-style-clear]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-style-clear'));
        if (!Number.isFinite(idx)) return;
        _csCoachStyleUrls.splice(idx, 1);
        renderCoachStyleChip();
      });
    });
  }

  function setDesignCoachApply(pending) {
    _csCoachPending = pending || null;
    const wrap = document.getElementById('cs-coach-apply-wrap');
    const btn = document.getElementById('cs-coach-apply');
    if (!wrap || !btn) return;
    if (!_csCoachPending || _csCoachPending.mode === 'none' || _csCoachPending.mode === 'refine' || _csCoachPending.mode === 'apply_carousel') {
      wrap.style.display = 'none';
      return;
    }
    btn.textContent = _csCoachPending.mode === 'confirm_carousel' ? 'Apply carousel plan' : 'Apply design';
    wrap.style.display = 'block';
  }

  function hydrateDesignCoachLog() {
    const log = document.getElementById('cs-coach-log');
    if (!log) return;
    log.innerHTML = '';
    const key = sharedCoachStorageKey();
    let hist = [];
    if (key) {
      try { hist = JSON.parse(localStorage.getItem(key) || '[]'); } catch { hist = []; }
    }
    hist.slice(-12).forEach((m) => {
      if (m && (m.role === 'user' || m.role === 'assistant' || m.role === 'ai') && m.text) {
        appendDesignCoachBubble(m.role === 'user' ? 'user' : 'assistant', String(m.text));
      }
      if (m && m.role !== 'user' && Array.isArray(m.actions)) {
        const plan = m.actions.find((a) => a && a.type === 'carousel_redesign' && Array.isArray(a.slides) && a.slides.length >= 2);
        if (plan) window.__SE_CAROUSEL_PLAN = plan;
      }
    });
    if (!log.childElementCount) {
      appendDesignCoachBubble('assistant', 'Stay here. Ask for a change and the preview updates in this window.');
    }
  }

  async function generateFromCoach(prompt) {
    const briefEl = document.getElementById('cs-brief');
    const next = String(prompt || '').trim();
    if (!next) return false;
    if (_csGenerating) return false;
    if (briefEl) {
      const current = briefEl.value.trim() || _csBrief;
      if (masterImageUrl() && current && next !== current) {
        briefEl.value = `${current} [MODIFICATION: ${next}]`;
      } else {
        briefEl.value = next;
      }
    }
    const before = _csGeneratedUrl;
    await generate();
    return Boolean(_csGeneratedUrl && _csGeneratedUrl !== before);
  }

  async function applyCarouselPlan(plan) {
    const canvasMaster = String(masterImageUrl() || window._seCoachAttachedImage || '').trim();
    const planMaster = String((plan && plan.master_image_url) || '').trim();
    const master = /^https:\/\//i.test(canvasMaster) ? canvasMaster : planMaster;
    const aligned = alignCarouselPlanToStyleRefs(plan, coachStyleHttpsUrls());
    const slides = aligned && Array.isArray(aligned.slides) ? aligned.slides : [];
    if (!/^https:\/\//i.test(master) || slides.length < 2) {
      toast('Need a stored master and a 2–10 slide plan', 'warning');
      return false;
    }
    const painted = [];
    let sessionId = '';
    setBusy(true, `Painting slide 1 of ${slides.length}…`);
    try {
      for (let i = 0; i < slides.length; i++) {
        setBusy(true, `Painting slide ${i + 1} of ${slides.length}…`);
        const res = await fetch(`${apiBase()}/api/studio/carousel-redesign/slide`, {
          method: 'POST',
          headers: authHeaders(),
          signal: AbortSignal.timeout(180_000),
          body: JSON.stringify({
            master_image_url: master,
            session_id: sessionId,
            slide: slides[i],
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) throw new Error(data.error || `Slide ${i + 1} generate failed`);
        sessionId = data.session_id || sessionId;
        painted.push({
          index: Number(data.index) || i + 1,
          url: data.url,
          title: data.title || slides[i].title || `Slide ${i + 1}`,
          session_id: sessionId,
        });
        window.__SE_CAROUSEL_REDESIGN = {
          ok: true,
          master_image_url: master,
          session_id: sessionId,
          slides: painted,
        };
        if (painted.length >= 2) applyRedesignedSlides();
      }
      toast('Carousel ready', 'success');
      return true;
    } catch (e) {
      toast(e.message || 'Carousel redesign failed', 'error');
      if (painted.length >= 2) applyRedesignedSlides();
      return painted.length >= 2;
    } finally {
      setBusy(false);
    }
  }

  async function applyPendingDesignCoach() {
    const pending = _csCoachPending;
    if (!pending) return;
    const btn = document.getElementById('cs-coach-apply');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Applying…';
    }
    try {
      if (pending.mode === 'confirm_carousel') {
        const ok = await applyCarouselPlan(pending.action || {});
        if (ok) setDesignCoachApply(null);
      } else if (pending.mode === 'confirm_generate') {
        await generateFromCoach(pending.prompt);
        setDesignCoachApply(null);
      }
    } finally {
      if (btn && _csCoachPending) {
        btn.disabled = false;
        btn.textContent = _csCoachPending.mode === 'confirm_carousel' ? 'Apply carousel plan' : 'Apply design';
      }
    }
  }

  async function designCoachAsk(preset) {
    const input = document.getElementById('cs-coach-input');
    const message = String(preset || input?.value || '').trim();
    if (!message || _csCoachSending) return;
    if (input && !preset) input.value = '';
    if (input && preset) input.value = '';
    _csCoachSending = true;
    const styleUrls = coachStyleHttpsUrls();
    if (_csCoachStyleUrls.length && !styleUrls.length) {
      toast('Style photos need a stored https URL — re-upload them', 'error');
    }
    const shown = styleUrls.length
      ? `${message}\n\n${styleUrls.length === 1 ? '1 style reference attached.' : `${styleUrls.length} style references attached.`}`
      : message;
    appendDesignCoachBubble('user', shown);
    persistSharedCoach('user', shown);
    const typing = document.createElement('div');
    typing.id = 'cs-coach-typing';
    typing.style.cssText = 'align-self:flex-start;color:rgba(255,255,255,0.4);font-size:0.72rem;';
    typing.textContent = 'Coach is looking…';
    document.getElementById('cs-coach-log')?.appendChild(typing);
    try {
      const attached = masterImageUrl() || window._seCoachAttachedImage || window.__SE_COACH_MASTER_IMAGE || '';
      const outbound = styleUrls.length >= 4
        ? `${message}\n\n${styleUrls.length} format-reference slides are attached. Train from their layout, color, and type. The plan must have exactly ${styleUrls.length} slides. Content comes from the source infographic.`
        : styleUrls.length === 1
          ? `${message}\n\nA house-style reference photo is attached. Match that carousel / graphic format.`
          : styleUrls.length > 1
            ? `${message}\n\n${styleUrls.length} house-style reference photos are attached. Combine their carousel / graphic format. Content comes from the source infographic.`
            : message;
      const res = await fetch(`${apiBase()}/api/chat/v2`, {
        method: 'POST',
        headers: authHeaders(),
        signal: AbortSignal.timeout(styleUrls.length >= 6 ? 120_000 : 90_000),
        body: JSON.stringify({
          message: outbound,
          attached_image_url: /^https:\/\//i.test(attached) ? attached : '',
          style_image_url: styleUrls[0] || '',
          style_image_urls: styleUrls,
          surface: 'design',
        }),
      });
      if (!res.ok) throw new Error('Coach error');
      const data = await res.json().catch(() => ({}));
      typing.remove();
      const reply = String(data.reply || 'Got it.');
      appendDesignCoachBubble('assistant', reply);
      persistSharedCoach('assistant', reply, { actions: data.coach_actions });
      const decide = typeof window.resolveDesignCoachApply === 'function'
        ? window.resolveDesignCoachApply
        : () => ({ mode: 'none' });
      const actions = Array.isArray(data.coach_actions) ? data.coach_actions : [];
      const fromActions = actions.find((a) => a && a.type === 'carousel_redesign' && Array.isArray(a.slides) && a.slides.length >= 2);
      if (fromActions) window.__SE_CAROUSEL_PLAN = fromActions;
      const decision = decide({
        reply,
        userMessage: message,
        hasCanvas: !!masterImageUrl(),
        actions,
        lastPlan: window.__SE_CAROUSEL_PLAN || null,
      });
      if (decision.action && decision.action.type === 'carousel_redesign') {
        window.__SE_CAROUSEL_PLAN = decision.action;
      }
      setDesignCoachApply(decision);
      _csCoachSending = false;
      if (decision.mode === 'apply_carousel') {
        const status = appendDesignCoachBubble('assistant', 'Generating the carousel…');
        const ok = await applyCarouselPlan(decision.action || {});
        if (status) status.textContent = ok ? 'Carousel ready.' : 'Could not generate the carousel.';
        if (ok) setDesignCoachApply(null);
      } else if (decision.mode === 'refine') {
        const status = appendDesignCoachBubble('assistant', 'Updating the preview…');
        const ok = await generateFromCoach(decision.prompt || message);
        if (status) status.textContent = ok ? 'Preview updated.' : 'Could not update the preview.';
      }
    } catch (e) {
      typing.remove();
      const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      appendDesignCoachBubble('assistant', timedOut
        ? 'Coach took too long looking at those photos. Try again — if it stalls, send fewer references.'
        : (e.message || 'Coach error — try again.'));
      setDesignCoachApply(null);
    } finally {
      _csCoachSending = false;
    }
  }

  // html2canvas (199 KB) is only needed for export, so it is loaded on first use
  // instead of on every portal visit.
  let _html2canvasPromise = null;
  function loadHtml2Canvas() {
    if (typeof html2canvas === 'function') return Promise.resolve();
    if (_html2canvasPromise) return _html2canvasPromise;
    _html2canvasPromise = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => { _html2canvasPromise = null; reject(new Error('Export library failed to load')); };
      document.head.appendChild(el);
    });
    return _html2canvasPromise;
  }

  async function rasterizePngBlob() {
    if (!_csHtml) throw new Error('No design to export');
    await loadHtml2Canvas();
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
    if (_csGenerating) return;
    if (hasCarousel()) {
      await exportCarousel(andQueue);
      return;
    }
    if (!_csHtml && _csGeneratedUrl) {
      if (andQueue) {
        await queueSingleImage(_csGeneratedUrl);
        return;
      }
      const a = document.createElement('a');
      a.href = mediaSrc(_csGeneratedUrl);
      a.download = `design-${Date.now()}.png`;
      a.target = '_blank';
      a.rel = 'noopener';
      a.click();
      toast('PNG opened', 'success');
      return;
    }
    if (!_csHtml && _csQueueSingleUrl && andQueue) {
      await queueSingleImage(_csQueueSingleUrl);
      return;
    }
    if (!_csHtml) return;
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

      const captionText = readQueueCaption();
      _csBrief = document.getElementById('cs-brief')?.value?.trim() || _csBrief;

      const q = await fetch(`${apiBase()}/api/studio/design-queue`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          image_url: upData.url,
          brief: _csBrief,
          caption: captionText || _csBrief,
          platform: queuePlatform(),
          status: queueReady().queueReviewStatus(),
        }),
      });
      const qData = await q.json().catch(() => ({}));
      if (!q.ok || !(qData.ok || qData.success)) throw new Error(qData.error || 'Queue failed');
      afterQueued();
      if (btn) btn.textContent = 'Added ✓';
      setTimeout(() => { if (btn) btn.textContent = prev || 'Add to Queue'; }, 1600);
    } catch (e) {
      toast(e.message || 'Export failed', 'error');
    } finally {
      if (btn && btn.textContent.includes('…')) btn.textContent = prev || (andQueue ? 'Add to Queue' : 'Export PNG');
      refreshActionButtons();
    }
  }

  async function queueSingleImage(imageUrl) {
    const btn = document.getElementById('cs-queue');
    const prev = btn?.textContent;
    if (btn) { btn.textContent = 'Queuing…'; btn.disabled = true; }
    try {
      _csBrief = document.getElementById('cs-brief')?.value?.trim() || _csBrief;
      const caption = readQueueCaption();
      if (!caption) {
        toast('Paste the caption (or write it in Describe your post)', 'warning');
        return;
      }
      const q = await fetch(`${apiBase()}/api/studio/design-queue`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          image_url: imageUrl,
          brief: _csBrief,
          caption,
          platform: queuePlatform(),
          status: queueReady().queueReviewStatus(),
        }),
      });
      const qData = await q.json().catch(() => ({}));
      if (!q.ok || !(qData.ok || qData.success)) throw new Error(qData.error || 'Queue failed');
      afterQueued();
      if (btn) btn.textContent = 'Added ✓';
      setTimeout(() => { if (btn) btn.textContent = prev || 'Add to Queue'; }, 1600);
    } catch (e) {
      toast(e.message || 'Queue failed', 'error');
    } finally {
      if (btn && String(btn.textContent).includes('…')) btn.textContent = prev || 'Add to Queue';
      refreshActionButtons();
    }
  }

  async function exportCarousel(andQueue) {
    const slides = slidesInQueueOrder();
    const imageUrls = slides.map((s) => s.url).filter(Boolean);
    if (imageUrls.length < 2) return;
    const btn = document.getElementById(andQueue ? 'cs-queue' : 'cs-export');
    const prev = btn?.textContent;
    if (btn) { btn.textContent = andQueue ? 'Queuing…' : 'Exporting…'; btn.disabled = true; }
    try {
      if (!andQueue) {
        const res = await fetch(`${apiBase()}/api/studio/carousel-zip`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ image_urls: imageUrls }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'ZIP export failed');
        }
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'carousel-slides.zip';
        a.click();
        URL.revokeObjectURL(a.href);
        toast('ZIP downloaded', 'success');
        return;
      }

      _csBrief = document.getElementById('cs-brief')?.value?.trim() || _csBrief;
      const captionText = readQueueCaption();
      const q = await fetch(`${apiBase()}/api/studio/design-queue`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          image_urls: imageUrls,
          brief: _csBrief,
          caption: captionText || _csBrief,
          platform: queuePlatform(),
          status: queueReady().queueReviewStatus(),
        }),
      });
      const qData = await q.json().catch(() => ({}));
      if (!q.ok || !(qData.ok || qData.success)) throw new Error(qData.error || 'Queue failed');
      afterQueued();
      if (btn) btn.textContent = 'Added ✓';
      setTimeout(() => { if (btn) btn.textContent = prev || 'Add to Queue'; }, 1600);
    } catch (e) {
      toast(e.message || 'Export failed', 'error');
    } finally {
      if (btn && String(btn.textContent).includes('…')) btn.textContent = prev || (andQueue ? 'Add to Queue' : 'Export ZIP');
      refreshActionButtons();
    }
  }

  async function getCaption() {
    const box = document.getElementById('cs-caption-box');
    const btn = document.getElementById('cs-caption');
    _csBrief = document.getElementById('cs-brief')?.value?.trim() || _csBrief;
    if (!_csBrief) {
      toast('Describe your post first', 'warning');
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Writing…'; }
    if (box && 'value' in box) box.value = 'Writing caption…';
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
        if ('value' in box) box.value = caption;
      }
    } catch (e) {
      toast(e.message || 'Caption failed', 'error');
      if (box && 'value' in box && box.value === 'Writing caption…') box.value = '';
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Get Caption'; btn.style.cursor = 'pointer'; btn.style.color = 'rgba(255,255,255,0.75)'; }
    }
  }

  window.renderClaudeStudio = renderClaudeStudio;
  window.applyRedesignedSlides = applyRedesignedSlides;
  window.designCoachAsk = designCoachAsk;
  window.openClaudeDesignStudio = function openClaudeDesignStudio() {
    window.__SE_CREATE_SURFACE = 'design';
    try {
      const url = window.vsUploadedImageUrl || window._vsUploadedImageUrl;
      if (url && (!window._studioReference || !window._studioReference.url)) {
        window._studioReference = { url, type: 'image', title: 'Studio upload', source: 'upload' };
      }
    } catch (_) {}
    renderClaudeStudio();
  };
})();
