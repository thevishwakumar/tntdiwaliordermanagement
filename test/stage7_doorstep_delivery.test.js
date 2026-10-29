/**
 * Automated Test Suite: Stage 7 Doorstep Delivery via Porter/Partner
 * 
 * Verifies:
 * 1. Default Store Pickup creates order with deliveryFee = 0, total = subtotal.
 * 2. Doorstep Delivery requires valid delivery address (street, area, city, 6-digit pin).
 * 3. Doorstep Delivery creates order with ₹80 (8000 paise) estimated delivery fee added to total.
 * 4. Razorpay payment verification authenticates complete amount (sweets + delivery).
 * 5. Secure customer status lookup returns fulfilment method, fee, and address.
 * 6. Admin API returns delivery info and allows filtering by fulfilment method.
 * 7. Admin CSV export includes delivery fields.
 */

import http from 'http';
import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function loadEnv() {
  const envPath = path.resolve('.env');
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

const BASE_URL = 'http://localhost:3000';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '6tJrsoptI5w6rdicuxsk07xn';

function makeRequest(path, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOptions = {
      method: options.method || 'GET',
      headers: options.headers || {},
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search
    };

    if (body) {
      if (typeof body === 'object' && !(body instanceof Buffer)) {
        body = JSON.stringify(body);
        reqOptions.headers['Content-Type'] = 'application/json';
      }
      reqOptions.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = http.request(reqOptions, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed, raw: data });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function runStage7Tests() {
  console.log('===============================================================');
  console.log('🧪 Starting Stage 7: Doorstep Delivery via Porter/Partner Tests');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  // --- 1. Store Pickup Default Order ---
  let pickupOrderId = null;
  let pickupOrderRef = null;

  await test('Store Pickup: Default order has ₹0 delivery fee and total equals subtotal', async () => {
    const res = await makeRequest('/api/create-order', { method: 'POST' }, {
      customerName: 'Karthik Subramanian',
      customerMobile: '9843012345',
      customerEmail: 'karthik@example.com',
      fulfilmentMethod: 'PICKUP',
      pickupDate: '2026-10-30',
      pickupTime: 'Morning (08:00 AM - 12:00 PM)',
      items: [{ productId: 'tnt-trad-sweets', quantity: 2 }]
    });

    assert.ok(res.status === 200 || res.status === 201, `Expected 200 or 201, got ${res.status}`);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.fulfilment_method, 'PICKUP');
    assert.strictEqual(res.data.delivery_fee_paise, 0);
    assert.strictEqual(res.data.total_paise, res.data.subtotal_paise, 'Total must equal subtotal for pickup');
    pickupOrderId = res.data.order_id;
    pickupOrderRef = res.data.public_order_number;
  });

  // --- 2. Doorstep Delivery Address Validation ---
  await test('Doorstep Delivery: Rejects order if delivery address is missing', async () => {
    const res = await makeRequest('/api/create-order', { method: 'POST' }, {
      customerName: 'Anitha Ramesh',
      customerMobile: '9843054321',
      fulfilmentMethod: 'DELIVERY',
      pickupDate: '2026-10-30',
      pickupTime: 'Evening (04:00 PM - 08:00 PM)',
      items: [{ productId: 'tnt-trad-sweets', quantity: 1 }]
      // No deliveryAddress provided
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
    assert.match(res.data.message, /delivery address/i);
  });

  await test('Doorstep Delivery: Rejects order if street is too short', async () => {
    const res = await makeRequest('/api/create-order', { method: 'POST' }, {
      customerName: 'Anitha Ramesh',
      customerMobile: '9843054321',
      fulfilmentMethod: 'DELIVERY',
      pickupDate: '2026-10-30',
      deliveryAddress: {
        street: 'No 1', // Too short (< 5 chars)
        area: 'RS Puram',
        city: 'Coimbatore',
        pincode: '641002'
      },
      items: [{ productId: 'tnt-trad-sweets', quantity: 1 }]
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
    assert.match(res.data.message, /street/i);
  });

  await test('Doorstep Delivery: Rejects order if pincode is invalid', async () => {
    const res = await makeRequest('/api/create-order', { method: 'POST' }, {
      customerName: 'Anitha Ramesh',
      customerMobile: '9843054321',
      fulfilmentMethod: 'DELIVERY',
      pickupDate: '2026-10-30',
      deliveryAddress: {
        street: '12-B Gandhi Road',
        area: 'RS Puram',
        city: 'Coimbatore',
        pincode: '64100' // 5 digits only
      },
      items: [{ productId: 'tnt-trad-sweets', quantity: 1 }]
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
    assert.match(res.data.message, /pin/i);
  });

  // --- 3. Doorstep Delivery Order Success with ₹80 Estimate ---
  let deliveryOrderId = null;
  let deliveryOrderRef = null;
  let deliveryTotalPaise = 0;
  let deliveryRazorpayOrderId = null;

  await test('Doorstep Delivery: Successfully creates order with ₹80 delivery fee added to total', async () => {
    const res = await makeRequest('/api/create-order', { method: 'POST' }, {
      customerName: 'Anitha Ramesh',
      customerMobile: '9843054321',
      customerEmail: 'anitha@example.com',
      fulfilmentMethod: 'DELIVERY',
      pickupDate: '2026-10-31',
      pickupTime: 'Afternoon (12:00 PM - 04:00 PM)',
      deliveryAddress: {
        street: 'Flat 4A, Green Meadows, 5th Cross',
        area: 'RS Puram West',
        city: 'Coimbatore',
        pincode: '641002',
        landmark: 'Opposite State Bank'
      },
      customerNotes: 'Please ring bell twice upon arrival',
      items: [{ productId: 'tnt-trad-sweets', quantity: 1 }]
    });

    assert.ok(res.status === 200 || res.status === 201, `Expected 200 or 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.fulfilment_method, 'DELIVERY');
    assert.strictEqual(res.data.delivery_fee_paise, 8000, 'Delivery fee must be 8000 paise (₹80)');
    assert.strictEqual(res.data.total_paise, res.data.subtotal_paise + 8000, 'Total must equal subtotal + 8000 paise');
    assert.strictEqual(res.data.delivery_address.pincode, '641002');
    assert.strictEqual(res.data.delivery_address.area, 'RS Puram West');

    deliveryOrderId = res.data.order_id;
    deliveryOrderRef = res.data.public_order_number;
    deliveryTotalPaise = res.data.total_paise;
    deliveryRazorpayOrderId = res.data.razorpay_order_id;
  });

  // --- 4. Payment Verification for Delivery Order ---
  await test('Razorpay Payment: Verifies full payment including ₹80 delivery fee', async () => {
    const mockPaymentId = `pay_mock_${Date.now()}`;
    const rzpOrderId = deliveryRazorpayOrderId || `order_mock_${Date.now()}`;
    const signature = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${rzpOrderId}|${mockPaymentId}`)
      .digest('hex');

    const res = await makeRequest('/api/verify-payment', { method: 'POST' }, {
      orderId: deliveryOrderId,
      razorpayOrderId: rzpOrderId,
      razorpayPaymentId: mockPaymentId,
      razorpaySignature: signature
    });

    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.verified, true);
    assert.ok(res.data.pickupCode, 'Pickup code issued upon payment confirmation');
  });

  // --- 5. Customer Status Lookup for Delivery Order ---
  await test('Customer Lookup: Returns delivery method, fee, and address', async () => {
    const res = await makeRequest('/api/get-order-status', { method: 'POST' }, {
      orderNumber: deliveryOrderRef,
      mobile: '9843054321'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.order.fulfilment_method, 'DELIVERY');
    assert.strictEqual(res.data.order.delivery_fee_paise, 8000);
    assert.strictEqual(res.data.order.delivery_address.city, 'Coimbatore');
    assert.strictEqual(res.data.order.delivery_address.pincode, '641002');
    assert.strictEqual(res.data.order.payment_status, 'PAID');
  });

  // --- 6. Admin Authentication & Delivery Dashboard Filtering ---
  let adminToken = null;

  await test('Admin: Login and fetch delivery orders', async () => {
    const loginRes = await makeRequest('/api/admin/login', { method: 'POST' }, {
      email: 'zinointech@gmail.com',
      password: 'Admin@123'
    });

    assert.strictEqual(loginRes.status, 200);
    assert.strictEqual(loginRes.data.success, true);
    adminToken = loginRes.data.token;
    assert.ok(adminToken, 'Admin token received');

    // Fetch orders list
    const ordersRes = await makeRequest('/api/admin/orders', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    assert.strictEqual(ordersRes.status, 200);
    assert.strictEqual(ordersRes.data.success, true);

    const deliveryOrders = ordersRes.data.orders.filter(o => o.fulfilment_method === 'DELIVERY');
    const pickupOrders = ordersRes.data.orders.filter(o => (o.fulfilment_method || 'PICKUP') === 'PICKUP');

    assert.ok(deliveryOrders.length >= 1, 'At least 1 delivery order exists');
    assert.ok(pickupOrders.length >= 1, 'At least 1 pickup order exists');

    const foundDelivery = deliveryOrders.find(o => o.id === deliveryOrderId);
    assert.ok(foundDelivery, 'Found created delivery order in admin list');
    assert.strictEqual(foundDelivery.delivery_fee_paise, 8000);
    assert.ok(foundDelivery.delivery_address, 'Delivery address present in admin order data');
  });

  // --- 7. Admin Order Detail Modal Endpoint ---
  await test('Admin: Single order detail contains full delivery address', async () => {
    const res = await makeRequest(`/api/admin/orders/${deliveryOrderId}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.order.fulfilment_method, 'DELIVERY');
    assert.strictEqual(res.data.order.delivery_fee_paise, 8000);
    assert.strictEqual(res.data.order.delivery_address.street, 'Flat 4A, Green Meadows, 5th Cross');
  });

  // --- 8. Admin CSV Export includes Delivery Columns ---
  await test('Admin: CSV export includes Fulfilment Type, Delivery Fee, and Delivery Address', async () => {
    const res = await makeRequest('/api/admin/export-csv', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/csv'));
    assert.ok(res.raw.includes('Fulfilment Type'));
    assert.ok(res.raw.includes('Delivery Fee (INR)'));
    assert.ok(res.raw.includes('Delivery Address'));
    assert.ok(res.raw.includes('DELIVERY'));
    assert.ok(res.raw.includes('RS Puram West'));
  });

  console.log('\n===============================================================');
  console.log(`📊 Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage7Tests().catch(err => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
