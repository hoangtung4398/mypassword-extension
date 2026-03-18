// lib/vault-key.js — Vault encryption key management
// Ensures each user has a device-specific vault key for client-side encryption

import { getVaultKey, setVaultKey } from './storage.js';
import { generateDeviceSecret, deriveKey, exportKey, importKey, generateSalt } from './crypto.js';

/**
 * Ensure vault key exists for the current user.
 * Generates a new key on first login, or retrieves existing key.
 * @param {string} userEmail - Used for logging (not used in key derivation for now)
 * @returns {Promise<CryptoKey>}
 */
export async function ensureVaultKey(userEmail) {
  let keyBase64 = await getVaultKey();

  if (!keyBase64) {
    // First login - generate new vault key
    console.log('[vault-key] Generating new vault key for user:', userEmail);

    const deviceSecret = generateDeviceSecret();
    const salt = generateSalt();

    // Derive AES-256-GCM key from device secret + salt
    const vaultKey = await deriveKey(deviceSecret, salt);
    keyBase64 = await exportKey(vaultKey);

    // Store for future use
    await setVaultKey(keyBase64);

    console.log('[vault-key] Vault key generated and stored');
    return vaultKey;
  }

  // Import existing key
  console.log('[vault-key] Using existing vault key');
  return importKey(keyBase64);
}

/**
 * Get vault key (must exist, throws if not initialized).
 * Use this for vault operations where key should already be present.
 * @returns {Promise<CryptoKey>}
 */
export async function getOrCreateVaultKey() {
  const keyBase64 = await getVaultKey();

  if (!keyBase64) {
    throw new Error('Vault key not initialized. Please log in again.');
  }

  return importKey(keyBase64);
}
