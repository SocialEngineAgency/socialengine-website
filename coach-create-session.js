'use strict';

const COACH_PROMPT_MAX = 8000;
const STUDIO_DURATIONS = [5, 10];
const ANIM_FORMATS = ['awareness-15s', 'mythbust-20s', 'product-demo-15s', 'remix-24s'];

function normalizeCoachPrompt(text) {
  return String(text || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, COACH_PROMPT_MAX);
}

function normalizeCoachDuration(value) {
  const n = Number(value);
  return STUDIO_DURATIONS.includes(n) ? n : 0;
}

function normalizeCoachFormat(value) {
  return ANIM_FORMATS.includes(String(value || '')) ? String(value) : '';
}

function normalizeCoachEntry(value) {
  return value === 'vo' ? 'vo' : (value === 'prompt' ? 'prompt' : '');
}

function inferCoachSessionExtras(text) {
  const t = String(text || '').toLowerCase();
  let duration = 0;
  if (/\b10\s*s|\b15\s*s|\b20\s*s|\b24\s*s|\b25-?30|\b30\s*s/.test(t)) duration = 10;
  else if (/\b5\s*s(ec|econds?)?\b/.test(t)) duration = 5;

  let format_template_id = '';
  if (/myth/.test(t)) format_template_id = 'mythbust-20s';
  else if (/product[- ]?demo/.test(t)) format_template_id = 'product-demo-15s';
  else if (/\b24\s*s|\b25-?30|\bremix/.test(t)) format_template_id = 'remix-24s';
  else if (/\b15\s*s|\bawareness/.test(t)) format_template_id = 'awareness-15s';

  let entry = '';
  if (/\bframe\s*\d|\bshot\s*\d/.test(t)) entry = 'prompt';
  else if (/\bvo\b|voice[- ]?over|script/.test(t)) entry = 'vo';

  return { duration, format_template_id, entry };
}

function isCoachVideoBrief(text) {
  return /\b(animate|animation|8\s*second|seconds?\s+video|\breels?\b|image-to-video|i2v|motion\s+along|poses?\s+and\s+moves|voice[- ]?over|multi[- ]?shot|frame\s*\d|shot\s*\d|25\s*[-–]?\s*30\s*s)\b/i.test(String(text || ''));
}

function isCoachDesignAsk(text) {
  return /\bcarousel\b|\binfographic\b|\bslides?\b|\bslide deck\b|\bfigurelabs\b|\btall graphic\b/.test(String(text || '').toLowerCase());
}

function isCoachFailedReply(reply) {
  return /^\s*sorry,\s*brain freeze/i.test(String(reply || ''));
}

function isCoachCarouselRedesignAsk(userMessage) {
  const t = String(userMessage || '').toLowerCase();
  return /\bredesign\b/.test(t) && /\b(carousel|slides?)\b/.test(t);
}

function coachUserStatedNewBrief(userMessage) {
  return /\b(make|create|generate|render|shoot)\b.{0,80}\b(reel|video|clip|post|carousel|infographic|slides?)\b/.test(String(userMessage || '').toLowerCase());
}

function inferCoachDestinationFromText(text) {
  const t = String(text || '').toLowerCase();
  const design = isCoachDesignAsk(t);
  const video = isCoachVideoBrief(t);
  if (design && !video) return 'design';
  if (video) {
    if (/\banimat|\bvoice[- ]?over\b|\bmulti[- ]?shot\b|\bframe\s*\d|\bshot\s*\d|\b25\s*[-–]?\s*30|\b15\s*s|\b20\s*s|\b24\s*s/.test(t)) {
      return 'animate';
    }
    return 'studio';
  }
  if (design) return 'design';
  return 'studio';
}

function inferCoachDestination(text, userMessage) {
  if (coachUserStatedNewBrief(userMessage)) {
    if (isCoachDesignAsk(userMessage)) return 'design';
    return inferCoachDestinationFromText(userMessage);
  }
  return inferCoachDestinationFromText(text);
}

function normalizeCoachDestination(value, text) {
  const inferred = inferCoachDestination(text);
  const d = String(value || '').trim().toLowerCase();
  let dest = (d === 'animate' || d === 'design' || d === 'studio')
    ? d
    : ((d === 'carousel' || d === 'post') ? 'design' : inferred);
  if (dest === 'design' && isCoachVideoBrief(text)) {
    dest = inferred === 'design' ? 'animate' : inferred;
  }
  return dest;
}

function normalizeCoachCreateSession(intent = {}) {
  const prompt = normalizeCoachPrompt(intent.prompt);
  if (!prompt) return null;
  const destination = normalizeCoachDestination(intent.destination, prompt);
  const rawUrl = String(intent.attached_image_url || '').trim();
  const attached_image_url = /^https?:\/\//i.test(rawUrl) ? rawUrl : '';
  const extras = inferCoachSessionExtras(prompt);
  return {
    type: 'create',
    prompt,
    product_name: String(intent.product_name || '').slice(0, 160),
    mode: intent.mode === 'image' ? 'image' : 'video',
    aspect_ratio: ['9:16', '1:1', '16:9'].includes(intent.aspect_ratio) ? intent.aspect_ratio : '9:16',
    destination,
    attached_image_url,
    duration: normalizeCoachDuration(intent.duration) || extras.duration,
    format_template_id: normalizeCoachFormat(intent.format_template_id) || extras.format_template_id,
    entry: normalizeCoachEntry(intent.entry) || extras.entry,
  };
}

function coachCreateNav(session) {
  if (!session) return 'creation-studio';
  if (session.destination === 'animate') return 'animation-studio';
  if (session.destination === 'design') return 'design-studio';
  return 'creation-studio';
}

function isCoachMetaBrief(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return true;
  return /i (can't|cannot) execute|can't generate video|can't press a button|cannot press a button|button that should appear|button isn't rendering|if the button still isn't|refresh your socialengine|contact your socialengine|latest version of the platform|canva\.com|canva pro|synthesia|socialengine account manager|i can only write the strategy|we're in a loop|create this now is below|opens studio or animate with the brief/.test(t);
}

function stripCoachButtonFiller(text) {
  return normalizeCoachPrompt(String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/this should now render[^.!?\n]*[.!?]?/gi, ' ')
    .replace(/click ["'][^"']*create this now["']\s*(and\s+)?/gi, ' ')
    .replace(/you need to click[^.!?\n]*[.!?]?/gi, ' ')
    .replace(/i understand[^.!?\n]*[.!?]?/gi, ' ')
    .replace(/i (can't|cannot) execute[^.!?\n]*[.!?]?/gi, ' ')
    .replace(/if the button still isn't[\s\S]*/gi, ' '));
}

function isCoachDesignRefineAsk(userMessage, hasCanvas) {
  if (!hasCanvas) return false;
  if (isCoachCarouselRedesignAsk(userMessage)) return false;
  const t = String(userMessage || '').toLowerCase();
  if (!t.trim()) return false;
  const asksNew = /\b(make|create|generate)\b.{0,50}\b(new |a )?(poster|graphic|infographic|carousel)\b/.test(t)
    && !/\b(bigger|smaller|tweak|change|fix|remove|darker|lighter|title|headline)\b/.test(t);
  if (asksNew) return false;
  return /\b(bigger|smaller|darker|lighter|tweak|change|fix|remove|drop|replace|move|redo|regenerat|another|title|headline|cta|button|color|font|background|spacing|make the)\b/.test(t);
}

function resolveDesignCoachApply({ reply = '', userMessage = '', hasCanvas = false, actions = [] } = {}) {
  if (isCoachFailedReply(reply)) return { mode: 'none' };
  const list = Array.isArray(actions) ? actions : [];
  const carousel = list.find((a) => a && a.type === 'carousel_redesign');
  if (carousel) return { mode: 'confirm_carousel', action: carousel };
  const create = list.find((a) => a && a.type === 'create');
  if (create && isCoachDesignRefineAsk(userMessage, hasCanvas)) {
    return { mode: 'refine', prompt: create.prompt || userMessage, action: create };
  }
  if (create && create.destination === 'design') {
    return { mode: 'confirm_generate', prompt: create.prompt || userMessage, action: create };
  }
  if (isCoachDesignRefineAsk(userMessage, hasCanvas)) {
    return { mode: 'refine', prompt: userMessage };
  }
  const t = String(userMessage || '').toLowerCase();
  if (!hasCanvas && /\b(make|create|generate|design)\b/.test(t) && /\b(poster|graphic|infographic|carousel|slides?|design)\b/.test(t)) {
    return { mode: 'confirm_generate', prompt: (create && create.prompt) || userMessage, action: create || null };
  }
  return { mode: 'none' };
}

function inferCreateActionFromReply(reply, userMessage, priorTexts) {
  if (isCoachFailedReply(reply) || isCoachCarouselRedesignAsk(userMessage)) return null;
  const blob = [reply, ...(priorTexts || [])].join(' ').toLowerCase();
  if (!/create this now|generate this|one-click button|canva\.com|canva pro|synthesia|socialengine account manager|\[create_content\]|can't press a button|cannot press a button|button isn't rendering/.test(blob)) return null;
  const user = normalizeCoachPrompt(String(userMessage || '').replace(/<[^>]+>/g, ' '));
  if (coachUserStatedNewBrief(userMessage) && user.length >= 20 && !isCoachMetaBrief(user)) {
    const destination = inferCoachDestination(userMessage, userMessage);
    return normalizeCoachCreateSession({
      prompt: user,
      mode: destination === 'design' ? 'image' : 'video',
      aspect_ratio: '9:16',
      destination,
    });
  }
  const candidates = [stripCoachButtonFiller(reply)];
  for (const prev of priorTexts || []) candidates.push(stripCoachButtonFiller(prev));
  if (user.length >= 20 && !isCoachMetaBrief(user)) candidates.push(user);
  const usable = candidates.filter((c) => c && c.length >= 20 && !isCoachMetaBrief(c));
  if (!usable.length) return null;
  usable.sort((a, b) => b.length - a.length);
  const prompt = usable[0];
  const destination = inferCoachDestination(`${blob} ${prompt}`);
  return normalizeCoachCreateSession({
    prompt,
    mode: destination === 'design' ? 'image' : 'video',
    aspect_ratio: '9:16',
    destination,
  });
}

function sessionApplyExtras(session) {
  return {
    duration: session.duration || 0,
    format_template_id: session.format_template_id || '',
    entry: session.entry || '',
  };
}

function applyCoachCreateFields(session, fields) {
  if (!session || !session.prompt) return { applied: false, keep: true };
  if (session.destination === 'design') {
    if (!fields || !fields.csBrief) return { applied: false, keep: true };
    return {
      applied: true,
      keep: true,
      prompt: session.prompt,
      product_name: session.product_name || '',
      attached_image_url: session.attached_image_url || '',
    };
  }
  if (session.destination === 'animate') {
    if (!fields || !fields.animPrompt) return { applied: false, keep: true };
    return Object.assign({
      applied: true,
      keep: true,
      animPrompt: session.prompt,
      attached_image_url: session.attached_image_url || '',
    }, sessionApplyExtras(session));
  }
  if (!fields || !fields.dir) return { applied: false, keep: true };
  return Object.assign({
    applied: true,
    keep: true,
    prompt: session.prompt,
    product_name: session.product_name || '',
    aspect_ratio: session.aspect_ratio || '',
    attached_image_url: session.attached_image_url || '',
  }, sessionApplyExtras(session));
}

function hasStudioStill(imageUrl) {
  const u = String(imageUrl || '').trim();
  return /^https?:\/\//i.test(u) || u.startsWith('data:');
}

function studioGenerateMode(imageUrl) {
  return hasStudioStill(imageUrl) ? 'image-to-video' : 'text-to-video';
}

function studioModelForMode(model, imageUrl) {
  const m = String(model || '');
  if (hasStudioStill(imageUrl)) return m;
  return m.replace(/-i2v\b/i, '-t2v');
}

function titleFromCoachBrief(productName, prompt) {
  const name = String(productName || '').trim();
  if (name) return name.slice(0, 160);
  const first = String(prompt || '').split('\n').find((l) => l.trim());
  return (first || 'Video').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function unescapeCoachEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function coachReplyToPlain(text) {
  let s = unescapeCoachEntities(String(text || ''));
  if (/&lt;(\/?)\s*(br|strong|b|em|i|p|div|li|ul|ol|span|h[1-6])\b/i.test(s)) {
    s = unescapeCoachEntities(s);
  }
  s = s
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\s*(strong|b)\s*>/gi, '**')
    .replace(/<\/\s*(strong|b)\s*>/gi, '**')
    .replace(/<\s*(em|i)\s*>/gi, '*')
    .replace(/<\/\s*(em|i)\s*>/gi, '*')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s;
}

function escapeCoachHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatCoachReplyHtml(text) {
  const plain = coachReplyToPlain(text);
  if (!plain) return '';
  const blocks = plain.split(/\n\n+/);
  return blocks.map((block, i) => {
    const lines = block.split('\n').map((line) => {
      let e = escapeCoachHtml(line);
      e = e.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      e = e.replace(/(^|[\s(])\*(?!\*)([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
      e = e.replace(/^[-•]\s+/, '• ');
      return e;
    }).join('<br>');
    const margin = i === blocks.length - 1 ? '0' : '0 0 0.75em';
    return `<p style="margin:${margin};line-height:1.55;">${lines}</p>`;
  }).join('');
}

function persistCoachHistoryEntry(role, text, extra = {}) {
  const entry = { role, text, time: extra.time || '' };
  if (role === 'assistant' && Array.isArray(extra.actions) && extra.actions.length) {
    const actions = extra.actions.filter((a) => a && a.type === 'create' && a.prompt);
    if (actions.length) entry.actions = actions;
  }
  return entry;
}

const coachSessionApi = {
  normalizeCoachCreateSession,
  coachCreateNav,
  inferCoachDestination,
  applyCoachCreateFields,
  inferCreateActionFromReply,
  isCoachFailedReply,
  isCoachCarouselRedesignAsk,
  isCoachDesignRefineAsk,
  resolveDesignCoachApply,
  isCoachMetaBrief,
  persistCoachHistoryEntry,
  formatCoachReplyHtml,
  coachReplyToPlain,
  studioGenerateMode,
  studioModelForMode,
  titleFromCoachBrief,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = coachSessionApi;
}
if (typeof window !== 'undefined') {
  Object.assign(window, coachSessionApi);
}
