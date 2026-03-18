// lib/api.js — fetch wrapper for MyPassword API
// Auto-attaches Authorization header, handles 401 refresh

const API_BASE_URL = 'https://localhost:7259/api/v1';

/**
 * Make an authenticated API request
 * @param {string} path - API path (e.g. '/vault/items')
 * @param {RequestInit} options - fetch options
 * @param {boolean} retry - whether to retry on 401
 * @returns {Promise<any>}
 */
async function apiFetch(path, options = {}, retry = true) {
  const { accessToken } = await chrome.storage.local.get('accessToken');

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers
  });

  // Handle 401 — try to refresh token once
  if (response.status === 401 && retry) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      return apiFetch(path, options, false);
    }
    // Refresh failed — clear tokens and signal re-login required
    await chrome.storage.local.clear();
    throw new ApiError(401, 'Session expired. Please log in again.');
  }

  if (!response.ok) {
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      errorData = { error: 'Unknown', message: response.statusText };
    }
    throw new ApiError(response.status, errorData.message || 'Request failed', errorData);
  }

  // 204 No Content
  if (response.status === 204) return null;

  return response.json();
}

/**
 * Attempt to refresh the access token using the stored refresh token
 * @returns {Promise<boolean>}
 */
async function refreshTokens() {
  try {
    const { refreshToken } = await chrome.storage.local.get('refreshToken');
    if (!refreshToken) return false;

    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });

    if (!response.ok) return false;

    const data = await response.json();
    await chrome.storage.local.set({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * GET request
 * @param {string} path
 * @returns {Promise<any>}
 */
export function apiGet(path) {
  return apiFetch(path, { method: 'GET' });
}

/**
 * POST request
 * @param {string} path
 * @param {object} body
 * @returns {Promise<any>}
 */
export function apiPost(path, body) {
  return apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

/**
 * PUT request
 * @param {string} path
 * @param {object} body
 * @returns {Promise<any>}
 */
export function apiPut(path, body) {
  return apiFetch(path, {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

/**
 * DELETE request
 * @param {string} path
 * @returns {Promise<any>}
 */
export function apiDelete(path) {
  return apiFetch(path, { method: 'DELETE' });
}

/**
 * POST request without auth (for auth endpoints)
 * @param {string} path
 * @param {object} body
 * @returns {Promise<any>}
 */
export async function apiPostPublic(path, body) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      errorData = { error: 'Unknown', message: response.statusText };
    }
    throw new ApiError(response.status, errorData.message || 'Request failed', errorData);
  }

  return response.json();
}

/**
 * Typed API error
 */
export class ApiError extends Error {
  constructor(status, message, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}
