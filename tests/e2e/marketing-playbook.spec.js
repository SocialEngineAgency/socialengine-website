// Marketing playbook: customer journey (Settings → Brand), copy check, question log,
// lead magnet builder, Insights verdicts. Hermetic — mocked API.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, CHARITY_CAPS } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const STAGES = {
  commerce: [
    { id: 'content', label: 'Content', goal: 'Get seen.' },
    { id: 'lead_magnet', label: 'Free offer', goal: 'Swap something useful for an email.', examples: ['10% off your first order'] },
    { id: 'first_step', label: 'First order', goal: 'Small and easy.', examples: ['Starter set'] },
    { id: 'core', label: 'Main product', goal: 'What you sell.', examples: ['Hero product'] },
    { id: 'maximizer', label: 'Repeat and upsell', goal: 'Regulars.', examples: ['Bundles'] },
  ],
  charity: [
    { id: 'content', label: 'Content', goal: 'Help first.' },
    { id: 'lead_magnet', label: 'Free resource', goal: 'Real help for an email.', examples: ['Support guide'] },
    { id: 'first_step', label: 'First action', goal: 'A small yes.', examples: ['Share this post'] },
    { id: 'core', label: 'Regular giving', goal: 'Keeps the work going.', examples: ['Monthly gift'] },
    { id: 'maximizer', label: 'Deeper commitment', goal: 'More than money.', examples: ['Fundraise for us'] },
  ],
  service: [
    { id: 'content', label: 'Content', goal: 'Answer questions.' },
    { id: 'lead_magnet', label: 'Free resource', goal: 'Useful for an email.', examples: ['Price guide'] },
    { id: 'first_step', label: 'First booking', goal: 'Easy first appointment.', examples: ['Free quote'] },
    { id: 'core', label: 'Main service', goal: 'Paid work.', examples: ['Core service'] },
    { id: 'maximizer', label: 'Ongoing plan', goal: 'Come back.', examples: ['Maintenance plan'] },
  ],
};
const KINDS = [{ id: 'commerce', label: 'Online shop' }, { id: 'charity', label: 'Charity' }, { id: 'service', label: 'Local or service business' }];

function funnelPayload(kind, funnel, override = '') {
  return {
    kind, kind_label: KINDS.find((k) => k.id === kind).label, kind_override: override, detected_kind: 'charity',
    kinds: KINDS, stages: STAGES[kind], stages_by_kind: STAGES,
    funnel: funnel || { stages: {}, default_next_step: '' },
    next_step: 'Point people to one helpful action: learn more, get support, or share. Link in bio.',
  };
}

test('Customer journey: charity labels, switching kind relabels, Draft fills empty steps, Save sends stages and kind', async ({ page }) => {
  const puts = [];
  await mockApi(page, srv.base, {
    data: clientData({ capabilities: CHARITY_CAPS }),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/marketing/funnel' && entry.method === 'GET') { json(200, funnelPayload('charity')); return 'handled'; }
      if (entry.path === '/api/marketing/funnel/suggest') {
        json(200, { ...funnelPayload('charity'), draft: true, funnel: { stages: { lead_magnet: { title: 'Signs worth knowing checklist', url: '', note: 'suggested, confirm' }, core: { title: 'Monthly gift', url: 'https://x.org/give', note: '' } }, default_next_step: 'lead_magnet' } });
        return 'handled';
      }
      if (entry.path === '/api/marketing/funnel' && entry.method === 'PUT') {
        const body = JSON.parse(entry.body || '{}');
        puts.push(body);
        json(200, { success: true, ...funnelPayload(body.kind || 'charity', body.funnel, body.kind), next_step: 'end with one clear call to action for "Signs worth knowing checklist"' });
        return 'handled';
      }
      if (entry.path === '/api/marketing/lead-magnets' && entry.method === 'GET') {
        json(200, { kind: 'charity', formats: [], items: [{ id: 'lm_abc123', title: 'Questions to ask your doctor', promise: 'Walk in prepared.' }] });
        return 'handled';
      }
      return undefined;
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="settings"]');
  await page.click('.settings-tab[data-settings-tab="brand"]');
  const fn = page.locator('#se-funnel');
  await expect(fn).toContainText('Customer journey');
  await expect(fn.locator('[data-fn-stage="core"] .se-fn__name')).toHaveText('Regular giving');
  await expect(page.locator('#se-fn-kind')).toHaveValue('');
  await expect(fn).toContainText('Questions to ask your doctor');

  await page.selectOption('#se-fn-kind', 'commerce');
  await expect(fn.locator('[data-fn-stage="core"] .se-fn__name')).toHaveText('Main product');
  await page.selectOption('#se-fn-kind', '');
  await expect(fn.locator('[data-fn-stage="core"] .se-fn__name')).toHaveText('Regular giving');

  await fn.locator('[data-fn-stage="first_step"] [data-fn="title"]').fill('Share with one friend');
  await page.click('#se-fn-suggest');
  await expect(fn.locator('[data-fn-stage="lead_magnet"] [data-fn="title"]')).toHaveValue('Signs worth knowing checklist');
  await expect(fn.locator('[data-fn-stage="first_step"] [data-fn="title"]')).toHaveValue('Share with one friend');

  await page.click('#se-fn-save');
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0].kind).toBe('');
  expect(puts[0].funnel.stages.lead_magnet.title).toBe('Signs worth knowing checklist');
  expect(puts[0].funnel.stages.core.url).toBe('https://x.org/give');
  expect(puts[0].funnel.default_next_step).toBe('lead_magnet');
  await expect(page.locator('#se-fn-next')).toContainText('Signs worth knowing checklist');
});

test('Check copy on a Content Review caption: shows checks, applies the stronger first line', async ({ page }) => {
  const checks = [];
  const edits = [];
  const data = clientData({ content: [{ id: 'recP1', status: 'Ready for Review', platform: 'instagram', full_post_text: 'Hey everyone! New stuff \u2014 today.\n\nShop now.' }] });
  await mockApi(page, srv.base, {
    data,
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/marketing/copy-check') {
        checks.push(JSON.parse(entry.body || '{}'));
        json(200, {
          kind: 'commerce', verdict: 'fix', score: 55, ai_error: '', better_hook: '3 ways to wear the new linen shirt',
          checks: [
            { id: 'hook', label: 'First line stops the scroll', status: 'fail', note: '"Hey everyone!" is a generic opener.' },
            { id: 'next_step', label: 'Ends with one clear next step', status: 'pass', note: '' },
            { id: 'em_dash', label: 'No em dashes', status: 'warn', note: '1 em dash.' },
            { id: 'ai_facts', label: 'No invented facts', status: 'fail', note: 'Check the claim.', unsupported: ['Sold out twice'] },
          ],
        });
        return 'handled';
      }
      if (entry.path === '/api/edit-caption') { edits.push(JSON.parse(entry.body || '{}')); json(200, { success: true }); return 'handled'; }
      return undefined;
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="content"]');
  await page.click('.studio-card[data-post-id="recP1"] .studio-card__caption');
  const ta = page.locator('.post-caption-edit[data-post-id="recP1"]');
  await expect(ta).toBeVisible();
  await page.locator('.mp-ck-btn').first().click();
  await expect(page.locator('#mp-ck-verdict')).toHaveText('Fix before posting');
  await expect(page.locator('.mp-modal')).toContainText('Not backed by your source: Sold out twice');
  expect(checks[0].text).toContain('Hey everyone!');
  await page.click('#mp-ck-use-hook');
  await expect(ta).toHaveValue(/^3 ways to wear the new linen shirt\n/);
  await expect.poll(() => edits.length, { timeout: 5000 }).toBeGreaterThan(0);
  expect(edits[edits.length - 1].caption).toContain('3 ways to wear the new linen shirt');
});

test('Check copy → Fix it for me: sends the failed checks, shows official sources, applies the fixed caption', async ({ page }) => {
  const fixes = [];
  const data = clientData({ content: [{ id: 'recP2', status: 'Ready for Review', platform: 'instagram', full_post_text: 'Hot tea raises cancer risk by 90%!!! Comment YES' }] });
  await mockApi(page, srv.base, {
    data,
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/marketing/copy-check') {
        json(200, {
          kind: 'charity', verdict: 'fix', score: 60, ai_error: '', better_hook: '',
          checks: [
            { id: 'hook', label: 'First line stops the scroll', status: 'pass', note: '' },
            { id: 'ai_facts', label: 'No invented facts', status: 'fail', note: 'Check the 90% figure.', unsupported: ['90%'] },
          ],
        });
        return 'handled';
      }
      if (entry.path === '/api/marketing/copy-check/fix') {
        fixes.push(JSON.parse(entry.body || '{}'));
        json(200, {
          text: 'Very hot drinks are a probable cause of oesophageal cancer (Source: WHO). Learn the signs, link in bio. #oesophagealcancer',
          changes: ['Replaced the 90% claim with the WHO classification'],
          sources: [{ title: 'Cancer Research UK: hot drinks', url: 'https://news.cancerresearchuk.org/x' }],
          score_before: 70, score: 95,
          used: { platform_guidance: true, best_posts: false, official_search: true, country: 'GB' },
        });
        return 'handled';
      }
      if (entry.path === '/api/edit-caption') { json(200, { success: true }); return 'handled'; }
      return undefined;
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="content"]');
  await page.click('.studio-card[data-post-id="recP2"] .studio-card__caption');
  const ta = page.locator('.post-caption-edit[data-post-id="recP2"]');
  await page.locator('.mp-ck-btn').first().click();
  await page.click('#mp-ck-fix');
  await expect(page.locator('#mp-ck-sources a')).toHaveAttribute('href', 'https://news.cancerresearchuk.org/x');
  await expect(page.locator('.mp-modal')).toContainText('score 70 → 95');
  await expect(page.locator('.mp-modal')).toContainText('Based on platform guidance, official sources.');
  expect(fixes[0].issues).toEqual([{ label: 'No invented facts', note: 'Check the 90% figure.', unsupported: ['90%'] }]);
  expect(fixes[0].text).toContain('Hot tea');
  await page.click('#mp-ck-use-fix');
  await expect(ta).toHaveValue(/^Very hot drinks are a probable cause/);
});

test('What customers ask: reads inbox items, shows themes, builds a free resource from one', async ({ page }) => {
  const refresh = [];
  const generated = [];
  const saved = [];
  const items = [
    { id: 'c1', type: 'comment', platform: 'instagram', username: 'ana', text: 'Do you ship to Ireland?', timestamp: new Date().toISOString(), has_reply: false },
    { id: 'c2', type: 'comment', platform: 'instagram', username: 'us', text: 'Yes we do!', timestamp: new Date().toISOString(), has_reply: true, is_from_us: true },
  ];
  await mockApi(page, srv.base, {
    data: clientData(),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/inbox' && entry.method === 'GET') { json(200, { connected: true, total: 2, unreplied: 1, items, source: 'meta', auto_reply_mode: 'draft' }); return 'handled'; }
      if (entry.path === '/api/inbox/canned-responses') { json(200, { canned: [] }); return 'handled'; }
      if (entry.path === '/api/marketing/questions' && entry.method === 'GET') { json(200, { kind: 'commerce', generated_at: null, message_count: 0, themes: [] }); return 'handled'; }
      if (entry.path === '/api/marketing/questions/refresh') {
        refresh.push(JSON.parse(entry.body || '{}'));
        json(200, { kind: 'commerce', generated_at: '2026-10-10T10:00:00Z', message_count: 12, themes: [{ theme: 'Shipping', question: 'Do you deliver to Ireland?', count: 5, examples: ['Do you ship to Ireland?'], content_idea: 'Reel: where we ship and how long it takes', lead_magnet_idea: 'Shipping and returns guide' }] });
        return 'handled';
      }
      if (entry.path === '/api/marketing/lead-magnets' && entry.method === 'GET') {
        json(200, { kind: 'commerce', items: [], formats: [{ id: 'checklist', label: 'Checklist', hint: 'One page.' }, { id: 'buying_guide', label: 'Buying guide', hint: 'Choose well.' }] });
        return 'handled';
      }
      if (entry.path === '/api/marketing/lead-magnets/generate') {
        generated.push(JSON.parse(entry.body || '{}'));
        json(200, { kind: 'commerce', magnet: { title: 'Shipping and returns, simply', subtitle: '', format: 'buying_guide', promise: 'Know exactly when it arrives.', sections: [{ heading: 'Where we ship', body: 'We ship to [ADD: countries].', items: [] }], optin: { headline: 'Get the guide', subhead: 'Free', bullets: ['Delivery times'], button: 'Send it to me' }, delivery_email: { subject: 'Your guide', body: 'Here it is.' }, next_step: 'Grab 10% off your first order.', sources_needed: ['Countries you ship to'], topic: 'Shipping and returns guide' } });
        return 'handled';
      }
      if (entry.path === '/api/marketing/lead-magnets' && entry.method === 'POST') {
        const body = JSON.parse(entry.body || '{}');
        saved.push(body);
        json(200, { success: true, item: { ...body.magnet, id: 'lm_new12345' }, items: [] });
        return 'handled';
      }
      return undefined;
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="inbox"]');
  await expect(page.locator('.inbox-item').first()).toBeVisible({ timeout: 15000 });
  await page.click('#inbox-questions-btn');
  await expect(page.locator('.mp-modal')).toContainText('Not read yet.');
  await page.click('#mp-q-run');
  await expect(page.locator('.mp-theme')).toContainText('Do you deliver to Ireland?');
  await expect(page.locator('.mp-theme')).toContainText('asked 5×');
  expect(refresh[0].items).toHaveLength(2);
  expect(refresh[0].items[1].is_from_us).toBe(true);

  await page.click('[data-q-magnet="0"]');
  await expect(page.locator('#mp-lm-topic')).toHaveValue('Shipping and returns guide');
  await page.selectOption('#mp-lm-format', 'buying_guide');
  await page.click('#mp-lm-go');
  await expect(page.locator('#mp-lm-preview')).toContainText('Shipping and returns, simply');
  await expect(page.locator('#mp-lm-preview .mp-add')).toContainText('[ADD: countries]');
  await expect(page.locator('.mp-modal')).toContainText('Countries you ship to');
  expect(generated[0]).toMatchObject({ topic: 'Shipping and returns guide', format: 'buying_guide' });
  await page.click('#mp-lm-save');
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].magnet.title).toBe('Shipping and returns, simply');
});

test('Insights shows Scale / Hold / Rest with what to do, the 7-day trend and a tracking warning', async ({ page }) => {
  const post = (id, score, verdict, action) => ({
    id, permalink: `https://instagram.com/p/${id}`, format: 'reel', story_type: 'tutorial', opener: 'pov', first_line: `POV: post ${id}`,
    goal_score: score, verdict, verdict_action: action, metrics: { reach: 1200, comments: 9 },
  });
  await mockApi(page, srv.base, {
    data: clientData(),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/analytics/scorecard') { json(200, { empty: true, sources: [], rows: [], meta_connected: true }); return 'handled'; }
      if (entry.path === '/api/meta-insights' && entry.method === 'GET') {
        const w = post('w1', 88, 'scale', 'Do more of this: reuse the hook, try it as an ad.');
        const h = post('h1', 55, 'hold', 'Fine. Keep the format, test a sharper first line.');
        const l = post('l1', 12, 'rest', 'Rest this angle for now.');
        json(200, {
          connected: true, period: '30d', goal: 'grow', definitions: {}, eligible: 6, kind: 'commerce',
          sources: {}, scorecard: { goal: 'grow', primary: 'grow', posts_measured: 6, grow: [], engage: [] },
          winners: [w], losers: [l], posts: [w, h, l], patterns: { keep: [], avoid: [] },
          verdict_rules: [{ id: 'scale', min: 70, label: 'Scale', note: 'Top 30% of your own posts.' }, { id: 'hold', min: 40, label: 'Hold', note: 'Around your normal.' }, { id: 'rest', min: 0, label: 'Rest', note: 'Bottom 40%.' }],
          trend: { posts_last7: 2, avg_score_last7: 71, avg_score_before: 48, direction: 'up', tracking_warning: 'Your recent posts show zero reach. Reconnect Instagram in Settings.' },
        });
        return 'handled';
      }
      return undefined;
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="analytics"]');
  await page.locator('[data-book="insights"]').click();
  await expect(page.locator('#mi-winners .mi-verdict')).toHaveText('Scale');
  await expect(page.locator('#mi-winners')).toContainText('reuse the hook');
  await expect(page.locator('#mi-losers .mi-verdict')).toHaveText('Rest');
  await expect(page.locator('#mi-trend')).toContainText('average score 71');
  await expect(page.locator('#mi-trend')).toContainText('better than');
  await expect(page.locator('#mi-tracking-warning')).toContainText('Reconnect Instagram');
  await page.locator('#mi-all-posts summary').click();
  await expect(page.locator('#mi-all-posts .mi-verdict[data-verdict="hold"]')).toBeVisible();
});
