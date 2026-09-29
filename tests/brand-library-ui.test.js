'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Library page can upload stills, harvest, generate views, and review drafts', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  assert.match(src, /data-nav="library"/);
  assert.match(src, /brand-lib-collection/);
  assert.match(src, /value="scene"/);
  assert.match(src, /value="character"/);
  assert.match(src, /value="item"/);
  assert.match(src, /value="setting"/);
  assert.match(src, /value="plate"/);
  assert.match(src, /data-asset-select/);
  assert.match(src, /\/api\/assets\/generate/);
  assert.match(src, /\/api\/assets\/harvest/);
  assert.match(src, /generate-views/);
  assert.match(src, /more-like-this/);
  assert.match(src, /Add to library/);
  assert.match(src, /Use now/i);
  assert.match(src, /Save to Library/);
  assert.match(src, /drafts\/reject/);
  assert.match(src, /brand-lib-filter/);
  assert.match(src, /chat-attach-library/);
  assert.match(src, /id="brand-lib-file" multiple/);
  assert.match(src, /data-asset-kind/);
  assert.match(src, /retagKinds/);
  assert.match(src, /background-color: #1E293B/);
  assert.match(src, /color-scheme: dark/);
  assert.match(src, /const files = \[\.\.\.\(e\.target\.files/);
});

test('Animate applies Coach library refs without auto-Send', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'animation-studio.js'), 'utf8');
  const start = src.indexOf('async function applyAnimCoachCreateSessionIfAny');
  const end = src.indexOf('window.applyAnimCoachCreateSessionIfAny');
  const apply = src.slice(start, end);
  assert.match(apply, /outro_url/);
  assert.match(apply, /ref_image_urls/);
  assert.match(apply, /result\.references/);
  assert.match(apply, /music_bed_url/);
  assert.doesNotMatch(apply, /sendPrompt\(/);
  assert.match(src, /id="anim-ref-library"/);
  assert.match(src, /openLibraryPicker/);
  assert.match(src, /id: 'item', label: 'Item'/);
  assert.match(src, /id: 'setting', label: 'Setting'/);
});

test('Claude Design picker tab is Past posts, not Library', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  assert.match(src, />Past posts</);
  assert.doesNotMatch(src, /id="cs-tab-library"[^>]*>Library</);
});
