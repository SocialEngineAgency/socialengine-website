'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Animate shot cards can delete a scene without auto-Send', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'animation-studio.js'), 'utf8');
  assert.match(src, /anim-shot-delete/);
  const start = src.indexOf('async function deleteScene');
  assert.ok(start > 0, 'deleteScene helper missing');
  const end = src.indexOf('\n  async function ', start + 10);
  const fn = src.slice(start, end > start ? end : start + 1200);
  assert.match(fn, /method:\s*'DELETE'/);
  assert.match(fn, /confirm\(/);
  assert.doesNotMatch(fn, /sendPrompt\(/);
});
