'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const portal = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
const animate = fs.readFileSync(path.join(__dirname, '..', 'animation-studio.js'), 'utf8');
const design = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');

function slice(source, start, end, length = 8000) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = end ? source.indexOf(end, from + start.length) : -1;
  return source.slice(from, to > from ? to : from + length);
}

test('portal loads the handoff helper before every current creation surface', () => {
  const helper = portal.indexOf('./content-project-handoff.js');
  assert.ok(helper > 0);
  assert.ok(helper < portal.indexOf('./claude-studio.js'));
  assert.ok(helper < portal.indexOf('./animation-studio.js'));
});

test('current and restored Coach action arrays retain create_project actions', () => {
  const restored = slice(portal, 'function coachRestoredActionsHtml', 'function bindRestoredCoachCreateButtons');
  assert.match(restored, /create_project/);
  const live = slice(portal, 'coachActions.map((a, i) =>', "fetchAssetLibrary()");
  assert.match(live, /a\.type === 'create_project'/);
  assert.match(portal, /createContentProjectFromCoach/);
});

test('Coach persists canonical projects with auth and deterministic idempotency, then routes without generating', () => {
  const fn = slice(portal, 'async function createContentProjectFromCoach', 'function openCreateFromCoach');
  // The endpoint and idempotency key come from the handoff helper (load by ID, or create with a stable key).
  const helper = fs.readFileSync(path.join(__dirname, '..', 'content-project-handoff.js'), 'utf8');
  assert.match(helper, /\/api\/content-runtime\/projects/);
  assert.match(helper, /projectIdempotencyKey\(action\)/);
  assert.match(fn, /authHeaders/);
  assert.match(fn, /projectRequestFor/);
  assert.match(fn, /resetLegacyCreationState/);
  assert.match(fn, /destinationForProject/);
  assert.match(fn, /sessionStorage/);
  assert.doesNotMatch(fn, /submitVideoGeneration|generate\(|sendPrompt|click\(\)/);
});

test('research is bound to the canonical project and brief version', () => {
  const fn = slice(portal, 'window.runContentProjectResearch', '// ━━━ Mobile Sidebar');
  assert.match(fn, /\/research/);
  assert.match(fn, /brief_version/);
  assert.match(fn, /project_id/);
  assert.match(fn, /contentProjectResearchSatisfied/);
  assert.match(fn, /authHeaders/);
});

test('Animate blocks stale resume and carries canonical identity into planning', () => {
  const render = slice(animate, 'window.renderAnimationStudio', null, 15000);
  assert.match(render, /activeProjectForDestination/);
  assert.match(render, /_hydratedContentProjectKey/);
  assert.match(render, /rememberOpenProject\(''\)/);
  const send = slice(animate, 'async function sendPrompt', 'async function acceptBrief');
  assert.match(send, /canonical_project_id/);
  assert.match(send, /canonical_brief_version/);
  assert.match(send, /evidence_ids/);
  assert.match(send, /contentProjectResearchSatisfied/);
});

test('Animate requires explicit one-credit approval', () => {
  const accept = slice(animate, 'async function acceptBrief', 'async function approveCharacter');
  assert.match(accept, /approved_credits:\s*1/);
  assert.match(animate, /approve 1 credit/);
});

test('Post and Carousel show the canonical brief and fail closed on required research', () => {
  const render = slice(design, 'function renderClaudeStudio', 'function refreshActionButtons');
  assert.match(render, /contentProjectFor/);
  assert.match(render, /content-project-brief/);
  assert.match(render, /projectPrompt/);
  assert.match(render, /projectBlockReasons/);
  const generate = slice(design, 'async function generate(opts = {})', 'async function');
  assert.match(generate, /contentProjectResearchSatisfied/);
});

test('Video shows and hydrates the canonical brief and fails closed on unsupported constraints', () => {
  const render = slice(portal, 'function renderVideoStudio', 'function openStudioFromRemix', 18000);
  assert.match(render, /contentProjectFor/);
  assert.match(render, /vs-content-project/);
  assert.match(render, /hydrateStudioProject/);
  assert.match(render, /result\.blocked/);
  const submit = slice(portal, 'async function submitVideoGeneration', 'function addGenerationToRecent');
  assert.match(submit, /contentProjectResearchSatisfied/);
  assert.match(submit, /hydrateStudioProject/);
});
