// Pure helpers of library.js: type groups, search, sort, selection, colours, copy.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./library.js');
const A = require('./portal-assets.js');

const ctx = (variant) => ({ variant, kindLabel: A.kindLabel, isStill: A.isStillKind });
const asset = (id, kind, over) => ({ id, kind, name: `${kind} ${id}`, url: `https://store.test/${id}.png`, ...over });
const labeled = { analysis: { summary: 'A person at a desk.', subjects: ['Nurse'], aliases: ['sam'], place: 'Clinic', collection: 'Clinic days' } };

test('esc and safeUrl keep markup and unsafe links out', () => {
  assert.equal(h.esc('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
  assert.equal(h.esc(null), '');
  assert.equal(h.safeUrl('https://a.test/x.png'), 'https://a.test/x.png');
  assert.equal(h.safeUrl('  http://a.test '), 'http://a.test/');
  assert.equal(h.safeUrl('javascript:alert(1)'), '');
  assert.equal(h.safeUrl('data:image/png;base64,AAAA'), '');
  assert.equal(h.safeUrl(''), '');
  assert.equal(h.safeUrl(undefined), '');
});

test('safeHex accepts 3, 6 and 8 digit hex and nothing else', () => {
  assert.equal(h.safeHex('#e0457b'), '#E0457B');
  assert.equal(h.safeHex('#abc'), '#AABBCC');
  assert.equal(h.safeHex('#11223344'), '#11223344');
  assert.equal(h.safeHex('red'), '');
  assert.equal(h.safeHex('#12345'), '');
  assert.equal(h.safeHex('#zzz'), '');
  assert.equal(h.safeHex('url(javascript:1)'), '');
  assert.equal(h.safeHex(null), '');
});

test('hexToHsl gives the real colour as hsl(), and alpha when there is some', () => {
  assert.equal(h.hexToHsl('#FF0000'), 'hsl(0 100% 50%)');
  assert.equal(h.hexToHsl('#000000'), 'hsl(0 0% 0%)');
  assert.equal(h.hexToHsl('#FFFFFF'), 'hsl(0 0% 100%)');
  assert.equal(h.hexToHsl('#2F4A3C'), 'hsl(148.9 22.3% 23.7%)');
  assert.equal(h.hexToHsl('#FF000080'), 'hsl(0 100% 50% / 0.502)');
  assert.equal(h.hexToHsl('nope'), '');
});

test('isLightHex decides between dark and light text', () => {
  assert.equal(h.isLightHex('#FFFFFF'), true);
  assert.equal(h.isLightHex('#F2B84B'), true);
  assert.equal(h.isLightHex('#1B1A17'), false);
  assert.equal(h.isLightHex('#2B2D6E'), false);
  assert.equal(h.isLightHex('x'), false);
});

test('labelState: only pictures can be unlabeled, and a summary or subjects makes it labeled', () => {
  const still = A.isStillKind;
  assert.equal(h.labelState(asset('1', 'scene'), still), 'unlabeled');
  assert.equal(h.labelState(asset('2', 'scene', labeled), still), 'labeled');
  assert.equal(h.labelState(asset('3', 'scene', { analysis: { summary: '', subjects: ['Cat'] } }), still), 'labeled');
  assert.equal(h.labelState(asset('4', 'scene', { analysis: { summary: '  ', subjects: [] } }), still), 'unlabeled');
  assert.equal(h.labelState(asset('5', 'music'), still), 'none');
  assert.equal(h.labelState(asset('6', 'color', { hex: '#fff' }), still), 'none');
  assert.equal(h.labelState(null, still), 'none');
});

test('analysisOf tidies what the AI wrote and caps the lists', () => {
  const an = h.analysisOf({ analysis: { summary: ' Hi ', aliases: ['a', '', ' b ', 1, 2, 3, 4, 5, 6, 7], subjects: null, place: ' Park ' } });
  assert.equal(an.summary, 'Hi');
  assert.equal(an.aliases.length, 6);
  assert.deepEqual(an.aliases.slice(0, 2), ['a', 'b']);
  assert.deepEqual(an.subjects, []);
  assert.equal(an.place, 'Park');
  assert.deepEqual(h.analysisOf(null), { summary: '', aliases: [], subjects: [], place: '' });
});

test('collectionOf reads the item first, then its analysis', () => {
  assert.equal(h.collectionOf({ collection: ' Spring ' }), 'Spring');
  assert.equal(h.collectionOf({ analysis: { collection: 'Winter' } }), 'Winter');
  assert.equal(h.collectionOf({ collection: '', analysis: { collection: 'Winter' } }), 'Winter');
  assert.equal(h.collectionOf({}), '');
});

test('groupOf puts every known kind in a group; strange kinds go to other', () => {
  for (const k of A.ASSET_KINDS) assert.notEqual(h.groupOf(k), 'other', k);
  assert.equal(h.groupOf('character'), 'people');
  assert.equal(h.groupOf('plate'), 'scenes');
  assert.equal(h.groupOf('outro'), 'video');
  assert.equal(h.groupOf('logo'), 'brand');
  assert.equal(h.groupOf('hologram'), 'other');
  assert.equal(h.groupOf(undefined), 'other');
});

test('typeGroups: the charity order and the store wording follow the mockups', () => {
  assert.deepEqual(h.typeGroups('charity').slice(0, 7).map((g) => g.label),
    ['People and characters', 'Things', 'Places and settings', 'Scenes', 'Looks and styles', 'Video clips', 'Music']);
  assert.deepEqual(h.typeGroups('store').slice(0, 7).map((g) => g.label),
    ['Products', 'Models and people', 'Places and settings', 'Scenes', 'Looks and styles', 'Video clips', 'Music']);
  assert.equal(h.typeGroups('brand')[0].label, 'People and characters');
});

test('chipLabel: a store says Product and Person; everyone else uses the asset label', () => {
  assert.equal(h.chipLabel('item', 'store', A.kindLabel), 'Product');
  assert.equal(h.chipLabel('character', 'store', A.kindLabel), 'Person');
  assert.equal(h.chipLabel('item', 'charity', A.kindLabel), 'Item');
  assert.equal(h.chipLabel('character', 'charity', A.kindLabel), 'Character');
  assert.equal(h.chipLabel('scene', 'store', A.kindLabel), 'Scene');
  assert.equal(h.chipLabel('outro', 'brand', A.kindLabel), 'Outro');
});

test('typeCounts: All first, counts per group, brand and other only when they have something', () => {
  const items = [asset('1', 'character'), asset('2', 'character'), asset('3', 'item'), asset('4', 'music')];
  const rows = h.typeCounts(items, 'charity');
  assert.deepEqual(rows[0], { id: 'all', label: 'All', count: 4 });
  assert.equal(rows.find((r) => r.id === 'people').count, 2);
  assert.equal(rows.find((r) => r.id === 'things').count, 1);
  assert.equal(rows.find((r) => r.id === 'scenes').count, 0);
  assert.equal(rows.find((r) => r.id === 'brand'), undefined);
  assert.equal(rows.find((r) => r.id === 'other'), undefined);
  const more = h.typeCounts([...items, asset('5', 'logo'), asset('6', 'color', { hex: '#fff' }), asset('7', 'zzz')], 'store');
  assert.equal(more.find((r) => r.id === 'brand').count, 2);
  assert.equal(more.find((r) => r.id === 'other').count, 1);
  assert.equal(more[1].label, 'Products');
  assert.equal(h.typeCounts(null, 'store')[0].count, 0);
});

test('collectionsOf: counts by name ignoring case, biggest first, first spelling wins', () => {
  const items = [
    asset('1', 'scene', { collection: 'Spring walk' }), asset('2', 'scene', { collection: 'spring walk' }), asset('3', 'scene', { collection: 'Clinic' }),
    asset('4', 'scene', { analysis: { collection: 'Winter' } }), asset('5', 'scene', { analysis: { collection: 'Winter' } }), asset('6', 'scene', { analysis: { collection: 'Winter' } }), asset('7', 'scene'),
  ];
  assert.deepEqual(h.collectionsOf(items), [{ name: 'Winter', count: 3 }, { name: 'Spring walk', count: 2 }, { name: 'Clinic', count: 1 }]);
  assert.deepEqual(h.collectionsOf(undefined), []);
});

test('parseView reads every view id', () => {
  assert.deepEqual(h.parseView('all'), { type: 'all' });
  assert.deepEqual(h.parseView(undefined), { type: 'all' });
  assert.deepEqual(h.parseView('g:people'), { type: 'group', id: 'people' });
  assert.deepEqual(h.parseView('c:Spring: part 2'), { type: 'collection', name: 'Spring: part 2' });
  assert.deepEqual(h.parseView('smart:label'), { type: 'smart', id: 'label' });
  assert.deepEqual(h.parseView('smart:review'), { type: 'smart', id: 'review' });
  assert.deepEqual(h.parseView('smart:nope'), { type: 'all' });
});

test('matchesQuery: every word must be found in the name, label, kind, AI text or collection', () => {
  const a = asset('1', 'character', { name: 'Dr. Amara', collection: 'Clinic days', ...labeled });
  const c = ctx('charity');
  assert.equal(h.matchesQuery(a, '', c), true);
  assert.equal(h.matchesQuery(a, 'amara', c), true);
  assert.equal(h.matchesQuery(a, 'AMARA clinic', c), true);
  assert.equal(h.matchesQuery(a, 'nurse', c), true, 'subjects');
  assert.equal(h.matchesQuery(a, 'sam', c), true, 'aliases');
  assert.equal(h.matchesQuery(a, 'desk', c), true, 'summary');
  assert.equal(h.matchesQuery(a, 'character', c), true, 'kind');
  assert.equal(h.matchesQuery(a, 'amara zebra', c), false);
  const item = asset('2', 'item', { name: 'Linen shirt' });
  assert.equal(h.matchesQuery(item, 'product', ctx('store')), true, 'a store searches by the word it shows');
  assert.equal(h.matchesQuery(item, 'product', ctx('charity')), false);
});

test('filterAssets: type, collection, needs a label, and search together', () => {
  const items = [
    asset('1', 'character', { name: 'Ann', collection: 'Clinic', ...labeled }),
    asset('2', 'character', { name: 'Bob', collection: 'Walk' }),
    asset('3', 'item', { name: 'Tin', collection: 'walk' }),
    asset('4', 'music', { name: 'Theme' }),
  ];
  const c = ctx('charity');
  const ids = (list) => list.map((a) => a.id);
  assert.deepEqual(ids(h.filterAssets(items, 'all', '', c)), ['1', '2', '3', '4']);
  assert.deepEqual(ids(h.filterAssets(items, 'g:people', '', c)), ['1', '2']);
  assert.deepEqual(ids(h.filterAssets(items, 'c:Walk', '', c)), ['2', '3']);
  assert.deepEqual(ids(h.filterAssets(items, 'smart:label', '', c)), ['2', '3']);
  assert.deepEqual(ids(h.filterAssets(items, 'smart:review', '', c)), []);
  assert.deepEqual(ids(h.filterAssets(items, 'g:people', 'bob', c)), ['2']);
  assert.deepEqual(ids(h.filterAssets(items, 'all', 'nothing here', c)), []);
  assert.deepEqual(h.filterAssets(null, 'all', '', c), []);
});

test('sortAssets: newest first reverses the arrival order when there are no dates', () => {
  const items = ['a', 'b', 'c'].map((id) => asset(id, 'scene', { name: id.toUpperCase() }));
  assert.deepEqual(h.sortAssets(items, 'new').map((a) => a.id), ['c', 'b', 'a']);
  assert.deepEqual(h.sortAssets(items, 'old').map((a) => a.id), ['a', 'b', 'c']);
  assert.deepEqual(h.sortAssets(items, 'name', A.labelOf).map((a) => a.id), ['a', 'b', 'c']);
  assert.deepEqual(h.sortAssets([asset('z', 'scene', { name: 'Zed' }), asset('y', 'scene', { name: 'apple' })], 'name', A.labelOf).map((a) => a.id), ['y', 'z']);
});

test('sortAssets: uses the date an item was added when the server sends one, dated items first', () => {
  const items = [
    asset('old', 'scene', { created_at: '2026-01-02T00:00:00Z' }),
    asset('new', 'scene', { created_at: '2026-10-21T00:00:00Z' }),
    asset('none', 'scene'),
    asset('mid', 'scene', { created_at: '2026-05-05T00:00:00Z' }),
    asset('bad', 'scene', { created_at: 'not a date' }),
  ];
  assert.deepEqual(h.sortAssets(items, 'new').map((a) => a.id), ['new', 'mid', 'old', 'bad', 'none']);
  assert.deepEqual(h.sortAssets(items, 'old').map((a) => a.id), ['old', 'mid', 'new', 'none', 'bad']);
  assert.equal(h.sortAssets(undefined, 'new').length, 0);
});

test('brandLast moves logo and colors after everything else and keeps the order', () => {
  const items = [asset('k', 'color', { hex: '#fff' }), asset('a', 'scene'), asset('l', 'logo'), asset('b', 'item')];
  assert.deepEqual(h.brandLast(items).map((a) => a.id), ['a', 'b', 'k', 'l']);
});

test('countLine says how many are showing and how they are sorted', () => {
  assert.equal(h.countLine(48, 48, 'new'), '48 items. Newest first.');
  assert.equal(h.countLine(1, 1, 'new'), '1 item. Newest first.');
  assert.equal(h.countLine(12, 48, 'name'), '12 of 48 items. Name, A to Z.');
  assert.equal(h.countLine(0, 0, 'old'), '0 items. Oldest first.');
  assert.equal(h.sortLabel('nope'), 'Newest first');
});

test('viewTitle names the view', () => {
  const rows = h.typeCounts([], 'store');
  assert.equal(h.viewTitle('all', rows), 'All items');
  assert.equal(h.viewTitle('g:things', rows), 'Products');
  assert.equal(h.viewTitle('c:Autumn edit', rows), 'Autumn edit');
  assert.equal(h.viewTitle('smart:label', rows), 'Needs a label');
  assert.equal(h.viewTitle('smart:review', rows), 'To review');
  assert.equal(h.viewTitle('g:zzz', rows), 'Items');
});

test('emptyCopy: says why the grid is empty, in the words of the variant', () => {
  assert.equal(h.emptyCopy('all', '', 0, 'store').title, 'Your Library is empty');
  assert.match(h.emptyCopy('all', '', 0, 'store').body, /products, models and shop pictures/);
  assert.match(h.emptyCopy('all', '', 0, 'charity').body, /people, places and events/);
  assert.match(h.emptyCopy('all', '', 0, 'brand').body, /people, places and things/);
  assert.deepEqual(h.emptyCopy('all', ' tin ', 5, 'charity'), { title: 'Nothing matches', body: 'Nothing matches "tin". Try another word, or clear the search.' });
  assert.equal(h.emptyCopy('smart:label', '', 5, 'charity').title, 'Every picture has a label');
  assert.equal(h.emptyCopy('smart:review', '', 5, 'charity').title, 'Nothing to review');
  assert.equal(h.emptyCopy('g:music', '', 5, 'charity').title, 'Nothing here yet');
  for (const v of ['all', 'smart:label', 'smart:review', 'g:music']) {
    for (const k of ['store', 'charity', 'brand']) {
      const c = h.emptyCopy(v, '', k === 'store' ? 0 : 3, k);
      assert.doesNotMatch(`${c.title} ${c.body}`, /—|--/, 'no em dashes in copy');
    }
  }
});

test('addedLabel and metaLine only say what the server told us', () => {
  const a = { collection: 'Spring walk 2026', created_at: '2026-10-21T15:00:00Z' };
  assert.equal(h.addedLabel(a, { locale: 'en-US', timeZone: 'UTC' }), 'Oct 21');
  assert.equal(h.metaLine(a, { locale: 'en-US', timeZone: 'UTC' }), 'Spring walk 2026 · Added Oct 21');
  assert.equal(h.metaLine({ collection: 'Spring walk 2026' }), 'Spring walk 2026');
  assert.equal(h.metaLine({ created_at: '2026-10-21T15:00:00Z' }, { locale: 'en-US', timeZone: 'UTC' }), 'Added Oct 21');
  assert.equal(h.metaLine({}), '');
  assert.equal(h.addedLabel({ created_at: 'nope' }), '');
});

test('selectedIds and toggleChecked: ticking a second item makes two, the default item does not count', () => {
  assert.deepEqual(h.selectedIds('a', new Set()), ['a']);
  assert.deepEqual(h.selectedIds(null, new Set()), []);
  assert.deepEqual(h.selectedIds('a', new Set(['b', 'c'])), ['b', 'c']);
  // nobody clicked the shown item: ticking one box selects just that one
  assert.deepEqual([...h.toggleChecked('a', new Set(), 'b', false)], ['b']);
  // they clicked it first: ticking another extends the selection
  assert.deepEqual([...h.toggleChecked('a', new Set(), 'b', true)], ['a', 'b']);
  // ticking the item itself ticks it
  assert.deepEqual([...h.toggleChecked('a', new Set(), 'a', false)], ['a']);
  assert.deepEqual([...h.toggleChecked('a', new Set(), 'a', true)], ['a']);
  // unticking
  assert.deepEqual([...h.toggleChecked('a', new Set(['a', 'b']), 'b', true)], ['a']);
  assert.deepEqual([...h.toggleChecked('a', new Set(['a']), 'a', true)], []);
  const before = new Set(['a']);
  h.toggleChecked('a', before, 'b', true);
  assert.deepEqual([...before], ['a'], 'the old set is not changed');
});

test('commonKinds: only the types every selected item can become', () => {
  const still = asset('1', 'scene');
  const vid = asset('2', 'video', { url: 'https://store.test/v.mp4' });
  const still2 = asset('3', 'item');
  const kinds = h.commonKinds([still, still2], A.retagKinds);
  assert.ok(kinds.includes('scene') && kinds.includes('item') && kinds.includes('outro'));
  assert.deepEqual(h.commonKinds([still, vid], A.retagKinds), ['outro', 'intro'], 'a still and a video can both be an end card or an intro');
  assert.deepEqual(h.commonKinds([vid, asset('9', 'music', { url: 'https://store.test/m.mp3' })], A.retagKinds), [], 'video and music share nothing');
  assert.deepEqual(h.commonKinds([], A.retagKinds), []);
});

test('sheetInfo: shows while being made, when there is a sheet, or when only older angles exist', () => {
  assert.equal(h.sheetInfo(asset('1', 'character'), false).show, false);
  const busy = h.sheetInfo(asset('1', 'character'), true);
  assert.equal(busy.show, true); assert.equal(busy.meta, 'Making sheet…'); assert.equal(busy.url, '');
  const sheet = h.sheetInfo(asset('2', 'character', { multiview_kind: 'sheet' }), false);
  assert.equal(sheet.hasSheet, true); assert.equal(sheet.canRemake, true); assert.equal(sheet.meta, 'Single turnaround'); assert.equal(sheet.url, 'https://store.test/2.png');
  const own = h.sheetInfo(asset('3', 'character', { sheet_url: 'https://store.test/sheet.png' }), false);
  assert.equal(own.url, 'https://store.test/sheet.png');
  const legacy = h.sheetInfo(asset('4', 'character', { views: [{ url: 'https://store.test/a.png' }, { url: 'javascript:1' }] }), false);
  assert.equal(legacy.legacy, true); assert.match(legacy.meta, /Older angles/);
  const unsafe = h.sheetInfo(asset('5', 'character', { sheet_url: 'javascript:alert(1)' }), false);
  assert.equal(unsafe.url, 'https://store.test/5.png', 'a sheet link that is not http(s) is never used; the picture itself is');
});

test('previewFamily: how a file is drawn', () => {
  const pf = A.persistFamily;
  assert.equal(h.previewFamily({ kind: 'color', hex: '#fff' }, pf), 'color');
  assert.equal(h.previewFamily(asset('1', 'scene'), pf), 'image');
  assert.equal(h.previewFamily(asset('2', 'music'), pf), 'audio');
  assert.equal(h.previewFamily(asset('3', 'outro'), pf), 'video');
  assert.equal(h.previewFamily(asset('4', 'scene', { url: '' }), pf), 'none');
  assert.equal(h.previewFamily(asset('5', 'scene', { url: 'javascript:1' }), pf), 'none');
  assert.equal(h.previewFamily(null, pf), 'none');
  assert.equal(h.previewFamily(asset('6', 'music'), undefined), 'audio', 'works without the helper too');
});

test('addMenu: the diagram maker is for charities only', () => {
  assert.deepEqual(h.addMenu('charity').map((m) => m.id), ['upload', 'past', 'gen']);
  assert.deepEqual(h.addMenu('store').map((m) => m.id), ['upload', 'past']);
  assert.deepEqual(h.addMenu('brand').map((m) => m.id), ['upload', 'past']);
});

test('genReady and genStatus: 2 to 8 pictures', () => {
  assert.equal(h.genReady(1), false); assert.equal(h.genReady(2), true); assert.equal(h.genReady(8), true); assert.equal(h.genReady(9), false);
  assert.match(h.genStatus(0), /Tick 2 to 8/);
  assert.match(h.genStatus(1), /at least 1 more/);
  assert.match(h.genStatus(3), /Ready/);
  assert.match(h.genStatus(10), /Untick 2/);
});

test('initialsOf: letters for the logo box', () => {
  assert.equal(h.initialsOf('OPA Cancer Charity'), 'OPA');
  assert.equal(h.initialsOf('Linen and Co'), 'LC');
  assert.equal(h.initialsOf('the Sunrise Cafe'), 'SC');
  assert.equal(h.initialsOf('Bunny'), 'BU');
  assert.equal(h.initialsOf(''), '');
  assert.equal(h.initialsOf(null), '');
});

test('iconFor and tintOf give every kind a picture and a colour', () => {
  for (const k of A.ASSET_KINDS) {
    assert.match(h.iconFor(k), /^M/);
    assert.match(h.tintOf(k), /^[pwcbyk]$/);
  }
  assert.match(h.iconFor('hologram'), /^M/);
  assert.equal(h.tintOf('hologram'), 'k');
});

test('pluralize', () => {
  assert.equal(h.pluralize(1, 'item'), '1 item');
  assert.equal(h.pluralize(2, 'item'), '2 items');
  assert.equal(h.pluralize(0, 'draft'), '0 drafts');
  assert.equal(h.pluralize(2, 'logo or color', 'logos and colors'), '2 logos and colors');
});

test('library.js is a browser script that loads in node without touching the page', () => {
  assert.equal(typeof h.esc, 'function');
  assert.equal(typeof globalThis.renderLibraryUI, 'undefined');
});
