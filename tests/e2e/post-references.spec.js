// Post tab: several pictures for one post (the photo, plus the logo or a second photo), and a Coach post made from
// the client's own attachments carries them to the generator. When the logo could not be placed, the page says why.
// Hermetic: mocked API.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

// The main Coach page has the Carousels chat open, as in the reported case.
const CAROUSELS_OPEN = () => ({
  active: { projectId: 'proj_carousels', threadId: 'thr_carousels' },
  projects: [{ id: 'proj_carousels', name: 'Carousels', kind: 'carousel', threads: [{ id: 'thr_carousels', name: 'Main chat', messages: [{ role: 'user', content: 'a carousel about heartburn' }, { role: 'assistant', content: 'Designing your carousel.' }] }] }],
});

async function openPost(page, onRequest, look = 'new') {
  await mockApi(page, srv.base, { data: clientData(), onRequest, coachWorkspace: CAROUSELS_OPEN() });
  await page.route('https://store.test/*', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.addInitScript((l) => { try { localStorage.setItem('se-look2', l); } catch (_) {} window.__SE_POSTS_POLL_MS = 60; }, look);
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('.create-seg[data-segment="design-studio"]');
}

test('new look: a photo plus more pictures (add, remove), sent together; a logo that could not be placed is explained', async ({ page }) => {
  const errors = watchErrors(page);
  const sent = { generate: [], uploads: 0 };
  const names = ['wedding', 'logo', 'second', 'logo2'];
  await openPost(page, async (entry, route, json) => {
    if (entry.path === '/api/studio/upload-image') {
      json(200, { ok: true, url: `https://store.test/${names[sent.uploads++]}.png` });
      return 'handled';
    }
    if (entry.path === '/api/studio/design-generate') {
      sent.generate.push(JSON.parse(entry.body || '{}'));
      json(200, { ok: true, image_url: 'https://store.test/post.png', method: 'gpt-image', logo: { placed: false, note: 'There is no logo in your Library yet, so none was added. Add your logo in Library, then press Regenerate.' } });
      return 'handled';
    }
    return undefined;
  });
  const upload = async (name) => page.setInputFiles('#cs-file', { name: `${name}.png`, mimeType: 'image/png', buffer: PNG });

  // No main picture yet: no "+ Picture".
  await expect(page.locator('#nl-p2-more [data-cs-more-add]')).toHaveCount(0);
  await page.click('#nl-p2-ref');
  await page.click('#cs-tab-uploads');
  await upload('wedding');
  await expect(page.locator('#nl-p2-ref img')).toHaveAttribute('src', /wedding\.png/);

  // More pictures, one at a time; remove one.
  await page.click('#nl-p2-more [data-cs-more-add]');
  await upload('logo');
  await expect(page.locator('#nl-p2-more .nl-p2-moreref')).toHaveCount(1);
  await expect(page.locator('#nl-p2-ref img'), 'the main picture stays').toHaveAttribute('src', /wedding\.png/);
  await page.click('#nl-p2-more [data-cs-more-add]');
  await upload('second');
  await expect(page.locator('#nl-p2-more .nl-p2-moreref')).toHaveCount(2);
  await page.click('#nl-p2-more [data-cs-more-del="1"]');
  await expect(page.locator('#nl-p2-more .nl-p2-moreref')).toHaveCount(1);
  await expect(page.locator('#nl-p2-more .nl-p2-moreref img')).toHaveAttribute('src', /logo\.png/);

  // Changing the main picture (the chip) still replaces it, and keeps the extras.
  await page.locator('#cs-brief').fill('Happy Anniversary to Fiona and Simon. Use the logo, white, upper left corner.');
  await page.click('#cs-generate');
  await expect.poll(() => sent.generate.length).toBe(1);
  expect(sent.generate[0].photo_url).toBe('https://store.test/wedding.png');
  expect(sent.generate[0].reference_urls).toEqual(['https://store.test/logo.png']);
  await expect(page.locator('body')).toContainText('There is no logo in your Library yet');
  expect(errors).toEqual([]);
});

test('old look: "+ Add another picture" under the reference does the same', async ({ page }) => {
  const sent = { generate: [], uploads: 0 };
  await openPost(page, async (entry, route, json) => {
    if (entry.path === '/api/studio/upload-image') { json(200, { ok: true, url: `https://store.test/p${++sent.uploads}.png` }); return 'handled'; }
    if (entry.path === '/api/studio/design-generate') { sent.generate.push(JSON.parse(entry.body || '{}')); json(200, { ok: true, image_url: 'https://store.test/post.png' }); return 'handled'; }
    return undefined;
  }, 'old');
  await page.click('#cs-ref-open');
  await page.click('#cs-tab-uploads');
  await page.setInputFiles('#cs-file', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
  await page.click('#cs-ref-more');
  await page.setInputFiles('#cs-file', { name: 'b.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('#cs-ref-summary .cs-more-ref')).toHaveCount(1);
  await page.locator('#cs-brief').fill('A post with both photos');
  await page.click('#cs-generate');
  await expect.poll(() => sent.generate.length).toBe(1);
  expect(sent.generate[0].photo_url).toBe('https://store.test/p1.png');
  expect(sent.generate[0].reference_urls).toEqual(['https://store.test/p2.png']);
});

test('Post tab Coach: its own chat, pictures sent as what they are, and each post made from the pictures it names', async ({ page }) => {
  const errors = watchErrors(page);
  const sent = { generate: [], chat: [], uploads: 0 };
  const names = ['wedding', 'opa-logo'];
  await openPost(page, async (entry, route, json) => {
    if (entry.path === '/api/studio/upload-image') { json(200, { ok: true, url: `https://store.test/${names[sent.uploads++]}.png` }); return 'handled'; }
    if (entry.path === '/api/studio/design-generate') {
      sent.generate.push(JSON.parse(entry.body || '{}'));
      json(200, { ok: true, image_url: 'https://store.test/anniversary.png', logo: { placed: true, corner: 'top-left', color: 'white' } });
      return 'handled';
    }
    if (entry.path === '/api/chat/v2') {
      const b = JSON.parse(entry.body || '{}');
      sent.chat.push(b);
      json(200, {
        reply: 'Making your anniversary post on your wedding photo, with your logo in white in the top-left corner.',
        threadId: b.threadId, projectId: b.projectId, project: { id: b.projectId, name: 'Posts' }, thread: { id: b.threadId, name: 'Main chat' },
        coach_actions: [{ type: 'design_posts', engine: 'stage', aspect_ratio: '4:5', posts: [{ title: 'Happy Anniversary Fiona and Simon', brief: 'Happy Anniversary to our Patron. Logo: white, top-left corner.', engine: 'stage', photo_url: 'https://store.test/wedding.png', logo_url: 'https://store.test/opa-logo.png' }] }],
      });
      return 'handled';
    }
    return undefined;
  });
  // The Post tab's own chat, not the Carousels chat open on the Coach page.
  await expect(page.locator('#cs-workspace-chip [data-se-cc-label]')).toHaveText('Posts · Main chat');
  await expect(page.locator('#cs-coach-log')).not.toContainText('heartburn');

  await page.setInputFiles('#cs-coach-style-file', [
    { name: 'wedding.png', mimeType: 'image/png', buffer: PNG },
    { name: 'opa-logo.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await expect(page.locator('#cs-coach-style-chip .cs-coach-pic')).toHaveCount(2);
  await expect(page.locator('#cs-coach-style-chip')).toContainText('Attached (2)');
  await page.locator('#cs-coach-input').fill('create me a post in 4:5 for Fiona and Simon on the wedding photo, use the logo white upper left');
  await page.click('#cs-coach-send');
  const card = page.locator('#cs-coach-log [data-cs-posts]');
  await expect(card.locator('[data-cs-post="0"] img')).toHaveAttribute('src', /anniversary\.png/);

  const chat = sent.chat[0];
  expect(chat).toMatchObject({ surface: 'design', create_tab: 'post', threadId: 'thr_still', projectId: 'proj_still' });
  expect(chat.reference_images).toEqual([{ url: 'https://store.test/wedding.png', role: 'picture' }, { url: 'https://store.test/opa-logo.png', role: 'picture' }]);
  expect(chat.style_image_urls, 'never sent as style references').toBeUndefined();
  expect(chat.message).not.toMatch(/style|infographic/i);
  expect(sent.generate).toHaveLength(1);
  expect(sent.generate[0]).toMatchObject({ photo_url: 'https://store.test/wedding.png', logo_url: 'https://store.test/opa-logo.png', aspect_ratio: '4:5' });

  // The pictures stay attached (and go with the next message) until removed; they are not style references for Generate.
  await page.locator('#cs-brief').fill('A plain post');
  sent.generate = [];
  await page.click('#cs-generate');
  await expect.poll(() => sent.generate.length).toBe(1);
  expect(sent.generate[0].style_image_urls).toBeUndefined();
  expect(errors).toEqual([]);
});

test('Post tab Coach: the chat picker switches chats and starts a new one, without moving the Coach page', async ({ page }) => {
  const sent = { chat: [], threads: [] };
  await openPost(page, async (entry, route, json) => {
    if (entry.path === '/api/chat/v2') {
      const b = JSON.parse(entry.body || '{}');
      sent.chat.push(b);
      json(200, { reply: 'Sure.', threadId: b.threadId, projectId: b.projectId });
      return 'handled';
    }
    if (/\/api\/workspace\/projects\/[^/]+\/threads$/.test(entry.path)) sent.threads.push(JSON.parse(entry.body || '{}'));
    return undefined;
  });
  const pick = page.locator('#cs-workspace-chip [data-se-cc-pick]');
  await expect(pick).toContainText('Posts · Main chat');
  await pick.click();
  const menu = page.locator('#cs-workspace-chip .se-cc-menu');
  await expect(menu).toContainText('Carousels');
  await expect(menu).toContainText('Posts');
  // Pick the Carousels chat: its messages show, and the next message goes there.
  await menu.locator('[data-se-cc-thread="thr_carousels"]').click();
  await expect(pick).toContainText('Carousels · Main chat');
  await expect(page.locator('#cs-coach-log')).toContainText('a carousel about heartburn');
  await page.locator('#cs-coach-input').fill('turn it into a post');
  await page.click('#cs-coach-send');
  await expect.poll(() => sent.chat.length).toBe(1);
  expect(sent.chat[0]).toMatchObject({ create_tab: 'post', threadId: 'thr_carousels' });
  // A new chat, in the project of the chat open here; the Coach page stays where it was.
  await pick.click();
  await page.locator('#cs-workspace-chip [data-se-cc-new]').click();
  await expect(pick).toContainText('Carousels · New chat');
  expect(sent.threads).toEqual([{ name: 'New chat', keepActive: true }]);
  await expect(page.locator('#cs-coach-log')).not.toContainText('heartburn');
  // Remembered for the Post tab after a reload.
  await page.reload();
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('.create-seg[data-segment="design-studio"]');
  await expect(page.locator('#cs-workspace-chip [data-se-cc-pick]')).toContainText('Carousels · New chat');
});
