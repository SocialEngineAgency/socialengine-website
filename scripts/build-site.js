#!/usr/bin/env node
'use strict';

// Netlify build step: copy ONLY the files below into the publish directory.
//
// Why an allowlist: this site used to be published straight from the repo root,
// so every tracked file was publicly served, including server.js (a stale copy
// of the backend), scripts/, README.md, tests and prompts. Anything a visitor
// should be able to fetch must be listed here explicitly; everything else in
// the repo stays private by default. build.test.js checks that the pages'
// local references are all satisfied by this list and that known-private
// files never appear in the output.
const ALLOWLIST = [
  // Pages
  'index.html',
  'portal.html',
  'signup.html',
  'admin.html',
  'privacy.html',
  'terms.html',
  // Styles (shared by index, portal, signup)
  'base.css',
  'style.css',
  // Scripts
  'app.js', // index.html
  'portal-native-oauth.js', // portal.html
  'analytics-cockpit.js', // portal.html
  'animation-studio.js', // portal.html
  'claude-studio.js', // portal.html
  // Netlify headers (caching + security)
  '_headers',
];

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const outDir = path.resolve(ROOT, process.argv[2] || 'dist');

// Refuse to wipe the repo itself or anything above it.
const rel = path.relative(outDir, ROOT);
const outContainsRepo = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
if (outContainsRepo) {
  console.error(`build-site: refusing to use ${outDir} as the output directory (it contains the repo)`);
  process.exit(1);
}

const missing = ALLOWLIST.filter((file) => !fs.existsSync(path.join(ROOT, file)));
if (missing.length) {
  console.error(`build-site: allowlisted file(s) missing from the repo:\n  ${missing.join('\n  ')}`);
  console.error('Either restore the file or remove it from ALLOWLIST in scripts/build-site.js.');
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const file of ALLOWLIST) {
  const dest = path.join(outDir, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(ROOT, file), dest);
}

console.log(`build-site: copied ${ALLOWLIST.length} files to ${outDir}`);
