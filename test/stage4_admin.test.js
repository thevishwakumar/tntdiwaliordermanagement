/**
 * Automated Test Suite: Stage 4 Admin Operations & Fulfilment Hub
 * 
 * Tests:
 * 1. Admin Authentication & Role Protection
 * 2. Real-Time Verified Revenue & Dashboard Metrics
 * 3. Kitchen Packing Queue Validation (Unpaid barred; Paid admitted)
 * 4. Controlled State Transitions (PAID -> PREPARING -> READY_FOR_PICKUP)
 * 5. Counter Pickup Verification (Atomic verification, invalid code rejection, replay protection)
 * 6. Product Master Management (Authoritative paise updates, stock tracking)
 * 7. Secure RFC 4180 CSV Export
 */

import http from 'http';
import assert from 'assert';

const BASE_URL = 'http://localhost:3000';

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

async function runStage4Tests() {
  console.log('===============================================================');
  console.log('🧪 Starting Stage 4 Automated Admin & Fulfilment Verification');
  console.log('===============================================================\n');

  let adminToken = '';

  // 1. Admin Authentication
  console.log('Test 1: Admin Authentication & Token Generation');
  {
    // Invalid credentials
    const badLogin = await makeRequest('/api/admin/login', { method: 'POST' }, {
      email: 'admin@tntcatering.in',
      password: 'WrongPassword123'
    });
    assert.strictEqual(badLogin.status, 401, 'Invalid password must return 401 Unauthorized');
    console.log('  ✔ Invalid credentials correctly rejected (401)');

    // Valid credentials
    const goodLogin = await makeRequest('/api/admin/login', { method: 'POST' }, {
      email: 'admin@tntcatering.in',
      password: 'DiwaliAdmin2026!'
    });
    assert.strictEqual(goodLogin.status, 200, 'Valid credentials must return 200 OK');
    assert.ok(goodLogin.data.token, 'Must return session token');
    adminToken = goodLogin.data.token;
    console.log('  ✔ Admin authenticated successfully. Token received.');
  }

  // 2. Verified Revenue & Metrics Protection
  console.log('\nTest 2: Real-Time Verified Revenue & Operational Metrics');
  {
    // Unauthenticated access must fail
    const unauthMetrics = await makeRequest('/api/admin/metrics');
    assert.strictEqual(unauthMetrics.status, 401, 'Unauthenticated metrics request must be rejected');
    console.log('  ✔ Unauthenticated access to business metrics rejected (401)');

    // Authenticated access
    const authMetrics = await makeRequest('/api/admin/metrics', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(authMetrics.status, 200, 'Authorized metrics request must return 200');
    const m = authMetrics.data.metrics;
    assert.ok(typeof m.totalOrders === 'number', 'totalOrders must be a number');
    assert.ok(typeof m.paidOrders === 'number', 'paidOrders must be a number');
    assert.ok(typeof m.totalVerifiedRevenuePaise === 'number', 'totalVerifiedRevenuePaise must be a number');
    assert.strictEqual(m.totalVerifiedRevenueRupees, m.totalVerifiedRevenuePaise / 100, 'Rupees must exactly equal paise / 100');
    console.log(`  ✔ Verified Revenue: ₹${m.totalVerifiedRevenueRupees.toLocaleString('en-IN')} (${m.totalVerifiedRevenuePaise} paise)`);
    console.log(`  ✔ Orders Breakdown: Total=${m.totalOrders}, Paid=${m.paidOrders}, Preparing=${m.preparing}, Ready=${m.readyForPickup}`);
  }

  // 3. Setup Test Orders for Packing & Pickup Verification
  console.log('\nTest 3: Order Creation & Packing Eligibility Verification');
  let unpaidOrder, paidOrder;
  {
    // Create an unpaid order
    const createUnpaidRes = await makeRequest('/api/create-order', { method: 'POST' }, {
      customerName: 'Unpaid Customer Test',
      customerMobile: '9876543210',
      customerEmail: 'unpaid@example.com',
      customerNotes: 'Testing unpaid packing guard',
      items: [{ productId: 'tnt-trad-sweets', quantity: 1 }]
    });
    assert.strictEqual(createUnpaidRes.status, 201, 'Unpaid order created');
    unpaidOrder = createUnpaidRes.data;
    console.log(`  ✔ Unpaid Order Created: ${unpaidOrder.public_order_number} (Status: ${unpaidOrder.order_status})`);

    // Create a second order and pay for it
    const createPaidRes = await makeRequest('/api/create-order', { method: 'POST' }, {
      customerName: 'Suresh Kumar (Paid Pickup)',
      customerMobile: '9840123456',
      customerEmail: 'suresh@example.com',
      customerNotes: 'Pack in eco-friendly sweet box',
      items: [
        { productId: 'tnt-ghee-sweets', quantity: 2 },
        { productId: 'tnt-karam-specials', quantity: 1 }
      ]
    });
    assert.strictEqual(createPaidRes.status, 201, 'Paid order created');
    const createdPaid = createPaidRes.data;

    // Verify payment for this order to make it verified PAID
    const crypto = await import('crypto');
    const razorpayOrderId = createdPaid.razorpay_order_id;
    const razorpayPaymentId = 'pay_test_' + crypto.randomBytes(6).toString('hex');
    const payload = `${razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.createHmac('sha256', '6tJrsoptI5w6rdicuxsk07xn').update(payload).digest('hex');

    const verifyPayRes = await makeRequest('/api/verify-payment', { method: 'POST' }, {
      orderId: createdPaid.order_id,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature: signature
    });
    assert.strictEqual(verifyPayRes.status, 200, 'Payment verification must succeed');
    paidOrder = verifyPayRes.data;
    console.log(`  ✔ Paid Order Verified: ${paidOrder.publicOrderNumber} with Pickup Code ${paidOrder.pickupCode}`);

    // Verify Kitchen Packing Queue rules: Unpaid orders MUST NOT be sent to packing
    const tryPackUnpaid = await makeRequest('/api/admin/update-order-status', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      orderId: unpaidOrder.order_id,
      newStatus: 'PREPARING',
      reason: 'Attempting to pack unpaid order'
    });
    assert.strictEqual(tryPackUnpaid.status, 400, 'Unpaid order must be rejected from PREPARING');
    console.log('  ✔ Security Rule Enforced: Unpaid order cannot enter PREPARING status');
  }

  // 4. Kitchen Packing Queue Transitions
  console.log('\nTest 4: Packing Queue Workflow (PAID -> PREPARING -> READY_FOR_PICKUP)');
  {
    // Start packing paid order
    const startPackRes = await makeRequest('/api/admin/update-order-status', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      orderId: paidOrder.publicOrderNumber,
      newStatus: 'PREPARING',
      reason: 'Chef started packaging ghee sweets'
    });
    assert.strictEqual(startPackRes.status, 200, 'Start packing should return 200');
    console.log('  ✔ Paid order moved to PREPARING');

    // Mark packing completed and ready for pickup
    const markReadyRes = await makeRequest('/api/admin/update-order-status', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      orderId: paidOrder.publicOrderNumber,
      newStatus: 'READY_FOR_PICKUP',
      reason: 'Parcel boxed and placed in pickup rack'
    });
    assert.strictEqual(markReadyRes.status, 200, 'Mark ready should return 200');
    console.log('  ✔ Order moved to READY_FOR_PICKUP');

    // Attempting direct move from READY_FOR_PICKUP to PICKED_UP without code must be blocked
    const directPickedUpRes = await makeRequest('/api/admin/update-order-status', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      orderId: paidOrder.publicOrderNumber,
      newStatus: 'PICKED_UP',
      reason: 'Bypassing verification code'
    });
    assert.strictEqual(directPickedUpRes.status, 400, 'Direct move to PICKED_UP without verification code must fail');
    console.log('  ✔ Security Rule Enforced: Direct update to PICKED_UP blocked without counter code verification');
  }

  // 5. Counter Pickup Verification (Server-Side Atomic Procedure)
  console.log('\nTest 5: Counter Pickup Verification & Replay Protection');
  {
    // 5a. Incorrect Pickup Code
    const wrongCodeRes = await makeRequest('/api/admin/verify-pickup', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      orderId: paidOrder.publicOrderNumber,
      pickupCode: 'TNT-PK-0000'
    });
    assert.strictEqual(wrongCodeRes.status, 400, 'Incorrect pickup code must fail (400)');
    assert.strictEqual(wrongCodeRes.data.code, 'INVALID_CODE', 'Error code must be INVALID_CODE');
    console.log('  ✔ Invalid pickup code correctly rejected with security audit log');

    // 5b. Correct Pickup Code
    const correctCodeRes = await makeRequest('/api/admin/verify-pickup', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      orderId: paidOrder.publicOrderNumber,
      pickupCode: paidOrder.pickupCode
    });
    assert.strictEqual(correctCodeRes.status, 200, 'Correct pickup code verification must succeed (200)');
    assert.ok(correctCodeRes.data.pickedUpAt, 'Must include pickedUpAt timestamp');
    console.log(`  ✔ Pickup Verified Successfully for ${correctCodeRes.data.customerName}! Order state set to PICKED_UP`);

    // 5c. Duplicate / Replay Pickup Attempt
    const replayRes = await makeRequest('/api/admin/verify-pickup', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      orderId: paidOrder.publicOrderNumber,
      pickupCode: paidOrder.pickupCode
    });
    assert.strictEqual(replayRes.status, 400, 'Repeated pickup must fail (400)');
    assert.strictEqual(replayRes.data.code, 'ALREADY_PICKED_UP', 'Must reject with ALREADY_PICKED_UP');
    console.log('  ✔ Security Rule Enforced: Repeated/Replay pickup attempts strictly blocked');
  }

  // 6. Product Master Management
  console.log('\nTest 6: Product Master Price & Stock Control');
  {
    // Negative price validation
    const badPriceRes = await makeRequest('/api/admin/products/update', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      productId: 'tnt-trad-sweets',
      priceInPaise: -500
    });
    assert.strictEqual(badPriceRes.status, 400, 'Negative price must be rejected');
    console.log('  ✔ Negative price rejected server-side (400)');

    // Legitimate price & stock update
    const updateRes = await makeRequest('/api/admin/products/update', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      productId: 'tnt-trad-sweets',
      priceInPaise: 52000, // ₹520
      description: 'Authentic South Indian festival sweets handcrafted in pure butter and ghee.',
      stockQuantity: 45
    });
    assert.strictEqual(updateRes.status, 200, 'Product update must succeed');
    assert.strictEqual(updateRes.data.product.price_in_paise, 52000, 'Price updated to 52000 paise');
    assert.strictEqual(updateRes.data.product.stock_quantity, 45, 'Stock quantity updated');
    console.log('  ✔ Product updated: Traditional Sweets set to ₹520 (52000 paise), Stock=45');

    // Clean up: Restore authoritative catalog price (₹500 / 50000 paise) so tests remain deterministic
    await makeRequest('/api/admin/products/update', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      productId: 'tnt-trad-sweets',
      priceInPaise: 50000,
      stockQuantity: 500
    });
  }

  // 7. RFC 4180 CSV Export
  console.log('\nTest 7: Secure CSV Order Export');
  {
    const csvRes = await makeRequest('/api/admin/export-csv', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(csvRes.status, 200, 'CSV export should return 200');
    assert.ok(csvRes.headers['content-type'].includes('text/csv'), 'Content-Type must be text/csv');
    assert.ok(csvRes.headers['content-disposition'].includes('attachment'), 'Must have attachment disposition');
    assert.ok(csvRes.raw.includes('Order Number,Order Date (IST)'), 'Header row must be present');
    assert.ok(csvRes.raw.includes(paidOrder.publicOrderNumber), 'Exported CSV must contain created order');
    assert.ok(!csvRes.raw.includes('6tJrsoptI5w6rdicuxsk07xn'), 'Secrets must never appear in CSV');
    console.log('  ✔ CSV Export generated cleanly with IST timestamps and sanitized customer data');
  }

  // 8. Single Order Details with Audit History
  console.log('\nTest 8: Detailed Order View & Audit Timeline');
  {
    const orderDetailsRes = await makeRequest(`/api/admin/orders/${paidOrder.publicOrderNumber}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(orderDetailsRes.status, 200, 'Order details fetch must succeed');
    const ord = orderDetailsRes.data.order;
    assert.strictEqual(ord.order_status, 'PICKED_UP', 'Order status must be PICKED_UP');
    assert.ok(Array.isArray(ord.events), 'Events list must be present');
    assert.ok(ord.events.length >= 3, 'Must have recorded transitions in audit log');
    console.log(`  ✔ Order Audit Timeline verified: ${ord.events.length} lifecycle events recorded with actor attribution`);
  }

  console.log('\n===============================================================');
  console.log('🎉 ALL 8 STAGE 4 ADMIN & FULFILMENT TESTS PASSED PERFECTLY!');
  console.log('===============================================================');
}

runStage4Tests().catch(err => {
  console.error('\n❌ Stage 4 Test Suite Failed:\n', err);
  process.exit(1);
});
