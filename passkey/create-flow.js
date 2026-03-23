// passkey/create-flow.js
// Registration flow (Milestone B) for extension-managed WebAuthn passkeys.

import { toBase64Url, fromBase64Url } from './base64url.js';
import { buildClientDataJSON } from './client-data.js';
import {
  FLAGS,
  concatBytes,
  ZERO_AAGUID,
  hashRpId,
  encodeCoseEc2PublicKey,
  buildAttestedAuthenticatorData
} from './authenticator-data.js';
import {
  saveCredentialSource,
  getCredentialSource,
  listCredentialIndexByRp,
  updateCredentialSource
} from './credential-store.js';

const AAGUID = '00000000-0000-0000-0000-000000000000';

/**
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
  throw new Error('CBOR length too large');
}

/**
 * @param {string} value
 * @returns {Uint8Array}
 */
function encodeText(value) {
  const bytes = new TextEncoder().encode(value);
  return concatBytes(encodeTypeAndLength(3, bytes.length), bytes);
}

/**
 * @param {Uint8Array} value
 * @returns {Uint8Array}
 */
function encodeBytes(value) {
  return concatBytes(encodeTypeAndLength(2, value.length), value);
}

/**
 * @param {object} value
 * @returns {Uint8Array}
 */
function encodeSimpleMap(value) {
  const entries = Object.entries(value);
  const encoded = [encodeTypeAndLength(5, entries.length)];

  for (const [key, item] of entries) {
    encoded.push(encodeText(key));
    if (typeof item === 'string') {
      encoded.push(encodeText(item));
    } else if (item instanceof Uint8Array) {
      encoded.push(encodeBytes(item));
    } else if (item && typeof item === 'object') {
      encoded.push(encodeSimpleMap(item));
    } else {
      throw new Error('Unsupported CBOR map value');
    }
  }

  return concatBytes(...encoded);
}

/**
 * @param {string} host
 * @param {string} rpId
 * @returns {boolean}
 */
function isRpIdValidForHost(host, rpId) {
  return host === rpId || host.endsWith(`.${rpId}`);
}

/**
 * @param {any} request
 */
function validateCreateRequest(request) {
  if (!request?.publicKey) throw createError('TypeError', 'Missing publicKey options');
  if (!request.publicKey.challenge) throw createError('TypeError', 'Missing challenge');
  if (!request.publicKey.user?.id) throw createError('TypeError', 'Missing user.id');

  const algs = request.publicKey.pubKeyCredParams || [];
  if (!algs.some((item) => item?.alg === -7 && item?.type === 'public-key')) {
    throw createError('NotSupportedError', 'Only ES256 (-7) is supported');
  }
}

/**
 * @param {'required'|'preferred'|'discouraged'|undefined} value
 * @returns {boolean}
 */
function shouldSetUserVerified(value) {
  return value === 'required' || value === 'preferred';
}

/**
 * @param {string} name
 * @param {string} message
 */
function createError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

/**
 * @param {string} origin
 * @returns {URL}
 */
function parseAndValidateOrigin(origin) {
  const url = new URL(origin);
  if (url.protocol !== 'https:') {
    throw createError('SecurityError', 'Passkey creation requires HTTPS origin');
  }
  return url;
}

/**
 * @param {{ frameId?: number|null, topLevelOrigin?: string|null, senderOrigin?: string|null }} context
 * @param {URL} originUrl
 * @param {string} rpId
 */
function validateFramePolicy(context, originUrl, rpId) {
  if (context?.senderOrigin && context.senderOrigin !== originUrl.origin) {
    throw createError('SecurityError', 'Sender origin does not match passkey origin');
  }

  const frameId = Number.isInteger(context?.frameId) ? context.frameId : 0;
  const topLevelOrigin = context?.topLevelOrigin || null;
  if (frameId !== 0 && topLevelOrigin) {
    let topHost = '';
    try {
      topHost = new URL(topLevelOrigin).hostname;
    } catch {
      throw createError('SecurityError', 'Invalid top-level origin for frame request');
    }

    const originHost = originUrl.hostname;
    const topMatchesRp = topHost === rpId || topHost.endsWith(`.${rpId}`);
    const originMatchesRp = originHost === rpId || originHost.endsWith(`.${rpId}`);

    if (!topMatchesRp || !originMatchesRp) {
      throw createError('SecurityError', 'Cross-origin iframe passkey requests are blocked');
    }
  }
}

/**
 * @param {{ options: any, consentGranted?: boolean }} payload
 * @param {{ origin: string }} context
 */
export async function handlePasskeyCreateRequest(payload, context) {
  const originUrl = parseAndValidateOrigin(context.origin);
  if (!payload?.consentGranted) {
    throw createError('NotAllowedError', 'User cancelled passkey creation');
  }

  validateCreateRequest(payload.options);

  const publicKey = payload.options.publicKey;
  const rpId = publicKey.rp?.id || originUrl.hostname;
  if (!isRpIdValidForHost(originUrl.hostname, rpId)) {
    throw createError('SecurityError', 'rpId is not valid for this origin');
  }
  validateFramePolicy(context, originUrl, rpId);

  // If any excluded credential already exists for this RP, mimic authenticator behavior.
  for (const excluded of publicKey.excludeCredentials || []) {
    if (!excluded?.id) continue;
    const existing = await getCredentialSource(excluded.id);
    if (existing && existing.rpId === rpId) {
      throw createError('InvalidStateError', 'A passkey already exists for this application');
    }
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

  const credentialId = crypto.getRandomValues(new Uint8Array(32));
  const userHandle = fromBase64Url(publicKey.user.id);
  const credentialPublicKey = encodeCoseEc2PublicKey(publicJwk);

  const { bytes: clientDataBytes } = buildClientDataJSON({
    type: 'webauthn.create',
    challengeBase64Url: publicKey.challenge,
    origin: context.origin,
    crossOrigin: false
  });

  const authenticatorData = await buildAttestedAuthenticatorData({
    rpId,
    flags: FLAGS.UP | FLAGS.AT |
      (shouldSetUserVerified(publicKey.authenticatorSelection?.userVerification) ? FLAGS.UV : 0),
    signCount: 0,
    credentialId,
    credentialPublicKey,
    aaguid: ZERO_AAGUID
  });

  const attestationObject = encodeSimpleMap({
    fmt: 'none',
    authData: authenticatorData,
    attStmt: {}
  });

  const now = new Date().toISOString();
  const credentialIdBase64Url = toBase64Url(credentialId);
  const source = {
    id: crypto.randomUUID(),
    credentialId: credentialIdBase64Url,
    rpId,
    rpName: publicKey.rp?.name || rpId,
    userHandle: toBase64Url(userHandle),
    userName: publicKey.user?.name || '',
    userDisplayName: publicKey.user?.displayName || publicKey.user?.name || '',
    privateKeyJwk: privateJwk,
    publicKeyCose: toBase64Url(credentialPublicKey),
    alg: -7,
    signCount: 0,
    discoverable: true,
    createdAt: now,
    updatedAt: now,
    aaguid: AAGUID
  };

  await saveCredentialSource(source);

  return {
    id: credentialIdBase64Url,
    rawId: credentialIdBase64Url,
    type: 'public-key',
    authenticatorAttachment: 'cross-platform',
    response: {
      clientDataJSON: toBase64Url(clientDataBytes),
      attestationObject: toBase64Url(attestationObject)
    },
    clientExtensionResults: {}
  };
}

/**
 * @param {{ options: any, consentGranted?: boolean }} payload
 * @param {{ origin: string }} context
 */
export async function handlePasskeyGetRequest(payload, context) {
  const originUrl = parseAndValidateOrigin(context.origin);
  if (!payload?.consentGranted) {
    throw createError('NotAllowedError', 'User cancelled passkey sign-in');
  }

  const request = payload?.options;
  if (!request?.publicKey?.challenge) {
    throw createError('TypeError', 'Missing challenge');
  }

  const publicKey = request.publicKey;
  const rpId = publicKey.rpId || originUrl.hostname;
  if (!isRpIdValidForHost(originUrl.hostname, rpId)) {
    throw createError('SecurityError', 'rpId is not valid for this origin');
  }
  validateFramePolicy(context, originUrl, rpId);

  const allowCredentialIds = (publicKey.allowCredentials || [])
    .filter((item) => !item?.type || item.type === 'public-key')
    .map((item) => item?.id)
    .filter(Boolean);

  let selectedCredentialId = null;
  if (allowCredentialIds.length > 0) {
    for (const credentialId of allowCredentialIds) {
      const source = await getCredentialSource(credentialId);
      if (source && source.rpId === rpId) {
        selectedCredentialId = credentialId;
        break;
      }
    }
  } else {
    const candidates = await listCredentialIndexByRp(rpId);
    if (candidates.length > 0) {
      selectedCredentialId = candidates[0].credentialId;
    }
  }

  if (!selectedCredentialId) {
    throw createError('NotAllowedError', 'No passkey available for this site');
  }

  const credentialSource = await getCredentialSource(selectedCredentialId);
  if (!credentialSource) {
    throw createError('NotAllowedError', 'Credential not found');
  }

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    credentialSource.privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const { bytes: clientDataBytes } = buildClientDataJSON({
    type: 'webauthn.get',
    challengeBase64Url: publicKey.challenge,
    origin: context.origin,
    crossOrigin: false
  });

  const newSignCount = Number(credentialSource.signCount || 0) + 1;
  const rpIdHash = await hashRpId(rpId);
  const uvRequested = shouldSetUserVerified(publicKey.userVerification);
  const flags = new Uint8Array([FLAGS.UP | (uvRequested ? FLAGS.UV : 0)]);
  const signCountBytes = new Uint8Array([
    (newSignCount >>> 24) & 0xff,
    (newSignCount >>> 16) & 0xff,
    (newSignCount >>> 8) & 0xff,
    newSignCount & 0xff
  ]);
  const authenticatorData = concatBytes(rpIdHash, flags, signCountBytes);

  const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataBytes));
  const signedData = concatBytes(authenticatorData, clientDataHash);

  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    signedData
  ));

  credentialSource.signCount = newSignCount;
  credentialSource.updatedAt = new Date().toISOString();
  await updateCredentialSource(credentialSource);

  return {
    id: credentialSource.credentialId,
    rawId: credentialSource.credentialId,
    type: 'public-key',
    authenticatorAttachment: 'cross-platform',
    response: {
      clientDataJSON: toBase64Url(clientDataBytes),
      authenticatorData: toBase64Url(authenticatorData),
      signature: toBase64Url(signature),
      userHandle: credentialSource.userHandle || null
    },
    clientExtensionResults: {}
  };
}
