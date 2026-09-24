'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Content Review modal edits a pinned comment per platform', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  assert.match(src, /Pinned comment/);
  assert.match(src, /post-pinned-comment/);
  assert.match(src, /data-platform="\$\{p\}"/);
  assert.match(src, /'instagram', 'facebook', 'tiktok'/);
  assert.match(src, /\/api\/edit-pinned-comments/);
  assert.match(src, /apiFetch\(`\$\{API\}\/api\/edit-pinned-comments`/);
  assert.doesNotMatch(src, /data-platform="linkedin"/);
  assert.match(src, /Pin this comment/);
});
