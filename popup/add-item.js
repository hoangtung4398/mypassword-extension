// popup/add-item.js — Create/edit vault items with encryption

import { createVaultItem, updateVaultItem, getVaultItemWithDecryption } from '../lib/vault.js';

let currentType = 1; // 1=Login, 2=SecureNote, 3=CreditCard
let editItemId = null;

// Parse URL params to check if editing
const params = new URLSearchParams(window.location.search);
editItemId = params.get('id');
const prefilledDomain = params.get('domain');

if (editItemId) {
  document.getElementById('page-title').textContent = 'Edit Item';
  loadItemForEdit(editItemId);
} else {
  if (prefilledDomain) {
    document.getElementById('field-url').value = prefilledDomain;
  }
  // Auto-fill URL from current tab when creating new item
  autoFillCurrentUrl();
}

// Type selector
document.querySelectorAll('.type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentType = parseInt(btn.dataset.type);

    // Update UI
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Show/hide fields
    document.querySelectorAll('.field-group').forEach(g => g.classList.remove('visible'));
    if (currentType === 1) document.getElementById('login-fields').classList.add('visible');
    if (currentType === 2) document.getElementById('note-fields').classList.add('visible');
    if (currentType === 3) document.getElementById('card-fields').classList.add('visible');
  });
});

// Toggle password visibility
document.getElementById('toggle-password').addEventListener('click', () => {
  const input = document.getElementById('field-password');
  const btn = document.getElementById('toggle-password');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁';
  }
});

// Back/Cancel buttons
document.getElementById('back-btn').addEventListener('click', () => window.location.replace('popup.html'));
document.getElementById('cancel-btn').addEventListener('click', () => window.location.replace('popup.html'));

// Form submit
document.getElementById('item-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = document.getElementById('field-name').value.trim();
  const errorEl = document.getElementById('form-error');
  const saveBtn = document.getElementById('save-btn');

  errorEl.textContent = '';
  saveBtn.disabled = true;

  try {
    let url = null;
    let plainData = {};

    // Gather data based on type
    if (currentType === 1) {
      // Login
      url = document.getElementById('field-url').value.trim() || null;
      plainData = {
        username: document.getElementById('field-username').value,
        password: document.getElementById('field-password').value,
        notes: document.getElementById('field-notes').value
      };
    } else if (currentType === 2) {
      // Secure Note
      plainData = {
        content: document.getElementById('field-note-content').value
      };
    } else if (currentType === 3) {
      // Credit Card
      plainData = {
        cardholder: document.getElementById('field-cardholder').value,
        cardNumber: document.getElementById('field-cardnumber').value,
        expiry: document.getElementById('field-expiry').value,
        cvv: document.getElementById('field-cvv').value
      };
    }

    // Create or update
    if (editItemId) {
      await updateVaultItem(editItemId, name, url, plainData, currentType);
    } else {
      await createVaultItem(name, url, plainData, currentType);
    }

    // Navigate back to vault list in popup
    window.location.replace('popup.html');

  } catch (err) {
    errorEl.textContent = err.message || 'Failed to save item. Please try again.';
  } finally {
    saveBtn.disabled = false;
  }
});

// Load item for editing
async function loadItemForEdit(id) {
  try {
    const { item, decryptedData } = await getVaultItemWithDecryption(id);

    // Set type
    currentType = item.itemType;
    document.querySelector(`.type-btn[data-type="${currentType}"]`).click();

    // Fill common fields
    document.getElementById('field-name').value = item.name;

    // Fill type-specific fields
    if (currentType === 1) {
      document.getElementById('field-url').value = item.url || '';
      document.getElementById('field-username').value = decryptedData.username || '';
      document.getElementById('field-password').value = decryptedData.password || '';
      document.getElementById('field-notes').value = decryptedData.notes || '';
    } else if (currentType === 2) {
      document.getElementById('field-note-content').value = decryptedData.content || '';
    } else if (currentType === 3) {
      document.getElementById('field-cardholder').value = decryptedData.cardholder || '';
      document.getElementById('field-cardnumber').value = decryptedData.cardNumber || '';
      document.getElementById('field-expiry').value = decryptedData.expiry || '';
      document.getElementById('field-cvv').value = decryptedData.cvv || '';
    }

  } catch (err) {
    document.getElementById('form-error').textContent = 'Failed to load item: ' + err.message;
  }
}

// Auto-fill URL from current active tab
async function autoFillCurrentUrl() {
  if (document.getElementById('field-url').value) return;

  try {
    // Get current active tab
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

    if (tab && tab.url) {
      const url = new URL(tab.url);

      // Only auto-fill for http/https URLs (not chrome:// or extension:// etc)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        // Extract origin (protocol + hostname + port)
        const origin = url.origin;

        // Auto-fill into URL field (only for Login type)
        if (currentType === 1) {
          document.getElementById('field-url').value = origin;
        }
      }
    }
  } catch (err) {
    // Silently fail if can't get tab info (e.g., on chrome:// pages)
    console.log('[add-item] Could not auto-fill URL:', err);
  }
}
