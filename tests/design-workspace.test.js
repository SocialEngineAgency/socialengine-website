'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  emptyDesignWorkspace,
  startFreshWorkspace,
  shouldRestoreLastDesign,
  upsertLibraryItem,
  archiveLibraryItem,
  deleteLibraryItem,
  formatSlideHttpsUrls,
} = require('../design-workspace');

test('startFresh clears the canvas and does not delete the library', () => {
  const ws = {
    generatedUrl: 'https://store.example/poster.png',
    html: '<html></html>',
    carousel: { slides: [{ url: 'https://store.example/s1.png' }, { url: 'https://store.example/s2.png' }] },
    ref: { url: 'https://store.example/poster.png' },
    originalPreviewUrl: 'https://store.example/poster.png',
    queueSingleUrl: 'https://store.example/poster.png',
    designId: 'rec123',
    lastPlan: { slides: [1, 2] },
    brief: 'gastro',
    styleUrls: ['https://store.example/t1.png'],
  };
  const library = [{ id: 'rec123', image_url: ws.generatedUrl, status: 'saved' }];
  const next = startFreshWorkspace(ws);
  assert.equal(next.generatedUrl, null);
  assert.equal(next.html, '');
  assert.equal(next.carousel, null);
  assert.equal(next.ref, null);
  assert.equal(next.designId, null);
  assert.equal(next.lastPlan, null);
  assert.equal(next.cleared, true);
  assert.equal(library.length, 1);
});

test('Clear of a generated poster must not restore it from last-design', () => {
  const fresh = startFreshWorkspace({ generatedUrl: 'https://store.example/poster.png' });
  assert.equal(shouldRestoreLastDesign(fresh, { image_url: 'https://store.example/poster.png' }), false);
  assert.equal(shouldRestoreLastDesign(emptyDesignWorkspace(), { image_url: 'https://store.example/poster.png' }), true);
});

test('uploaded carousel slides are a format set even with no Coach chips', () => {
  const uploaded = [
    { url: 'https://store.example/s1.png' },
    { url: 'https://store.example/s2.png' },
    { url: 'https://store.example/s3.png' },
  ];
  assert.deepEqual(formatSlideHttpsUrls({ styleUrls: [], carouselSlides: uploaded }), [
    'https://store.example/s1.png',
    'https://store.example/s2.png',
    'https://store.example/s3.png',
  ]);
  assert.deepEqual(formatSlideHttpsUrls({
    styleUrls: ['https://store.example/chip.png'],
    carouselSlides: uploaded,
  }), [
    'https://store.example/s1.png',
    'https://store.example/s2.png',
    'https://store.example/s3.png',
  ]);
  assert.deepEqual(formatSlideHttpsUrls({
    styleUrls: ['https://store.example/a.png', 'https://store.example/b.png'],
    carouselSlides: uploaded,
  }), [
    'https://store.example/a.png',
    'https://store.example/b.png',
  ]);
});

test('save / archive / delete are explicit and permanent delete drops the row', () => {
  let items = [];
  items = upsertLibraryItem(items, {
    id: 'rec1',
    image_url: 'https://store.example/a.png',
    title: 'Gastro poster',
    status: 'saved',
  });
  assert.equal(items.length, 1);
  items = archiveLibraryItem(items, 'rec1');
  assert.equal(items[0].status, 'archived');
  items = deleteLibraryItem(items, 'rec1');
  assert.equal(items.length, 0);
});
