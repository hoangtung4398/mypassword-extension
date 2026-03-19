// content/webauthn-bridge.js
// MAIN world hook for navigator.credentials.create/get.

(function () {
  'use strict';

  if (window.__mypasswordPasskeyBridgeInstalled) return;
  window.__mypasswordPasskeyBridgeInstalled = true;

  const BRIDGE_SOURCE = 'mypassword-webauthn-bridge';
  const FORWARDER_SOURCE = 'mypassword-passkey-forwarder';

  const originalCreate = navigator.credentials?.create?.bind(navigator.credentials);
  const originalGet = navigator.credentials?.get?.bind(navigator.credentials);

  if (!originalCreate || !originalGet) return;

  function toUint8Array(bufferSource) {
    if (bufferSource instanceof ArrayBuffer) {
      return new Uint8Array(bufferSource);
    }
    if (ArrayBuffer.isView(bufferSource)) {
      return new Uint8Array(bufferSource.buffer, bufferSource.byteOffset, bufferSource.byteLength);
    }
    throw new DOMException('Expected BufferSource value', 'TypeError');
  }

  function toBase64Url(input) {
    const bytes = toUint8Array(input);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function fromBase64Url(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    const binary = atob(normalized + padding);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function cloneCreateOptions(options) {
    const pk = options.publicKey;
    return {
      publicKey: {
        ...pk,
        challenge: toBase64Url(pk.challenge),
        user: {
          ...pk.user,
          id: toBase64Url(pk.user.id)
        },
        excludeCredentials: (pk.excludeCredentials || []).map((item) => ({
          ...item,
          id: toBase64Url(item.id)
        }))
      }
    };
  }

  function cloneGetOptions(options) {
    const pk = options.publicKey;
    return {
      publicKey: {
        ...pk,
        challenge: toBase64Url(pk.challenge),
        allowCredentials: (pk.allowCredentials || []).map((item) => ({
          ...item,
          id: toBase64Url(item.id)
        }))
      }
    };
  }

  function awaitForwarderResponse(requestId, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        reject(new DOMException('Passkey request timed out', 'NotAllowedError'));
      }, timeoutMs);

      function onMessage(event) {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== FORWARDER_SOURCE || data.requestId !== requestId) return;

        settled = true;
        clearTimeout(timeout);
        window.removeEventListener('message', onMessage);

        if (data.ok) {
          resolve(data.result);
          return;
        }

        reject(new DOMException(data.error?.message || 'Passkey request failed', data.error?.name || 'UnknownError'));
      }

      window.addEventListener('message', onMessage);
    });
  }

  function makeCreateCredentialResponse(result) {
    const response = {
      clientDataJSON: fromBase64Url(result.response.clientDataJSON),
      attestationObject: fromBase64Url(result.response.attestationObject),
      getTransports() {
        return ['internal'];
      }
    };

    return {
      id: result.id,
      rawId: fromBase64Url(result.rawId),
      type: result.type,
      authenticatorAttachment: result.authenticatorAttachment || null,
      response,
      getClientExtensionResults() {
        return result.clientExtensionResults || {};
      },
      toJSON() {
        return {
          id: result.id,
          rawId: result.rawId,
          type: result.type,
          response: result.response,
          authenticatorAttachment: result.authenticatorAttachment || null,
          clientExtensionResults: result.clientExtensionResults || {}
        };
      }
    };
  }

  function makeGetCredentialResponse(result) {
    const response = {
      clientDataJSON: fromBase64Url(result.response.clientDataJSON),
      authenticatorData: fromBase64Url(result.response.authenticatorData),
      signature: fromBase64Url(result.response.signature),
      userHandle: result.response.userHandle ? fromBase64Url(result.response.userHandle) : null
    };

    return {
      id: result.id,
      rawId: fromBase64Url(result.rawId),
      type: result.type,
      authenticatorAttachment: result.authenticatorAttachment || null,
      response,
      getClientExtensionResults() {
        return result.clientExtensionResults || {};
      },
      toJSON() {
        return {
          id: result.id,
          rawId: result.rawId,
          type: result.type,
          response: result.response,
          authenticatorAttachment: result.authenticatorAttachment || null,
          clientExtensionResults: result.clientExtensionResults || {}
        };
      }
    };
  }

  navigator.credentials.create = async function patchedCreate(options) {
    if (!options?.publicKey) {
      return originalCreate(options);
    }

    const consent = window.confirm(`Create passkey for ${window.location.hostname}?`);
    if (!consent) {
      throw new DOMException('User cancelled passkey creation', 'NotAllowedError');
    }

    const requestId = `create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const serialized = cloneCreateOptions(options);

    window.postMessage({
      source: BRIDGE_SOURCE,
      kind: 'PASSKEY_CREATE_REQUEST',
      requestId,
      consentGranted: true,
      options: serialized
    }, '*');

    const timeoutMs = options.publicKey.timeout || 60000;
    const result = await awaitForwarderResponse(requestId, timeoutMs);
    return makeCreateCredentialResponse(result);
  };

  navigator.credentials.get = async function patchedGet(options) {
    if (!options?.publicKey) {
      return originalGet(options);
    }

    const consent = window.confirm(`Sign in with passkey for ${window.location.hostname}?`);
    if (!consent) {
      throw new DOMException('User cancelled passkey sign-in', 'NotAllowedError');
    }

    const requestId = `get-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const serialized = cloneGetOptions(options);

    window.postMessage({
      source: BRIDGE_SOURCE,
      kind: 'PASSKEY_GET_REQUEST',
      requestId,
      consentGranted: true,
      options: serialized
    }, '*');

    const timeoutMs = options.publicKey.timeout || 60000;
    const result = await awaitForwarderResponse(requestId, timeoutMs);
    return makeGetCredentialResponse(result);
  };
})();
