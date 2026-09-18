'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Design Studio opens Coach redesign, not even-cut Split', () => {
  const design = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  assert.match(design, /Redesign as carousel/);
  assert.doesNotMatch(design, /Split into carousel/);
  assert.match(design, /function designCoachAsk/);
  assert.match(design, /cs-coach-rail/);
  assert.match(design, /cs-finish-bar/);
  assert.doesNotMatch(design, /cs-tweak-bar/);
  assert.match(design, /method === 'redesign'/);
  assert.match(design, /carousel-redesign\/slide/);
  assert.match(design, /Redo selected/);
  assert.doesNotMatch(design, /switchNav\('ai-coach'\)/);
  assert.doesNotMatch(design, /cs-slide-count[\s\S]{0,80}splitCarousel\(\{\s*slideCount/);
});

test('Coach chat sends a durable image URL and can accept a redesign plan', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  assert.match(src, /attached_image_url/);
  assert.match(src, /carousel_redesign/);
  assert.match(src, /Accept carousel plan/);
  assert.match(src, /\/api\/studio\/carousel-redesign/);
  assert.match(src, /function openCoachForCarouselRedesign/);
  assert.match(src, /__SE_DESIGN_COACH_SEED/);
  const openFn = src.slice(src.indexOf('function openCoachForCarouselRedesign'), src.indexOf('window.openCoachForCarouselRedesign'));
  assert.doesNotMatch(openFn, /switchNav\('ai-coach'\)/);
  assert.match(src, /Make carousel/);
  assert.match(src, /9:16 Instagram carousel/);
  assert.match(src, /no more than 10/);
  assert.doesNotMatch(src, /1:1 Instagram carousel/);
});
