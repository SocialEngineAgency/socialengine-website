'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const VC = require('../video-coach.js');

test('only a clip brief for the Studio form is picked up', () => {
  assert.equal(VC.pickVideoBrief(null), null);
  assert.equal(VC.pickVideoBrief([{ type: 'create', mode: 'image', destination: 'design', prompt: 'poster' }]), null);
  assert.equal(VC.pickVideoBrief([{ type: 'create', mode: 'video', destination: 'animate', prompt: 'reel' }]), null);
  assert.equal(VC.pickVideoBrief([{ type: 'create', mode: 'video', destination: 'studio', prompt: '  ' }]), null);
  const hit = VC.pickVideoBrief([{ type: 'agent_run' }, { type: 'create', prompt: 'slow push-in on the mug' }]);
  assert.equal(hit.mode, 'video');
  assert.equal(hit.destination, 'studio');
});

test('panel shows starter chips only before the first message, and escapes what people type', () => {
  assert.match(VC.panelHtml([]), /vsc-chip/);
  const html = VC.panelHtml([{ role: 'user', text: '<img src=x onerror=1>' }, { role: 'assistant', text: 'ok', brief: { prompt: 'p' }, loaded: false }]);
  assert.doesNotMatch(html, /vsc-chip"/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /data-vsc-load="1"/);
});

test('ask() sends surface video, loads the brief, and keeps the conversation', async () => {
  global.window = {};
  const sent = [];
  const out = await VC.ask('a mug video', {
    post: async (b) => { sent.push(b); return { ok: true, json: async () => ({ reply: 'Loading it.', coach_actions: [{ type: 'create', prompt: 'steam on a mug' }] }) }; },
    loadBrief: () => true,
  });
  // The Video tab's own chat (no chat picked yet: the server uses the tab's chat).
  assert.deepEqual(sent, [{ message: 'a mug video', surface: 'video', create_tab: 'video' }]);
  assert.equal(out.loaded, true);
  assert.deepEqual(VC.logStore().map((m) => m.role), ['user', 'assistant']);
  await assert.rejects(VC.ask('again', { post: async () => ({ ok: false }) }), /could not answer/);
  delete global.window;
});

test('ask() talks in the chat picked for the Video tab, and keeps the one the reply used', async () => {
  global.window = {};
  const sent = [];
  const kept = [];
  const threads = {
    ensure: async () => ({ projectId: 'p1', threadId: 't1' }),
    current: () => null,
    fromReply: (tab, data) => kept.push([tab, data.threadId]),
  };
  await VC.ask('a reel', {
    post: async (b) => { sent.push(b); return { ok: true, json: async () => ({ reply: 'Sure.', threadId: 't1', projectId: 'p1' }) }; },
    loadBrief: () => false,
    threads,
  });
  assert.deepEqual(sent, [{ message: 'a reel', surface: 'video', create_tab: 'video', threadId: 't1', projectId: 'p1' }]);
  assert.deepEqual(kept, [['video', 't1']]);
  delete global.window;
});

test('the Video-tab Coach opens a video.create project by ID, preferring it over a loose brief', async () => {
  const project = { type: 'create_project', capability_id: 'video.create', persisted: true, project_id: 'cp_v', brief_version: 1, project: { capability_id: 'video.create' }, legacy: { type: 'create', prompt: 'p' } };
  const picked = VC.pickVideoBrief([{ type: 'create', prompt: 'loose' }, project]);
  assert.equal(picked.type, 'create_project');
  assert.equal(picked.project_id, 'cp_v');
  assert.equal(VC.pickVideoBrief([{ ...project, capability_id: 'reel.create', project: { capability_id: 'reel.create' } }]), null, 'not a Reels project');

  const opened = [];
  global.window = { openContentProjectFromCoach: async (a) => { opened.push(a.project_id); return { project: {} }; } };
  const out = await VC.ask('a mug clip', {
    post: async () => ({ ok: true, json: async () => ({ reply: 'Saved as a project.', coach_actions: [project] }) }),
    threads: null,
  });
  assert.deepEqual(opened, ['cp_v']);
  assert.equal(out.loaded, true);
  global.window.openContentProjectFromCoach = async () => { throw new Error('gone'); };
  global.window.showToast = () => {};
  const failed = await VC.ask('again', {
    post: async () => ({ ok: true, json: async () => ({ reply: 'x', coach_actions: [project] }) }),
    threads: null,
  });
  assert.equal(failed.loaded, false);
  delete global.window;
});
