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
