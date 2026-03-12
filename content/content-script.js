// content/content-script.js — Auto-fill content script
// Detects login forms and fills credentials via messaging to service worker

(function () {
  'use strict';

  // Only run on HTTPS pages
  if (location.protocol !== 'https:') return;

  // Find password inputs
  const passwordInputs = document.querySelectorAll('input[type="password"]');
  if (passwordInputs.length === 0) return;

  // Notify background that this page has login form
  chrome.runtime.sendMessage({
    type: 'PAGE_HAS_LOGIN_FORM',
    url: location.href
  });

  // Listen for fill instructions
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'FILL_CREDENTIALS') {
      fillCredentials(message.username, message.password);
    }
  });

  function fillCredentials(username, password) {
    // Find username field (email or text input near password)
    const form = passwordInputs[0].closest('form');
    if (form) {
      const usernameInput = form.querySelector('input[type="email"], input[type="text"], input[name*="user"], input[name*="email"], input[id*="user"], input[id*="email"]');
      if (usernameInput && username) {
        setNativeValue(usernameInput, username);
      }
    }

    if (password) {
      setNativeValue(passwordInputs[0], password);
    }
  }

  // React-compatible value setter
  function setNativeValue(element, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ---- TOTP QR Code Detection ----
  // Phát hiện QR code có chứa otpauth:// URI trên trang 2FA setup của các website.
  // Khi tìm thấy, hiển thị nút "Save to MyPassword" để user lưu vào vault.

  function detectTotpQrCodes() {
    // Tìm tất cả thẻ img và canvas (QR code thường render bằng img hoặc canvas)
    const candidates = document.querySelectorAll('img[src], canvas');
    candidates.forEach(el => {
      // Kiểm tra alt text hoặc aria-label có gợi ý QR code không
      const hint = (el.alt || el.getAttribute('aria-label') || '').toLowerCase();
      if (hint.includes('qr') || hint.includes('authenticator') || hint.includes('2fa') || hint.includes('totp')) {
        addSaveButton(el);
      }
    });

    // Detect otpauth:// URI trong href của các link (một số site dùng link thay vì QR)
    document.querySelectorAll('a[href^="otpauth://"]').forEach(link => {
      const uri = link.href;
      addSaveButtonForUri(link, uri);
    });
  }

  /**
   * Thêm nút "Save to MyPassword" bên cạnh phần tử QR code.
   * Khi click, gửi message lên background để mở popup nhập URI.
   */
  function addSaveButton(element) {
    if (element.dataset.mypasswordDetected) return;
    element.dataset.mypasswordDetected = 'true';

    const btn = document.createElement('button');
    btn.textContent = '🔐 Save to MyPassword';
    btn.style.cssText = `
      display: block; margin: 8px auto;
      padding: 6px 12px; font-size: 13px;
      background: #1a73e8; color: white;
      border: none; border-radius: 4px; cursor: pointer;
    `;
    btn.addEventListener('click', () => {
      // Gợi ý user nhập URI thủ công nếu không detect được tự động
      const uri = prompt(
        'Nhập otpauth:// URI từ trang này (thường hiển thị bên dưới QR code):',
        'otpauth://totp/'
      );
      if (uri && uri.startsWith('otpauth://')) {
        chrome.runtime.sendMessage({ type: 'SAVE_TOTP_URI', uri });
      }
    });

    element.parentElement?.insertAdjacentElement('afterend', btn);
  }

  function addSaveButtonForUri(element, uri) {
    if (element.dataset.mypasswordDetected) return;
    element.dataset.mypasswordDetected = 'true';

    const btn = document.createElement('button');
    btn.textContent = '🔐 Save to MyPassword';
    btn.style.cssText = `
      display: inline-block; margin-left: 8px;
      padding: 4px 10px; font-size: 12px;
      background: #1a73e8; color: white;
      border: none; border-radius: 4px; cursor: pointer;
    `;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: 'SAVE_TOTP_URI', uri });
    });
    element.insertAdjacentElement('afterend', btn);
  }

  // Chạy sau khi DOM load xong, dùng MutationObserver để detect dynamic content
  detectTotpQrCodes();
  const observer = new MutationObserver(() => detectTotpQrCodes());
  observer.observe(document.body, { childList: true, subtree: true });
})();
