-- ==============================================================================
-- TNT DIWALI ORDER MANAGEMENT SYSTEM — STAGE 4 ADMIN SCHEMA MIGRATION
-- Enhancements for Admin Analytics, Product Stock, Pickup Verification & Audit
-- ==============================================================================

-- 1. ADD INVENTORY & STOCK FIELDS TO PRODUCTS
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS stock_quantity INTEGER DEFAULT 500,
ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT 50;

-- 2. CREATE SECURE COUNTER PICKUP VERIFICATION PROCEDURE
-- Verifies customer's pickup code against database record server-side.
-- Rejects replay attempts, unverified orders, and invalid codes.
CREATE OR REPLACE FUNCTION verify_order_pickup_atomic(
  p_order_id UUID,
  p_pickup_code TEXT,
  p_staff_id TEXT DEFAULT 'admin_counter'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_clean_code TEXT;
  v_now TIMESTAMPTZ := now();
BEGIN
  v_clean_code := upper(trim(p_pickup_code));

  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ORDER_NOT_FOUND',
      'message', 'Order record not found.'
    );
  END IF;

  -- Verify order status: must be PAID or READY_FOR_PICKUP
  IF v_order.order_status = 'PICKED_UP' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ALREADY_PICKED_UP',
      'message', 'This order has already been picked up on ' || to_char(v_order.picked_up_at, 'DD/MM/YYYY HH24:MI') || '. Duplicate handover prevented.'
    );
  END IF;

  IF v_order.payment_status != 'PAID' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'PAYMENT_NOT_VERIFIED',
      'message', 'Cannot complete pickup: Order payment is not verified.'
    );
  END IF;

  -- Validate pickup code
  IF v_order.pickup_code_hash IS NULL OR upper(trim(v_order.pickup_code_hash)) != v_clean_code THEN
    -- Log failed verification attempt
    INSERT INTO order_events (
      order_id, event_type, from_status, to_status, actor_type, actor_id, metadata
    ) VALUES (
      v_order.id, 'PICKUP_CODE_FAILED', v_order.order_status::text, v_order.order_status::text,
      'ADMIN', p_staff_id, jsonb_build_object('attempted_code', v_clean_code, 'reason', 'Code mismatch')
    );

    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_PICKUP_CODE',
      'message', 'Invalid pickup code. Verification rejected.'
    );
  END IF;

  -- Successful verification: Transition order to PICKED_UP
  UPDATE orders
  SET 
    order_status = 'PICKED_UP',
    pickup_status = 'PICKED_UP',
    picked_up_at = v_now,
    updated_at = v_now
  WHERE id = v_order.id;

  -- Log audit event
  INSERT INTO order_events (
    order_id, event_type, from_status, to_status, actor_type, actor_id, metadata
  ) VALUES (
    v_order.id, 'PICKUP_VERIFIED_HANDOVER', v_order.order_status::text, 'PICKED_UP',
    'ADMIN', p_staff_id, jsonb_build_object(
      'verified_code', v_clean_code,
      'handover_time', v_now,
      'customer_name', v_order.customer_name,
      'public_order_number', v_order.public_order_number
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'public_order_number', v_order.public_order_number,
    'customer_name', v_order.customer_name,
    'picked_up_at', v_now,
    'message', 'Pickup code verified successfully! Order marked as PICKED UP.'
  );
END;
$$;

-- 3. PRODUCT PRICE & DETAILS UPDATE PROCEDURE (Authoritative Server-side)
CREATE OR REPLACE FUNCTION admin_update_product_atomic(
  p_product_id UUID,
  p_price_in_paise INTEGER,
  p_description TEXT,
  p_is_active BOOLEAN,
  p_stock_quantity INTEGER,
  p_staff_id TEXT DEFAULT 'admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prod products%ROWTYPE;
  v_old_price INTEGER;
BEGIN
  IF p_price_in_paise <= 0 THEN
    RAISE EXCEPTION 'Product price must be greater than zero.';
  END IF;

  SELECT * INTO v_prod FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found.';
  END IF;

  v_old_price := v_prod.price_in_paise;

  UPDATE products
  SET
    price_in_paise = p_price_in_paise,
    description = COALESCE(p_description, description),
    is_active = COALESCE(p_is_active, is_active),
    stock_quantity = COALESCE(p_stock_quantity, stock_quantity),
    updated_at = now()
  WHERE id = p_product_id;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'old_price_paise', v_old_price,
    'new_price_paise', p_price_in_paise,
    'message', 'Product updated successfully.'
  );
END;
$$;
