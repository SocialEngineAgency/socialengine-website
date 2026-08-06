const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildNativeOAuthUrl,
  getPlatformConnectionState,
  getNativeOAuthFailureMessage,
  shouldStartNativeOAuth,
} = require('../portal-native-oauth.js');

test('buildNativeOAuthUrl targets the real native Meta route with auth params', () => {
  const url = buildNativeOAuthUrl(
    'https://api.socialengine.test',
    'instagram',
    'owner+brand@example.com',
    'hash/with spaces'
  );

  assert.equal(
    url,
    'https://api.socialengine.test/api/auth/instagram?client_email=owner%2Bbrand%40example.com&client_hash=hash%2Fwith%20spaces'
  );
});

test('instagram publish-only connections are marked as analytics-limited', () => {
  const state = getPlatformConnectionState(
    'instagram',
    {
      social_connected_platforms: ['instagram'],
      instagram_user_id: '',
    },
    {
      accounts: [{ platform: 'instagram', name: 'brandname' }],
    }
  );

  assert.equal(state.publishConnected, true);
  assert.equal(state.nativeConnected, false);
  assert.equal(state.analyticsLimited, true);
  assert.equal(state.statusLabel, 'Publishing only');
});

test('facebook requires both native page id and token for full analytics status', () => {
  const state = getPlatformConnectionState(
    'facebook',
    {
      social_connected_platforms: ['facebook'],
      meta_page_id: '12345',
      meta_page_token: 'token-abc',
      facebook_connected: 'true',
    },
    {
      accounts: [{ platform: 'facebook', name: 'Brand Page' }],
    }
  );

  assert.equal(state.publishConnected, true);
  assert.equal(state.nativeConnected, true);
  assert.equal(state.fullyConnected, true);
  assert.equal(state.statusLabel, 'Connected');
});

test('facebook disconnect flag wins even when shared Meta tokens remain for Instagram', () => {
  const state = getPlatformConnectionState(
    'facebook',
    {
      meta_page_id: '12345',
      meta_page_token: 'token-abc',
      facebook_connected: 'false',
      instagram_user_id: '17841402339474187',
    },
    { accounts: [] }
  );
  assert.equal(state.nativeConnected, false);
  assert.equal(state.fullyConnected, false);
  assert.equal(state.statusLabel, 'Not connected');
});

test('meta native-only connection shows Connected, not Analytics only', () => {
  const ig = getPlatformConnectionState(
    'instagram',
    { instagram_user_id: '17841402339474187', social_connected_platforms: [] },
    { accounts: [] }
  );
  assert.equal(ig.nativeConnected, true);
  assert.equal(ig.fullyConnected, true);
  assert.equal(ig.analyticsOnly, false);
  assert.equal(ig.statusLabel, 'Connected');

  const fb = getPlatformConnectionState(
    'facebook',
    { meta_page_id: '104376865746581', meta_page_token: 'page-token', social_connected_platforms: [] },
    { accounts: [] }
  );
  assert.equal(fb.fullyConnected, true);
  assert.equal(fb.analyticsOnly, false);
  assert.equal(fb.statusLabel, 'Connected');
});

test('failure messaging explains that Grow analytics will be limited', () => {
  const message = getNativeOAuthFailureMessage('tiktok');

  assert.match(message, /TikTok/i);
  assert.match(message, /Grow/i);
  assert.match(message, /limited/i);
});

test('native OAuth follow-up starts only for publish-only connections', () => {
  assert.equal(
    shouldStartNativeOAuth(
      'instagram',
      { social_connected_platforms: ['instagram'], instagram_user_id: '' },
      { accounts: [{ platform: 'instagram' }] }
    ),
    true
  );

  assert.equal(
    shouldStartNativeOAuth(
      'instagram',
      { social_connected_platforms: ['instagram'], instagram_user_id: '1784' },
      { accounts: [{ platform: 'instagram' }] }
    ),
    false
  );
});
