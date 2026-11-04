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
  assert.match(fn, /pointerdown/);
  assert.match(fn, /slot\.x = origin\.xNow/);
  assert.match(src, /Drag a box to move it/);
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

test('Picture tab targets the selected or empty picture slot, not always the first', () => {
  const context = { console, setTimeout, clearTimeout };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(src, context);
  const { pictureSlotsOf, activePictureSlot } = context.seDesignStudio;
  const pattern = {
    slots: {
      pic_a: { kind: 'image' },
      pic_b: { kind: 'image' },
      pic_c: { kind: 'image' },
    },
    html: '',
  };
  assert.equal(pictureSlotsOf(pattern).map(([n]) => n).join(','), 'pic_a,pic_b,pic_c');
  assert.equal(activePictureSlot(pattern, 'pic_c', { pic_a: 'https://cdn/a.png', pic_b: 'https://cdn/b.png', pic_c: '' })[0], 'pic_c');
  assert.equal(activePictureSlot(pattern, '', { pic_a: 'https://cdn/a.png', pic_b: 'https://cdn/b.png', pic_c: '' })[0], 'pic_c', 'empty slot wins when nothing is selected');
  assert.equal(activePictureSlot(pattern, 'pic_a', { pic_a: 'https://cdn/a.png', pic_b: '', pic_c: '' })[0], 'pic_a', 'clicked slot wins over empties');
  const fn = src.slice(src.indexOf('async function editSlide'), src.indexOf('function lightbox'));
  assert.match(fn, /art_slot/);
  assert.match(fn, /activePictureSlot/);
  assert.match(fn, /data-pic-slot/);
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
