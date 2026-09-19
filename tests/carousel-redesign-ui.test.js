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

test('Design rail remembers the last carousel plan and applies it on create-the-slides', () => {
  const design = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  const ask = design.slice(design.indexOf('async function designCoachAsk'), design.indexOf('// html2canvas'));
  assert.match(ask, /__SE_CAROUSEL_PLAN/);
  assert.match(ask, /lastPlan/);
});

test('applyCarouselPlan paints slides one at a time from the canvas master', () => {
  const design = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  const start = design.indexOf('async function applyCarouselPlan');
  const end = design.indexOf('async function applyPendingDesignCoach');
  const fn = design.slice(start, end);
  assert.match(fn, /carousel-redesign\/slide/);
  assert.match(fn, /masterImageUrl\(\)/);
  assert.match(fn, /alignCarouselPlanToStyleRefs|coachStyleHttpsUrls/);
  assert.match(fn, /for\s*\(|for\s+of|slides\.length/);
  assert.doesNotMatch(fn, /\$\{apiBase\(\)\}\/api\/studio\/carousel-redesign`/);
  assert.match(fn, /applyRedesignedSlides/);
  assert.match(fn, /180_000/);
});

test('Design rail trains from up to 10 reference slides and asks for that many', () => {
  const design = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  assert.match(design, /CS_MAX_STYLE_REFS = 10/);
  assert.match(design, /exactly \$\{styleUrls\.length\} slides|exactly \$\{n\} slides|exactly that many slides/);
  assert.match(design, /source infographic|content comes from the (source )?infographic/i);
  assert.doesNotMatch(design, /Propose 4–6 complete slides, no more than 10/);
});

test('Post tab can start fresh, save, archive, and delete a design', () => {
  const design = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  assert.match(design, /function startFresh/);
  assert.match(design, /id="cs-new-post"/);
  assert.match(design, /id="cs-save-later"/);
  assert.match(design, /id="cs-archive-design"/);
  assert.match(design, /id="cs-delete-design"/);
  assert.match(design, /id="cs-save-template"/);
  assert.match(design, /design-scene\/extract/);
  assert.match(design, /design-scene\/fill/);
  const setRef = design.slice(design.indexOf('function setReference'), design.indexOf('function heroUrlForGenerate'));
  assert.match(setRef, /startFresh/);
});

test('Design generate waits for FigureLabs 4K upscale', () => {
  const design = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  const gen = design.slice(design.indexOf('async function generate()'), design.indexOf('function sharedCoachStorageKey'));
  assert.match(gen, /4K upscale/);
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
  assert.match(src, /Instagram max 10|no more than 10/);
  assert.doesNotMatch(src, /1:1 Instagram carousel/);
  assert.match(src, /formatCoachReplyHtml/);
  assert.match(src, /design-workspace.js/);
  assert.match(src, /design-scene.js/);
});
