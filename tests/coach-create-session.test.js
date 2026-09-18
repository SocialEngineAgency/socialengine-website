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
  persistCoachHistoryEntry,
  formatCoachReplyHtml,
  resolveDesignCoachApply,
  studioGenerateMode,
  studioModelForMode,
  titleFromCoachBrief,
} = require('../coach-create-session');

test('studio destination opens creation-studio', () => {
  const s = normalizeCoachCreateSession({ prompt: 'still post', mode: 'image' });
  assert.equal(s.destination, 'studio');
  assert.equal(coachCreateNav(s), 'creation-studio');
});

test('animate destination opens animation-studio', () => {
  assert.equal(coachCreateNav({ destination: 'animate' }), 'animation-studio');
});

test('design destination opens Design Studio', () => {
  const s = normalizeCoachCreateSession({
    prompt: 'Tylosis carousel. Attach the infographic then split.',
    destination: 'design',
    mode: 'image',
  });
  assert.equal(s.destination, 'design');
  assert.equal(coachCreateNav(s), 'design-studio');
});

test('this-turn infographic ask does not reuse a prior reel brief', () => {
  const action = inferCreateActionFromReply(
    'Create this now is below.',
    'create a gastric cancer infographic for OPA',
    ['Idea 3: What Happens at Your GP Appointment (25-30s Reel). Perfect — shorter = higher completion rate on Reels anyway.']
  );
  assert.equal(action.destination, 'design');
  assert.match(action.prompt, /gastric cancer infographic/i);
  assert.doesNotMatch(action.prompt, /GP Appointment/);
});

test('carousel language infers design', () => {
  const action = inferCreateActionFromReply(
    'Create this now is below.',
    'make a carousel infographic about how a microscope is made'
  );
  assert.equal(action.destination, 'design');
  assert.equal(action.mode, 'image');
  assert.equal(action.aspect_ratio, '9:16');
});

test('design apply fills the Post brief and keeps the session', () => {
  const session = normalizeCoachCreateSession({
    prompt: 'UK guide to tylosis. Upload infographic, split, caption, queue.',
    destination: 'design',
  });
  const result = applyCoachCreateFields(session, { csBrief: { value: '' } });
  assert.equal(result.applied, true);
  assert.equal(result.keep, true);
  assert.match(result.prompt, /tylosis/i);
});

test('portal Create this now can open Design Studio', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  assert.match(src, /nav === 'design-studio'/);
  assert.match(src, /openClaudeDesignStudio/);
  const design = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  assert.match(design, /function applyDesignCoachSession/);
  assert.match(design, /destination !== 'design'/);
  assert.doesNotMatch(design, /__SE_COACH_CREATE_SESSION\s*=\s*null/);
});

test('a 25-30s reel brief cannot land in Design Studio', () => {
  const s = normalizeCoachCreateSession({
    prompt: 'Idea 3: "What Happens at Your GP Appointment" (25-30s Reel)\nPerfect — shorter = higher completion rate on Reels anyway.',
    destination: 'design',
    mode: 'image',
  });
  assert.notEqual(s.destination, 'design');
  assert.equal(s.destination, 'animate');
  assert.equal(coachCreateNav(s), 'animation-studio');
});

test('design-studio nav opens Post without a Video remount race', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  const start = src.indexOf("if (nav === 'design-studio')");
  assert.ok(start >= 0);
  const block = src.slice(start, start + 700);
  assert.match(block, /__SE_CREATE_SURFACE\s*=\s*'design'/);
  assert.doesNotMatch(block, /setTimeout/);
  assert.match(src, /__SE_CREATE_SURFACE === 'design'/);
  assert.match(src, /onclick="window\.__SE_CREATE_SURFACE='video';\s*renderVideoStudio\(\)"/);
  const gen = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  const useVideo = gen.match(/if \(data\.code === 'USE_VIDEO_STUDIO'\) \{[\s\S]*?\n        \}/);
  assert.ok(useVideo);
  assert.match(useVideo[0], /return;/);
  assert.doesNotMatch(useVideo[0], /throw new Error/);
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

test('brain freeze does not infer Create this now from an earlier brief', () => {
  const action = inferCreateActionFromReply(
    'Sorry, brain freeze. Try again.',
    'Redesign this infographic into a 9:16 Instagram carousel. Look at the image. Propose 4–6 complete slides, no more than 10.',
    ['Create this now is below. It opens Design Studio with the gastritis poster brief.']
  );
  assert.equal(action, null);
});

test('carousel redesign seed does not infer Create this now', () => {
  const action = inferCreateActionFromReply(
    'I will propose complete slides.',
    'Redesign this infographic into a 9:16 Instagram carousel. Look at the image. Propose 4–6 complete slides, no more than 10. Do not crop strips.',
    ['Create this now is below.']
  );
  assert.equal(action, null);
});

test('Coach replies strip raw HTML and break into readable paragraphs', () => {
  const html = formatCoachReplyHtml([
    'I need to clarify before I build this:<br><br><strong>OPA is an oesophageal cancer charity.</strong>',
    'You flagged this earlier.',
  ].join(' '));
  assert.match(html, /<p /);
  assert.match(html, /<strong>OPA is an oesophageal cancer charity\.<\/strong>/);
  assert.doesNotMatch(html, /&lt;br/);
  assert.doesNotMatch(html, /&lt;strong/);
  assert.doesNotMatch(html, /<br><br><strong>/);

  const slides = formatCoachReplyHtml([
    '**Slide 1 — Hook**',
    'What is Gastritis? Stomach illustration + OPA branding.',
    '',
    '**Slide 2 — Causes**',
    'Five cause icons in a clean grid.',
  ].join('\n'));
  assert.match(slides, /<strong>Slide 1 — Hook<\/strong>/);
  assert.doesNotMatch(slides, /\*\*Slide/);
  assert.ok((slides.match(/<p /g) || []).length >= 2);
});

test('Design Studio Coach rail attaches a style photo and formats replies', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  assert.match(src, /cs-coach-style/);
  assert.match(src, /style_image_url/);
  assert.match(src, /formatCoachReplyHtml/);
  assert.match(src, /row\.innerHTML = fmt\(text\)/);
});

test('Design rail refines auto-apply; new poster and carousel wait for Apply', () => {
  assert.equal(resolveDesignCoachApply({
    reply: 'Making the title larger.',
    userMessage: 'make the title bigger',
    hasCanvas: true,
  }).mode, 'refine');
  assert.equal(resolveDesignCoachApply({
    reply: 'I can build that poster.',
    userMessage: 'create a new gastritis poster',
    hasCanvas: false,
  }).mode, 'confirm_generate');
  assert.equal(resolveDesignCoachApply({
    reply: 'Here is a 5-slide plan.',
    userMessage: 'Redesign this infographic into a 9:16 Instagram carousel.',
    hasCanvas: true,
    actions: [{ type: 'carousel_redesign', slides: [{ title: 'Hook' }, { title: 'Fact' }] }],
  }).mode, 'confirm_carousel');
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

test('no still is text-to-video; a still is image-to-video', () => {
  assert.equal(studioGenerateMode(''), 'text-to-video');
  assert.equal(studioGenerateMode('https://cdn.example/still.jpg'), 'image-to-video');
  assert.equal(studioGenerateMode('data:image/png;base64,abc'), 'image-to-video');
});

test('empty product name falls back to the first brief line', () => {
  assert.equal(titleFromCoachBrief('Silk Dress', 'ignored'), 'Silk Dress');
  assert.equal(
    titleFromCoachBrief('', 'Frame 1 (6s): receptionist greeting.\nFrame 2: checklist.'),
    'Frame 1 (6s): receptionist greeting.'
  );
});

test('I2V model remaps to T2V when there is no still', () => {
  assert.equal(studioModelForMode('atlas-seedance-2-i2v', ''), 'atlas-seedance-2-t2v');
  assert.equal(studioModelForMode('atlas-seedance-2-i2v', 'https://cdn.example/still.jpg'), 'atlas-seedance-2-i2v');
});

test('session apply returns duration, format, and entry', () => {
  const session = normalizeCoachCreateSession({
    prompt: 'Frame 1 (6s): receptionist.',
    destination: 'animate',
    duration: 10,
    format_template_id: 'remix-24s',
    entry: 'prompt',
  });
  const result = applyCoachCreateFields(session, { animPrompt: { value: '' } });
  assert.equal(result.applied, true);
  assert.equal(result.duration, 10);
  assert.equal(result.format_template_id, 'remix-24s');
  assert.equal(result.entry, 'prompt');
});

test('assistant history keeps create actions so refresh can rebind', () => {
  const entry = persistCoachHistoryEntry('assistant', '<p>ok</p>', {
    actions: [{ type: 'create', prompt: 'silk dress on white', destination: 'studio' }],
  });
  assert.equal(entry.role, 'assistant');
  assert.equal(entry.actions[0].prompt, 'silk dress on white');
  const user = persistCoachHistoryEntry('user', 'make a reel');
  assert.equal(user.actions, undefined);
});

test('portal generate does not require a still or product name', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  const submit = src.slice(src.indexOf('async function submitVideoGeneration'), src.indexOf('function addGenerationToRecent'));
  assert.doesNotMatch(submit, /Please upload a product image first/);
  assert.doesNotMatch(submit, /Please enter the product name/);
  assert.match(submit, /studioGenerateMode|text-to-video/);
  assert.match(src, /add a still if you have one/i);
});

test('portal persists and restores coach_actions on refresh', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  assert.match(src, /persistCoachHistoryEntry/);
  assert.match(src, /saveToHistory\('assistant'/);
  const restore = src.slice(src.indexOf('// Restore previous messages'), src.indexOf('function saveToHistory'));
  assert.match(restore, /msg\.actions|entry\.actions/);
  assert.match(restore, /coach-action-btn/);
});

test('animate apply uses session format and entry', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'animation-studio.js'), 'utf8');
  const fn = src.slice(
    src.indexOf('async function applyAnimCoachCreateSessionIfAny'),
    src.indexOf('window.applyAnimCoachCreateSessionIfAny')
  );
  assert.match(fn, /format_template_id/);
  assert.match(fn, /writeAnimEntry\((result|session)\.entry|writeAnimEntry\(result\.entry/);
});
