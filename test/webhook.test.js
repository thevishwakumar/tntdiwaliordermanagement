/**
 * TNT Diwali Order Management System
 * Razorpay Webhook Security & Idempotency Test Suite
 */

import http from 'http';
import crypto from 'crypto';
import assert from 'assert';

const BASE_URL = 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'tnt_webhook_secret_2026';

function post(endpoint, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = typeof data === 'string' ? data : JSON.stringify(data);
    const url = new URL(endpoint, BASE_URL);

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
        } catch {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function generateSignature(payloadString, secret = WEBHOOK_SECRET) {
  return crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
}

async function runWebhookTests() {
  console.log('======================================================================');
  console.log('🔔  RAZORPAY WEBHOOK SECURITY & IDEMPOTENCY TEST SUITE');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✔ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(err);
      failed++;
    }
  }

  // 1. Missing Signature Rejection
  await test('Missing x-razorpay-signature header is rejected (400)', async () => {
    const payload = JSON.stringify({ event: 'payment.captured' });
    const res = await post('/api/razorpay-webhook', payload);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
  });

  // 2. Tampered / Invalid Signature Rejection
  await test('Forged HMAC signature is rejected (400)', async () => {
    const payload = JSON.stringify({ event: 'payment.captured' });
    const badSig = '0000000000000000000000000000000000000000000000000000000000000000';
    const res = await post('/api/razorpay-webhook', payload, {
      'x-razorpay-signature': badSig
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
  });

  // Create an order to test against
  const orderRes = await post('/api/create-order', {
    customerName: 'Meenakshi Sundaram',
    customerMobile: '9840999888',
    customerEmail: 'meena@example.com',
    items: [{ productId: 'tnt-mixed-combo', quantity: 1 }]
  });
  assert.strictEqual(orderRes.status, 201);
  const targetOrderId = orderRes.data.order_id;
  const targetRzpOrderId = orderRes.data.razorpay_order_id;

  // 3. Genuine payment.captured event confirms order
  const eventId1 = 'evt_test_' + Date.now();
  const paymentCapturedEvent = {
    entity: 'event',
    account_id: 'acc_tnt_test',
    event: 'payment.captured',
    event_id: eventId1,
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      payment: {
        entity: {
          id: 'pay_wh_' + Date.now(),
          order_id: targetRzpOrderId,
          amount: 99900,
          currency: 'INR',
          status: 'captured'
        }
      }
    }
  };

  const payloadString1 = JSON.stringify(paymentCapturedEvent);
  const validSig1 = generateSignature(payloadString1);

  await test('Genuine payment.captured marks order PAID and issues Pickup Code', async () => {
    const res = await post('/api/razorpay-webhook', payloadString1, {
      'x-razorpay-signature': validSig1
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);

    // Verify order status
    const statusRes = await post('/api/get-order-status', {
      orderNumber: orderRes.data.public_order_number,
      mobile: '9840999888'
    });
    assert.strictEqual(statusRes.status, 200);
    assert.strictEqual(statusRes.data.order.payment_status, 'PAID');
    assert.strictEqual(statusRes.data.order.order_status, 'PAID');
    assert.ok(statusRes.data.order.pickup_code.startsWith('TNT-PK-'), 'Pickup code must be issued');
  });

  // 4. Duplicate Webhook Delivery (Idempotency)
  await test('Duplicate webhook delivery is processed idempotently without side-effects', async () => {
    const res = await post('/api/razorpay-webhook', payloadString1, {
      'x-razorpay-signature': validSig1
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.message.includes('idempotent') || res.data.message.includes('already'));
  });

  // 5. Out-of-order payment.failed event cannot overwrite an already PAID order
  const eventId2 = 'evt_fail_' + Date.now();
  const paymentFailedEvent = {
    entity: 'event',
    event: 'payment.failed',
    event_id: eventId2,
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      payment: {
        entity: {
          id: 'pay_fail_' + Date.now(),
          order_id: targetRzpOrderId,
          error_code: 'BAD_REQUEST_ERROR',
          error_description: 'Payment was cancelled by user'
        }
      }
    }
  };
  const payloadString2 = JSON.stringify(paymentFailedEvent);
  const validSig2 = generateSignature(payloadString2);

  await test('Payment failure event cannot overwrite an already PAID order', async () => {
    const res = await post('/api/razorpay-webhook', payloadString2, {
      'x-razorpay-signature': validSig2
    });
    assert.strictEqual(res.status, 200);

    // Order must remain PAID
    const statusRes = await post('/api/get-order-status', {
      orderNumber: orderRes.data.public_order_number,
      mobile: '9840999888'
    });
    assert.strictEqual(statusRes.data.order.payment_status, 'PAID');
    assert.strictEqual(statusRes.data.order.order_status, 'PAID');
  });

  // 6. payment.failed correctly records failure on an unpaid order
  const unpaidOrderRes = await post('/api/create-order', {
    customerName: 'Raghavan Iyer',
    customerMobile: '9444555666',
    items: [{ productId: 'tnt-trad-sweets', quantity: 1 }]
  });
  const unpaidRzpOrderId = unpaidOrderRes.data.razorpay_order_id;

  const eventId3 = 'evt_fail_unpaid_' + Date.now();
  const unpaidFailedEvent = {
    entity: 'event',
    event: 'payment.failed',
    event_id: eventId3,
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      payment: {
        entity: {
          id: 'pay_fail_2_' + Date.now(),
          order_id: unpaidRzpOrderId,
          error_code: 'PAYMENT_CANCELLED'
        }
      }
    }
  };
  const payloadString3 = JSON.stringify(unpaidFailedEvent);
  const validSig3 = generateSignature(payloadString3);

  await test('Payment failure event correctly marks unpaid order as FAILED', async () => {
    const res = await post('/api/razorpay-webhook', payloadString3, {
      'x-razorpay-signature': validSig3
    });
    assert.strictEqual(res.status, 200);

    const statusRes = await post('/api/get-order-status', {
      orderNumber: unpaidOrderRes.data.public_order_number,
      mobile: '9444555666'
    });
    assert.strictEqual(statusRes.data.order.payment_status, 'FAILED');
    assert.strictEqual(statusRes.data.order.pickup_code, null, 'Unpaid/failed order must not receive pickup code');
  });

  console.log(`\n--- WEBHOOK TEST SUITE: ${passed} PASSED, ${failed} FAILED ---\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runWebhookTests().catch(err => {
  console.error('Webhook suite fatal error:', err);
  process.exit(1);
});
