'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Design Studio polls async design jobs and allows leaving the tab', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  assert.match(src, /CS_LEAVE_BUSY/);
  assert.match(src, /you can leave/i);
  assert.doesNotMatch(src, /keep this tab open/);
  assert.match(src, /async function awaitDesignJob/);
  assert.match(src, /\/api\/studio\/design-job\//);
  assert.match(src, /data\.async && data\.job_id/);
  assert.match(src, /resumeDesignJobIfAny/);
  assert.match(src, /Poster ready in Design Studio/);
  assert.match(src, /se-design-job:/);
});

test('leave-tab status copy never becomes the white Generate button label', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  const setBusy = src.slice(src.indexOf('function setBusy'), src.indexOf('function restoreBusyUiIfGenerating'));
  assert.match(setBusy, /msg !== CS_LEAVE_BUSY/);
  assert.match(setBusy, /Generating…/);
  assert.doesNotMatch(setBusy, /gen\.textContent = busy \? \(msg/);
});
