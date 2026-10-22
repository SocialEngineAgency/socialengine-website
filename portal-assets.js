// Per-client asset library helpers (quick-wins §8). Used by Settings → Brand
// and Animate Saved outros / music. No DOM, no fetch.
'use strict';

const ASSET_KINDS = ['outro', 'intro', 'music', 'logo', 'scene', 'character', 'plate', 'shot', 'item', 'setting', 'style', 'color', 'video'];
const KIND_LABEL = {
  outro: 'Outro', intro: 'Intro', music: 'Music', logo: 'Logo',
  scene: 'Scene', character: 'Character', plate: 'Plate', shot: 'Shot',
  item: 'Item', setting: 'Setting', style: 'Style', color: 'Color', video: 'Video',
};
const KIND_ACCEPT = {
  outro: 'video/*',
  intro: 'video/*',
  music: 'audio/*,video/*',
  logo: 'image/*',
  scene: 'image/*',
  character: 'image/*',
  plate: 'image/*',
  shot: 'video/*,image/*',
  item: 'image/*',
  setting: 'image/*',
  style: 'image/*',
  color: '',
  video: 'video/*',
};
const STILL_KINDS = ['scene', 'character', 'plate', 'logo', 'item', 'setting', 'style'];
const SECTION_KINDS = ['logo', 'color', 'character', 'item', 'setting', 'scene', 'style'];

// Coach chat can send 6 Library stills. One still per item: a multiview sheet's extra
// angles are the same reference, not more pictures. The offer names only what will go.
const COACH_REF_CAP = 6;
const OFFER_NAMES_SHOWN = 3;

function libraryOffer(list) {
  const usable = (Array.isArray(list) ? list : []).filter((a) => (
    a && ['character', 'item', 'setting', 'style'].includes(a.kind) && /^https?:\/\//i.test(String(a.url || ''))
  ));
  if (!usable.length) return null;
  const ids = usable.map((a) => a.id);
  const packed = coachChatReferences(usable, ids);
  const names = packed.refs.map((r) => r.title);
  const shown = names.slice(0, OFFER_NAMES_SHOWN).join(', ');
  const more = names.length > OFFER_NAMES_SHOWN ? ` and ${names.length - OFFER_NAMES_SHOWN} more` : '';
  const n = packed.refs.length;
  const total = usable.length;
  return {
    question: `Use ${n} picture${n === 1 ? '' : 's'} from your Library as ${n === 1 ? 'a reference' : 'references'} (${shown}${more})?${total > n ? ` You have ${total} in all; + Library lets you pick.` : ''}`,
    asset_ids: ids,
    images: n,
  };
}

// One https still per selected Library item, in the order the ids were picked.
// Character and item are subjects. Everything else is a look. Extra angles on
// asset.views are not added. Past 6, the rest are counted in omitted and dropped.
function coachChatReferences(list, ids) {
  const byId = new Map();
  for (const asset of (list || [])) {
    if (asset && asset.id != null) byId.set(String(asset.id), asset);
  }
  const order = (ids && ids.length)
    ? ids.map(String)
    : (list || []).map((asset) => String(asset && asset.id));
  const refs = [];
  const seen = new Set();
  for (const id of order) {
    const asset = byId.get(id);
    if (!asset) continue;
    const url = String(asset.url || '').trim();
    if (!/^https:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const kind = String(asset.kind || '');
    const subject = kind === 'character' || kind === 'item';
    refs.push({
      id: String(asset.id),
      url,
      title: String(asset.name || kind || 'Library').slice(0, 80),
      role: subject ? 'subject' : 'look',
      libraryRole: roleForKind(kind),
    });
  }
  return {
    refs: refs.slice(0, COACH_REF_CAP),
    total: refs.length,
    omitted: Math.max(0, refs.length - COACH_REF_CAP),
  };
}

// A later Library pick or upload is added onto the chips already showing.
// The same URL is not added twice. Past 6, the earlier chips stay and the rest are omitted.
function addCoachReferences(existing, incoming) {
  const refs = [];
  const seen = new Set();
  for (const raw of [...(existing || []), ...(incoming || [])]) {
    if (!raw || typeof raw !== 'object') continue;
    const url = String(raw.url || '').trim();
    if (!/^https:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const role = raw.role === 'look' || raw.role === 'source' || raw.role === 'subject' ? raw.role : 'subject';
    refs.push({
      id: raw.id ? String(raw.id) : '',
      url,
      title: String(raw.title || 'Reference').slice(0, 80),
      role,
      libraryRole: raw.libraryRole ? String(raw.libraryRole) : '',
    });
  }
  return {
    refs: refs.slice(0, COACH_REF_CAP),
    total: refs.length,
    omitted: Math.max(0, refs.length - COACH_REF_CAP),
  };
}

function roleForKind(kind) {
  if (kind === 'character') return 'character';
  if (kind === 'logo' || kind === 'style') return 'style';
  if (kind === 'item') return 'item';
  if (kind === 'setting') return 'setting';
  return 'scene';
}

function refsFromAssets(list, ids) {
  const want = new Set((ids || []).map(String));
  const refs = [];
  const seen = new Set();
  for (const asset of (list || [])) {
    if (!want.has(String(asset.id))) continue;
    const seed = String(asset.url || '').trim();
    if (seed && !seen.has(seed)) {
      seen.add(seed);
      refs.push({ url: seed, title: asset.name || asset.kind, role: roleForKind(asset.kind) });
    }
    for (const view of asset.views || []) {
      const url = String((view && view.url) || '').trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      refs.push({ url, title: `${asset.name || asset.kind} ${view.label || ''}`.trim(), role: roleForKind(asset.kind) });
    }
  }
  return refs.slice(0, 8);
}

function persistFamily(kind) {
  const k = String(kind || '').trim();
  if (k === 'color') return 'color';
  if (k === 'music') return 'audio';
  if (['outro', 'intro', 'shot', 'video'].includes(k)) return 'video';
  if (STILL_KINDS.includes(k)) return 'image';
  return '';
}

function retagKinds(kind) {
  const family = persistFamily(kind);
  return ASSET_KINDS.filter((k) => persistFamily(k) === family);
}

function isStillKind(kind) {
  return STILL_KINDS.includes(String(kind || '').trim());
}

function isAssetKind(kind) {
  return ASSET_KINDS.includes(String(kind || '').trim());
}

function acceptFor(kind) {
  return KIND_ACCEPT[String(kind || '').trim()] || '';
}

function kindLabel(kind) {
  return KIND_LABEL[String(kind || '').trim()] || 'Asset';
}

function labelOf(asset) {
  const name = String(asset?.name || '').trim();
  return name || kindLabel(asset?.kind);
}

function filterKind(list, kind) {
  if (!kind) return Array.isArray(list) ? list.slice() : [];
  return (list || []).filter((a) => a && a.kind === kind);
}

function filterCollection(list, collection) {
  const want = String(collection || '').trim().toLowerCase();
  if (!want) return Array.isArray(list) ? list.slice() : [];
  return (list || []).filter((a) => a && String(a.collection || '').trim().toLowerCase() === want);
}

function selectedId(list, url) {
  const want = String(url || '').trim();
  if (!want) return '';
  const hit = (list || []).find((a) => a && a.url === want);
  return hit ? String(hit.id || '') : '';
}

function selectedUrl(list, id) {
  const want = String(id || '').trim();
  if (!want) return '';
  const hit = (list || []).find((a) => a && a.id === want);
  return hit ? String(hit.url || '') : '';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ASSET_KINDS, STILL_KINDS, SECTION_KINDS, isAssetKind, isStillKind, acceptFor, kindLabel, labelOf,
    filterKind, filterCollection, selectedId, selectedUrl, libraryOffer, roleForKind, refsFromAssets,
    coachChatReferences, addCoachReferences, COACH_REF_CAP, persistFamily, retagKinds,
  };
}
if (typeof window !== 'undefined') {
  window.SEAssets = {
    ASSET_KINDS, STILL_KINDS, SECTION_KINDS, isAssetKind, isStillKind, acceptFor, kindLabel, labelOf,
    filterKind, filterCollection, selectedId, selectedUrl, libraryOffer, roleForKind, refsFromAssets,
    coachChatReferences, addCoachReferences, COACH_REF_CAP, persistFamily, retagKinds,
  };
}
