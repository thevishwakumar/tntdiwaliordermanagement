/**
 * TNT Diwali Order Management System
 * Input Validation & Sanitization Module
 */

export const VALIDATION_RULES = {
  name: {
    min: 2,
    max: 100,
    pattern: /^[a-zA-Z\s.'-]{2,100}$/
  },
  phone: {
    // 10-digit Indian Mobile Number starting with 6, 7, 8, 9
    pattern: /^[6-9]\d{9}$/
  },
  email: {
    // Standard RFC-compliant email pattern
    pattern: /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/
  },
  notes: {
    max: 300
  },
  quantity: {
    min: 1,
    max: 50
  },
  orderRef: {
    min: 6,
    max: 30,
    pattern: /^[a-zA-Z0-9\-_]{6,30}$/
  }
};

/**
 * Validate customer full name
 * @param {string} name 
 * @returns {{isValid: boolean, message: string, value: string}}
 */
export function validateCustomerName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) {
    return { isValid: false, message: 'Please enter your full name.', value: '' };
  }
  if (trimmed.length < VALIDATION_RULES.name.min) {
    return { isValid: false, message: `Name must be at least ${VALIDATION_RULES.name.min} characters long.`, value: trimmed };
  }
  if (trimmed.length > VALIDATION_RULES.name.max) {
    return { isValid: false, message: `Name cannot exceed ${VALIDATION_RULES.name.max} characters.`, value: trimmed };
  }
  if (!VALIDATION_RULES.name.pattern.test(trimmed)) {
    return { isValid: false, message: 'Please enter a valid name containing only letters and spaces.', value: trimmed };
  }
  return { isValid: true, message: '', value: trimmed };
}

/**
 * Validate and clean Indian 10-digit mobile number
 * @param {string} phone 
 * @returns {{isValid: boolean, message: string, value: string}}
 */
export function validateMobileNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return { isValid: false, message: 'Please enter your 10-digit mobile number.', value: '' };
  }
  // Remove spaces, hyphens, parentheses, and leading +91 or 0
  let cleaned = phone.replace(/[\s\-()+]/g, '');
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.substring(1);
  }

  if (!cleaned) {
    return { isValid: false, message: 'Please enter your 10-digit mobile number.', value: '' };
  }
  if (!VALIDATION_RULES.phone.pattern.test(cleaned)) {
    return { 
      isValid: false, 
      message: 'Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.', 
      value: cleaned 
    };
  }
  return { isValid: true, message: '', value: cleaned };
}

/**
 * Validate customer email
 * @param {string} email 
 * @returns {{isValid: boolean, message: string, value: string}}
 */
export function validateEmail(email) {
  const trimmed = typeof email === 'string' ? email.trim() : '';
  if (!trimmed) {
    return { isValid: false, message: 'Please enter your email address for order notifications and receipt.', value: '' };
  }
  if (!VALIDATION_RULES.email.pattern.test(trimmed)) {
    return { isValid: false, message: 'Please enter a valid email address (e.g. name@example.com).', value: trimmed };
  }
  return { isValid: true, message: '', value: trimmed.toLowerCase() };
}

/**
 * Validate item quantity
 * @param {any} qty 
 * @param {string} unit 
 * @returns {{isValid: boolean, message: string, value: number}}
 */
export function validateQuantity(qty, unit = 'kg') {
  const num = Number(qty);
  if (!Number.isInteger(num)) {
    return { 
      isValid: false, 
      message: `Quantity must be a whole number for ${unit === 'combo' ? 'combos' : 'kilograms'}.`, 
      value: 0 
    };
  }
  if (num < VALIDATION_RULES.quantity.min) {
    return { 
      isValid: false, 
      message: `Minimum order quantity is ${VALIDATION_RULES.quantity.min} ${unit}.`, 
      value: num 
    };
  }
  if (num > VALIDATION_RULES.quantity.max) {
    return { 
      isValid: false, 
      message: `Maximum allowed quantity per product is ${VALIDATION_RULES.quantity.max} ${unit}. For bulk catering, please contact TNT directly.`, 
      value: num 
    };
  }
  return { isValid: true, message: '', value: num };
}

/**
 * Validate customer optional notes
 * @param {string} notes 
 * @returns {{isValid: boolean, message: string, value: string}}
 */
export function validateCustomerNotes(notes) {
  if (!notes || typeof notes !== 'string') {
    return { isValid: true, message: '', value: '' };
  }
  const trimmed = notes.trim();
  if (trimmed.length > VALIDATION_RULES.notes.max) {
    return { 
      isValid: false, 
      message: `Customer notes cannot exceed ${VALIDATION_RULES.notes.max} characters (currently ${trimmed.length}).`, 
      value: trimmed.substring(0, VALIDATION_RULES.notes.max) 
    };
  }
  // Basic sanitization
  const sanitized = trimmed
    .replace(/[<>]/g, '')
    .slice(0, VALIDATION_RULES.notes.max);

  return { isValid: true, message: '', value: sanitized };
}

/**
 * Validate Order Lookup reference
 * @param {string} ref 
 * @returns {{isValid: boolean, message: string, value: string}}
 */
export function validateOrderReference(ref) {
  const trimmed = typeof ref === 'string' ? ref.trim().toUpperCase() : '';
  if (!trimmed) {
    return { isValid: false, message: 'Please enter your Order Reference code.', value: '' };
  }
  if (!VALIDATION_RULES.orderRef.pattern.test(trimmed)) {
    return { isValid: false, message: 'Invalid order reference format. Example: TNT-2026-XXXXX', value: trimmed };
  }
  return { isValid: true, message: '', value: trimmed };
}

/**
 * Comprehensive checkout form validator
 * @param {object} formData 
 * @param {Array} cartItems 
 * @returns {{isValid: boolean, errors: Record<string, string>, cleanData: object}}
 */
export function validateCheckoutForm(formData, cartItems) {
  const errors = {};
  const cleanData = {};

  // Customer Name
  const nameRes = validateCustomerName(formData.fullName);
  if (!nameRes.isValid) {
    errors.fullName = nameRes.message;
  } else {
    cleanData.fullName = nameRes.value;
  }

  // Mobile
  const phoneRes = validateMobileNumber(formData.mobile);
  if (!phoneRes.isValid) {
    errors.mobile = phoneRes.message;
  } else {
    cleanData.mobile = phoneRes.value;
  }

  // Email
  const emailRes = validateEmail(formData.email);
  if (!emailRes.isValid) {
    errors.email = emailRes.message;
  } else {
    cleanData.email = emailRes.value;
  }

  // Notes
  const notesRes = validateCustomerNotes(formData.notes);
  if (!notesRes.isValid) {
    errors.notes = notesRes.message;
  } else {
    cleanData.notes = notesRes.value;
  }

  // Terms Acceptance
  if (!formData.acceptTerms) {
    errors.acceptTerms = 'You must accept the customer pickup terms and conditions to proceed.';
  } else {
    cleanData.acceptTerms = true;
  }

  // Cart Validation
  if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
    errors.cart = 'Your cart is empty. Please select at least one Diwali sweet or savoury item.';
  } else {
    const invalidItem = cartItems.find(item => {
      const qRes = validateQuantity(item.quantity, item.unit);
      return !qRes.isValid;
    });
    if (invalidItem) {
      errors.cart = `Invalid quantity for ${invalidItem.name}. Must be between 1 and 50.`;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    cleanData
  };
}
