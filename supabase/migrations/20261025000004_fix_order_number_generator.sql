-- Fix generate_public_order_number to use built-in md5 without external extension dependency
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
