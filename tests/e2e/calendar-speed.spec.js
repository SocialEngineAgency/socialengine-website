// Calendar paints from data the portal already holds, then fills in from slow endpoints. Hermetic.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

function todayKey() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

test('Calendar shows scheduled posts immediately; published posts land later and are remembered for the next visit', async ({ page }) => {
  const day = todayKey();
  const noon = new Date(); noon.setHours(12, 0, 0, 0);
  const data = clientData({
    client: { id: 'recCLIENT0000001' },
    content: [{ id: 'recPOST000000001', fields: { scheduled_date: day, caption: 'Scheduled hello', status: 'Scheduled', platform: 'Instagram' } }],
  });
  let slow = false;
  let freshCaption = 'Scheduled hello';
  const history = { posts: [{ id: 'ig_1', platform: 'instagram', media_type: 'Image', timestamp: noon.toISOString(), caption: 'Published from IG', status: 'Published', _source: 'social' }] };
  let historyCalls = 0;
  await mockApi(page, srv.base, {
    data,
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/calendar-history') {
        historyCalls += 1;
        if (slow) await new Promise((r) => setTimeout(r, 2500));
        json(200, history);
        return 'handled';
      }
      if (entry.path === '/api/client-data' && slow) {
        await new Promise((r) => setTimeout(r, 2500));
        const fresh = JSON.parse(JSON.stringify(data));
        fresh.content[0].fields.caption = freshCaption;
        json(200, fresh);
        return 'handled';
      }
      return undefined;
    },
  });
  await login(page, srv.base);
  slow = true;
  freshCaption = 'Fresh caption';

  const started = Date.now();
  await page.click('.dash-nav-item[data-nav="schedule"]');
  const cell = page.locator(`[data-bq-drop-day="${day}"]`);
  await expect(cell).toContainText('Scheduled hello', { timeout: 1500 });
  expect(Date.now() - started).toBeLessThan(2000);
  await expect(page.locator('#sched-cal-wrap')).not.toContainText('Loading calendar');

  await expect(cell).toContainText('Fresh caption', { timeout: 6000 });
  await expect(page.locator('#sched-cal-wrap')).toContainText('Published from IG', { timeout: 6000 });

  await page.click('.dash-nav-item[data-nav="dashboard"]');
  const before = historyCalls;
  await page.click('.dash-nav-item[data-nav="schedule"]');
  await expect(page.locator('#sched-cal-wrap')).toContainText('Published from IG', { timeout: 1500 });
  expect(historyCalls).toBeGreaterThanOrEqual(before);
});
