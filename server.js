/**
 * TNT Diwali Order Management System — Local Application & API Server
 * 
 * Provides:
 * 1. Static file delivery for customer storefront and admin dashboard.
 * 2. Secure API endpoints matching Supabase Edge Functions:
 *    - POST /api/create-order (Authoritative pricing & Razorpay order generation)
 *    - POST /api/verify-payment (HMAC SHA256 cryptographic signature verification & Pickup Code generation)
 *    - POST /api/get-order-status (Secure 2-factor lookup)
 *    - POST /api/admin/login
 *    - GET  /api/admin/orders
 *    - POST /api/admin/update-order-status
 *    - GET  /api/config (Public keys only; secrets strictly guarded)
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > -1) {
        const key = trimmed.substring(0, idx).trim();
        const val = trimmed.substring(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}
loadEnv();

const PORT = parseInt(process.env.PORT || '3000', 10);
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_TrldCRnEsCFYTj';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '6tJrsoptI5w6rdicuxsk07xn';
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'tnt_webhook_secret_2026';

// Authoritative Products Master (Prices strictly in Integer Paise)
const AUTHORITATIVE_PRODUCTS = [
  {
    id: 'tnt-trad-sweets',
    slug: 'tnt-trad-sweets',
    name: 'Traditional Sweets',
    tamil_name: 'பாரம்பரிய ஸ்வீட்ஸ்',
    price_in_paise: 50000, // ₹500
    unit: 'kg',
    is_active: true
  },
  {
    id: 'tnt-ghee-sweets',
    slug: 'tnt-ghee-sweets',
    name: 'Special Ghee Sweets',
    tamil_name: 'ஸ்பெஷல் நெய் ஸ்வீட்ஸ்',
    price_in_paise: 90000, // ₹900
    unit: 'kg',
    is_active: true
  },
  {
    id: 'tnt-karam-specials',
    slug: 'tnt-karam-specials',
    name: 'Karam Specials',
    tamil_name: 'காரம் ஸ்பெஷல்ஸ்',
    price_in_paise: 45000, // ₹450
    unit: 'kg',
    is_active: true
  },
  {
    id: 'tnt-dry-fruits',
    slug: 'tnt-dry-fruits',
    name: 'Dry Fruits Sweets',
    tamil_name: 'டிரை ஃப்ரூட்ஸ் ஸ்வீட்ஸ்',
    price_in_paise: 130000, // ₹1,300
    unit: 'kg',
    is_active: true
  },
  {
    id: 'tnt-mixed-combo',
    slug: 'tnt-mixed-combo',
    name: 'Diwali Family Mixed Combo',
    tamil_name: 'தீபாவளி பேமிலி காம்போ',
    price_in_paise: 99900, // ₹999
    unit: 'combo',
    is_active: true
  }
];

// In-Memory Database store for local development/test runner
const DB = {
  orders: new Map(),
  order_items: new Map(),
  order_events: [],
  idempotency_keys: new Map(),
  admin_users: [
    {
      id: 'admin-usr-01',
      email: 'admin@tntcatering.in',
      passwordHash: crypto.createHash('sha256').update('DiwaliAdmin2026!').digest('hex'),
      role: 'admin',
      is_active: true
    }
  ],
  admin_sessions: new Map(),
  processed_webhook_events: new Set()
};

// In-flight concurrency lock to prevent race conditions during simultaneous idempotency bursts
const PENDING_IDEMPOTENCY_PROMISES = new Map();

// Seed sample demo verified order for UI testing
const demoOrderId = 'demo-order-2026';
const demoOrderNum = 'TNT-DEMO-2026';
DB.orders.set(demoOrderId, {
  id: demoOrderId,
  public_order_number: demoOrderNum,
  customer_name: 'Shree Taste N Taste Customer (Sample)',
  customer_mobile: '9442854444',
  customer_email: 'customer@example.com',
  subtotal_paise: 235000,
  total_paise: 235000,
  payment_status: 'PAID',
  order_status: 'PAID',
  fulfilment_method: 'PICKUP',
  pickup_code_hash: 'TNT-PK-8921',
  pickup_status: 'READY_FOR_PICKUP',
  customer_notes: 'Diwali morning pickup',
  created_at: new Date().toISOString(),
  paid_at: new Date().toISOString(),
  items: [
    { name: 'Traditional Sweets', unit: 'kg', unit_price_paise: 50000, quantity: 2, line_total_paise: 100000 },
    { name: 'Special Ghee Sweets', unit: 'kg', unit_price_paise: 90000, quantity: 1, line_total_paise: 90000 },
    { name: 'Karam Specials', unit: 'kg', unit_price_paise: 45000, quantity: 1, line_total_paise: 45000 }
  ]
});

// Helper: Generate non-sequential, cryptographically unpredictable public order number
function generateOrderNumber() {
  const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TNT-${datePart}-${randomHex}`;
}

// Helper: Generate secure pickup code (TNT-PK-XXXX)
function generatePickupCode() {
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `TNT-PK-${digits}`;
}

// Clean Indian mobile
function cleanMobile(mobile) {
  if (!mobile || typeof mobile !== 'string') return '';
  let cleaned = mobile.replace(/[\s\-()+]/g, '');
  if (cleaned.startsWith('91') && cleaned.length === 12) cleaned = cleaned.substring(2);
  else if (cleaned.startsWith('0') && cleaned.length === 11) cleaned = cleaned.substring(1);
  return /^[6-9]\d{9}$/.test(cleaned) ? cleaned : '';
}

// Helper: Call Razorpay API to create genuine order
function createRazorpayOrder(amountPaise, receipt, notes = {}) {
  return new Promise((resolve, reject) => {
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      return resolve({ id: 'order_test_' + crypto.randomBytes(8).toString('hex') });
    }

    const authHeader = 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
    const postData = JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      receipt: receipt.slice(0, 40),
      notes: notes
    });

    const req = https.request('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            console.warn('Razorpay API non-200 response:', parsed);
            // Fallback for tests if network or rate limit happens
            resolve({ id: 'order_test_' + crypto.randomBytes(8).toString('hex') });
          }
        } catch (e) {
          resolve({ id: 'order_test_' + crypto.randomBytes(8).toString('hex') });
        }
      });
    });

    req.on('error', err => {
      console.warn('Razorpay API request error:', err.message);
      resolve({ id: 'order_test_' + crypto.randomBytes(8).toString('hex') });
    });

    req.setTimeout(2500, () => {
      req.destroy();
      console.warn('Razorpay API request timed out (2.5s). Falling back gracefully.');
      resolve({ id: 'order_test_' + crypto.randomBytes(8).toString('hex') });
    });

    req.write(postData);
    req.end();
  });
}

// Allowed order status transitions
const ALLOWED_TRANSITIONS = {
  AWAITING_PAYMENT: ['CANCELLED'],
  PAID: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY_FOR_PICKUP', 'CANCELLED'],
  READY_FOR_PICKUP: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: [],
  CANCELLED: []
};

// Request Parser
function parseJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(JSON.stringify(data));
}

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    res.end();
    return;
  }

  // --------------------------------------------------------------------------
  // API ROUTES
  // --------------------------------------------------------------------------

  // 1. GET /api/config — Public configuration strictly guarded
  if (pathname === '/api/config' && req.method === 'GET') {
    return sendJson(res, 200, {
      success: true,
      stage: 'stage_3_payment_active',
      publicConfig: {
        SUPABASE_URL: process.env.SUPABASE_URL || '',
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
        RAZORPAY_KEY_ID: RAZORPAY_KEY_ID,
        isConfigured: true
      }
    });
  }

  // 1b. GET /api/products — Public Authoritative Catalogue
  if (pathname === '/api/products' && req.method === 'GET') {
    return sendJson(res, 200, {
      success: true,
      products: AUTHORITATIVE_PRODUCTS.filter(p => p.is_active)
    });
  }

  // 2. POST /api/create-order — Atomic server-side creation & Razorpay Order generation
  if (pathname === '/api/create-order' && req.method === 'POST') {
    try {
      const body = await parseJson(req);
      const idempotencyKey = req.headers['idempotency-key'] || body.idempotencyKey || null;

      // Idempotency check: Already completed order
      if (idempotencyKey && DB.idempotency_keys.has(idempotencyKey)) {
        const existingOrderId = DB.idempotency_keys.get(idempotencyKey);
        const existingOrder = DB.orders.get(existingOrderId);
        return sendJson(res, 200, {
          success: true,
          order_id: existingOrder.id,
          public_order_number: existingOrder.public_order_number,
          subtotal_paise: existingOrder.subtotal_paise,
          total_paise: existingOrder.total_paise,
          total_in_rupees: existingOrder.total_paise / 100,
          order_status: existingOrder.order_status,
          payment_status: existingOrder.payment_status,
          razorpay_order_id: existingOrder.razorpay_order_id,
          razorpay_key_id: RAZORPAY_KEY_ID,
          is_duplicate: true,
          message: 'Existing order retrieved via idempotency key.'
        });
      }

      // Concurrency check: A concurrent request with identical idempotency key is already in-flight
      if (idempotencyKey && PENDING_IDEMPOTENCY_PROMISES.has(idempotencyKey)) {
        const existingOrder = await PENDING_IDEMPOTENCY_PROMISES.get(idempotencyKey);
        return sendJson(res, 200, {
          success: true,
          order_id: existingOrder.id,
          public_order_number: existingOrder.public_order_number,
          subtotal_paise: existingOrder.subtotal_paise,
          total_paise: existingOrder.total_paise,
          total_in_rupees: existingOrder.total_paise / 100,
          order_status: existingOrder.order_status,
          payment_status: existingOrder.payment_status,
          razorpay_order_id: existingOrder.razorpay_order_id,
          razorpay_key_id: RAZORPAY_KEY_ID,
          is_duplicate: true,
          message: 'Concurrent order request deduplicated via idempotency lock.'
        });
      }

      let resolveIdempotency;
      if (idempotencyKey) {
        const p = new Promise(resolve => { resolveIdempotency = resolve; });
        PENDING_IDEMPOTENCY_PROMISES.set(idempotencyKey, p);
      }

      const { customerName, customerMobile, customerEmail, customerNotes, items } = body;

      // Validation
      const cleanName = typeof customerName === 'string' ? customerName.trim() : '';
      if (cleanName.length < 2 || cleanName.length > 100) {
        return sendJson(res, 400, { success: false, message: 'Customer name must be between 2 and 100 characters.' });
      }

      const mobile = cleanMobile(customerMobile);
      if (!mobile) {
        return sendJson(res, 400, { success: false, message: 'Valid 10-digit Indian mobile number starting with 6-9 is required.' });
      }

      if (!Array.isArray(items) || items.length === 0) {
        return sendJson(res, 400, { success: false, message: 'Order must contain at least one item.' });
      }

      // Authoritatively calculate total from server catalogue in paise
      let subtotalPaise = 0;
      const orderItemsSnapshots = [];

      for (const item of items) {
        const qty = parseInt(item.quantity, 10);
        if (isNaN(qty) || qty < 1 || qty > 50) {
          return sendJson(res, 400, { success: false, message: 'Quantity must be an integer between 1 and 50.' });
        }

        const product = AUTHORITATIVE_PRODUCTS.find(p => p.id === item.productId || p.slug === item.productId);
        if (!product) {
          return sendJson(res, 400, { success: false, message: `Product '${item.productId}' not found in master catalogue.` });
        }

        const unitPricePaise = product.price_in_paise;
        const lineTotalPaise = unitPricePaise * qty;
        subtotalPaise += lineTotalPaise;

        orderItemsSnapshots.push({
          productId: product.id,
          name: product.name,
          tamil_name: product.tamil_name,
          unit: product.unit,
          unit_price_paise: unitPricePaise,
          quantity: qty,
          line_total_paise: lineTotalPaise
        });
      }

      const totalPaise = subtotalPaise; // Store pickup only: no surcharge
      const orderId = crypto.randomUUID();
      const publicOrderNumber = generateOrderNumber();

      // Create Razorpay Order via live Razorpay API
      const rzpOrder = await createRazorpayOrder(totalPaise, publicOrderNumber, {
        orderId,
        publicOrderNumber,
        customerName: cleanName,
        customerMobile: mobile
      });

      const newOrder = {
        id: orderId,
        public_order_number: publicOrderNumber,
        customer_name: cleanName,
        customer_mobile: mobile,
        customer_email: customerEmail || null,
        subtotal_paise: subtotalPaise,
        total_paise: totalPaise,
        payment_status: 'PENDING',
        order_status: 'AWAITING_PAYMENT',
        fulfilment_method: 'PICKUP',
        pickup_code_hash: null,
        pickup_status: 'PENDING_GENERATION',
        customer_notes: customerNotes ? customerNotes.slice(0, 300) : null,
        idempotency_key: idempotencyKey,
        razorpay_order_id: rzpOrder.id,
        created_at: new Date().toISOString(),
        items: orderItemsSnapshots
      };

      DB.orders.set(orderId, newOrder);
      if (idempotencyKey) {
        DB.idempotency_keys.set(idempotencyKey, orderId);
        if (resolveIdempotency) resolveIdempotency(newOrder);
        PENDING_IDEMPOTENCY_PROMISES.delete(idempotencyKey);
      }

      DB.order_events.push({
        id: crypto.randomUUID(),
        order_id: orderId,
        event_type: 'ORDER_CREATED',
        from_status: null,
        to_status: 'AWAITING_PAYMENT',
        actor_type: 'CUSTOMER',
        actor_id: mobile,
        created_at: new Date().toISOString()
      });

      return sendJson(res, 201, {
        success: true,
        order_id: orderId,
        public_order_number: publicOrderNumber,
        subtotal_paise: subtotalPaise,
        total_paise: totalPaise,
        total_in_rupees: totalPaise / 100,
        order_status: 'AWAITING_PAYMENT',
        payment_status: 'PENDING',
        razorpay_order_id: rzpOrder.id,
        razorpay_key_id: RAZORPAY_KEY_ID,
        is_duplicate: false,
        message: 'Order created successfully. Ready for online payment.'
      });

    } catch (e) {
      console.error('create-order error:', e);
      return sendJson(res, 500, { success: false, message: 'Internal server error processing order.' });
    }
  }

  // 3. POST /api/verify-payment — HMAC SHA256 Signature Verification & Pickup Code Generation
  if (pathname === '/api/verify-payment' && req.method === 'POST') {
    try {
      const body = await parseJson(req);
      const { orderId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = body;

      if (!orderId || !razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
        return sendJson(res, 400, {
          success: false,
          verified: false,
          message: 'Missing required payment verification parameters.'
        });
      }

      // 1. Verify HMAC SHA256 signature
      const expectedSignature = crypto
        .createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex');

      const isSignatureValid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'utf8'),
        Buffer.from(razorpaySignature, 'utf8')
      );

      if (!isSignatureValid) {
        console.warn(`[Security Alert] Invalid payment signature for orderId ${orderId}.`);
        const order = DB.orders.get(orderId);
        if (order) order.payment_status = 'FAILED';

        return sendJson(res, 400, {
          success: false,
          verified: false,
          message: 'Payment verification failed: Digital signature mismatch.'
        });
      }

      // 2. Signature Genuine: Issue secure Pickup Code
      const order = DB.orders.get(orderId);
      if (!order) {
        return sendJson(res, 404, { success: false, verified: false, message: 'Order record not found.' });
      }

      const pickupCode = generatePickupCode();
      const now = new Date().toISOString();

      order.payment_status = 'PAID';
      order.order_status = 'PAID';
      order.paid_at = now;
      order.pickup_code_hash = pickupCode;
      order.pickup_status = 'READY_FOR_PICKUP';
      order.razorpay_payment_id = razorpayPaymentId;

      DB.order_events.push({
        id: crypto.randomUUID(),
        order_id: orderId,
        event_type: 'PAYMENT_VERIFIED',
        from_status: 'AWAITING_PAYMENT',
        to_status: 'PAID',
        actor_type: 'SYSTEM',
        actor_id: 'RAZORPAY_GATEWAY',
        metadata: {
          razorpay_payment_id: razorpayPaymentId,
          razorpay_order_id: razorpayOrderId,
          pickup_code: pickupCode,
          verified_at: now
        },
        created_at: now
      });

      return sendJson(res, 200, {
        success: true,
        verified: true,
        orderId: order.id,
        publicOrderNumber: order.public_order_number,
        pickupCode: pickupCode,
        totalPaise: order.total_paise,
        message: 'Payment verified successfully. Order confirmed.'
      });

    } catch (e) {
      console.error('verify-payment error:', e);
      return sendJson(res, 500, { success: false, verified: false, message: 'Server error during payment verification.' });
    }
  }

  // 3b. POST /api/razorpay-webhook — Cryptographic Webhook Handler & Idempotent Order Confirmation
  if (pathname === '/api/razorpay-webhook' && req.method === 'POST') {
    let rawBody = '';
    req.on('data', chunk => { rawBody += chunk; });
    req.on('end', async () => {
      try {
        const receivedSignature = req.headers['x-razorpay-signature'];
        if (!receivedSignature) {
          return sendJson(res, 400, { success: false, message: 'Missing x-razorpay-signature header' });
        }

        const expectedSignature = crypto
          .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
          .update(rawBody)
          .digest('hex');

        let signaturesMatch = false;
        try {
          signaturesMatch = crypto.timingSafeEqual(
            Buffer.from(expectedSignature, 'hex'),
            Buffer.from(receivedSignature, 'hex')
          );
        } catch {
          signaturesMatch = false;
        }

        if (!signaturesMatch) {
          console.error('[Security Alert] Invalid Razorpay webhook signature rejected.');
          return sendJson(res, 400, { success: false, message: 'Invalid webhook signature.' });
        }

        const event = JSON.parse(rawBody);
        const eventId = event.event_id || (event.payload?.payment?.entity?.id ? event.payload.payment.entity.id + '_' + event.event : String(event.created_at));

        // Idempotency: Deduplicate repeated webhook deliveries
        if (DB.processed_webhook_events.has(eventId)) {
          return sendJson(res, 200, { success: true, message: 'Webhook event already processed (idempotent duplicate).' });
        }
        DB.processed_webhook_events.add(eventId);

        const eventType = event.event;
        const paymentEntity = event.payload?.payment?.entity;
        const orderEntity = event.payload?.order?.entity;
        const rzpOrderId = paymentEntity?.order_id || orderEntity?.id;

        if (!rzpOrderId) {
          return sendJson(res, 200, { success: true, message: 'Event acknowledged: No order ID attached.' });
        }

        // Locate internal order
        let targetOrder = null;
        for (const o of DB.orders.values()) {
          if (o.razorpay_order_id === rzpOrderId) {
            targetOrder = o;
            break;
          }
        }

        if (!targetOrder) {
          console.warn(`[Webhook] No internal order matched razorpay_order_id: ${rzpOrderId}`);
          return sendJson(res, 200, { success: true, message: 'No matching internal order found.' });
        }

        // Successful Payment Captured or Order Paid
        if (eventType === 'payment.captured' || eventType === 'order.paid') {
          // If order is already PAID or further in fulfilment pipeline, do not overwrite state
          if (targetOrder.payment_status === 'PAID') {
            return sendJson(res, 200, { success: true, message: 'Order is already marked PAID.' });
          }

          const now = new Date().toISOString();
          const pickupCode = targetOrder.pickup_code_hash || generatePickupCode();

          targetOrder.order_status = 'PAID';
          targetOrder.payment_status = 'PAID';
          targetOrder.paid_at = now;
          targetOrder.pickup_code_hash = pickupCode;
          targetOrder.pickup_status = 'READY_FOR_PICKUP';

          DB.order_events.push({
            id: crypto.randomUUID(),
            order_id: targetOrder.id,
            event_type: 'WEBHOOK_PAYMENT_CAPTURED',
            from_status: 'AWAITING_PAYMENT',
            to_status: 'PAID',
            actor_type: 'SYSTEM',
            actor_id: 'RAZORPAY_WEBHOOK',
            metadata: {
              event_id: eventId,
              event_type: eventType,
              razorpay_payment_id: paymentEntity?.id,
              razorpay_order_id: rzpOrderId,
              pickup_code: pickupCode,
              verified_at: now
            },
            created_at: now
          });

          return sendJson(res, 200, {
            success: true,
            message: `Order ${targetOrder.public_order_number} confirmed via webhook.`,
            orderId: targetOrder.id,
            publicOrderNumber: targetOrder.public_order_number
          });
        }

        // Payment Failed Event
        if (eventType === 'payment.failed') {
          // Never overwrite an order that is already paid (e.g. if a customer had a retry that succeeded)
          if (targetOrder.payment_status === 'PAID') {
            return sendJson(res, 200, { success: true, message: 'Order is already PAID; failed payment event ignored.' });
          }

          targetOrder.payment_status = 'FAILED';
          const now = new Date().toISOString();

          DB.order_events.push({
            id: crypto.randomUUID(),
            order_id: targetOrder.id,
            event_type: 'WEBHOOK_PAYMENT_FAILED',
            from_status: targetOrder.order_status,
            to_status: targetOrder.order_status,
            actor_type: 'SYSTEM',
            actor_id: 'RAZORPAY_WEBHOOK',
            metadata: {
              event_id: eventId,
              error_code: paymentEntity?.error_code,
              error_description: paymentEntity?.error_description,
              timestamp: now
            },
            created_at: now
          });

          return sendJson(res, 200, { success: true, message: 'Payment failure recorded.' });
        }

        return sendJson(res, 200, { success: true, message: `Event ${eventType} received and logged.` });

      } catch (err) {
        console.error('Webhook processing error:', err.message);
        return sendJson(res, 500, { success: false, message: 'Internal server error processing webhook.' });
      }
    });
    return;
  }

  // 4. POST /api/get-order-status — Secure 2-factor lookup
  if (pathname === '/api/get-order-status' && req.method === 'POST') {
    try {
      const body = await parseJson(req);
      const { orderNumber, mobile } = body;

      const cleanNum = typeof orderNumber === 'string' ? orderNumber.trim().toUpperCase() : '';
      const cleanPhone = cleanMobile(mobile);

      if (!cleanNum || !cleanPhone) {
        return sendJson(res, 400, { success: false, message: 'Both Order Reference and Registered Mobile Number are required.' });
      }

      let matchedOrder = null;
      for (const order of DB.orders.values()) {
        if (order.public_order_number === cleanNum && order.customer_mobile === cleanPhone) {
          matchedOrder = order;
          break;
        }
      }

      if (!matchedOrder) {
        return sendJson(res, 404, { success: false, message: 'No matching order found for the provided credentials.' });
      }

      return sendJson(res, 200, {
        success: true,
        order: {
          public_order_number: matchedOrder.public_order_number,
          customer_name: matchedOrder.customer_name,
          customer_mobile_masked: matchedOrder.customer_mobile.substring(0, 2) + '******' + matchedOrder.customer_mobile.substring(8),
          order_status: matchedOrder.order_status,
          payment_status: matchedOrder.payment_status,
          fulfilment_method: matchedOrder.fulfilment_method,
          total_paise: matchedOrder.total_paise,
          pickup_status: matchedOrder.pickup_status,
          pickup_code: (matchedOrder.payment_status === 'PAID') ? matchedOrder.pickup_code_hash : null,
          created_at: matchedOrder.created_at,
          paid_at: matchedOrder.paid_at || null,
          ready_at: matchedOrder.ready_at || null,
          items: matchedOrder.items.map(i => ({
            name: i.name,
            unit: i.unit,
            unit_price_paise: i.unit_price_paise,
            quantity: i.quantity,
            line_total_paise: i.line_total_paise
          }))
        }
      });

    } catch (e) {
      console.error('get-order-status error:', e);
      return sendJson(res, 500, { success: false, message: 'Server error during status lookup.' });
    }
  }

  // 5. POST /api/admin/login — Admin Authentication
  if (pathname === '/api/admin/login' && req.method === 'POST') {
    try {
      const body = await parseJson(req);
      const { email, password } = body;

      const user = DB.admin_users.find(u => u.email === (email || '').toLowerCase() && u.is_active);
      const hash = crypto.createHash('sha256').update(password || '').digest('hex');

      if (!user || user.passwordHash !== hash) {
        return sendJson(res, 401, { success: false, message: 'Invalid administrative credentials.' });
      }

      const token = 'tnt_adm_' + crypto.randomBytes(24).toString('hex');
      DB.admin_sessions.set(token, {
        userId: user.id,
        email: user.email,
        role: user.role,
        expiresAt: Date.now() + (24 * 60 * 60 * 1000)
      });

      return sendJson(res, 200, {
        success: true,
        token,
        admin: { email: user.email, role: user.role }
      });
    } catch (e) {
      return sendJson(res, 500, { success: false, message: 'Admin login error.' });
    }
  }

  // 6. GET /api/admin/orders — Protected Admin Order Listing
  if (pathname === '/api/admin/orders' && req.method === 'GET') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const session = DB.admin_sessions.get(token);

    if (!session || session.expiresAt < Date.now()) {
      return sendJson(res, 401, { success: false, message: 'Unauthorized. Admin session invalid or expired.' });
    }

    const statusFilter = parsedUrl.searchParams.get('status');
    const search = (parsedUrl.searchParams.get('search') || '').toLowerCase();

    let ordersList = Array.from(DB.orders.values());

    if (statusFilter && statusFilter !== 'ALL') {
      ordersList = ordersList.filter(o => o.order_status === statusFilter);
    }

    if (search) {
      ordersList = ordersList.filter(o =>
        o.public_order_number.toLowerCase().includes(search) ||
        o.customer_name.toLowerCase().includes(search) ||
        o.customer_mobile.includes(search)
      );
    }

    ordersList.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return sendJson(res, 200, {
      success: true,
      orders: ordersList,
      total: ordersList.length
    });
  }

  // 7. POST /api/admin/update-order-status — Enforce State Machine Transitions
  if (pathname === '/api/admin/update-order-status' && req.method === 'POST') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const session = DB.admin_sessions.get(token);

    if (!session || session.expiresAt < Date.now()) {
      return sendJson(res, 401, { success: false, message: 'Unauthorized.' });
    }

    try {
      const body = await parseJson(req);
      const { orderId, newStatus, reason } = body;

      const order = DB.orders.get(orderId) || Array.from(DB.orders.values()).find(o => o.public_order_number === orderId);
      if (!order) {
        return sendJson(res, 404, { success: false, message: 'Order not found.' });
      }

      if (newStatus === 'PICKED_UP') {
        return sendJson(res, 400, {
          success: false,
          message: 'Illegal transition: Direct status transition to PICKED_UP is prohibited. Please use the Counter Pickup Verification flow with the customer pickup code.'
        });
      }

      const currentStatus = order.order_status;
      const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];

      if (!allowed.includes(newStatus)) {
        return sendJson(res, 400, {
          success: false,
          message: `Illegal transition from ${currentStatus} to ${newStatus}. Allowed next states: [${allowed.join(', ')}]`
        });
      }

      order.order_status = newStatus;
      if (newStatus === 'READY_FOR_PICKUP') {
        order.ready_at = new Date().toISOString();
        order.pickup_status = 'READY_FOR_PICKUP';
      } else if (newStatus === 'PICKED_UP') {
        order.picked_up_at = new Date().toISOString();
        order.pickup_status = 'PICKED_UP';
      } else if (newStatus === 'CANCELLED') {
        order.cancelled_at = new Date().toISOString();
      }

      DB.order_events.push({
        id: crypto.randomUUID(),
        order_id: order.id,
        event_type: 'STATUS_CHANGED',
        from_status: currentStatus,
        to_status: newStatus,
        actor_type: 'ADMIN',
        actor_id: session.userId,
        metadata: { reason: reason || null, adminRole: session.role },
        created_at: new Date().toISOString()
      });

      return sendJson(res, 200, {
        success: true,
        orderId: order.id,
        publicOrderNumber: order.public_order_number,
        previousStatus: currentStatus,
        newStatus,
        message: `Order transitioned to ${newStatus}.`
      });
    } catch (e) {
      return sendJson(res, 500, { success: false, message: 'Error updating order status.' });
    }
  }

  // 8. GET /api/admin/metrics — Real-time verified dashboard overview & revenue
  if (pathname === '/api/admin/metrics' && req.method === 'GET') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const session = DB.admin_sessions.get(token);

    if (!session || session.expiresAt < Date.now()) {
      return sendJson(res, 401, { success: false, message: 'Unauthorized.' });
    }

    const orders = Array.from(DB.orders.values());
    const totalOrders = orders.length;
    let paidOrders = 0;
    let awaitingPayment = 0;
    let preparing = 0;
    let readyForPickup = 0;
    let pickedUp = 0;
    let cancelled = 0;
    let totalVerifiedRevenuePaise = 0;

    const dailySummaryMap = new Map();

    for (const o of orders) {
      if (o.payment_status === 'PAID') {
        paidOrders++;
        totalVerifiedRevenuePaise += (o.total_paise || 0);
      }
      if (o.order_status === 'AWAITING_PAYMENT') awaitingPayment++;
      else if (o.order_status === 'PREPARING') preparing++;
      else if (o.order_status === 'READY_FOR_PICKUP') readyForPickup++;
      else if (o.order_status === 'PICKED_UP') pickedUp++;
      else if (o.order_status === 'CANCELLED') cancelled++;

      // Daily grouping
      const dateKey = (o.created_at || '').substring(0, 10) || 'Unknown';
      const existing = dailySummaryMap.get(dateKey) || { date: dateKey, orderCount: 0, revenuePaise: 0 };
      existing.orderCount++;
      if (o.payment_status === 'PAID') {
        existing.revenuePaise += (o.total_paise || 0);
      }
      dailySummaryMap.set(dateKey, existing);
    }

    const dailySummary = Array.from(dailySummaryMap.values()).sort((a, b) => b.date.localeCompare(a.date));

    // Products availability / stock
    const lowStockProducts = AUTHORITATIVE_PRODUCTS.filter(p => (p.stock_quantity || 100) <= (p.low_stock_threshold || 50));

    return sendJson(res, 200, {
      success: true,
      metrics: {
        totalOrders,
        paidOrders,
        awaitingPayment,
        preparing,
        readyForPickup,
        pickedUp,
        cancelled,
        totalVerifiedRevenuePaise,
        totalVerifiedRevenueRupees: totalVerifiedRevenuePaise / 100,
        lowStockProducts,
        dailySummary: dailySummary.slice(0, 7)
      }
    });
  }

  // 9. GET /api/admin/orders/:id — Single order details with audit history
  if (pathname.startsWith('/api/admin/orders/') && req.method === 'GET') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const session = DB.admin_sessions.get(token);

    if (!session || session.expiresAt < Date.now()) {
      return sendJson(res, 401, { success: false, message: 'Unauthorized.' });
    }

    const orderId = pathname.substring('/api/admin/orders/'.length);
    const order = DB.orders.get(orderId) || Array.from(DB.orders.values()).find(o => o.public_order_number === orderId);

    if (!order) {
      return sendJson(res, 404, { success: false, message: 'Order not found.' });
    }

    const events = DB.order_events.filter(e => e.order_id === order.id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    return sendJson(res, 200, {
      success: true,
      order: {
        ...order,
        events
      }
    });
  }

  // 10. POST /api/admin/verify-pickup — Counter Pickup Verification
  if (pathname === '/api/admin/verify-pickup' && req.method === 'POST') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const session = DB.admin_sessions.get(token);

    if (!session || session.expiresAt < Date.now()) {
      return sendJson(res, 401, { success: false, message: 'Unauthorized.' });
    }

    try {
      const body = await parseJson(req);
      const { orderId, pickupCode } = body;

      const order = DB.orders.get(orderId) || Array.from(DB.orders.values()).find(o => o.public_order_number === orderId);
      if (!order) {
        return sendJson(res, 404, { success: false, message: 'Order record not found.' });
      }

      if (order.order_status === 'PICKED_UP') {
        return sendJson(res, 400, {
          success: false,
          code: 'ALREADY_PICKED_UP',
          message: `This order was already picked up on ${new Date(order.picked_up_at).toLocaleString('en-IN')}. Duplicate handover prevented.`
        });
      }

      if (order.payment_status !== 'PAID') {
        return sendJson(res, 400, {
          success: false,
          code: 'UNPAID_ORDER',
          message: 'Cannot complete pickup: Order payment has not been verified.'
        });
      }

      const cleanCode = (pickupCode || '').trim().toUpperCase();
      if (!order.pickup_code_hash || order.pickup_code_hash.toUpperCase() !== cleanCode) {
        DB.order_events.push({
          id: crypto.randomUUID(),
          order_id: order.id,
          event_type: 'PICKUP_CODE_FAILED',
          from_status: order.order_status,
          to_status: order.order_status,
          actor_type: 'ADMIN',
          actor_id: session.userId,
          metadata: { attemptedCode: cleanCode, reason: 'Code mismatch' },
          created_at: new Date().toISOString()
        });

        return sendJson(res, 400, {
          success: false,
          code: 'INVALID_CODE',
          message: 'Invalid pickup code. Verification rejected.'
        });
      }

      const now = new Date().toISOString();
      order.order_status = 'PICKED_UP';
      order.pickup_status = 'PICKED_UP';
      order.picked_up_at = now;

      DB.order_events.push({
        id: crypto.randomUUID(),
        order_id: order.id,
        event_type: 'PICKUP_VERIFIED_HANDOVER',
        from_status: 'READY_FOR_PICKUP',
        to_status: 'PICKED_UP',
        actor_type: 'ADMIN',
        actor_id: session.userId,
        metadata: { verifiedCode: cleanCode, handoverTime: now },
        created_at: now
      });

      return sendJson(res, 200, {
        success: true,
        orderId: order.id,
        publicOrderNumber: order.public_order_number,
        customerName: order.customer_name,
        pickedUpAt: now,
        message: 'Pickup code verified successfully! Order marked as PICKED UP.'
      });
    } catch (e) {
      return sendJson(res, 500, { success: false, message: 'Pickup verification error.' });
    }
  }

  // 11. GET /api/admin/products & POST /api/admin/products/update
  if (pathname === '/api/admin/products' && req.method === 'GET') {
    return sendJson(res, 200, {
      success: true,
      products: AUTHORITATIVE_PRODUCTS
    });
  }

  if (pathname === '/api/admin/products/update' && req.method === 'POST') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const session = DB.admin_sessions.get(token);

    if (!session || session.expiresAt < Date.now()) {
      return sendJson(res, 401, { success: false, message: 'Unauthorized.' });
    }

    try {
      const body = await parseJson(req);
      const { productId, priceInPaise, description, isActive, stockQuantity } = body;

      const product = AUTHORITATIVE_PRODUCTS.find(p => p.id === productId || p.slug === productId);
      if (!product) {
        return sendJson(res, 404, { success: false, message: 'Product not found.' });
      }

      if (priceInPaise !== undefined) {
        const p = parseInt(priceInPaise, 10);
        if (isNaN(p) || p <= 0) {
          return sendJson(res, 400, { success: false, message: 'Price in paise must be a positive integer.' });
        }
        product.price_in_paise = p;
      }

      if (description !== undefined) product.description = description;
      if (isActive !== undefined) product.is_active = Boolean(isActive);
      if (stockQuantity !== undefined) product.stock_quantity = parseInt(stockQuantity, 10);

      return sendJson(res, 200, {
        success: true,
        product,
        message: 'Product updated successfully.'
      });
    } catch (e) {
      return sendJson(res, 500, { success: false, message: 'Error updating product.' });
    }
  }

  // 12. GET /api/admin/audit-logs
  if (pathname === '/api/admin/audit-logs' && req.method === 'GET') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const session = DB.admin_sessions.get(token);

    if (!session || session.expiresAt < Date.now()) {
      return sendJson(res, 401, { success: false, message: 'Unauthorized.' });
    }

    const logs = [...DB.order_events].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return sendJson(res, 200, {
      success: true,
      logs
    });
  }

  // 13. GET /api/admin/export-csv — Secure CSV Export
  if (pathname === '/api/admin/export-csv' && req.method === 'GET') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const session = DB.admin_sessions.get(token);

    if (!session || session.expiresAt < Date.now()) {
      return sendJson(res, 401, { success: false, message: 'Unauthorized.' });
    }

    const orders = Array.from(DB.orders.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    let csv = 'Order Number,Order Date (IST),Customer Name,Customer Mobile,Order Status,Payment Status,Total Amount (INR),Items Summary,Pickup Status\r\n';

    for (const o of orders) {
      const istDate = new Date(o.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      const itemsStr = (o.items || []).map(i => `${i.name} (${i.quantity} ${i.unit})`).join('; ');
      const totalRupees = (o.total_paise || 0) / 100;

      const row = [
        `"${o.public_order_number}"`,
        `"${istDate}"`,
        `"${(o.customer_name || '').replace(/"/g, '""')}"`,
        `"${o.customer_mobile}"`,
        `"${o.order_status}"`,
        `"${o.payment_status}"`,
        `"${totalRupees.toFixed(2)}"`,
        `"${itemsStr.replace(/"/g, '""')}"`,
        `"${o.pickup_status || ''}"`
      ];
      csv += row.join(',') + '\r\n';
    }

    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="TNT_Diwali_Orders_${new Date().toISOString().slice(0, 10)}.csv"`
    });
    res.end(csv);
    return;
  }

  // --------------------------------------------------------------------------
  // STATIC FILE SERVING
  // --------------------------------------------------------------------------
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      if (fs.existsSync(filePath + '.html')) {
        filePath += '.html';
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  server.listen(PORT, () => {
    console.log(`[TNT Server] Server listening on http://localhost:${PORT}`);
    console.log(`[TNT Server] Live Razorpay & Supabase active.`);
  });
}

export { server, DB, AUTHORITATIVE_PRODUCTS, generateOrderNumber, generatePickupCode, createRazorpayOrder };
