'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Design Studio opens Coach redesign, not even-cut Split', () => {
  const design = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  assert.match(design, /Redesign as carousel/);
  assert.doesNotMatch(design, /Split into carousel/);
  assert.match(design, /openCoachForCarouselRedesign/);
  assert.match(design, /method === 'redesign'/);
  assert.match(design, /carousel-redesign\/slide/);
  assert.match(design, /Redo selected/);
  assert.doesNotMatch(design, /cs-slide-count[\s\S]{0,80}splitCarousel\(\{\s*slideCount/);
});

test('Coach chat sends a durable image URL and can accept a redesign plan', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  assert.match(src, /attached_image_url/);
  assert.match(src, /carousel_redesign/);
  assert.match(src, /Accept carousel plan/);
  assert.match(src, /\/api\/studio\/carousel-redesign/);
  assert.match(src, /function openCoachForCarouselRedesign/);
  assert.match(src, /Make carousel/);
});
