// lib/crypto.js — Web Crypto API helpers for AES-256-GCM encryption
// Zero-knowledge: server never sees plaintext vault data

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96-bit IV for AES-GCM

/**
 * Derive an AES-256-GCM key from a secret using PBKDF2-SHA256
 * @param {string} secret - The master secret (e.g. device secret or user token)
 * @param {string} saltBase64 - Base64-encoded salt
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKey(secret, saltBase64) {
  const encoder = new TextEncoder();
  const salt = base64ToBytes(saltBase64);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Export a CryptoKey to base64 string for storage
 * @param {CryptoKey} key
 * @returns {Promise<string>}
 */
export async function exportKey(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bytesToBase64(new Uint8Array(raw));
}

/**
 * Import a base64-encoded key for AES-GCM
 * @param {string} keyBase64
 * @returns {Promise<CryptoKey>}
 */
export async function importKey(keyBase64) {
  const raw = base64ToBytes(keyBase64);
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a plain object to format: base64(IV).base64(ciphertext+tag)
 * @param {CryptoKey} key
 * @param {object} plainObject
 * @returns {Promise<string>}
 */
export async function encryptItem(key, plainObject) {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(plainObject));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
}

/**
 * Decrypt from format: base64(IV).base64(ciphertext+tag) to a plain object
 * @param {CryptoKey} key
 * @param {string} encryptedData - "base64(IV).base64(ciphertext+tag)"
 * @returns {Promise<object>}
 */
export async function decryptItem(key, encryptedData) {
  const [ivBase64, ciphertextBase64] = encryptedData.split('.');
  if (!ivBase64 || !ciphertextBase64) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = base64ToBytes(ivBase64);
  const ciphertext = base64ToBytes(ciphertextBase64);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(plaintext));
}

/**
 * Generate a cryptographically random 32-byte device secret as base64
 * @returns {string}
 */
export function generateDeviceSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64(bytes);
}

/**
 * Generate a random base64-encoded salt
 * @returns {string}
 */
export function generateSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return bytesToBase64(bytes);
}

// ---- Utilities ----

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(base64) {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}
