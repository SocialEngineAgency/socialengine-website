'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const portal = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
const anim = fs.readFileSync(path.join(__dirname, '..', 'animation-studio.js'), 'utf8');

function renderVideoStudioSlice() {
  const start = portal.indexOf('function renderVideoStudio()');
  assert.ok(start >= 0, 'missing renderVideoStudio');
  const end = portal.indexOf('window.renderVideoStudio', start);
  assert.ok(end > start, 'missing window.renderVideoStudio after function');
  return portal.slice(start, end);
}

test('charity Video loads recipes from API catalog, not invented local IDs', () => {
  const vs = renderVideoStudioSlice();
  assert.match(portal, /loadCharityVideoRecipes/);
  assert.match(portal, /\/api\/studio\/charity-video-recipes/);
  assert.match(vs, /isCharityStudio/);
  assert.match(vs, /_charityVideoRecipes/);
  assert.doesNotMatch(vs, /id: 'tv_spot'[\s\S]*isCharityStudio \? charity/);
  // Commerce Boudoir chips must not render on the charity branch
  assert.match(vs, /isCharityStudio \? `/);
  assert.match(portal, /openAnimateFromVideoRecipe/);
});

test('charity recipe select seeds brief + sceneId; explainer opens Animate', () => {
  assert.match(portal, /vsSelectedSceneId/);
  assert.match(portal, /recipe\.brief_scaffold/);
  assert.match(portal, /recipe\.scene_id/);
  assert.match(portal, /path === 'animate'/);
  assert.match(portal, /kind: 'charity_recipe'/);
  assert.match(portal, /style_pack_id/);
  assert.match(portal, /format_template_id/);
  assert.match(portal, /sceneId: vsSelectedSceneId/);
});

test('Animate accepts prompt-only charity recipe handoff with style pack', () => {
  assert.match(anim, /_pendingStylePackId/);
  assert.match(anim, /style_pack_id: _pendingStylePackId/);
  assert.match(anim, /kind === 'charity_recipe'/);
  assert.match(anim, /!s\.referenceUrl && !String\(s\.prompt/);
});

test('charity make-flow copy drops Boudoir chips and uses campaign naming', () => {
  const vs = renderVideoStudioSlice();
  assert.match(vs, /Campaign or story name/);
  // Boudoir string remains only inside the commerce (non-charity) branch
  const charityHint = vs.indexOf('Pick a recipe below');
  assert.ok(charityHint > 0);
  const boudoir = vs.indexOf('Boudoir');
  assert.ok(boudoir > charityHint, 'Boudoir must stay on commerce branch after charity hint');
});
