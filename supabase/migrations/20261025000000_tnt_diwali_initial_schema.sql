-- ==============================================================================
-- TNT DIWALI ORDER MANAGEMENT SYSTEM — DATABASE SCHEMA & RLS MIGRATION
-- Brand: Shree Taste N Taste Catering (TNT - Taste N Trust)
-- Target: Supabase PostgreSQL (Production Grade)
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. ENUM TYPES
DO $$ BEGIN
  CREATE TYPE order_status_type AS ENUM (
    'AWAITING_PAYMENT',
    'PAID',
    'PREPARING',
    'READY_FOR_PICKUP',
    'PICKED_UP',
    'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_status_type AS ENUM (
    'PENDING',
    'PAID',
    'FAILED',
    'CANCELLED',
    'REFUND_PENDING',
    'REFUNDED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE fulfilment_method_type AS ENUM (
    'PICKUP'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE pickup_status_type AS ENUM (
    'PENDING_GENERATION',
    'READY_FOR_PICKUP',
    'PICKED_UP',
    'EXPIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 3. PRODUCTS TABLE
-- Canonical master catalogue with prices strictly in integer paise.
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  tamil_name TEXT,
  description TEXT,
  price_in_paise INTEGER NOT NULL CHECK (price_in_paise > 0),
  unit TEXT NOT NULL CHECK (unit IN ('kg', 'combo')),
  image_url TEXT,
  badge TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed Approved Products (Exact prices in paise)
INSERT INTO products (slug, name, tamil_name, description, price_in_paise, unit, image_url, badge, is_active)
VALUES
  ('tnt-trad-sweets', 'Traditional Sweets', 'பாரம்பரிய ஸ்வீட்ஸ்', 'Authentic festive South Indian sweets freshly hand-crafted for Diwali.', 50000, 'kg', 'assets/images/traditional-sweets.jpg', 'Festival Classic', true),
  ('tnt-ghee-sweets', 'Special Ghee Sweets', 'ஸ்பெஷல் நெய் ஸ்வீட்ஸ்', 'Exquisite festive sweets slow-cooked in pure aromatic desi cow ghee.', 90000, 'kg', 'assets/images/special-ghee-sweets.jpg', 'Pure Desi Ghee', true),
  ('tnt-karam-specials', 'Karam Specials', 'காரம் ஸ்பெஷல்ஸ்', 'Crisp, spicy, and irresistible traditional Diwali savouries.', 45000, 'kg', 'assets/images/karam-specials.jpg', 'Crispy & Spicy', true),
  ('tnt-dry-fruits', 'Dry Fruits Sweets', 'டிரை ஃப்ரூட்ஸ் ஸ்வீட்ஸ்', 'Lavish festive delicacies prepared with premium almonds, cashews, pistachios, and figs.', 130000, 'kg', 'assets/images/dry-fruits-sweets.jpg', 'Artisanal Premium', true),
  ('tnt-mixed-combo', 'Diwali Family Mixed Combo', 'தீபாவளி பேமிலி காம்போ', 'The ultimate celebration hamper combining traditional sweets, ghee delicacies, and savouries.', 99900, 'combo', 'assets/images/diwali-combo.jpg', 'Best Value Bestseller', true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  tamil_name = EXCLUDED.tamil_name,
  description = EXCLUDED.description,
  price_in_paise = EXCLUDED.price_in_paise,
  unit = EXCLUDED.unit,
  image_url = EXCLUDED.image_url,
  badge = EXCLUDED.badge,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- Helper function: Generate non-sequential, enumeration-resistant public order number
-- Format: TNT-YYMMDD-XXXXXX (e.g. TNT-261025-A8F29C)
CREATE OR REPLACE FUNCTION generate_public_order_number()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_date_part TEXT;
  v_random_part TEXT;
  v_order_num TEXT;
  v_exists BOOLEAN;
BEGIN
  v_date_part := to_char(now(), 'YYMMDD');
  LOOP
    -- 6 characters random hexadecimal
    v_random_part := upper(substr(encode(gen_random_bytes(3), 'hex'), 1, 6));
    v_order_num := 'TNT-' || v_date_part || '-' || v_random_part;
    
    SELECT EXISTS (SELECT 1 FROM orders WHERE public_order_number = v_order_num) INTO v_exists;
    IF NOT v_exists THEN
      EXIT;
    END IF;
  END LOOP;
  RETURN v_order_num;
END;
$$;

-- 4. ORDERS TABLE
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_order_number TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL CHECK (char_length(trim(customer_name)) >= 2 AND char_length(customer_name) <= 100),
  customer_mobile TEXT NOT NULL CHECK (customer_mobile ~ '^[6-9][0-9]{9}$'),
  customer_email TEXT,
  subtotal_paise INTEGER NOT NULL CHECK (subtotal_paise > 0),
  total_paise INTEGER NOT NULL CHECK (total_paise > 0),
  payment_status payment_status_type NOT NULL DEFAULT 'PENDING',
  order_status order_status_type NOT NULL DEFAULT 'AWAITING_PAYMENT',
  fulfilment_method fulfilment_method_type NOT NULL DEFAULT 'PICKUP',
  pickup_code_hash TEXT,
  pickup_code_expires_at TIMESTAMPTZ,
  pickup_status pickup_status_type NOT NULL DEFAULT 'PENDING_GENERATION',
  customer_notes TEXT CHECK (customer_notes IS NULL OR char_length(customer_notes) <= 300),
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_public_order_number ON orders(public_order_number);
CREATE INDEX IF NOT EXISTS idx_orders_customer_mobile ON orders(customer_mobile);
CREATE INDEX IF NOT EXISTS idx_orders_order_status ON orders(order_status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- 5. ORDER_ITEMS TABLE
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  product_name_snapshot TEXT NOT NULL,
  unit_snapshot TEXT NOT NULL,
  unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise > 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 50),
  line_total_paise INTEGER NOT NULL CHECK (line_total_paise = unit_price_paise * quantity),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- 6. PAYMENTS TABLE
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL DEFAULT 'RAZORPAY',
  provider_order_id TEXT NOT NULL UNIQUE,
  provider_payment_id TEXT UNIQUE,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  status payment_status_type NOT NULL DEFAULT 'PENDING',
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_order_id ON payments(provider_order_id);

-- 7. ADMIN_PROFILES TABLE
CREATE TABLE IF NOT EXISTS admin_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'manager', 'staff')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. ORDER_EVENTS TABLE
CREATE TABLE IF NOT EXISTS order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('CUSTOMER', 'SYSTEM', 'ADMIN')),
  actor_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_events_order_id ON order_events(order_id);
CREATE INDEX IF NOT EXISTS idx_order_events_created_at ON order_events(created_at DESC);

-- 9. UPDATED_AT TRIGGER FUNCTION
CREATE OR REPLACE FUNCTION update_timestamp_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;
CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- ==============================================================================
-- 10. SECURITY & ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

-- Helper function: Check if current auth user is an active admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admin_profiles
    WHERE user_id = auth.uid() AND is_active = true
  );
END;
$$;

-- Enable RLS across all tables
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;

-- Products RLS:
-- Anyone can view active products
DROP POLICY IF EXISTS "Public can view active products" ON products;
CREATE POLICY "Public can view active products"
  ON products FOR SELECT
  USING (is_active = true OR is_admin());

-- Only admins can modify products
DROP POLICY IF EXISTS "Admins can modify products" ON products;
CREATE POLICY "Admins can modify products"
  ON products FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Orders RLS:
-- Public has NO direct read or write access to orders table.
-- Privileged operations occur exclusively through Edge Functions using service_role,
-- or authenticated admins via dashboard.
DROP POLICY IF EXISTS "Admins can view and manage all orders" ON orders;
CREATE POLICY "Admins can view and manage all orders"
  ON orders FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Order Items RLS:
DROP POLICY IF EXISTS "Admins can view order items" ON order_items;
CREATE POLICY "Admins can view order items"
  ON order_items FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Payments RLS:
DROP POLICY IF EXISTS "Admins can view payments" ON payments;
CREATE POLICY "Admins can view payments"
  ON payments FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Admin Profiles RLS:
-- Admins can view their own profile
DROP POLICY IF EXISTS "Users can view their own admin profile" ON admin_profiles;
CREATE POLICY "Users can view their own admin profile"
  ON admin_profiles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND is_active = true);

-- Order Events RLS:
DROP POLICY IF EXISTS "Admins can view order events" ON order_events;
CREATE POLICY "Admins can view order events"
  ON order_events FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ==============================================================================
-- 11. PRIVILEGED ATOMIC STORED PROCEDURES (SECURITY DEFINER)
-- ==============================================================================

-- Atomic order creation with authoritative server-side price calculation
CREATE OR REPLACE FUNCTION create_order_atomic(
  p_customer_name TEXT,
  p_customer_mobile TEXT,
  p_customer_email TEXT,
  p_customer_notes TEXT,
  p_items JSONB,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_order orders%ROWTYPE;
  v_order_id UUID;
  v_public_order_number TEXT;
  v_clean_mobile TEXT;
  v_clean_name TEXT;
  v_clean_email TEXT;
  v_item RECORD;
  v_product RECORD;
  v_unit_price INTEGER;
  v_qty INTEGER;
  v_line_total INTEGER;
  v_subtotal_paise INTEGER := 0;
  v_total_paise INTEGER := 0;
BEGIN
  -- 1. Idempotency Check: Prevent duplicate submissions
  IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
    SELECT * INTO v_existing_order FROM orders WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'order_id', v_existing_order.id,
        'public_order_number', v_existing_order.public_order_number,
        'subtotal_paise', v_existing_order.subtotal_paise,
        'total_paise', v_existing_order.total_paise,
        'order_status', v_existing_order.order_status,
        'payment_status', v_existing_order.payment_status,
        'is_duplicate', true,
        'message', 'Existing order retrieved by idempotency key.'
      );
    END IF;
  END IF;

  -- 2. Customer input validation
  v_clean_name := trim(p_customer_name);
  IF length(v_clean_name) < 2 OR length(v_clean_name) > 100 THEN
    RAISE EXCEPTION 'Customer name must be between 2 and 100 characters.';
  END IF;

  -- Clean mobile: remove +91, 0, spaces
  v_clean_mobile := regexp_replace(p_customer_mobile, '[\s\-()+]', '', 'g');
  IF length(v_clean_mobile) = 12 AND v_clean_mobile LIKE '91%' THEN
    v_clean_mobile := substr(v_clean_mobile, 3);
  ELSIF length(v_clean_mobile) = 11 AND v_clean_mobile LIKE '0%' THEN
    v_clean_mobile := substr(v_clean_mobile, 2);
  END IF;

  IF NOT (v_clean_mobile ~ '^[6-9][0-9]{9}$') THEN
    RAISE EXCEPTION 'Invalid mobile number. Must be a 10-digit Indian mobile number.';
  END IF;

  v_clean_email := NULLIF(lower(trim(p_customer_email)), '');
  IF v_clean_email IS NOT NULL AND NOT (v_clean_email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') THEN
    RAISE EXCEPTION 'Invalid email address format.';
  END IF;

  -- 3. Items validation
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item.';
  END IF;

  -- First pass: Authoritatively calculate price from products table
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id TEXT, quantity INT)
  LOOP
    IF v_item.quantity IS NULL OR v_item.quantity < 1 OR v_item.quantity > 50 THEN
      RAISE EXCEPTION 'Item quantity must be an integer between 1 and 50.';
    END IF;

    -- Look up product by id or slug
    SELECT * INTO v_product FROM products 
    WHERE (id::text = v_item.product_id OR slug = v_item.product_id) AND is_active = true;
    
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product with identifier % is invalid or inactive.', v_item.product_id;
    END IF;

    v_unit_price := v_product.price_in_paise;
    v_line_total := v_unit_price * v_item.quantity;
    v_subtotal_paise := v_subtotal_paise + v_line_total;
  END LOOP;

  v_total_paise := v_subtotal_paise; -- Store pickup only: no delivery fee or surcharge

  -- 4. Create Order Record
  v_public_order_number := generate_public_order_number();

  INSERT INTO orders (
    public_order_number,
    customer_name,
    customer_mobile,
    customer_email,
    subtotal_paise,
    total_paise,
    payment_status,
    order_status,
    fulfilment_method,
    pickup_status,
    customer_notes,
    idempotency_key
  ) VALUES (
    v_public_order_number,
    v_clean_name,
    v_clean_mobile,
    v_clean_email,
    v_subtotal_paise,
    v_total_paise,
    'PENDING',
    'AWAITING_PAYMENT',
    'PICKUP',
    'PENDING_GENERATION',
    NULLIF(trim(p_customer_notes), ''),
    NULLIF(trim(p_idempotency_key), '')
  ) RETURNING id INTO v_order_id;

  -- 5. Create Order Items
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id TEXT, quantity INT)
  LOOP
    SELECT * INTO v_product FROM products 
    WHERE (id::text = v_item.product_id OR slug = v_item.product_id);

    v_unit_price := v_product.price_in_paise;
    v_line_total := v_unit_price * v_item.quantity;

    INSERT INTO order_items (
      order_id,
      product_id,
      product_name_snapshot,
      unit_snapshot,
      unit_price_paise,
      quantity,
      line_total_paise
    ) VALUES (
      v_order_id,
      v_product.id,
      v_product.name,
      v_product.unit,
      v_unit_price,
      v_item.quantity,
      v_line_total
    );
  END LOOP;

  -- 6. Log Order Event
  INSERT INTO order_events (
    order_id,
    event_type,
    from_status,
    to_status,
    actor_type,
    actor_id,
    metadata
  ) VALUES (
    v_order_id,
    'ORDER_CREATED',
    NULL,
    'AWAITING_PAYMENT',
    'CUSTOMER',
    v_clean_mobile,
    jsonb_build_object(
      'total_paise', v_total_paise,
      'public_order_number', v_public_order_number,
      'item_count', jsonb_array_length(p_items)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'public_order_number', v_public_order_number,
    'subtotal_paise', v_subtotal_paise,
    'total_paise', v_total_paise,
    'order_status', 'AWAITING_PAYMENT',
    'payment_status', 'PENDING',
    'is_duplicate', false,
    'message', 'Order created successfully. Ready for online payment.'
  );
END;
$$;

-- Secure Order Status Lookup: Requires BOTH public_order_number AND customer_mobile
CREATE OR REPLACE FUNCTION lookup_order_secure(
  p_public_order_number TEXT,
  p_customer_mobile TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_clean_mobile TEXT;
  v_clean_ref TEXT;
  v_items JSONB;
BEGIN
  v_clean_ref := upper(trim(p_public_order_number));

  -- Clean mobile
  v_clean_mobile := regexp_replace(p_customer_mobile, '[\s\-()+]', '', 'g');
  IF length(v_clean_mobile) = 12 AND v_clean_mobile LIKE '91%' THEN
    v_clean_mobile := substr(v_clean_mobile, 3);
  ELSIF length(v_clean_mobile) = 11 AND v_clean_mobile LIKE '0%' THEN
    v_clean_mobile := substr(v_clean_mobile, 2);
  END IF;

  SELECT * INTO v_order FROM orders
  WHERE public_order_number = v_clean_ref AND customer_mobile = v_clean_mobile;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'No matching order found for the provided credentials.'
    );
  END IF;

  -- Get item snapshots
  SELECT jsonb_agg(
    jsonb_build_object(
      'name', product_name_snapshot,
      'unit', unit_snapshot,
      'unit_price_paise', unit_price_paise,
      'quantity', quantity,
      'line_total_paise', line_total_paise
    )
  ) INTO v_items
  FROM order_items
  WHERE order_id = v_order.id;

  RETURN jsonb_build_object(
    'success', true,
    'order', jsonb_build_object(
      'public_order_number', v_order.public_order_number,
      'customer_name', v_order.customer_name,
      'customer_mobile_masked', substr(v_order.customer_mobile, 1, 2) || '******' || substr(v_order.customer_mobile, 9),
      'order_status', v_order.order_status,
      'payment_status', v_order.payment_status,
      'fulfilment_method', v_order.fulfilment_method,
      'total_paise', v_order.total_paise,
      'pickup_status', v_order.pickup_status,
      'pickup_code', CASE 
        WHEN v_order.payment_status = 'PAID' AND v_order.pickup_code_hash IS NOT NULL 
        THEN v_order.pickup_code_hash -- Revealed only upon verified paid status
        ELSE NULL 
      END,
      'created_at', v_order.created_at,
      'paid_at', v_order.paid_at,
      'ready_at', v_order.ready_at,
      'items', COALESCE(v_items, '[]'::jsonb)
    )
  );
END;
$$;
