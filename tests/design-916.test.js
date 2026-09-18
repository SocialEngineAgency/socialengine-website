'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Design Studio generate is 9:16, no Learn more, and can preview a PNG', () => {
  const design = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  assert.match(design, /aspect_ratio: document\.getElementById\('cs-aspect'\)/);
  assert.match(design, /value="9:16" selected/);
  assert.match(design, /function showGeneratedImage/);
  assert.match(design, /data\.image_url/);
  assert.match(design, /Preview · 9:16/);
  assert.doesNotMatch(design, /Instagram Square 1:1/);
  assert.doesNotMatch(design, /Learn more/);
});

test('Coach design sessions default to 9:16', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'coach-create-session.js'), 'utf8');
  assert.doesNotMatch(src, /destination === 'design' \? '1:1'/);
});
