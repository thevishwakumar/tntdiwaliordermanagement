/**
 * TNT Diwali Order Management System
 * Checkout Experience Controller
 */

import { CartManager } from './cart.js';
import { APP_CONFIG, formatINR, formatQuantityUnit, isBackendLive } from './config.js';
import { validateCheckoutForm } from './validation.js';
import { OrderAPI } from './api.js';

let isSubmitting = false;

document.addEventListener('DOMContentLoaded', () => {
  initCheckout();
});

function initCheckout() {
  renderCartSummary();
  renderBackendStatusNotice();
  setupFormListeners();
  CartManager.initCartBadge();

  // Re-render when cart updates
  window.addEventListener('tnt:cart-updated', () => {
    renderCartSummary();
  });
}

/**
 * Render order items summary table
 */
function renderCartSummary() {
  const summaryContainer = document.getElementById('checkout-items-container');
  const totalsContainer = document.getElementById('checkout-totals');
  const emptyState = document.getElementById('checkout-empty-state');
  const formSection = document.getElementById('checkout-form-section');

  if (!summaryContainer) return;

  const { items, itemCount, subtotal } = CartManager.getTotals();

  if (itemCount === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    if (formSection) formSection.classList.add('hidden');
    if (summaryContainer) summaryContainer.innerHTML = '';
    if (totalsContainer) totalsContainer.innerHTML = '';
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');
  if (formSection) formSection.classList.remove('hidden');

  let html = '<div class="space-y-3">';
  items.forEach(item => {
    const itemTotal = item.price * item.quantity;
    html += `
      <div class="summary-item-card" data-product-id="${item.productId}">
        <div class="summary-item-details">
          <div class="summary-item-title-row">
            <h4 class="summary-item-title">${escapeHTML(item.name)}</h4>
            <span class="summary-item-badge">${escapeHTML(item.badge || '')}</span>
          </div>
          <p class="summary-item-tamil">${escapeHTML(item.tamilName || '')}</p>
          <p class="summary-item-unit-price">${formatINR(item.price)} per ${item.unit}</p>
        </div>

        <div class="summary-item-actions">
          <div class="qty-control" role="group" aria-label="Quantity Controls">
            <button type="button" class="btn-qty-minus" aria-label="Decrease quantity" data-id="${item.productId}">-</button>
            <span class="qty-display">${item.quantity} <span class="qty-unit-label">${item.unit}</span></span>
            <button type="button" class="btn-qty-plus" aria-label="Increase quantity" data-id="${item.productId}">+</button>
          </div>
          <div class="summary-item-price-col">
            <span class="summary-item-total">${formatINR(itemTotal)}</span>
            <button type="button" class="btn-remove-item" data-id="${item.productId}" title="Remove item">✕ Remove</button>
          </div>
        </div>
      </div>
    `;
  });
  html += '</div>';

  summaryContainer.innerHTML = html;

  if (totalsContainer) {
    totalsContainer.innerHTML = `
      <div class="totals-breakdown">
        <div class="totals-row">
          <span>Items Selected:</span>
          <span>${itemCount} ${itemCount === 1 ? 'variety' : 'varieties'}</span>
        </div>
        <div class="totals-row">
          <span>Fulfilment:</span>
          <span class="text-accent-gold font-semibold">Customer Store Pickup (Free)</span>
        </div>
        <div class="totals-row totals-grand">
          <span>Estimated Total:</span>
          <span class="grand-amount">${formatINR(subtotal)}</span>
        </div>
        <p class="totals-note">
          Final authoritative payable amount is verified server-side prior to online payment.
        </p>
      </div>
    `;
  }

  // Attach quantity adjustment buttons
  attachItemControlListeners();
}

/**
 * Quantity controls & remove buttons
 */
function attachItemControlListeners() {
  document.querySelectorAll('.btn-qty-minus').forEach(btn => {
    btn.onclick = (e) => {
      const id = e.currentTarget.dataset.id;
      const current = CartManager.getCart().find(i => i.productId === id);
      if (current) {
        CartManager.updateQuantity(id, current.quantity - 1);
      }
    };
  });

  document.querySelectorAll('.btn-qty-plus').forEach(btn => {
    btn.onclick = (e) => {
      const id = e.currentTarget.dataset.id;
      const current = CartManager.getCart().find(i => i.productId === id);
      if (current) {
        CartManager.updateQuantity(id, current.quantity + 1);
      }
    };
  });

  document.querySelectorAll('.btn-remove-item').forEach(btn => {
    btn.onclick = (e) => {
      const id = e.currentTarget.dataset.id;
      CartManager.removeItem(id);
    };
  });
}

/**
 * Display Stage 2 status message regarding backend readiness
 */
/**
 * Dynamically load Razorpay Checkout SDK
 */
function loadRazorpaySdk() {
  if (document.getElementById('razorpay-checkout-script')) return;
  const script = document.createElement('script');
  script.id = 'razorpay-checkout-script';
  script.src = 'https://checkout.razorpay.com/v1/checkout.js';
  script.async = true;
  document.head.appendChild(script);
}

/**
 * Display Stage 3 status message regarding live payment readiness
 */
function renderBackendStatusNotice() {
  const noticeContainer = document.getElementById('backend-readiness-notice');
  if (!noticeContainer) return;

  noticeContainer.innerHTML = `
    <div class="alert-box alert-success">
      <div class="alert-icon-wrap">
        <span class="alert-icon">💳</span>
      </div>
      <div class="alert-content">
        <strong class="alert-title">Secure Online Payment Gateway Active</strong>
        <p class="alert-desc">
          Powered by Razorpay. Orders are cryptographically verified server-side with HMAC SHA256 before issuing your official Store Pickup Code.
        </p>
      </div>
    </div>
  `;
}

/**
 * Setup checkout form submission & validation listeners
 */
function setupFormListeners() {
  const form = document.getElementById('tnt-checkout-form');
  if (!form) return;

  // Load Razorpay script
  loadRazorpaySdk();

  // Real-time input cleaning and error clearing
  ['fullName', 'mobile', 'email', 'notes', 'acceptTerms'].forEach(fieldName => {
    const input = document.getElementById(`input-${fieldName}`);
    if (input) {
      input.addEventListener('input', () => {
        clearFieldError(fieldName);
      });
      input.addEventListener('change', () => {
        clearFieldError(fieldName);
      });
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    // Gather form values
    const formData = {
      fullName: document.getElementById('input-fullName')?.value || '',
      mobile: document.getElementById('input-mobile')?.value || '',
      email: document.getElementById('input-email')?.value || '',
      notes: document.getElementById('input-notes')?.value || '',
      acceptTerms: document.getElementById('input-acceptTerms')?.checked || false
    };

    const cart = CartManager.getCart();

    // Comprehensive client validation
    const validation = validateCheckoutForm(formData, cart);

    if (!validation.isValid) {
      displayValidationErrors(validation.errors);
      return;
    }

    // Set submitting state (prevents duplicate submission)
    setSubmittingState(true);

    const payload = {
      customer: validation.cleanData,
      items: cart.map(i => ({
        productId: i.productId,
        quantity: i.quantity,
        unit: i.unit,
        clientPrice: i.price
      })),
      fulfilment: APP_CONFIG.business.fulfilmentType,
      createdAt: new Date().toISOString()
    };

    // Attempt order creation via OrderAPI
    try {
      const response = await OrderAPI.createOrder(payload);

      if (!response.success) {
        showCheckoutFeedback('error', response.message);
        setSubmittingState(false);
        return;
      }

      // If Razorpay order and key are present, trigger Razorpay modal
      if (response.razorpayOrderId && response.razorpayKeyId && window.Razorpay) {
        const options = {
          key: response.razorpayKeyId,
          amount: response.totalPaise,
          currency: 'INR',
          name: APP_CONFIG.business.name,
          description: `Diwali Sweets Pre-Order: ${response.publicOrderNumber}`,
          image: 'assets/images/tnt-logo.jpg',
          order_id: response.razorpayOrderId,
          prefill: {
            name: validation.cleanData.fullName,
            contact: validation.cleanData.mobile,
            email: validation.cleanData.email
          },
          theme: {
            color: '#78101C'
          },
          handler: async function (paymentResponse) {
            setSubmittingState(true);
            showCheckoutFeedback('info', 'Verifying payment signature with secure server...');

            const verificationPayload = {
              orderId: response.orderId,
              razorpayPaymentId: paymentResponse.razorpay_payment_id,
              razorpayOrderId: paymentResponse.razorpay_order_id,
              razorpaySignature: paymentResponse.razorpay_signature
            };

            const verifyResult = await OrderAPI.verifyPayment(verificationPayload);

            if (verifyResult.verified) {
              CartManager.clearCart();
              window.location.href = `order-status.html?ref=${encodeURIComponent(response.publicOrderNumber)}&mobile=${encodeURIComponent(validation.cleanData.mobile)}&verified=1`;
            } else {
              showCheckoutFeedback('error', verifyResult.message || 'Payment signature could not be verified.');
              setSubmittingState(false);
            }
          },
          modal: {
            ondismiss: function () {
              setSubmittingState(false);
              showCheckoutFeedback('info', 'Online payment was closed or cancelled. Your order remains pending and you can retry at any time.');
            }
          }
        };

        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', function (failResp) {
          console.error('Payment failed:', failResp);
          showCheckoutFeedback('error', `Payment failed: ${failResp.error.description || 'Transaction unsuccessful'}`);
          setSubmittingState(false);
        });

        rzp.open();
        return;
      }

      // Fallback if Razorpay modal script is not yet initialized:
      const ref = response.publicOrderNumber;
      const totalFormatted = formatINR(response.totalRupees);

      showCheckoutFeedback('success', 
        `Order ${ref} created successfully on server. Authoritative total: ${totalFormatted}. Status: ${response.orderStatus}.`
      );

      CartManager.clearCart();
      setSubmittingState(false);

    } catch (err) {
      console.error('Checkout error:', err);
      showCheckoutFeedback('error', 'An unexpected error occurred while communicating with the payment gateway. Please try again.');
      setSubmittingState(false);
    }
  });
}

function displayValidationErrors(errors) {
  let firstEl = null;

  for (const [field, message] of Object.entries(errors)) {
    const errorEl = document.getElementById(`error-${field}`);
    const inputEl = document.getElementById(`input-${field}`);

    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
    }
    if (inputEl) {
      inputEl.classList.add('input-invalid');
      if (!firstEl) firstEl = inputEl;
    }
  }

  if (firstEl) {
    firstEl.focus();
    firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function clearFieldError(fieldName) {
  const errorEl = document.getElementById(`error-${fieldName}`);
  const inputEl = document.getElementById(`input-${fieldName}`);
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
  }
  if (inputEl) {
    inputEl.classList.remove('input-invalid');
  }
}

function setSubmittingState(submitting) {
  isSubmitting = submitting;
  const submitBtn = document.getElementById('btn-submit-order');
  const spinner = document.getElementById('checkout-spinner');
  const btnText = document.getElementById('btn-submit-text');

  if (submitBtn) {
    submitBtn.disabled = submitting;
    if (submitting) {
      submitBtn.classList.add('btn-loading');
      if (spinner) spinner.classList.remove('hidden');
      if (btnText) btnText.textContent = 'Validating Order...';
    } else {
      submitBtn.classList.remove('btn-loading');
      if (spinner) spinner.classList.add('hidden');
      if (btnText) btnText.textContent = 'Proceed to Online Payment (Razorpay)';
    }
  }
}

function showCheckoutFeedback(type, message) {
  const feedbackBox = document.getElementById('checkout-feedback-modal');
  if (!feedbackBox) {
    alert(message);
    return;
  }

  feedbackBox.className = `feedback-banner feedback-${type}`;
  feedbackBox.innerHTML = `
    <div class="feedback-inner">
      <span class="feedback-icon">${type === 'error' ? '⚠️' : 'ℹ️'}</span>
      <div class="feedback-body">
        <strong>${type === 'error' ? 'Order Submission Notice' : 'Notice'}</strong>
        <p>${escapeHTML(message)}</p>
      </div>
      <button type="button" class="btn-close-feedback" onclick="this.closest('#checkout-feedback-modal').classList.add('hidden')">✕</button>
    </div>
  `;
  feedbackBox.classList.remove('hidden');
  feedbackBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
