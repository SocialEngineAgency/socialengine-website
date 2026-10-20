'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'design-studio-v2.js'), 'utf8');

test('the slide editor loads the carousel style before deciding the picture slot', () => {
  const fn = src.slice(src.indexOf('async function editSlide'), src.indexOf('function lightbox'));
  assert.match(fn, /result\.style && result\.style\.id/);
  assert.match(fn, /\/api\/design\/system\?style=/);
  assert.match(fn, /pictureSlotOf\(pattern\)/);
  assert.match(fn, /id="dsv2-ed-upload"/);
  assert.doesNotMatch(fn, /Pick another layout to add one/);
});

test('a picture box is an upload slot even when the layout label is not image', () => {
  const context = { console, setTimeout, clearTimeout };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(src, context);
  const pictureSlotOf = context.seDesignStudio.pictureSlotOf;
  assert.equal(pictureSlotOf({
    slots: { title: { kind: 'text' }, art: { kind: 'image' } },
    html: '<h1 data-slot="title">{{title}}</h1><img data-slot="art" src="{{art}}">',
  })[0], 'art');
  assert.equal(pictureSlotOf({
    slots: { art: { kind: 'text', max_chars: 80 } },
    html: '<img data-slot="art" src="{{art}}">',
  })[0], 'art');
  assert.equal(pictureSlotOf({
    slots: { art: { kind: 'text' } },
    html: '<img class="art" src="{{art}}">',
  })[0], 'art');
  assert.equal(pictureSlotOf({
    slots: {},
    html: '<img class="logo" data-slot="logo" src="{{logo}}"><h1 data-slot="title">{{title}}</h1>',
  }), null);
  assert.equal(pictureSlotOf({ slots: { title: { kind: 'text' } }, html: '<h1 data-slot="title">{{title}}</h1>' }), null);
});

test('words already on the slide stay editable when the layout lists no fields', () => {
  const context = { console, setTimeout, clearTimeout };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(src, context);
  const slots = context.seDesignStudio.slotsForEditor(
    { slots: {} },
    { title: 'What is stomach cancer?', body: 'It is cancer found anywhere in the stomach.', art: '' },
    { art: { kind: 'image' } },
  );
  assert.equal(slots.title.kind, 'text');
  assert.equal(slots.body.kind, 'text');
  assert.equal(slots.art.kind, 'image');
  const picture = context.seDesignStudio.pictureSlotOf({ slots, html: '' });
  assert.equal(picture[0], 'art');
});
