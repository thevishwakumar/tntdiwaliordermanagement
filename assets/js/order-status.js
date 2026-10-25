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
  // Kitchen checklist rows
  let kitchenItemsHtml = '';

  (order.items || []).forEach((item, idx) => {
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

    kitchenItemsHtml += `
      <tr>
        <td style="padding: 0.45rem 0.6rem; border: 1px solid var(--color-border); text-align: center; width: 40px;">
          <span style="font-size: 1.1rem; border: 1.5px solid #333; display: inline-block; width: 16px; height: 16px; border-radius: 2px;"></span>
        </td>
        <td style="padding: 0.45rem 0.6rem; border: 1px solid var(--color-border);">
          <strong>${escapeHTML(item.name)}</strong>
          ${item.tamil_name ? `<span style="font-size: 0.78rem; color: #555;"> (${escapeHTML(item.tamil_name)})</span>` : ''}
        </td>
        <td style="padding: 0.45rem 0.6rem; border: 1px solid var(--color-border); text-align: center; font-weight: 700;">
          ${item.quantity} ${item.unit}
        </td>
        <td style="padding: 0.45rem 0.6rem; border: 1px solid var(--color-border); text-align: center; font-size: 0.8rem; color: #444;">
          [  ] Packed &nbsp;&nbsp; [  ] Box Sealed
        </td>
      </tr>
    `;
  });

  // Pickup code display
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
      <div class="pickup-pending-box" style="background: #FFF8E1; border: 1.5px dashed #F57F17; padding: 1rem; border-radius: 6px; text-align: center; margin-bottom: 1.25rem;">
        <span class="status-icon" style="font-size: 1.5rem;">⏳</span>
        <div>
          <strong style="color: #E65100;">Pickup Code Awaiting Payment Verification</strong>
          <p style="font-size: 0.85rem; color: #666; margin: 0.25rem 0 0;">Official pickup codes are generated strictly after confirmed online payment verification.</p>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="receipt-container-2page">
      
      <!-- Top Action Toolbar (Hidden in print) -->
      <div class="receipt-toolbar no-print">
        <div>
          <strong style="color: var(--color-maroon-900); font-size: 1.05rem;">📄 Official 2-Page Receipt</strong>
          <p style="font-size: 0.85rem; color: var(--color-text-muted); margin: 0.15rem 0 0;">
            Page 1: Customer Copy (வாடிக்கையாளர் நகல்) • Page 2: Store &amp; Kitchen Copy (கடை &amp; சமையலறை நகல்)
          </p>
        </div>
        <div style="display: flex; gap: 0.75rem;">
          <button type="button" class="btn btn-primary" onclick="window.print()" style="padding: 0.65rem 1.25rem;">
            🖨️ Print 2-Page Official Receipt
          </button>
          <a href="products.html" class="btn btn-outline" style="padding: 0.65rem 1rem;">
            + Place Another Order
          </a>
        </div>
      </div>

      <!-- =================================================================== -->
      <!-- PAGE 1: CUSTOMER RECEIPT (வாடிக்கையாளர் நகல்)                         -->
      <!-- =================================================================== -->
      <article class="receipt-page-card receipt-page-1" id="receipt-page-customer">
        <span class="receipt-page-badge-corner">Page 1 of 2 • Customer Copy</span>

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
            <span class="receipt-copy-pill">CUSTOMER COPY / வாடிக்கையாளர் நகல்</span>
            <div style="margin-top: 0.4rem;">
              <span class="receipt-status-badge ${isVerifiedPaid ? 'badge-verified' : 'badge-pending'}">
                ${isVerifiedPaid ? '✓ PAYMENT VERIFIED' : '⏳ PAYMENT PENDING'}
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
                🏬 ${escapeHTML(APP_CONFIG.business.fulfilmentType)} (Shop Pickup Only)
              </td>
              <td class="meta-label">Registered Mobile:</td>
              <td class="font-mono">${maskMobile(order.mobile)}</td>
            </tr>
            ${order.pickupDate ? `
            <tr>
              <td class="meta-label" style="background: #FFF8E1; color: #B78103;">Scheduled Pickup:</td>
              <td colspan="3" style="background: #FFFDE7; font-weight: 700; color: #78101C;">
                📅 ${escapeHTML(order.pickupDate)} ${order.pickupTime ? `— Slot: ${escapeHTML(order.pickupTime)}` : ''}
              </td>
            </tr>
            ` : ''}
          </tbody>
        </table>

        <!-- Official Pickup Code Box -->
        ${pickupCodeSection}

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
          </tbody>
        </table>

        <!-- Authoritative Total Row -->
        <div class="receipt-total-row">
          <span>Authoritative Total Paid (Online via Razorpay):</span>
          <span class="receipt-total-val">${formatINR(order.totalAmount)}</span>
        </div>

        <!-- Counter Collection Guidelines -->
        <div class="receipt-pickup-guidelines">
          <h4>🏬 Shop Counter Collection Guidelines:</h4>
          <ul>
            <li><strong>Location:</strong> ${escapeHTML(APP_CONFIG.business.pickupLocationNote)} — <a href="${APP_CONFIG.business.mapsUrl || 'https://maps.app.goo.gl/X5LNqZjVxdGQFu398'}" target="_blank" rel="noopener noreferrer" style="color: #78101C; text-decoration: underline; font-weight: 700;">📍 Open in Google Maps</a></li>
            <li><strong>Handover Verification:</strong> Present the Official Store Pickup Code on your phone or hand this printed copy at the counter.</li>
            <li><strong>Contact:</strong> ${escapeHTML(APP_CONFIG.business.primaryPhone)} / ${escapeHTML(APP_CONFIG.business.secondaryPhone)} for timing coordination.</li>
          </ul>
        </div>
      </article>

      <!-- =================================================================== -->
      <!-- PAGE 2: STORE & KITCHEN COPY (கடை & சமையலறை ஆர்டர் நகல்)              -->
      <!-- =================================================================== -->
      <article class="receipt-page-card receipt-page-2" id="receipt-page-store">
        <span class="receipt-page-badge-corner">Page 2 of 2 • Store &amp; Kitchen Copy</span>

        <!-- Brand Header with Official Logo -->
        <div class="receipt-brand-row">
          <div class="receipt-logo-block">
            <img src="assets/images/tnt-logo.jpg" alt="TNT Logo" class="receipt-brand-logo-img">
            <div>
              <h2 class="receipt-brand-name">${escapeHTML(APP_CONFIG.business.name)}</h2>
              <div class="receipt-brand-sub">Store &amp; Kitchen Preparation / Counter Handover Record</div>
              <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.15rem;">
                Official Shop Record • Verify Pickup Code Before Release
              </div>
            </div>
          </div>
          <div style="text-align: right;">
            <span class="receipt-copy-pill" style="background: #1B5E20; color: #FFFFFF;">STORE &amp; KITCHEN COPY</span>
            <div style="margin-top: 0.4rem;">
              <span class="receipt-status-badge badge-verified">
                ✓ PAID IN FULL (RAZORPAY)
              </span>
            </div>
          </div>
        </div>

        <!-- Store Dispatch & Customer Meta Table -->
        <table class="receipt-meta-table">
          <tbody>
            <tr>
              <td class="meta-label">Order Reference:</td>
              <td class="font-mono font-bold" style="color: var(--color-maroon-900); font-size: 1rem;">
                ${escapeHTML(order.orderReference)}
              </td>
              <td class="meta-label">Customer Name:</td>
              <td style="font-weight: 700;">${escapeHTML(order.customerName)}</td>
            </tr>
            <tr>
              <td class="meta-label">Customer Phone:</td>
              <td class="font-mono font-bold">${escapeHTML(order.mobile)}</td>
              <td class="meta-label">Pickup Code:</td>
              <td class="font-mono font-bold" style="font-size: 1.1rem; color: #1B5E20;">
                ${escapeHTML(order.pickupCode || 'PENDING')}
              </td>
            </tr>
            <tr>
              <td class="meta-label" style="background: #FFF8E1; color: #B78103;">Scheduled Pickup:</td>
              <td colspan="3" style="background: #FFFDE7; font-weight: 800; color: #78101C; font-size: 0.95rem;">
                📅 ${escapeHTML(order.pickupDate || 'Advance Order')} ${order.pickupTime ? `— Slot: ${escapeHTML(order.pickupTime)}` : ''}
              </td>
            </tr>
            ${order.notes ? `
            <tr>
              <td class="meta-label" style="background: #F3E5F5;">Customer Note:</td>
              <td colspan="3" style="background: #FAF5FB; font-style: italic; color: #4A148C;">
                📝 ${escapeHTML(order.notes)}
              </td>
            </tr>
            ` : ''}
          </tbody>
        </table>

        <!-- Kitchen Packing Checklist -->
        <h4 style="font-family: var(--font-heading); color: var(--color-maroon-900); font-size: 1.05rem; margin: 1rem 0 0.5rem; border-bottom: 1.5px solid var(--color-border); padding-bottom: 0.35rem;">
          Kitchen Packaging &amp; Item Verification Checklist
        </h4>
        <table class="receipt-checklist-table" style="margin-bottom: 0.75rem;">
          <thead>
            <tr>
              <th style="width: 40px; text-align: center;">Check</th>
              <th>Delicacy Description</th>
              <th style="text-align: center;">Required Pack</th>
              <th style="text-align: center;">Packaging Verification</th>
            </tr>
          </thead>
          <tbody>
            ${kitchenItemsHtml}
          </tbody>
        </table>

        <!-- Total Summary Bar -->
        <div class="receipt-total-row" style="margin-bottom: 1.25rem;">
          <span>Order Settlement: Full Online Payment Received</span>
          <span class="receipt-total-val" style="color: #1B5E20;">${formatINR(order.totalAmount)}</span>
        </div>

        <!-- Staff Verification & Counter Handover Certificate Grid -->
        <div style="margin-top: 1rem;">
          <h5 style="font-size: 0.85rem; font-weight: 700; text-transform: uppercase; color: var(--color-maroon-900); margin-bottom: 0.5rem;">
            Shop Counter Handover &amp; Verification Certificate:
          </h5>
          <div class="receipt-sign-grid">
            <div class="receipt-sign-card">
              <strong>1. Kitchen Packaging:</strong>
              <div style="color: #666; font-size: 0.75rem; margin-top: 0.2rem;">Sweets weighed, packed &amp; sealed freshly.</div>
              <div class="receipt-sign-line"></div>
              <div>Packed By (Staff Name &amp; Sign)</div>
            </div>

            <div class="receipt-sign-card">
              <strong>2. Quality &amp; Seal Verification:</strong>
              <div style="color: #666; font-size: 0.75rem; margin-top: 0.2rem;">Box weight and sealing verified.</div>
              <div class="receipt-sign-line"></div>
              <div>Verified By (Supervisor Sign)</div>
            </div>

            <div class="receipt-sign-card">
              <strong>3. Store Counter Handover:</strong>
              <div style="color: #666; font-size: 0.75rem; margin-top: 0.2rem;">Pickup Code verified with customer.</div>
              <div class="receipt-sign-line"></div>
              <div>Handed Over By (Staff Sign)</div>
            </div>

            <div class="receipt-sign-card">
              <strong>4. Customer Handover Acknowledgment:</strong>
              <div style="color: #666; font-size: 0.75rem; margin-top: 0.2rem;">Received fresh pack in perfect condition.</div>
              <div class="receipt-sign-line"></div>
              <div>Customer Signature &amp; Pickup Time: ________________</div>
            </div>
          </div>
        </div>

        <div style="text-align: center; font-size: 0.78rem; color: #777; margin-top: 1rem; border-top: 1px solid var(--color-border); padding-top: 0.5rem;">
          Shree Taste N Taste Catering • Store Record • Retain signed copy for Diwali audit reconciliation.
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
