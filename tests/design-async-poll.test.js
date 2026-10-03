'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Design Studio polls async design jobs and allows leaving the tab', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  assert.match(src, /CS_LEAVE_BUSY/);
  assert.match(src, /You can leave Design Studio/);
  assert.doesNotMatch(src, /keep this tab open/);
  assert.match(src, /async function awaitDesignJob/);
  assert.match(src, /\/api\/studio\/design-job\//);
  assert.match(src, /data\.async && data\.job_id/);
  assert.match(src, /resumeDesignJobIfAny/);
  assert.match(src, /Poster ready in Design Studio/);
  assert.match(src, /se-design-job:/);
});
