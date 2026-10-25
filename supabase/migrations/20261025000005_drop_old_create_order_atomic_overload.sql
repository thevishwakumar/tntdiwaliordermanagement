-- Drop the obsolete 6-argument overload to resolve PostgreSQL function ambiguity
DROP FUNCTION IF EXISTS public.create_order_atomic(text, text, text, text, jsonb, text);
