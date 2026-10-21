'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');

// Pull submitCancellationRequest out of portal.html by matching braces.
function extractFunction(name) {
  const start = src.indexOf(`async function ${name}(`);
  assert.ok(start > -1, `${name} missing from portal.html`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

function run({ response, reasonText = '', throws = false }) {
  const calls = [];
  const toasts = [];
  const els = {
    'cancellation-confirm': { disabled: false, textContent: 'Confirm' },
    'cancellation-reason': { value: reasonText },
    'cancellation-modal': { style: { display: 'flex' } },
  };
  const sandbox = {
    document: { getElementById: (id) => els[id] || null },
    apiFetch: async (url, init) => {
      calls.push({ url, init });
      if (throws) throw new Error('offline');
      return response;
    },
    showToast: (msg, type) => toasts.push({ msg, type }),
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction('submitCancellationRequest') + ';this.fn = submitCancellationRequest;', sandbox);
  return { call: () => sandbox.fn(), calls, toasts, els };
}

const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('confirm calls POST /api/cancel-request with the optional reason and reports success', async () => {
  const t = run({ response: ok({ ok: true }), reasonText: '  Too busy right now  ' });
  await t.call();
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].url, '/api/cancel-request');
  assert.equal(t.calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(t.calls[0].init.body), { reason: 'Too busy right now' });
  assert.equal(t.els['cancellation-modal'].style.display, 'none');
  assert.equal(t.toasts[0].type, 'success');
  assert.equal(t.toasts[0].msg, 'Cancellation request sent. Your plan stays active until the end of the billing period. We will confirm by email.');
});

test('an empty reason is left out of the body', async () => {
  const t = run({ response: ok({ ok: true }) });
  await t.call();
  assert.deepEqual(JSON.parse(t.calls[0].init.body), {});
});

test('an API error shows its message, points to support, and keeps the modal open', async () => {
  const t = run({ response: ok({ error: 'No active subscription found' }, 404) });
  await t.call();
  assert.equal(t.els['cancellation-modal'].style.display, 'flex');
  assert.equal(t.toasts.length, 1);
  assert.equal(t.toasts[0].type, 'error');
  assert.match(t.toasts[0].msg, /No active subscription found/);
  assert.match(t.toasts[0].msg, /support@socialengine\.agency/);
  assert.equal(t.els['cancellation-confirm'].disabled, false);
});

test('a network failure is an error toast, never a success', async () => {
  const t = run({ throws: true });
  await t.call();
  assert.equal(t.toasts[0].type, 'error');
  assert.match(t.toasts[0].msg, /support@socialengine\.agency/);
});

test('a 200 without { ok: true } is not reported as sent', async () => {
  const t = run({ response: ok({}) });
  await t.call();
  assert.equal(t.toasts[0].type, 'error');
});

test('the modal confirm button is wired to the API call and promises nothing the API does not do', () => {
  assert.match(src, /id="cancellation-confirm" onclick="submitCancellationRequest\(\)"/);
  assert.doesNotMatch(src, /We\\u2019ll be in touch within 24 hours/);
  assert.doesNotMatch(src, /A team member will reach out within 24 hours/);
});
