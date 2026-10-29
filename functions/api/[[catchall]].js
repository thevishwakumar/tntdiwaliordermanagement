/**
 * Cloudflare Pages Function
 * Catches all /api/* routes and proxies them to Supabase Edge Functions.
 * Project: bondkwckhnbjslshyflp (ap-south-1)
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

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // Handle CORS preflight
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

  // Strip leading /api/
  const apiPath = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
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

    // Clone headers and ensure CORS is permitted
    const resHeaders = new Headers(response.headers);
    resHeaders.set('Access-Control-Allow-Origin', '*');

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
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
