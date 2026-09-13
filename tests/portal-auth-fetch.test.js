'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');

// After session-token auth, these Content Review writes must go through apiFetch
// (Bearer). A bare fetch({ body: { clientEmail } }) is 401 Unauthorized.
const SESSION_ROUTES = [
  '/api/approve-post',
  '/api/reject-post',
  '/api/edit-caption',
  '/api/regenerate-post-v2',
];

for (const route of SESSION_ROUTES) {
  test(`portal uses apiFetch for ${route}`, () => {
    const bare = src.includes(`fetch(\`\${API}${route}\``);
    assert.equal(bare, false, `${route} still uses fetch() without the session`);
    assert.ok(src.includes(`apiFetch(\`\${API}${route}\``), `${route} should use apiFetch`);
  });
}
