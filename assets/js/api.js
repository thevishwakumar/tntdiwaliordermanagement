/**
 * TNT Diwali Order Management System
 * Backend & Payment API Integration Client (Stage 2)
 * 
 * Target Backend: Supabase (PostgreSQL + RLS + Edge Functions)
 * Local Turnkey API: /api/create-order, /api/get-order-status, /api/config
 * 
 * RULES COMPLIANCE:
 * - Authoritative pricing strictly computed server-side in integer paise.
 * - Idempotency key included on order creation to prevent duplicate submissions.
 * - Zero fake payment success.
 * - Order status lookup requires matching Order Number AND Mobile.
 */

import { APP_CONFIG } from './config.js';

export class OrderAPI {
  /**
   * Fetch runtime public configuration from server
   * @returns {Promise<object>}
   */
  static async getRuntimeConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        if (data.publicConfig) {
          if (data.publicConfig.SUPABASE_URL) APP_CONFIG.backend.supabaseUrl = data.publicConfig.SUPABASE_URL;
          if (data.publicConfig.SUPABASE_ANON_KEY) APP_CONFIG.backend.supabaseAnonKey = data.publicConfig.SUPABASE_ANON_KEY;
          if (data.publicConfig.RAZORPAY_KEY_ID) APP_CONFIG.backend.razorpayKeyId = data.publicConfig.RAZORPAY_KEY_ID;
        }
        return data;
      }
    } catch (e) {
      console.warn('Could not fetch runtime config from /api/config:', e);
    }
    return { success: false };
  }

  /**
   * Check backend status
   */
  static getStatus() {
    return {
      isLive: true,
      stage: 'Stage 2 (Supabase Backend, Authoritative Pricing & Edge Functions)',
      notice: 'Backend order processing active with authoritative paise pricing and idempotency guards.'
    };
  }

  /**
   * Initiate an order on the server.
   * Server validates customer fields, calculates authoritative total in paise,
   * enforces idempotency, and records initial AWAITING_PAYMENT state.
   * 
   * @param {object} payload 
   * @returns {Promise<{success: boolean, orderId?: string, publicOrderNumber?: string, totalPaise?: number, totalRupees?: number, isDuplicate?: boolean, message: string}>}
   */
  static async createOrder(payload) {
    const idempotencyKey = payload.idempotencyKey || ('idemp_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36));

    const requestPayload = {
      customerName: payload.customer.fullName,
      customerMobile: payload.customer.mobile,
      customerEmail: payload.customer.email || null,
      customerNotes: payload.customer.notes || null,
      fulfilmentMethod: payload.fulfilmentMethod || payload.customer?.fulfilmentMethod || 'PICKUP',
      deliveryAddress: payload.deliveryAddress || payload.customer?.deliveryAddress || null,
      pickupDate: payload.pickupDate || payload.customer.pickupDate || null,
      pickupTime: payload.pickupTime || payload.customer.pickupTime || null,
      items: payload.items.map(item => ({
        productId: item.productId,
        quantity: item.quantity
      })),
      idempotencyKey
    };

    try {
      const response = await fetch('/api/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(requestPayload)
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        return {
          success: false,
          code: 'ORDER_CREATION_FAILED',
          message: data.message || `Order creation failed with status ${response.status}.`
        };
      }

      return {
        success: true,
        orderId: data.order_id || data.orderId,
        publicOrderNumber: data.public_order_number || data.publicOrderNumber,
        totalPaise: data.total_paise || data.totalPaise,
        totalRupees: data.total_in_rupees || ((data.total_paise || data.totalPaise) / 100),
        orderStatus: data.order_status || data.orderStatus,
        paymentStatus: data.payment_status || data.paymentStatus,
        razorpayOrderId: data.razorpayOrderId || data.razorpay_order_id,
        razorpayKeyId: data.razorpayKeyId || data.razorpay_key_id || APP_CONFIG.backend.razorpayKeyId,
        isDuplicate: Boolean(data.is_duplicate || data.isDuplicate),
        message: data.message || 'Order created successfully on server.'
      };

    } catch (error) {
      console.error('Error during createOrder API call:', error);
      return {
        success: false,
        code: 'NETWORK_ERROR',
        message: 'Unable to communicate with order processing server. Please check your connection.'
      };
    }
  }

  /**
   * Verify server-side payment signature cryptographically
   * @param {object} payload { orderId, razorpayPaymentId, razorpayOrderId, razorpaySignature }
   * @returns {Promise<{success: boolean, verified: boolean, pickupCode?: string, publicOrderNumber?: string, message: string}>}
   */
  static async verifyPayment(payload) {
    try {
      const response = await fetch('/api/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success || !data.verified) {
        return {
          success: false,
          verified: false,
          message: data.message || 'Payment signature verification failed.'
        };
      }

      return {
        success: true,
        verified: true,
        orderId: data.orderId,
        publicOrderNumber: data.publicOrderNumber,
        pickupCode: data.pickupCode,
        message: data.message || 'Payment verified successfully.'
      };
    } catch (e) {
      console.error('verifyPayment error:', e);
      return {
        success: false,
        verified: false,
        message: 'Could not connect to payment verification endpoint.'
      };
    }
  }

  /**
   * Secure Order Status Lookup
   * Enforces 2-factor match: Order Reference + Customer Registered Mobile Number.
   * 
   * @param {string} orderRef 
   * @param {string} mobile 
   * @returns {Promise<{success: boolean, order?: object, message: string}>}
   */
  static async lookupOrder(orderRef, mobile) {
    try {
      const response = await fetch('/api/get-order-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber: orderRef,
          mobile: mobile
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        return {
          success: false,
          message: data.message || 'No matching order found for the provided credentials.'
        };
      }

      // Reformat order record for UI renderer
      const o = data.order;
      return {
        success: true,
        order: {
          orderReference: o.public_order_number,
          customerName: o.customer_name,
          mobile: o.customer_mobile_masked || mobile,
          paymentStatus: o.payment_status === 'PAID' ? 'PAID_VERIFIED' : o.payment_status,
          orderStatus: o.order_status,
          fulfilmentMethod: o.fulfilment_method || 'PICKUP',
          deliveryFee: (o.delivery_fee_paise || 0) / 100,
          deliveryAddress: o.delivery_address || null,
          pickupDate: o.pickup_date || null,
          pickupTime: o.pickup_time || null,
          pickupCode: o.pickup_code,
          pickupLocation: APP_CONFIG.business.pickupLocationNote,
          pickupStatus: o.pickup_status,
          totalAmount: o.total_paise / 100,
          items: (o.items || []).map(i => ({
            name: i.name,
            unit: i.unit,
            quantity: i.quantity,
            price: i.unit_price_paise / 100,
            total: i.line_total_paise / 100
          })),
          createdAt: o.created_at,
          paidAt: o.paid_at
        },
        message: 'Order details verified.'
      };

    } catch (error) {
      console.error('Lookup API error:', error);
      return {
        success: false,
        message: 'Unable to connect to order verification service. Please try again.'
      };
    }
  }
}
