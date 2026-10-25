// Supabase Edge Function: admin-metrics
// Computes live operational dashboard metrics and verified revenue from database records.

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

    // Verify token
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ success: false, message: "Invalid or expired session token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin authorization
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: adminProfile } = await serviceClient
      .from("admin_profiles")
      .select("role, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!adminProfile) {
      return new Response(JSON.stringify({ success: false, message: "Forbidden: Administrator access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch live orders summary
    const { data: orders, error: ordersError } = await serviceClient
      .from("orders")
      .select("id, total_paise, payment_status, order_status, pickup_date");

    if (ordersError) {
      throw ordersError;
    }

    const allOrders = orders || [];
    const today = new Date().toISOString().split("T")[0];

    let totalVerifiedRevenuePaise = 0;
    let paidOrders = 0;
    let awaitingPayment = 0;
    let preparing = 0;
    let readyForPickup = 0;
    let pickedUp = 0;
    let cancelled = 0;
    let upcomingPickups = 0;

    for (const o of allOrders) {
      if (o.payment_status === "PAID") {
        totalVerifiedRevenuePaise += o.total_paise || 0;
        paidOrders++;
      } else if (o.payment_status === "PENDING") {
        awaitingPayment++;
      }

      if (o.order_status === "PREPARING") {
        preparing++;
      } else if (o.order_status === "READY_FOR_PICKUP") {
        readyForPickup++;
      } else if (o.order_status === "PICKED_UP") {
        pickedUp++;
      } else if (o.order_status === "CANCELLED") {
        cancelled++;
      }

      // Upcoming Pickups: Paid and pickup date >= today and not yet picked up
      if (o.payment_status === "PAID" && o.order_status !== "PICKED_UP" && o.order_status !== "CANCELLED") {
        if (!o.pickup_date || o.pickup_date >= today) {
          upcomingPickups++;
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        metrics: {
          totalOrders: allOrders.length,
          paidOrders,
          awaitingPayment,
          pendingPayment: awaitingPayment,
          upcomingPickups,
          preparing,
          readyForPickup,
          pickedUp,
          cancelled,
          cancelledOrders: cancelled,
          totalVerifiedRevenuePaise,
          totalVerifiedRevenueRupees: Math.floor(totalVerifiedRevenuePaise / 100),
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("admin-metrics error:", err);
    return new Response(
      JSON.stringify({ success: false, message: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
