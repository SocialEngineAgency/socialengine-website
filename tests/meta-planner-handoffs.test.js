'use strict';

/**
 * Source contracts for Calendar / Home / Insights / Make-this → Create handoffs.
 * Runtime e2e lives in tests/e2e/meta-planner.spec.js.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const portal = fs.readFileSync(path.join(root, 'portal.html'), 'utf8');
const animate = fs.readFileSync(path.join(root, 'animation-studio.js'), 'utf8');
const design = fs.readFileSync(path.join(root, 'claude-studio.js'), 'utf8');
const analytics = fs.readFileSync(path.join(root, 'analytics-cockpit.js'), 'utf8');

function slice(src, start, end, max = 8000) {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `missing ${start}`);
  const j = end ? src.indexOf(end, i + start.length) : i + max;
  return src.slice(i, j > i ? j : i + max);
}

test('openMetaPlannerSlot is the one door for Calendar slots and Home Create this', () => {
  assert.match(portal, /async function openMetaPlannerSlot/);
  assert.match(portal, /window\.openMetaPlannerSlot\s*=\s*openMetaPlannerSlot/);
  assert.match(portal, /await openMetaPlannerSlot\(\{ slot, index: i/);
  assert.match(portal, /window\.openMetaPlannerSlot\(\{ slot, index: idx, week: p\.week_start \}\)/);
});

test('Reel slot → ANIM_STORY_PRESET with story_type + message, then Reels', () => {
  const door = slice(portal, 'async function openMetaPlannerSlot', 'async function _mwpOpenSlot');
  assert.match(door, /slot\.format === 'reel'/);
  assert.match(door, /__SE_ANIM_STORY_PRESET/);
  assert.match(door, /story_type:\s*slot\.story_type \|\| 'auto'/);
  const reelBranch = slice(door, "if (slot.format === 'reel')", 'showToast');
  assert.match(reelBranch, /switchNav\('animation-studio'\)/);
  assert.doesNotMatch(reelBranch, /switchNav\('design-studio'\)/);
  assert.doesNotMatch(reelBranch, /meta-planner\/ideas/);
});

test('Feed slot → parks PENDING_SLOT_IDEAS before opening Post', () => {
  const door = slice(portal, 'async function openMetaPlannerSlot', 'async function _mwpOpenSlot');
  assert.match(door, /__SE_PENDING_SLOT_IDEAS\s*=\s*data/);
  assert.match(door, /switchNav\('design-studio'\)/);
  const paint = slice(design, 'hydrateDesignCoachLog', 'async function generateFromCoach');
  assert.match(paint, /__SE_PENDING_SLOT_IDEAS \|\| window\.__SE_LAST_SLOT_IDEAS/);
  assert.match(design, /function seShowSlotIdeas/);
});

test('Filled slot with post_id opens Content, not Create', () => {
  const door = slice(portal, 'async function openMetaPlannerSlot', 'async function _mwpOpenSlot');
  assert.match(door, /slot\.post_id/);
  assert.match(door, /data-nav="content"/);
});

test('Reels story preset clears the open project and skips auto-resume', () => {
  assert.match(animate, /const fromStoryPreset = !!\(storyPreset && storyPreset\.story_type\)/);
  assert.match(animate, /if \(fromStoryPreset\) \{[\s\S]*?_project = null;[\s\S]*?rememberOpenProject\(''\)/);
  assert.match(animate, /!_project && !fromStoryPreset && !contentProject/);
  assert.match(animate, /lastOpenProjectId\(\)/);
});

test('switchNav(animation-studio) remounts via setCreateSegment like Post', () => {
  const nav = slice(portal, 'window.switchNav = function(nav)', 'window.toggleMobileMenu');
  assert.match(nav, /if \(nav === 'animation-studio'\)/);
  assert.match(nav, /setCreateSegment\('animation-studio'\)/);
  assert.doesNotMatch(
    slice(nav, "if (nav === 'animation-studio')", "if (nav === 'creation-studio'"),
    /\.click\(\)/
  );
});

test('Make this reel from slot ideas always sets story_type so compose stays fresh', () => {
  const make = slice(design, 'async function seMakeSlotIdea', 'window.seShowSlotIdeas');
  assert.match(make, /make\.kind === 'reel'/);
  assert.match(make, /story_type:\s*slot\.story_type \|\| 'auto'/);
  assert.match(make, /switchNav\('animation-studio'\)/);
  assert.match(make, /make\.kind === 'carousel'/);
  assert.match(make, /make\.kind === 'post'/);
  assert.match(make, /make\.kind === 'story'/);
  assert.match(make, /openStoriesComposer/);
});

test('Insights Make reel also forces ANIM_STORY_PRESET', () => {
  const fn = slice(analytics, 'function makeFromIdea', 'async function generateBrief');
  assert.match(fn, /where === 'animate'/);
  assert.match(fn, /__SE_ANIM_STORY_PRESET/);
  assert.match(fn, /story_type:\s*idea\.story_type \|\| 'auto'/);
  assert.match(fn, /destination: 'animate'/);
});

test('Make a Story opens the Stories composer from the planner card', () => {
  assert.match(portal, /data-mwp-story="new"/);
  assert.match(portal, /openStoriesComposer\(\{ date/);
});
