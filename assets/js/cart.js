/**
 * TNT Diwali Order Management System
 * Shopping Cart State Management
 * 
 * Manages customer order items, updates quantities, and dispatches cart sync events.
 */

import { PRODUCTS, getProductById } from './products.js';
import { validateQuantity } from './validation.js';

const STORAGE_KEY = 'tnt_diwali_cart_v1';

export class CartManager {
  /**
   * Get all items currently in cart
   * @returns {Array}
   */
  static getCart() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      // Re-hydrate with canonical product catalogue details to ensure price integrity
      const validated = [];
      for (const item of parsed) {
        const prod = getProductById(item.productId);
        if (prod) {
          const qtyRes = validateQuantity(item.quantity, prod.unit);
          if (qtyRes.isValid) {
            validated.push({
              productId: prod.id,
              name: prod.name,
              tamilName: prod.tamilName,
              price: prod.price,
              unit: prod.unit,
              quantity: qtyRes.value,
              image: prod.image,
              badge: prod.badge
            });
          }
        }
      }
      return validated;
    } catch (e) {
      console.error('Error loading cart state from localStorage:', e);
      return [];
    }
  }

  /**
   * Save cart items to localStorage and notify listeners
   * @param {Array} items 
   */
  static saveCart(items) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      this.dispatchUpdate();
    } catch (e) {
      console.error('Error saving cart state:', e);
    }
  }

  /**
   * Add a product to the cart
   * @param {string} productId 
   * @param {number} quantity 
   * @returns {{success: boolean, message: string}}
   */
  static addItem(productId, quantity = 1) {
    const product = getProductById(productId);
    if (!product) {
      return { success: false, message: 'Invalid product selected.' };
    }

    const cart = this.getCart();
    const existingIndex = cart.findIndex(item => item.productId === productId);
    let newQty = quantity;

    if (existingIndex > -1) {
      newQty = cart[existingIndex].quantity + quantity;
    }

    const qtyValidation = validateQuantity(newQty, product.unit);
    if (!qtyValidation.isValid) {
      return { success: false, message: qtyValidation.message };
    }

    if (existingIndex > -1) {
      cart[existingIndex].quantity = qtyValidation.value;
    } else {
      cart.push({
        productId: product.id,
        name: product.name,
        tamilName: product.tamilName,
        price: product.price,
        unit: product.unit,
        quantity: qtyValidation.value,
        image: product.image,
        badge: product.badge
      });
    }

    this.saveCart(cart);
    return { 
      success: true, 
      message: `${product.name} (${qtyValidation.value} ${product.unit}) added to your Diwali order.` 
    };
  }

  /**
   * Update quantity of an item
   * @param {string} productId 
   * @param {number} quantity 
   * @returns {{success: boolean, message: string}}
   */
  static updateQuantity(productId, quantity) {
    const product = getProductById(productId);
    if (!product) {
      return { success: false, message: 'Product not found.' };
    }

    let cart = this.getCart();
    if (quantity <= 0) {
      return this.removeItem(productId);
    }

    const qtyValidation = validateQuantity(quantity, product.unit);
    if (!qtyValidation.isValid) {
      return { success: false, message: qtyValidation.message };
    }

    const index = cart.findIndex(item => item.productId === productId);
    if (index > -1) {
      cart[index].quantity = qtyValidation.value;
      this.saveCart(cart);
      return { success: true, message: 'Quantity updated successfully.' };
    }

    return { success: false, message: 'Item not in cart.' };
  }

  /**
   * Remove product from cart
   * @param {string} productId 
   * @returns {{success: boolean, message: string}}
   */
  static removeItem(productId) {
    let cart = this.getCart();
    const filtered = cart.filter(item => item.productId !== productId);
    this.saveCart(filtered);
    return { success: true, message: 'Item removed from order.' };
  }

  /**
   * Clear the entire cart
   */
  static clearCart() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      this.dispatchUpdate();
    } catch (e) {
      console.error('Error clearing cart:', e);
    }
  }

  /**
   * Calculate totals (Display estimates - server validates authoritative amount)
   * @returns {{itemCount: number, totalQuantityKg: number, totalQuantityCombos: number, subtotal: number, items: Array}}
   */
  static getTotals() {
    const cart = this.getCart();
    let totalItems = 0;
    let totalQuantityKg = 0;
    let totalQuantityCombos = 0;
    let subtotal = 0;

    for (const item of cart) {
      totalItems += 1;
      if (item.unit === 'combo') {
        totalQuantityCombos += item.quantity;
      } else {
        totalQuantityKg += item.quantity;
      }
      subtotal += item.price * item.quantity;
    }

    return {
      itemCount: totalItems,
      totalQuantityKg,
      totalQuantityCombos,
      subtotal,
      items: cart
    };
  }

  /**
   * Dispatch custom event when cart changes
   */
  static dispatchUpdate() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tnt:cart-updated', {
        detail: this.getTotals()
      }));
    }
  }

  /**
   * Attach listener to update all elements with .cart-badge count
   */
  static initCartBadge() {
    const updateBadges = () => {
      const totals = this.getTotals();
      const badges = document.querySelectorAll('.tnt-cart-badge');
      badges.forEach(b => {
        b.textContent = totals.itemCount > 0 ? totals.itemCount : '0';
        if (totals.itemCount > 0) {
          b.classList.remove('hidden');
        } else {
          b.classList.add('hidden');
        }
      });
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('tnt:cart-updated', updateBadges);
      window.addEventListener('storage', updateBadges);
      // Run immediately on load
      updateBadges();
    }
  }
}
