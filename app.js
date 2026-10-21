/* ============================================
   SocialEngine homepage script
   Mounts the chrome mark, runs the free-audit form, shows errors as toasts.
   ============================================ */

const API_BASE = 'https://socialengine-api-production-18e0.up.railway.app';

function generateIdempotencyToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

(function () {
  'use strict';

  // --- Chrome mark (home-mark.js) ---
  // The mark is a WebGL canvas. If WebGL is missing the static SVG mark is shown instead.
  let mark = null;
  const markCanvas = document.getElementById('mark-canvas');
  if (markCanvas && typeof window.SEMountMark === 'function') {
    try {
      mark = window.SEMountMark(markCanvas, { look: 'Chrome + SE', zoom: 1.05, liquid: 0.45, speed: 0.4 });
    } catch (e) {
      console.error('Mark failed to start', e);
      mark = null;
    }
    if (mark) {
      markCanvas.addEventListener('pointerdown', (e) => mark.down(e));
      markCanvas.addEventListener('pointermove', (e) => mark.move(e));
      markCanvas.addEventListener('pointerup', (e) => mark.up(e));
      markCanvas.addEventListener('pointercancel', (e) => mark.up(e));
      markCanvas.addEventListener('pointerleave', () => {
        if (!mark._st.dragging) { mark._st.tlx = -0.55; mark._st.tly = 0.55; mark.set({}); }
      });
    } else {
      markCanvas.hidden = true;
      const fallback = document.getElementById('mark-fallback');
      if (fallback) fallback.hidden = false;
      const hint = document.getElementById('mark-hint');
      if (hint) hint.hidden = true;
    }
  }
  // The hero button sends a ripple through the mark.
  document.querySelectorAll('[data-pulse]').forEach((el) => {
    el.addEventListener('click', () => { if (mark) mark.pulse(1.4); });
  });

  function validateURL(str) {
    try {
      const url = new URL(str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      try {
        const url = new URL('https://' + str);
        return url.hostname.includes('.');
      } catch { return false; }
    }
  }

  function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function normalizeURL(str) {
    try { new URL(str); return str; }
    catch { return 'https://' + str; }
  }

  const DEFAULT_ERROR_TOAST = 'Something went wrong. Please try again.';
  let toastContainer = null;

  class SafeWriteError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = 'SafeWriteError';
      this.code = options.code || 'WRITE_FAILED';
      this.status = typeof options.status === 'number' ? options.status : null;
      this.payload = options.payload || null;
      this.userMessage = options.userMessage || message || DEFAULT_ERROR_TOAST;
      if (options.cause) this.cause = options.cause;
    }
  }

  function getPayloadErrorMessage(payload) {
    if (!payload || typeof payload !== 'object') return '';
    const candidates = [
      payload.error,
      payload.message,
      payload.detail,
      payload.data && payload.data.error,
      payload.data && payload.data.message,
    ];

    const match = candidates.find((value) => typeof value === 'string' && value.trim());
    return match ? match.trim() : '';
  }

  function getUserFacingErrorMessage(error, fallbackMessage = DEFAULT_ERROR_TOAST) {
    if (error instanceof SafeWriteError && error.userMessage) return error.userMessage;
    if (error && typeof error.userMessage === 'string' && error.userMessage.trim()) return error.userMessage.trim();
    return fallbackMessage;
  }

  function getToastContainer() {
    if (toastContainer && !toastContainer.removed) return toastContainer;
    if (!document.body) return null;

    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
    return toastContainer;
  }

  function showToast(message, type = 'error') {
    if (!message) return;
    const container = getToastContainer();
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast--hiding');
      setTimeout(() => {
        if (typeof toast.remove === 'function') toast.remove();
      }, 220);
    }, 4200);
  }

  async function safeWrite(url, body, options = {}) {
    const method = (options.method || 'POST').toUpperCase();
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    const requestOptions = {
      method,
      headers,
    };

    if (body !== undefined) {
      requestOptions.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(url, requestOptions);
    } catch (error) {
      throw new SafeWriteError('Network request failed', {
        code: 'NETWORK_ERROR',
        cause: error,
        userMessage: 'We could not reach the server. Please check your connection and try again.',
      });
    }

    let payload = null;
    try {
      if (response.status === 204) {
        payload = { success: true, data: null };
      } else {
        payload = await response.json();
      }
    } catch (error) {
      throw new SafeWriteError('Response was not valid JSON', {
        code: 'INVALID_JSON',
        status: typeof response.status === 'number' ? response.status : null,
        cause: error,
        userMessage: 'The server returned an unexpected response. Please try again.',
      });
    }

    const payloadMessage = getPayloadErrorMessage(payload);
    if (!response.ok) {
      throw new SafeWriteError(payloadMessage || `Request failed with status ${response.status}`, {
        code: 'HTTP_ERROR',
        status: typeof response.status === 'number' ? response.status : null,
        payload,
        userMessage: payloadMessage || 'We could not save your request right now. Please try again.',
      });
    }

    const acknowledged = payload && typeof payload === 'object'
      && (payload.success === true || payload.data !== undefined);

    if (!acknowledged) {
      throw new SafeWriteError('Unexpected response from server', {
        code: 'INVALID_RESPONSE',
        status: typeof response.status === 'number' ? response.status : null,
        payload,
        userMessage: 'The server returned an unexpected response. Please try again.',
      });
    }

    return payload;
  }

  function handleGlobalError(error, context, details = {}) {
    console.error(context, error, details);
    showToast(getUserFacingErrorMessage(error), 'error');
  }

  window.onerror = function onWindowError(message, source, lineno, colno, error) {
    handleGlobalError(error || new Error(typeof message === 'string' ? message : DEFAULT_ERROR_TOAST), 'Unhandled application error', {
      message,
      source,
      lineno,
      colno,
    });
    return false;
  };

  window.onunhandledrejection = function onUnhandledRejection(event) {
    handleGlobalError(event.reason, 'Unhandled promise rejection');
  };

  // ====================================================
  //  FREE AUDIT FORM
  //  POST /api/audit, then hand the result to /audit.html.
  //    - report in the response: stash it for an instant render and go
  //    - pending: the audit keeps running; /audit.html polls for it
  // ====================================================
  const REPORT_ID_RE = /^[A-Za-z0-9_-]{6,128}$/;

  // Decide where an /api/audit response sends the visitor.
  // Returns { kind: 'report', id, report } | { kind: 'pending', id } | { kind: 'emailed' } | { kind: 'incomplete' }.
  function routeAuditResponse(data) {
    const id = data && typeof data.report_id === 'string' && REPORT_ID_RE.test(data.report_id) ? data.report_id : '';
    if (data && data.pending === true && id) return { kind: 'pending', id };
    if (id && data.report && typeof data.report === 'object') return { kind: 'report', id, report: data.report };
    // An API without report support still emails the audit.
    if (data && data.audit && !data.report) return { kind: 'emailed' };
    return { kind: 'incomplete' };
  }

  function auditPageUrl(id) {
    return '/audit.html?id=' + encodeURIComponent(id);
  }

  const auditForm = document.getElementById('audit-form');
  const auditSubmit = document.getElementById('audit-submit');
  const auditError = document.getElementById('audit-error');

  function showAuditMessage(message, invalidIds) {
    if (auditError) {
      auditError.textContent = message;
      auditError.hidden = false;
    }
    ['audit-url', 'audit-email'].forEach((id) => {
      const input = document.getElementById(id);
      if (input && input.setAttribute) input.setAttribute('aria-invalid', (invalidIds || []).includes(id) ? 'true' : 'false');
    });
  }

  function clearAuditMessage() {
    if (auditError) { auditError.textContent = ''; auditError.hidden = true; }
    ['audit-url', 'audit-email'].forEach((id) => {
      const input = document.getElementById(id);
      if (input && input.setAttribute) input.setAttribute('aria-invalid', 'false');
    });
  }

  function setSubmitBusy(busy) {
    if (!auditSubmit) return;
    const label = auditSubmit.querySelector('.ai-audit__submit-text');
    auditSubmit.disabled = busy;
    if (auditSubmit.setAttribute) auditSubmit.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (label) label.textContent = busy ? 'Working on it' : 'Get my audit';
  }

  if (auditForm) {
    const urlInput = document.getElementById('audit-url');
    const emailInput = document.getElementById('audit-email');
    let auditSubmitting = false;

    auditForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (auditSubmitting) return;

      const url = urlInput.value.trim();
      const email = emailInput.value.trim();

      clearAuditMessage();
      if (!url) { showAuditMessage('Please enter your website link.', ['audit-url']); return; }
      if (!validateURL(url)) { showAuditMessage('Enter a valid website link, for example yourwebsite.com.', ['audit-url']); return; }
      if (!email) { showAuditMessage('Please enter your email.', ['audit-email']); return; }
      if (!validateEmail(email)) { showAuditMessage('Enter a valid email address.', ['audit-email']); return; }

      auditSubmitting = true;
      setSubmitBusy(true);

      try {
        // Same request the API has always taken. Optional fields stay in the body, empty.
        const data = await safeWrite(`${API_BASE}/api/audit`, {
          website: normalizeURL(url),
          email,
          name: '',
          instagram_handle: '',
          tiktok_handle: '',
          facebook_handle: '',
          idempotency_token: generateIdempotencyToken(),
        });

        const route = routeAuditResponse(data);
        if (route.kind === 'report') {
          try { sessionStorage.setItem('se_audit_' + route.id, JSON.stringify(route.report)); } catch (_) { /* private mode: the page fetches it */ }
          window.location.assign(auditPageUrl(route.id));
          return; // leave the button busy while the browser navigates
        }
        if (route.kind === 'pending') {
          window.location.assign(auditPageUrl(route.id));
          return;
        }
        if (route.kind === 'emailed') {
          showAuditMessage('Your audit is on its way to your inbox.', []);
          setSubmitBusy(false);
          return;
        }
        throw new SafeWriteError('Audit payload was incomplete', {
          code: 'MISSING_AUDIT',
          payload: data,
          userMessage: 'Your audit completed with an incomplete response. Please try again.',
        });
      } catch (err) {
        console.error('Audit error:', err);
        const message = getUserFacingErrorMessage(err);
        showToast(message, 'error');
        showAuditMessage(message, []);
        setSubmitBusy(false);
      } finally {
        auditSubmitting = false;
      }
    });

    if (urlInput) urlInput.addEventListener('input', clearAuditMessage);
    if (emailInput) emailInput.addEventListener('input', clearAuditMessage);
  }

  if (window.__SOCIALENGINE_ENABLE_TEST_HOOKS__) {
    window.__SOCIALENGINE_TEST_HOOKS__ = {
      SafeWriteError,
      safeWrite,
      getUserFacingErrorMessage,
      showToast,
      routeAuditResponse,
      auditPageUrl,
    };
  }

})();
