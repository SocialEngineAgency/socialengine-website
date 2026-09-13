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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { queueableSingleImage, captionForQueue };
}
if (typeof window !== 'undefined') {
  window.studioQueueReady = { queueableSingleImage, captionForQueue };
}
