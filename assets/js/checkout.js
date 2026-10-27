/**
 * TNT Diwali Order Management System
 * QR-First Checkout Experience Controller
 * 
 * Features:
 * 1. Default & Primary: Razorpay dynamic UPI QR Code ("Scan & Pay").
 * 2. Accessible Alternative Methods: UPI Apps (GPay, PhonePe, Paytm), Debit/Credit Cards, Netbanking.
 * 3. Real-time background status polling to detect mobile QR scan completion automatically.
 * 4. Authoritative server pricing & cryptographic HMAC-SHA256 signature verification.
 * 5. Customer pickup only (no home delivery, no Cash on Delivery).
 */

import { CartManager } from './cart.js';
import { APP_CONFIG, formatINR, formatQuantityUnit } from './config.js';
import { validateCheckoutForm } from './validation.js';
import { OrderAPI } from './api.js';

let isSubmitting = false;
let activePaymentSession = null;
let statusPollingInterval = null;
let sessionCountdownInterval = null;
let selectedFulfilmentMethod = 'PICKUP';

document.addEventListener('DOMContentLoaded', () => {
  initCheckout();
});

function initCheckout() {
  loadRazorpaySdk();
  setupFulfilmentSelector();
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
 * Setup Fulfilment Method Selector (Store Pickup vs Doorstep Delivery via Porter)
 */
function setupFulfilmentSelector() {
  const pickupCard = document.getElementById('opt-fulfilment-pickup');
  const deliveryCard = document.getElementById('opt-fulfilment-delivery');
  const radioPickup = document.getElementById('radio-pickup');
  const radioDelivery = document.getElementById('radio-delivery');
  const addressSection = document.getElementById('delivery-address-section');
  const pickupLocationCard = document.getElementById('pickup-location-card');
  const labelDate = document.getElementById('label-date');
  const labelTime = document.getElementById('label-time');

  function setFulfilment(method) {
    selectedFulfilmentMethod = method;
    if (method === 'DELIVERY') {
      pickupCard?.classList.remove('selected');
      pickupCard?.setAttribute('aria-checked', 'false');
      deliveryCard?.classList.add('selected');
      deliveryCard?.setAttribute('aria-checked', 'true');
      if (radioDelivery) radioDelivery.checked = true;
      if (addressSection) addressSection.classList.remove('hidden');
      if (pickupLocationCard) pickupLocationCard.classList.add('hidden');
      if (labelDate) labelDate.innerHTML = 'Preferred Delivery Date <span class="required-star">*</span>';
      if (labelTime) labelTime.innerHTML = 'Preferred Delivery Slot <span class="required-star">*</span>';
    } else {
      deliveryCard?.classList.remove('selected');
      deliveryCard?.setAttribute('aria-checked', 'false');
      pickupCard?.classList.add('selected');
      pickupCard?.setAttribute('aria-checked', 'true');
      if (radioPickup) radioPickup.checked = true;
      if (addressSection) addressSection.classList.add('hidden');
      if (pickupLocationCard) pickupLocationCard.classList.remove('hidden');
      if (labelDate) labelDate.innerHTML = 'Scheduled Pickup Date <span class="required-star">*</span>';
      if (labelTime) labelTime.innerHTML = 'Preferred Pickup Slot <span class="required-star">*</span>';
    }
    renderCartSummary();
  }

  pickupCard?.addEventListener('click', () => setFulfilment('PICKUP'));
  deliveryCard?.addEventListener('click', () => setFulfilment('DELIVERY'));
  radioPickup?.addEventListener('change', () => setFulfilment('PICKUP'));
  radioDelivery?.addEventListener('change', () => setFulfilment('DELIVERY'));
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

  const isDelivery = selectedFulfilmentMethod === 'DELIVERY';
  const deliveryFee = isDelivery ? (APP_CONFIG.business.estimatedDeliveryFeeINR || 80) : 0;
  const grandTotal = subtotal + deliveryFee;

  if (totalsContainer) {
    totalsContainer.innerHTML = `
      <div class="totals-breakdown">
        <div class="totals-row">
          <span>Items Selected:</span>
          <span>${itemCount} ${itemCount === 1 ? 'variety' : 'varieties'}</span>
        </div>
        <div class="totals-row">
          <span>Items Subtotal:</span>
          <span>${formatINR(subtotal)}</span>
        </div>
        <div class="totals-row">
          <span>Fulfilment:</span>
          <span class="text-accent-gold font-semibold">${isDelivery ? 'Doorstep Delivery (Porter Est.)' : 'Customer Store Pickup (Free)'}</span>
        </div>
        ${isDelivery ? `
        <div class="totals-row">
          <span>Estimated Delivery Fee:</span>
          <span class="font-semibold" style="color: #E65100;">+${formatINR(deliveryFee)}</span>
        </div>
        ` : ''}
        <div class="totals-row totals-grand">
          <span>Estimated Total:</span>
          <span class="grand-amount">${formatINR(grandTotal)}</span>
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
 * Display secure online payment notice
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

  // Set pickup date default & minimum
  const pickupDateInput = document.getElementById('input-pickupDate');
  if (pickupDateInput) {
    const today = new Date().toISOString().split('T')[0];
    pickupDateInput.min = today;
    if (!pickupDateInput.value) {
      pickupDateInput.value = today;
    }
  }

  // Real-time input cleaning and error clearing
  ['fullName', 'mobile', 'email', 'notes', 'pickupDate', 'acceptTerms', 'deliveryStreet', 'deliveryArea', 'deliveryCity', 'deliveryPincode', 'deliveryLandmark'].forEach(fieldName => {
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
      fulfilmentMethod: selectedFulfilmentMethod,
      fullName: document.getElementById('input-fullName')?.value || '',
      mobile: document.getElementById('input-mobile')?.value || '',
      email: document.getElementById('input-email')?.value || '',
      notes: document.getElementById('input-notes')?.value || '',
      pickupDate: document.getElementById('input-pickupDate')?.value || '',
      pickupTime: document.getElementById('input-pickupTime')?.value || '',
      deliveryStreet: document.getElementById('input-deliveryStreet')?.value || '',
      deliveryArea: document.getElementById('input-deliveryArea')?.value || '',
      deliveryCity: document.getElementById('input-deliveryCity')?.value || '',
      deliveryPincode: document.getElementById('input-deliveryPincode')?.value || '',
      deliveryLandmark: document.getElementById('input-deliveryLandmark')?.value || '',
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

    const isDelivery = validation.cleanData.fulfilmentMethod === 'DELIVERY';
    const deliveryFeePaise = isDelivery ? (APP_CONFIG.business.estimatedDeliveryFeePaise || 8000) : 0;

    const payload = {
      customer: validation.cleanData,
      fulfilmentMethod: validation.cleanData.fulfilmentMethod,
      deliveryAddress: validation.cleanData.deliveryAddress,
      deliveryFeePaise: deliveryFeePaise,
      pickupDate: validation.cleanData.pickupDate,
      pickupTime: validation.cleanData.pickupTime,
      items: cart.map(i => ({
        productId: i.productId,
        quantity: i.quantity,
        unit: i.unit,
        clientPrice: i.price
      })),
      fulfilment: validation.cleanData.fulfilmentMethod,
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

      const rzpOrderId = response.razorpayOrderId || response.razorpay_order_id;
      const rzpKeyId = response.razorpayKeyId || response.razorpay_key_id || APP_CONFIG.backend?.razorpayKeyId;

      if (!rzpOrderId) {
        showCheckoutFeedback('error', 'Payment gateway order could not be generated. Please retry or contact support at 9442854444.');
        setSubmittingState(false);
        return;
      }

      // Initialize active payment session
      activePaymentSession = {
        orderId: response.orderId,
        publicOrderNumber: response.publicOrderNumber,
        totalPaise: response.totalPaise,
        totalAmount: response.totalAmount || (response.totalPaise / 100),
        customerMobile: validation.cleanData.mobile,
        customerName: validation.cleanData.fullName,
        customerEmail: validation.cleanData.email,
        razorpayOrderId: rzpOrderId,
        razorpayKeyId: rzpKeyId,
        expiresAt: Date.now() + 10 * 60 * 1000 // 10-minute session validity
      };

      // Show Scan & Pay QR-First Session Modal
      showQrPaymentModal(activePaymentSession);

      // Immediately launch Razorpay QR Checkout by default
      openRazorpayCheckout('qr');

    } catch (err) {
      console.error('Checkout error:', err);
      showCheckoutFeedback('error', 'An unexpected error occurred while communicating with the payment gateway. Please try again.');
      setSubmittingState(false);
    }
  });
}

/**
 * Display the QR-First "Scan & Pay" Session Modal Overlay
 */
function showQrPaymentModal(session) {
  // Remove existing modal if any
  const existing = document.getElementById('qr-payment-modal');
  if (existing) existing.remove();

  const formattedAmount = formatINR(session.totalAmount);

  const modalHtml = `
    <div id="qr-payment-modal" class="qr-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="qr-heading">
      <div class="qr-modal-card">
        <!-- Header -->
        <div class="qr-modal-header">
          <h3 class="qr-modal-title" id="qr-heading">
            <svg style="width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            Scan &amp; Pay (UPI QR)
          </h3>
          <button type="button" class="qr-modal-close-btn" id="btn-qr-modal-close" aria-label="Close Payment Modal" title="Close">&times;</button>
        </div>

        <!-- Body -->
        <div class="qr-modal-body">
          <!-- Amount Payable Display -->
          <div class="qr-amount-display">
            <div class="qr-amount-label">Exact Amount Payable</div>
            <div class="qr-amount-value" id="qr-modal-amount">${formattedAmount}</div>
            <div style="margin-top: 0.35rem;">
              <span class="qr-ref-pill">Order Ref: <strong>${escapeHTML(session.publicOrderNumber)}</strong></span>
            </div>
          </div>

          <!-- QR Instruction Banner -->
          <div class="qr-scan-badge-banner">
            <svg style="width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 2; flex-shrink: 0;" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            <span>Scan using Google Pay, PhonePe, Paytm, BHIM, or any UPI App</span>
          </div>

          <!-- Live Payment Status -->
          <div class="qr-status-pulse" id="qr-status-container">
            <div class="qr-pulse-dot"></div>
            <span id="qr-status-text">Awaiting payment confirmation...</span>
          </div>

          <!-- Primary Actions (QR Default, Other Methods Below) -->
          <div class="qr-modal-actions">
            <!-- 1. Primary QR Button -->
            <button type="button" class="qr-btn-primary btn-shimmer" id="btn-open-qr-flow">
              <svg style="width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              <span>Open Scan &amp; Pay (UPI QR Code)</span>
            </button>

            <!-- 2. Alternative Payment Methods -->
            <button type="button" class="qr-btn-secondary" id="btn-open-other-methods">
              <svg style="width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
              <span>Other Payment Methods (UPI Apps, Cards, Netbanking)</span>
            </button>

            <!-- 3. Safe Cancel Option -->
            <button type="button" class="btn-cancel-checkout" id="btn-cancel-session" style="background: transparent; border: none; color: var(--color-text-muted); font-size: 0.82rem; cursor: pointer; text-decoration: underline; margin-top: 0.25rem;">
              Cancel Payment &amp; Edit Order
            </button>
          </div>

          <!-- Expiry Timer Countdown -->
          <div class="qr-timer-text" id="qr-timer-countdown">
            ⏳ Payment session active • Valid for 10:00 minutes
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  // Attach event handlers
  document.getElementById('btn-open-qr-flow')?.addEventListener('click', () => {
    openRazorpayCheckout('qr');
  });

  document.getElementById('btn-open-other-methods')?.addEventListener('click', () => {
    openRazorpayCheckout('other');
  });

  document.getElementById('btn-qr-modal-close')?.addEventListener('click', () => {
    handlePaymentWindowPaused();
  });

  document.getElementById('btn-cancel-session')?.addEventListener('click', () => {
    cancelPaymentSession();
  });

  // Start background status polling & session countdown
  startPaymentStatusPolling(session.publicOrderNumber, session.customerMobile);
  startSessionTimer(session.expiresAt);
}

/**
 * Open Razorpay Standard Checkout with custom display blocks
 * @param {'qr' | 'other'} flow - 'qr' displays QR Code first; 'other' displays UPI apps & cards first.
 */
async function openRazorpayCheckout(flow = 'qr') {
  if (!activePaymentSession) return;

  // Ensure Razorpay SDK is loaded
  if (!window.Razorpay) {
    await new Promise((resolve) => {
      if (window.Razorpay) return resolve(true);
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
      setTimeout(() => resolve(Boolean(window.Razorpay)), 3000);
    });
  }

  if (!window.Razorpay) {
    showCheckoutFeedback('error', 'Unable to load payment gateway. Please check your internet connection or ad-blocker.');
    return;
  }

  const session = activePaymentSession;

  // Block definitions conforming to Razorpay Custom Checkout guidelines
  const blocks = {
    qr_code: {
      name: "Scan & Pay (UPI QR Code)",
      instruments: [
        {
          method: "upi",
          flows: ["qr"]
        }
      ]
    },
    upi_apps: {
      name: "UPI Apps (Google Pay, PhonePe, Paytm)",
      instruments: [
        {
          method: "upi",
          flows: ["intent", "collect"]
        }
      ]
    },
    cards: {
      name: "Debit & Credit Cards",
      instruments: [
        {
          method: "card"
        }
      ]
    },
    other: {
      name: "Other Payment Methods (Netbanking & Wallets)",
      instruments: [
        {
          method: "netbanking"
        },
        {
          method: "wallet"
        }
      ]
    }
  };

  // Sequence: Default is QR Code first; 'other' shows alternative methods first
  const sequence = (flow === 'other')
    ? ["block.upi_apps", "block.cards", "block.other", "block.qr_code"]
    : ["block.qr_code", "block.upi_apps", "block.cards", "block.other"];

  const options = {
    key: session.razorpayKeyId,
    amount: session.totalPaise,
    currency: 'INR',
    name: APP_CONFIG.business.name,
    description: `Diwali Pre-Order: ${session.publicOrderNumber}`,
    image: 'assets/images/tnt-logo.jpg',
    order_id: session.razorpayOrderId,
    prefill: {
      name: session.customerName,
      contact: session.customerMobile,
      email: session.customerEmail
    },
    theme: {
      color: '#78101C'
    },
    config: {
      display: {
        blocks: blocks,
        sequence: sequence,
        preferences: {
          show_default_blocks: false
        }
      }
    },
    handler: async function (paymentResponse) {
      updatePaymentStatusText('Verifying digital signature with secure backend...');

      const verificationPayload = {
        orderId: session.orderId,
        razorpayPaymentId: paymentResponse.razorpay_payment_id,
        razorpayOrderId: paymentResponse.razorpay_order_id,
        razorpaySignature: paymentResponse.razorpay_signature
      };

      try {
        const verifyResult = await OrderAPI.verifyPayment(verificationPayload);

        if (verifyResult.verified) {
          cleanUpTimersAndModal();
          CartManager.clearCart();
          window.location.href = `order-status.html?ref=${encodeURIComponent(session.publicOrderNumber)}&mobile=${encodeURIComponent(session.customerMobile)}&verified=1`;
        } else {
          updatePaymentStatusText('Signature verification failed: ' + (verifyResult.message || 'Invalid signature'));
          showCheckoutFeedback('error', verifyResult.message || 'Payment signature could not be verified.');
        }
      } catch (verErr) {
        console.error('Verification error:', verErr);
        updatePaymentStatusText('Verification error. Checking order status...');
      }
    },
    modal: {
      ondismiss: function () {
        handlePaymentWindowPaused();
      }
    }
  };

  try {
    const rzp = new window.Razorpay(options);
    rzp.on('payment.failed', function (failResp) {
      console.warn('Razorpay payment attempt failed:', failResp);
      updatePaymentStatusText(`Payment failed: ${failResp.error?.description || 'Transaction unsuccessful'}. You can retry anytime.`);
    });
    rzp.open();
  } catch (err) {
    console.error('Failed to open Razorpay checkout:', err);
    updatePaymentStatusText('Failed to initialize payment window. Please click "Open Scan & Pay" to retry.');
  }
}

/**
 * Handle user closing the Razorpay overlay (without cancelling order)
 */
function handlePaymentWindowPaused() {
  updatePaymentStatusText('Payment window paused. Click "Open Scan & Pay" to resume or choose "Other Payment Methods".');
}

/**
 * Safely cancel payment session and restore checkout form
 */
function cancelPaymentSession() {
  cleanUpTimersAndModal();
  activePaymentSession = null;
  setSubmittingState(false);
  showCheckoutFeedback('info', 'Payment session cancelled. You can adjust your items or details and retry anytime.');
}

/**
 * Start real-time background status polling
 * Detects payments made via mobile QR scan or webhooks automatically
 */
function startPaymentStatusPolling(orderRef, mobile) {
  if (statusPollingInterval) clearInterval(statusPollingInterval);

  statusPollingInterval = setInterval(async () => {
    if (!activePaymentSession) {
      clearInterval(statusPollingInterval);
      return;
    }

    try {
      const res = await OrderAPI.lookupOrder(orderRef, mobile);
      if (res.success && res.order && res.order.paymentStatus === 'PAID_VERIFIED') {
        // Payment verified! Redirect immediately
        clearInterval(statusPollingInterval);
        cleanUpTimersAndModal();
        CartManager.clearCart();
        window.location.href = `order-status.html?ref=${encodeURIComponent(orderRef)}&mobile=${encodeURIComponent(mobile)}&verified=1`;
      }
    } catch (e) {
      // Silently ignore polling hiccups
    }
  }, 2500);
}

/**
 * Start 10-minute session countdown timer
 */
function startSessionTimer(expiresAt) {
  if (sessionCountdownInterval) clearInterval(sessionCountdownInterval);

  const countdownEl = document.getElementById('qr-timer-countdown');

  sessionCountdownInterval = setInterval(() => {
    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) {
      clearInterval(sessionCountdownInterval);
      if (statusPollingInterval) clearInterval(statusPollingInterval);

      if (countdownEl) {
        countdownEl.innerHTML = `<span style="color: #C62828; font-weight: 700;">⚠️ Payment session has expired.</span>`;
      }
      updatePaymentStatusText('Payment session expired. Please start a fresh attempt.');

      // Update primary button to retry
      const btnPrimary = document.getElementById('btn-open-qr-flow');
      if (btnPrimary) {
        btnPrimary.innerHTML = `<span>🔄</span><span>Create Fresh Payment Attempt</span>`;
        btnPrimary.onclick = () => {
          cleanUpTimersAndModal();
          activePaymentSession = null;
          setSubmittingState(false);
          document.getElementById('btn-submit-order')?.click();
        };
      }
      return;
    }

    const totalSeconds = Math.floor(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    if (countdownEl) {
      countdownEl.textContent = `⏳ Payment session active • Valid for ${formattedTime} minutes`;
    }
  }, 1000);
}

function updatePaymentStatusText(text) {
  const statusEl = document.getElementById('qr-status-text');
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function cleanUpTimersAndModal() {
  if (statusPollingInterval) {
    clearInterval(statusPollingInterval);
    statusPollingInterval = null;
  }
  if (sessionCountdownInterval) {
    clearInterval(sessionCountdownInterval);
    sessionCountdownInterval = null;
  }
  const modal = document.getElementById('qr-payment-modal');
  if (modal) modal.remove();
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
      if (btnText) btnText.textContent = 'Generating Razorpay QR...';
    } else {
      submitBtn.classList.remove('btn-loading');
      if (spinner) spinner.classList.add('hidden');
      if (btnText) btnText.innerHTML = '<svg style="width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: 2; display: inline-block; vertical-align: middle; margin-right: 0.4rem;" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>Proceed to Scan &amp; Pay (UPI QR Code)';
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
      <span class="feedback-icon" style="display: inline-flex; align-items: center;">
        <svg style="width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </span>
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
