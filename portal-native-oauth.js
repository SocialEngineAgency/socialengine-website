(() => {
  'use strict';

  const PLATFORM_META = {
    instagram: {
      label: 'Instagram',
      nativeFields: ['instagram_user_id'],
      nativeStatusLabel: 'Connected',
      limitedStatusLabel: 'Publishing only',
      disconnectedStatusLabel: 'Not connected',
    },
    tiktok: {
      label: 'TikTok',
      nativeFields: ['tiktok_access_token'],
      nativeStatusLabel: 'Connected',
      limitedStatusLabel: 'Publishing only',
      disconnectedStatusLabel: 'Not connected',
    },
    facebook: {
      label: 'Facebook',
      nativeFields: ['meta_page_id', 'meta_page_token'],
      nativeStatusLabel: 'Connected',
      limitedStatusLabel: 'Publishing only',
      disconnectedStatusLabel: 'Not connected',
    },
  };

  function normalizePlatform(platform) {
    return String(platform || '').trim().toLowerCase();
  }

  function getPlatformMeta(platform) {
    return PLATFORM_META[normalizePlatform(platform)] || {
      label: String(platform || 'Social account'),
      nativeFields: [],
      nativeStatusLabel: 'Connected',
      limitedStatusLabel: 'Publishing only',
      disconnectedStatusLabel: 'Not connected',
    };
  }

  function hasTruthyValue(value) {
    return value !== undefined && value !== null && String(value).trim() !== '';
  }

  function normalizePlatformList(value) {
    if (Array.isArray(value)) {
      return value.map((item) => normalizePlatform(item)).filter(Boolean);
    }
    return String(value || '')
      .split(',')
      .map((item) => normalizePlatform(item))
      .filter(Boolean);
  }

  function hasUploadPostAccount(platform, uploadPostSnapshot) {
    const target = normalizePlatform(platform);
    const accounts = Array.isArray(uploadPostSnapshot?.accounts) ? uploadPostSnapshot.accounts : [];
    return accounts.some((account) => normalizePlatform(account?.platform) === target);
  }

  function isPublishingConnected(platform, clientRecord, uploadPostSnapshot) {
    const target = normalizePlatform(platform);
    const connectedPlatforms = normalizePlatformList(clientRecord?.social_connected_platforms);
    return connectedPlatforms.includes(target) || hasUploadPostAccount(target, uploadPostSnapshot);
  }

  function isNativeConnected(platform, clientRecord) {
    const meta = getPlatformMeta(platform);
    return meta.nativeFields.length > 0 && meta.nativeFields.every((field) => hasTruthyValue(clientRecord?.[field]));
  }

  // Real native OAuth routes live on the API server:
  //   instagram -> /api/auth/instagram   (Meta Login)
  //   facebook  -> /api/auth/facebook    (Meta Login)
  //   tiktok    -> /api/auth/tiktok      (TikTok OAuth)
  // These read `client_email` / `client_hash` query params and write the
  // native analytics fields (meta_page_token, instagram_user_id, etc.).
  function buildNativeOAuthUrl(apiBase, platform, email, hash) {
    const target = normalizePlatform(platform);
    const base = String(apiBase || '').replace(/\/+$/, '');
    const emailParam = encodeURIComponent(String(email || ''));
    const hashParam = encodeURIComponent(String(hash || ''));
    return `${base}/api/auth/${encodeURIComponent(target)}?client_email=${emailParam}&client_hash=${hashParam}`;
  }

  function getPlatformConnectionState(platform, clientRecord, uploadPostSnapshot) {
    const target = normalizePlatform(platform);
    const meta = getPlatformMeta(target);
    const nativeConnected = isNativeConnected(target, clientRecord);
    // Instagram/Facebook: native Meta Login is the real connection (publish,
    // analytics, Engage). Upload-Post platform lists are no longer required.
    // TikTok still uses Upload-Post publish + optional native analytics.
    const isMetaNativePrimary = target === 'instagram' || target === 'facebook';
    const uploadPostPublish = isPublishingConnected(target, clientRecord, uploadPostSnapshot);
    const publishConnected = isMetaNativePrimary
      ? (nativeConnected || uploadPostPublish)
      : uploadPostPublish;
    const fullyConnected = isMetaNativePrimary
      ? nativeConnected
      : (publishConnected && nativeConnected);
    // Upload-Post publish without native Meta/TikTok tokens → prompt to finish OAuth
    const analyticsLimited = publishConnected && !nativeConnected;
    // Legacy TikTok-era label only. Meta native-only is fully Connected.
    const analyticsOnly = !isMetaNativePrimary && nativeConnected && !uploadPostPublish;

    let statusLabel = meta.disconnectedStatusLabel;
    if (fullyConnected) {
      statusLabel = meta.nativeStatusLabel;
    } else if (analyticsLimited) {
      statusLabel = meta.limitedStatusLabel;
    } else if (analyticsOnly) {
      statusLabel = 'Analytics only';
    } else if (publishConnected) {
      statusLabel = meta.limitedStatusLabel;
    }

    return {
      platform: target,
      label: meta.label,
      publishConnected,
      nativeConnected,
      fullyConnected,
      analyticsLimited,
      analyticsOnly,
      statusLabel,
    };
  }

  function supportsNativeOAuth(platform) {
    return Boolean(PLATFORM_META[normalizePlatform(platform)]);
  }

  function shouldStartNativeOAuth(platform, clientRecord, uploadPostSnapshot) {
    const state = getPlatformConnectionState(platform, clientRecord, uploadPostSnapshot);
    return state.publishConnected && !state.nativeConnected && supportsNativeOAuth(platform);
  }

  function getNativeOAuthFailureMessage(platform) {
    const meta = getPlatformMeta(platform);
    return `${meta.label} publishing is connected, but the native analytics connection did not finish. Grow tab metrics like impressions, reach, and saves will be limited until you complete native OAuth.`;
  }

  const api = {
    PLATFORM_META,
    buildNativeOAuthUrl,
    getPlatformConnectionState,
    getNativeOAuthFailureMessage,
    isNativeConnected,
    isPublishingConnected,
    shouldStartNativeOAuth,
    supportsNativeOAuth,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof window !== 'undefined') {
    window.SENativeOAuth = api;
  }
})();
