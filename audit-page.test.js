const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audit = require('./audit.js');

// ---- a small fake DOM: enough for audit.js to build a tree we can inspect ----
class FakeNode {
  constructor(tag, text) {
    this.tag = tag;
    this.text = text;
    this.attrs = {};
    this.children = [];
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  get firstChild() { return this.children[0] || null; }
  set innerHTML(_) { throw new Error('audit.js must never set innerHTML'); }
  // All text under this node, concatenated with spaces.
  get allText() {
    if (this.tag === '#text') return this.text;
    return this.children.map((c) => c.allText).join(' ');
  }
  find(pred, out = []) {
    if (pred(this)) out.push(this);
    this.children.forEach((c) => c.find && c.find(pred, out));
    return out;
  }
}
const fakeDoc = {
  createElement: (tag) => new FakeNode(tag),
  createElementNS: (_ns, tag) => new FakeNode(tag),
  createTextNode: (t) => new FakeNode('#text', String(t)),
};

function render(report) {
  const root = new FakeNode('main');
  const normalized = audit.renderReport(fakeDoc, root, report);
  return { root, normalized, text: root.allText };
}

const SAMPLE = {
  brand: { name: 'Yourstore', website: 'https://yourstore.com' },
  score: 62,
  score_parts: [{ label: 'Photos', value: 8 }, { label: 'Catalog', value: 7 }],
  headline: 'Your store is ready to post. Your feed is not.',
  summary: 'yourstore.com has 84 products. Instagram has not been posted to in 5 weeks.',
  fix_first: [{ title: 'Post 3 times a week', detail: 'Your last post was 5 weeks ago.' }],
  push_first: [
    { title: 'Linen maxi skirt', price: '$68', image_url: 'https://cdn.example.com/a.jpg', url: 'https://yourstore.com/p/skirt', reasons: ['New this month', '6 photos'] },
    { title: 'Velvet blazer', price: '$129', image_url: null, url: null, reasons: [] },
  ],
  sample_posts: [
    { platform: 'instagram', label: 'Instagram post', text: 'The linen maxi skirt just landed.', image_url: null, product_title: 'Linen maxi skirt' },
    { platform: 'tiktok', label: 'TikTok hook', text: 'One blazer, three outfits.', image_url: null, product_title: 'Velvet blazer' },
    { platform: 'instagram', label: 'Sale carousel', text: 'Five pieces now marked down.', image_url: null, product_title: 'Gold hoops' },
  ],
  plan_30: [{ week: 1, theme: 'Fresh arrivals', slots: [{ day: 'Mon', format: 'Instagram post' }, { day: 'Wed', format: 'TikTok' }] }],
  best_times: { instagram: '6 PM', tiktok: null },
  themes: ['styling', 'new arrivals'],
  competitors: [
    { name: 'Competitor one', instagram: '18.4K', tiktok: null, posting: null, site_url: 'https://competitor.example', site_title: 'C1' },
    { name: 'Competitor two', instagram: null, tiktok: '6.2K', posting: null, site_url: null, site_title: null },
  ],
  sources: ['https://yourstore.com', 'http://insecure.example'],
  portal: { created: true },
};

test('renders every section of a full report from text nodes', () => {
  const { text } = render(SAMPLE);
  for (const expected of [
    'Your store is ready to post. Your feed is not.', 'Social readiness', 'Photos 8, Catalog 7 (out of 10)',
    'Fix these first', 'Post 3 times a week', 'Post these products first', 'Linen maxi skirt', '$68', 'New this month',
    'Three posts, already written', 'The linen maxi skirt just landed.', 'Your first 30 days', 'Week 1', 'Fresh arrivals',
    'Best times: Instagram 6 PM', 'Themes: styling, new arrivals', 'Where competitors stand', 'Competitor one',
    'Your preview portal is ready', 'Open my portal', 'See plans', 'Sources:',
  ]) assert.ok(text.includes(expected), `missing: ${expected}`);
});

test('score ring offset follows the score', () => {
  assert.equal(audit.ringOffset(62), 114.6);
  assert.equal(audit.ringOffset(0), 301.6);
  assert.equal(audit.ringOffset(100), 0);
  assert.equal(audit.clampScore(140), 100);
  assert.equal(audit.clampScore('x'), null);
});

test('sections with no items are not drawn, headings included', () => {
  const { text } = render({ headline: 'Short report', score: 40 });
  assert.ok(text.includes('Short report'));
  for (const heading of ['Fix these first', 'Post these products first', 'already written', 'first 30 days', 'When to post', 'competitors stand', 'Sources:']) {
    assert.ok(!text.includes(heading), `should be hidden: ${heading}`);
  }
});

test('no score means no score card', () => {
  const { text } = render({ headline: 'No score yet' });
  assert.ok(!text.includes('Social readiness'));
});

test('null competitor numbers read Not available and the Posting column is hidden when empty', () => {
  const { text } = render(SAMPLE);
  assert.ok(text.includes('Not available'));
  assert.ok(!text.includes('Posting'), 'Posting column should be hidden when no competitor has it');
  const withPosting = render({ ...SAMPLE, competitors: [{ name: 'A', instagram: '1K', tiktok: null, posting: '3 a week' }] });
  assert.ok(withPosting.text.includes('Posting'));
  assert.ok(withPosting.text.includes('3 a week'));
});

test('images and links are used only when they start with https://', () => {
  const { root } = render({
    ...SAMPLE,
    push_first: [
      { title: 'Good', image_url: 'https://cdn.example.com/a.jpg', url: 'https://shop.example/p', reasons: [] },
      { title: 'Plain http', image_url: 'http://cdn.example.com/b.jpg', url: 'http://shop.example/p', reasons: [] },
      { title: 'Script', image_url: 'javascript:alert(1)', url: 'javascript:alert(1)', reasons: [] },
      { title: 'Data', image_url: 'data:image/png;base64,AAAA', url: null, reasons: [] },
    ],
    sample_posts: [{ label: 'Post', text: 'hi', image_url: 'http://x.example/y.jpg', product_title: 'P' }],
    competitors: [{ name: 'C', instagram: '1', site_url: 'javascript:alert(1)' }],
  });
  const imgs = root.find((n) => n.tag === 'img').map((n) => n.attrs.src);
  assert.deepEqual(imgs, ['https://cdn.example.com/a.jpg']);
  const hrefs = root.find((n) => n.attrs && n.attrs.href).map((n) => n.attrs.href);
  assert.ok(hrefs.every((h) => h.startsWith('https://') || h.startsWith('/')), `unsafe href in ${hrefs}`);
});

test('API text is never interpreted as markup', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const { root, text } = render({ ...SAMPLE, headline: evil, fix_first: [{ title: evil, detail: evil }] });
  assert.ok(text.includes(evil), 'text shows literally');
  assert.equal(root.find((n) => n.tag === 'img' && n.attrs.onerror).length, 0);
});

test('final card follows report.portal.created', () => {
  const made = render({ ...SAMPLE, portal: { created: true } });
  assert.ok(made.text.includes('Your preview portal is ready'));
  assert.deepEqual(made.root.find((n) => n.attrs && n.attrs.href === '/portal.html').length, 1);

  const notMade = render({ ...SAMPLE, portal: { created: false } });
  assert.ok(!notMade.text.includes('Your preview portal is ready'));
  assert.ok(!notMade.text.includes('waiting in your preview portal'));
  assert.ok(notMade.text.includes('Create your free preview'));
  assert.equal(notMade.root.find((n) => n.attrs && n.attrs.href === '/#ai-audit').length, 1);
  assert.equal(notMade.root.find((n) => n.attrs && n.attrs.href === '/portal.html').length, 0);
  assert.equal(notMade.root.find((n) => n.attrs && n.attrs.href === '/#pricing').length, 1);
});

// ---- loading and polling ----
function makeDeps(responses, { stashed, startNow = 0 } = {}) {
  let t = startNow;
  const calls = [];
  const events = [];
  const queue = responses.slice();
  return {
    calls, events,
    deps: {
      id: 'abc123def456',
      storage: { getItem: (k) => { calls.push(['storage', k]); return stashed || null; } },
      fetch: async (url) => {
        calls.push(['fetch', url]);
        const next = queue.length > 1 ? queue.shift() : queue[0];
        if (next === 'throw') throw new Error('offline');
        return { status: next.status || 200, ok: (next.status || 200) < 400, json: async () => next.body };
      },
      sleep: async (ms) => { t += ms; },
      now: () => t,
      ui: ['report', 'pending', 'timeout', 'failed', 'notFound'].reduce((o, k) => { o[k] = (...a) => events.push([k, ...a]); return o; }, {}),
    },
  };
}

test('uses the stashed report without calling the API', async () => {
  const { deps, calls, events } = makeDeps([], { stashed: JSON.stringify({ headline: 'Instant' }) });
  assert.equal(await audit.loadAudit(deps), 'done');
  assert.equal(calls.filter((c) => c[0] === 'fetch').length, 0);
  assert.deepEqual(events, [['report', { headline: 'Instant' }]]);
});

test('polls a pending report every 5s until it is done', async () => {
  const { deps, calls, events } = makeDeps([
    { body: { status: 'pending' } }, { body: { status: 'pending' } }, { body: { status: 'done', report: { headline: 'Ready' } } },
  ]);
  assert.equal(await audit.loadAudit(deps), 'done');
  assert.equal(calls.filter((c) => c[0] === 'fetch').length, 3);
  assert.ok(calls.find((c) => c[0] === 'fetch')[1].endsWith('/api/audit/report/abc123def456'));
  assert.deepEqual(events.map((e) => e[0]), ['pending', 'report']);
});

test('gives up after 5 minutes and says it will email', async () => {
  const { deps, calls, events } = makeDeps([{ body: { status: 'pending' } }]);
  assert.equal(await audit.loadAudit(deps), 'timeout');
  assert.deepEqual(events.map((e) => e[0]), ['pending', 'timeout']);
  const fetches = calls.filter((c) => c[0] === 'fetch').length;
  assert.equal(fetches, audit.POLL_MAX_MS / audit.POLL_INTERVAL_MS + 1);
});

test('a failed report shows the failure state; 404 shows not found', async () => {
  const failed = makeDeps([{ body: { status: 'failed' } }]);
  assert.equal(await audit.loadAudit(failed.deps), 'failed');
  assert.deepEqual(failed.events, [['failed']]);
  const missing = makeDeps([{ status: 404, body: { error: 'Not found' } }]);
  assert.equal(await audit.loadAudit(missing.deps), 'notFound');
  const badId = makeDeps([]);
  badId.deps.id = '../x';
  assert.equal(await audit.loadAudit(badId.deps), 'notFound');
});

test('a network blip while polling does not end the wait', async () => {
  const { deps, events } = makeDeps(['throw', { body: { status: 'done', report: { headline: 'Back' } } }]);
  assert.equal(await audit.loadAudit(deps), 'done');
  assert.deepEqual(events.map((e) => e[0]), ['pending', 'report']);
});

test('audit.html is noindex and loads the chrome styles and audit.js', () => {
  const html = fs.readFileSync(path.join(__dirname, 'audit.html'), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /src="\.\/audit\.js"/);
  assert.match(html, /href="\.\/chrome\.css"/);
});

test('audit.js never writes API data with innerHTML', () => {
  const src = fs.readFileSync(path.join(__dirname, 'audit.js'), 'utf8');
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test('a site with no catalog (empty push_first) gets no product or store wording from the page itself', () => {
  const { text } = render({
    brand: { name: 'Hope Charity', website: 'https://hope.example' },
    score: 55,
    headline: 'Your cause is clear. Your feed is quiet.',
    summary: 'hope.example tells a strong story. Instagram has not been posted to in 3 weeks.',
    fix_first: [{ title: 'Share one story a week', detail: 'Stories from the people you help.' }],
    push_first: [],
    sample_posts: [{ platform: 'instagram', label: 'Awareness day post', text: 'Join us this Friday.', image_url: null, product_title: '' }],
    plan_30: [{ week: 1, theme: 'Spring appeal', slots: [{ day: 'Mon', format: 'Instagram post' }] }],
    portal: { created: false },
  });
  assert.ok(!text.includes('Post these products first'));
  assert.doesNotMatch(text, /product|store|catalog/i);
});
