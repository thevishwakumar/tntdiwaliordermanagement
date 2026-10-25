/**
 * Stage 3 Payment & Verification Automated Test Suite
 * 
 * Verifies:
 * 1. Razorpay Order Generation with authoritative paise amounts.
 * 2. Cryptographic HMAC SHA256 Signature Verification:
 *    - Valid signature verifies and issues secure Pickup Code (TNT-PK-XXXX).
 *    - Tampered/invalid signature is rejected with HTTP 400.
 * 3. Status lookup reveals Pickup Code strictly when PAID.
 */

import assert from 'assert';
import http from 'http';
import crypto from 'crypto';

const BASE_URL = 'http://localhost:3000';
const RAZORPAY_KEY_SECRET = '6tJrsoptI5w6rdicuxsk07xn';

function post(endpoint, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, BASE_URL);
    const postData = JSON.stringify(data);
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING STAGE 3 PAYMENT & VERIFICATION TESTS ---\n');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ FAIL: ${name}`);
      console.error(err);
      failed++;
    }
  }

  // Test 1: Order creation returns genuine Razorpay order ID and authoritative paise amount
  let createdOrder;
  await test('Order creation returns genuine Razorpay order ID in paise', async () => {
    const payload = {
      customerName: 'Anitha Raman',
      customerMobile: '9442854444',
      customerEmail: 'anitha@example.com',
      items: [
        { productId: 'tnt-trad-sweets', quantity: 1 }, // 50000 paise
        { productId: 'tnt-karam-specials', quantity: 2 } // 90000 paise
      ]
    };

    const res = await post('/api/create-order', payload);
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.total_paise, 140000); // ₹1,400
    assert.ok(res.data.razorpay_order_id, 'Must generate razorpay_order_id');
    assert.strictEqual(res.data.razorpay_key_id, 'rzp_test_TrldCRnEsCFYTj');
    createdOrder = res.data;
  });

  // Test 2: Tampered/invalid HMAC signature is strictly rejected
  await test('Cryptographic verification rejects tampered payment signature', async () => {
    const fakePaymentId = 'pay_fake_' + Date.now();
    const badSignature = '0000000000000000000000000000000000000000000000000000000000000000';

    const res = await post('/api/verify-payment', {
      orderId: createdOrder.order_id,
      razorpayPaymentId: fakePaymentId,
      razorpayOrderId: createdOrder.razorpay_order_id,
      razorpaySignature: badSignature
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.verified, false);
    assert.match(res.data.message, /signature mismatch/i);
  });

  // Test 3: Valid HMAC SHA256 signature verifies payment and issues secure Pickup Code
  let verifiedPickupCode;
  await test('Authentic HMAC SHA256 signature confirms order and generates official Pickup Code', async () => {
    const paymentId = 'pay_' + crypto.randomBytes(8).toString('hex');
    const orderId = createdOrder.razorpay_order_id;

    // Compute genuine HMAC SHA256 signature using test secret
    const validSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const res = await post('/api/verify-payment', {
      orderId: createdOrder.order_id,
      razorpayPaymentId: paymentId,
      razorpayOrderId: orderId,
      razorpaySignature: validSignature
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.verified, true);
    assert.match(res.data.pickupCode, /^TNT-PK-\d{4}$/, 'Must generate TNT-PK-XXXX pickup code');
    verifiedPickupCode = res.data.pickupCode;
  });

  // Test 4: Secure order lookup reveals Pickup Code strictly after verified payment
  await test('Order status lookup reveals verified Pickup Code for confirmed order', async () => {
    const res = await post('/api/get-order-status', {
      orderNumber: createdOrder.public_order_number,
      mobile: '9442854444'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.order.payment_status, 'PAID');
    assert.strictEqual(res.data.order.order_status, 'PAID');
    assert.strictEqual(res.data.order.pickup_code, verifiedPickupCode, 'Must reveal authentic pickup code');
  });

  console.log(`\n--- STAGE 3 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ---`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test execution fatal error:', err);
  process.exit(1);
});
