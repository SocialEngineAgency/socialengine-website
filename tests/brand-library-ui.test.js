'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Library page can upload stills, harvest, generate views, and review drafts', () => {
  const portal = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  const lib = fs.readFileSync(path.join(__dirname, '..', 'library.js'), 'utf8');
  // The page itself lives in library.js; portal.html hands it the data and the "use this still" hand-off.
  const src = `${portal}\n${lib}`;
  assert.match(portal, /data-nav="library"/);
  assert.match(portal, /<script src="\.\/library\.js/);
  assert.match(portal, /window\.renderLibraryUI\(content, \{/);
  assert.match(portal, /fetchAssets: fetchAssetLibrary/);
  assert.match(portal, /useStill: useLibraryStillNow/);
  assert.doesNotMatch(portal, /function paintBrandLibrary/, 'the old list painter is gone');
  assert.match(src, /brand-lib-collection/);
  assert.match(lib, /const kindOptions = \['scene', 'character', 'item', 'setting', 'style', 'plate', 'shot', 'outro', 'intro', 'music', 'logo', 'video'\]/);
  assert.match(lib, /id="brand-lib-kind"/);
  assert.match(lib, /<option value="scene">[^]*<option value="character">[^]*<option value="plate">/, 'the diagram maker saves as a scene, character or plate');
  assert.match(src, /data-asset-select/);
  assert.match(src, /\/api\/assets\/generate/);
  assert.match(src, /\/api\/assets\/harvest/);
  assert.match(src, /generate-views/);
  assert.match(lib, /'Turnaround sheet'/);
  assert.match(src, /Remake sheet/);
  assert.match(src, /Making sheet/);
  assert.match(lib, /lb-sheet/);
  assert.match(lib, /lb-bar/);
  assert.match(src, /turnaround sheet/i);
  assert.match(lib, /'POST', '\{\}'/, 'calls with no payload still send a JSON body');
  assert.doesNotMatch(src, /JSON\.stringify\(\{ label \}\)/);
  assert.match(src, /data-asset-views-of/);
  assert.match(lib, /variant === 'charity'/);
  assert.doesNotMatch(lib, /showFigureLabsGenerate/);
  assert.match(src, /FigureLabs diagrams only/);
  assert.doesNotMatch(src, /Fashion accounts without FigureLabs/);
  assert.match(src, /more-like-this/);
  assert.match(src, /Add to library/);
  assert.match(lib, /Use in a post/);
  assert.match(portal, /Save to Library/);
  assert.match(src, /drafts\/reject/);
  assert.match(src, /brand-lib-filter/);
  assert.match(portal, /chat-attach-library/);
  assert.match(lib, /id="brand-lib-file" multiple/);
  assert.match(src, /data-asset-kind/);
  assert.match(src, /retagKinds/);
  assert.match(portal, /background-color: #1E293B/);
  assert.match(portal, /color-scheme: dark/);
  assert.match(lib, /const files = \[\.\.\.\(t\.files \|\| \[\]\)\]/);
  assert.match(lib, /lb-thumb/);
  assert.match(lib, /id="lb-panel"/, 'the picked item is shown in the panel on the right');
  assert.match(src, /brand-lib-import-past/);
  assert.match(src, /Add selected as Style/);
  assert.match(src, /\/api\/studio\/media-library/);
  assert.match(src, /kind: 'style'/);
  assert.match(lib, /function labelState[\s\S]*'unlabeled'/);
  assert.match(lib, /with AI/);
  assert.match(src, /Label with AI/);
  assert.match(src, /\/api\/assets\/analyze-missing/);
  assert.match(src, /\/analyze/);
  assert.match(portal, /id="se-lib-picker-grid" class="se-pick-grid"/);
  assert.match(portal, /\.se-pick-grid \{[\s\S]*grid-auto-rows:\s*max-content/);
  assert.match(portal, /\.se-pick-im img \{[\s\S]*object-fit:\s*cover/);
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
  assert.match(offer.question, /^Use 6 pictures from your Library as references \(/);
  assert.match(offer.question, /You have 41 in all/);
  assert.doesNotMatch(offer.question, /Character number 40/, 'names beyond what is attached are not listed');
  assert.ok(offer.question.length < 220, `short enough to read (${offer.question.length})`);
  assert.equal(offer.images, 6);
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
