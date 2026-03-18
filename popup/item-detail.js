// popup/item-detail.js — View vault item details with decryption

import { getVaultItemWithDecryption, deleteVaultItem } from '../lib/vault.js';

const params = new URLSearchParams(window.location.search);
const itemId = params.get('id');

if (!itemId) {
  document.getElementById('loading').textContent = 'Error: No item ID provided';
} else {
  loadItem(itemId);
}

document.getElementById('back-btn').addEventListener('click', () => window.close());
document.getElementById('close-btn').addEventListener('click', () => window.close());

document.getElementById('edit-btn').addEventListener('click', () => {
  window.location.href = `add-item.html?id=${itemId}`;
});

document.getElementById('delete-btn').addEventListener('click', async () => {
  if (!confirm('Are you sure you want to delete this item? This cannot be undone.')) {
    return;
  }

  const deleteBtn = document.getElementById('delete-btn');
  deleteBtn.disabled = true;
  deleteBtn.textContent = 'Deleting...';

  try {
    await deleteVaultItem(itemId);
    window.close();
  } catch (err) {
    document.getElementById('error-msg').textContent = 'Failed to delete: ' + err.message;
    deleteBtn.disabled = false;
    deleteBtn.textContent = 'Delete';
  }
});

async function loadItem(id) {
  try {
    const { item, decryptedData } = await getVaultItemWithDecryption(id);

    // Hide loading, show content
    document.getElementById('loading').style.display = 'none';
    document.getElementById('item-content').style.display = 'block';

    // Set item name and type
    document.getElementById('item-name').textContent = item.name;

    const typeNames = { 1: '🔑 Login', 2: '📝 Secure Note', 3: '💳 Credit Card' };
    document.getElementById('item-type').textContent = typeNames[item.itemType] || 'Item';

    // Render fields based on type
    const fieldsContainer = document.getElementById('fields-container');

    if (item.itemType === 1) {
      // Login
      if (item.url) {
        fieldsContainer.appendChild(createFieldDisplay('Website', item.url, true));
      }
      if (decryptedData.username) {
        fieldsContainer.appendChild(createFieldDisplay('Username', decryptedData.username, true));
      }
      if (decryptedData.password) {
        fieldsContainer.appendChild(createFieldDisplay('Password', '••••••••', true, decryptedData.password));
      }
      if (decryptedData.notes) {
        fieldsContainer.appendChild(createFieldDisplay('Notes', decryptedData.notes, false));
      }
    } else if (item.itemType === 2) {
      // Secure Note
      fieldsContainer.appendChild(createFieldDisplay('Content', decryptedData.content || '', false));
    } else if (item.itemType === 3) {
      // Credit Card
      if (decryptedData.cardholder) {
        fieldsContainer.appendChild(createFieldDisplay('Cardholder', decryptedData.cardholder, false));
      }
      if (decryptedData.cardNumber) {
        fieldsContainer.appendChild(createFieldDisplay('Card Number', decryptedData.cardNumber, true));
      }
      if (decryptedData.expiry) {
        fieldsContainer.appendChild(createFieldDisplay('Expiry', decryptedData.expiry, false));
      }
      if (decryptedData.cvv) {
        fieldsContainer.appendChild(createFieldDisplay('CVV', decryptedData.cvv, true));
      }
    }

  } catch (err) {
    document.getElementById('loading').textContent = 'Failed to load item: ' + err.message;
  }
}

function createFieldDisplay(label, value, copyable, realValue = null) {
  const container = document.createElement('div');
  container.className = 'field-display';

  const labelEl = document.createElement('div');
  labelEl.className = 'field-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('div');
  valueEl.className = 'field-value';

  const textEl = document.createElement('span');
  textEl.textContent = value;
  if (realValue) {
    textEl.className = 'masked';
  }

  valueEl.appendChild(textEl);

  if (copyable) {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = '📋 Copy';
    copyBtn.addEventListener('click', async () => {
      const valueToCopy = realValue || value;
      await navigator.clipboard.writeText(valueToCopy);
      const originalText = copyBtn.textContent;
      copyBtn.textContent = '✓ Copied';
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 1500);
    });
    valueEl.appendChild(copyBtn);
  }

  container.appendChild(labelEl);
  container.appendChild(valueEl);

  return container;
}
