// passkey/client-data.js
// Builds WebAuthn clientDataJSON payload bytes.

import { utf8ToBytes } from './base64url.js';

/**
 * @param {{
 *   type: 'webauthn.create'|'webauthn.get',
 *   challengeBase64Url: string,
 *   origin: string,
 *   crossOrigin?: boolean
 * }} params
 * @returns {{ json: string, bytes: Uint8Array }}
 */
export function buildClientDataJSON(params) {
  const payload = {
    type: params.type,
    challenge: params.challengeBase64Url,
    origin: params.origin,
    crossOrigin: params.crossOrigin ?? false
  };

  const json = JSON.stringify(payload);
  return {
    json,
    bytes: utf8ToBytes(json)
  };
}
