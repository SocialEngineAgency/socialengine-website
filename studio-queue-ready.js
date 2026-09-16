'use strict';

function queueableSingleImage({ carousel = false, designed = false, imageUrl = '', type = 'image' } = {}) {
  if (carousel || designed) return '';
  if (type === 'video') return '';
  return String(imageUrl || '').trim();
}

function captionForQueue({ typedCaption = '', generatedCaption = '', brief = '' } = {}) {
  const typed = String(typedCaption || '').trim();
  if (typed) return typed;
  const generated = String(generatedCaption || '').trim();
  if (generated) return generated;
  return String(brief || '').trim();
}

function queueReviewStatus() {
  return 'Pending';
}

function openContentReviewAfterQueue(doc) {
  const root = doc || (typeof document !== 'undefined' ? document : null);
  const nav = root && root.querySelector && root.querySelector('[data-nav=content]');
  if (!nav || typeof nav.click !== 'function') return false;
  nav.click();
  return true;
}

function cardMediaSrc(url, apiBase) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/\/api\/(media-fetch|video-proxy)|\b\/api\/media\//i.test(u)) return u;
  if (/(aliyuncs\.com|atlascloud\.ai|higgsfield\.ai|cloudfront\.net)/i.test(u)) {
    const base = String(apiBase || '').replace(/\/$/, '');
    return `${base}/api/media-fetch?url=${encodeURIComponent(u)}`;
  }
  return u;
}

function contentReviewWhen(post = {}) {
  return String(post.created_at || post.createdTime || post.scheduled_date || '');
}

function sortPostsForReview(posts) {
  return (Array.isArray(posts) ? posts : []).slice().sort((a, b) => (
    contentReviewWhen(b).localeCompare(contentReviewWhen(a))
  ));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    queueableSingleImage,
    captionForQueue,
    queueReviewStatus,
    openContentReviewAfterQueue,
    cardMediaSrc,
    contentReviewWhen,
    sortPostsForReview,
  };
}
if (typeof window !== 'undefined') {
  window.studioQueueReady = {
    queueableSingleImage,
    captionForQueue,
    queueReviewStatus,
    openContentReviewAfterQueue,
    cardMediaSrc,
    contentReviewWhen,
    sortPostsForReview,
  };
}
