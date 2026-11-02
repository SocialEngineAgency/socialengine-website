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
