'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  acceptFor, labelOf, filterKind, selectedId, selectedUrl, isAssetKind,
} = require('../portal-assets');

test('acceptFor and isAssetKind', () => {
  assert.equal(acceptFor('outro'), 'video/*');
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

test('retagKinds keeps stills together and does not offer outro for a logo', () => {
  const { retagKinds } = require('../portal-assets');
  assert.deepEqual(retagKinds('scene').sort(), ['character', 'item', 'logo', 'plate', 'scene', 'setting', 'style']);
  assert.deepEqual(retagKinds('outro').sort(), ['intro', 'outro', 'shot', 'video']);
  assert.deepEqual(retagKinds('music'), ['music']);
  assert.deepEqual(retagKinds('color'), ['color']);
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
  assert.match(src, /reference_images/);
  assert.match(src, /data-ref-remove/);
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
