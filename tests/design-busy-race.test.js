'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('apply_generate does not setBusy before generateFromCoach (Stage stuck race)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  const applyIdx = src.indexOf("decision.mode === 'apply_generate'");
  assert.ok(applyIdx > 0, 'apply_generate branch present');
  const refineIdx = src.indexOf("decision.mode === 'refine'");
  assert.ok(refineIdx > applyIdx, 'refine follows apply_generate');
  const applyBlock = src.slice(applyIdx, refineIdx);
  assert.doesNotMatch(
    applyBlock,
    /setBusy\(true[\s\S]{0,120}generateFromCoach/,
    'must not setBusy(true) immediately before generateFromCoach'
  );
  assert.match(applyBlock, /ok === 'busy'/);
  assert.match(applyBlock, /ok !== 'busy'/);
});

test('generateFromCoach returns busy sentinel when Stage already generating', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function generateFromCoach'), src.indexOf('async function saveOpenTemplate'));
  assert.match(fn, /return 'busy'/);
  assert.match(fn, /if \(_csGenerating\)/);
});
