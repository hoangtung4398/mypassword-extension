// lib/storage.js — wrapper around chrome.storage.local
// All token and vault key storage operations

const KEYS = {
  ACCESS_TOKEN: 'accessToken',
  REFRESH_TOKEN: 'refreshToken',
  VAULT_KEY: 'vaultKey',
  USER: 'user'
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
 * Clear all stored data (logout)
 */
export async function clearAll() {
  await chrome.storage.local.clear();
}
