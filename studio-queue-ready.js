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

function normalizeReviewCaption(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/#[\w]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 160);
}

function isLiveSocialPost(post = {}) {
  if (post._live || post._source === 'social') return true;
  return /^(ig_|fb_reel_|fb_)/i.test(String(post.id || ''));
}

function reviewDedupeKeys(post = {}) {
  const keys = [];
  const id = String(post.id || '').trim();
  if (id) keys.push(`id:${id}`);
  const pubs = [post.permalink, post.platform_post_id, post.publish_post_id]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(',')
    .split(/[,\s]+/)
    .filter(Boolean);
  pubs.forEach((part) => keys.push(`pub:${part}`));
  const caption = normalizeReviewCaption(post.caption || post.full_post_text);
  if (caption.length >= 20) keys.push(`cap:${caption}`);
  if (post.image_fallback !== 'shopify_catalog') {
    const raw = String(post.image_url || post.video_url || post.thumbnail_url || '').trim();
    if (raw) {
      try {
        const url = new URL(raw);
        keys.push(`media:${url.origin}${url.pathname}`);
      } catch {
        keys.push(`media:${raw.split('?')[0]}`);
      }
    }
  }
  return keys;
}

function dedupeContentForReview(posts) {
  const rows = Array.isArray(posts) ? posts : [];
  const owned = rows.filter((p) => !isLiveSocialPost(p));
  const live = rows.filter((p) => isLiveSocialPost(p));
  const seen = new Set();
  const out = [];
  const add = (p) => {
    const keys = reviewDedupeKeys(p);
    if (keys.length && keys.some((k) => seen.has(k))) return;
    keys.forEach((k) => seen.add(k));
    out.push(p);
  };
  owned.forEach(add);
  live.forEach(add);
  return out;
}

function postsForContentReview(posts) {
  return dedupeContentForReview(sortPostsForReview(posts));
}

function isArchivedPost(post = {}) {
  return /^archived$/i.test(String(post.status || ''));
}

function homeQueuePosts(posts) {
  return postsForContentReview(posts).filter((p) => !isArchivedPost(p));
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
    postsForContentReview,
    dedupeContentForReview,
    isArchivedPost,
    homeQueuePosts,
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
    postsForContentReview,
    dedupeContentForReview,
    isArchivedPost,
    homeQueuePosts,
  };
}
