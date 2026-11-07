'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { linesFromSlides, joinLines, cleanLine } = require('../carousel-reel-lines');

test('takes title slots and skips image urls', () => {
  const lines = linesFromSlides([
    { slots: { title: 'Early signs you should not ignore', art: 'https://cdn.example/a.png' } },
    { slots: { heading: 'What changes in week one', points: ['Sleep', 'Energy', 'Mood'] } },
  ]);
  assert.deepEqual(lines.slice(0, 3), [
    'Early signs you should not ignore',
    'What changes in week one',
    'Sleep',
  ]);
});

test('truncates wordy lines and caps at 8 beats', () => {
  const long = 'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen';
  assert.equal(cleanLine(long).split(/\s+/).length, 14);
  const slides = Array.from({ length: 12 }, (_, i) => ({ slots: { title: `Beat ${i + 1}` } }));
  assert.equal(linesFromSlides(slides).length, 8);
});

test('empty or image-only slides contribute nothing', () => {
  assert.deepEqual(linesFromSlides([{ slots: { art: 'https://cdn.example/x.png' } }, null, {}]), []);
});

test('joinLines makes the textarea payload', () => {
  assert.equal(joinLines(['A', '', 'B']), 'A\nB');
});
