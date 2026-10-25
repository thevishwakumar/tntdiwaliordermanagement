# TNT Diwali Order Management System

**Client:** Shree Taste N Taste Catering  
**Brand:** TNT (*Taste N Taste*)  
**Tagline:** *Spreading Sweetness This Diwali* (தீபாவளி ஸ்வீட் ஆர்டர் வரவேற்கப்படுகிறது)  
**Fulfilment Model:** Customer Store Pickup Only (No home delivery, No Cash on Delivery)  
**Primary Contact Numbers:** 9442854444 / 7200071040  
**Technology Stack:** HTML5, CSS3 (Vanilla design system with CSS custom properties), Vanilla JavaScript ES Modules (`type="module"`). No Google Apps Script. No unnecessary frameworks.

---

## 1. Project Overview & Deliverable Summary (Stage 1)

This repository contains the production-grade customer-facing ordering website built specifically for Shree Taste N Taste Catering's Diwali festive season.

### Compliance With Project Rules:
- **Zero Fake Payment Simulation:** Stage 1 cleanly halts at genuine validation and displays transparent notices. No fabricated payment success screens or simulated signatures are present.
- **Client/Server Validation Boundary:** Display prices are rendered for customer convenience; all amounts are marked as non-authoritative pending server-side validation.
- **Strictly Store Pickup:** Delivery address and slot fields are completely omitted to reflect the business model accurately.
- **Security & Customer Privacy:** Order status lookups require **both** Order Reference and Registered Mobile Number to thwart sequential identifier guessing and automated data harvesting.
- **Separation of Concerns:** Customer-facing storefront is decoupled from upcoming admin/kitchen portals.

---

## 2. Master Product Catalogue & Pricing

| # | Product Name | Tamil Name | Unit | Display Price | Assortment Highlights |
|---|---|---|---|---|---|
| 1 | Traditional Sweets | பாரம்பரிய ஸ்வீட்ஸ் | Per kg | ₹500 | Paneer Jalebi, Boondi Laddu, Dry Fruit Rose Halwa, Badusha, Mysurpa |
| 2 | Special Ghee Sweets | ஸ்பெஷல் நெய் ஸ்வீட்ஸ் | Per kg | ₹900 | Pure Ghee Mysore Pak, Nei Laddu, Ghee Halwa, Special Badusha |
| 3 | Karam Specials | காரம் ஸ்பெஷல்ஸ் | Per kg | ₹450 | Spicy Mixture, Aval Mixture, Butter Murukku, Kai Murukku, Thattai |
| 4 | Dry Fruits Sweets | டிரை ஃப்ரூட்ஸ் ஸ்வீட்ஸ் | Per kg | ₹1,300 | Kaju Gulkand Barfi, Pista Roll, Badam Katli, Kaju Chocolate, Anjeer Barfi |
| 5 | Diwali Family Mixed Combo | தீபாவளி பேமிலி காம்போ | Per combo | ₹999 | Assorted Sweets (500g) + Crunchy Murukku & Savouries (500g) in Festive Gift Box |

---

## 3. Project File Structure

```
TNT Diwali Order Mangement/
├── index.html              # Home Page (Hero, 4-step process, featured sweets, pickup notice, verified contacts)
├── products.html           # Product Catalogue (All 5 items, categories, quantity selectors, live sticky cart summary)
├── checkout.html           # Order Form & Summary (Customer details, 10-digit mobile, terms checkbox, duplicate submission lock)
├── order-status.html       # Order Verification & Receipt (2-factor verification, verified pickup code, receipt print)
├── README.md               # Technical documentation, local setup guide, and Stage 2 readiness report
├── .gitignore              # Ignores environment files, node_modules, and OS artifacts
└── assets/
    ├── css/
    │   ├── styles.css      # Core design system: Royal Diwali color tokens, responsive layout, forms, accessible focus
    │   └── print.css       # Clean black-and-white print layout for customer receipts and POS printers
    ├── js/
    │   ├── config.js       # Centralized business contacts, currency formatter, public config, and backend status check
    │   ├── products.js     # Master catalogue data with exact prices, units, and Tamil names
    │   ├── cart.js         # Reactive cart state manager (localStorage persistence, item count sync, events)
    │   ├── validation.js   # Pure client validation (Indian mobile regex, customer names, quantity limits, email)
    │   ├── checkout.js     # Checkout controller (prevents duplicate submission, validates inputs, backend guard)
    │   ├── order-status.js # Order lookup controller (secure 2-field verification, receipt rendering, print action)
    │   └── api.js          # API abstraction layer for Supabase & Razorpay with Stage 1 validation guards
    └── images/
        ├── hero-diwali.jpg         # Authentic high-definition festive sweets platter & diya hero banner
        ├── traditional-sweets.jpg  # Traditional sweets platter (Jalebi, Laddu, Halwa, Badusha, Mysurpa)
        ├── special-ghee-sweets.jpg # Melt-in-mouth golden ghee Mysore Pak and nei laddu
        ├── karam-specials.jpg      # Crispy murukku, mixture, and savoury snacks
        ├── dry-fruits-sweets.jpg   # Premium silver-foiled Kaju Katli and dry fruit sweets
        ├── diwali-combo.jpg        # Festive family combo assortment
        ├── tnt-logo.jpg            # Shree Taste N Taste Catering (TNT Taste N Taste) brand mark
        └── tnt-diwali-flyer.jpg    # Authentic business promotional flyer
```

---

## 4. How to Run the Site Locally

Because this project uses standard ECMAScript modules (`import`/`export`), it must be served over an HTTP server (not directly opened with `file://` protocol):

### Option A: Using Python (Recommended & Available)
Open PowerShell or your terminal in the project directory and run:
```bash
python -m http.server 3000
```
Then navigate to: `http://localhost:3000`

### Option B: Using Node.js (npx serve)
```bash
npx -y serve . -p 3000
```

### Option C: Using VS Code / IDE Live Server
Right-click on `index.html` and click **"Open with Live Server"**.

---

## 5. Testing Guide (Stage 1)

### Responsive Layouts
- **Mobile (< 680px):** Single-column product cards, collapsible mobile hamburger navigation menu, responsive sticky checkout bar, stacked summary items.
- **Tablet (681px - 900px):** 2-column product grid, adjusted hero banner, compact checkout layout.
- **Desktop (> 900px):** Full 3-column product grid, side-by-side customer form and order summary, widescreen hero presentation.

### Form Validation
1. **Empty Submission:** Attempt to submit the checkout form without inputs. Clear error messages appear on Name, Mobile, Email, and Terms. The browser smoothly scrolls to the first invalid field.
2. **Indian Mobile Format:** Enter an invalid number like `12345` or `0123456789`. Validation rejects it with: *"Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9."*
3. **Quantity Boundaries:** Try ordering `0` or negative quantities. The cart enforces a minimum of `1` and maximum of `50`.
4. **Duplicate Submission Protection:** Submitting the form disables the button, shows a spinner, and locks against repeated clicks.

### Secure Order Lookup & Receipt Printing
- Navigate to `order-status.html`.
- Enter your confirmed Order Reference (e.g. `TNT-261025-A8F29C`) and registered 10-digit mobile number.
- Click **Check Order Status**.
- The system securely fetches the confirmed order from the backend and displays the **Verified Pickup Code**, scheduled pickup date and slot, store location Google Maps link, itemized delicacies breakdown, and the **"Print Customer Receipt"** action.
- Shop Pickup Address: Shree Taste N Taste Catering (Google Maps: https://maps.app.goo.gl/X5LNqZjVxdGQFu398).

---

## 6. Backend-Dependent Features Awaiting Stage 2

As specified in project instructions, the following backend components will be integrated in **Stage 2**:
1. **Supabase Database Schema:** Tables for `orders`, `order_items`, `customers`, and `pickup_codes` with Row Level Security (RLS) policies.
2. **Server-Side Authoritative Total Calculation:** Server-side validation of item prices against a Tasteed database table.
3. **Razorpay Live Order Creation:** Backend generation of `razorpay_order_id` and passing key IDs to Razorpay Checkout JS modal.
4. **Server-Side Payment Signature Verification:** Cryptographic HMAC SHA256 verification of `razorpay_signature` in a Supabase Edge Function before order confirmation.
5. **Secure Generation of Official Pickup Code:** Auto-generation of unique pickup codes only upon verified payment confirmation.
6. **Live Secure Order Status Lookup API:** Edge function endpoint querying Supabase using the order reference and customer mobile hash.
