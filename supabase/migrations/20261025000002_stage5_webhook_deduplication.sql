-- ==============================================================================
-- TNT DIWALI ORDER MANAGEMENT SYSTEM — STAGE 5 MIGRATION
-- Webhook Event Deduplication, Razorpay Order Association & Security Policies
-- ==============================================================================

-- 1. Ensure razorpay_order_id exists on orders table with index
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'razorpay_order_id'
  ) THEN
    ALTER TABLE orders ADD COLUMN razorpay_order_id TEXT UNIQUE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_razorpay_order_id ON orders(razorpay_order_id);

-- 2. Webhook Events Table (Auditing & Replay Protection)
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'RAZORPAY',
  provider_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING', 'PROCESSED', 'PROCESSED_ALREADY_PAID', 'PROCESSED_FAILED_IGNORED_ALREADY_PAID', 'PROCESSED_UNHANDLED_TYPE', 'IGNORED_NO_ORDER_ID', 'IGNORED_ORDER_NOT_FOUND', 'FAILED')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_event_id ON webhook_events(provider_event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_event_type ON webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events(created_at DESC);

-- Enable RLS on webhook_events
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- Security Policy: Admins only can read webhook events
DROP POLICY IF EXISTS "Admins can view webhook events" ON webhook_events;
CREATE POLICY "Admins can view webhook events"
  ON webhook_events FOR SELECT
  TO authenticated
  USING (is_admin());

-- Public has NO access to webhook_events
-- Service role (Edge Functions) bypasses RLS safely.
