'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');

test('style refs render as a compact thumbnail strip, not full-width rows', () => {
  const fn = src.slice(src.indexOf('function renderCoachStyleChip'), src.indexOf('function setDesignCoachApply'));
  assert.match(fn, /Style refs \(\$\{n\}\)/);
  assert.match(fn, /maxHeight = '76px'/);
  assert.match(fn, /data-style-clear-all/);
  assert.doesNotMatch(fn, /Style \$\{i \+ 1\} — match this format<\/span>/);
});

test('Coach chat injects style images once per attach, not every turn', () => {
  assert.match(src, /_csCoachStylesSentToChat/);
  assert.match(src, /function coachStylesPendingForChat/);
  assert.match(src, /markCoachStylesSent\(styleUrls\)/);
  const ask = src.slice(src.indexOf('async function designCoachAsk'), src.indexOf('window.designCoachAsk'));
  assert.match(ask, /coachStylesPendingForChat\(\)/);
  assert.match(ask, /style_image_urls: styleUrls/);
});

test('Stage keeps poster history and a Restore previous control', () => {
  assert.match(src, /function pushPosterHistory/);
  assert.match(src, /function restorePreviousPoster/);
  assert.match(src, /id="cs-restore-prev"/);
  assert.match(src, /cs-restore-prev.*addEventListener/);
  assert.match(src, /se-design-history:/);
});
