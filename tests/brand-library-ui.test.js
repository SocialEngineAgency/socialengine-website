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
  assert.match(src, /value="style"/);
  assert.match(src, /value="plate"/);
  assert.match(src, /data-asset-select/);
  assert.match(src, /\/api\/assets\/generate/);
  assert.match(src, /\/api\/assets\/harvest/);
  assert.match(src, /generate-views/);
  assert.match(src, /Make Multiview/);
  assert.match(src, /brand-lib-sheet/);
  assert.match(src, /brand-lib-progress/);
  assert.match(src, /4-angle sheet/);
  assert.match(src, /JSON\.stringify\(\{ label \}\)/);
  assert.match(src, /data-asset-views-of/);
  assert.match(src, /showFigureLabsGenerate/);
  assert.match(src, /FigureLabs diagrams only/);
  assert.doesNotMatch(src, /Fashion accounts without FigureLabs/);
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
  assert.match(src, /brand-lib-thumb/);
  assert.match(src, /data-asset-expand/);
  assert.match(src, /data-asset-expand-panel/);
  assert.match(src, /brand-lib-import-past/);
  assert.match(src, /Add selected as Style/);
  assert.match(src, /\/api\/studio\/media-library/);
  assert.match(src, /kind: 'style'/);
  assert.match(src, /const still = isStillKind[\s\S]*const unlabeled = still/);
  assert.match(src, /Label unlabeled/);
  assert.match(src, /Label with AI/);
  assert.match(src, /\/api\/assets\/analyze-missing/);
  assert.match(src, /\/analyze/);
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
  assert.match(src, /'style'/);
});

test('Library style stills map to the style ref role', () => {
  const { roleForKind, libraryOffer, STILL_KINDS } = require('../portal-assets.js');
  assert.equal(roleForKind('style'), 'style');
  assert.equal(roleForKind('logo'), 'style');
  assert.ok(STILL_KINDS.includes('style'));
  const offer = libraryOffer([{ id: 'ast_look', kind: 'style', name: 'April reel', url: 'https://store.test/april.png' }]);
  assert.match(offer.question, /April reel/);
});

test('Claude Design picker tab is Past posts, not Library', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  assert.match(src, />Past posts</);
  assert.doesNotMatch(src, /id="cs-tab-library"[^>]*>Library</);
});
