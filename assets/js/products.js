/**
 * TNT Diwali Product Master Catalogue
 * 
 * Initial display prices as specified in project requirements:
 * 1. Traditional Sweets — ₹500 per kg
 * 2. Special Ghee Sweets — ₹900 per kg
 * 3. Karam Specials — ₹450 per kg
 * 4. Dry Fruits Sweets — ₹1,300 per kg
 * 5. Diwali Family Mixed Combo — ₹999 per combo
 * 
 * NOTE: Display prices are shown for user convenience in the frontend.
 * Authoritative totals must always be validated and re-computed server-side during checkout.
 */

export const PRODUCTS = [
  {
    id: 'tnt-trad-sweets',
    name: 'Traditional Sweets',
    tamilName: 'பாரம்பரிய ஸ்வீட்ஸ்',
    price: 500,
    unit: 'kg',
    minQuantity: 1,
    maxQuantity: 50,
    step: 1,
    category: 'sweets',
    badge: 'Festival Classic',
    image: 'assets/images/traditional-sweets.jpg',
    description: 'Authentic festive South Indian sweets freshly hand-crafted for Diwali celebrations.',
    includedItems: [
      'Paneer Jalebi (பன்னீர் ஜிலேபி)',
      'Boondi Laddu (லட்டு)',
      'Dry Fruit Rose Halwa (டிரை ப்ரூட் ரோஸ் அல்வா)',
      'Flaky Badusha (பாதுஷா)',
      'Classic Mysurpa (மைசூர்பா)'
    ],
    packingNote: 'Packed securely in food-grade festive boxes to preserve aroma and crispness.'
  },
  {
    id: 'tnt-ghee-sweets',
    name: 'Special Ghee Sweets',
    tamilName: 'ஸ்பெஷல் நெய் ஸ்வீட்ஸ்',
    price: 900,
    unit: 'kg',
    minQuantity: 1,
    maxQuantity: 50,
    step: 1,
    category: 'sweets',
    badge: 'Pure Desi Ghee',
    image: 'assets/images/special-ghee-sweets.jpg',
    description: 'Exquisite festive sweets slow-cooked in pure aromatic desi cow ghee for an authentic melt-in-mouth richness.',
    includedItems: [
      'Pure Ghee Mysore Pak (நெய் மைசூர் பாக்)',
      'Melt-in-mouth Ghee Laddu (நெய் லட்டு)',
      'Rich Nei Halwa (நெய் அல்வா)',
      'Special Cashew Ghee Badusha'
    ],
    packingNote: 'Prepared with pristine cow ghee. Best consumed fresh.'
  },
  {
    id: 'tnt-karam-specials',
    name: 'Karam Specials',
    tamilName: 'காரம் ஸ்பெஷல்ஸ்',
    price: 450,
    unit: 'kg',
    minQuantity: 1,
    maxQuantity: 50,
    step: 1,
    category: 'savouries',
    badge: 'Crispy & Spicy',
    image: 'assets/images/karam-specials.jpg',
    description: 'Crisp, spicy, and irresistible traditional Diwali savouries prepared with premium spices and roasted nuts.',
    includedItems: [
      'Spicy Mixture (மிக்சர்)',
      'Aval Mixture (அவல் மிக்சர்)',
      'Melt-in-mouth Butter Murukku (பட்டர் முறுக்கு)',
      'Crispy Kai Murukku (கை முறுக்கு)',
      'Traditional Thattai Murukku (தட்டை முறுக்கு)'
    ],
    packingNote: 'Airtight packaging ensures lasting crunch and freshness.'
  },
  {
    id: 'tnt-dry-fruits',
    name: 'Dry Fruits Sweets',
    tamilName: 'டிரை ஃப்ரூட்ஸ் ஸ்வீட்ஸ்',
    price: 1300,
    unit: 'kg',
    minQuantity: 1,
    maxQuantity: 50,
    step: 1,
    category: 'dry-fruits',
    badge: 'Artisanal Premium',
    image: 'assets/images/dry-fruits-sweets.jpg',
    description: 'Lavish festive delicacies prepared with premium California almonds, cashews, pistachios, and figs.',
    includedItems: [
      'Kaju Gulkand Barfi (காஜு குல்கந்து பர்பி)',
      'Pista Roll (பிஸ்தா ரோல்)',
      'Badam Katli (பாதாம் கத்லி)',
      'Kaju Chocolate Barfi (காஜு சாக்லேட் பர்பி)',
      'Anjeer Barfi (அஞ்சீர் பர்பி)'
    ],
    packingNote: 'Premium festive gift packaging adorned with silver foil accents.'
  },
  {
    id: 'tnt-mixed-combo',
    name: 'Diwali Family Mixed Combo',
    tamilName: 'தீபாவளி பேமிலி காம்போ',
    price: 999,
    unit: 'combo',
    minQuantity: 1,
    maxQuantity: 50,
    step: 1,
    category: 'combo',
    badge: 'Best Value Bestseller',
    image: 'assets/images/diwali-combo.jpg',
    description: 'The ultimate celebration hamper! A wholesome festive curation combining traditional sweets, rich ghee delicacies, and crunchy karam savouries.',
    includedItems: [
      'Assorted Traditional & Ghee Sweets (500g)',
      'Crunchy Karam Savouries Mixture & Murukku (500g)',
      'Festive Diwali Gift Presentation Box',
      'Perfect for family sharing and gifting'
    ],
    packingNote: 'Comes pre-boxed in an ornate Diwali presentation gift box.'
  }
];

/**
 * Get product by unique ID
 * @param {string} id 
 * @returns {object|null}
 */
export function getProductById(id) {
  return PRODUCTS.find(item => item.id === id) || null;
}
