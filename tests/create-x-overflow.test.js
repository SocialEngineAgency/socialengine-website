'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const portal = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');

function createSegmentsCss() {
  const start = portal.indexOf('/* ── CREATE mode strip');
  assert.ok(start >= 0, 'missing CREATE mode strip CSS');
  const end = portal.indexOf('/* ── SETTINGS tabs', start);
  assert.ok(end > start, 'missing SETTINGS tabs after create-segments');
  return portal.slice(start, end);
}

test('create-segments does not combine width 100% with horizontal margin (x-scroll)', () => {
  const css = createSegmentsCss();
  // Horizontal inset must be padding (inside the box), not margin on a 100%-wide block.
  assert.match(css, /\.create-segments\s*\{[^}]*padding:\s*0\s+20px/s);
  assert.doesNotMatch(css, /\.create-segments\s*\{[^}]*margin:\s*10px\s+32px\s+0/s);
  assert.match(css, /box-sizing:\s*border-box/);
  assert.match(portal, /\.dash-main--create/);
});

test('dashboard main clips horizontal overflow', () => {
  assert.match(portal, /\.dash-main\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(portal, /\.dashboard\.active\s*\{[^}]*min-width:\s*0/s);
});
