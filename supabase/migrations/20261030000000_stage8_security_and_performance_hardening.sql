-- ==============================================================================
-- TNT DIWALI ORDER MANAGEMENT — STAGE 8 SECURITY & PERFORMANCE HARDENING
-- Fixes Supabase DB Advisors (Mutable search_path, RLS auth.uid() initplan, policy consolidation)
-- Enhances database concurrency for 1000+ simultaneous users
-- ==============================================================================

-- 1. HARDEN FUNCTION SEARCH PATHS (SECURITY: Prevents search_path injection)
CREATE OR REPLACE FUNCTION public.update_timestamp_column()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admin_profiles
    WHERE user_id = (SELECT auth.uid()) AND is_active = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_public_order_number()
RETURNS TEXT 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date_part TEXT;
  v_random_part TEXT;
  v_order_num TEXT;
  v_exists BOOLEAN;
BEGIN
  v_date_part := to_char(now(), 'YYMMDD');
  LOOP
    -- 6 characters random hexadecimal using standard PostgreSQL built-in functions
    v_random_part := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    v_order_num := 'TNT-' || v_date_part || '-' || v_random_part;
    
    SELECT EXISTS (SELECT 1 FROM orders WHERE public_order_number = v_order_num) INTO v_exists;
    IF NOT v_exists THEN
      EXIT;
    END IF;
  END LOOP;
  RETURN v_order_num;
END;
$$;

-- 2. OPTIMIZE RLS POLICIES FOR HIGH CONCURRENCY (PERFORMANCE: Subquery-cached auth.uid())
DROP POLICY IF EXISTS "Users can view their own admin profile" ON admin_profiles;
CREATE POLICY "Users can view their own admin profile"
  ON admin_profiles FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()) AND is_active = true);

-- 3. CONSOLIDATE PERMISSIVE POLICIES ON PRODUCTS
DROP POLICY IF EXISTS "Public can view active products" ON products;
DROP POLICY IF EXISTS "Admins can modify products" ON products;
DROP POLICY IF EXISTS "Admins can insert products" ON products;
DROP POLICY IF EXISTS "Admins can update products" ON products;
DROP POLICY IF EXISTS "Admins can delete products" ON products;

-- Single clean SELECT policy for public & authenticated
CREATE POLICY "Public can view active products"
  ON products FOR SELECT
  USING (is_active = true OR is_admin());

-- Mutation policies restricted to authenticated admins (avoids duplicate SELECT permissive policy)
CREATE POLICY "Admins can insert products"
  ON products FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update products"
  ON products FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Admins can delete products"
  ON products FOR DELETE
  TO authenticated
  USING (is_admin());

-- 4. ADDITIONAL CONCURRENCY INDEXES FOR 1000+ CONCURRENT USERS
CREATE INDEX IF NOT EXISTS idx_orders_customer_lookup 
  ON public.orders (public_order_number, customer_mobile);

CREATE INDEX IF NOT EXISTS idx_orders_idempotency_lookup
  ON public.orders (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 5. RE-NOTIFY PostgREST TO RELOAD SCHEMA CACHE
NOTIFY pgrst, 'reload schema';
