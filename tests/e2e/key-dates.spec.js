// Calendar key dates: strip + day badges + post ideas handed to Create + country picker. Hermetic — mocked API.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

function todayKey() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

const COUNTRIES = [{ code: 'GB', name: 'United Kingdom' }, { code: 'US', name: 'United States' }];

test('Calendar shows key dates, badges the day, ideas open Create with the brief; picking a country reloads', async ({ page }) => {
  const day = todayKey();
  const ideaCalls = [];
  const countryPuts = [];
  let country = '';
  await mockApi(page, srv.base, {
    data: clientData({}),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/marketing/key-dates' && entry.method === 'GET') {
        const dates = [{ date: day, name: 'World Kindness Day', type: 'awareness', angle: 'Share one real fact and one small action.' }];
        if (country === 'GB') dates.push({ date: day, name: 'Boxing Day', type: 'holiday', angle: 'Opening hours.' });
        json(200, { country, country_known: !!country, kind: 'charity', dates, countries: COUNTRIES });
        return 'handled';
      }
      if (entry.path === '/api/marketing/key-dates/country') {
        const body = JSON.parse(entry.body || '{}');
        countryPuts.push(body);
        country = body.country;
        json(200, { success: true, country });
        return 'handled';
      }
      if (entry.path === '/api/marketing/key-dates/ideas') {
        ideaCalls.push(JSON.parse(entry.body || '{}'));
        json(200, { date: day, name: 'World Kindness Day', ideas: [
          { hook: 'One kind act our volunteers saw this week', brief: 'Photo of a volunteer with a short story.', post_on: day },
          { hook: 'Three small ways to help today', brief: 'Simple list graphic.', post_on: day },
        ] });
        return 'handled';
      }
      return undefined;
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="schedule"]');
  const strip = page.locator('#key-dates-strip');
  await expect(strip).toContainText('World Kindness Day');
  await expect(strip).toContainText('Pick your country to add public holidays.');
  await expect(page.locator(`[data-bq-drop-day="${day}"] .kd-badge`)).toContainText('World Kindness Day');

  await page.selectOption('#kd-country', 'GB');
  await expect(strip).toContainText('Boxing Day');
  expect(countryPuts).toEqual([{ country: 'GB' }]);
  await expect(page.locator(`[data-bq-drop-day="${day}"] .kd-badge`)).toHaveCount(1);

  await page.locator(`[data-bq-drop-day="${day}"] .kd-badge`).click();
  await expect(page.locator('.kd-modal')).toContainText('One kind act our volunteers saw this week');
  expect(ideaCalls[0]).toEqual({ date: day, name: 'World Kindness Day' });
  await expect(page.locator('#sched-cal-wrap')).toBeVisible();
  await page.locator('[data-kd-make="1"]').click();
  await expect(page.locator('.kd-modal')).toHaveCount(0);
  const session = await page.evaluate(() => window.__SE_COACH_CREATE_SESSION || null);
  if (session) expect(session.prompt).toContain('Three small ways to help today');
  await expect(page.locator('#cs-brief')).toHaveValue(/Three small ways to help today/, { timeout: 10000 });
});
