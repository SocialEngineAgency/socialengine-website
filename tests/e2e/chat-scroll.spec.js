// The Coach chat follows new content only while you are at the bottom. Scroll up to read and a project card
// that keeps updating must not drag the chat back down; scroll to the bottom and it follows again. Hermetic.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { await srv.close(); });

const run = (n) => ({
  id: 'run-s', status: 'running', goal: 'A carousel about sleep', plan: null, result: null, error: null, stats: null,
  steps: Array.from({ length: n }, (_, i) => ({ t: 'step', id: `s${i}`, tool: 'make_carousel', label: `Step number ${i + 1}`, status: i === n - 1 ? 'running' : 'ok', ms: 800 })),
});

test('scrolling up in the Coach chat is not undone by a card that keeps updating', async ({ page }) => {
  const errors = watchErrors(page);
  let polls = 0;
  await mockApi(page, srv.base, {
    onRequest: (entry, route, json) => {
      if (entry.path === '/api/chat/v2') { json(200, { reply: 'On it.', coach_actions: [{ type: 'agent_run', run_id: 'run-s', goal: 'A carousel about sleep' }] }); return 'handled'; }
      if (entry.path === '/api/agent/runs/run-s') { polls += 1; json(200, { ok: true, run: run(2 + polls) }); return 'handled'; }
      if (entry.path === '/api/agent/runs') { json(200, { ok: true, runs: [] }); return 'handled'; }
      return undefined;
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="ai-coach"]');
  await page.fill('#chat-input', 'make me a carousel about sleep');
  await page.click('#chat-send');
  const card = page.locator('.se-agent[data-agent-run="run-s"]');
  await expect(card).toBeVisible();

  // Make the chat taller than its window, then read from the top.
  await page.evaluate(() => {
    const el = document.getElementById('chat-messages');
    const pad = document.createElement('div');
    pad.style.cssText = 'height:2400px;flex:none;';
    el.insertBefore(pad, el.firstChild);
    el.scrollTop = el.scrollHeight;
  });
  const metrics = () => page.evaluate(() => { const el = document.getElementById('chat-messages'); return { top: el.scrollTop, gap: el.scrollHeight - el.scrollTop - el.clientHeight }; });
  await expect.poll(async () => (await metrics()).gap).toBeLessThan(5);
  await page.evaluate(() => { document.getElementById('chat-messages').scrollTop = 0; });
  await expect.poll(async () => (await metrics()).top).toBe(0);

  // Two more updates arrive while the reader is at the top. They must not move the view.
  const seen = polls;
  await expect.poll(() => polls, { timeout: 15000 }).toBeGreaterThanOrEqual(seen + 2);
  expect((await metrics()).top).toBe(0);

  // Back at the bottom, the chat follows again.
  await page.evaluate(() => { const el = document.getElementById('chat-messages'); el.scrollTop = el.scrollHeight; });
  await expect.poll(async () => (await metrics()).gap).toBeLessThan(5);
  const before = polls;
  await expect.poll(() => polls, { timeout: 15000 }).toBeGreaterThanOrEqual(before + 1);
  await expect.poll(async () => (await metrics()).gap, { timeout: 5000 }).toBeLessThan(5);

  // Sending a message always takes you to it, even from the top.
  await page.evaluate(() => { document.getElementById('chat-messages').scrollTop = 0; });
  await expect.poll(async () => (await metrics()).top).toBe(0);
  await page.fill('#chat-input', 'thanks');
  await page.click('#chat-send');
  await expect.poll(async () => (await metrics()).gap, { timeout: 5000 }).toBeLessThan(5);
  expect(errors).toEqual([]);
});
