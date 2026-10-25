-- ==============================================================================
-- TNT DIWALI ORDER MANAGEMENT SYSTEM — STAGE 6 MIGRATION
-- Advance Pickup Scheduling, Pickup Date/Slot, Admin Provisioning & Data Cleanup
-- ==============================================================================

-- 1. ADD PICKUP DATE AND TIME TO ORDERS TABLE
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'pickup_date'
  ) THEN
    ALTER TABLE orders ADD COLUMN pickup_date DATE DEFAULT CURRENT_DATE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'pickup_time'
  ) THEN
    ALTER TABLE orders ADD COLUMN pickup_time TEXT DEFAULT 'Morning (08:00 AM - 11:00 AM)';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_pickup_date ON orders(pickup_date);
CREATE INDEX IF NOT EXISTS idx_orders_pickup_status_date ON orders(pickup_status, pickup_date);

-- 2. UPDATE ATOMIC ORDER CREATION TO CAPTURE ADVANCE PICKUP DATE & TIME
CREATE OR REPLACE FUNCTION create_order_atomic(
  p_customer_name TEXT,
  p_customer_mobile TEXT,
  p_customer_email TEXT,
  p_customer_notes TEXT,
  p_items JSONB,
  p_idempotency_key TEXT DEFAULT NULL,
  p_pickup_date DATE DEFAULT CURRENT_DATE,
  p_pickup_time TEXT DEFAULT 'Morning (08:00 AM - 11:00 AM)'
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
  v_pickup_date DATE;
  v_pickup_time TEXT;
BEGIN
  -- 1. Idempotency Check
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
        'pickup_date', v_existing_order.pickup_date,
        'pickup_time', v_existing_order.pickup_time,
        'is_duplicate', true,
        'message', 'Existing order retrieved by idempotency key.'
      );
    END IF;
  END IF;

  -- 2. Customer validation
  v_clean_name := trim(p_customer_name);
  IF length(v_clean_name) < 2 OR length(v_clean_name) > 100 THEN
    RAISE EXCEPTION 'Customer name must be between 2 and 100 characters.';
  END IF;

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

  -- 3. Validate pickup date: cannot be in the past
  v_pickup_date := COALESCE(p_pickup_date, CURRENT_DATE);
  IF v_pickup_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Pickup date cannot be in the past.';
  END IF;

  v_pickup_time := COALESCE(NULLIF(trim(p_pickup_time), ''), 'Morning (08:00 AM - 11:00 AM)');

  -- 4. Items validation
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id TEXT, quantity INT)
  LOOP
    IF v_item.quantity IS NULL OR v_item.quantity < 1 OR v_item.quantity > 50 THEN
      RAISE EXCEPTION 'Item quantity must be an integer between 1 and 50.';
    END IF;

    SELECT * INTO v_product FROM products 
    WHERE (id::text = v_item.product_id OR slug = v_item.product_id) AND is_active = true;
    
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product with identifier % is invalid or inactive.', v_item.product_id;
    END IF;

    v_unit_price := v_product.price_in_paise;
    v_line_total := v_unit_price * v_item.quantity;
    v_subtotal_paise := v_subtotal_paise + v_line_total;
  END LOOP;

  v_total_paise := v_subtotal_paise;
  v_public_order_number := generate_public_order_number();

  -- 5. Insert order
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
    pickup_date,
    pickup_time,
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
    v_pickup_date,
    v_pickup_time,
    NULLIF(trim(p_customer_notes), ''),
    NULLIF(trim(p_idempotency_key), '')
  ) RETURNING id INTO v_order_id;

  -- 6. Insert items
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id TEXT, quantity INT)
  LOOP
    SELECT * INTO v_product FROM products 
    WHERE (id::text = v_item.product_id OR slug = v_item.product_id);

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
      v_product.price_in_paise,
      v_item.quantity,
      v_product.price_in_paise * v_item.quantity
    );
  END LOOP;

  -- 7. Audit event
  INSERT INTO order_events (
    order_id, event_type, from_status, to_status, actor_type, actor_id, metadata
  ) VALUES (
    v_order_id, 'ORDER_CREATED', NULL, 'AWAITING_PAYMENT', 'CUSTOMER', v_clean_mobile,
    jsonb_build_object(
      'total_paise', v_total_paise,
      'public_order_number', v_public_order_number,
      'pickup_date', v_pickup_date,
      'pickup_time', v_pickup_time
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
    'pickup_date', v_pickup_date,
    'pickup_time', v_pickup_time,
    'is_duplicate', false,
    'message', 'Order created successfully. Ready for online payment.'
  );
END;
$$;

-- 3. SECURE LOOKUP WITH PICKUP DATE & TIME
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
      'pickup_date', v_order.pickup_date,
      'pickup_time', v_order.pickup_time,
      'total_paise', v_order.total_paise,
      'pickup_status', v_order.pickup_status,
      'pickup_code', CASE 
        WHEN v_order.payment_status = 'PAID' AND v_order.pickup_code_hash IS NOT NULL 
        THEN v_order.pickup_code_hash
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

-- 4. SECURE ADMIN PROVISIONING FUNCTION FOR zinointech@gmail.com
-- Promotes or registers zinointech@gmail.com in admin_profiles once created in auth.users
CREATE OR REPLACE FUNCTION provision_admin_user(p_email TEXT, p_role TEXT DEFAULT 'admin')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower(trim(p_email));
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'User ' || p_email || ' must first be signed up via Supabase Auth before role assignment.'
    );
  END IF;

  INSERT INTO admin_profiles (user_id, role, is_active)
  VALUES (v_uid, p_role, true)
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, is_active = true;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_uid,
    'email', p_email,
    'role', p_role,
    'message', 'Admin profile successfully provisioned.'
  );
END;
$$;
