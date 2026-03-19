// background/service-worker.js — MV3 service worker
// Handles OAuth flow and token management on behalf of popup/content scripts

import { setTokens, getTokens, clearAll, setUser } from '../lib/storage.js';
import { apiPostPublic, apiPost } from '../lib/api.js';
import { ensureVaultKey } from '../lib/vault-key.js';
import { parseOtpAuthUri } from '../lib/totp.js';
import { handlePasskeyCreateRequest, handlePasskeyGetRequest } from '../passkey/create-flow.js';

const API_BASE_URL = 'https://localhost:7259/api/v1';
const PASSKEY_REQUEST_TIMEOUT_MS = 90_000;
const pendingPasskeyRequests = new Map();
let passkeyDebugEnabled = false;

chrome.storage.local.get('passkeyDebugEnabled').then((result) => {
  passkeyDebugEnabled = !!result.passkeyDebugEnabled;
}).catch(() => {
  passkeyDebugEnabled = false;
});

function logPasskeyDebug(event, details = {}) {
  if (!passkeyDebugEnabled) return;
  console.log('[passkey-debug]', event, details);
}

function parseOrigin(urlString) {
  if (!urlString) return null;
  try {
    return new URL(urlString).origin;
  } catch {
    return null;
  }
}

function createPasskeyError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

function buildPasskeyContext(sender, message) {
  const senderOrigin = parseOrigin(sender.url);
  const topLevelOrigin = parseOrigin(sender.tab?.url);
  const claimedOrigin = message.origin || null;

  const origin = senderOrigin || claimedOrigin;
  if (!origin) {
    throw createPasskeyError('SecurityError', 'Unable to resolve requester origin');
  }

  if (claimedOrigin && senderOrigin && claimedOrigin !== senderOrigin) {
    throw createPasskeyError('SecurityError', 'Origin mismatch between page and frame sender');
  }

  return {
    origin,
    senderOrigin,
    topLevelOrigin,
    topOrigin: topLevelOrigin,
    tabId: sender.tab?.id ?? null,
    frameId: sender.frameId ?? null,
    requestId: message.requestId || null
  };
}

async function runPasskeyRequest(message, sender, handler) {
  const context = buildPasskeyContext(sender, message);
  const requestId = context.requestId || `auto-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const requestKey = `${context.tabId ?? 'no-tab'}:${context.frameId ?? 'no-frame'}:${requestId}`;

  logPasskeyDebug('request.received', {
    type: message.type,
    requestId,
    tabId: context.tabId,
    frameId: context.frameId,
    origin: context.origin,
    topLevelOrigin: context.topLevelOrigin
  });

  if (pendingPasskeyRequests.has(requestKey)) {
    throw createPasskeyError('InvalidStateError', 'Duplicate passkey request in progress');
  }

  const timeout = setTimeout(() => {
    pendingPasskeyRequests.delete(requestKey);
  }, PASSKEY_REQUEST_TIMEOUT_MS);

  pendingPasskeyRequests.set(requestKey, timeout);
  try {
    const result = await handler(
      {
        options: message.options,
        consentGranted: message.consentGranted
      },
      context
    );
    logPasskeyDebug('request.completed', { type: message.type, requestId, requestKey });
    return result;
  } catch (error) {
    logPasskeyDebug('request.failed', {
      type: message.type,
      requestId,
      name: error?.name,
      message: error?.message
    });
    throw error;
  } finally {
    clearTimeout(timeout);
    pendingPasskeyRequests.delete(requestKey);
  }
}

// ---- Message Handler ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PASSKEY_SET_DEBUG') {
    passkeyDebugEnabled = !!message.enabled;
    chrome.storage.local.set({ passkeyDebugEnabled: passkeyDebugEnabled }).catch(() => {});
    sendResponse({ ok: true, enabled: passkeyDebugEnabled });
    return true;
  }

  if (message.type === 'PASSKEY_CREATE_REQUEST') {
    runPasskeyRequest(message, sender, handlePasskeyCreateRequest)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({
        ok: false,
        error: {
          name: err?.name || 'UnknownError',
          message: err?.message || 'Passkey creation failed'
        }
      }));
    return true;
  }

  if (message.type === 'PASSKEY_GET_REQUEST') {
    runPasskeyRequest(message, sender, handlePasskeyGetRequest)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({
        ok: false,
        error: {
          name: err?.name || 'UnknownError',
          message: err?.message || 'Passkey authentication failed'
        }
      }));
    return true;
  }

  if (message.type === 'GOOGLE_LOGIN') {
    handleGoogleLogin().then(sendResponse).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true; // Keep message channel open for async
  }

  if (message.type === 'LOGOUT') {
    handleLogout().then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: false }));
    return true;
  }

  if (message.type === 'GET_TOKENS') {
    getTokens().then(sendResponse);
    return true;
  }

  if (message.type === 'SAVE_TOTP_URI') {
    saveTotpUri(message.uri, message.displayName)
      .then(result => sendResponse({ success: true, item: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// ---- Google OAuth via chrome.identity ----
async function handleGoogleLogin() {
  try {
    // Get the Google OAuth2 token via chrome.identity
    const manifest = chrome.runtime.getManifest();
    const clientId = manifest.oauth2?.client_id;

    if (!clientId) {
      throw new Error('OAuth client_id not configured in manifest');
    }

    // Build OAuth URL for Google
    const redirectUrl = chrome.identity.getRedirectURL();
    const scopes = ['openid', 'email', 'profile'];
    const nonce = crypto.randomUUID();

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'id_token');
    authUrl.searchParams.set('redirect_uri', redirectUrl);
    authUrl.searchParams.set('scope', scopes.join(' '));
    authUrl.searchParams.set('nonce', nonce);

    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true
    });

    if (!responseUrl) throw new Error('Auth flow cancelled');

    // Extract id_token from the fragment
    const hash = new URL(responseUrl).hash.slice(1);
    const params = new URLSearchParams(hash);
    const idToken = params.get('id_token');

    if (!idToken) throw new Error('No id_token in response');

    // Exchange with our backend
    const data = await apiPostPublic('/auth/google', { idToken });

    await setTokens(data.accessToken, data.refreshToken);
    await setUser(data.user);

    // Ensure vault key exists for encryption
    await ensureVaultKey(data.user.email);

    return { success: true, user: data.user };
  } catch (err) {
    console.error('[service-worker] Google login error:', err);
    return { success: false, error: err.message };
  }
}

// ---- Logout ----
async function handleLogout() {
  try {
    const { refreshToken } = await getTokens();
    if (refreshToken) {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAuthHeader())
        },
        body: JSON.stringify({ refreshToken })
      });
    }
  } catch { /* ignore errors during logout */ }
  await clearAll();
}

async function getAuthHeader() {
  const { accessToken } = await getTokens();
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

// ---- Save TOTP URI from content script ----
async function saveTotpUri(uri, displayName) {
  // Parse URI to extract issuer and account
  const parsed = parseOtpAuthUri(uri);

  // Use provided displayName or generate from parsed data
  const name = displayName || `${parsed.issuer} (${parsed.accountName})`;

  // Call API to save TOTP account
  const result = await apiPost('/vault/totp', {
    otpAuthUri: uri,
    displayName: name
  });

  // Notify user with badge
  await chrome.action.setBadgeText({ text: '✓' });
  await chrome.action.setBadgeBackgroundColor({ color: '#4caf50' });
  setTimeout(async () => {
    await chrome.action.setBadgeText({ text: '' });
  }, 3000);

  return result;
}
