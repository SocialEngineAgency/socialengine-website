'use strict';

function normalizeCoachCreateSession(intent = {}) {
  const prompt = String(intent.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!prompt) return null;
  const destination = String(intent.destination || '').trim().toLowerCase() === 'animate'
    ? 'animate'
    : 'studio';
  const rawUrl = String(intent.attached_image_url || '').trim();
  const attached_image_url = /^https?:\/\//i.test(rawUrl) ? rawUrl : '';
  return {
    type: 'create',
    prompt,
    product_name: String(intent.product_name || '').slice(0, 160),
    mode: intent.mode === 'image' ? 'image' : 'video',
    aspect_ratio: ['9:16', '1:1', '16:9'].includes(intent.aspect_ratio) ? intent.aspect_ratio : '9:16',
    destination,
    attached_image_url,
  };
}

function coachCreateNav(session) {
  return session && session.destination === 'animate' ? 'animation-studio' : 'creation-studio';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeCoachCreateSession, coachCreateNav };
}
if (typeof window !== 'undefined') {
  window.normalizeCoachCreateSession = normalizeCoachCreateSession;
  window.coachCreateNav = coachCreateNav;
}
