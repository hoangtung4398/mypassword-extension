// passkey/authenticator-data.js
// Builds authenticatorData for attestation/assertion and COSE public key bytes.

import { fromBase64Url } from './base64url.js';

export const FLAGS = {
  UP: 0x01,
  UV: 0x04,
  AT: 0x40,
  ED: 0x80
};

export const ZERO_AAGUID = new Uint8Array(16);

/**
 * @param {string} rpId
 * @returns {Promise<Uint8Array>}
 */
export async function hashRpId(rpId) {
  const bytes = new TextEncoder().encode(rpId);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(digest);
}

/**
 * @param {number} value
 * @returns {Uint8Array}
 */
function u16be(value) {
  return new Uint8Array([(value >> 8) & 0xff, value & 0xff]);
}

/**
 * @param {number} value
 * @returns {Uint8Array}
 */
function u32be(value) {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  ]);
}

/**
 * @param {...Uint8Array} chunks
 * @returns {Uint8Array}
 */
export function concatBytes(...chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

/**
 * Minimal CBOR encoder that supports numbers, byte strings, text, arrays and maps.
 * @param {number} majorType
 * @param {number} value
 * @returns {Uint8Array}
 */
function encodeTypeAndLength(majorType, value) {
  if (value < 24) {
    return new Uint8Array([(majorType << 5) | value]);
  }
  if (value < 0x100) {
    return new Uint8Array([(majorType << 5) | 24, value]);
  }
  if (value < 0x10000) {
    return new Uint8Array([(majorType << 5) | 25, (value >> 8) & 0xff, value & 0xff]);
  }
  if (value < 0x100000000) {
    return new Uint8Array([
      (majorType << 5) | 26,
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff
    ]);
  }
  throw new Error('CBOR length too large for encoder');
}

/**
 * @param {number} value
 * @returns {Uint8Array}
 */
function encodeInteger(value) {
  if (value >= 0) {
    return encodeTypeAndLength(0, value);
  }
  return encodeTypeAndLength(1, -1 - value);
}

/**
 * @param {Uint8Array} value
 * @returns {Uint8Array}
 */
function encodeByteString(value) {
  return concatBytes(encodeTypeAndLength(2, value.length), value);
}

/**
 * @param {Map<number, number|Uint8Array>} map
 * @returns {Uint8Array}
 */
function encodeIntMap(map) {
  const entries = Array.from(map.entries());
  const encodedEntries = [];
  for (const [key, value] of entries) {
    encodedEntries.push(encodeInteger(key));
    if (typeof value === 'number') {
      encodedEntries.push(encodeInteger(value));
    } else {
      encodedEntries.push(encodeByteString(value));
    }
  }
  return concatBytes(encodeTypeAndLength(5, entries.length), ...encodedEntries);
}

/**
 * @param {{ x: string, y: string }} publicJwk
 * @returns {Uint8Array}
 */
export function encodeCoseEc2PublicKey(publicJwk) {
  const x = fromBase64Url(publicJwk.x);
  const y = fromBase64Url(publicJwk.y);

  // COSE Key for EC2 P-256 / ES256.
  const cose = new Map([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, x],
    [-3, y]
  ]);

  return encodeIntMap(cose);
}

/**
 * @param {{
 *   rpId: string,
 *   flags: number,
 *   signCount: number,
 *   credentialId: Uint8Array,
 *   credentialPublicKey: Uint8Array,
 *   aaguid?: Uint8Array
 * }} params
 * @returns {Promise<Uint8Array>}
 */
export async function buildAttestedAuthenticatorData(params) {
  const rpIdHash = await hashRpId(params.rpId);
  const flags = new Uint8Array([params.flags]);
  const signCount = u32be(params.signCount);
  const aaguid = params.aaguid ?? ZERO_AAGUID;
  const credIdLen = u16be(params.credentialId.length);

  return concatBytes(
    rpIdHash,
    flags,
    signCount,
    aaguid,
    credIdLen,
    params.credentialId,
    params.credentialPublicKey
  );
}
