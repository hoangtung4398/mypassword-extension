// popup/popup.js — Main popup logic
import { getTokens, clearAll, getUser } from '../lib/storage.js';
import { apiGet, apiPost } from '../lib/api.js';
import { generateTotpCode, getSecondsRemaining } from '../lib/totp.js';

const authScreen = document.getElementById('auth-screen');
const vaultScreen = document.getElementById('vault-screen');
const btnSignIn = document.getElementById('btn-sign-in');
const btnLogout = document.getElementById('btn-logout');
const btnAdd = document.getElementById('btn-add');
const vaultList = document.getElementById('vault-list');
const searchInput = document.getElementById('search-input');
const authError = document.getElementById('auth-error');

let allItems = [];
let totpAccounts = [];       // danh sách TOTP accounts với secret để tự tính mã
let totpTimerInterval = null; // interval update mã mỗi giây

// ---- Init ----
async function init() {
  const { accessToken } = await getTokens();
  if (accessToken) {
    showVaultScreen();
    await loadVaultItems();
  } else {
    showAuthScreen();
  }
}

// ---- Auth ----
function showAuthScreen() {
  authScreen.style.display = 'flex';
  vaultScreen.style.display = 'none';
  // Dừng timer TOTP khi logout
  if (totpTimerInterval) {
    clearInterval(totpTimerInterval);
    totpTimerInterval = null;
  }
}

function showVaultScreen() {
  authScreen.style.display = 'none';
  vaultScreen.style.display = 'flex';
}

btnSignIn.addEventListener('click', async () => {
  btnSignIn.disabled = true;
  authError.textContent = '';

  try {
    // Delegate to background service worker for OAuth flow
    const response = await chrome.runtime.sendMessage({ type: 'GOOGLE_LOGIN' });

    if (response?.success) {
      showVaultScreen();
      await loadVaultItems();
    } else {
      authError.textContent = response?.error || 'Sign-in failed. Please try again.';
    }
  } catch (err) {
    authError.textContent = 'Sign-in failed. Please try again.';
    console.error('[popup] login error:', err);
  } finally {
    btnSignIn.disabled = false;
  }
});

btnLogout.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'LOGOUT' });
  } catch { /* ignore */ }
  await clearAll();
  showAuthScreen();
});

// ---- Vault ----
async function loadVaultItems() {
  vaultList.innerHTML = '<div class="spinner">Loading…</div>';

  try {
    // Load vault items và TOTP accounts song song
    const [items, totp] = await Promise.all([
      apiGet('/vault/items'),
      apiGet('/vault/totp').catch(() => []) // Nếu lỗi TOTP thì bỏ qua
    ]);

    allItems = items;
    totpAccounts = totp; // Chỉ có metadata (không có secret) — dùng để hiển thị list

    renderItems(allItems);
    renderTotpSection(totp);

    // Khởi động timer cập nhật mã TOTP mỗi giây
    startTotpTimer();

  } catch (err) {
    if (err.status === 401) {
      await clearAll();
      showAuthScreen();
    } else {
      vaultList.innerHTML = `<div class="error-msg">Failed to load vault: ${err.message}</div>`;
    }
  }
}

function renderItems(items) {
  if (items.length === 0) {
    vaultList.innerHTML = '<div class="empty-state">🔒<br/>No items yet.<br/>Add your first password!</div>';
    return;
  }

  const icons = { 1: '🔑', 2: '📝', 3: '💳', 4: '🔐' };

  vaultList.innerHTML = items.map(item => `
    <div class="vault-item" data-id="${item.id}">
      <span class="item-icon">${icons[item.itemType] ?? '🔑'}</span>
      <div class="item-info">
        <div class="item-name">${escapeHtml(item.name)}</div>
        ${item.url ? `<div class="item-url">${escapeHtml(item.url)}</div>` : ''}
      </div>
    </div>
  `).join('');
}

// Click handler for vault items
vaultList.addEventListener('click', (e) => {
  const item = e.target.closest('.vault-item');
  if (!item) return;

  const itemId = item.dataset.id;
  window.location.href = `item-detail.html?id=${itemId}`;
});

// ---- TOTP Section ----

/**
 * Render danh sách TOTP accounts. Secret được fetch riêng khi click để tính mã.
 * @param {Array} accounts - danh sách TOTP account summaries (không có secret)
 */
function renderTotpSection(accounts) {
  // Tìm hoặc tạo section TOTP trong popup
  let totpSection = document.getElementById('totp-section');
  if (!totpSection) {
    totpSection = document.createElement('div');
    totpSection.id = 'totp-section';
    vaultList.parentElement.appendChild(totpSection);
  }

  if (accounts.length === 0) {
    totpSection.innerHTML = '';
    return;
  }

  totpSection.innerHTML = `
    <div class="section-header">🔐 Authenticator Codes</div>
    <div id="totp-list">
      ${accounts.map(acc => `
        <div class="totp-item" data-id="${acc.id}" data-period="${acc.period}" data-digits="${acc.digits}">
          <div class="totp-info">
            <div class="totp-issuer">${escapeHtml(acc.issuer)}</div>
            <div class="totp-account">${escapeHtml(acc.accountName)}</div>
          </div>
          <div class="totp-code-wrap">
            <div class="totp-code" id="totp-code-${acc.id}">••••••</div>
            <div class="totp-timer">
              <svg viewBox="0 0 36 36" class="totp-ring" id="totp-ring-${acc.id}">
                <circle cx="18" cy="18" r="15" fill="none" stroke="#e0e0e0" stroke-width="3"/>
                <circle cx="18" cy="18" r="15" fill="none" stroke="#4caf50" stroke-width="3"
                  stroke-dasharray="94.25" stroke-dashoffset="94.25"
                  id="totp-arc-${acc.id}" transform="rotate(-90 18 18)"/>
              </svg>
              <span class="totp-seconds" id="totp-sec-${acc.id}">--</span>s
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // Click vào TOTP item để copy mã
  document.getElementById('totp-list').addEventListener('click', async (e) => {
    const item = e.target.closest('.totp-item');
    if (!item) return;
    const codeEl = document.getElementById(`totp-code-${item.dataset.id}`);
    const code = codeEl?.textContent;
    if (code && code !== '••••••') {
      await navigator.clipboard.writeText(code);
      const orig = codeEl.textContent;
      codeEl.textContent = 'Copied!';
      setTimeout(() => { codeEl.textContent = orig; }, 1000);
    }
  });
}

/**
 * Fetch secret từ API và cache vào bộ nhớ trong session.
 * Secret chỉ được lưu trong memory, không persist vào storage.
 */
const _secretCache = new Map(); // id → { secret, period, digits }

async function getTotpSecret(id) {
  if (_secretCache.has(id)) return _secretCache.get(id);
  try {
    const info = await apiGet(`/vault/totp/${id}`);
    _secretCache.set(id, { secret: info.secret, period: info.period, digits: info.digits });
    return _secretCache.get(id);
  } catch {
    return null;
  }
}

/**
 * Cập nhật mã TOTP và countdown cho tất cả accounts.
 * Gọi mỗi giây để đảm bảo mã luôn đúng và countdown chính xác.
 */
async function updateTotpCodes() {
  const items = document.querySelectorAll('.totp-item');
  for (const item of items) {
    const id = item.dataset.id;
    const period = parseInt(item.dataset.period || '30', 10);
    const digits = parseInt(item.dataset.digits || '6', 10);

    const cacheEntry = await getTotpSecret(id);
    if (!cacheEntry) continue;

    const { secret } = cacheEntry;
    const secondsLeft = getSecondsRemaining(period);
    const code = await generateTotpCode(secret, period, digits);

    // Cập nhật mã
    const codeEl = document.getElementById(`totp-code-${id}`);
    if (codeEl && codeEl.textContent !== 'Copied!') {
      // Format: "482 937" cho dễ đọc
      codeEl.textContent = code.slice(0, 3) + ' ' + code.slice(3);
    }

    // Cập nhật countdown seconds
    const secEl = document.getElementById(`totp-sec-${id}`);
    if (secEl) secEl.textContent = secondsLeft;

    // Cập nhật SVG arc (94.25 = 2π×15 ≈ circumference của r=15)
    const arcEl = document.getElementById(`totp-arc-${id}`);
    if (arcEl) {
      const progress = secondsLeft / period;
      const dashOffset = 94.25 * (1 - progress);
      arcEl.setAttribute('stroke-dashoffset', dashOffset.toFixed(2));
      // Đổi màu khi sắp hết (< 7 giây)
      arcEl.setAttribute('stroke', secondsLeft <= 7 ? '#f44336' : '#4caf50');
    }
  }
}

function startTotpTimer() {
  if (totpTimerInterval) clearInterval(totpTimerInterval);
  // Chạy ngay lập tức rồi mỗi giây
  updateTotpCodes();
  totpTimerInterval = setInterval(updateTotpCodes, 1000);
}

// Search filter
searchInput.addEventListener('input', () => {
  const query = searchInput.value.toLowerCase();
  const filtered = allItems.filter(item =>
    item.name.toLowerCase().includes(query) ||
    (item.url && item.url.toLowerCase().includes(query))
  );
  renderItems(filtered);
});

// Add new item
btnAdd.addEventListener('click', async () => {
  let addItemUrl = 'add-item.html';

  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.url) {
      const currentUrl = new URL(tab.url);
      if (currentUrl.protocol === 'http:' || currentUrl.protocol === 'https:') {
        addItemUrl += `?domain=${encodeURIComponent(currentUrl.origin)}`;
      }
    }
  } catch (err) {
    console.log('[popup] Could not read active tab URL:', err);
  }

  window.location.replace(addItemUrl);
});

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Start
init();
