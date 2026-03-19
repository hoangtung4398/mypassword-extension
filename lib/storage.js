// lib/storage.js — wrapper around chrome.storage.local
// All token and vault key storage operations

const KEYS = {
  ACCESS_TOKEN: 'accessToken',
  REFRESH_TOKEN: 'refreshToken',
  VAULT_KEY: 'vaultKey',
  USER: 'user',
  PASSKEY_CREDENTIAL_SOURCES: 'passkeyCredentialSources',
  PASSKEY_CREDENTIAL_INDEX: 'passkeyCredentialIndex'
};

/**
 * Get stored tokens
 * @returns {{ accessToken: string|null, refreshToken: string|null }}
 */
export async function getTokens() {
  const result = await chrome.storage.local.get([KEYS.ACCESS_TOKEN, KEYS.REFRESH_TOKEN]);
  return {
    accessToken: result[KEYS.ACCESS_TOKEN] ?? null,
    refreshToken: result[KEYS.REFRESH_TOKEN] ?? null
  };
}

/**
 * Store access and refresh tokens
 * @param {string} accessToken
 * @param {string} refreshToken
 */
export async function setTokens(accessToken, refreshToken) {
  await chrome.storage.local.set({
    [KEYS.ACCESS_TOKEN]: accessToken,
    [KEYS.REFRESH_TOKEN]: refreshToken
  });
}

/**
 * Clear all stored tokens
 */
export async function clearTokens() {
  await chrome.storage.local.remove([KEYS.ACCESS_TOKEN, KEYS.REFRESH_TOKEN]);
}

/**
 * Get the vault encryption key (base64-encoded)
 * @returns {string|null}
 */
export async function getVaultKey() {
  const result = await chrome.storage.local.get(KEYS.VAULT_KEY);
  return result[KEYS.VAULT_KEY] ?? null;
}

/**
 * Store the vault encryption key (base64-encoded)
 * @param {string} key
 */
export async function setVaultKey(key) {
  await chrome.storage.local.set({ [KEYS.VAULT_KEY]: key });
}

/**
 * Get stored user info
 * @returns {object|null}
 */
export async function getUser() {
  const result = await chrome.storage.local.get(KEYS.USER);
  return result[KEYS.USER] ?? null;
}

/**
 * Store user info
 * @param {object} user
 */
export async function setUser(user) {
  await chrome.storage.local.set({ [KEYS.USER]: user });
}

/**
 * Get encrypted passkey credential source map by credentialId.
 * @returns {Promise<Record<string, string>>}
 */
export async function getPasskeyCredentialSources() {
  const result = await chrome.storage.local.get(KEYS.PASSKEY_CREDENTIAL_SOURCES);
  return result[KEYS.PASSKEY_CREDENTIAL_SOURCES] ?? {};
}

/**
 * Store encrypted passkey credential source map by credentialId.
 * @param {Record<string, string>} sources
 */
export async function setPasskeyCredentialSources(sources) {
  await chrome.storage.local.set({ [KEYS.PASSKEY_CREDENTIAL_SOURCES]: sources });
}

/**
 * Get non-secret passkey credential index map by credentialId.
 * @returns {Promise<Record<string, object>>}
 */
export async function getPasskeyCredentialIndex() {
  const result = await chrome.storage.local.get(KEYS.PASSKEY_CREDENTIAL_INDEX);
  return result[KEYS.PASSKEY_CREDENTIAL_INDEX] ?? {};
}

/**
 * Store non-secret passkey credential index map by credentialId.
 * @param {Record<string, object>} index
 */
export async function setPasskeyCredentialIndex(index) {
  await chrome.storage.local.set({ [KEYS.PASSKEY_CREDENTIAL_INDEX]: index });
}

/**
 * Clear all stored data (logout)
 */
export async function clearAll() {
  await chrome.storage.local.clear();
}
