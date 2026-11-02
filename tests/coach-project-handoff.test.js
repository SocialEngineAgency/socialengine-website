'use strict';
// The portal half of the Coach-to-project handoff: a create_project action the Coach already persisted is loaded
// by ID (never re-created), the destination tool takes the project's exact look and length, the legacy fallback
// keeps the stated look and length, and the button survives a reload.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const handoff = require('../content-project-handoff.js');
const session = require('../coach-create-session.js');

const portal = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
const animate = fs.readFileSync(path.join(__dirname, '..', 'animation-studio.js'), 'utf8');

function slice(source, start, end, length = 8000) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = end ? source.indexOf(end, from + start.length) : -1;
  return source.slice(from, to > from ? to : from + length);
}

const BRIEF = {
  topic: 'What the stomach actually does',
  format: '9:16 Reel',
  duration_seconds: 30,
  duration_tolerance_seconds: 1,
  style: { preset: 'realistic', hard_lock: true },
  required_beats: ['temporary food storage', 'acid and enzymes begin digestion', 'muscular churning mixes the contents', 'controlled release into the small intestine'],
  exclusions: ['gore', 'anime', 'purple styling'],
  claims_policy: { domain: 'medical', research_mode: 'required', allowed_publishers: ['nhs.uk'] },
  full_brief: 'A 30-second realistic Reel about the stomach.',
};
const ACTION = {
  type: 'create_project',
  capability_id: 'reel.create',
  destination: 'create/reels',
  label: 'Open project in Reels',
  project: { capability_id: 'reel.create', brief: BRIEF, delivery: { destination: 'review' }, spend: { currency: 'credits', maximum: 0, requires_owner_confirmation_above: 0 } },
};

test('a project the Coach persisted is loaded by ID, not created again', () => {
  const req = handoff.projectRequestFor({ ...ACTION, persisted: true, project_id: 'cp_123', brief_version: 1 });
  assert.equal(req.method, 'GET');
  assert.equal(req.path, '/api/content-runtime/projects/cp_123');
});

test('an unpersisted action is created with the server idempotency key, or a stable one', () => {
  const withKey = handoff.projectRequestFor({ ...ACTION, persisted: false, idempotency_key: 'coach:abc' });
  assert.equal(withKey.method, 'POST');
  assert.equal(withKey.idempotency_key, 'coach:abc');
  assert.deepEqual(withKey.body.brief, BRIEF);
  const derived = handoff.projectRequestFor(ACTION);
  assert.equal(derived.idempotency_key, handoff.projectIdempotencyKey(ACTION));
});

test('the loaded project must be the one the action names', () => {
  const project = { project_id: 'cp_123', brief_version: 1, capability_id: 'reel.create', brief: BRIEF };
  assert.equal(handoff.checkLoadedProject({ ...ACTION, project_id: 'cp_123' }, project), project);
  assert.throws(() => handoff.checkLoadedProject({ ...ACTION, project_id: 'cp_999' }, project), /different project/);
  assert.throws(() => handoff.checkLoadedProject({ ...ACTION, capability_id: 'video.create', project: { capability_id: 'video.create' } }, project), /different tool/);
  assert.throws(() => handoff.checkLoadedProject(ACTION, null), /could not be loaded/);
});

test('the project prompt carries the exact brief, the Coach brief text and the project ID', () => {
  const text = handoff.projectPrompt({ project_id: 'cp_123', brief_version: 1, brief: BRIEF });
  assert.match(text, /Canonical project: cp_123 · brief version 1/);
  assert.match(text, /Duration: exactly 30 seconds/);
  assert.match(text, /Style \(hard lock\): realistic/);
  assert.match(text, /Required beats: temporary food storage; acid and enzymes begin digestion/);
  assert.match(text, /Exclusions: gore; anime; purple styling/);
  assert.match(text, /live research required/);
  assert.match(text, /Coach brief[^\n]*\n A 30-second realistic Reel|Coach brief[^\n]*\nA 30-second realistic Reel/);
});

test('legacy create session keeps a stated look and total length; "no anime" is not a look', () => {
  const s = session.normalizeCoachCreateSession({ destination: 'animate', mode: 'video', prompt: 'A 30-second realistic Reel about the stomach. No anime. Shot 1: 5s food arrives.' });
  assert.equal(s.look, 'realistic');
  assert.equal(s.reel_seconds, 30);
  const fields = session.applyCoachCreateFields(s, { animPrompt: {} });
  assert.equal(fields.look, 'realistic');
  assert.equal(fields.reel_seconds, 30);
  assert.equal(session.normalizeCoachCreateSession({ destination: 'animate', mode: 'video', prompt: 'an animated reel, no anime' }).look, '');
  assert.equal(session.normalizeCoachCreateSession({ destination: 'animate', mode: 'video', prompt: 'reel', look: 'anime', reel_seconds: 45 }).look, 'cartoon');
});

test('a create_project button survives a reload, without the bulky stored project', () => {
  const entry = session.persistCoachHistoryEntry('assistant', 'Project ready', {
    actions: [{ ...ACTION, persisted: true, project_id: 'cp_123', brief_version: 1, persisted_project: { big: true } }],
  });
  assert.equal(entry.actions.length, 1);
  assert.equal(entry.actions[0].type, 'create_project');
  assert.equal(entry.actions[0].project_id, 'cp_123');
  assert.equal(entry.actions[0].persisted_project, undefined);
});

test('Reels takes the stated look and length; a length the picker lacks is reported, never shortened', () => {
  const src = slice(animate, 'const ANIM_LOOK_FOR_PRESET', 'window.applyAnimStatedLookAndLength');
  const option = (value) => ({ value });
  const events = [];
  const look = { value: 'stylized', options: [option('realistic'), option('stylized'), option('cartoon')], dispatchEvent: (e) => events.push(e.type) };
  const length = { value: '15', options: [option('15'), option('30'), option('45')] };
  const ctx = { document: { getElementById: (id) => ({ 'anim-look': look, 'anim-length': length }[id]) }, Event: class { constructor(type) { this.type = type; } } };
  vm.runInNewContext(`${src}\nthis.apply = applyAnimStatedLookAndLength;`, ctx);
  const first = ctx.apply({ look: 'realistic', seconds: 30 });
  assert.equal(first.look, 'realistic');
  assert.equal(first.note, '');
  assert.equal(look.value, 'realistic');
  assert.equal(length.value, '30');
  assert.deepEqual(events, ['change'], 'the Look buttons repaint');
  const odd = ctx.apply({ look: 'anime', seconds: 20 });
  assert.equal(look.value, 'cartoon');
  assert.equal(length.value, '30', 'not changed to a length the brief did not ask for');
  assert.match(odd.note, /20s/);
});

test('Reels applies the Coach look/length on the legacy path and the project look/length after render', () => {
  const legacy = slice(animate, 'async function applyAnimCoachCreateSessionIfAny', 'window.applyAnimCoachCreateSessionIfAny =');
  assert.match(legacy, /applyAnimStatedLookAndLength\(\{ look: result\.look, seconds: result\.reel_seconds \}\)/);
  const render = slice(animate, 'window.renderAnimationStudio = async function', null, 60000);
  const calls = render.match(/applyAnimStatedLookAndLength\(\{ look: contentProject\.brief\?\.style\?\.preset/g) || [];
  assert.equal(calls.length, 2, 'once on hydration, once after renderCanvas rebuilds the composer');
  assert.match(render, /contentProject\.brief\?\.references/);
  assert.doesNotMatch(render, /\/real\/i\.test\(contentProject/, 'not only realistic');
});

test('portal opens a persisted project by ID, re-checks a restored one, and falls back to the legacy tool handoff', () => {
  const create = slice(portal, 'async function createContentProjectFromCoach', 'async function openContentProjectFromCoach');
  assert.match(create, /projectRequestFor\(action\)/);
  assert.match(create, /request\.method === 'GET'/);
  assert.match(create, /checkLoadedProject/);
  assert.doesNotMatch(create, /submitVideoGeneration|sendPrompt|click\(\)/);
  const open = slice(portal, 'async function openContentProjectFromCoach', 'function openCreateFromCoach');
  assert.match(open, /action\.legacy/);
  assert.match(open, /openCreateFromCoach\(legacy\)/);
  const restore = slice(portal, 'function restoreContentProjectHandoff', 'restoreContentProjectHandoff();');
  assert.match(restore, /\/api\/content-runtime\/projects\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(restore, /status === 404/);
  assert.equal((portal.match(/await openContentProjectFromCoach\(payload\)/g) || []).length, 2, 'live and restored buttons');
});

// ── Design, Storyboard, voiceover-first/outro Reels and the Video-tab Coach open their project by ID ──

const DESIGN_PROJECT = {
  project_id: 'cp_design',
  brief_version: 3,
  capability_id: 'post.create',
  brief: {
    topic: 'Spring Bake Sale',
    format: '4:5 Post',
    full_brief: 'A 4:5 poster for the Spring Bake Sale.\n  Keep the spacing   exactly like this.',
    tool_session: { tool: 'design', mode: 'image', aspect_ratio: '4:5', aspect_explicit: true, attached_image_url: 'https://x.test/still.png', product_name: 'Rye loaf' },
  },
};

test('a Design project opens the Design tool with the persisted brief word for word and its identity', () => {
  const open = handoff.toolSessionForProject({ type: 'create_project', open_in: 'design' }, DESIGN_PROJECT);
  assert.equal(open.nav, 'design-studio');
  assert.equal(open.session.destination, 'design');
  assert.equal(open.session.prompt, DESIGN_PROJECT.brief.full_brief, 'exact, whitespace and all');
  assert.equal(open.session.aspect_ratio, '4:5');
  assert.equal(open.session.aspect_explicit, true);
  assert.equal(open.session.attached_image_url, 'https://x.test/still.png');
  assert.equal(open.session.product_name, 'Rye loaf');
  assert.deepEqual(open.identity, { content_project_id: 'cp_design', content_brief_version: 3 });
  assert.equal(handoff.toolSessionForProject({ open_in: '' }, { ...DESIGN_PROJECT, brief: { full_brief: 'x' } }), null, 'Reels/Video projects are not tool sessions');
});

test('a Storyboard project carries its look and identity into the story builder', () => {
  const board = { project_id: 'cp_board', brief_version: 1, capability_id: 'storyboard.create', brief: { full_brief: 'A storyboard about Maya at the bakery.', style: { preset: 'cartoon' }, tool_session: { tool: 'storyboard', mode: 'video', aspect_ratio: '9:16' } } };
  const open = handoff.toolSessionForProject({ open_in: 'storyboard' }, board);
  assert.equal(open.nav, 'storyboard');
  assert.equal(open.session.look, 'cartoon');
  assert.equal(open.session.mode, 'video');
  const opener = slice(portal, 'function openCreateFromCoach(action, extras)', 'window.applyCoachCreateSessionIfAny =');
  assert.match(opener, /Object\.assign\(session, extras\)/);
  assert.match(opener, /extras\.content_project_id && action && action\.prompt\) session\.prompt = String\(action\.prompt\)/);
  assert.match(opener, /\['cartoon', 'realistic', 'stylized'\]\.includes\(String\(session\.look/);
  assert.match(opener, /__SE_STORY_COACH\.content_project_id = session\.content_project_id/);
  const builder = fs.readFileSync(path.join(__dirname, '..', 'story-builder.js'), 'utf8');
  assert.match(builder, /The full brief stays on project/);
});

test('the portal routes Design/Storyboard projects through the tool, Reels/Video through the project destination', () => {
  const create = slice(portal, 'async function createContentProjectFromCoach', 'async function openContentProjectFromCoach');
  assert.match(create, /toolSessionForProject\(action, project\)/);
  assert.match(create, /openCreateFromCoach\(toolOpen\.session, toolOpen\.identity\)/);
  assert.match(create, /__SE_CONTENT_PROJECT = project/);
  assert.ok(create.indexOf('resetLegacyCreationState') < create.indexOf('openCreateFromCoach(toolOpen'), 'reset first, then the tool session');
});

test('Design never auto-generates a project brief: it waits for Generate', () => {
  const design = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  const apply = slice(design, 'function applyDesignCoachSession()', 'function applyRedesignedSlides');
  const guard = apply.indexOf('if (s.content_project_id)');
  assert.ok(guard > 0);
  assert.ok(guard < apply.indexOf('generate()'), 'the project returns before the auto-generate');
  assert.match(apply, /Review it, then Generate/);
});

test('a voiceover-first Reels project opens on Voiceover with the exact script, outro card and music bed', () => {
  const extras = handoff.reelExtrasForProject({ brief: { entry: 'vo', script: 'We bake before sunrise.\nCome taste it.', full_brief: 'other', outro: { url: 'https://x.test/o.png', asset_id: 'a1' }, music_bed: { url: 'https://x.test/m.mp3' } } });
  assert.equal(extras.entry, 'vo');
  assert.equal(extras.script, 'We bake before sunrise.\nCome taste it.');
  assert.equal(extras.outro_url, 'https://x.test/o.png');
  assert.equal(extras.music_bed_url, 'https://x.test/m.mp3');
  assert.equal(handoff.reelExtrasForProject({ brief: { outro: { url: 'javascript:alert(1)' } } }).outro_url, '', 'https only');
  assert.equal(handoff.reelExtrasForProject({ brief: { full_brief: 'x' } }).entry, 'prompt');
  const render = slice(animate, 'window.renderAnimationStudio = async function', null, 60000);
  assert.match(render, /reelExtras\.entry === 'vo'\s*\? reelExtras\.script/);
  assert.match(render, /writeAnimEntry\(reelExtras\.entry\)/);
  assert.match(render, /_pendingOutroUrl = reelExtras\.outro_url/);
  assert.match(render, /_pendingMusicUrl = reelExtras\.music_bed_url/);
  assert.match(render, /if \(_project && !_project\.id\)/, 'never rewrites a reel already open');
  assert.match(render, /prompt\.value = projectText\(research\)/, 'research keeps the VO script');
});
