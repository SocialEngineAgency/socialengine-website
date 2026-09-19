'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isAssetKind, kindLabel, acceptFor } = require('../portal-assets');

test('portal-assets knows a saved shot', () => {
  assert.equal(isAssetKind('shot'), true);
  assert.equal(kindLabel('shot'), 'Shot');
  assert.match(acceptFor('shot'), /video|image/);
});

test('Saved shots stay off the pre-approve ghost timeline', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'animation-studio.js'), 'utf8');
  const start = src.indexOf('function savedShotsAllowed');
  assert.ok(start > 0);
  const fn = src.slice(start, start + 400);
  assert.match(fn, /character_review/);
  assert.match(fn, /briefing/);
});

test('Animate can save a shot and add it to another video without auto-Send', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'animation-studio.js'), 'utf8');
  assert.match(src, /anim-shot-save/);
  assert.match(src, /anim-saved-shots/);
  assert.match(src, /scenes\/from-saved/);
  const saveStart = src.indexOf('async function saveScene');
  assert.ok(saveStart > 0);
  const saveFn = src.slice(saveStart, saveStart + 900);
  assert.match(saveFn, /\/save/);
  assert.doesNotMatch(saveFn, /sendPrompt\(/);
  const addStart = src.indexOf('async function addSavedShot');
  assert.ok(addStart > 0);
  const addFn = src.slice(addStart, addStart + 900);
  assert.match(addFn, /from-saved/);
  assert.doesNotMatch(addFn, /sendPrompt\(/);
});
