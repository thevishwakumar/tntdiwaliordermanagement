/**
 * Automated Test Suite: Stage 6 Advance Order Scheduling, Admin Handover & DB Verification
 * 
 * Tests:
 * 1. Admin login for newly provisioned user: zinointech@gmail.com / Admin@123
 * 2. Advance pickup scheduling at checkout (2 days ahead)
 * 3. Verified payment keeps order Scheduled/Confirmed without compulsory preparation queue
 * 4. Direct transition to Ready for Pickup by authorized admin
 * 5. Direct pickup handover verification (valid code vs invalid code vs replay attack)
 * 6. Verification of clean database state and dashboard metrics
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

async function runStage6Tests() {
  console.log('===============================================================');
  console.log('🧪 Starting Stage 6 Advance Orders, Admin & Handover Verification');
  console.log('===============================================================\n');

  let adminToken = '';
  let advanceOrder = null;
  let verifiedPickupCode = '';

  // Test 1: Admin Authentication for zinointech@gmail.com
  console.log('Test 1: Admin Authentication for zinointech@gmail.com / Admin@123');
  {
    // Wrong password check
    const badLogin = await makeRequest('/api/admin/login', { method: 'POST' }, {
      email: 'zinointech@gmail.com',
      password: 'WrongPassword'
    });
    assert.strictEqual(badLogin.status, 401, 'Wrong password must be rejected');

    // Valid login
    const goodLogin = await makeRequest('/api/admin/login', { method: 'POST' }, {
      email: 'zinointech@gmail.com',
      password: 'Admin@123'
    });
    assert.strictEqual(goodLogin.status, 200, 'Valid credentials for zinointech@gmail.com must succeed');
    assert.ok(goodLogin.data.token, 'Must return bearer token');
    assert.strictEqual(goodLogin.data.admin.email, 'zinointech@gmail.com');
    assert.strictEqual(goodLogin.data.admin.role, 'admin');
    adminToken = goodLogin.data.token;
    console.log('  ✔ Administrator zinointech@gmail.com successfully authenticated (token issued).');
  }

  // Test 2: Advance Pickup Date Ordering (e.g. 2 days ahead)
  console.log('\nTest 2: Advance Order Creation with Scheduled Pickup Date & Slot');
  {
    const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const pickupSlot = 'Evening (04:00 PM - 08:00 PM)';

    // Invalid past date rejection test
    const pastDateRes = await makeRequest('/api/create-order', { method: 'POST' }, {
      customerName: 'Past Date Test',
      customerMobile: '9840111222',
      pickupDate: '2020-01-01',
      items: [{ productId: 'tnt-trad-sweets', quantity: 1 }]
    });
    assert.strictEqual(pastDateRes.status, 400, 'Past pickup date must be rejected');
    console.log('  ✔ Validation guard: Past pickup date correctly rejected (400)');

    // Valid future advance order
    const orderRes = await makeRequest('/api/create-order', { method: 'POST' }, {
      customerName: 'Karthik Raja (Advance Order)',
      customerMobile: '9840998877',
      customerEmail: 'karthik@example.com',
      customerNotes: 'Please pack in special festive red gift box',
      pickupDate: futureDate,
      pickupTime: pickupSlot,
      items: [
        { productId: 'tnt-ghee-sweets', quantity: 2 }, // 2 * ₹900 = ₹1,800
        { productId: 'tnt-karam-specials', quantity: 2 } // 2 * ₹450 = ₹900 => Total ₹2,700
      ]
    });

    assert.strictEqual(orderRes.status, 201, 'Advance order creation must return 201');
    assert.strictEqual(orderRes.data.subtotal_paise, 270000);
    assert.strictEqual(orderRes.data.total_paise, 270000);
    assert.strictEqual(orderRes.data.total_in_rupees, 2700);
    assert.strictEqual(orderRes.data.pickup_date, futureDate);
    assert.strictEqual(orderRes.data.pickup_time, pickupSlot);
    assert.strictEqual(orderRes.data.order_status, 'AWAITING_PAYMENT');
    advanceOrder = orderRes.data;
    console.log(`  ✔ Advance order created: ${advanceOrder.public_order_number} for scheduled date ${futureDate} (${pickupSlot})`);
  }

  // Test 3: Genuine HMAC Verification Keeps Order in Scheduled/Confirmed State (No Auto-Preparation)
  console.log('\nTest 3: Payment Verification & Scheduled State Preservation');
  {
    const razorpayOrderId = advanceOrder.razorpay_order_id;
    const razorpayPaymentId = 'pay_adv_' + crypto.randomBytes(6).toString('hex');
    const signature = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    const verifyRes = await makeRequest('/api/verify-payment', { method: 'POST' }, {
      orderId: advanceOrder.order_id,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature: signature
    });

    assert.strictEqual(verifyRes.status, 200, 'Payment verification must succeed');
    assert.strictEqual(verifyRes.data.verified, true);
    assert.match(verifyRes.data.pickupCode, /^TNT-PK-\d{4}$/);
    verifiedPickupCode = verifyRes.data.pickupCode;
    console.log(`  ✔ Payment verified genuine. Pickup code issued: ${verifiedPickupCode}`);

    // Verify status via public 2-factor lookup
    const lookupRes = await makeRequest('/api/get-order-status', { method: 'POST' }, {
      orderNumber: advanceOrder.public_order_number,
      mobile: '9840998877'
    });

    assert.strictEqual(lookupRes.status, 200);
    assert.strictEqual(lookupRes.data.order.payment_status, 'PAID');
    assert.strictEqual(lookupRes.data.order.order_status, 'PAID', 'Must remain in confirmed/scheduled state without automatic preparation');
    assert.strictEqual(lookupRes.data.order.pickup_code, verifiedPickupCode);
    console.log('  ✔ Order remains scheduled and confirmed without compulsory kitchen queue.');
  }

  // Test 4: Admin Directly Marks Order Ready for Pickup (No Mandatory Preparing Queue)
  console.log('\nTest 4: Admin Directly Transitions Order to READY_FOR_PICKUP');
  {
    const readyRes = await makeRequest('/api/admin/update-order-status', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      orderId: advanceOrder.order_id,
      newStatus: 'READY_FOR_PICKUP',
      reason: 'Chef finished packaging sweets on morning of pickup'
    });

    assert.strictEqual(readyRes.status, 200, 'Direct transition to READY_FOR_PICKUP must succeed');
    assert.strictEqual(readyRes.data.newStatus, 'READY_FOR_PICKUP');
    console.log('  ✔ Order moved directly to READY_FOR_PICKUP without compulsory preparing queue.');
  }

  // Test 5: Counter Handover & Mark Picked Up Protection
  console.log('\nTest 5: Counter Handover Verification & Mark as Picked Up Action');
  {
    // 5a. Direct transition to PICKED_UP via update-order-status must be forbidden
    const directRes = await makeRequest('/api/admin/update-order-status', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      orderId: advanceOrder.order_id,
      newStatus: 'PICKED_UP'
    });
    assert.strictEqual(directRes.status, 400, 'Direct status modification to PICKED_UP without verification code must be rejected');
    console.log('  ✔ Security guard: Direct update to PICKED_UP is prohibited.');

    // 5b. Incorrect pickup code rejected
    const badCodeRes = await makeRequest('/api/admin/verify-pickup', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      orderId: advanceOrder.order_id,
      pickupCode: 'TNT-PK-0000',
      staffConfirmed: true
    });
    assert.strictEqual(badCodeRes.status, 400);
    assert.strictEqual(badCodeRes.data.code, 'INVALID_CODE');
    console.log('  ✔ Verification guard: Invalid customer pickup code rejected (400)');

    // 5c. Valid pickup handover by zinointech@gmail.com
    const validHandoverRes = await makeRequest('/api/admin/verify-pickup', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      orderId: advanceOrder.order_id,
      pickupCode: verifiedPickupCode,
      staffConfirmed: true
    });
    assert.strictEqual(validHandoverRes.status, 200);
    assert.strictEqual(validHandoverRes.data.publicOrderNumber, advanceOrder.public_order_number);
    assert.strictEqual(validHandoverRes.data.pickedUpBy, 'zinointech@gmail.com');
    assert.ok(validHandoverRes.data.pickedUpAt);
    console.log(`  ✔ Order ${advanceOrder.public_order_number} marked PICKED UP by ${validHandoverRes.data.pickedUpBy}.`);

    // 5d. Duplicate handover attempt rejected (replay attack prevention)
    const duplicateHandoverRes = await makeRequest('/api/admin/verify-pickup', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      orderId: advanceOrder.order_id,
      pickupCode: verifiedPickupCode,
      staffConfirmed: true
    });
    assert.strictEqual(duplicateHandoverRes.status, 400);
    assert.strictEqual(duplicateHandoverRes.data.code, 'ALREADY_PICKED_UP');
    console.log('  ✔ Replay protection: Re-collection of already picked-up order strictly blocked.');
  }

  // Test 6: Verify Metrics and Clean State
  console.log('\nTest 6: Verify Dashboard Metrics and Real Data Calculation');
  {
    const metricsRes = await makeRequest('/api/admin/metrics', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(metricsRes.status, 200);
    const m = metricsRes.data.metrics;
    assert.ok(typeof m.totalOrders === 'number');
    assert.ok(typeof m.paidOrders === 'number');
    assert.ok(typeof m.upcomingPickups === 'number');
    assert.ok(typeof m.readyForPickup === 'number');
    assert.ok(typeof m.pickedUp === 'number');
    assert.ok(m.pickedUp >= 1, 'Our test order is counted in pickedUp');
    assert.strictEqual(m.totalVerifiedRevenueRupees, m.totalVerifiedRevenuePaise / 100);
    console.log(`  ✔ Operational Counts: Total=${m.totalOrders}, Paid=${m.paidOrders}, PickedUp=${m.pickedUp}, Revenue=₹${m.totalVerifiedRevenueRupees}`);
  }

  console.log('\n===============================================================');
  console.log('🎉 ALL STAGE 6 ADVANCE ORDER & ADMIN TESTS PASSED PERFECTLY!');
  console.log('===============================================================');
}

runStage6Tests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
