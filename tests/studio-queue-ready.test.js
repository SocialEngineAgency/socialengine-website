'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  queueableSingleImage,
  captionForQueue,
  queueReviewStatus,
  openContentReviewAfterQueue,
  cardMediaSrc,
  sortPostsForReview,
  postsForContentReview,
  homeQueuePosts,
  videoStudioDoor,
  musicVolumeFromPercent,
  buildMixAudioBody,
  buildUploadVideoQueueBody,
  mixPreviewKey,
  mixPreviewIsCurrent,
  applyCaptionToPost,
  escapeCaptionForTextarea,
  cardWhenLabel,
} = require('../studio-queue-ready');

test('uploaded square is queueable without a generated design', () => {
  assert.equal(
    queueableSingleImage({
      carousel: false,
      designed: false,
      imageUrl: 'https://cdn.example/post.jpg',
      type: 'image',
    }),
    'https://cdn.example/post.jpg'
  );
});

test('generated design or carousel does not use the raw upload as the queue image', () => {
  assert.equal(queueableSingleImage({
    carousel: true, designed: false, imageUrl: 'https://cdn.example/post.jpg', type: 'image',
  }), '');
  assert.equal(queueableSingleImage({
    carousel: false, designed: true, imageUrl: 'https://cdn.example/post.jpg', type: 'image',
  }), '');
  assert.equal(queueableSingleImage({
    carousel: false, designed: false, imageUrl: 'https://cdn.example/clip.mp4', type: 'video',
  }), '');
});

test('typed caption wins over generated caption and brief', () => {
  assert.equal(captionForQueue({
    typedCaption: '  Shop the drop  ',
    generatedCaption: 'AI caption',
    brief: 'brief text',
  }), 'Shop the drop');
});

test('brief is the caption when nothing was typed or generated', () => {
  assert.equal(captionForQueue({
    typedCaption: '',
    generatedCaption: '',
    brief: 'Already wrote this elsewhere',
  }), 'Already wrote this elsewhere');
});

test('Add to Queue writes Pending so the card shows in review', () => {
  assert.equal(queueReviewStatus(), 'Pending');
});

test('after queue, Content Review nav is clicked', () => {
  let clicked = false;
  const doc = { querySelector: (sel) => sel === '[data-nav=content]' ? { click() { clicked = true; } } : null };
  assert.equal(openContentReviewAfterQueue(doc), true);
  assert.equal(clicked, true);
});

test('Atlas card thumbs go through media-fetch so they are not hotlink-blocked', () => {
  const src = cardMediaSrc('https://oss.aliyuncs.com/opa/slide.png', 'https://api.example');
  assert.equal(src, 'https://api.example/api/media-fetch?url=' + encodeURIComponent('https://oss.aliyuncs.com/opa/slide.png'));
});

test('a just-queued post sorts above older scheduled posts', () => {
  const sorted = sortPostsForReview([
    { id: 'old', scheduled_date: '2026-09-20', created_at: '2026-09-01T00:00:00.000Z' },
    { id: 'new', created_at: '2026-09-16T21:18:00.000Z' },
  ]);
  assert.equal(sorted[0].id, 'new');
});

test('claude-studio queues as Pending and opens Content Review', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'claude-studio.js'), 'utf8');
  assert.match(src, /queueReviewStatus/);
  assert.match(src, /openContentReviewAfterQueue/);
  assert.doesNotMatch(src, /status:\s*'Approved'/);
});

test('portal cards use cardMediaSrc and sortPostsForReview', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  assert.match(src, /cardMediaSrc\(/);
  assert.match(src, /sortPostsForReview\(/);
});

test('the same stored image is one review card even if captions differ', () => {
  const out = postsForContentReview([
    { id: 'rec1', caption: 'Healthcare Support NPO of the Year — thank you.', image_url: 'https://store.example/opa/npo.png', created_at: '2026-09-17T12:00:00.000Z' },
    { id: 'rec2', caption: 'Healthcare Support NPO of the Year — please donate.', image_url: 'https://store.example/opa/npo.png?w=800', created_at: '2026-09-16T12:00:00.000Z' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'rec1');
});

test('live Meta copies of the same caption do not become extra review cards', () => {
  const caption = 'Healthcare Support NPO of the Year — thank you for standing with patients.';
  const out = postsForContentReview([
    { id: 'recAAA', caption, created_at: '2026-09-16T10:00:00.000Z' },
    { id: 'ig_111', caption, _live: true, created_at: '2026-09-17T10:00:00.000Z' },
    { id: 'fb_222', caption, _source: 'social' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'recAAA');
});

test('home queue hides archived posts and keeps live pending first', () => {
  const out = homeQueuePosts([
    { id: 'arch', status: 'Archived', caption: 'Meet the team keeping hope alive this month.', created_at: '2026-09-17T20:00:00.000Z' },
    { id: 'live', status: 'Pending', caption: 'Healthcare Support NPO of the Year — thank you.', created_at: '2026-09-16T10:00:00.000Z' },
  ]);
  assert.deepEqual(out.map((p) => p.id), ['live']);
});

test('Content Review still keeps archived rows for the Archived filter', () => {
  const out = postsForContentReview([
    { id: 'arch', status: 'Archived', caption: 'Meet the team keeping hope alive this month.', created_at: '2026-09-17T20:00:00.000Z' },
    { id: 'live', status: 'Pending', caption: 'A different live post about early checks.', created_at: '2026-09-16T10:00:00.000Z' },
  ]);
  assert.equal(out.some((p) => p.id === 'arch'), true);
});

test('home dashboard uses homeQueuePosts not the full review list', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  assert.match(src, /homeQueuePosts\(/);
  const dash = src.slice(src.indexOf('function renderDashboard'), src.indexOf('function renderContentPage'));
  assert.match(dash, /homeQueuePosts\(/);
  assert.doesNotMatch(dash, /postsForContentReview\(/);
});

test('Video & Post starts on two doors unless remix or Coach is landing', () => {
  assert.equal(videoStudioDoor(''), 'choose');
  assert.equal(videoStudioDoor('upload'), 'upload');
  assert.equal(videoStudioDoor('', { remix: true }), 'make');
  assert.equal(videoStudioDoor('', { coachSession: true }), 'make');
});

test('upload queue body is type video and Pending', () => {
  const body = buildUploadVideoQueueBody({
    videoUrl: 'https://store.example/reel.mp4',
    imageUrl: 'https://store.example/frame.jpg',
    caption: 'Posted from Create',
    platform: 'Instagram,Facebook',
  });
  assert.equal(body.type, 'video');
  assert.equal(body.video_url, 'https://store.example/reel.mp4');
  assert.equal(body.status, 'Pending');
  assert.throws(() => buildUploadVideoQueueBody({ caption: 'x' }), /video/i);
});

test('mix body keeps original audio unless muted', () => {
  const body = buildMixAudioBody({
    videoUrl: 'https://store.example/reel.mp4',
    musicUrl: 'https://store.example/bed.mp3',
    musicVolumePercent: 28,
    muteOriginal: false,
  });
  assert.equal(body.music_volume, 0.28);
  assert.equal(body.mute_original, false);
  assert.equal(musicVolumeFromPercent(50), 0.5);
});

test('a mixed preview is current only for the same video, bed, volume, and mute', () => {
  const settings = {
    sourceVideoUrl: 'https://store.example/reel.mp4',
    musicUrl: 'https://store.example/bed.mp3',
    musicVolume: 0.2,
    muteOriginal: true,
  };
  const draft = {
    mixedVideoUrl: 'https://store.example/mixed.mp4',
    mixKey: mixPreviewKey(settings),
  };
  assert.equal(mixPreviewIsCurrent(draft, settings), true);
  assert.equal(mixPreviewIsCurrent(draft, { ...settings, musicVolume: 0.4 }), false);
  assert.equal(mixPreviewIsCurrent({ mixedVideoUrl: '' }, settings), false);
});

test('Video & Post source has both doors and the music endpoints', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  assert.match(src, /I already have the video/);
  assert.match(src, /Make one/);
  assert.match(src, /\/api\/studio\/generate-music/);
  assert.match(src, /\/api\/studio\/mix-audio/);
  assert.match(src, /accept="video\//);
  assert.match(src, /Play with music/);
  assert.match(src, /vs-music-bed/);
  assert.match(src, /previewVSFinishedMix/);
});

test('Content Review does not dump calendar-history into the queue', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  assert.match(src, /postsForContentReview\(/);
  assert.doesNotMatch(src, /_skipLiveMerge/);
  const reviewFn = src.slice(src.indexOf('function renderContentPage'), src.indexOf('function renderContentPage') + 9000);
  assert.doesNotMatch(reviewFn, /calendar-history/);
});

test('typed caption overwrites both stored caption fields', () => {
  const next = applyCaptionToPost(
    { id: 'rec1', caption: 'Design Studio post', full_post_text: 'Design Studio post' },
    'Free packs are on the website'
  );
  assert.equal(next.caption, 'Free packs are on the website');
  assert.equal(next.full_post_text, 'Free packs are on the website');
  assert.equal(escapeCaptionForTextarea('A & B <c>'), 'A &amp; B &lt;c&gt;');
});

test('card when-label is a short date that does not include the year', () => {
  assert.equal(cardWhenLabel({ scheduled_date: '2026-09-15', scheduled_time: '11:00' }), 'Sep 15 · 11:00 AM');
  assert.equal(cardWhenLabel({ scheduled_date: '2026-09-10', scheduled_time: '20:30' }), 'Sep 10 · 8:30 PM');
  assert.equal(cardWhenLabel({ scheduled_date: '2026-09-13' }), 'Sep 13');
  assert.equal(cardWhenLabel({}), '');
});

test('grid cards keep the date in a reserved footer, not the header', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  assert.match(src, /studio-card__when/);
  assert.match(src, /cardWhenLabel/);
  assert.doesNotMatch(src, /Published →/);
  assert.doesNotMatch(src, /View details →/);
  const topRow = src.slice(src.indexOf('studio-card__top-row'), src.indexOf('studio-card__caption'));
  assert.doesNotMatch(topRow, /studio-card__date/);
});

test('Approve is not Post now, and the box caption is what we send', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  assert.match(src, /pick a date to schedule/i);
  assert.match(src, /publishNow:\s*true/);
  assert.match(src, /applyCaptionToPost/);
  assert.match(src, /What.s in this box is what we post/);
});

test('Content Review reschedule includes a time when the date is already set', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  const start = src.indexOf('Reschedule:');
  assert.ok(start > 0, 'Reschedule row missing');
  const block = src.slice(start, start + 1200);
  assert.match(block, /type="time"/);
  assert.match(block, /reschedule-time-/);
});

test('reschedulePost persists time with the date', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');
  const start = src.indexOf('async function reschedulePost');
  assert.ok(start > 0);
  const fn = src.slice(start, start + 700);
  assert.match(fn, /persistPostSchedule/);
  assert.match(fn, /reschedule-time-|newTime/);
});

