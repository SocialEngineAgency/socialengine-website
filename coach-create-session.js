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

function isCoachMetaBrief(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return true;
  return /i (can't|cannot) execute|can't generate video|can't press a button|cannot press a button|button that should appear|button isn't rendering|if the button still isn't|refresh your socialengine|contact your socialengine|latest version of the platform|canva\.com|canva pro|synthesia|socialengine account manager|i can only write the strategy|we're in a loop/.test(t);
}

function stripCoachButtonFiller(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/this should now render[^.!?\n]*[.!?]?/gi, ' ')
    .replace(/click ["'][^"']*create this now["']\s*(and\s+)?/gi, ' ')
    .replace(/you need to click[^.!?\n]*[.!?]?/gi, ' ')
    .replace(/i understand[^.!?\n]*[.!?]?/gi, ' ')
    .replace(/i (can't|cannot) execute[^.!?\n]*[.!?]?/gi, ' ')
    .replace(/if the button still isn't[\s\S]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferCreateActionFromReply(reply, userMessage, priorTexts) {
  const blob = [reply, ...(priorTexts || [])].join(' ').toLowerCase();
  if (!/create this now|generate this|one-click button|canva\.com|canva pro|synthesia|socialengine account manager|\[create_content\]|can't press a button|cannot press a button|button isn't rendering/.test(blob)) return null;
  const user = String(userMessage || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const candidates = [stripCoachButtonFiller(reply)];
  for (const prev of priorTexts || []) candidates.push(stripCoachButtonFiller(prev));
  if (user.length >= 20 && !isCoachMetaBrief(user)) candidates.push(user);
  let prompt = '';
  for (const c of candidates) {
    if (c && c.length >= 20 && !isCoachMetaBrief(c)) { prompt = c.slice(0, 400); break; }
  }
  if (!prompt) return null;
  const destination = (/\banimat|\bvoice[- ]?over\b|\bmulti[- ]?shot\b/.test(`${blob} ${prompt}`))
    ? 'animate'
    : 'studio';
  return normalizeCoachCreateSession({
    prompt,
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
  module.exports = { normalizeCoachCreateSession, coachCreateNav, applyCoachCreateFields, inferCreateActionFromReply, isCoachMetaBrief };
}
if (typeof window !== 'undefined') {
  window.normalizeCoachCreateSession = normalizeCoachCreateSession;
  window.coachCreateNav = coachCreateNav;
  window.applyCoachCreateFields = applyCoachCreateFields;
  window.inferCreateActionFromReply = inferCreateActionFromReply;
  window.isCoachMetaBrief = isCoachMetaBrief;
}
