'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Brand library can upload stills, multi-select, generate, and review drafts', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  assert.match(src, /brand-lib-collection/);
  assert.match(src, /value="scene"/);
  assert.match(src, /value="character"/);
  assert.match(src, /value="plate"/);
  assert.match(src, /data-asset-select/);
  assert.match(src, /\/api\/assets\/generate/);
  assert.match(src, /Add to library/);
  assert.match(src, /Use now/i);
  assert.match(src, /drafts\/reject/);
  assert.match(src, /brand-lib-filter/);
});

test('Animate applies Coach outro and collection stills without auto-Send', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'animation-studio.js'), 'utf8');
  const start = src.indexOf('async function applyAnimCoachCreateSessionIfAny');
  const end = src.indexOf('window.applyAnimCoachCreateSessionIfAny');
  const apply = src.slice(start, end);
  assert.match(apply, /outro_url/);
  assert.match(apply, /ref_image_urls/);
  assert.match(apply, /music_bed_url/);
  assert.doesNotMatch(apply, /sendPrompt\(/);
});
