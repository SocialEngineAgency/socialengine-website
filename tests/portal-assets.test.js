'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  acceptFor, labelOf, filterKind, selectedId, selectedUrl, isAssetKind,
} = require('../portal-assets');

test('acceptFor and isAssetKind', () => {
  assert.equal(acceptFor('outro'), 'image/*,video/*');
  assert.equal(acceptFor('music'), 'audio/*,video/*');
  assert.equal(acceptFor('logo'), 'image/*');
  assert.equal(acceptFor('scene'), 'image/*');
  assert.equal(acceptFor('character'), 'image/*');
  assert.equal(acceptFor('plate'), 'image/*');
  assert.equal(acceptFor('item'), 'image/*');
  assert.equal(acceptFor('setting'), 'image/*');
  assert.equal(isAssetKind('outro'), true);
  assert.equal(isAssetKind('scene'), true);
  assert.equal(isAssetKind('item'), true);
  assert.equal(isAssetKind('setting'), true);
  assert.equal(isAssetKind('color'), true);
  assert.equal(isAssetKind('nope'), false);
});

test('a picture can be tagged as an outro, and a video end card stays a video', () => {
  const { retagKinds } = require('../portal-assets');
  const still = retagKinds('scene', 'https://store.test/look.png');
  assert.ok(still.includes('outro'));
  assert.ok(still.includes('intro'));
  assert.ok(still.includes('scene'));
  assert.ok(!still.includes('shot'));
  assert.ok(!still.includes('music'));
  const back = retagKinds('outro', 'https://store.test/look.png');
  assert.ok(back.includes('scene'));
  assert.ok(back.includes('outro'));
  assert.ok(!back.includes('shot'));
  assert.deepEqual(retagKinds('outro', 'https://store.test/end.mp4').sort(), ['intro', 'outro', 'shot', 'video']);
  assert.deepEqual(retagKinds('music'), ['music']);
  assert.deepEqual(retagKinds('color'), ['color']);
  assert.equal(require('../portal-assets').acceptFor('outro'), 'image/*,video/*');
});

test('libraryOffer and refsFromAssets tag Char, Item, and Setting', () => {
  const {
    libraryOffer, refsFromAssets,
  } = require('../portal-assets');
  const list = [
    { id: 'ast_maya', kind: 'character', name: 'Dr Maya', url: 'https://store.test/maya.png', views: [{ label: 'front', url: 'https://store.test/maya-front.png' }] },
    { id: 'ast_device', kind: 'item', name: 'OPA device', url: 'https://store.test/device.png' },
    { id: 'ast_class', kind: 'setting', name: 'Classroom', url: 'https://store.test/classroom.png' },
  ];
  const offer = libraryOffer(list);
  assert.match(offer.question, /Dr Maya/);
  assert.match(offer.question, /Classroom/);
  const refs = refsFromAssets(list, ['ast_maya', 'ast_device', 'ast_class']);
  assert.equal(refs.find((r) => r.url.includes('maya.png')).role, 'character');
  assert.equal(refs.find((r) => r.url.includes('device')).role, 'item');
  assert.equal(refs.find((r) => r.url.includes('classroom')).role, 'setting');
});

test('coach chat keeps one still per Library item and stops at 6', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { coachChatReferences, COACH_REF_CAP } = require('../portal-assets');
  assert.equal(COACH_REF_CAP, 6);
  const maya = {
    id: 'ast_maya',
    kind: 'character',
    name: 'Maya',
    url: 'https://store.test/maya.png',
    views: [{ label: 'side', url: 'https://store.test/maya-side.png' }],
  };
  const packed = coachChatReferences([
    maya,
    { id: 'ast_suit', kind: 'style', name: 'Black suit', url: 'https://store.test/suit.png' },
    { id: 'ast_item', kind: 'item', name: 'Lantern', url: 'https://store.test/lantern.png' },
    { id: 'ast_room', kind: 'setting', name: 'Porch', url: 'http://insecure.test/porch.png' },
    { id: 'ast_dup', kind: 'scene', name: 'Same', url: 'https://store.test/maya.png' },
  ], ['ast_suit', 'ast_maya', 'ast_room', 'ast_item', 'ast_dup', 'missing']);
  assert.deepEqual(packed.refs.map((r) => r.role), ['look', 'subject', 'subject']);
  assert.deepEqual(packed.refs.map((r) => r.title), ['Black suit', 'Maya', 'Lantern']);
  assert.equal(packed.refs[1].libraryRole, 'character');
  assert.equal(packed.omitted, 0);
  assert.ok(!packed.refs.some((r) => r.url.includes('maya-side')));

  const many = Array.from({ length: 8 }, (_, i) => ({
    id: `a${i}`, kind: 'character', name: `C${i}`, url: `https://store.test/${i}.png`,
  }));
  const capped = coachChatReferences(many, many.map((a) => a.id));
  assert.equal(capped.refs.length, 6);
  assert.equal(capped.total, 8);
  assert.equal(capped.omitted, 2);
  assert.equal(capped.refs[0].title, 'C0');

  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  assert.match(src, /coachChatReferences/);
  assert.match(src, /addCoachReferences/);
  assert.match(src, /reference_images/);
  assert.match(src, /data-ref-remove/);
  assert.match(src, /id="chat-upload-input" accept="image\/\*,video\/\*" multiple/);
});

test('adding a Coach reference keeps the ones already attached', () => {
  const { addCoachReferences, coachChatReferences } = require('../portal-assets');
  const existing = [
    { id: 'a1', url: 'https://store.test/1.png', title: 'One', role: 'subject', libraryRole: 'character' },
    { id: 'a2', url: 'https://store.test/2.png', title: 'Two', role: 'subject', libraryRole: 'character' },
    { id: 'a3', url: 'https://store.test/3.png', title: 'Three', role: 'look', libraryRole: 'style' },
    { id: 'a4', url: 'https://store.test/4.png', title: 'Four', role: 'look', libraryRole: 'scene' },
  ];
  const fifth = coachChatReferences([
    { id: 'a5', kind: 'item', name: 'Fifth', url: 'https://store.test/5.png' },
  ], ['a5']);
  const merged = addCoachReferences(existing, fifth.refs);
  assert.deepEqual(merged.refs.map((r) => r.title), ['One', 'Two', 'Three', 'Four', 'Fifth']);
  assert.equal(merged.refs[4].role, 'subject');
  assert.equal(merged.omitted, 0);

  const again = addCoachReferences(merged.refs, fifth.refs);
  assert.equal(again.refs.length, 5);

  const extra = Array.from({ length: 3 }, (_, i) => ({
    id: `b${i}`, url: `https://store.test/b${i}.png`, title: `B${i}`, role: 'look', libraryRole: 'style',
  }));
  const capped = addCoachReferences(merged.refs, extra);
  assert.deepEqual(capped.refs.map((r) => r.title), ['One', 'Two', 'Three', 'Four', 'Fifth', 'B0']);
  assert.equal(capped.total, 8);
  assert.equal(capped.omitted, 2);
});

test('labelOf falls back to the kind label', () => {
  assert.equal(labelOf({ name: 'Silk end', kind: 'outro' }), 'Silk end');
  assert.equal(labelOf({ kind: 'music' }), 'Music');
});

test('selectedId / selectedUrl / filterKind', () => {
  const list = [
    { id: 'ast_1', kind: 'outro', name: 'A', url: 'https://store.test/a.mp4' },
    { id: 'ast_2', kind: 'music', name: 'B', url: 'https://store.test/b.mp3' },
  ];
  assert.equal(filterKind(list, 'outro').length, 1);
  assert.equal(selectedId(list, 'https://store.test/a.mp4'), 'ast_1');
  assert.equal(selectedUrl(list, 'ast_2'), 'https://store.test/b.mp3');
  assert.equal(selectedId(list, ''), '');
});
