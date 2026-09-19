'use strict';

function emptyDesignWorkspace() {
  return {
    generatedUrl: null,
    html: '',
    carousel: null,
    ref: null,
    originalPreviewUrl: null,
    queueSingleUrl: null,
    designId: null,
    lastPlan: null,
    brief: '',
    styleUrls: [],
    cleared: false,
  };
}

function startFreshWorkspace(workspace = {}) {
  return {
    ...emptyDesignWorkspace(),
    styleUrls: Array.isArray(workspace.styleUrls) ? workspace.styleUrls.slice() : [],
    cleared: true,
  };
}

function hasCarousel(workspace) {
  return !!(workspace && workspace.carousel && Array.isArray(workspace.carousel.slides) && workspace.carousel.slides.length >= 2);
}

function shouldRestoreLastDesign(workspace, last) {
  if (!workspace || workspace.cleared) return false;
  if (workspace.generatedUrl || workspace.html || hasCarousel(workspace)) return false;
  return !!(last && /^https?:\/\//i.test(String(last.image_url || '')));
}

function upsertLibraryItem(items, row) {
  const next = Array.isArray(items) ? items.slice() : [];
  const item = {
    id: String((row && row.id) || `local-${Date.now()}`),
    image_url: String((row && row.image_url) || ''),
    title: String((row && row.title) || 'Saved design').slice(0, 80),
    status: (row && row.status) === 'archived' ? 'archived' : 'saved',
    saved_at: Number((row && row.saved_at) || Date.now()),
    scene: row && row.scene ? row.scene : null,
  };
  const idx = next.findIndex((it) => it.id === item.id);
  if (idx >= 0) next[idx] = { ...next[idx], ...item };
  else next.unshift(item);
  return next;
}

function archiveLibraryItem(items, id) {
  const key = String(id || '');
  return (Array.isArray(items) ? items : []).map((it) => (
    it && it.id === key ? { ...it, status: 'archived' } : it
  ));
}

function formatSlideHttpsUrls({ styleUrls = [], carouselSlides = [] } = {}) {
  const styles = (Array.isArray(styleUrls) ? styleUrls : [])
    .map((u) => String(u || '').trim())
    .filter((u) => /^https:\/\//i.test(u));
  if (styles.length >= 2) return styles;
  return (Array.isArray(carouselSlides) ? carouselSlides : [])
    .map((s) => String((typeof s === 'string' ? s : s && s.url) || '').trim())
    .filter((u) => /^https:\/\//i.test(u));
}

function deleteLibraryItem(items, id) {
  const key = String(id || '');
  return (Array.isArray(items) ? items : []).filter((it) => it && it.id !== key);
}

const designWorkspaceApi = {
  emptyDesignWorkspace,
  startFreshWorkspace,
  shouldRestoreLastDesign,
  upsertLibraryItem,
  archiveLibraryItem,
  deleteLibraryItem,
  formatSlideHttpsUrls,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = designWorkspaceApi;
}
if (typeof window !== 'undefined') {
  window.designWorkspaceApi = designWorkspaceApi;
}
