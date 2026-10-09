'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const portal = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
const anim = fs.readFileSync(path.join(__dirname, '..', 'animation-studio.js'), 'utf8');

test('Animate composer has a story type picker with Let AI pick and the nine Meta types', () => {
  assert.match(anim, /id="anim-story-type"/);
  assert.match(anim, /value="auto"[^>]*>Let AI pick/);
  for (const id of ['tutorial', 'qa', 'listicle', 'pov', 'types_of', 'bts', 'town_hall', 'before_after', 'facts_list']) {
    assert.match(anim, new RegExp(`id: '${id}'`), id);
  }
});

test('Write shots requires a story type unless the send is automatic', () => {
  const send = anim.slice(anim.indexOf('async function sendPrompt'), anim.indexOf('async function sendPrompt') + 2000);
  assert.match(send, /opts\.auto === true/);
  assert.match(send, /Pick a story type/);
  assert.match(anim, /story_brief: animStoryBriefFromDraft\(\)/);
  assert.match(anim, /sendPrompt\(\{ auto: true \}\)/);
});

test('canvas shows an editable arc that saves to the story-brief endpoint', () => {
  assert.match(anim, /\$\{renderStoryArcSection\(p\)\}/);
  assert.match(anim, /bindStoryArcSection\(el\)/);
  assert.match(anim, /\/story-brief`/);
  for (const k of ['hook', 'middle', 'payoff', 'cta']) assert.match(anim, new RegExp(`row\\('${k}'`));
});

test('brand worksheet card mounts on the Brand settings tab and saves to the API', () => {
  assert.match(portal, /mountBrandWorksheet\(panel\)/);
  assert.match(portal, /\/api\/brand-worksheet`/);
  assert.match(portal, /data-bw-list="\$\{key\}"/);
  assert.match(portal, /id="se-bw-formality"/);
});
