'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { queueableSingleImage, captionForQueue } = require('../studio-queue-ready');

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
