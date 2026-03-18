// popup/auth-advanced.js — Email/password authentication logic

import { setTokens, setUser } from '../lib/storage.js';
import { apiPostPublic } from '../lib/api.js';
import { ensureVaultKey } from '../lib/vault-key.js';

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const screenName = tab.dataset.screen;

    // Update tabs
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Update screens
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`${screenName}-screen`).classList.add('active');

    // Clear errors
    document.querySelectorAll('.error-msg, .success-msg').forEach(el => el.textContent = '');
  });
});

// Login Form
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  const btnLogin = document.getElementById('btn-login');

  errorEl.textContent = '';
  btnLogin.disabled = true;

  try {
    // Call /auth/login
    const data = await apiPostPublic('/auth/login', { email, password });

    // Store tokens and user
    await setTokens(data.accessToken, data.refreshToken);
    await setUser(data.user);

    // Ensure vault key exists
    await ensureVaultKey(data.user.email);

    // Redirect to popup
    window.location.href = chrome.runtime.getURL('popup/popup.html');

  } catch (err) {
    errorEl.textContent = err.message || 'Login failed. Please try again.';
  } finally {
    btnLogin.disabled = false;
  }
});

// Register Form
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const displayName = document.getElementById('register-name').value;
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;
  const errorEl = document.getElementById('register-error');
  const successEl = document.getElementById('register-success');
  const btnRegister = document.getElementById('btn-register');

  errorEl.textContent = '';
  successEl.textContent = '';
  btnRegister.disabled = true;

  try {
    // Call /auth/register
    const data = await apiPostPublic('/auth/register', { email, displayName, password });

    // Store tokens and user
    await setTokens(data.accessToken, data.refreshToken);
    await setUser(data.user);

    // Ensure vault key exists
    await ensureVaultKey(data.user.email);

    // Redirect to popup
    successEl.textContent = 'Account created! Redirecting...';
    setTimeout(() => {
      window.location.href = chrome.runtime.getURL('popup/popup.html');
    }, 1000);

  } catch (err) {
    errorEl.textContent = err.message || 'Registration failed. Please try again.';
  } finally {
    btnRegister.disabled = false;
  }
});
