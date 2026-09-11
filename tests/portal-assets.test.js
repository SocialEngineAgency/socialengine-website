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
  assert.equal(isAssetKind('outro'), true);
  assert.equal(isAssetKind('nope'), false);
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
