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

function inferCreateActionFromReply(reply, userMessage) {
  const t = String(reply || '').toLowerCase();
  if (!/create this now|generate this|one-click button/.test(t)) return null;
  const fromUser = String(userMessage || '').replace(/\s+/g, ' ').trim();
  const fromReply = String(reply || '').replace(/\s+/g, ' ').trim();
  const destination = (/\banimat|\bvoice[- ]?over\b|\bmulti[- ]?shot\b/.test(`${t} ${fromUser}`))
    ? 'animate'
    : 'studio';
  return normalizeCoachCreateSession({
    prompt: fromUser.length >= 12 ? fromUser : (fromReply || fromUser),
    mode: 'video',
    aspect_ratio: '9:16',
    destination,
  });
}

function applyCoachCreateFields(session, fields) {
  if (!session || !session.prompt) return { applied: false, keep: true };
  if (session.destination === 'animate') {
    if (!fields || !fields.animPrompt) return { applied: false, keep: true };
    return {
      applied: true,
      keep: true,
      animPrompt: session.prompt,
      attached_image_url: session.attached_image_url || '',
    };
  }
  if (!fields || !fields.dir) return { applied: false, keep: true };
  return {
    applied: true,
    keep: true,
    prompt: session.prompt,
    product_name: session.product_name || '',
    aspect_ratio: session.aspect_ratio || '',
    attached_image_url: session.attached_image_url || '',
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeCoachCreateSession, coachCreateNav, applyCoachCreateFields, inferCreateActionFromReply };
}
if (typeof window !== 'undefined') {
  window.normalizeCoachCreateSession = normalizeCoachCreateSession;
  window.coachCreateNav = coachCreateNav;
  window.applyCoachCreateFields = applyCoachCreateFields;
  window.inferCreateActionFromReply = inferCreateActionFromReply;
}
