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
  assert.match(src, /Remake sheet/);
  assert.match(src, /Making sheet/);
  assert.match(src, /brand-lib-sheet/);
  assert.match(src, /brand-lib-progress/);
  assert.match(src, /turnaround sheet/i);
  assert.match(src, /body:\s*'\{\}'/);
  assert.doesNotMatch(src, /JSON\.stringify\(\{ label \}\)/);
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
  assert.match(src, /id="se-lib-picker-grid" class="se-pick-grid"/);
  assert.match(src, /\.se-pick-grid \{[\s\S]*grid-auto-rows:\s*max-content/);
  assert.match(src, /\.se-pick-im img \{[\s\S]*object-fit:\s*cover/);
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
  assert.match(src, /id="cs-library-grid" class="se-pick-grid"/);
  assert.match(src, /class="cs-lib-card se-pick-tile"/);
  assert.doesNotMatch(src, /id="cs-tab-library"[^>]*>Library</);
});

test('Library offer says what will really be attached, and is short however big the Library is', () => {
  const { libraryOffer } = require('../portal-assets.js');
  const lib = Array.from({ length: 41 }, (_, i) => ({ id: `a${i}`, kind: 'character', name: `Character number ${i}`, url: `https://store.test/${i}.png`, views: i % 2 ? [{ url: `https://store.test/${i}-b.png`, label: 'back' }] : [] }));
  const offer = libraryOffer(lib);
  assert.match(offer.question, /^Use 8 pictures from your Library as references \(/);
  assert.match(offer.question, /You have 41 in all/);
  assert.doesNotMatch(offer.question, /Character number 40/, 'names beyond what is attached are not listed');
  assert.ok(offer.question.length < 220, `short enough to read (${offer.question.length})`);
  assert.equal(offer.images, 8);
  assert.equal(offer.asset_ids.length, 41, 'the ids passed on are unchanged');
  assert.match(libraryOffer([lib[0]]).question, /^Use 1 picture from your Library as a reference \(Character number 0\)\?$/);
  assert.equal(libraryOffer([{ id: 'x', kind: 'logo', name: 'Logo', url: 'https://store.test/l.png' }]), null, 'a logo is not offered as a reference');
});

test('The Library offer only appears for a Create, and the chats follow new content only from the bottom', () => {
  const portal = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  assert.match(portal, /!coachActions\.some\(\(a\) => a && a\.type === 'create'\)/);
  assert.match(portal, /function scrollToBottom\(force\) \{\s*if \(force !== true && !stickToBottom\) return;/);
  const studio = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  assert.match(studio, /function scrollCoachLogToBottom\(force\)/);
  assert.doesNotMatch(studio, /log\.scrollTop = log\.scrollHeight;\s*return row;/, 'bubbles use the following-aware scroll');
});

test('A design waiting for a free designer says where it is in line', () => {
  delete require.cache[require.resolve('../design-studio-v2.js')];
  require('../design-studio-v2.js');
  const { stageText } = globalThis.seDesignStudio;
  assert.equal(stageText({ stage: 'queued', ahead: 2 }), 'In line: 2 designs ahead of yours, starting when a designer is free…');
  assert.equal(stageText({ stage: 'queued', ahead: 1 }), 'In line: 1 design ahead of yours, starting when a designer is free…');
  assert.equal(stageText({ stage: 'queued', ahead: 0 }), 'Next in line, starting as soon as a designer is free…');
  assert.equal(stageText({ stage: 'queued' }), 'In line for a free designer…', 'an older server that does not say how many');
  assert.equal(stageText({ stage: 'draft' }), 'Studying your example slides…');
});
