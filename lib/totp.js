/**
 * lib/totp.js — TOTP (RFC 6238) implementation thuần JavaScript
 * Không cần thư viện bên ngoài. Tính mã 6 số từ base32 secret.
 *
 * Flow:
 *  1. Decode base32 secret → bytes
 *  2. counter = floor(Date.now() / 1000 / period)
 *  3. HMAC-SHA1(key=secret_bytes, data=counter as 8-byte big-endian)
 *  4. Dynamic truncation → 6-digit OTP
 */

// ---- Base32 Decode ----

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decode a base32 string to Uint8Array
 * @param {string} base32
 * @returns {Uint8Array}
 */
function base32Decode(base32) {
  const input = base32.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  let index = 0;
  const output = new Uint8Array(Math.floor((input.length * 5) / 8));

  for (let i = 0; i < input.length; i++) {
    const charIndex = BASE32_CHARS.indexOf(input[i]);
    if (charIndex === -1) throw new Error(`Invalid base32 character: ${input[i]}`);
    value = (value << 5) | charIndex;
    bits += 5;

    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }

  return output;
}

// ---- HMAC-SHA1 via SubtleCrypto ----

/**
 * Compute HMAC-SHA1
 * @param {Uint8Array} keyBytes
 * @param {Uint8Array} data
 * @returns {Promise<Uint8Array>}
 */
async function hmacSha1(keyBytes, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, data);
  return new Uint8Array(signature);
}

// ---- Counter → 8-byte big-endian ----

function counterToBytes(counter) {
  const bytes = new Uint8Array(8);
  let remaining = counter;
  for (let i = 7; i >= 0; i--) {
    bytes[i] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  return bytes;
}

// ---- Dynamic Truncation ----

function dynamicTruncate(hmacResult, digits = 6) {
  const offset = hmacResult[hmacResult.length - 1] & 0x0f;
  const code =
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff);
  return String(code % Math.pow(10, digits)).padStart(digits, '0');
}

// ---- Public API ----

/**
 * Tính mã TOTP hiện tại từ base32 secret.
 * @param {string} secret - base32 secret key
 * @param {number} period - chu kỳ giây (mặc định 30)
 * @param {number} digits - số chữ số (mặc định 6)
 * @returns {Promise<string>} mã OTP (ví dụ "482937")
 */
export async function generateTotpCode(secret, period = 30, digits = 6) {
  const secretBytes = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / period);
  const counterBytes = counterToBytes(counter);
  const hmac = await hmacSha1(secretBytes, counterBytes);
  return dynamicTruncate(hmac, digits);
}

/**
 * Số giây còn lại trong chu kỳ hiện tại.
 * @param {number} period - chu kỳ giây (mặc định 30)
 * @returns {number} 1..period
 */
export function getSecondsRemaining(period = 30) {
  const epochSeconds = Math.floor(Date.now() / 1000);
  return period - (epochSeconds % period);
}

/**
 * Parse otpauth:// URI từ QR code.
 * @param {string} uri - otpauth://totp/Issuer:account?secret=...&issuer=...
 * @returns {{ issuer, accountName, secret, period, digits }}
 */
export function parseOtpAuthUri(uri) {
  if (!uri.startsWith('otpauth://totp/')) {
    throw new Error('URI không đúng định dạng otpauth://totp/');
  }

  const withoutScheme = uri.slice('otpauth://totp/'.length);
  const qIdx = withoutScheme.indexOf('?');
  const label = decodeURIComponent(qIdx >= 0 ? withoutScheme.slice(0, qIdx) : withoutScheme);
  const queryStr = qIdx >= 0 ? withoutScheme.slice(qIdx + 1) : '';
  const params = Object.fromEntries(
    queryStr.split('&')
      .filter(Boolean)
      .map(p => {
        const [k, v] = p.split('=');
        return [decodeURIComponent(k), decodeURIComponent(v ?? '')];
      })
  );

  // Parse label: "Issuer:AccountName" hoặc "AccountName"
  const colonIdx = label.indexOf(':');
  let issuer = colonIdx >= 0 ? label.slice(0, colonIdx).trim() : '';
  let accountName = colonIdx >= 0 ? label.slice(colonIdx + 1).trim() : label.trim();

  if (params.issuer) issuer = params.issuer;
  if (!issuer) issuer = accountName;

  const secret = (params.secret || '').toUpperCase();
  if (!secret) throw new Error("URI thiếu tham số 'secret'");

  return {
    issuer,
    accountName,
    secret,
    period: parseInt(params.period || '30', 10),
    digits: parseInt(params.digits || '6', 10),
  };
}
