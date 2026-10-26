/**
 * TNT Diwali Order Management System
 * Application Configuration & Public Constants
 * 
 * IMPORTANT:
 * - Never expose private service role keys or Razorpay secret keys here.
 * - Public configuration keys are loaded from window.__ENV or fallback configuration.
 */

export const APP_CONFIG = {
  business: {
    name: 'Shree Taste N Taste Catering',
    brand: 'TNT',
    motto: 'Taste N Taste',
    tagline: 'Spreading Sweetness This Diwali',
    tamilTagline: 'தீபாவளி ஸ்வீட் ஆர்டர் வரவேற்கப்படுகிறது',
    contacts: ['9442854444', '7200071040'],
    primaryPhone: '+91 9442854444',
    secondaryPhone: '+91 7200071040',
    email: 'contact@tntcatering.in', // Configurable contact placeholder
    fulfilmentType: 'Customer Pickup Only',
    pickupLocationNote: 'Direct Pickup from Shree Taste N Taste Catering counter',
    pickupAddress: 'Shree Taste N Taste Catering, Shop Counter',
    mapsUrl: 'https://www.google.com/maps/dir/?api=1&destination=Shree+TasteNTaste+Catering&destination_place_id=ChIJMVqvzSL2qDsRREVdON0DlTM',
    mapsPlaceUrl: 'https://maps.google.com/?cid=3716949033379685700',
    mapsEmbedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3916.112166727533!2d76.987673!3d11.0302105!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3ba8f622cb4faa31%3A0x339503dd384d4544!2sShree%20TasteNTaste%20Catering!5e0!3m2!1sen!2sin!4v1793019092675!5m2!1sen!2sin',
    pickupRequirement: 'Customer must present their verified Pickup Code and Order Reference upon collection.',
    operatingNotice: 'Strictly customer pickup. Home delivery and Cash on Delivery (COD) are not available.'
  },

  currency: {
    code: 'INR',
    symbol: '₹',
    locale: 'en-IN'
  },

  limits: {
    minQuantity: 1,
    maxQuantityPerItem: 50,
    maxOrderItems: 10
  },

  // Environment & Backend Configuration
  backend: {
    stage: 'production_ready',
    supabaseUrl: (typeof window !== 'undefined' && window.__ENV && window.__ENV.SUPABASE_URL) || '',
    supabaseAnonKey: (typeof window !== 'undefined' && window.__ENV && window.__ENV.SUPABASE_ANON_KEY) || '',
    razorpayKeyId: (typeof window !== 'undefined' && window.__ENV && window.__ENV.RAZORPAY_KEY_ID) || '',
    apiBaseUrl: (typeof window !== 'undefined' && window.__ENV && window.__ENV.API_BASE_URL) || '/api'
  },

  orderTerms: [
    'Strictly Customer Pickup: Orders must be collected in person from our shop counter.',
    'No Home Delivery or Cash on Delivery (COD) is supported.',
    'Orders are confirmed only after successful online payment verification via Razorpay.',
    'A secure Pickup Code is generated strictly after verified payment and is required for pickup counter verification.',
    'Freshly prepared sweets and savouries are packed carefully for Diwali celebrations.'
  ]
};

/**
 * Checks if live backend and payment credentials have been configured.
 * @returns {boolean}
 */
export function isBackendLive() {
  const { supabaseUrl, supabaseAnonKey, razorpayKeyId } = APP_CONFIG.backend;
  return Boolean(supabaseUrl && supabaseAnonKey && razorpayKeyId);
}

/**
 * Format amounts in Indian Rupees (INR) with Indian grouping (e.g. ₹1,300)
 * @param {number} amount 
 * @returns {string}
 */
export function formatINR(amount) {
  if (typeof amount !== 'number' || isNaN(amount)) {
    return '₹0';
  }
  return new Intl.NumberFormat(APP_CONFIG.currency.locale, {
    style: 'currency',
    currency: APP_CONFIG.currency.code,
    maximumFractionDigits: 0
  }).format(amount);
}

/**
 * Format quantity with its respective unit label
 * @param {number} quantity 
 * @param {string} unit 'kg' | 'combo'
 * @returns {string}
 */
export function formatQuantityUnit(quantity, unit) {
  if (unit === 'combo') {
    return `${quantity} ${quantity === 1 ? 'combo' : 'combos'}`;
  }
  return `${quantity} kg`;
}
