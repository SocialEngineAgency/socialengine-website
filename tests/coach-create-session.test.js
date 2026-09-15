'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  applyCoachCreateFields,
  coachCreateNav,
  inferCreateActionFromReply,
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

test('portal deep-links Create this now instead of coach-create', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  assert.match(src, /function openCreateFromCoach/);
  assert.match(src, /__SE_COACH_CREATE_SESSION/);
  assert.match(src, /Create this now/);
  assert.match(src, /inferCreateActionFromReply/);
  assert.match(src, /priorTexts/);
  assert.match(src, /isCoachMetaBrief/);
  const createClick = src.slice(src.indexOf('aiRow.querySelectorAll(\'.coach-action-btn\')'));
  assert.doesNotMatch(createClick.slice(0, 1800), /\/api\/coach-create/);
});

test('a promised Create this now reply still yields a create action in the portal', () => {
  const action = inferCreateActionFromReply(
    'This should now render as a one-click button. Click "Create this now" and the 25-30s Reel will generate with flat vector animation.',
    'yes'
  );
  assert.equal(action.type, 'create');
  assert.equal(action.destination, 'animate');
  assert.match(action.prompt, /flat vector|Reel/i);
  assert.doesNotMatch(action.prompt, /one-click button|can't execute/i);
});

test('a refusal about the missing button uses the earlier brief', () => {
  const action = inferCreateActionFromReply(
    'I understand — but I can\'t execute the video generation myself. You need to click the "Create this now" button that should appear after my last message.',
    'the button is not there',
    ['Click "Create this now" and the 25-30s Reel will generate with: Flat vector animation style. UK GP appointment flow.']
  );
  assert.equal(action.type, 'create');
  assert.match(action.prompt, /flat vector|UK GP/i);
  assert.doesNotMatch(action.prompt, /can't execute/i);
  assert.equal(action.destination, 'animate');
});

test('inference keeps the longest shot list past 400 chars', () => {
  const long = [
    'Frame 1 (6s): receptionist greeting.',
    'Frame 2 (6s): checklist — duration, weight loss, family history.',
    'Frame 3 (6s): they might suggest an endoscopy — it is quick.',
    'Frame 4 (6s): you can go home the same day.',
    'Flat vector animation. UK GP appointment flow.',
  ].join('\n') + '\n' + 'Detail. '.repeat(40);
  const action = inferCreateActionFromReply(
    'Create this now is below.',
    'yes do it',
    [long]
  );
  assert.match(action.prompt, /Frame 4/);
  assert.match(action.prompt, /\n/);
  assert.ok(action.prompt.length > 400);
});

test('portal stores the create action object instead of a data-prompt attribute', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  assert.match(src, /coachActionPayloads/);
  const createBtn = src.slice(src.indexOf("if (a.type === 'create')"), src.indexOf("return '';"));
  assert.doesNotMatch(createBtn, /data-prompt=/);
});

test('animate apply switches to Describe a video for a coach shot list', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'animation-studio.js'), 'utf8');
  const fn = src.slice(
    src.indexOf('async function applyAnimCoachCreateSessionIfAny'),
    src.indexOf('window.applyAnimCoachCreateSessionIfAny')
  );
  assert.match(fn, /writeAnimEntry\('prompt'\)|applyAnimEntryUI\('prompt'\)/);
});

test('a Canva bounce still yields Create this now from the earlier brief', () => {
  const action = inferCreateActionFromReply(
    'Option A: Use Canva Pro at canva.com. Option B: ask your SocialEngine account manager why [CREATE_CONTENT] is missing. I can\'t press a button for you.',
    'we are in a loop',
    ['The 25-30s Reel will generate with: Flat vector animation style. UK GP appointment flow.']
  );
  assert.equal(action.type, 'create');
  assert.match(action.prompt, /flat vector|UK GP/i);
  assert.doesNotMatch(action.prompt, /canva|account manager/i);
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
