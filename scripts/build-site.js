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
  'deletion-status.html',
  // Styles (shared by index, portal, signup)
  'base.css',
  'style.css',
  // Self-hosted fonts (portal.html). Filenames are content-hashed; see fonts.css.
  'fonts.css',
  'fonts/inter-latin-400-700-c9407645.woff2',
  'fonts/inter-latin-ext-400-700-a28eb6d3.woff2',
  'fonts/plus-jakarta-sans-latin-400-800-cd8db90c.woff2',
  'fonts/plus-jakarta-sans-latin-ext-400-800-0303e02b.woff2',
  // Scripts
  'app.js', // index.html
  'portal-native-oauth.js', // portal.html
  'portal-assets.js', // portal.html
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

// _headers serves *.js / *.css as `immutable, max-age=31536000`. A browser will
// not re-check an immutable URL for a year, so the URL has to change whenever
// the content does. Stamp every local JS/CSS reference in the published HTML
// with ?v=<sha256 prefix of the file>. Source files in the repo are not touched.
const crypto = require('node:crypto');
const hashCache = new Map();
function contentHash(file) {
  if (!hashCache.has(file)) {
    hashCache.set(file, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex').slice(0, 10));
  }
  return hashCache.get(file);
}
const ASSET_REF = /((?:src|href)=")(\.?\/?)([A-Za-z0-9_./-]+\.(?:js|css))(?:\?[^"#]*)?(#[^"]*)?"/g;
function versionAssetRefs(html) {
  let stamped = 0;
  const out = html.replace(ASSET_REF, (whole, attr, prefix, file, hash = '') => {
    const rel = file.replace(/^\//, '');
    if (!ALLOWLIST.includes(rel)) return whole; // not ours (or not published) — leave it
    stamped++;
    return `${attr}${prefix}${file}?v=${contentHash(rel)}${hash}"`;
  });
  return { out, stamped };
}

let stampedTotal = 0;
for (const file of ALLOWLIST) {
  const dest = path.join(outDir, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (file.endsWith('.html')) {
    const { out, stamped } = versionAssetRefs(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    fs.writeFileSync(dest, out);
    stampedTotal += stamped;
  } else {
    fs.copyFileSync(path.join(ROOT, file), dest);
  }
}

console.log(`build-site: copied ${ALLOWLIST.length} files to ${outDir} (${stampedTotal} asset references versioned)`);
