// Per-client asset library helpers (quick-wins §8). Used by Settings → Brand
// and Animate Saved outros / music. No DOM, no fetch.
'use strict';

const ASSET_KINDS = ['outro', 'intro', 'music', 'logo', 'scene', 'character', 'plate', 'shot', 'item', 'setting', 'color'];
const KIND_LABEL = {
  outro: 'Outro', intro: 'Intro', music: 'Music', logo: 'Logo',
  scene: 'Scene', character: 'Character', plate: 'Plate', shot: 'Shot',
  item: 'Item', setting: 'Setting', color: 'Color',
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
  color: '',
};
const STILL_KINDS = ['scene', 'character', 'plate', 'logo', 'item', 'setting'];
const SECTION_KINDS = ['logo', 'color', 'character', 'item', 'setting', 'scene'];

function libraryOffer(list) {
  const usable = (Array.isArray(list) ? list : []).filter((a) => (
    a && ['character', 'item', 'setting'].includes(a.kind) && /^https?:\/\//i.test(String(a.url || ''))
  ));
  if (!usable.length) return null;
  const names = usable.map((a) => String(a.name || a.kind));
  const last = names.pop();
  const label = names.length ? `${names.join(', ')} and ${last}` : last;
  return {
    question: `Use ${label} from your Library?`,
    asset_ids: usable.map((a) => a.id),
  };
}

function roleForKind(kind) {
  if (kind === 'character') return 'character';
  if (kind === 'logo') return 'style';
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
  if (['outro', 'intro', 'shot'].includes(k)) return 'video';
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
    persistFamily, retagKinds,
  };
}
if (typeof window !== 'undefined') {
  window.SEAssets = {
    ASSET_KINDS, STILL_KINDS, SECTION_KINDS, isAssetKind, isStillKind, acceptFor, kindLabel, labelOf,
    filterKind, filterCollection, selectedId, selectedUrl, libraryOffer, roleForKind, refsFromAssets,
    persistFamily, retagKinds,
  };
}
