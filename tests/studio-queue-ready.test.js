'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  queueableSingleImage,
  captionForQueue,
  queueReviewStatus,
  openContentReviewAfterQueue,
  cardMediaSrc,
  sortPostsForReview,
} = require('../studio-queue-ready');

test('uploaded square is queueable without a generated design', () => {
  assert.equal(
    queueableSingleImage({
      carousel: false,
      designed: false,
      imageUrl: 'https://cdn.example/post.jpg',
      type: 'image',
    }),
    'https://cdn.example/post.jpg'
  );
});

test('generated design or carousel does not use the raw upload as the queue image', () => {
  assert.equal(queueableSingleImage({
    carousel: true, designed: false, imageUrl: 'https://cdn.example/post.jpg', type: 'image',
  }), '');
  assert.equal(queueableSingleImage({
    carousel: false, designed: true, imageUrl: 'https://cdn.example/post.jpg', type: 'image',
  }), '');
  assert.equal(queueableSingleImage({
    carousel: false, designed: false, imageUrl: 'https://cdn.example/clip.mp4', type: 'video',
  }), '');
});

test('typed caption wins over generated caption and brief', () => {
  assert.equal(captionForQueue({
    typedCaption: '  Shop the drop  ',
    generatedCaption: 'AI caption',
    brief: 'brief text',
  }), 'Shop the drop');
});

test('brief is the caption when nothing was typed or generated', () => {
  assert.equal(captionForQueue({
    typedCaption: '',
    generatedCaption: '',
    brief: 'Already wrote this elsewhere',
  }), 'Already wrote this elsewhere');
});

test('Add to Queue writes Pending so the card shows in review', () => {
  assert.equal(queueReviewStatus(), 'Pending');
});

test('after queue, Content Review nav is clicked', () => {
  let clicked = false;
  const doc = { querySelector: (sel) => sel === '[data-nav=content]' ? { click() { clicked = true; } } : null };
  assert.equal(openContentReviewAfterQueue(doc), true);
  assert.equal(clicked, true);
});

test('Atlas card thumbs go through media-fetch so they are not hotlink-blocked', () => {
  const src = cardMediaSrc('https://oss.aliyuncs.com/opa/slide.png', 'https://api.example');
  assert.equal(src, 'https://api.example/api/media-fetch?url=' + encodeURIComponent('https://oss.aliyuncs.com/opa/slide.png'));
});

test('a just-queued post sorts above older scheduled posts', () => {
  const sorted = sortPostsForReview([
    { id: 'old', scheduled_date: '2026-09-20', created_at: '2026-09-01T00:00:00.000Z' },
    { id: 'new', created_at: '2026-09-16T21:18:00.000Z' },
  ]);
  assert.equal(sorted[0].id, 'new');
});

test('claude-studio queues as Pending and opens Content Review', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  assert.match(src, /queueReviewStatus/);
  assert.match(src, /openContentReviewAfterQueue/);
  assert.doesNotMatch(src, /status:\s*'Approved'/);
});

test('portal cards use cardMediaSrc and sortPostsForReview', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  assert.match(src, /cardMediaSrc\(/);
  assert.match(src, /sortPostsForReview\(/);
});
