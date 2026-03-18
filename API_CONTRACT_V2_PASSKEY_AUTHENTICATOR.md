# MyPassword Passkey Authenticator API Contract v2

Status: Draft
Version: v2
Base URL (dev): https://localhost:7259
Auth: Bearer JWT unless noted

## 1. Scope

This contract adds APIs for extension-managed passkey authenticator sync.

Out of scope:
- Existing MyPassword account login passkey endpoints in v1 (`/api/v1/passkey/register/*`, `/api/v1/passkey/auth/*`) remain valid and unchanged.

In scope:
- Encrypted credential source storage and sync.
- Device key lifecycle.
- Sign counter updates with conflict handling.
- Authenticator config bootstrap.

## 2. Versioning

Option A (recommended):
- New path prefix: `/api/v2/passkey-authenticator/*`

Option B:
- Keep `/api/v1` and add new resource namespaces. Not recommended for long-term clarity.

This document uses Option A.

## 3. Security Model

Server stores encrypted blobs only. Server must never require plaintext credential private keys.

Client-side responsibilities:
- Encrypt credential source before upload.
- Maintain wrapping keys per device.
- Send metadata needed for search/index (`rpId`, `credentialId`, `userName`, etc.).

Server responsibilities:
- Opaque blob storage.
- Ownership and device authorization checks.
- Atomic signCount and revision updates.
- Audit events.

## 4. Shared Types

## 4.1 Error response

```json
{
  "error": "ValidationError",
  "code": "INVALID_RP_ID",
  "message": "rpId is invalid for this user",
  "details": {}
}
```

## 4.2 Credential metadata

```json
{
  "credentialId": "base64url",
  "rpId": "google.com",
  "rpIdHash": "base64url",
  "userHandle": "base64url",
  "userName": "alice@example.com",
  "userDisplayName": "Alice",
  "alg": -7,
  "aaguid": "00000000-0000-0000-0000-000000000000",
  "discoverable": true,
  "signCount": 12,
  "lastUsedAt": "2026-03-18T09:30:00Z",
  "createdAt": "2026-03-12T01:00:00Z",
  "updatedAt": "2026-03-18T09:30:00Z",
  "revision": 7,
  "deviceId": "dev_123"
}
```

## 4.3 Encrypted source payload

```json
{
  "cipher": "AES-GCM-256",
  "kdf": "PBKDF2-SHA256",
  "kdfParams": {
    "iterations": 100000,
    "salt": "base64url"
  },
  "nonce": "base64url",
  "ciphertext": "base64url",
  "tag": "base64url",
  "sourceVersion": 1
}
```

## 5. Config Bootstrap

### GET /api/v2/passkey-authenticator/config

Returns server policy and compatibility options.

Response 200:

```json
{
  "algorithms": [-7],
  "attestationFormats": ["none"],
  "defaultAaguid": "00000000-0000-0000-0000-000000000000",
  "defaultUserVerification": "preferred",
  "maxCredentialsPerRp": 100,
  "sync": {
    "enabled": true,
    "maxBlobBytes": 262144,
    "cursorTtlSeconds": 604800
  },
  "conflictPolicy": {
    "signCount": "max-plus-one"
  },
  "features": {
    "multiDevice": true,
    "deviceKeyRotation": true
  }
}
```

Errors:
- 401 UNAUTHORIZED

## 6. Device Registration and Key Management

## 6.1 Register device

### POST /api/v2/passkey-authenticator/devices

Request:

```json
{
  "deviceName": "Windows Chrome",
  "platform": "windows",
  "publicKeyJwk": {
    "kty": "EC",
    "crv": "P-256",
    "x": "...",
    "y": "..."
  },
  "keyVersion": 1,
  "capabilities": {
    "biometricUnlock": false,
    "hardwareBackedKey": false
  }
}
```

Response 201:

```json
{
  "deviceId": "dev_123",
  "deviceName": "Windows Chrome",
  "publicKeyJwk": {
    "kty": "EC",
    "crv": "P-256",
    "x": "...",
    "y": "..."
  },
  "keyVersion": 1,
  "createdAt": "2026-03-18T10:00:00Z"
}
```

Errors:
- 400 INVALID_PUBLIC_KEY
- 401 UNAUTHORIZED
- 409 DEVICE_ALREADY_REGISTERED

## 6.2 List devices

### GET /api/v2/passkey-authenticator/devices

Response 200:

```json
[
  {
    "deviceId": "dev_123",
    "deviceName": "Windows Chrome",
    "platform": "windows",
    "keyVersion": 1,
    "createdAt": "2026-03-18T10:00:00Z",
    "lastSeenAt": "2026-03-18T11:00:00Z"
  }
]
```

## 6.3 Rotate device key

### POST /api/v2/passkey-authenticator/devices/{deviceId}/rotate-key

Request:

```json
{
  "newPublicKeyJwk": {
    "kty": "EC",
    "crv": "P-256",
    "x": "...",
    "y": "..."
  },
  "newKeyVersion": 2
}
```

Response 200:

```json
{
  "deviceId": "dev_123",
  "keyVersion": 2,
  "rotatedAt": "2026-03-18T12:00:00Z"
}
```

Errors:
- 404 DEVICE_NOT_FOUND
- 409 KEY_VERSION_CONFLICT

## 6.4 Revoke device

### DELETE /api/v2/passkey-authenticator/devices/{deviceId}

Response 204

Errors:
- 404 DEVICE_NOT_FOUND

## 7. Credential CRUD

## 7.1 Create credential record

### POST /api/v2/passkey-authenticator/credentials

Request:

```json
{
  "credential": {
    "credentialId": "base64url",
    "rpId": "google.com",
    "rpIdHash": "base64url",
    "userHandle": "base64url",
    "userName": "alice@example.com",
    "userDisplayName": "Alice",
    "alg": -7,
    "aaguid": "00000000-0000-0000-0000-000000000000",
    "discoverable": true,
    "signCount": 0,
    "deviceId": "dev_123"
  },
  "encryptedSource": {
    "cipher": "AES-GCM-256",
    "kdf": "PBKDF2-SHA256",
    "kdfParams": {
      "iterations": 100000,
      "salt": "base64url"
    },
    "nonce": "base64url",
    "ciphertext": "base64url",
    "tag": "base64url",
    "sourceVersion": 1
  }
}
```

Response 201:

```json
{
  "credential": {
    "credentialId": "base64url",
    "rpId": "google.com",
    "rpIdHash": "base64url",
    "userHandle": "base64url",
    "userName": "alice@example.com",
    "userDisplayName": "Alice",
    "alg": -7,
    "aaguid": "00000000-0000-0000-0000-000000000000",
    "discoverable": true,
    "signCount": 0,
    "lastUsedAt": null,
    "createdAt": "2026-03-18T12:30:00Z",
    "updatedAt": "2026-03-18T12:30:00Z",
    "revision": 1,
    "deviceId": "dev_123"
  }
}
```

Errors:
- 400 INVALID_CREDENTIAL
- 401 UNAUTHORIZED
- 409 CREDENTIAL_ALREADY_EXISTS

## 7.2 List credentials

### GET /api/v2/passkey-authenticator/credentials?rpId=google.com&limit=50&cursor=...

Query parameters:
- `rpId` optional
- `limit` optional, default 50, max 200
- `cursor` optional for pagination

Response 200:

```json
{
  "items": [
    {
      "credentialId": "base64url",
      "rpId": "google.com",
      "rpIdHash": "base64url",
      "userHandle": "base64url",
      "userName": "alice@example.com",
      "userDisplayName": "Alice",
      "alg": -7,
      "aaguid": "00000000-0000-0000-0000-000000000000",
      "discoverable": true,
      "signCount": 12,
      "lastUsedAt": "2026-03-18T09:30:00Z",
      "createdAt": "2026-03-12T01:00:00Z",
      "updatedAt": "2026-03-18T09:30:00Z",
      "revision": 7,
      "deviceId": "dev_123"
    }
  ],
  "nextCursor": "opaque-cursor-or-null"
}
```

## 7.3 Get credential (metadata + encrypted source)

### GET /api/v2/passkey-authenticator/credentials/{credentialId}

Response 200:

```json
{
  "credential": {
    "credentialId": "base64url",
    "rpId": "google.com",
    "rpIdHash": "base64url",
    "userHandle": "base64url",
    "userName": "alice@example.com",
    "userDisplayName": "Alice",
    "alg": -7,
    "aaguid": "00000000-0000-0000-0000-000000000000",
    "discoverable": true,
    "signCount": 12,
    "lastUsedAt": "2026-03-18T09:30:00Z",
    "createdAt": "2026-03-12T01:00:00Z",
    "updatedAt": "2026-03-18T09:30:00Z",
    "revision": 7,
    "deviceId": "dev_123"
  },
  "encryptedSource": {
    "cipher": "AES-GCM-256",
    "kdf": "PBKDF2-SHA256",
    "kdfParams": {
      "iterations": 100000,
      "salt": "base64url"
    },
    "nonce": "base64url",
    "ciphertext": "base64url",
    "tag": "base64url",
    "sourceVersion": 1
  }
}
```

Errors:
- 404 CREDENTIAL_NOT_FOUND

## 7.4 Update encrypted source or metadata

### PUT /api/v2/passkey-authenticator/credentials/{credentialId}

Request:

```json
{
  "expectedRevision": 7,
  "credential": {
    "userName": "alice@example.com",
    "userDisplayName": "Alice",
    "discoverable": true,
    "signCount": 13,
    "lastUsedAt": "2026-03-18T12:40:00Z"
  },
  "encryptedSource": {
    "cipher": "AES-GCM-256",
    "kdf": "PBKDF2-SHA256",
    "kdfParams": {
      "iterations": 100000,
      "salt": "base64url"
    },
    "nonce": "base64url",
    "ciphertext": "base64url",
    "tag": "base64url",
    "sourceVersion": 1
  }
}
```

Response 200:

```json
{
  "credentialId": "base64url",
  "revision": 8,
  "updatedAt": "2026-03-18T12:40:01Z"
}
```

Errors:
- 404 CREDENTIAL_NOT_FOUND
- 409 VERSION_MISMATCH

## 7.5 Delete credential

### DELETE /api/v2/passkey-authenticator/credentials/{credentialId}?expectedRevision=8

Response 204

Errors:
- 404 CREDENTIAL_NOT_FOUND
- 409 VERSION_MISMATCH

## 8. Counter Update (Atomic)

### POST /api/v2/passkey-authenticator/credentials/{credentialId}/counter

Request:

```json
{
  "expectedRevision": 8,
  "expectedSignCount": 13,
  "nextSignCount": 14,
  "usedAt": "2026-03-18T12:45:00Z"
}
```

Response 200:

```json
{
  "credentialId": "base64url",
  "signCount": 14,
  "revision": 9,
  "updatedAt": "2026-03-18T12:45:00Z"
}
```

Errors:
- 404 CREDENTIAL_NOT_FOUND
- 409 COUNTER_CONFLICT
- 409 VERSION_MISMATCH

Server behavior recommendation:
- Reject `nextSignCount <= currentSignCount`.
- For conflict, return latest `signCount` and `revision` in `details`.

## 9. Delta Sync

### GET /api/v2/passkey-authenticator/sync?cursor=opaque&limit=200

Returns upserts and deletions since cursor.

Response 200:

```json
{
  "upserts": [
    {
      "credential": {
        "credentialId": "base64url",
        "rpId": "google.com",
        "rpIdHash": "base64url",
        "userHandle": "base64url",
        "userName": "alice@example.com",
        "userDisplayName": "Alice",
        "alg": -7,
        "aaguid": "00000000-0000-0000-0000-000000000000",
        "discoverable": true,
        "signCount": 14,
        "lastUsedAt": "2026-03-18T12:45:00Z",
        "createdAt": "2026-03-12T01:00:00Z",
        "updatedAt": "2026-03-18T12:45:00Z",
        "revision": 9,
        "deviceId": "dev_123"
      },
      "encryptedSource": {
        "cipher": "AES-GCM-256",
        "kdf": "PBKDF2-SHA256",
        "kdfParams": {
          "iterations": 100000,
          "salt": "base64url"
        },
        "nonce": "base64url",
        "ciphertext": "base64url",
        "tag": "base64url",
        "sourceVersion": 1
      }
    }
  ],
  "deletes": [
    {
      "credentialId": "deleted_credential_id",
      "deletedAt": "2026-03-18T12:00:00Z"
    }
  ],
  "nextCursor": "opaque-cursor"
}
```

Errors:
- 400 INVALID_CURSOR

## 10. Conflict Resolution

### POST /api/v2/passkey-authenticator/credentials/{credentialId}/resolve-conflict

Request:

```json
{
  "clientRevision": 8,
  "serverRevision": 10,
  "strategy": "server-wins",
  "clientEncryptedSource": {
    "cipher": "AES-GCM-256",
    "kdf": "PBKDF2-SHA256",
    "kdfParams": {
      "iterations": 100000,
      "salt": "base64url"
    },
    "nonce": "base64url",
    "ciphertext": "base64url",
    "tag": "base64url",
    "sourceVersion": 1
  }
}
```

Allowed strategy values:
- `server-wins`
- `client-wins`
- `max-signcount-merge`

Response 200:

```json
{
  "credentialId": "base64url",
  "revision": 11,
  "signCount": 15,
  "updatedAt": "2026-03-18T13:00:00Z"
}
```

Errors:
- 404 CREDENTIAL_NOT_FOUND
- 409 CONFLICT_NOT_RESOLVABLE

## 11. Rate Limits

Recommended limits:
- Config and reads: 300 req/min per user
- Writes (create/update/delete/counter): 120 req/min per user
- Sync endpoint: 60 req/min per user and device

429 response should include:
- `Retry-After` header

## 12. Audit Events (Server Internal)

Recommended audit event names:
- `passkey_device_registered`
- `passkey_device_revoked`
- `passkey_credential_created`
- `passkey_credential_updated`
- `passkey_credential_deleted`
- `passkey_signcount_updated`
- `passkey_conflict_resolved`

## 13. Backward Compatibility

- Keep existing v1 passkey auth endpoints unchanged for MyPassword account login.
- Introduce v2 endpoints only for extension-managed authenticator sync.
- Client capability flag should decide whether extension uses v1-only or v2 sync features.

## 14. Open Questions for Backend Team

1. Should credential blobs be sharded by `userId + rpId` for query performance?
2. Is hard delete allowed, or must delete always be tombstone for sync correctness?
3. Max blob size and maximum credentials per account?
4. Is device attestation required for device registration?
5. Multi-region consistency target for signCount conflict windows?

## 15. Minimal Implementation Checklist

Phase 1 (must-have):
- Config endpoint.
- Device register/list/revoke.
- Credential create/get/list/update/delete with revision.
- Atomic counter update.
- Sync endpoint with cursor.

Phase 2 (recommended):
- Conflict resolution endpoint.
- Device key rotation endpoint.
- Extended audit + anomaly alerts.
