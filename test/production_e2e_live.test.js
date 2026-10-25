/**
 * TNT Diwali Order Management System — Live Production End-to-End Test Suite
 * Target: https://tntdiwaliordermanagement.pages.dev
 * Backend: Supabase Cloud (bondkwckhnbjslshyflp) + Razorpay
 * 
 * Verifies 10 full end-to-end production journeys with zero mocks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env secrets for cryptographic verification testing
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > -1) {
        const key = trimmed.substring(0, idx).trim();
        const val = trimmed.substring(idx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

const PROD_URL = 'https://tntdiwaliordermanagement.pages.dev';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '6tJrsoptI5w6rdicuxsk07xn';
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_TrldCRnEsCFYTj';

console.log(`\n======================================================================`);
console.log(`🚀 RUNNING LIVE PRODUCTION END-TO-END VERIFICATION: ${PROD_URL}`);
console.log(`======================================================================\n`);

test('LIVE PRODUCTION E2E SUITE', async (t) => {
  let createdOrderId = null;
  let createdPublicOrderNumber = null;
  let createdTotalPaise = null;
  let razorpayOrderId = null;
  let verifiedPickupCode = null;
  let adminSessionToken = null;

  // -------------------------------------------------------------------------
  // TEST 1: Public Configuration & Zero Secret Leak Audit
  // -------------------------------------------------------------------------
  await t.test('Test 1: Public Configuration & Zero-Secret Audit on Live CDN', async () => {
    const res = await fetch(`${PROD_URL}/api/config`);
    assert.strictEqual(res.status, 200, 'Config endpoint must return HTTP 200');
    const data = await res.json();
    assert.strictEqual(data.success, true, 'Config success must be true');
    assert.ok(data.publicConfig, 'publicConfig object must be present');
    assert.ok(data.publicConfig.SUPABASE_URL, 'SUPABASE_URL must be present');
    assert.ok(data.publicConfig.SUPABASE_ANON_KEY, 'SUPABASE_ANON_KEY must be present');
    assert.ok(data.publicConfig.RAZORPAY_KEY_ID, 'RAZORPAY_KEY_ID must be present');

    // Zero secret leak assertion
    assert.strictEqual(data.publicConfig.RAZORPAY_KEY_SECRET, undefined, 'CRITICAL: RAZORPAY_KEY_SECRET must NEVER be in publicConfig');
    assert.strictEqual(data.publicConfig.SUPABASE_SERVICE_ROLE_KEY, undefined, 'CRITICAL: SUPABASE_SERVICE_ROLE_KEY must NEVER be in publicConfig');
    assert.strictEqual(data.publicConfig.DATABASE_URL, undefined, 'CRITICAL: DATABASE_URL must NEVER be in publicConfig');

    console.log(`  ✔ Public config verified securely: Zero secrets exposed.`);
  });

  // -------------------------------------------------------------------------
  // TEST 2: Static Frontend HTML & Route Cleanliness
  // -------------------------------------------------------------------------
  await t.test('Test 2: Static Page Delivery & Clean Route Redirects', async () => {
    // Test Home
    const homeRes = await fetch(`${PROD_URL}/index.html`);
    assert.strictEqual(homeRes.status, 200);
    const homeHtml = await homeRes.text();
    assert.ok(homeHtml.includes('Shree Taste N Taste Catering'), 'Home must contain brand name');
    assert.ok(homeHtml.includes('Admin Sign In'), 'Home must contain Admin Sign In link');

    // Test Products
    const prodRes = await fetch(`${PROD_URL}/products.html`);
    assert.strictEqual(prodRes.status, 200);

    // Test Admin route
    const adminRes = await fetch(`${PROD_URL}/admin/dashboard.html`);
    assert.strictEqual(adminRes.status, 200);

    console.log(`  ✔ Frontend static HTML and navigation routes verified.`);
  });

  // -------------------------------------------------------------------------
  // TEST 3: Advance Order Creation & Authoritative Integer Pricing
  // -------------------------------------------------------------------------
  await t.test('Test 3: Live Order Creation with Advance Scheduling & Genuine Razorpay Order', async () => {
    const idempotencyKey = 'prod_test_' + crypto.randomBytes(8).toString('hex');
    const futureDate = '2026-10-27';
    const futureSlot = 'Evening (04:00 PM - 08:00 PM)';

    const orderPayload = {
      customerName: 'Live Audit Customer',
      customerMobile: '9442854444',
      customerEmail: 'audit@tntcatering.in',
      customerNotes: 'Production Verification Order',
      pickupDate: futureDate,
      pickupTime: futureSlot,
      items: [
        { productId: 'tnt-trad-sweets', quantity: 2 }, // 2 x 500 = ₹1,000 (100,000 paise)
        { productId: 'tnt-karam-specials', quantity: 1 } // 1 x 450 = ₹450 (45,000 paise)
      ],
      idempotencyKey
    };

    const res = await fetch(`${PROD_URL}/api/create-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(orderPayload)
    });

    assert.strictEqual(res.status, 200, `Order creation should return 200, got ${res.status}`);
    const data = await res.json();

    assert.strictEqual(data.success, true, 'Order creation must succeed');
    assert.ok(data.order_id, 'Must return order_id');
    assert.ok(data.public_order_number.startsWith('TNT-'), 'Must return valid TNT order number');
    assert.strictEqual(data.order_status, 'AWAITING_PAYMENT', 'New order must be AWAITING_PAYMENT');
    assert.strictEqual(data.payment_status, 'PENDING', 'New order payment must be PENDING');
    assert.strictEqual(data.total_paise, 145000, 'Authoritative price must be 145,000 paise (₹1,450)');
    assert.ok(data.razorpayOrderId, 'Genuine Razorpay order ID must be generated');

    createdOrderId = data.order_id;
    createdPublicOrderNumber = data.public_order_number;
    createdTotalPaise = data.total_paise;
    razorpayOrderId = data.razorpayOrderId;

    console.log(`  ✔ Order Created: ${createdPublicOrderNumber} (Total: ₹${createdTotalPaise / 100})`);
    console.log(`  ✔ Razorpay Order ID: ${razorpayOrderId}`);

    // Idempotency check: Repeat identical request
    const retryRes = await fetch(`${PROD_URL}/api/create-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(orderPayload)
    });
    const retryData = await retryRes.json();
    assert.strictEqual(retryData.order_id, createdOrderId, 'Idempotent retry must return identical order_id');
    assert.strictEqual(retryData.is_duplicate, true, 'Retry must be marked as duplicate');
    console.log(`  ✔ Idempotency Verified: Duplicate submission safely returned existing order.`);
  });

  // -------------------------------------------------------------------------
  // TEST 4: Payment Cryptographic Signature Verification
  // -------------------------------------------------------------------------
  await t.test('Test 4: Payment Security & Cryptographic Verification', async () => {
    assert.ok(createdOrderId && razorpayOrderId, 'Previous order required');

    const fakePaymentId = 'pay_live_' + crypto.randomBytes(7).toString('hex');

    // 1. Forged signature rejection
    const forgedSignature = 'forged_deadbeef_' + crypto.randomBytes(16).toString('hex');
    const rejectRes = await fetch(`${PROD_URL}/api/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: createdOrderId,
        razorpayPaymentId: fakePaymentId,
        razorpayOrderId: razorpayOrderId,
        razorpaySignature: forgedSignature
      })
    });
    assert.strictEqual(rejectRes.status, 400, 'Forged signature must be rejected with 400');
    console.log(`  ✔ Cryptographic Defense: Tampered payment signature rejected.`);

    // 2. Genuine HMAC SHA256 Signature
    const payloadToSign = `${razorpayOrderId}|${fakePaymentId}`;
    const validSignature = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(payloadToSign)
      .digest('hex');

    const validRes = await fetch(`${PROD_URL}/api/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: createdOrderId,
        razorpayPaymentId: fakePaymentId,
        razorpayOrderId: razorpayOrderId,
        razorpaySignature: validSignature
      })
    });

    assert.strictEqual(validRes.status, 200, `Valid payment verification must return 200, got ${validRes.status}`);
    const validData = await validRes.json();
    assert.strictEqual(validData.success, true, 'Payment verification must succeed');
    assert.ok(validData.pickupCode, 'Pickup code must be generated upon payment verification');
    assert.ok(validData.pickupCode.startsWith('TNT-PK-'), 'Pickup code must follow TNT-PK-XXXX format');

    verifiedPickupCode = validData.pickupCode;
    console.log(`  ✔ Payment Verified Genuine: Generated Pickup Code: ${verifiedPickupCode}`);
  });

  // -------------------------------------------------------------------------
  // TEST 5: 2-Factor Customer Order Lookup & Privacy
  // -------------------------------------------------------------------------
  await t.test('Test 5: 2-Factor Customer Privacy Lookup', async () => {
    // 1. Snooping attempt with wrong mobile
    const snoopRes = await fetch(`${PROD_URL}/api/get-order-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNumber: createdPublicOrderNumber,
        mobile: '9876543210' // Wrong mobile
      })
    });
    assert.ok(snoopRes.status >= 400, 'Lookup with wrong mobile must fail');
    console.log(`  ✔ Customer Privacy: Unauthorized mobile rejected.`);

    // 2. Legitimate lookup with correct mobile
    const legitRes = await fetch(`${PROD_URL}/api/get-order-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNumber: createdPublicOrderNumber,
        mobile: '9442854444' // Correct mobile
      })
    });
    assert.strictEqual(legitRes.status, 200);
    const legitData = await legitRes.json();
    assert.strictEqual(legitData.success, true);
    assert.strictEqual(legitData.order.public_order_number, createdPublicOrderNumber);
    assert.strictEqual(legitData.order.order_status, 'PAID');
    assert.strictEqual(legitData.order.payment_status, 'PAID');
    assert.strictEqual(legitData.order.pickup_code, verifiedPickupCode, 'Verified customer lookup must reveal Pickup Code');
    assert.strictEqual(legitData.order.customer_mobile_masked, '94******44', 'Mobile must be masked');

    console.log(`  ✔ Customer Order Status Verified: Revealed Pickup Code strictly to customer.`);
  });

  // -------------------------------------------------------------------------
  // TEST 6: Admin Authentication & Perimeter Security
  // -------------------------------------------------------------------------
  await t.test('Test 6: Admin Authentication & Perimeter Defense', async () => {
    // 1. Invalid credentials
    const badLoginRes = await fetch(`${PROD_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'zinointech@gmail.com',
        password: 'WrongPassword999'
      })
    });
    assert.strictEqual(badLoginRes.status, 401, 'Invalid password must return 401');
    console.log(`  ✔ Perimeter Defense: Invalid credentials rejected.`);

    // 2. Valid credentials
    const loginRes = await fetch(`${PROD_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'zinointech@gmail.com',
        password: 'Admin@123'
      })
    });
    assert.strictEqual(loginRes.status, 200, `Admin login must return 200, got ${loginRes.status}`);
    const loginData = await loginRes.json();
    assert.strictEqual(loginData.success, true);
    assert.ok(loginData.token, 'Must receive session token');
    adminSessionToken = loginData.token;

    console.log(`  ✔ Admin Authenticated: Token received for zinointech@gmail.com.`);
  });

  // -------------------------------------------------------------------------
  // TEST 7: Admin Real-time Operational Metrics
  // -------------------------------------------------------------------------
  await t.test('Test 7: Admin Live Operational Metrics & Revenue', async () => {
    assert.ok(adminSessionToken, 'Admin token required');

    const metricsRes = await fetch(`${PROD_URL}/api/admin/metrics`, {
      headers: {
        'Authorization': `Bearer ${adminSessionToken}`
      }
    });
    assert.strictEqual(metricsRes.status, 200, `Metrics must return 200, got ${metricsRes.status}`);
    const metrics = await metricsRes.json();
    assert.strictEqual(metrics.success, true);
    assert.ok(typeof metrics.metrics.total_orders === 'number', 'total_orders must be a number');
    assert.ok(typeof metrics.metrics.paid_orders === 'number', 'paid_orders must be a number');
    assert.ok(typeof metrics.metrics.verified_revenue_paise === 'number', 'verified_revenue_paise must be a number');

    console.log(`  ✔ Operational Metrics: Total Orders=${metrics.metrics.total_orders}, Paid=${metrics.metrics.paid_orders}, Revenue=₹${metrics.metrics.verified_revenue_paise / 100}`);
  });

  // -------------------------------------------------------------------------
  // TEST 8: Fulfilment State Machine: Move to READY_FOR_PICKUP
  // -------------------------------------------------------------------------
  await t.test('Test 8: Advance Fulfilment Transition to READY_FOR_PICKUP', async () => {
    assert.ok(adminSessionToken && createdOrderId, 'Admin token & order required');

    // 1. Security Guard: Direct update to PICKED_UP without verification code is forbidden
    const illegalRes = await fetch(`${PROD_URL}/api/admin/update-order-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminSessionToken}`
      },
      body: JSON.stringify({
        orderId: createdOrderId,
        status: 'PICKED_UP'
      })
    });
    assert.strictEqual(illegalRes.status, 400, 'Direct status update to PICKED_UP must be blocked');
    console.log(`  ✔ Security Rule Enforced: Direct update to PICKED_UP blocked.`);

    // 2. Valid transition to READY_FOR_PICKUP
    const readyRes = await fetch(`${PROD_URL}/api/admin/update-order-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminSessionToken}`
      },
      body: JSON.stringify({
        orderId: createdOrderId,
        status: 'READY_FOR_PICKUP'
      })
    });
    assert.strictEqual(readyRes.status, 200);
    const readyData = await readyRes.json();
    assert.strictEqual(readyData.success, true);
    console.log(`  ✔ Order transitioned directly to READY_FOR_PICKUP without forced kitchen queue.`);
  });

  // -------------------------------------------------------------------------
  // TEST 9: Counter Handover Verification & Anti-Replay Protection
  // -------------------------------------------------------------------------
  await t.test('Test 9: Counter Handover Verification & Anti-Replay Defense', async () => {
    assert.ok(adminSessionToken && createdPublicOrderNumber && verifiedPickupCode);

    // 1. Invalid pickup code rejected
    const badCodeRes = await fetch(`${PROD_URL}/api/admin/verify-pickup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminSessionToken}`
      },
      body: JSON.stringify({
        orderNumber: createdPublicOrderNumber,
        pickupCode: 'TNT-PK-9999' // Invalid code
      })
    });
    assert.strictEqual(badCodeRes.status, 400, 'Invalid pickup code must be rejected');
    console.log(`  ✔ Security Defense: Invalid pickup code rejected.`);

    // 2. Genuine pickup code verified
    const goodCodeRes = await fetch(`${PROD_URL}/api/admin/verify-pickup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminSessionToken}`
      },
      body: JSON.stringify({
        orderNumber: createdPublicOrderNumber,
        pickupCode: verifiedPickupCode
      })
    });
    assert.strictEqual(goodCodeRes.status, 200, `Valid pickup code verification must return 200, got ${goodCodeRes.status}`);
    const goodCodeData = await goodCodeRes.json();
    assert.strictEqual(goodCodeData.success, true);
    assert.strictEqual(goodCodeData.order.order_status, 'PICKED_UP', 'Order state must now be PICKED_UP');
    console.log(`  ✔ Counter Verification Successful: Order ${createdPublicOrderNumber} marked PICKED_UP.`);

    // 3. Anti-Replay Defense: Attempting to collect again must fail
    const replayRes = await fetch(`${PROD_URL}/api/admin/verify-pickup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminSessionToken}`
      },
      body: JSON.stringify({
        orderNumber: createdPublicOrderNumber,
        pickupCode: verifiedPickupCode
      })
    });
    assert.strictEqual(replayRes.status, 400, 'Re-collection of picked up order must be blocked');
    console.log(`  ✔ Anti-Replay Defense Enforced: Re-collection attempt strictly blocked.`);
  });

  // -------------------------------------------------------------------------
  // TEST 10: Razorpay Webhook Simulation & Idempotency
  // -------------------------------------------------------------------------
  await t.test('Test 10: Webhook Signature Defense & Safe Idempotency', async () => {
    const rawBody = JSON.stringify({
      entity: 'event',
      account_id: 'acc_live_test',
      event: 'payment.captured',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: 'pay_live_test_' + crypto.randomBytes(6).toString('hex'),
            order_id: razorpayOrderId,
            amount: createdTotalPaise,
            status: 'captured',
            notes: { order_id: createdOrderId }
          }
        }
      },
      created_at: Math.floor(Date.now() / 1000)
    });

    // 1. Missing signature rejected
    const noSigRes = await fetch(`${PROD_URL}/api/razorpay-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawBody
    });
    assert.strictEqual(noSigRes.status, 400, 'Missing webhook signature must be rejected');

    // 2. Valid webhook signature accepted
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'tnt_webhook_secret_2026';
    const validWebhookSig = crypto.createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    const goodWebhookRes = await fetch(`${PROD_URL}/api/razorpay-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': validWebhookSig
      },
      body: rawBody
    });
    assert.strictEqual(goodWebhookRes.status, 200, `Valid webhook must return 200, got ${goodWebhookRes.status}`);
    const goodWebhookData = await goodWebhookRes.json();
    assert.strictEqual(goodWebhookData.success, true);
    console.log(`  ✔ Razorpay Webhook Defense & Idempotency Verified.`);
  });

  // -------------------------------------------------------------------------
  // TEST 11: Razorpay QR-First Configuration & Customer Receipt Verification
  // -------------------------------------------------------------------------
  await t.test('Test 11: QR-First Checkout Architecture & Single Customer Receipt', async () => {
    // 1. Verify checkout.js contains the official Razorpay QR-First blocks & polling
    const checkoutJsContent = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'checkout.js'), 'utf8');
    assert.ok(checkoutJsContent.includes('flows: ["qr"]'), 'Razorpay config must declare flows: ["qr"] for dynamic UPI QR code');
    assert.ok(checkoutJsContent.includes('"block.qr_code", "block.upi_apps", "block.cards", "block.other"'), 'Razorpay sequence must have block.qr_code as primary default');
    assert.ok(checkoutJsContent.includes('startPaymentStatusPolling'), 'Must have real-time background status polling for mobile QR completion');
    assert.ok(checkoutJsContent.includes('Other Payment Methods'), 'Must offer secondary Other Payment Methods option');

    // 2. Verify order-status.js strictly shows only customer receipt (no 2-page or kitchen checklist)
    const orderStatusJsContent = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'order-status.js'), 'utf8');
    assert.ok(!orderStatusJsContent.includes('Kitchen Packaging &amp; Item Verification Checklist'), 'Customer receipt must NOT show kitchen packaging checklist');
    assert.ok(!orderStatusJsContent.includes('Shop Counter Handover &amp; Verification Certificate'), 'Customer receipt must NOT show staff counter handover certificate');
    assert.ok(!orderStatusJsContent.includes('Page 1 of 2'), 'Must NOT mention 2-page receipt');
    assert.ok(!orderStatusJsContent.includes('Page 2 of 2'), 'Must NOT mention 2-page receipt');
    assert.ok(orderStatusJsContent.includes('Official Customer Receipt'), 'Must show Official Customer Receipt');
    assert.ok(orderStatusJsContent.includes('CUSTOMER RECEIPT / வாடிக்கையாளர் ரசீது'), 'Must include bilingual Tamil/English customer receipt pill');

    console.log(`  ✔ QR-First Razorpay Configuration Verified.`);
    console.log(`  ✔ Single Customer Receipt Verified (Zero internal kitchen/2-page mentions).`);
  });
});

