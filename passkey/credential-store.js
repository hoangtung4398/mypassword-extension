// passkey/credential-store.js
// Local encrypted credential source persistence for passkeys.

import { getOrCreateVaultKey } from '../lib/vault-key.js';
import { encryptItem, decryptItem } from '../lib/crypto.js';
import {
  getPasskeyCredentialSources,
  setPasskeyCredentialSources,
  getPasskeyCredentialIndex,
  setPasskeyCredentialIndex
} from '../lib/storage.js';

/**
 * @param {object} credentialSource
 * @returns {Promise<void>}
 */
export async function saveCredentialSource(credentialSource) {
  const vaultKey = await getOrCreateVaultKey();
  const encrypted = await encryptItem(vaultKey, credentialSource);

  const sources = await getPasskeyCredentialSources();
  sources[credentialSource.credentialId] = encrypted;
  await setPasskeyCredentialSources(sources);

  const index = await getPasskeyCredentialIndex();
  index[credentialSource.credentialId] = {
    credentialId: credentialSource.credentialId,
    rpId: credentialSource.rpId,
    userName: credentialSource.userName,
    lastUsedAt: null,
    isSynced: false
  };
  await setPasskeyCredentialIndex(index);
}

/**
 * @param {object} credentialSource
 * @returns {Promise<void>}
 */
export async function updateCredentialSource(credentialSource) {
  const vaultKey = await getOrCreateVaultKey();
  const encrypted = await encryptItem(vaultKey, credentialSource);

  const sources = await getPasskeyCredentialSources();
  sources[credentialSource.credentialId] = encrypted;
  await setPasskeyCredentialSources(sources);

  const index = await getPasskeyCredentialIndex();
  const existing = index[credentialSource.credentialId] || {};
  index[credentialSource.credentialId] = {
    ...existing,
    credentialId: credentialSource.credentialId,
    rpId: credentialSource.rpId,
    userName: credentialSource.userName,
    lastUsedAt: new Date().toISOString(),
    isSynced: false
  };
  await setPasskeyCredentialIndex(index);
}

/**
 * @param {string} credentialId
 * @returns {Promise<object|null>}
 */
export async function getCredentialSource(credentialId) {
  const sources = await getPasskeyCredentialSources();
  const encrypted = sources[credentialId];
  if (!encrypted) return null;

  const vaultKey = await getOrCreateVaultKey();
  return decryptItem(vaultKey, encrypted);
}

/**
 * @param {string} rpId
 * @returns {Promise<object[]>}
 */
export async function listCredentialIndexByRp(rpId) {
  const index = await getPasskeyCredentialIndex();
  return Object.values(index).filter((entry) => entry.rpId === rpId);
}
