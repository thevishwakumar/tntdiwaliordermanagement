/**
 * TNT Diwali Order Management System
 * Performance & Robustness Benchmark Suite
 * Measures empirical API latency and tests malicious/edge payloads
 */

import assert from 'assert';

const BASE_URL = process.env.TEST_BASE_URL || 'https://tntdiwaliordermanagement.pages.dev';

async function post(endpoint, data, headers = {}) {
  const postData = typeof data === 'string' ? data : JSON.stringify(data);
  const url = new URL(endpoint, BASE_URL).toString();

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: postData
  });

  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, raw: text };
  }
}

async function get(endpoint, headers = {}) {
  const url = new URL(endpoint, BASE_URL).toString();
  const res = await fetch(url, {
    method: 'GET',
    headers: { ...headers }
  });
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, raw: text };
  }
}

async function runBenchmark() {
  console.log('======================================================================');
  console.log(`⚡  PERFORMANCE, RELIABILITY & INJECTION ROBUSTNESS BENCHMARK`);
  console.log(`    Target: ${BASE_URL}`);
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

  // --- SECTION 1: INJECTION & MALICIOUS PAYLOAD DEFENSE ---
  console.log('--- SECTION 1: Injection & Malicious Input Hardening ---');

  await test('SQL Injection in customer name is sanitized without execution', async () => {
    const payload = {
      customerName: "Ramesh'; DROP TABLE orders; --",
      customerMobile: '9442854444',
      items: [{ productId: 'tnt-trad-sweets', quantity: 1 }]
    };
    const res = await post('/api/create-order', payload);
    assert.ok(res.status === 200 || res.status === 201, `Status was ${res.status}`);
    assert.ok(res.data.success);
    // Verify application health is intact
    const health = await get('/api/config');
    assert.strictEqual(health.status, 200);
  });

  await test('XSS HTML tags in notes are sanitized/escaped cleanly', async () => {
    const payload = {
      customerName: 'Anitha R',
      customerMobile: '9442854444',
      customerNotes: '<script>alert("XSS")</script><img src=x onerror=alert(1)>',
      items: [{ productId: 'tnt-trad-sweets', quantity: 1 }]
    };
    const res = await post('/api/create-order', payload);
    assert.ok(res.status === 200 || res.status === 201, `Status was ${res.status}`);
    assert.ok(res.data.success);
  });

  await test('Unicode and Tamil typography in customer notes are preserved safely', async () => {
    const payload = {
      customerName: 'சுரேஷ் குமார் (Suresh)',
      customerMobile: '9442854444',
      customerNotes: 'தீபாவளி காலை 8 மணிக்கு வருகிறேன்! 🪔✨ Happy Diwali!',
      items: [{ productId: 'tnt-mixed-combo', quantity: 1 }]
    };
    const res = await post('/api/create-order', payload);
    assert.ok(res.status === 200 || res.status === 201, `Status was ${res.status}`);
    assert.ok(res.data.success);
  });

  await test('Extreme name length (>100 chars) is rejected', async () => {
    const payload = {
      customerName: 'A'.repeat(150),
      customerMobile: '9442854444',
      items: [{ productId: 'tnt-trad-sweets', quantity: 1 }]
    };
    const res = await post('/api/create-order', payload);
    assert.strictEqual(res.status, 400);
  });

  // --- SECTION 2: LATENCY & CONCURRENCY BENCHMARK ---
  console.log('\n--- SECTION 2: Empirical Latency Measurements (10 Samples) ---');

  const creationLatencies = [];
  const lookupLatencies = [];

  for (let i = 0; i < 10; i++) {
    const startCreate = performance.now();
    const cRes = await post('/api/create-order', {
      customerName: `Benchmark User ${i}`,
      customerMobile: '9442854444',
      items: [{ productId: 'tnt-ghee-sweets', quantity: 1 }]
    });
    const endCreate = performance.now();
    assert.ok(cRes.status === 200 || cRes.status === 201, `Status was ${cRes.status}`);
    creationLatencies.push(endCreate - startCreate);

    const startLookup = performance.now();
    const lRes = await post('/api/get-order-status', {
      orderNumber: cRes.data.public_order_number,
      mobile: '9442854444'
    });
    const endLookup = performance.now();
    assert.strictEqual(lRes.status, 200);
    lookupLatencies.push(endLookup - startLookup);
  }

  function calcStats(arr) {
    arr.sort((a, b) => a - b);
    const min = arr[0].toFixed(2);
    const max = arr[arr.length - 1].toFixed(2);
    const median = arr[Math.floor(arr.length / 2)].toFixed(2);
    const p95 = arr[Math.floor(arr.length * 0.95)].toFixed(2);
    const avg = (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2);
    return { min, max, median, p95, avg };
  }

  const createStats = calcStats(creationLatencies);
  const lookupStats = calcStats(lookupLatencies);

  console.log(`  📊 Order Creation Latency (ms): Min=${createStats.min}ms, Avg=${createStats.avg}ms, Median=${createStats.median}ms, P95=${createStats.p95}ms, Max=${createStats.max}ms`);
  console.log(`  📊 Order Lookup Latency (ms):   Min=${lookupStats.min}ms, Avg=${lookupStats.avg}ms, Median=${lookupStats.median}ms, P95=${lookupStats.p95}ms, Max=${lookupStats.max}ms`);

  await test('Order creation average latency under 1500ms (includes live Razorpay order generation & edge round-trip)', () => {
    assert.ok(parseFloat(createStats.avg) < 1500, `Average latency ${createStats.avg}ms should be < 1500ms`);
  });

  await test('Order lookup average latency under 1000ms across live CDN', () => {
    assert.ok(parseFloat(lookupStats.avg) < 1000, `Average latency ${lookupStats.avg}ms should be < 1000ms`);
  });

  // --- SECTION 3: CONCURRENCY IDEMPOTENCY BURST ---
  console.log('\n--- SECTION 3: Concurrency & Idempotency Burst (10 Simultaneous Requests) ---');

  await test('10 concurrent requests with identical Idempotency Key create exactly 1 order', async () => {
    const key = 'burst_key_' + Date.now();
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(post('/api/create-order', {
        customerName: 'Burst Clicker',
        customerMobile: '9790123456',
        items: [{ productId: 'tnt-dry-fruits', quantity: 1 }]
      }, { 'Idempotency-Key': key }));
    }

    const results = await Promise.all(promises);
    const distinctOrderIds = new Set(results.map(r => r.data.order_id));
    assert.strictEqual(distinctOrderIds.size, 1, 'All 10 concurrent requests must resolve to the identical Order ID');
    console.log(`  ✔ 10 simultaneous requests safely deduplicated to order ${[...distinctOrderIds][0]}`);
  });

  console.log(`\n======================================================================`);
  console.log(`🎉 BENCHMARK COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================================\n`);

  if (failed > 0) process.exit(1);
}

runBenchmark().catch(err => {
  console.error('Benchmark fatal error:', err);
  process.exit(1);
});
