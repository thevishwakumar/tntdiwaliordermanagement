/**
 * Stage 2 Backend Automated Test Suite
 * 
 * Verifies:
 * 1. Authoritative price calculation in integer paise (prevents client price tampering).
 * 2. Idempotency and duplicate order submission prevention.
 * 3. Initial state security (orders start strictly as AWAITING_PAYMENT / PENDING; never PAID).
 * 4. Non-sequential order number generation.
 * 5. Secure customer order status lookup (requires matching mobile number).
 * 6. Admin authentication and state machine transition enforcement.
 */

import assert from 'assert';
import http from 'http';

const BASE_URL = 'http://localhost:3000';

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

function get(endpoint, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, BASE_URL);
    const req = http.request(url, {
      method: 'GET',
      headers: { ...headers }
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
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING STAGE 2 BACKEND TEST SUITE ---\n');
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

  // 1. Authoritative Pricing Test
  await test('Authoritative price calculation in integer paise (rejects client price overrides)', async () => {
    const payload = {
      customerName: 'Suresh Kumar',
      customerMobile: '9840123456',
      customerEmail: 'suresh@example.com',
      items: [
        { productId: 'tnt-trad-sweets', quantity: 2, clientPrice: 1 }, // Tampered client price ₹1
        { productId: 'tnt-ghee-sweets', quantity: 1, clientPrice: 10 } // Tampered client price ₹10
      ]
    };

    const res = await post('/api/create-order', payload);
    assert.strictEqual(res.status, 201, 'Should return HTTP 201 Created');
    assert.strictEqual(res.data.success, true);

    // Expected: 2 * 50000 + 1 * 90000 = 190000 paise (₹1,900)
    assert.strictEqual(res.data.total_paise, 190000, 'Total must strictly equal 190,000 paise regardless of client input');
    assert.strictEqual(res.data.total_in_rupees, 1900, 'Total in rupees must be ₹1,900');
  });

  // 2. Initial State Security
  await test('New order starts strictly as AWAITING_PAYMENT and PENDING, never PAID', async () => {
    const payload = {
      customerName: 'Kavitha Devi',
      customerMobile: '9790123456',
      items: [{ productId: 'tnt-mixed-combo', quantity: 1 }]
    };

    const res = await post('/api/create-order', payload);
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.order_status, 'AWAITING_PAYMENT');
    assert.strictEqual(res.data.payment_status, 'PENDING');
  });

  // 3. Non-Sequential Public Order Number
  await test('Order numbers are non-sequential and resistant to enumeration (format TNT-YYMMDD-XXXXXX)', async () => {
    const payload = {
      customerName: 'Anand R',
      customerMobile: '9444123456',
      items: [{ productId: 'tnt-karam-specials', quantity: 1 }]
    };

    const res1 = await post('/api/create-order', payload);
    const res2 = await post('/api/create-order', payload);

    assert.match(res1.data.public_order_number, /^TNT-\d{6}-[A-F0-9]{6}$/);
    assert.match(res2.data.public_order_number, /^TNT-\d{6}-[A-F0-9]{6}$/);
    assert.notStrictEqual(res1.data.public_order_number, res2.data.public_order_number, 'Generated order numbers must be distinct');
  });

  // 4. Idempotency & Duplicate Order Submission Guard
  await test('Idempotency key prevents duplicate order creation on network retries', async () => {
    const idempotencyKey = 'test_idemp_' + Date.now();
    const payload = {
      customerName: 'Priya Sharma',
      customerMobile: '9123456789',
      items: [{ productId: 'tnt-dry-fruits', quantity: 1 }],
      idempotencyKey
    };

    const firstCall = await post('/api/create-order', payload, { 'Idempotency-Key': idempotencyKey });
    assert.strictEqual(firstCall.status, 201);
    assert.strictEqual(firstCall.data.is_duplicate, false);

    const retryCall = await post('/api/create-order', payload, { 'Idempotency-Key': idempotencyKey });
    assert.strictEqual(retryCall.status, 200, 'Retry must return existing order with HTTP 200');
    assert.strictEqual(retryCall.data.is_duplicate, true, 'is_duplicate flag must be true');
    assert.strictEqual(retryCall.data.public_order_number, firstCall.data.public_order_number, 'Must return same public order number');
    assert.strictEqual(retryCall.data.order_id, firstCall.data.order_id, 'Must return same database order ID');
  });

  // 5. Secure Status Lookup
  await test('Order status lookup requires matching mobile; rejects unauthorized snooping', async () => {
    const payload = {
      customerName: 'Murugan K',
      customerMobile: '9840999888',
      items: [{ productId: 'tnt-trad-sweets', quantity: 1 }]
    };
    const created = await post('/api/create-order', payload);
    const orderNum = created.data.public_order_number;

    // Authorized lookup (correct mobile)
    const authLookup = await post('/api/get-order-status', { orderNumber: orderNum, mobile: '9840999888' });
    assert.strictEqual(authLookup.status, 200);
    assert.strictEqual(authLookup.data.success, true);
    assert.strictEqual(authLookup.data.order.public_order_number, orderNum);
    assert.strictEqual(authLookup.data.order.pickup_code, null, 'Unpaid order must NOT reveal pickup code');

    // Unauthorized lookup (wrong mobile)
    const unauthorized = await post('/api/get-order-status', { orderNumber: orderNum, mobile: '9999999999' });
    assert.strictEqual(unauthorized.status, 404);
    assert.strictEqual(unauthorized.data.success, false);
  });

  // 6. Admin Authentication & Authorization
  await test('Admin operations require valid session token; non-admin is rejected', async () => {
    // Unauthenticated request
    const unauth = await get('/api/admin/orders');
    assert.strictEqual(unauth.status, 401, 'Unauthenticated request must be rejected with HTTP 401');

    // Admin login
    const loginRes = await post('/api/admin/login', {
      email: 'admin@tntcatering.in',
      password: 'DiwaliAdmin2026!'
    });
    assert.strictEqual(loginRes.status, 200);
    const token = loginRes.data.token;
    assert.ok(token, 'Must return session token');

    // Authenticated request
    const authOrders = await get('/api/admin/orders', { 'Authorization': `Bearer ${token}` });
    assert.strictEqual(authOrders.status, 200);
    assert.ok(Array.isArray(authOrders.data.orders));
  });

  // 7. State Machine Status Transitions
  await test('State machine enforces valid transitions and rejects illegal state skips', async () => {
    const loginRes = await post('/api/admin/login', {
      email: 'admin@tntcatering.in',
      password: 'DiwaliAdmin2026!'
    });
    const token = loginRes.data.token;

    // Create an order via API (starts in AWAITING_PAYMENT)
    const createRes = await post('/api/create-order', {
      customerName: 'State Machine Test Customer',
      customerMobile: '9789012345',
      items: [{ productId: 'tnt-mixed-combo', quantity: 1 }]
    });
    const orderId = createRes.data.order_id;

    // 1. Illegal transition: AWAITING_PAYMENT -> PICKED_UP (skipping states)
    const illegalStep = await post('/api/admin/update-order-status', { 
      orderId, 
      newStatus: 'PICKED_UP' 
    }, { 'Authorization': `Bearer ${token}` });
    
    assert.strictEqual(illegalStep.status, 400, 'Skipping state must be rejected with HTTP 400');
    assert.match(illegalStep.data.message, /Illegal transition/);

    // 2. Valid transition: AWAITING_PAYMENT -> CANCELLED
    const validCancel = await post('/api/admin/update-order-status', { 
      orderId, 
      newStatus: 'CANCELLED',
      reason: 'Customer requested cancellation prior to payment'
    }, { 'Authorization': `Bearer ${token}` });

    assert.strictEqual(validCancel.status, 200);
    assert.strictEqual(validCancel.data.newStatus, 'CANCELLED');

    // 3. Transition from terminal CANCELLED state should be rejected
    const terminalStep = await post('/api/admin/update-order-status', { 
      orderId, 
      newStatus: 'PREPARING' 
    }, { 'Authorization': `Bearer ${token}` });

    assert.strictEqual(terminalStep.status, 400, 'Transition from CANCELLED must be rejected');
  });

  console.log(`\n--- TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED ---`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
