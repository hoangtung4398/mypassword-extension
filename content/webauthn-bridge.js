// content/webauthn-bridge.js
// MAIN world hook for navigator.credentials.create/get.

(function () {
  'use strict';

  if (window.__mypasswordPasskeyBridgeInstalled) return;
  window.__mypasswordPasskeyBridgeInstalled = true;

  const BRIDGE_SOURCE = 'mypassword-webauthn-bridge';
  const FORWARDER_SOURCE = 'mypassword-passkey-forwarder';
  const PasskeyCommands = {
    CreateRequest: 'mypassword.passkey.create',
    GetRequest: 'mypassword.passkey.get'
  };

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

  /**
   * @param {{ host: string, duplicate?: boolean }} params
   * @returns {Promise<'extension'|'native'|'cancel'>}
   */
  function showCreateChooser(params) {
    return new Promise((resolve) => {
      const existing = document.getElementById('mypassword-passkey-chooser-overlay');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'mypassword-passkey-chooser-overlay';
      overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2147483647',
        'background:rgba(12,16,24,0.45)',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'padding:16px'
      ].join(';');

      const card = document.createElement('div');
      card.style.cssText = [
        'width:100%',
        'max-width:420px',
        'border-radius:14px',
        'border:1px solid #d5ddea',
        'background:#ffffff',
        'box-shadow:0 14px 48px rgba(2,8,20,0.25)',
        'font-family:ui-sans-serif,Segoe UI,Roboto,Helvetica,Arial,sans-serif',
        'overflow:hidden'
      ].join(';');

      const title = document.createElement('div');
      title.textContent = params.duplicate ? 'Passkey already exists' : 'Save passkey';
      title.style.cssText = 'padding:14px 16px;font-size:18px;font-weight:700;color:#0f172a;border-bottom:1px solid #e2e8f0;';

      const body = document.createElement('div');
      body.style.cssText = 'padding:16px;color:#1e293b;font-size:14px;line-height:1.45;';
      body.textContent = params.duplicate
        ? 'A passkey already exists for this application in MyPassword. You can use your device or hardware key instead.'
        : `Create and save a passkey for ${params.host} with MyPassword, or use your device or hardware key.`;

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;padding:0 16px 16px;';

      function makeButton(label, styles, value) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.style.cssText = styles;
        btn.addEventListener('click', () => {
          overlay.remove();
          resolve(value);
        });
        return btn;
      }

      const extensionBtn = makeButton(
        'Use MyPassword',
        'padding:10px 14px;border:1px solid #2563eb;background:#2563eb;color:#fff;border-radius:10px;font-weight:600;cursor:pointer;',
        'extension'
      );

      const nativeBtn = makeButton(
        'Use your device or hardware key',
        'padding:10px 14px;border:1px solid #94a3b8;background:#fff;color:#0f172a;border-radius:10px;font-weight:600;cursor:pointer;',
        'native'
      );

      const cancelBtn = makeButton(
        'Cancel',
        'padding:10px 14px;border:1px solid #cbd5e1;background:#f8fafc;color:#334155;border-radius:10px;font-weight:600;cursor:pointer;',
        'cancel'
      );

      actions.append(extensionBtn, nativeBtn, cancelBtn);
      card.append(title, body, actions);
      overlay.append(card);

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          overlay.remove();
          resolve('cancel');
        }
      });

      document.documentElement.appendChild(overlay);
    });
  }

  navigator.credentials.create = async function patchedCreate(options) {
    if (!options?.publicKey) {
      return originalCreate(options);
    }

    const userChoice = await showCreateChooser({ host: window.location.hostname });
    if (userChoice === 'native') {
      return originalCreate(options);
    }
    if (userChoice !== 'extension') {
      throw new DOMException('User cancelled passkey creation', 'NotAllowedError');
    }

    const requestId = `create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const serialized = cloneCreateOptions(options);

    window.postMessage({
      source: BRIDGE_SOURCE,
      command: PasskeyCommands.CreateRequest,
      kind: 'PASSKEY_CREATE_REQUEST',
      requestId,
      consentGranted: true,
      options: serialized
    }, '*');

    const timeoutMs = options.publicKey.timeout || 60000;
    try {
      const result = await awaitForwarderResponse(requestId, timeoutMs);
      return makeCreateCredentialResponse(result);
    } catch (error) {
      const isDuplicate = error?.name === 'InvalidStateError'
        || /already exists/i.test(error?.message || '');

      if (isDuplicate) {
        const duplicateChoice = await showCreateChooser({
          host: window.location.hostname,
          duplicate: true
        });

        if (duplicateChoice === 'native') {
          return originalCreate(options);
        }
        if (duplicateChoice === 'cancel') {
          throw new DOMException('User cancelled passkey creation', 'NotAllowedError');
        }
      }

      console.warn('[mypassword-passkey] create failed', {
        name: error?.name,
        message: error?.message,
        origin: window.location.origin
      });
      throw error;
    }
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
      command: PasskeyCommands.GetRequest,
      kind: 'PASSKEY_GET_REQUEST',
      requestId,
      consentGranted: true,
      options: serialized
    }, '*');

    const timeoutMs = options.publicKey.timeout || 60000;
    try {
      const result = await awaitForwarderResponse(requestId, timeoutMs);
      return makeGetCredentialResponse(result);
    } catch (error) {
      console.warn('[mypassword-passkey] get failed', {
        name: error?.name,
        message: error?.message,
        origin: window.location.origin
      });
      throw error;
    }
  };
})();
