'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'animation-studio.js'), 'utf8');

function fnSlice(startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0, `missing ${startNeedle}`);
  assert.ok(end > start, `missing ${endNeedle} after ${startNeedle}`);
  return src.slice(start, end);
}

test('Send to Claude leaves the home canvas before /brief returns', () => {
  const fn = fnSlice('async function sendPrompt', 'async function acceptBrief');
  const briefAt = fn.indexOf('/brief');
  assert.ok(briefAt > 0, 'sendPrompt must POST /brief');
  const before = fn.slice(0, briefAt);
  assert.match(before, /renderCanvas\(\)/);
  assert.match(before, /_briefing|status:\s*'briefing'/);
});

test('Accept & generate shows a working canvas before approve-brief returns', () => {
  const fn = fnSlice('async function acceptBrief', 'async function approveCharacter');
  const approveAt = fn.indexOf('approve-brief');
  assert.ok(approveAt > 0);
  const before = fn.slice(0, approveAt);
  assert.match(before, /renderCanvas\(\)/);
  assert.match(before, /developing|_briefing|generating/);
  assert.match(before, /hasChar|character/);
  assert.match(before, /generating/);
  assert.doesNotMatch(before, /status: hasChar \? 'developing' : 'failed'/);
});

test('timeline copy does not say accept the brief while briefing, developing, or failed', () => {
  const empty = fnSlice(
    'Claude is writing the shots — stay here.',
    'Shot cards will land on this timeline.'
  );
  assert.match(empty, /failed|p\.error|_briefing/);
  assert.match(empty, /Building the character sheet/);
  const readyAt = empty.indexOf('Ready to generate');
  assert.ok(readyAt > empty.indexOf('failed'), 'failed/briefing copy must come before the accept-the-brief fallback');
});

test('chat shows a working line while Claude writes shots', () => {
  const chat = fnSlice('function renderChat', 'async function ensureProject');
  assert.match(chat, /anim-working/);
  assert.match(chat, /Claude is writing|writing the shots/i);
});
