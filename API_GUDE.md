# MyPassword API — Chrome Extension Developer Guide

> **Base URL (dev):** `https://localhost:7259`
> **API Version:** `v1`
> **Auth scheme:** JWT Bearer (`Authorization: Bearer <accessToken>`)

---

## Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Xác thực & Token](#2-xác-thực--token)
3. [Error format](#3-error-format)
4. [Rate Limit](#4-rate-limit)
5. [Auth endpoints](#5-auth-endpoints)
6. [Vault endpoints](#6-vault-endpoints)
7. [TOTP Authenticator endpoints](#7-totp-authenticator-endpoints)
8. [Passkey (WebAuthn) endpoints](#8-passkey-webauthn-endpoints)
9. [TypeScript types](#9-typescript-types)
10. [Passkey flow (step-by-step)](#10-passkey-flow-step-by-step)
11. [Lưu ý cho Chrome Extension](#11-lưu-ý-cho-chrome-extension)

---

## 1. Tổng quan

| Feature | Mô tả |
|---|---|
| Đăng ký / đăng nhập | Email+Password, Google OAuth, Passkey |
| Vault | CRUD cho Login, SecureNote, CreditCard, TOTP |
| TOTP | Lưu secret từ QR code, xuất mã OTP theo thời gian |
| Passkey | WebAuthn usernameless (Face ID / fingerprint / hardware key) |

**Ghi chú dữ liệu nhạy cảm:** `EncryptedData` trong vault item là chuỗi do **client tự mã hoá**
trước khi gửi lên. Backend lưu nguyên văn — không đọc được nội dung. Extension tự giải mã khi cần hiển thị.

---

## 2. Xác thực & Token

### Access Token
- JWT, hết hạn sau **15 phút**.
- Gửi trong header mọi request cần auth:
  ```
  Authorization: Bearer <accessToken>
  ```

### Refresh Token
- Opaque string, hết hạn sau **30 ngày**.
- Dùng để lấy access token mới (xem [`POST /auth/refresh`](#post-apiv1authrefresh)).
- Lưu an toàn trong extension (ví dụ `chrome.storage.local`).

### Luồng token cơ bản
```
1. Login → nhận { accessToken, refreshToken }
2. Mỗi API call → gửi accessToken
3. Khi accessToken hết hạn (401) → gọi /auth/refresh với refreshToken → nhận token mới
4. Logout → gọi /auth/logout để revoke refreshToken
```

---

## 3. Error format

Mọi lỗi đều trả về JSON:

```json
{
  "error": "ValidationError",
  "message": "Email không hợp lệ",
  "details": { ... }
}
```

| HTTP Status | Ý nghĩa |
|---|---|
| `400` | Request không hợp lệ (validation) |
| `401` | Chưa đăng nhập hoặc token hết hạn |
| `404` | Item không tìm thấy |
| `429` | Rate limit |
| `500` | Server error |

---

## 4. Rate Limit

| Group | Giới hạn |
|---|---|
| Auth (`/api/v1/auth/*`) | 10 request/phút mỗi IP |
| Vault + Passkey | 100 request/phút mỗi IP |

Khi vượt giới hạn, server trả `429 Too Many Requests`.

---

## 5. Auth endpoints

### `POST /api/v1/auth/register`

Đăng ký tài khoản mới bằng Email + Password.

**Request body:**
```json
{
  "email": "user@example.com",
  "displayName": "Nguyễn Văn A",
  "password": "Abc12345"
}
```

**Validation:**
- `email`: bắt buộc, email hợp lệ, tối đa 256 ký tự.
- `displayName`: bắt buộc, tối đa 200 ký tự.
- `password`: 8–128 ký tự, phải có ít nhất 1 chữ hoa, 1 chữ thường, 1 chữ số.

**Response `200`:**
```json
{
  "accessToken": "eyJhbGci...",
  "refreshToken": "base64string...",
  "user": {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "email": "user@example.com",
    "displayName": "Nguyễn Văn A"
  }
}
```

---

### `POST /api/v1/auth/login`

Đăng nhập bằng Email + Password.

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "Abc12345"
}
```

**Response `200`:** _(giống register)_

**Lỗi thường gặp:**
- `401` — email hoặc mật khẩu không đúng.
- `401` — tài khoản dùng Google, không có mật khẩu.

---

### `POST /api/v1/auth/google`

Đăng nhập / đăng ký bằng **Google ID Token** (lấy từ Google OAuth flow phía client).

**Request body:**
```json
{
  "idToken": "eyJhbGciOiJSUzI1NiIsInR5..."
}
```

**Response `200`:** _(giống register)_

> Nếu email chưa có trong hệ thống → tạo tài khoản mới tự động.

---

### `POST /api/v1/auth/refresh`

Làm mới access token bằng refresh token còn hạn.

**Request body:**
```json
{
  "refreshToken": "base64string..."
}
```

**Response `200`:** _(giống register — bao gồm refreshToken mới)_

> Mỗi lần refresh, **refresh token cũ bị thu hồi** và cấp token mới (rotation).

---

### `POST /api/v1/auth/logout`

Đăng xuất — thu hồi refresh token. _(Requires JWT)_

**Request body:**
```json
{
  "refreshToken": "base64string..."
}
```

**Response `204 No Content`**

---

## 6. Vault endpoints

> Tất cả endpoint dưới đây **yêu cầu JWT**.

### VaultItemType

| Giá trị | Tên | Mô tả |
|---|---|---|
| `1` | `Login` | Tài khoản website (username, password, URL) |
| `2` | `SecureNote` | Ghi chú bảo mật |
| `3` | `CreditCard` | Thẻ tín dụng |
| `4` | `TotpAccount` | Tài khoản TOTP — **dùng API riêng** |

---

### `GET /api/v1/vault/items`

Lấy toàn bộ vault items của user hiện tại.

**Response `200`:**
```json
[
  {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "name": "GitHub",
    "url": "https://github.com",
    "encryptedData": "<client-encrypted-string>",
    "itemType": 1,
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z"
  }
]
```

---

### `GET /api/v1/vault/items/{id}`

Lấy một vault item theo ID.

**Response `200`:** _(object đơn, cấu trúc giống mảng trên)_
**Response `404`:** Item không tồn tại hoặc không thuộc về user.

---

### `POST /api/v1/vault/items`

Tạo vault item mới.

**Request body:**
```json
{
  "name": "GitHub",
  "url": "https://github.com",
  "encryptedData": "<client-encrypted-string>",
  "itemType": 1
}
```

**Validation:**
- `name`: bắt buộc, tối đa 500 ký tự.
- `encryptedData`: bắt buộc.
- `url`: tuỳ chọn, tối đa 2048 ký tự.
- `itemType`: 1, 2, hoặc 3 (không dùng 4 — dùng endpoint TOTP riêng).

**Response `201 Created`:** _(object vault item vừa tạo)_

---

### `PUT /api/v1/vault/items/{id}`

Cập nhật vault item.

**Request body:** _(giống POST)_

**Response `200`:** _(object vault item đã cập nhật)_
**Response `404`:** Không tìm thấy.

---

### `DELETE /api/v1/vault/items/{id}`

Xoá vault item (soft delete — dữ liệu không mất hẳn trong DB).

**Response `204 No Content`**
**Response `404`:** Không tìm thấy.

---

## 7. TOTP Authenticator endpoints

> Tất cả endpoint dưới đây **yêu cầu JWT**.

### `POST /api/v1/vault/totp`

Lưu tài khoản TOTP mới. Cung cấp **một trong hai cách**:

**Cách 1 — từ QR code** (extension quét được URI `otpauth://`):
```json
{
  "otpAuthUri": "otpauth://totp/GitHub:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&period=30&digits=6",
  "displayName": "GitHub (user@example.com)"
}
```

**Cách 2 — nhập tay:**
```json
{
  "issuer": "GitHub",
  "accountName": "user@example.com",
  "secret": "JBSWY3DPEHPK3PXP",
  "period": 30,
  "digits": 6,
  "displayName": "GitHub (user@example.com)"
}
```

**Validation:**
- Phải có `otpAuthUri` **hoặc** (`accountName` + `secret`).
- `period`: 15–60 (mặc định 30).
- `digits`: 6–8 (mặc định 6).

**Response `201 Created`:** _(VaultItemDto)_

---

### `GET /api/v1/vault/totp`

Lấy danh sách TOTP accounts — **chỉ metadata, không có secret**.

**Response `200`:**
```json
[
  {
    "id": "3fa85f64-...",
    "issuer": "GitHub",
    "accountName": "user@example.com",
    "period": 30,
    "digits": 6
  }
]
```

---

### `GET /api/v1/vault/totp/{id}`

Lấy thông tin đầy đủ của một TOTP account, **bao gồm secret và mã hiện tại**.

**Response `200`:**
```json
{
  "id": "3fa85f64-...",
  "issuer": "GitHub",
  "accountName": "user@example.com",
  "secret": "JBSWY3DPEHPK3PXP",
  "period": 30,
  "digits": 6,
  "currentCode": "123456",
  "secondsRemaining": 18
}
```

> **Ghi chú extension:** Dùng `secret` để tự tính mã (`otplib` hoặc tương đương) thay vì gọi API mỗi 30 giây. Dùng `secondsRemaining` để sync countdown.

---

## 8. Passkey (WebAuthn) endpoints

Passkey cho phép đăng nhập **không cần mật khẩu** (Face ID, vân tay, hardware key). Luồng gồm **2 bước** cho cả đăng ký lẫn đăng nhập.

---

### Đăng ký passkey mới

#### `POST /api/v1/passkey/register/begin` _(Requires JWT)_

Bước 1: Yêu cầu challenge từ server.

**Request body:**
```json
{
  "deviceName": "MacBook Pro"
}
```

**Response `200`:**
```json
{
  "sessionId": "abc123...",
  "optionsJson": "{\"rp\":{...},\"user\":{...},\"challenge\":\"...\", ...}"
}
```

> Lưu `sessionId` để dùng trong bước 2. `optionsJson` là JSON string truyền thẳng vào `navigator.credentials.create()`.

---

#### `POST /api/v1/passkey/register/complete` _(Requires JWT)_

Bước 2: Gửi kết quả từ thiết bị để server xác thực và lưu.

**Request body:**
```json
{
  "sessionId": "abc123...",
  "attestationJson": "{\"id\":\"...\",\"rawId\":\"...\",\"response\":{...},\"type\":\"public-key\"}",
  "deviceName": "MacBook Pro"
}
```

> `attestationJson` = `JSON.stringify(credential)` sau khi gọi `navigator.credentials.create()`.

**Response `200`:**
```json
{
  "id": "3fa85f64-...",
  "deviceName": "MacBook Pro",
  "lastUsedAt": null,
  "createdAt": "2026-01-01T00:00:00Z"
}
```

---

### Đăng nhập bằng passkey (usernameless)

#### `POST /api/v1/passkey/auth/begin` _(Anonymous)_

Bước 1: Lấy challenge — không cần gửi gì.

**Request body:** _(empty `{}`)_

**Response `200`:**
```json
{
  "sessionId": "xyz789...",
  "optionsJson": "{\"challenge\":\"...\",\"allowCredentials\":[],\"userVerification\":\"required\", ...}"
}
```

> `allowCredentials: []` = thiết bị sẽ **tự hiện danh sách** passkey đã lưu để user chọn.

---

#### `POST /api/v1/passkey/auth/complete` _(Anonymous)_

Bước 2: Gửi kết quả xác thực từ thiết bị.

**Request body:**
```json
{
  "sessionId": "xyz789...",
  "assertionJson": "{\"id\":\"...\",\"rawId\":\"...\",\"response\":{...},\"type\":\"public-key\"}"
}
```

> `assertionJson` = `JSON.stringify(assertion)` sau khi gọi `navigator.credentials.get()`.

**Response `200`:** _(giống login — trả `accessToken`, `refreshToken`, `user`)_

---

### Quản lý passkeys

#### `GET /api/v1/passkey` _(Requires JWT)_

Lấy danh sách passkeys của user.

**Response `200`:**
```json
[
  {
    "id": "3fa85f64-...",
    "deviceName": "MacBook Pro",
    "lastUsedAt": "2026-03-01T08:00:00Z",
    "createdAt": "2026-01-01T00:00:00Z"
  }
]
```

---

#### `DELETE /api/v1/passkey/{id}` _(Requires JWT)_

Xoá passkey theo ID.

**Response `204 No Content`**
**Response `404`:** Không tìm thấy hoặc không thuộc về user.

---

## 9. TypeScript types

```typescript
// ── Auth ─────────────────────────────────────────────
interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: UserDto;
}

interface UserDto {
  id: string;           // UUID
  email: string;
  displayName: string;
}

// ── Vault ─────────────────────────────────────────────
type VaultItemType = 1 | 2 | 3 | 4;
// 1 = Login, 2 = SecureNote, 3 = CreditCard, 4 = TotpAccount

interface VaultItemDto {
  id: string;
  name: string;
  url: string | null;
  encryptedData: string;   // client-encrypted blob
  itemType: VaultItemType;
  createdAt: string;       // ISO 8601
  updatedAt: string;
}

interface CreateVaultItemRequest {
  name: string;
  url?: string;
  encryptedData: string;
  itemType: VaultItemType;  // 1 | 2 | 3
}

// ── TOTP ──────────────────────────────────────────────
interface SaveTotpRequest {
  // Cách 1: từ QR code
  otpAuthUri?: string;
  // Cách 2: nhập tay
  issuer?: string;
  accountName?: string;
  secret?: string;
  period?: number;   // default 30
  digits?: number;   // default 6
  // Tuỳ chọn
  displayName?: string;
}

interface TotpAccountSummaryDto {
  id: string;
  issuer: string;
  accountName: string;
  period: number;
  digits: number;
}

interface TotpAccountInfoDto extends TotpAccountSummaryDto {
  secret: string;
  currentCode: string;
  secondsRemaining: number;
}

// ── Passkey ───────────────────────────────────────────
interface BeginRegistrationResponse {
  sessionId: string;
  optionsJson: string;    // deserialize to PublicKeyCredentialCreationOptions
}

interface CompleteRegistrationRequest {
  sessionId: string;
  attestationJson: string;
  deviceName: string;
}

interface PasskeyCredentialDto {
  id: string;
  deviceName: string;
  lastUsedAt: string | null;
  createdAt: string;
}

interface BeginAuthResponse {
  sessionId: string;
  optionsJson: string;    // deserialize to PublicKeyCredentialRequestOptions
}

interface CompleteAuthRequest {
  sessionId: string;
  assertionJson: string;
}
```

---

## 10. Passkey flow (step-by-step)

### Đăng ký

```typescript
// 1. Gọi begin
const { sessionId, optionsJson } = await api.post('/passkey/register/begin', {
  deviceName: 'MacBook Pro'
});

// 2. Parse options và gọi WebAuthn API
const options: PublicKeyCredentialCreationOptions =
  JSON.parse(optionsJson);

// Cần convert challenge + user.id từ base64url → ArrayBuffer
const credential = await navigator.credentials.create({
  publicKey: decodeCreationOptions(options)
}) as PublicKeyCredential;

// 3. Serialize kết quả và gửi lên server
await api.post('/passkey/register/complete', {
  sessionId,
  attestationJson: JSON.stringify(encodeCredential(credential)),
  deviceName: 'MacBook Pro'
});
```

### Đăng nhập

```typescript
// 1. Gọi begin (không cần body)
const { sessionId, optionsJson } = await api.post('/passkey/auth/begin', {});

// 2. Parse options và gọi WebAuthn API
const options: PublicKeyCredentialRequestOptions =
  JSON.parse(optionsJson);

// Thiết bị tự hiện danh sách passkey đã lưu
const assertion = await navigator.credentials.get({
  publicKey: decodeRequestOptions(options)
}) as PublicKeyCredential;

// 3. Gửi lên server → nhận token
const authResponse = await api.post('/passkey/auth/complete', {
  sessionId,
  assertionJson: JSON.stringify(encodeAssertion(assertion))
});

// authResponse = { accessToken, refreshToken, user }
```

### Helper encode/decode (base64url ↔ ArrayBuffer)

```typescript
// ArrayBuffer → base64url string
function bufferToBase64url(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// base64url string → ArrayBuffer
function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return buffer;
}

// Decode options từ server (challenge + excludeCredentials/allowCredentials)
function decodeCreationOptions(opts: any): PublicKeyCredentialCreationOptions {
  return {
    ...opts,
    challenge: base64urlToBuffer(opts.challenge),
    user: { ...opts.user, id: base64urlToBuffer(opts.user.id) },
    excludeCredentials: opts.excludeCredentials?.map((c: any) => ({
      ...c, id: base64urlToBuffer(c.id)
    })) ?? []
  };
}

function decodeRequestOptions(opts: any): PublicKeyCredentialRequestOptions {
  return {
    ...opts,
    challenge: base64urlToBuffer(opts.challenge),
    allowCredentials: opts.allowCredentials?.map((c: any) => ({
      ...c, id: base64urlToBuffer(c.id)
    })) ?? []
  };
}

// Encode credential trước khi gửi server
function encodeCredential(cred: PublicKeyCredential): object {
  const response = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      attestationObject: bufferToBase64url(response.attestationObject)
    }
  };
}

function encodeAssertion(cred: PublicKeyCredential): object {
  const response = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      authenticatorData: bufferToBase64url(response.authenticatorData),
      signature: bufferToBase64url(response.signature),
      userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : null
    }
  };
}
```

---

## 11. Lưu ý cho Chrome Extension

### Lưu token
```typescript
// Lưu
await chrome.storage.local.set({ accessToken, refreshToken });

// Đọc
const { accessToken, refreshToken } = await chrome.storage.local.get([
  'accessToken', 'refreshToken'
]);
```

### Auto-refresh token
Khi nhận `401` từ bất kỳ request nào: gọi `/auth/refresh`, lưu token mới, retry request gốc.

```typescript
async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  let res = await fetch(url, withAuth(init));
  if (res.status === 401) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      res = await fetch(url, withAuth(init)); // retry 1 lần
    } else {
      // refresh thất bại → đăng xuất
      await chrome.storage.local.remove(['accessToken', 'refreshToken']);
      // redirect to login popup
    }
  }
  return res;
}
```

### Passkey trong Extension
WebAuthn (`navigator.credentials`) **không hoạt động trực tiếp từ extension context** (`chrome-extension://...`). Cần mở một tab/popup trỏ đến domain của server (`https://yourdomain.com`) để thực hiện WebAuthn, sau đó dùng `chrome.tabs` hoặc `postMessage` để trao đổi kết quả.

### CORS
Server chỉ cho phép origin được cấu hình trong `Cors:ExtensionOrigins`. Đảm bảo extension ID của bạn được thêm vào cấu hình server:
```json
"Cors": {
  "ExtensionOrigins": ["chrome-extension://YOUR_EXTENSION_ID"]
}
```

### TOTP trong Extension
Dùng thư viện như [`@otplib/preset-browser`](https://github.com/yeojz/otplib) để tự tính mã sau khi lấy `secret` — không cần gọi API mỗi 30 giây:
```typescript
import { totp } from '@otplib/preset-browser';

const code = totp.generate(secret); // "123456"
const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
```
