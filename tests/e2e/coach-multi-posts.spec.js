// The Post tool's Coach makes several single posts from one ask ("make 2 of them"): one tile
// per post fills in as each is made, Open puts one on the canvas, Add to Review / Add all
// queue them. Brand-design clients get the brand engine (one job); others get one Stage
// generation per post. A carousel offer names the carousel it will make. Hermetic.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const POSTS = [
  { title: '5 ways stress shows up in your body', brief: 'A listicle: five ways stress shows up in your body, warm tone' },
  { title: '5 small habits that improve your sleep', brief: 'A listicle: five small habits that genuinely improve your sleep' },
];

async function openPost(page, { look, onRequest }) {
  await mockApi(page, srv.base, { data: clientData(), onRequest });
  await page.route('https://store.test/*.png', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.addInitScript((l) => {
    try { localStorage.setItem('se-look2', l); } catch (_) {}
    window.__SE_POSTS_POLL_MS = 60;
  }, look);
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('.create-seg[data-segment="design-studio"]');
  await page.locator('#cs-brief').fill('Wellbeing listicles for OPA');
  await page.click('#cs-generate');
  await expect(page.locator('#cs-coach-input')).toBeVisible();
}

async function ask(page, text) {
  await page.locator('#cs-coach-input').fill(text);
  await page.click('#cs-coach-send');
}

for (const look of ['new', 'old']) {
  test(`${look} look: brand design, "make 2 of them" makes two posts, shown as each lands, queued from the chat`, async ({ page }) => {
    const errors = watchErrors(page);
    const sent = { posts: [], queue: [], polls: 0 };
    await openPost(page, {
      look,
      onRequest: async (entry, route, json) => {
        if (entry.path === '/api/studio/design-generate') { json(200, { ok: true, image_url: 'https://store.test/poster.png' }); return 'handled'; }
        if (entry.path === '/api/chat/v2') {
          json(200, { reply: 'Making both posts now.', coach_actions: [{ type: 'design_posts', engine: 'brand', medical: false, aspect_ratio: '4:5', posts: POSTS }] });
          return 'handled';
        }
        if (entry.path === '/api/design/posts') { sent.posts.push(JSON.parse(entry.body || '{}')); json(202, { ok: true, job_id: 'job-posts-1' }); return 'handled'; }
        if (entry.path === '/api/design/jobs/job-posts-1') {
          sent.polls += 1;
          if (sent.polls < 3) {
            json(200, { ok: true, job: { status: 'running', progress: { stage: 'posts', done: 1, total: 2, posts: [{ title: POSTS[0].title, status: 'done', url: 'https://store.test/post1.png' }, { title: POSTS[1].title, status: 'working' }] } } });
          } else {
            json(200, { ok: true, job: { status: 'done', progress: { done: 2, total: 2 }, result: { posts: [
              { title: POSTS[0].title, url: 'https://store.test/post1.png', caption: 'Stress shows up in the body first. Listen to it.', hashtags: ['#OPA', '#Wellbeing'] },
              { title: POSTS[1].title, url: 'https://store.test/post2.png', caption: 'Small habits, better sleep.', hashtags: ['#OPA'] },
            ], ratio: '4:5' } } });
          }
          return 'handled';
        }
        if (entry.path === '/api/studio/design-queue') { sent.queue.push(JSON.parse(entry.body || '{}')); json(200, { ok: true }); return 'handled'; }
        return undefined;
      },
    });

    await expect(page.locator('#cs-aspect')).toHaveValue('9:16');
    await ask(page, 'make 2 of them as single 4:5 posts');
    const card = page.locator('#cs-coach-log [data-cs-posts]');
    await expect(card).toBeVisible();
    // Brand posts are made in the brand's format, and the size picker follows it.
    await expect(card.locator('[data-cs-posts-size]')).toHaveText('Size 4:5, your brand format.');
    await expect(page.locator('#cs-aspect')).toHaveValue('4:5');
    await expect(page.locator('#cs-coach-log')).toContainText('Size switched from 9:16 to 4:5.');
    if (look === 'new') await expect(page.locator('.nl-p2-size button[data-aspect="4:5"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await card.locator('[data-cs-post="0"] .cs-post__img').evaluate((el) => el.style.aspectRatio)).toBe('4 / 5');
    // The first post shows while the second is still being made.
    await expect(card.locator('[data-cs-post="0"] img')).toHaveAttribute('src', /post1\.png/);
    await expect(card.locator('[data-cs-post="1"]')).toHaveAttribute('data-status', 'working');
    await expect(card.locator('[data-cs-posts-head]')).toContainText('1 of 2 done');
    await expect(card.locator('[data-cs-post="1"] img')).toHaveAttribute('src', /post2\.png/);
    await expect(card.locator('[data-cs-posts-head]')).toHaveText('All 2 posts are ready. Open one to change it, or add them to Review.');
    expect(sent.posts).toHaveLength(1);
    expect(sent.posts[0].posts.map((p) => p.title)).toEqual(POSTS.map((p) => p.title));
    await expect(page.locator('#cs-coach-log #cs-design-carousel')).toHaveCount(0);

    // One to Review, then the rest with Add all.
    await card.locator('[data-cs-post-queue="0"]').click();
    await expect.poll(() => sent.queue.length).toBe(1);
    expect(sent.queue[0]).toMatchObject({ image_url: 'https://store.test/post1.png', caption: 'Stress shows up in the body first. Listen to it.\n\n#OPA #Wellbeing' });
    await expect(card.locator('[data-cs-post-queue="0"]')).toHaveText('In Review');
    await expect(card.locator('[data-cs-posts-queue-all]')).toHaveCount(0);

    // Open puts a post on the canvas with its brief and caption.
    await card.locator('[data-cs-post-open="1"]').click();
    await expect(page.locator('#cs-original-preview-img')).toHaveAttribute('src', /post2\.png/);
    await expect(page.locator('#cs-brief')).toHaveValue(POSTS[1].brief);
    await expect(page.locator('#cs-caption-box')).toHaveValue('Small habits, better sleep.\n\n#OPA');

    // After a reload the posts are still in the chat, and the one in Review says so.
    await page.reload();
    await page.click('.dash-nav-item[data-nav="create"]');
    await page.click('.create-seg[data-segment="design-studio"]');
    const back = page.locator('#cs-coach-log [data-cs-posts]').last();
    await expect(back.locator('[data-cs-post="0"] img')).toHaveAttribute('src', /post1\.png/);
    await expect(back.locator('[data-cs-post="1"] img')).toHaveAttribute('src', /post2\.png/);
    await expect(back.locator('[data-cs-post-queue="0"]')).toHaveText('In Review');
    await expect(back.locator('[data-cs-post-queue="1"]')).toHaveText('Add to Review');
    await expect(back.locator('[data-cs-posts-size]')).toHaveText('Size 4:5.');
    expect(sent.posts).toHaveLength(1, 'nothing is made again');
    expect(errors).toEqual([]);
  });
}

test('no brand design: each post is its own Stage generation; a failed one can be tried again; Add all queues the rest', async ({ page }) => {
  const errors = watchErrors(page);
  const sent = { generate: [], queue: [] };
  let failSecond = true;
  await openPost(page, {
    look: 'new',
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/studio/design-generate') {
        const body = JSON.parse(entry.body || '{}');
        sent.generate.push(body);
        if (body.brief === POSTS[1].brief && failSecond) { failSecond = false; json(500, { ok: false, error: 'The generator is busy' }); return 'handled'; }
        const n = body.brief === POSTS[0].brief ? 1 : body.brief === POSTS[1].brief ? 2 : 0;
        json(200, { ok: true, image_url: n ? `https://store.test/stage${n}.png` : 'https://store.test/poster.png' });
        return 'handled';
      }
      if (entry.path === '/api/chat/v2') {
        json(200, { reply: 'Making both posts now.', coach_actions: [{ type: 'design_posts', engine: 'stage', posts: POSTS }] });
        return 'handled';
      }
      if (entry.path === '/api/studio/design-queue') { sent.queue.push(JSON.parse(entry.body || '{}')); json(200, { ok: true }); return 'handled'; }
      return undefined;
    },
  });
  sent.generate = [];
  await ask(page, 'make 2 of them');
  const card = page.locator('#cs-coach-log [data-cs-posts]');
  await expect(card.locator('[data-cs-post="0"] img')).toHaveAttribute('src', /stage1\.png/);
  await expect(card.locator('[data-cs-post="1"]')).toHaveAttribute('data-status', 'failed');
  await expect(card.locator('[data-cs-post="1"]')).toContainText('The generator is busy');
  await card.locator('[data-cs-post-retry="1"]').click();
  await expect(card.locator('[data-cs-post="1"] img')).toHaveAttribute('src', /stage2\.png/);
  expect(sent.generate.map((g) => g.brief)).toEqual([POSTS[0].brief, POSTS[1].brief, POSTS[1].brief]);
  await card.locator('[data-cs-posts-queue-all]').click();
  await expect.poll(() => sent.queue.length).toBe(2);
  expect(sent.queue.map((q) => q.image_url)).toEqual(['https://store.test/stage1.png', 'https://store.test/stage2.png']);
  await expect(card.locator('[data-cs-post-queue="1"]')).toHaveText('In Review');
  expect(errors).toEqual([]);
});

test('a carousel offer says which carousel it makes', async ({ page }) => {
  await openPost(page, {
    look: 'new',
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/studio/design-generate') { json(200, { ok: true, image_url: 'https://store.test/poster.png' }); return 'handled'; }
      if (entry.path === '/api/chat/v2') {
        json(200, { reply: 'Designing your carousel.', coach_actions: [{ type: 'design_carousel', brief: 'Stress myths and facts, 6 slides', slides: 6 }] });
        return 'handled';
      }
      return undefined;
    },
  });
  await ask(page, 'make a 6-slide carousel about stress myths');
  await expect(page.locator('#cs-design-carousel')).toHaveText('Design this 6-slide carousel in my brand style');
});

test('no brand design: the size the Coach names is the size the picker switches to and the posts are made at', async ({ page }) => {
  const errors = watchErrors(page);
  const sent = { generate: [] };
  await openPost(page, {
    look: 'new',
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/studio/design-generate') {
        const body = JSON.parse(entry.body || '{}');
        sent.generate.push(body);
        json(200, { ok: true, image_url: `https://store.test/size${sent.generate.length}.png` });
        return 'handled';
      }
      if (entry.path === '/api/chat/v2') {
        json(200, { reply: 'Making both at 4:5, the best size for the Instagram feed.', coach_actions: [{ type: 'design_posts', engine: 'stage', aspect_ratio: '4:5', posts: POSTS }] });
        return 'handled';
      }
      return undefined;
    },
  });
  await expect(page.locator('#cs-aspect')).toHaveValue('9:16');
  sent.generate = [];
  await ask(page, 'make 2 of them');
  const card = page.locator('#cs-coach-log [data-cs-posts]');
  await expect(card.locator('[data-cs-post="1"] img')).toBeVisible();
  expect(sent.generate.map((g) => g.aspect_ratio)).toEqual(['4:5', '4:5']);
  await expect(page.locator('#cs-aspect')).toHaveValue('4:5');
  await expect(page.locator('.nl-p2-size button[data-aspect="4:5"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#cs-coach-log')).toContainText('Size switched from 9:16 to 4:5.');
  await expect(card.locator('[data-cs-posts-size]')).toHaveText('Size 4:5.');

  // Opening a post after picking another size brings the picker back to that post's size.
  await page.click('.nl-p2-size button[data-aspect="1:1"]');
  await expect(page.locator('#cs-aspect')).toHaveValue('1:1');
  await card.locator('[data-cs-post-open="0"]').click();
  await expect(page.locator('#cs-aspect')).toHaveValue('4:5');
  expect(errors).toEqual([]);
});

test('a single design the Coach sizes switches the picker; one it leaves at the default does not', async ({ page }) => {
  const errors = watchErrors(page);
  const sent = { generate: [] };
  let next = null;
  let made = 0;
  await openPost(page, {
    look: 'new',
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/studio/design-generate') {
        sent.generate.push(JSON.parse(entry.body || '{}'));
        made += 1;
        json(200, { ok: true, image_url: `https://store.test/one${made}.png` });
        return 'handled';
      }
      if (entry.path === '/api/chat/v2') { json(200, next); return 'handled'; }
      return undefined;
    },
  });
  sent.generate = [];
  next = { reply: 'I will make it at 4:5 for the feed.', coach_actions: [{ type: 'create', destination: 'design', mode: 'image', prompt: 'A feed post: five small habits that improve your sleep, warm tone', aspect_ratio: '4:5', aspect_explicit: true }] };
  // With a post on the canvas this is a change to it, made straight away.
  await ask(page, 'make the sleep one as a 4:5 feed post');
  await expect.poll(() => sent.generate.length).toBe(1);
  expect(sent.generate[0].aspect_ratio).toBe('4:5');
  await expect(page.locator('#cs-aspect')).toHaveValue('4:5');
  await expect(page.locator('#cs-coach-log')).toContainText('Size switched from 9:16 to 4:5.');

  // The Coach did not name a size (9:16 is only its default): the size picked here stays.
  await page.click('.nl-p2-size button[data-aspect="1:1"]');
  next = { reply: 'Making a calmer version.', coach_actions: [{ type: 'create', destination: 'design', mode: 'image', prompt: 'A calmer version of the sleep habits post, soft blues', aspect_ratio: '9:16', aspect_explicit: false }] };
  await ask(page, 'make a calmer version');
  // A new design with one on the canvas waits for Apply design.
  await page.click('#cs-coach-apply');
  await expect.poll(() => sent.generate.length).toBe(2);
  expect(sent.generate[1].aspect_ratio).toBe('1:1');
  await expect(page.locator('#cs-aspect')).toHaveValue('1:1');
  await expect(page.locator('#cs-coach-log')).not.toContainText('Size switched from 4:5 to 9:16');
  expect(errors).toEqual([]);
});
