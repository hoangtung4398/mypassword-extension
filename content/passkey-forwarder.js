// content/passkey-forwarder.js
// Isolated-world transport between the main-world bridge and service worker.

(function () {
  'use strict';

  const BRIDGE_SOURCE = 'mypassword-webauthn-bridge';
  const FORWARDER_SOURCE = 'mypassword-passkey-forwarder';

  function getTopOriginSafe() {
    try {
      return window.top?.location?.origin || null;
    } catch {
      return null;
    }
  }

  function getFrameDepth() {
    let depth = 0;
    let current = window;
    try {
      while (current !== current.parent) {
        depth += 1;
        current = current.parent;
      }
    } catch {
      // Keep collected depth when cross-origin boundary is hit.
    }
    return depth;
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.source !== BRIDGE_SOURCE) return;

    if (message.kind !== 'PASSKEY_CREATE_REQUEST' && message.kind !== 'PASSKEY_GET_REQUEST') return;

    try {
      const payload = {
        type: message.kind,
        requestId: message.requestId,
        options: message.options,
        consentGranted: !!message.consentGranted,
        origin: window.location.origin,
        topOrigin: getTopOriginSafe(),
        frameDepth: getFrameDepth()
      };

      const response = await chrome.runtime.sendMessage(payload);
      window.postMessage({
        source: FORWARDER_SOURCE,
        requestId: message.requestId,
        ok: !!response?.ok,
        result: response?.result,
        error: response?.error || null
      }, '*');
    } catch (error) {
      window.postMessage({
        source: FORWARDER_SOURCE,
        requestId: message.requestId,
        ok: false,
        error: {
          name: 'UnknownError',
          message: error?.message || 'Passkey request failed'
        }
      }, '*');
    }
  });
})();
