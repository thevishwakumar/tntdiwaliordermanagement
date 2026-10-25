-- ==============================================================================
-- TNT DIWALI ORDER MANAGEMENT SYSTEM — DATABASE CLEANUP SCRIPT
-- Purpose: Safely purge old order/test data while strictly preserving schema,
-- products master catalogue, admin users, RLS policies, and triggers.
-- ==============================================================================

BEGIN;

-- 1. Truncate / Delete operational order transaction data in correct foreign-key order
DELETE FROM webhook_events;
DELETE FROM order_events;
DELETE FROM payments;
DELETE FROM order_items;
DELETE FROM orders;

-- 2. Verify products master catalog remains intact (Must have 5 active products)
DO $$
DECLARE
  v_prod_count INT;
BEGIN
  SELECT count(*) INTO v_prod_count FROM products WHERE is_active = true;
  IF v_prod_count < 5 THEN
    RAISE EXCEPTION 'Products catalog corrupted! Rollback initiated.';
  END IF;
END $$;

-- 3. Verify admin_profiles remain intact
DO $$
DECLARE
  v_admin_count INT;
BEGIN
  SELECT count(*) INTO v_admin_count FROM admin_profiles;
  RAISE NOTICE 'Active admin profiles remaining: %', v_admin_count;
END $$;

COMMIT;

-- Verification summary queries
SELECT 'orders' as table_name, count(*) as count FROM orders
UNION ALL
SELECT 'order_items', count(*) FROM order_items
UNION ALL
SELECT 'payments', count(*) FROM payments
UNION ALL
SELECT 'order_events', count(*) FROM order_events
UNION ALL
SELECT 'webhook_events', count(*) FROM webhook_events
UNION ALL
SELECT 'products', count(*) FROM products;
