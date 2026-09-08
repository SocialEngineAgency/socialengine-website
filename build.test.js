const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = __dirname;
const BUILD_SCRIPT = path.join(ROOT, 'scripts', 'build-site.js');

// Pages a visitor can land on directly. They are not all linked from somewhere
// (admin.html is reached by URL), so the reference scan below cannot find them.
const ENTRY_PAGES = ['index.html', 'portal.html', 'signup.html', 'admin.html', 'privacy.html', 'terms.html'];

// Tracked files that must never reach the publish directory. server.js is a
// stale copy of the backend and was being served from the live site.
const FORBIDDEN_EXACT = [
  'server.js',
  'README.md',
  'package.json',
  'package-lock.json',
  'playwright.config.js',
  'netlify.toml',
  '.gitignore',
  'bb_playboy_source.jpg', // tracked but referenced by nothing
];
const FORBIDDEN_DIRS = ['scripts', 'tests', 'docs', '.github', '.cursor', 'node_modules'];
const FORBIDDEN_PATTERNS = [/\.test\.js$/, /\.spec\.js$/, /\.md$/, /\.backup/];

const REQUIRED_HEADERS = [
  'X-Frame-Options',
  'X-Content-Type-Options: nosniff',
  'Referrer-Policy',
  'Content-Security-Policy-Report-Only',
];

// Local asset/page references in markup: src="./app.js", href="index.html#faq",
// href="/terms.html", href="/" ... Query strings and fragments are ignored.
// Template placeholders (${...}) and absolute URLs contain characters outside
// the class, so they never match.
const ATTR_REF = /(?:src|href)="(\.?\/?[A-Za-z0-9_./-]+)(?:[?#][^"]*)?"/g;
// Local navigations/fetches from JS: location.href = './x.html', fetch('/y.json') ...
const JS_NAV_REF =
  /(?:location\.href|location\.assign|location\.replace|window\.open|fetch)\(?\s*=?\s*['"](\.?\/?[A-Za-z0-9_./-]+\.(?:html|js|css|json|png|svg|ico|webmanifest))/g;

let built = null;

function buildOnce() {
  if (built) return built;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-dist-'));
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [BUILD_SCRIPT, outDir], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    fs.rmSync(outDir, { recursive: true, force: true });
    throw err;
  }
  built = { outDir, stdout };
  return built;
}

function walk(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

function normalizeRef(ref) {
  let p = ref.replace(/^\.\//, '').replace(/^\//, '');
  if (p === '' || p.endsWith('/')) p += 'index.html';
  return p;
}

function collectLocalRefs(outDir) {
  const refs = new Map(); // normalized path -> first "file: raw" sighting
  for (const rel of walk(outDir)) {
    if (!/\.(html|js)$/.test(rel)) continue;
    const source = fs.readFileSync(path.join(outDir, rel), 'utf8');
    for (const re of [ATTR_REF, JS_NAV_REF]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(source)) !== null) {
        const raw = m[1];
        if (raw.startsWith('//')) continue; // protocol-relative URL, not a local file
        const normalized = normalizeRef(raw);
        if (!refs.has(normalized)) refs.set(normalized, `${rel}: ${raw}`);
      }
    }
  }
  return refs;
}

test.after(() => {
  if (built) fs.rmSync(built.outDir, { recursive: true, force: true });
});

test('build script runs and reports how many files it copied', () => {
  const { stdout } = buildOnce();
  assert.match(stdout, /\d+ files?/i);
});

test('every entry page is published', () => {
  const { outDir } = buildOnce();
  for (const page of ENTRY_PAGES) {
    assert.ok(fs.existsSync(path.join(outDir, page)), `${page} missing from build output`);
  }
});

test('every local file the published pages reference exists in the build output', () => {
  const { outDir } = buildOnce();
  const refs = collectLocalRefs(outDir);
  assert.ok(refs.size > 0, 'reference scan found nothing; regexes are probably broken');
  const missing = [];
  for (const [normalized, seenAt] of refs) {
    if (!fs.existsSync(path.join(outDir, normalized))) missing.push(`${normalized} (from ${seenAt})`);
  }
  assert.deepEqual(missing, [], `referenced but not published:\n  ${missing.join('\n  ')}`);
});

test('forbidden files are not published', () => {
  const { outDir } = buildOnce();
  const files = walk(outDir);
  const leaked = files.filter((rel) => {
    if (FORBIDDEN_EXACT.includes(rel)) return true;
    if (FORBIDDEN_DIRS.some((dir) => rel === dir || rel.startsWith(`${dir}/`))) return true;
    return FORBIDDEN_PATTERNS.some((re) => re.test(rel));
  });
  assert.deepEqual(leaked, [], `must not be published: ${leaked.join(', ')}`);
});

// _headers serves *.js and *.css as `immutable, max-age=31536000`. That is only
// safe when the URL changes with the content, so the build must stamp every
// local JS/CSS reference in the published HTML with a hash of the file it
// points at. Without this, returning visitors kept a year-old app.js.
test('published HTML references local JS/CSS with a content-hash version', () => {
  const { outDir } = buildOnce();
  const crypto = require('node:crypto');
  const problems = [];
  let checked = 0;
  for (const rel of walk(outDir)) {
    if (!rel.endsWith('.html')) continue;
    const html = fs.readFileSync(path.join(outDir, rel), 'utf8');
    const re = /(?:src|href)="(\.?\/?[A-Za-z0-9_./-]+\.(?:js|css))(?:\?([^"#]*))?(?:#[^"]*)?"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      checked++;
      const target = normalizeRef(m[1]);
      const file = path.join(outDir, target);
      if (!fs.existsSync(file)) continue; // covered by the missing-reference test
      const expected = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
      const query = m[2] || '';
      const v = new URLSearchParams(query).get('v');
      if (v !== expected) problems.push(`${rel}: ${m[0]} (expected ?v=${expected})`);
    }
  }
  assert.ok(checked > 0, 'no JS/CSS references found in built HTML; regex is probably broken');
  assert.deepEqual(problems, [], `unversioned or stale asset references:\n  ${problems.join('\n  ')}`);
});

test('source HTML is left untouched by the build (versioning happens only in the output)', () => {
  buildOnce();
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(src, /src="\.\/app\.js"/, 'index.html in the repo must keep the plain reference');
});

test('_headers is published with the security header set and CSP stays report-only', () => {
  const { outDir } = buildOnce();
  const headersPath = path.join(outDir, '_headers');
  assert.ok(fs.existsSync(headersPath), '_headers missing from build output');
  const headers = fs.readFileSync(headersPath, 'utf8');
  for (const header of REQUIRED_HEADERS) {
    assert.ok(headers.includes(header), `_headers is missing ${header}`);
  }
  assert.doesNotMatch(headers, /^\s*Content-Security-Policy:/m, 'CSP must stay Report-Only for now');
  assert.match(headers, /Cache-Control/, 'existing cache rules must be kept');
});
