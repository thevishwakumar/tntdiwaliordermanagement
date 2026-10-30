/**
 * Cloudflare Pages Function
 * Catches all /api/* routes and proxies them to Supabase Edge Functions.
 * Project: bondkwckhnbjslshyflp (ap-south-1)
 *
 * Hardened for 1000+ Concurrent Users & Comprehensive Edge Security:
 * - In-memory sliding-window IP rate limiting
 * - Max payload size guard (64KB DoS prevention)
 * - HTTP method allowlisting
 * - Strict security response headers (HSTS, nosniff, frame protection)
 */

const SUPABASE_PROJECT_REF = 'bondkwckhnbjslshyflp';
const SUPABASE_BASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1`;

const ROUTE_MAP = {
  'config': 'config',
  'create-order': 'create-order',
  'verify-payment': 'verify-payment',
  'get-order-status': 'get-order-status',
  'razorpay-webhook': 'razorpay-webhook',
  'admin/login': 'admin-login',
  'admin/metrics': 'admin-metrics',
  'admin/orders': 'admin-list-orders',
  'admin/verify-pickup': 'admin-verify-pickup',
  'admin/update-order-status': 'admin-update-order-status',
  'admin/products/update': 'admin-products',
  'admin/products': 'admin-products',
  'admin/audit-logs': 'admin-audit-logs'
};

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const MAX_BODY_BYTES = 65536; // 64 KB anti-DoS limit

// In-memory sliding window rate limiter per edge isolate
const rateLimitMap = new Map();
let lastCleanup = Date.now();

function checkRateLimit(clientIp, endpointCategory) {
  // Webhooks are signed with HMAC-SHA256 and should never be rate-limited by IP
  if (endpointCategory === 'webhook') {
    return { allowed: true };
  }

  const now = Date.now();
  if (now - lastCleanup > 60000) {
    for (const [key, record] of rateLimitMap.entries()) {
      if (now > record.resetTime) {
        rateLimitMap.delete(key);
      }
    }
    lastCleanup = now;
  }

  const limits = {
    auth: { max: 20, windowMs: 60000 },      // 20 req/min for admin login
    order: { max: 60, windowMs: 60000 },     // 60 req/min for order checkout
    general: { max: 240, windowMs: 60000 }   // 240 req/min for general browsing/status
  };

  const config = limits[endpointCategory] || limits.general;
  const key = `${clientIp}:${endpointCategory}`;
  const record = rateLimitMap.get(key) || { count: 0, resetTime: now + config.windowMs };

  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + config.windowMs;
    rateLimitMap.set(key, record);
    return { allowed: true };
  }

  record.count++;
  rateLimitMap.set(key, record);

  if (record.count > config.max) {
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // 1. HTTP Method validation
  if (!ALLOWED_METHODS.has(request.method)) {
    return new Response(JSON.stringify({ success: false, message: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Allow': Array.from(ALLOWED_METHODS).join(', ') }
    });
  }

  // 2. Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key, x-razorpay-signature, apikey',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  // 3. Payload size guard (anti-DoS)
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({
      success: false,
      message: 'Payload Too Large: maximum request body is 64KB'
    }), {
      status: 413,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Strip leading /api/
  const apiPath = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');

  // 4. Rate Limiting per Client IP
  const clientIp = request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '127.0.0.1';

  let endpointCategory = 'general';
  if (apiPath === 'admin/login') {
    endpointCategory = 'auth';
  } else if (apiPath === 'create-order' || apiPath === 'verify-payment') {
    endpointCategory = 'order';
  } else if (apiPath === 'razorpay-webhook') {
    endpointCategory = 'webhook';
  }

  const rateCheck = checkRateLimit(clientIp, endpointCategory);
  if (!rateCheck.allowed) {
    return new Response(JSON.stringify({
      success: false,
      message: 'Too Many Requests. Please wait and try again.',
      retryAfterSeconds: rateCheck.retryAfter
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(rateCheck.retryAfter),
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  let functionName = ROUTE_MAP[apiPath];
  let searchParams = url.search;

  // Handle /api/admin/orders/:id -> proxy to admin-list-orders?id=:id
  if (!functionName && apiPath.startsWith('admin/orders/')) {
    const orderId = apiPath.substring('admin/orders/'.length);
    functionName = 'admin-list-orders';
    const params = new URLSearchParams(searchParams);
    params.set('id', orderId);
    searchParams = '?' + params.toString();
  } else if (!functionName) {
    functionName = apiPath.replace(/\//g, '-');
  }

  const targetUrl = `${SUPABASE_BASE_URL}/${functionName}${searchParams}`;

  const forwardHeaders = new Headers(request.headers);
  forwardHeaders.set('Host', `${SUPABASE_PROJECT_REF}.supabase.co`);

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: forwardHeaders,
      body: (request.method !== 'GET' && request.method !== 'HEAD') ? request.body : undefined,
      redirect: 'follow'
    });

    // Clone headers and enforce security policies
    const resHeaders = new Headers(response.headers);
    resHeaders.set('Access-Control-Allow-Origin', '*');
    resHeaders.set('X-Content-Type-Options', 'nosniff');
    resHeaders.set('X-Frame-Options', 'SAMEORIGIN');
    resHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    resHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: resHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Proxy Error',
      message: err.message || 'Failed to connect to backend'
    }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }
}
