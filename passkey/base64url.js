// passkey/base64url.js
// Utilities for converting between byte arrays and base64url strings.

/**
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {string}
 */
export function toBase64Url(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * @param {string} value
 * @returns {Uint8Array}
 */
export function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const base64 = normalized + padding;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * @param {string} value
 * @returns {ArrayBuffer}
 */
export function base64UrlToArrayBuffer(value) {
  return fromBase64Url(value).buffer;
}

/**
 * @param {string} value
 * @returns {Uint8Array}
 */
export function utf8ToBytes(value) {
  return new TextEncoder().encode(value);
}
