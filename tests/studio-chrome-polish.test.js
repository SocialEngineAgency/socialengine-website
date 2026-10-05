'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const anim = fs.readFileSync(path.join(__dirname, '..', 'animation-studio.js'), 'utf8');
const portal = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');

function renderVideoStudioSlice() {
  const start = portal.indexOf('function renderVideoStudio()');
  assert.ok(start >= 0, 'missing renderVideoStudio');
  const end = portal.indexOf('window.renderVideoStudio', start);
  assert.ok(end > start, 'missing window.renderVideoStudio after function');
  return portal.slice(start, end);
}

test('Animate chrome uses merchant titles, not lab names', () => {
  const asideAt = anim.indexOf('<aside class="anim-chat">');
  assert.ok(asideAt >= 0);
  const shell = anim.slice(anim.indexOf('<div class="anim-shell">'), anim.indexOf('</aside>', asideAt) + 8);
  assert.match(shell, /<h2>Animate<\/h2>/);
  assert.match(shell, /<h3>Coach<\/h3>/);
  assert.doesNotMatch(shell, /Animation Studio|AI Agent/);
});

test('Animate empty and error copy avoid CDN / ephemeral / stack jargon', () => {
  assert.doesNotMatch(anim, /ephemeral links|fal stack|FAL_KEY|Seedream|DreamActor needs/i);
  assert.match(anim, /tag refs as/);
  assert.match(anim, /Uploads stay saved|saved on your account|stay with the project/i);
});

test('Video make-flow drops emoji templates and the duplicate Create Video CTA', () => {
  const vs = renderVideoStudioSlice();
  assert.doesNotMatch(vs, /icon:\s*'[^\x00-\x7F]|icon:\s*"[\u{1F300}-\u{1FAFF}]/u);
  assert.doesNotMatch(vs, /📱|📦|🎲|🎬|✨|👗|⭐|⚡|📚/);
  assert.doesNotMatch(vs, /Quick Generate/);
  assert.doesNotMatch(vs, /Create Video from Your Products/);
  assert.match(vs, /Generate from a still|Make a video|Generate video/i);
});

test('Video AI Models catalog is collapsed, not a full page section', () => {
  const vs = renderVideoStudioSlice();
  // Must not be a top-level always-open dash-card heading customers scroll past.
  assert.doesNotMatch(vs, /<!-- Models Reference -->[\s\S]*?<h3[^>]*>\s*<svg[^>]*>[\s\S]*?AI Models/);
  assert.match(vs, /<details[\s\S]*AI models|Available models/i);
});
