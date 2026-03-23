// content/passkey-forwarder.js
// Isolated-world transport between the main-world bridge and service worker.
// Uses command routing + trusted-event validation for safer message handling.

(function () {
  'use strict';

  const BRIDGE_SOURCE = 'mypassword-webauthn-bridge';
  const FORWARDER_SOURCE = 'mypassword-passkey-forwarder';
  const PasskeyCommands = {
    CreateRequest: 'mypassword.passkey.create',
    GetRequest: 'mypassword.passkey.get'
  };

  const commandToRuntimeType = {
    [PasskeyCommands.CreateRequest]: 'PASSKEY_CREATE_REQUEST',
    [PasskeyCommands.GetRequest]: 'PASSKEY_GET_REQUEST'
  };

  class EventSecurity {
    /** @param {MessageEvent} event */
    static isTrusted(event) {
      return event.isTrusted === true;
    }
  }

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

  /** @param {{ requestId?: string, error: { name: string, message: string } }} data */
  function postFailure(data) {
    window.postMessage({
      source: FORWARDER_SOURCE,
      requestId: data.requestId,
      ok: false,
      error: data.error
    }, '*');
  }

  /** @param {any} payload */
  function postSuccess(payload) {
    window.postMessage(payload, '*');
  }

  /** @param {any} message */
  async function handlePasskeyRequest(message) {
    const runtimeType = commandToRuntimeType[message.command];
    if (!runtimeType) return;

    try {
      const payload = {
        type: runtimeType,
        requestId: message.requestId,
        options: message.options,
        consentGranted: !!message.consentGranted,
        origin: window.location.origin,
        topOrigin: getTopOriginSafe(),
        frameDepth: getFrameDepth()
      };

      const response = await chrome.runtime.sendMessage(payload);
      postSuccess({
        source: FORWARDER_SOURCE,
        requestId: message.requestId,
        ok: !!response?.ok,
        result: response?.result,
        error: response?.error || null
      });
    } catch (error) {
      postFailure({
        requestId: message.requestId,
        error: {
          name: 'UnknownError',
          message: error?.message || 'Passkey request failed'
        }
      });
    }
  }

  /** @param {MessageEvent} event */
  function handleWindowMessageEvent(event) {
    const { source, data } = event;
    if (!EventSecurity.isTrusted(event) || source !== window || !data || data.source !== BRIDGE_SOURCE) {
      return;
    }

    // Backward compatible mapping for older bridge payloads.
    if (!data.command && data.kind === 'PASSKEY_CREATE_REQUEST') {
      data.command = PasskeyCommands.CreateRequest;
    }
    if (!data.command && data.kind === 'PASSKEY_GET_REQUEST') {
      data.command = PasskeyCommands.GetRequest;
    }

    if (!data.command) return;
    void handlePasskeyRequest(data);
  }

  /** @param {(port: chrome.runtime.Port) => void} callback */
  function setupExtensionDisconnectAction(callback) {
    const port = chrome.runtime.connect({ name: 'passkey-forwarder-port' });
    const onDisconnect = (disconnectedPort) => {
      callback(disconnectedPort);
      port.onDisconnect.removeListener(onDisconnect);
    };
    port.onDisconnect.addListener(onDisconnect);
  }

  window.addEventListener('message', handleWindowMessageEvent, false);
  setupExtensionDisconnectAction(() => {
    window.removeEventListener('message', handleWindowMessageEvent, false);
  });
})();
