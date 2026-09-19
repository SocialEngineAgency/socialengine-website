// Per-client asset library helpers (quick-wins §8). Used by Settings → Brand
// and Animate Saved outros / music. No DOM, no fetch.
'use strict';

const ASSET_KINDS = ['outro', 'intro', 'music', 'logo', 'scene', 'character', 'plate', 'shot'];
const KIND_LABEL = {
  outro: 'Outro', intro: 'Intro', music: 'Music', logo: 'Logo',
  scene: 'Scene', character: 'Character', plate: 'Plate', shot: 'Shot',
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
};
const STILL_KINDS = ['scene', 'character', 'plate', 'logo'];

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
    ASSET_KINDS, STILL_KINDS, isAssetKind, isStillKind, acceptFor, kindLabel, labelOf,
    filterKind, filterCollection, selectedId, selectedUrl,
  };
}
if (typeof window !== 'undefined') {
  window.SEAssets = {
    ASSET_KINDS, STILL_KINDS, isAssetKind, isStillKind, acceptFor, kindLabel, labelOf,
    filterKind, filterCollection, selectedId, selectedUrl,
  };
}
