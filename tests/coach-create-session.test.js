'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  applyCoachCreateFields,
  coachCreateNav,
  normalizeCoachCreateSession,
} = require('../coach-create-session');

test('studio destination opens creation-studio', () => {
  const s = normalizeCoachCreateSession({ prompt: 'still post', mode: 'image' });
  assert.equal(s.destination, 'studio');
  assert.equal(coachCreateNav(s), 'creation-studio');
});

test('animate destination opens animation-studio', () => {
  assert.equal(coachCreateNav({ destination: 'animate' }), 'animation-studio');
});

test('portal deep-links Generate this instead of coach-create', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  assert.match(src, /function openCreateFromCoach/);
  assert.match(src, /__SE_COACH_CREATE_SESSION/);
  assert.match(src, /Generate this/);
  const createClick = src.slice(src.indexOf('aiRow.querySelectorAll(\'.coach-action-btn\')'));
  assert.doesNotMatch(createClick.slice(0, 1800), /\/api\/coach-create/);
});

test('animation studio hydrates a coach session into the brief box', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'animation-studio.js'), 'utf8');
  assert.match(src, /__SE_COACH_CREATE_SESSION/);
  assert.match(src, /applyAnimCoachCreateSessionIfAny/);
});

test('studio apply keeps the session when the brief field is missing', () => {
  const session = normalizeCoachCreateSession({ prompt: 'silk dress on white', product_name: 'Silk' });
  const first = applyCoachCreateFields(session, {});
  assert.equal(first.applied, false);
  assert.equal(first.keep, true);
  const second = applyCoachCreateFields(session, { dir: { value: '' } });
  assert.equal(second.applied, true);
  assert.equal(second.keep, true);
  assert.equal(second.prompt, 'silk dress on white');
  assert.equal(second.product_name, 'Silk');
});

test('studio remount can apply the same session again', () => {
  const session = normalizeCoachCreateSession({ prompt: 'night market reel', aspect_ratio: '9:16' });
  const a = applyCoachCreateFields(session, { dir: { value: '' } });
  const b = applyCoachCreateFields(session, { dir: { value: '' } });
  assert.equal(a.applied, true);
  assert.equal(b.applied, true);
  assert.equal(a.keep, true);
  assert.equal(b.keep, true);
  assert.equal(b.prompt, 'night market reel');
});

test('portal and animate apply do not consume the session', () => {
  const portal = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  const applyStudio = portal.slice(
    portal.indexOf('function applyCoachCreateSessionIfAny'),
    portal.indexOf('function openCreateFromCoach')
  );
  assert.doesNotMatch(applyStudio, /__SE_COACH_CREATE_SESSION\s*=\s*null/);
  assert.match(applyStudio, /if\s*\(\s*!dir\s*\)\s*return false/);
  const anim = fs.readFileSync(path.join(__dirname, '..', 'animation-studio.js'), 'utf8');
  const applyAnim = anim.slice(
    anim.indexOf('async function applyAnimCoachCreateSessionIfAny'),
    anim.indexOf('window.applyAnimCoachCreateSessionIfAny')
  );
  assert.doesNotMatch(applyAnim, /__SE_COACH_CREATE_SESSION\s*=\s*null/);
  assert.match(applyAnim, /if\s*\(\s*!ta\s*\)\s*return false/);
});
