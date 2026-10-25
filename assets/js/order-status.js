/**
 * TNT Diwali Order Management System
 * Order Status Lookup & Receipt Controller
 * 
 * Provides secure lookup requiring BOTH Order Reference AND Registered Mobile.
 * Displays verified pickup code and print receipts only for authentic verified orders.
 */

import { OrderAPI } from './api.js';
import { APP_CONFIG, formatINR, formatQuantityUnit } from './config.js';
import { validateOrderReference, validateMobileNumber } from './validation.js';
import { CartManager } from './cart.js';

document.addEventListener('DOMContentLoaded', () => {
  initOrderStatus();
});

function initOrderStatus() {
  CartManager.initCartBadge();
  setupLookupForm();
  checkUrlParamsForLookup();
}

/**
 * Check if order reference is provided in URL (e.g., after redirection)
 */
function checkUrlParamsForLookup() {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  const mobile = params.get('mobile');

  if (ref) {
    const refInput = document.getElementById('input-lookup-ref');
    if (refInput) refInput.value = ref;
  }
  if (mobile) {
    const mobInput = document.getElementById('input-lookup-mobile');
    if (mobInput) mobInput.value = mobile;
  }

  if (ref && mobile) {
    executeLookup(ref, mobile);
  }
}

/**
 * Setup lookup form submission
 */
function setupLookupForm() {
  const form = document.getElementById('tnt-lookup-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const refInput = document.getElementById('input-lookup-ref');
    const mobInput = document.getElementById('input-lookup-mobile');

    const refVal = refInput?.value || '';
    const mobVal = mobInput?.value || '';

    // Validate inputs
    const refCheck = validateOrderReference(refVal);
    const mobCheck = validateMobileNumber(mobVal);

    let hasError = false;

    if (!refCheck.isValid) {
      showError('lookup-ref', refCheck.message);
      hasError = true;
    } else {
      clearError('lookup-ref');
    }

    if (!mobCheck.isValid) {
      showError('lookup-mobile', mobCheck.message);
      hasError = true;
    } else {
      clearError('lookup-mobile');
    }

    if (hasError) return;

    await executeLookup(refCheck.value, mobCheck.value);
  });
}

/**
 * Execute lookup call through OrderAPI
 */
async function executeLookup(ref, mobile) {
  const resultCard = document.getElementById('lookup-result-card');
  const emptyState = document.getElementById('lookup-empty-placeholder');
  const errorBox = document.getElementById('lookup-error-box');
  const submitBtn = document.getElementById('btn-lookup-submit');

  // Loading state
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying Credentials...';
  }
  if (errorBox) errorBox.classList.add('hidden');
  if (resultCard) resultCard.classList.add('hidden');

  try {
    const res = await OrderAPI.lookupOrder(ref, mobile);

    if (!res.success) {
      if (emptyState) emptyState.classList.remove('hidden');
      if (errorBox) {
        errorBox.textContent = res.message;
        errorBox.classList.remove('hidden');
      }
      return;
    }

    // Success - Render verified order receipt
    if (emptyState) emptyState.classList.add('hidden');
    renderOrderDetails(res.order, res.isDemo);

  } catch (err) {
    console.error('Lookup failed:', err);
    if (errorBox) {
      errorBox.textContent = 'Unable to complete order lookup. Please try again.';
      errorBox.classList.remove('hidden');
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Check Order Status';
    }
  }
}

/**
 * Render order receipt card
 * @param {object} order 
 * @param {boolean} isDemo 
 */
function renderOrderDetails(order, isDemo = false) {
  const container = document.getElementById('lookup-result-card');
  if (!container) return;

  const isVerifiedPaid = order.paymentStatus === 'PAID_VERIFIED';

  let itemsHtml = '';
  order.items.forEach(item => {
    itemsHtml += `
      <div class="receipt-item-row">
        <div class="receipt-item-info">
          <span class="receipt-item-name">${escapeHTML(item.name)}</span>
          <span class="receipt-item-qty">${formatQuantityUnit(item.quantity, item.unit)}</span>
        </div>
        <span class="receipt-item-price">${formatINR(item.total || item.price * item.quantity)}</span>
      </div>
    `;
  });

  // Pickup code display rule: ONLY when verified paid
  let pickupCodeSection = '';
  if (isVerifiedPaid && order.pickupCode) {
    pickupCodeSection = `
      <div class="pickup-code-box">
        <div class="pickup-code-label">OFFICIAL STORE PICKUP CODE</div>
        <div class="pickup-code-value">${escapeHTML(order.pickupCode)}</div>
        <p class="pickup-code-instruction">
          ⚠️ Please show this code and your Order Reference (<strong>${escapeHTML(order.orderReference)}</strong>) at the TNT Catering shop counter to collect your fresh pack.
        </p>
      </div>
    `;
  } else {
    pickupCodeSection = `
      <div class="pickup-pending-box">
        <span class="status-icon">⏳</span>
        <div>
          <strong>Pickup Code Awaiting Payment Verification</strong>
          <p>Pickup codes are generated strictly after confirmed online payment verification.</p>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="receipt-card" id="printable-receipt">
      ${isDemo ? `
        <div class="demo-badge-banner">
          DEMONSTRATION SAMPLE RECEIPT — Stage 1 UI & Print Layout Test
        </div>
      ` : ''}

      <div class="receipt-header">
        <div class="receipt-brand">
          <h2 class="receipt-title">${escapeHTML(APP_CONFIG.business.name)}</h2>
          <p class="receipt-tagline">${escapeHTML(APP_CONFIG.business.motto)} • ${escapeHTML(APP_CONFIG.business.tagline)}</p>
          <p class="receipt-contacts">Contact: ${escapeHTML(APP_CONFIG.business.contacts.join(' / '))}</p>
        </div>
        <div class="receipt-status-badge ${isVerifiedPaid ? 'badge-verified' : 'badge-pending'}">
          ${isVerifiedPaid ? '✓ PAYMENT VERIFIED' : '⏳ PAYMENT PENDING'}
        </div>
      </div>

      <div class="receipt-meta-grid">
        <div class="meta-block">
          <span class="meta-label">Order Reference:</span>
          <span class="meta-val font-mono font-bold">${escapeHTML(order.orderReference)}</span>
        </div>
        <div class="meta-block">
          <span class="meta-label">Customer Name:</span>
          <span class="meta-val">${escapeHTML(order.customerName)}</span>
        </div>
        <div class="meta-block">
          <span class="meta-label">Registered Mobile:</span>
          <span class="meta-val font-mono">${maskMobile(order.mobile)}</span>
        </div>
        <div class="meta-block">
          <span class="meta-label">Fulfilment Method:</span>
          <span class="meta-val text-brand-maroon font-semibold">${escapeHTML(APP_CONFIG.business.fulfilmentType)}</span>
        </div>
      </div>

      ${pickupCodeSection}

      <div class="receipt-items-section">
        <h4 class="receipt-section-heading">Order Summary</h4>
        <div class="receipt-items-list">
          ${itemsHtml}
        </div>
        <div class="receipt-total-row">
          <span>Total Paid Amount:</span>
          <span class="receipt-total-val">${formatINR(order.totalAmount)}</span>
        </div>
      </div>

      <div class="receipt-pickup-guidelines">
        <h4>Counter Collection Guidelines:</h4>
        <ul>
          <li><strong>Location:</strong> ${escapeHTML(APP_CONFIG.business.pickupLocationNote)}</li>
          <li><strong>Verification:</strong> Present the pickup code on your mobile or a printed copy of this receipt.</li>
          <li><strong>Contact:</strong> ${escapeHTML(APP_CONFIG.business.primaryPhone)} / ${escapeHTML(APP_CONFIG.business.secondaryPhone)} for queries.</li>
          <li><strong>Note:</strong> ${escapeHTML(APP_CONFIG.business.operatingNotice)}</li>
        </ul>
      </div>

      <div class="receipt-actions no-print">
        <button type="button" class="btn btn-secondary" onclick="window.print()">
          🖨️ Print Customer Receipt
        </button>
        <a href="products.html" class="btn btn-outline">
          Place Another Order
        </a>
      </div>
    </div>
  `;

  container.classList.remove('hidden');
  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function maskMobile(mobile) {
  if (!mobile || mobile.length < 10) return mobile || '';
  return mobile.substring(0, 2) + '******' + mobile.substring(8);
}

function showError(fieldId, message) {
  const errorEl = document.getElementById(`error-${fieldId}`);
  const inputEl = document.getElementById(`input-${fieldId}`);
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }
  if (inputEl) {
    inputEl.classList.add('input-invalid');
  }
}

function clearError(fieldId) {
  const errorEl = document.getElementById(`error-${fieldId}`);
  const inputEl = document.getElementById(`input-${fieldId}`);
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
  }
  if (inputEl) {
    inputEl.classList.remove('input-invalid');
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
