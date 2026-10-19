// The Coach's project agent: when the Coach hands a project over, the chat shows a live card that
// follows the run (plan, steps as they happen, a question when it needs one, the finished work with
// a way to open the approval queue). Reloading brings a run that is still going back. Hermetic.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { await srv.close(); });

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const PLAN = {
  goal: 'A 5 slide carousel on sleep habits',
  steps: [
    { tool: 'make_carousel', why: 'one carousel in the brand style', reuse: 'none' },
    { tool: 'audit_asset', why: 'check it before it is shown', reuse: 'none' },
  ],
  rejected_cheaper: ['A single post would not carry five tips'],
};
const RUNNING = {
  id: 'run-1', status: 'running', goal: 'A 5 slide carousel on sleep habits', plan: PLAN,
  steps: [
    { t: 'step', id: 's1', tool: 'get_brand_brief', label: 'Reading your brand', status: 'ok', ms: 900 },
    { t: 'say', text: 'Five tips fits one carousel.' },
    { t: 'step', id: 's2', tool: 'make_carousel', label: 'Designing the carousel', status: 'running' },
  ],
  result: null, error: null, stats: null,
};
const DONE = {
  ...RUNNING, status: 'done',
  steps: [
    RUNNING.steps[0], RUNNING.steps[1],
    { t: 'step', id: 's2', tool: 'make_carousel', label: 'Designing the carousel', status: 'ok', ms: 41000 },
    { t: 'step', id: 's3', tool: 'audit_asset', label: 'Checking the carousel', status: 'ok', ms: 9000 },
  ],
  result: {
    summary: 'Your sleep carousel is in the approval queue.',
    queued: [{ id: 'rec1' }],
    deliverables: [{
      kind: 'carousel', title: 'Five small habits for better sleep', urls: ['https://store.test/s1.png', 'https://store.test/s2.png'],
      caption: 'Small habits, better sleep.', hashtags: ['#OPA', '#Sleep'], audit: { overall: 8, pass: true }, record_id: 'rec1', queued: true,
    }],
  },
  stats: { ms: 52000, turns: 6, tool_calls: 4, tool_failures: 0, makes: 1, expensive: 0 },
};

async function openCoach(page, onRequest) {
  const errors = watchErrors(page);
  await mockApi(page, srv.base, { onRequest });
  await page.route('https://store.test/*.png', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="ai-coach"]');
  await expect(page.locator('#chat-input')).toBeVisible();
  return errors;
}

test('a project handed to the agent shows a live card that ends with the finished work and a way to the queue', async ({ page }) => {
  let polls = 0;
  const errors = await openCoach(page, (entry, route, json) => {
    if (entry.path === '/api/chat/v2') {
      json(200, { reply: 'On it. I will make a five slide carousel on sleep habits.', coach_actions: [{ type: 'agent_run', run_id: 'run-1', goal: 'A 5 slide carousel on sleep habits' }] });
      return 'handled';
    }
    if (entry.path === '/api/agent/runs/run-1') {
      polls += 1;
      json(200, { ok: true, run: polls < 3 ? RUNNING : DONE });
      return 'handled';
    }
    if (entry.path === '/api/agent/runs') { json(200, { ok: true, runs: [] }); return 'handled'; }
    return undefined;
  });

  await page.fill('#chat-input', 'make me a carousel about sleep habits');
  await page.click('#chat-send');
  const card = page.locator('.se-agent[data-agent-run="run-1"]');
  await expect(card).toBeVisible();

  // Working: the live steps and the plan.
  await expect(card).toHaveAttribute('data-status', 'running');
  await expect(card).toContainText('Reading your brand');
  await expect(card).toContainText('Designing the carousel');
  await expect(card).toContainText('Five tips fits one carousel.');
  await card.locator('summary', { hasText: 'The plan' }).click();
  await expect(card).toContainText('A single post would not carry five tips');

  // Finished: summary, the slides, the caption, queued and not posted.
  await expect(card).toHaveAttribute('data-status', 'done', { timeout: 15000 });
  await expect(card).toContainText('Your sleep carousel is in the approval queue.');
  await expect(card.locator('.se-agent__strip img')).toHaveCount(2);
  await expect(card.locator('.se-agent__badge')).toContainText('Not posted');
  await expect(card).toContainText('checked 8/10');
  await card.locator('summary', { hasText: 'Caption' }).click();
  await expect(card).toContainText('#Sleep');
  await expect(card).toContainText('3 steps taken');

  // The queue is one click away.
  await card.locator('[data-open-review]').click();
  await expect(page.locator('.dash-nav-item[data-nav="content"]')).toHaveClass(/active/);
  expect(errors).toEqual([]);
});

test('a question from the agent shows its options, and choosing one sends it in the chat', async ({ page }) => {
  const sent = [];
  await openCoach(page, (entry, route, json) => {
    if (entry.path === '/api/chat/v2') {
      sent.push(JSON.parse(entry.body || '{}').message);
      json(200, sent.length === 1
        ? { reply: 'Starting that now.', coach_actions: [{ type: 'agent_run', run_id: 'run-2', goal: 'Make a carousel about the new clinic hours' }] }
        : { reply: 'Got it.' });
      return 'handled';
    }
    if (entry.path === '/api/agent/runs/run-2') {
      json(200, { ok: true, run: { id: 'run-2', status: 'needs_you', goal: 'x', plan: null, steps: [], error: null, stats: { ms: 9000 }, result: { summary: 'I need one fact first.', queued: [], deliverables: [], question: { question: 'What are the new opening hours?', options: ['Weekdays 9 to 5', 'Weekdays 8 to 6'] } } } });
      return 'handled';
    }
    if (entry.path === '/api/agent/runs') { json(200, { ok: true, runs: [] }); return 'handled'; }
    return undefined;
  });

  await page.fill('#chat-input', 'carousel about our new clinic hours');
  await page.click('#chat-send');
  const card = page.locator('.se-agent[data-agent-run="run-2"]');
  await expect(card).toHaveAttribute('data-status', 'needs_you');
  await expect(card).toContainText('What are the new opening hours?');
  await card.locator('[data-opt="1"]').click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toBe('Weekdays 8 to 6');
});

test('a stopped project says so plainly and nothing is shown as ready', async ({ page }) => {
  await openCoach(page, (entry, route, json) => {
    if (entry.path === '/api/chat/v2') { json(200, { reply: 'Starting.', coach_actions: [{ type: 'agent_run', run_id: 'run-3', goal: 'A carousel about sleep' }] }); return 'handled'; }
    if (entry.path === '/api/agent/runs/run-3') { json(200, { ok: true, run: { id: 'run-3', status: 'failed', goal: 'x', plan: null, steps: [], result: null, error: 'The Coach hit a problem and stopped. Nothing was published.', stats: { ms: 4000 } } }); return 'handled'; }
    if (entry.path === '/api/agent/runs') { json(200, { ok: true, runs: [] }); return 'handled'; }
    return undefined;
  });
  await page.fill('#chat-input', 'make a carousel about sleep');
  await page.click('#chat-send');
  const card = page.locator('.se-agent[data-agent-run="run-3"]');
  await expect(card).toHaveAttribute('data-status', 'failed');
  await expect(card).toContainText('Nothing was published');
  await expect(card.locator('[data-open-review]')).toHaveCount(0);
  await expect(card.locator('.se-agent__badge')).toHaveCount(0);
});

test('after a reload the card for a project that is still running comes back, once', async ({ page }) => {
  const errors = await openCoach(page, (entry, route, json) => {
    if (entry.path === '/api/agent/runs') { json(200, { ok: true, runs: [{ id: 'run-1', status: 'running', goal: 'A 5 slide carousel on sleep habits', created_at: new Date().toISOString() }] }); return 'handled'; }
    if (entry.path === '/api/agent/runs/run-1') { json(200, { ok: true, run: RUNNING }); return 'handled'; }
    return undefined;
  });
  const card = page.locator('.se-agent[data-agent-run="run-1"]');
  await expect(card).toBeVisible({ timeout: 8000 });
  await expect(card).toContainText('Designing the carousel');
  await expect(page.locator('.se-agent[data-agent-run="run-1"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});
