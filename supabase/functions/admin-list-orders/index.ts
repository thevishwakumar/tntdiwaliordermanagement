// Supabase Edge Function: admin-list-orders
// Protected endpoint requiring authenticated active admin session.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ success: false, message: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, message: "Authorization required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authenticate user via Supabase Auth
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ success: false, message: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin authorization in admin_profiles with service client
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: adminProfile, error: adminError } = await serviceClient
      .from("admin_profiles")
      .select("user_id, role, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();

    if (adminError || !adminProfile) {
      return new Response(JSON.stringify({ success: false, message: "Forbidden: Not an authorized administrator" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse query params for filtering and pagination
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const search = url.searchParams.get("search");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);

    let query = serviceClient
      .from("orders")
      .select(`
        id,
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
        customer_notes,
        created_at,
        paid_at,
        ready_at,
        picked_up_at,
        order_items (
          id,
          product_name_snapshot,
          unit_snapshot,
          unit_price_paise,
          quantity,
          line_total_paise
        )
      `, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status && status !== "ALL") {
      query = query.eq("order_status", status);
    }

    if (search) {
      query = query.or(`public_order_number.ilike.%${search}%,customer_name.ilike.%${search}%,customer_mobile.ilike.%${search}%`);
    }

    const { data: orders, count, error: fetchError } = await query;

    if (fetchError) {
      throw fetchError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        orders,
        total: count,
        limit,
        offset,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("Unhandled error in admin-list-orders:", err);
    return new Response(
      JSON.stringify({ success: false, message: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
