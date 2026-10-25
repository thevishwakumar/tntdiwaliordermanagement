# TNT Diwali Order Management System — Production Deployment Guide
## Shree Taste N Taste Catering (TNT — Taste N Trust)

This guide provides end-to-end instructions for deploying the TNT Diwali Order Management System to production.

---

### 1. Architecture Overview

- **Frontend**: Vanilla HTML5, CSS3, ES Modules. Static hosting on any CDN (Cloudflare Pages, Vercel, Netlify) or served via the turnkey Node.js runtime.
- **Backend & Database**: Supabase PostgreSQL (`https://bondkwckhnbjslshyflp.supabase.co`) with Row Level Security (RLS) policies and Edge Functions.
- **Payment Gateway**: Razorpay Live Verification Engine (Server-side HMAC SHA256 validation).
- **Fulfillment**: Customer Storefront Pickup (Strictly No Home Delivery, No Cash on Delivery).

---

### 2. Environment Variables & Secrets Checklist

Create a secure `.env` file on your production server. **Never commit this file to Git.**

| Variable Name | Environment | Description | Sensitivity | Example / Status |
|---------------|-------------|-------------|:-----------:|------------------|
| `PORT` | Node.js Server | Application port | Low | `3000` |
| `SUPABASE_URL` | Global | Supabase project URL | Public | `https://bondkwckhnbjslshyflp.supabase.co` |
| `SUPABASE_ANON_KEY` | Frontend / Client | Public anonymous key | Public | `sb_publishable_Y_2PQ1jH3R9WKS5C6eXryw_YODqZPqD` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server / Functions | Privileged service key | **CRITICAL SECRET** | `sb_secret_TPS_2q94gWk1P_...` |
| `RAZORPAY_KEY_ID` | Global | Razorpay public Key ID | Public | `rzp_live_...` (or `rzp_test_...`) |
| `RAZORPAY_KEY_SECRET` | Server / Functions | Razorpay Key Secret | **CRITICAL SECRET** | `6tJrsoptI5w6...` |
| `RAZORPAY_WEBHOOK_SECRET` | Edge Functions | Webhook validation secret | **CRITICAL SECRET** | Configured in Razorpay Dashboard |
| `DATABASE_URL` | Direct DB / Migrations | PostgreSQL direct URI | **CRITICAL SECRET** | `postgresql://postgres:...@db...` |

---

### 3. Database Migrations Execution

The database schema has already been applied to your live Supabase project. If setting up a new project or staging instance, execute migrations in sequence via the **Supabase SQL Editor**:

1. **Initial Schema & Catalogue**:
   - File: [`supabase/migrations/20261025000000_tnt_diwali_initial_schema.sql`](file:///c:/Users/Vishw/OneDrive/Desktop/TNT%20Diwali%20Order%20Mangement/supabase/migrations/20261025000000_tnt_diwali_initial_schema.sql)
   - Provisions: `products`, `orders`, `order_items`, `payments`, `admin_profiles`, `order_events`, RLS policies, and seeded products.
2. **Admin Operations & Atomic Verification**:
   - File: [`supabase/migrations/20261025000001_stage4_admin_operations.sql`](file:///c:/Users/Vishw/OneDrive/Desktop/TNT%20Diwali%20Order%20Mangement/supabase/migrations/20261025000001_stage4_admin_operations.sql)
   - Provisions: `stock_quantity`, `low_stock_threshold`, atomic counter pickup verification `verify_order_pickup_atomic`, and product update procedure.

---

### 4. Admin Account Provisioning

To authorize shop managers in Supabase Auth:
1. Navigate to **Supabase Dashboard ➔ Authentication ➔ Users**.
2. Click **Add User ➔ Create User**.
   - Email: `admin@tntcatering.in`
   - Password: `<Secure-Admin-Password>`
   - Auto Confirm User: **Checked**
3. Open **SQL Editor** and link the auth UID to `admin_profiles`:
```sql
INSERT INTO public.admin_profiles (id, display_name, role, is_active)
VALUES ('<SUPABASE-AUTH-USER-UID>', 'TNT Admin', 'admin', true)
ON CONFLICT (id) DO UPDATE SET is_active = true, role = 'admin';
```

---

### 5. Supabase Edge Functions Deployment

To deploy the privileged serverless functions using Supabase CLI:

```bash
# 1. Login to Supabase CLI
supabase login

# 2. Link your cloud project
supabase link --project-ref bondkwckhnbjslshyflp

# 3. Set production secrets
supabase secrets set RAZORPAY_KEY_ID="rzp_live_..."
supabase secrets set RAZORPAY_KEY_SECRET="<YOUR-LIVE-SECRET>"
supabase secrets set RAZORPAY_WEBHOOK_SECRET="<YOUR-WEBHOOK-SECRET>"

# 4. Deploy all functions
supabase functions deploy create-order --no-verify-jwt
supabase functions deploy verify-payment --no-verify-jwt
supabase functions deploy get-order-status --no-verify-jwt
supabase functions deploy admin-list-orders
supabase functions deploy admin-update-order-status
```

---

### 6. Razorpay Production Activation & Webhook Setup

1. **Activate Live Mode**:
   - Log in to [Razorpay Dashboard](https://dashboard.razorpay.com/).
   - Complete KYC and click **Switch to Live Mode**.
   - Go to **Settings ➔ API Keys ➔ Generate Live Key**.
   - Copy `RAZORPAY_KEY_ID` (`rzp_live_...`) and `RAZORPAY_KEY_SECRET`.
2. **Configure Webhook**:
   - In Razorpay Dashboard, go to **Settings ➔ Webhooks ➔ Add New Webhook**.
   - Webhook URL: `https://<YOUR-DOMAIN>/api/razorpay-webhook` (or Supabase function URL).
   - Secret: Set a strong random secret and add it to `RAZORPAY_WEBHOOK_SECRET`.
   - Active Events:
     - `payment.captured`
     - `payment.failed`
     - `order.paid`

---

### 7. Turnkey Node.js Production Hosting

The system includes a zero-dependency production HTTP server (`server.js`) ready to run behind PM2 or systemd:

```bash
# Install PM2 process manager
npm install -g pm2

# Start the application with 2 cluster workers
pm2 start server.js --name "tnt-diwali-hub" -i 2

# Save PM2 process list to restart automatically on server reboot
pm2 save
pm2 startup
```

#### Nginx Reverse Proxy Configuration (with SSL)
```nginx
server {
    server_name orders.tntcatering.in;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    listen 443 ssl http2;
    ssl_certificate /etc/letsencrypt/live/orders.tntcatering.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/orders.tntcatering.in/privkey.pem;
}
```

---

### 8. Security Hardening Checklist

- [x] **Zero Secrets in Code**: Checked against Git repository; `.env` strictly untracked.
- [x] **Exact Money Representation**: Integer paise used throughout backend and database.
- [x] **Server-Side Price Authority**: Master catalogue prices enforce final payable amount.
- [x] **Cryptographic Verification**: HMAC SHA256 signature verification enforced before marking orders `PAID`.
- [x] **Unpaid Quarantine**: Unpaid orders barred from kitchen packing queue.
- [x] **Anti-Replay Handover**: Counter pickup codes verified atomically server-side; replay rejected.
- [x] **Parcel Label Security**: Visible parcel labels strictly omit customer pickup codes, signatures, and API keys.
- [x] **2-Factor Customer Privacy**: Order status lookup requires matching Order Number and registered Mobile.
- [x] **Row Level Security**: Enabled on all Supabase tables (`products`, `orders`, `order_items`, `payments`, `admin_profiles`, `order_events`).

---

### 9. Database Backup & Disaster Recovery

#### Scheduled Automated Backup
Supabase cloud automatically takes daily WAL backups. For external backups, run a daily pg_dump:

```bash
# Daily Backup Script (run via cron at 02:00 AM IST)
pg_dump "postgresql://postgres:Vishwa@8105@db.bondkwckhnbjslshyflp.supabase.co:5432/postgres" \
  --format=custom \
  --file="/backups/tnt_diwali_$(date +\%Y\%m\%d).dump"
```

#### Point-In-Time Restoration Procedure
```bash
pg_restore --clean --if-exists --no-owner \
  -d "postgresql://postgres:Vishwa@8105@db.bondkwckhnbjslshyflp.supabase.co:5432/postgres" \
  /backups/tnt_diwali_20261025.dump
```
