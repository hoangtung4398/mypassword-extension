# Passkey Authenticator Module Design (Bitwarden-like Direction)

## 1) Goal

Build a full WebAuthn authenticator capability inside the extension so websites can call passkey create/get and receive valid attestation/assertion responses from credentials managed by MyPassword.

This is different from the current metadata helper flow. The new module must:

- Intercept and handle WebAuthn requests reliably.
- Generate and store passkey private keys securely.
- Produce valid WebAuthn responses for relying parties (RPs).
- Enforce user verification and consent before signing.

## 2) Current State vs Target

### Current state

- Detect passkey intent (hook + heuristic fallback).
- Open Add Item popup and save metadata record.
- No real credential keypair generation.
- No cryptographic response to RP challenge.

### Target state

- Native-like provider behavior for passkeys inside browser extension.
- Passkey credentials created, encrypted, synced, and used for sign-in.
- Per-request user consent and local unlock policy.

## 3) Architecture Overview

Create a dedicated `passkey/` module with 5 layers:

1. Capture Layer
- Intercepts `navigator.credentials.create/get` in MAIN world.
- Routes requests to isolated/content layer via postMessage.

2. Broker Layer
- Content forwarder + background dispatcher.
- Validates origin/frame/tab context.
- De-duplicates requests and controls lifecycle.

3. Authenticator Core
- Implements WebAuthn ceremony logic.
- Creates credential source, signs assertions.
- Maintains sign counter and AAGUID configuration.

4. Secure Storage Layer
- Encrypts credential sources using vault key.
- Stores local state + remote sync records.

5. UX & Policy Layer
- User approval prompts for create/get.
- Unlock checks (master unlock/biometric gate if available).
- RP/account credential chooser.

## 4) Proposed Folder Structure

```text
passkey/
  constants.js
  errors.js
  base64url.js
  cbor.js
  cose.js
  client-data.js
  authenticator-data.js
  attestation-none.js
  credential-store.js
  rp-policy.js
  user-verification.js
  create-flow.js
  get-flow.js
  broker.js
  debug.js
```

And integration points:

- `content/webauthn-bridge.js`: call into broker API.
- `content/passkey-forwarder.js`: transport only.
- `background/service-worker.js`: route messages to passkey broker.
- `lib/storage.js`: add passkey credential metadata keys.
- `lib/vault.js` or new passkey API client: sync metadata server-side.

## 5) Data Model

Store two logical objects.

### 5.1 Credential source (secret)

Encrypted at rest with vault key, never sent in plaintext.

```json
{
  "id": "uuid",
  "credentialId": "base64url",
  "rpId": "google.com",
  "rpName": "Google",
  "userHandle": "base64url-random-32b",
  "userName": "alice@example.com",
  "userDisplayName": "Alice",
  "privateKeyJwk": {"kty":"EC","crv":"P-256","x":"...","y":"...","d":"..."},
  "publicKeyCose": "base64url",
  "alg": -7,
  "signCount": 0,
  "discoverable": true,
  "createdAt": "ISO",
  "updatedAt": "ISO",
  "aaguid": "00000000-0000-0000-0000-000000000000"
}
```

### 5.2 Credential index (non-secret, query-optimized)

Used for fast lookup by RP and credentialId.

```json
{
  "credentialId": "base64url",
  "rpId": "google.com",
  "userName": "alice@example.com",
  "lastUsedAt": "ISO|null",
  "isSynced": true
}
```

## 6) Crypto Choices (MVP)

- Algorithm: ES256 (`alg: -7`) only for MVP.
- Key generation: `crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, ...)`.
- Signature: ECDSA over SHA-256.
- Credential ID: random 32 bytes (base64url).
- AAGUID: static zero AAGUID for MVP.
- Attestation format: `none` for MVP.

## 7) Ceremony Flows

## 7.1 Registration (`create`)

1. Capture request from page (`publicKey` options).
2. Validate:
- Secure context.
- RP ID is registrable suffix of origin host.
- Supported alg includes ES256.

3. Prompt user approval UI:
- Show RP name, user name, account hint.
- Ask `Create passkey for this site?`.

4. Generate credential source:
- Create P-256 keypair.
- Build credentialId + userHandle.
- Persist encrypted source.

5. Build WebAuthn response:
- `clientDataJSON` from challenge/type/origin.
- `authenticatorData` with flags UP/UV and rpIdHash.
- `attestationObject` with format `none`.

6. Return `PublicKeyCredential`-compatible object to page.

## 7.2 Authentication (`get`)

1. Capture request from page.
2. Resolve candidate credentials by:
- `allowCredentials` if provided.
- Else discoverable credentials for RP.

3. Prompt credential picker + approval.
4. Build assertion:
- Increment signCount atomically.
- Produce `authenticatorData` + `clientDataJSON`.
- Sign `authenticatorData || SHA256(clientDataJSON)`.

5. Return assertion object with id/rawId/response fields.

## 8) WebAuthn Object Encoding Details

Must match browser expectations exactly.

- `rawId`: ArrayBuffer (credentialId bytes)
- `response.clientDataJSON`: ArrayBuffer
- Registration:
  - `response.attestationObject`: ArrayBuffer (CBOR map)
- Authentication:
  - `response.authenticatorData`: ArrayBuffer
  - `response.signature`: ArrayBuffer
  - `response.userHandle`: ArrayBuffer|null

Bridge layer should convert ArrayBuffer <-> serializable form only at boundary.

## 9) User Verification & Security Policy

MVP policy:

- Require explicit click approval per create/get.
- Session unlock TTL (for example 5 minutes) to reduce repeated prompts.

Target policy:

- Local unlock gate (master password or platform biometric where possible).
- High-risk RP policy (always prompt).
- Optional silent autofill only for low-risk and unlocked session.

## 10) Anti-Abuse and Isolation

- Origin-RP validation:
  - `rpId` must domain-match page origin.
- Frame policy:
  - deny cross-origin iframes unless top-level origin match and explicit user approval.
- Replay prevention:
  - signCount monotonic per credential.
- Request binding:
  - include `tabId`, `frameId`, `origin`, `requestId` in broker context.

## 11) Sync Strategy

Phase 1 local-first:

- Store encrypted credential source in local storage (extension).
- Optional remote backup via existing vault item endpoint as encrypted blob.

Phase 2 multi-device:

- Sync encrypted passkey sources to backend.
- Conflict resolution by credentialId.
- Merge signCount with max(local, remote) + update on use.

## 12) UX Specifications

Create dialog fields:

- RP name and domain.
- Account user name/display name.
- Device/account label for saved credential.

Get dialog fields:

- List matching credentials (avatar/name/rp).
- Last used timestamp.
- Confirm sign-in action.

Error mapping:

- User cancelled -> `NotAllowedError`.
- No credential -> `NotAllowedError` with neutral message.
- Policy blocked -> `SecurityError`.

## 13) MVP Milestones

### Milestone A: Core plumbing

- Message contracts and broker.
- Request lifecycle map and cancellation.

### Milestone B: Registration only

- ES256 keygen, attestation none.
- Save encrypted credential source.

### Milestone C: Authentication only

- Credential lookup.
- Assertion signing + signCount update.

### Milestone D: UX and hardening

- Approval dialogs, timeout, cancellation.
- RP/origin validation and iframe rules.

### Milestone E: Compatibility pass

- Test matrix: Google, GitHub, Microsoft, passkeys.io.
- Fix encoding edge cases.

## 14) Testing Strategy

Unit tests:

- base64url conversion.
- CBOR encode/decode structures.
- authenticatorData flags and rpIdHash.
- COSE key encoding and ECDSA signature verification.

Integration tests:

- passkeys.io registration/login success.
- credential discoverable login without allowCredentials.
- allowCredentials scoped login.

Regression tests:

- signCount increments.
- cross-origin rpId rejection.
- cancellation and timeout semantics.

## 15) Known Constraints

- Some browser internals are not fully replaceable from extension context.
- Behavior can differ by Chromium version and platform policy.
- Full parity with Bitwarden requires substantial compatibility engineering.

## 16) Next Implementation Task (Concrete)

Implement Milestone A + B in code:

1. Add `passkey/base64url.js`, `passkey/client-data.js`, `passkey/authenticator-data.js`, `passkey/credential-store.js`, `passkey/create-flow.js`.
2. Add message type `PASSKEY_CREATE_REQUEST` and `PASSKEY_GET_REQUEST` in service worker broker.
3. In bridge, replace metadata-only path with request/response promise bridge.
4. Support registration at passkeys.io as first target.

This keeps scope realistic while moving from helper mode to real authenticator mode.
