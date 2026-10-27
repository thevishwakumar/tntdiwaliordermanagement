-- ==============================================================================
-- TNT DIWALI ORDER MANAGEMENT SYSTEM — STAGE 7 MIGRATION
-- Doorstep Delivery via Porter/Partner, Delivery Address & Flat Estimate Fee
-- ==============================================================================

-- 1. ADD 'DELIVERY' TO FULFILMENT_METHOD_TYPE ENUM
DO $$ BEGIN
  ALTER TYPE fulfilment_method_type ADD VALUE IF NOT EXISTS 'DELIVERY';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. ADD DELIVERY FEE & DELIVERY ADDRESS COLUMNS TO ORDERS TABLE
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'delivery_fee_paise'
  ) THEN
    ALTER TABLE orders ADD COLUMN delivery_fee_paise INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'delivery_address'
  ) THEN
    ALTER TABLE orders ADD COLUMN delivery_address JSONB DEFAULT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_fulfilment_method ON orders(fulfilment_method);

-- 3. DROP OLD FUNCTION SIGNATURES TO PREVENT AMBIGUITY
DROP FUNCTION IF EXISTS create_order_atomic(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, DATE, TEXT);

-- 4. UPDATE ATOMIC ORDER CREATION TO SUPPORT DOORSTEP DELIVERY & STORE PICKUP
CREATE OR REPLACE FUNCTION create_order_atomic(
  p_customer_name TEXT,
  p_customer_mobile TEXT,
  p_customer_email TEXT,
  p_customer_notes TEXT,
  p_items JSONB,
  p_idempotency_key TEXT DEFAULT NULL,
  p_pickup_date DATE DEFAULT CURRENT_DATE,
  p_pickup_time TEXT DEFAULT 'Morning (08:00 AM - 12:00 PM)',
  p_fulfilment_method TEXT DEFAULT 'PICKUP',
  p_delivery_address JSONB DEFAULT NULL
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
  v_delivery_fee_paise INTEGER := 0;
  v_fulfilment_method fulfilment_method_type := 'PICKUP';
  v_pickup_date DATE;
  v_pickup_time TEXT;
  v_street TEXT;
  v_area TEXT;
  v_city TEXT;
  v_pincode TEXT;
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
        'delivery_fee_paise', v_existing_order.delivery_fee_paise,
        'total_paise', v_existing_order.total_paise,
        'order_status', v_existing_order.order_status,
        'payment_status', v_existing_order.payment_status,
        'fulfilment_method', v_existing_order.fulfilment_method,
        'pickup_date', v_existing_order.pickup_date,
        'pickup_time', v_existing_order.pickup_time,
        'delivery_address', v_existing_order.delivery_address,
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

  -- 3. Validate Fulfilment Method & Delivery Address
  IF upper(trim(COALESCE(p_fulfilment_method, 'PICKUP'))) = 'DELIVERY' THEN
    v_fulfilment_method := 'DELIVERY';
    v_delivery_fee_paise := 8000; -- Flat ₹80 estimated local delivery fee

    IF p_delivery_address IS NULL THEN
      RAISE EXCEPTION 'Delivery address is required for doorstep delivery.';
    END IF;

    v_street := trim(COALESCE(p_delivery_address->>'street', ''));
    v_area := trim(COALESCE(p_delivery_address->>'area', ''));
    v_city := trim(COALESCE(p_delivery_address->>'city', ''));
    v_pincode := trim(COALESCE(p_delivery_address->>'pincode', ''));

    IF length(v_street) < 5 THEN
      RAISE EXCEPTION 'Door/Flat number and street name must be at least 5 characters.';
    END IF;
    IF length(v_area) < 2 THEN
      RAISE EXCEPTION 'Area / Locality is required.';
    END IF;
    IF length(v_city) < 2 THEN
      RAISE EXCEPTION 'City / Town is required.';
    END IF;
    IF NOT (v_pincode ~ '^[1-9][0-9]{5}$') THEN
      RAISE EXCEPTION 'Pincode must be a valid 6-digit Indian Postal Code.';
    END IF;
  ELSE
    v_fulfilment_method := 'PICKUP';
    v_delivery_fee_paise := 0;
  END IF;

  -- 4. Validate pickup date
  v_pickup_date := COALESCE(p_pickup_date, CURRENT_DATE);
  IF v_pickup_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Pickup date cannot be in the past.';
  END IF;

  v_pickup_time := COALESCE(NULLIF(trim(p_pickup_time), ''), 'Morning (08:00 AM - 12:00 PM)');

  -- 5. Items validation
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

  v_total_paise := v_subtotal_paise + v_delivery_fee_paise;
  v_public_order_number := generate_public_order_number();

  -- 6. Insert order
  INSERT INTO orders (
    public_order_number,
    customer_name,
    customer_mobile,
    customer_email,
    subtotal_paise,
    delivery_fee_paise,
    total_paise,
    payment_status,
    order_status,
    fulfilment_method,
    pickup_status,
    pickup_date,
    pickup_time,
    delivery_address,
    customer_notes,
    idempotency_key
  ) VALUES (
    v_public_order_number,
    v_clean_name,
    v_clean_mobile,
    v_clean_email,
    v_subtotal_paise,
    v_delivery_fee_paise,
    v_total_paise,
    'PENDING',
    'AWAITING_PAYMENT',
    v_fulfilment_method,
    'PENDING_GENERATION',
    v_pickup_date,
    v_pickup_time,
    CASE WHEN v_fulfilment_method = 'DELIVERY' THEN p_delivery_address ELSE NULL END,
    NULLIF(trim(p_customer_notes), ''),
    NULLIF(trim(p_idempotency_key), '')
  ) RETURNING id INTO v_order_id;

  -- 7. Insert items
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

  -- 8. Audit event
  INSERT INTO order_events (
    order_id, event_type, from_status, to_status, actor_type, actor_id, metadata
  ) VALUES (
    v_order_id, 'ORDER_CREATED', NULL, 'AWAITING_PAYMENT', 'CUSTOMER', v_clean_mobile,
    jsonb_build_object(
      'subtotal_paise', v_subtotal_paise,
      'delivery_fee_paise', v_delivery_fee_paise,
      'total_paise', v_total_paise,
      'fulfilment_method', v_fulfilment_method,
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
    'delivery_fee_paise', v_delivery_fee_paise,
    'total_paise', v_total_paise,
    'fulfilment_method', v_fulfilment_method,
    'order_status', 'AWAITING_PAYMENT',
    'payment_status', 'PENDING',
    'pickup_date', v_pickup_date,
    'pickup_time', v_pickup_time,
    'delivery_address', CASE WHEN v_fulfilment_method = 'DELIVERY' THEN p_delivery_address ELSE NULL END,
    'is_duplicate', false,
    'message', 'Order created successfully. Ready for online payment.'
  );
END;
$$;

-- 5. UPDATE SECURE LOOKUP TO RETURN FULFILMENT METHOD, DELIVERY FEE & ADDRESS
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
      'delivery_fee_paise', COALESCE(v_order.delivery_fee_paise, 0),
      'delivery_address', v_order.delivery_address,
      'pickup_date', v_order.pickup_date,
      'pickup_time', v_order.pickup_time,
      'subtotal_paise', v_order.subtotal_paise,
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
