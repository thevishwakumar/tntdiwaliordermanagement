# Supabase Database Setup & Administrator Migration Guide
**TNT Diwali Order Management System**

This guide provides instructions for deploying the PostgreSQL schema, Row Level Security (RLS) policies, Edge Functions, and provisioning the first administrator in Supabase.

---

## 1. Apply PostgreSQL Migration

### Method A: Via Supabase Dashboard (SQL Editor)
1. Open your [Supabase Project Dashboard](https://supabase.com/dashboard).
2. Navigate to **SQL Editor** in the left sidebar.
3. Open the file [`supabase/migrations/20261025000000_tnt_diwali_initial_schema.sql`](file:///c:/Users/Vishw/OneDrive/Desktop/TNT%20Diwali%20Order%20Mangement/supabase/migrations/20261025000000_tnt_diwali_initial_schema.sql).
4. Paste the entire contents into the SQL Editor and click **Run**.
5. Verify in **Table Editor** that the following 6 tables are created:
   - `products` (seeded with the 5 approved Diwali products in paise)
   - `orders` (with RLS enabled)
   - `order_items` (with RLS enabled)
   - `payments` (with RLS enabled)
   - `admin_profiles` (with RLS enabled)
   - `order_events` (with RLS enabled)

### Method B: Via Supabase CLI
```bash
# Link your local project to your Supabase project ref
supabase link --project-ref <your-project-id>

# Push the migration
supabase db push
```

---

## 2. Provisioning the First Administrator

Per security rules, public administrator registration is disabled. Administrators are authenticated through **Supabase Auth** and verified server-side against `admin_profiles`.

### Step 1: Create the User in Supabase Auth
1. In the Supabase Dashboard, go to **Authentication** -> **Users**.
2. Click **Add User** -> **Create User**.
3. Enter the administrator's email (e.g. `admin@tntcatering.in`) and a secure password.
4. Toggle **Auto Confirm User?** to **Yes** (or confirm via email).
5. Click **Create User**.
6. Copy the **User UID** (UUID string, e.g. `a1b2c3d4-e5f6-7890-abcd-ef1234567890`).

### Step 2: Grant Administrator Authorization
1. Go back to the **SQL Editor**.
2. Run the following statement, replacing `<USER_UID>` with the copied UUID:
```sql
INSERT INTO admin_profiles (user_id, role, is_active)
VALUES ('<USER_UID>', 'admin', true)
ON CONFLICT (user_id) DO UPDATE SET is_active = true, role = 'admin';
```

The administrator can now log in at `/admin/login.html` and access the live order queue and kitchen state machine controls.

---

## 3. Deploying Supabase Edge Functions

The 4 privileged serverless functions are located in `supabase/functions/`:

1. `create-order`: Atomic order creation with authoritative paise calculation and idempotency protection.
2. `get-order-status`: Secure 2-factor customer order lookup (Order Number + Mobile).
3. `admin-list-orders`: Protected order queue listing for authenticated administrators.
4. `admin-update-order-status`: State machine transition enforcement with event audit trail.

### Deployment Commands:
```bash
# Deploy each function using the Supabase CLI
supabase functions deploy create-order --no-verify-jwt
supabase functions deploy get-order-status --no-verify-jwt
supabase functions deploy admin-list-orders
supabase functions deploy admin-update-order-status
```

*Note: `create-order` and `get-order-status` use `--no-verify-jwt` because customer requests do not carry a Supabase user session; privileged operations are performed inside the function using the service role client and security definer procedures.*

---

## 4. Environment Variables Checklist

Set these in your Supabase project under **Project Settings** -> **API**:
- `SUPABASE_URL`: Your project URL (e.g. `https://xyzcompany.supabase.co`)
- `SUPABASE_ANON_KEY`: Safe public anon key for frontend clients.
- `SUPABASE_SERVICE_ROLE_KEY`: Privileged key used strictly inside Edge Functions and backend server. **Never expose in frontend files.**

---

## 5. Security & Access Control Verification

| Table | Public Access | Customer Access | Admin Access |
|---|---|---|---|
| `products` | SELECT (active products only) | SELECT | ALL (Manage items & prices) |
| `orders` | No direct access | Via `get-order-status` (with mobile verification) | ALL (via authenticated session) |
| `order_items` | No direct access | Via `get-order-status` | SELECT (Order details) |
| `payments` | No direct access | No direct access | SELECT (Reconciliation) |
| `admin_profiles` | No direct access | No direct access | SELECT (Own profile) |
| `order_events` | No direct access | No direct access | SELECT (Audit trail) |
