'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const portal = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
const anim = fs.readFileSync(path.join(__dirname, '..', 'animation-studio.js'), 'utf8');

test('every approve-post call goes through seApprovePost', () => {
  const direct = portal.match(/apiFetch\(`\$\{API\}\/api\/approve-post`/g) || [];
  assert.equal(direct.length, 1, 'only the helper may call /api/approve-post directly');
});

test('seApprovePost retries a RULE_OF_FIVE block with an override reason', () => {
  const helper = portal.slice(portal.indexOf('async function seApprovePost'), portal.indexOf('window.seApprovePost'));
  assert.match(helper, /RULE_OF_FIVE/);
  assert.match(helper, /ruleOfFiveOverride/);
  assert.match(helper, /interactive/);
});

test('bulk approve never prompts and reports held-back posts', () => {
  const bulk = portal.slice(portal.indexOf('window.studioBulkApprove'), portal.indexOf('async function updateSidebarCredits'));
  assert.match(bulk, /interactive:\s*false/);
  assert.match(bulk, /held back by Meta Rule of five/);
});

test('cards show the R5 badge and the modal shows the checklist', () => {
  assert.match(portal, /\$\{seRuleOfFiveBadgeHtml\(post\)\}/);
  assert.match(portal, /\$\{seRuleOfFiveChecklistHtml\(post\)\}/);
});

test('Caption Studio defaults sit above the Reels UI zone and preview matches the bottom-anchored burn', () => {
  assert.match(anim, /CAPTION_SAFE_MAX_Y = 65/);
  assert.doesNotMatch(anim, /y_pct:\s*(7\d|8\d)\b/);
  assert.match(anim, /translate\(-50%, -100%\)/);
  assert.match(anim, /id="anim-safe-zone"/);
  assert.match(anim, /id="anim-cap-safe-warn"/);
});
