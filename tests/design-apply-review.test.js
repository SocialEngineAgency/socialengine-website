'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'design-studio-v2.js'), 'utf8');

function load() {
  const context = { console, setTimeout, clearTimeout };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(src, context);
  return context.seDesignStudio;
}

test('result grid uses a real Edit button and Apply review for critic notes', () => {
  assert.match(src, /data-edit="\$\{real\}"/);
  assert.match(src, /data-apply="\$\{real\}"/);
  assert.match(src, /dsv2-btn dsv2-btn--sm/);
  assert.match(src, /Apply review/);
  assert.match(src, /data-prob/);
  assert.match(src, /function applyReview/);
  assert.match(src, /function reviewInstruction/);
  assert.doesNotMatch(src.slice(src.indexOf('function showResult'), src.indexOf('async function applyReview')), /dsv2-link" data-edit/);
});

test('reviewInstruction prefers the Fix line and only the checked notes', () => {
  const { reviewInstruction } = load();
  const critic = {
    score: 3,
    fix: 'Add a blood-draw illustration and enlarge the body text.',
    problems: ['No illustration.', 'Body text under 28px.', 'Funding line missing.'],
    redo_art: true,
  };
  const all = reviewInstruction(critic, [0, 1, 2]);
  assert.match(all, /Add a blood-draw illustration/);
  assert.match(all, /No illustration/);
  assert.match(all, /Funding line missing/);
  assert.match(all, /Replace the picture/);

  const some = reviewInstruction(critic, [1]);
  assert.match(some, /Body text under 28px/);
  assert.doesNotMatch(some, /Funding line missing/);
  assert.match(some, /Replace the picture/);

  const none = reviewInstruction(critic, []);
  assert.match(none, /Add a blood-draw illustration/);
  assert.doesNotMatch(none, /Also address these notes/);
  assert.match(none, /shorten list items|inside its box/i);
});

test('Apply review stays pending until Accept, keeps critic notes, and can Reject', () => {
  assert.match(src, /audit:\s*true/);
  assert.match(src, /pending:\s*true/);
  assert.match(src, /function acceptPending/);
  assert.match(src, /function rejectPending/);
  assert.match(src, /function undoGridSlide/);
  assert.match(src, /data-accept=/);
  assert.match(src, /data-reject=/);
  assert.match(src, /data-undo-grid=/);
  assert.match(src, /audit_failed/);
  assert.match(src, /some review notes remain/);
  assert.match(src, /Kept slide/);
  assert.match(src, /Accept or Reject/);
  assert.match(src, /Notes stay until you Accept/);
});
