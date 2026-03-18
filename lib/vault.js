// lib/vault.js — Vault CRUD operations with client-side encryption
// All vault data is encrypted before sending to API (zero-knowledge architecture)

import { getOrCreateVaultKey } from './vault-key.js';
import { encryptItem, decryptItem } from './crypto.js';
import { apiPost, apiPut, apiDelete, apiGet } from './api.js';

/**
 * Create a new vault item with client-side encryption
 * @param {string} name - Item name (e.g., "GitHub", "My Note")
 * @param {string|null} url - Website URL (optional, for Login items)
 * @param {object} plainData - Plain data to encrypt { username, password, notes, etc. }
 * @param {number} itemType - 1=Login, 2=SecureNote, 3=CreditCard
 * @returns {Promise<VaultItem>}
 */
export async function createVaultItem(name, url, plainData, itemType) {
  const vaultKey = await getOrCreateVaultKey();
  const encryptedData = await encryptItem(vaultKey, plainData);

  return apiPost('/vault/items', {
    name,
    url: url || null,
    encryptedData,
    itemType
  });
}

/**
 * Update existing vault item with encryption
 * @param {string} id - Item UUID
 * @param {string} name
 * @param {string|null} url
 * @param {object} plainData
 * @param {number} itemType
 * @returns {Promise<VaultItem>}
 */
export async function updateVaultItem(id, name, url, plainData, itemType) {
  const vaultKey = await getOrCreateVaultKey();
  const encryptedData = await encryptItem(vaultKey, plainData);

  return apiPut(`/vault/items/${id}`, {
    name,
    url: url || null,
    encryptedData,
    itemType
  });
}

/**
 * Delete vault item (soft delete on server)
 * @param {string} id - Item UUID
 * @returns {Promise<void>}
 */
export async function deleteVaultItem(id) {
  return apiDelete(`/vault/items/${id}`);
}

/**
 * Get and decrypt a vault item
 * @param {string} id - Item UUID
 * @returns {Promise<{ item: VaultItem, decryptedData: object }>}
 */
export async function getVaultItemWithDecryption(id) {
  const item = await apiGet(`/vault/items/${id}`);
  const vaultKey = await getOrCreateVaultKey();
  const decryptedData = await decryptItem(vaultKey, item.encryptedData);

  return { item, decryptedData };
}
