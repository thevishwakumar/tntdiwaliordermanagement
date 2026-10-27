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
    renderOrderDetails(res.order);

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
 */
function renderOrderDetails(order) {
  const container = document.getElementById('lookup-result-card');
  if (!container) return;

  const isVerifiedPaid = order.paymentStatus === 'PAID_VERIFIED';

  // Customer items table rows
  let customerItemsHtml = '';

  (order.items || []).forEach((item) => {
    const itemTotal = item.total || (item.price * item.quantity);
    customerItemsHtml += `
      <tr>
        <td style="padding: 0.5rem 0.6rem; border: 1px solid var(--color-border);">
          <strong>${escapeHTML(item.name)}</strong>
          ${item.tamil_name ? `<div style="font-size: 0.78rem; color: var(--color-text-muted);">${escapeHTML(item.tamil_name)}</div>` : ''}
        </td>
        <td style="padding: 0.5rem 0.6rem; border: 1px solid var(--color-border); text-align: center;">
          ${formatQuantityUnit(item.quantity, item.unit)}
        </td>
        <td style="padding: 0.5rem 0.6rem; border: 1px solid var(--color-border); text-align: right;">
          ${formatINR(item.price)}
        </td>
        <td style="padding: 0.5rem 0.6rem; border: 1px solid var(--color-border); text-align: right; font-weight: 700;">
          ${formatINR(itemTotal)}
        </td>
      </tr>
    `;
  });

  // Pickup code display
  const isDelivery = order.fulfilmentMethod === 'DELIVERY';
  const deliveryAddrFormatted = order.deliveryAddress?.formatted || (typeof order.deliveryAddress === 'string' ? order.deliveryAddress : '') || (order.deliveryAddress ? `${order.deliveryAddress.street || ''}, ${order.deliveryAddress.area || ''}, ${order.deliveryAddress.city || 'Coimbatore'} - ${order.deliveryAddress.pincode || ''}` : '');

  // Fulfilment & Pickup / Delivery banner section
  let fulfilmentActionSection = '';
  if (isDelivery) {
    fulfilmentActionSection = `
      <div class="delivery-address-box" style="background: #FFF8E1; border: 1.5px solid #FFE082; padding: 1.1rem 1.25rem; border-radius: 8px; margin-bottom: 1.25rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.4rem;">
          <strong style="color: #BF360C; font-size: 0.95rem; display: flex; align-items: center; gap: 0.4rem;">
            <svg style="width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
            DOORSTEP DELIVERY ADDRESS (VIA PORTER / PARTNER)
          </strong>
          <span class="status-badge" style="background: #FFE0B2; color: #E65100; font-weight: 800; font-size: 0.75rem;">₹80 DELIVERY FEE PAID</span>
        </div>
        <div style="font-size: 1.05rem; font-weight: 700; color: var(--color-maroon-900);">
          ${escapeHTML(deliveryAddrFormatted || 'Delivery address registered on order.')}
        </div>
        <p style="font-size: 0.85rem; color: #5D4037; margin-top: 0.4rem;">
          TNT will dispatch fresh Diwali delicacies directly to this address via Porter / local delivery partner on your scheduled date.
        </p>
      </div>
    `;
  } else if (isVerifiedPaid && order.pickupCode) {
    fulfilmentActionSection = `
      <div class="pickup-code-box">
        <div class="pickup-code-label">OFFICIAL STORE PICKUP CODE</div>
        <div class="pickup-code-value">${escapeHTML(order.pickupCode)}</div>
        <p class="pickup-code-instruction">
          Please present this Pickup Code and your Order Reference (<strong>${escapeHTML(order.orderReference)}</strong>) at the TNT Catering shop counter to collect your fresh pack.
        </p>
      </div>
    `;
  } else {
    fulfilmentActionSection = `
      <div class="pickup-pending-box" style="background: #FFF8E1; border: 1.5px dashed #F57F17; padding: 1rem; border-radius: 6px; text-align: center; margin-bottom: 1.25rem;">
        <div>
          <strong style="color: #E65100;">Pickup Code Awaiting Payment Verification</strong>
          <p style="font-size: 0.85rem; color: #666; margin: 0.25rem 0 0;">Official pickup codes are generated strictly after confirmed online payment verification.</p>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="receipt-container" style="max-width: 780px; margin: 0 auto;">
      
      <!-- Top Action Toolbar (Hidden in print) -->
      <div class="receipt-toolbar no-print">
        <div>
          <strong style="color: var(--color-maroon-900); font-size: 1.05rem; display: inline-flex; align-items: center; gap: 0.4rem;">
            <svg style="width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Official Customer Receipt
          </strong>
          <p style="font-size: 0.85rem; color: var(--color-text-muted); margin: 0.15rem 0 0;">
            ${isDelivery ? 'Official confirmation receipt for your doorstep delivery order.' : 'Present this receipt or your Store Pickup Code at the counter to collect your fresh festive pack.'}
          </p>
        </div>
        <div style="display: flex; gap: 0.75rem;">
          <button type="button" class="btn btn-primary btn-shimmer" onclick="window.print()" style="padding: 0.65rem 1.25rem;">
            <svg style="width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Print Receipt
          </button>
          <a href="products.html" class="btn btn-outline" style="padding: 0.65rem 1rem;">
            + Place Another Order
          </a>
        </div>
      </div>

      <!-- =================================================================== -->
      <!-- OFFICIAL CUSTOMER RECEIPT (வாடிக்கையாளர் ரசீது)                        -->
      <!-- =================================================================== -->
      <article class="receipt-page-card" id="receipt-page-customer">

        <!-- Brand Header with Official Logo -->
        <div class="receipt-brand-row">
          <div class="receipt-logo-block">
            <img src="assets/images/tnt-logo.jpg" alt="TNT Logo" class="receipt-brand-logo-img">
            <div>
              <h2 class="receipt-brand-name">${escapeHTML(APP_CONFIG.business.name)}</h2>
              <div class="receipt-brand-sub">${escapeHTML(APP_CONFIG.business.motto)} • ${escapeHTML(APP_CONFIG.business.tagline)}</div>
              <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.15rem;">
                Helpline: ${escapeHTML(APP_CONFIG.business.contacts.join(' / '))}
              </div>
            </div>
          </div>
          <div style="text-align: right;">
            <span class="receipt-copy-pill">CUSTOMER RECEIPT / வாடிக்கையாளர் ரசீது</span>
            <div style="margin-top: 0.4rem;">
              <span class="receipt-status-badge ${isVerifiedPaid ? 'badge-verified' : 'badge-pending'}">
                ${isVerifiedPaid ? '✓ PAYMENT VERIFIED' : 'PAYMENT PENDING'}
              </span>
            </div>
          </div>
        </div>

        <!-- Order & Customer Meta Table -->
        <table class="receipt-meta-table">
          <tbody>
            <tr>
              <td class="meta-label">Order Reference:</td>
              <td class="font-mono font-bold" style="color: var(--color-maroon-900); font-size: 1rem;">
                ${escapeHTML(order.orderReference)}
              </td>
              <td class="meta-label">Customer Name:</td>
              <td style="font-weight: 600;">${escapeHTML(order.customerName)}</td>
            </tr>
            <tr>
              <td class="meta-label">Fulfilment Type:</td>
              <td style="color: #78101C; font-weight: 700;">
                ${isDelivery ? 'Doorstep Delivery (via Porter / Partner)' : 'Shop Counter Collection (Free)'}
              </td>
              <td class="meta-label">Registered Mobile:</td>
              <td class="font-mono">${maskMobile(order.mobile)}</td>
            </tr>
            ${order.pickupDate ? `
            <tr>
              <td class="meta-label" style="background: #FFF8E1; color: #B78103;">${isDelivery ? 'Scheduled Delivery:' : 'Scheduled Pickup:'}</td>
              <td colspan="3" style="background: #FFFDE7; font-weight: 700; color: #78101C;">
                ${escapeHTML(order.pickupDate)} ${order.pickupTime ? `— Slot: ${escapeHTML(order.pickupTime)}` : ''}
              </td>
            </tr>
            ` : ''}
            ${isDelivery && deliveryAddrFormatted ? `
            <tr>
              <td class="meta-label" style="background: #FFF3E0; color: #E65100;">Delivery Address:</td>
              <td colspan="3" style="font-weight: 600; color: #5D4037;">
                ${escapeHTML(deliveryAddrFormatted)}
              </td>
            </tr>
            ` : ''}
          </tbody>
        </table>

        <!-- Fulfilment Action Box (Delivery Details or Pickup Code) -->
        ${fulfilmentActionSection}

        <!-- Itemized Order Table -->
        <h4 style="font-family: var(--font-heading); color: var(--color-maroon-900); font-size: 1.05rem; margin: 1rem 0 0.5rem; border-bottom: 1.5px solid var(--color-border); padding-bottom: 0.35rem;">
          Ordered Delicacies &amp; Festive Sweets
        </h4>
        <table class="receipt-checklist-table" style="margin-bottom: 0.75rem;">
          <thead>
            <tr>
              <th>Delicacy</th>
              <th style="text-align: center;">Quantity</th>
              <th style="text-align: right;">Unit Price</th>
              <th style="text-align: right;">Total Amount</th>
            </tr>
          </thead>
          <tbody>
            ${customerItemsHtml}
            ${isDelivery ? `
            <tr>
              <td style="padding: 0.5rem 0.6rem; border: 1px solid var(--color-border);">
                <strong>Doorstep Delivery Fee (Porter / Local Partner)</strong>
                <div style="font-size: 0.78rem; color: var(--color-text-muted);">Coimbatore City Doorstep Delivery</div>
              </td>
              <td style="padding: 0.5rem 0.6rem; border: 1px solid var(--color-border); text-align: center;">1 trip</td>
              <td style="padding: 0.5rem 0.6rem; border: 1px solid var(--color-border); text-align: right;">${formatINR(order.deliveryFee || 80)}</td>
              <td style="padding: 0.5rem 0.6rem; border: 1px solid var(--color-border); text-align: right; font-weight: 700;">${formatINR(order.deliveryFee || 80)}</td>
            </tr>
            ` : ''}
          </tbody>
        </table>

        <!-- Authoritative Total Row -->
        <div class="receipt-total-row">
          <span>Authoritative Total Paid (Online via Razorpay):</span>
          <span class="receipt-total-val">${formatINR(order.totalAmount)}</span>
        </div>

        <!-- Guidelines (Delivery vs Pickup) -->
        <div class="receipt-pickup-guidelines">
          ${isDelivery ? `
          <h4 style="display: flex; align-items: center; gap: 0.4rem;">
            <svg style="width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
            Doorstep Delivery Guidelines:
          </h4>
          <ul>
            <li><strong>Delivery Partner:</strong> We will book a verified delivery partner (Porter / 2-wheeler) to dispatch your order on the scheduled slot.</li>
            <li><strong>Delivery Coordination:</strong> Please ensure someone is available at the provided mobile number (${maskMobile(order.mobile)}) and address.</li>
            <li><strong>Helpline Assistance:</strong> For any delivery timing coordination, call ${escapeHTML(APP_CONFIG.business.primaryPhone)} / ${escapeHTML(APP_CONFIG.business.secondaryPhone)}.</li>
          </ul>
          ` : `
          <h4 style="display: flex; align-items: center; gap: 0.4rem;">
            <svg style="width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2"/></svg>
            Shop Counter Collection Guidelines:
          </h4>
          <ul>
            <li><strong>Location:</strong> ${escapeHTML(APP_CONFIG.business.pickupLocationNote)} — <a href="${APP_CONFIG.business.mapsUrl || 'https://www.google.com/maps/dir/?api=1&destination=Shree+TasteNTaste+Catering&destination_place_id=ChIJMVqvzSL2qDsRREVdON0DlTM'}" target="_blank" rel="noopener noreferrer" style="color: #78101C; text-decoration: underline; font-weight: 700; display: inline-flex; align-items: center; gap: 0.25rem;"><svg style="width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> Get Turn-by-Turn Directions</a></li>
            <li><strong>Handover Verification:</strong> Present the Official Store Pickup Code on your phone or hand this printed copy at the counter.</li>
            <li><strong>Contact:</strong> ${escapeHTML(APP_CONFIG.business.primaryPhone)} / ${escapeHTML(APP_CONFIG.business.secondaryPhone)} for timing coordination.</li>
          </ul>
          `}
        </div>

        <div style="text-align: center; font-size: 0.8rem; color: var(--color-text-muted); margin-top: 1rem; border-top: 1px solid var(--color-border); padding-top: 0.5rem;">
          Thank you for celebrating Diwali with Shree Taste N Taste Catering! Wishing you a sweet &amp; prosperous festive season.
        </div>
      </article>

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
