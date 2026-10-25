// Supabase Edge Function: admin-update-order-status
// Enforces allowed order status state machine and logs admin transitions in order_events.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// State Machine of permitted order status transitions (No compulsory preparing queue)
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  AWAITING_PAYMENT: ["CANCELLED"],
  PAID: ["READY_FOR_PICKUP", "PREPARING", "CANCELLED"],
  SCHEDULED: ["READY_FOR_PICKUP", "PREPARING", "CANCELLED"],
  PREPARING: ["READY_FOR_PICKUP", "CANCELLED"],
  READY_FOR_PICKUP: ["CANCELLED"], // Direct transition to PICKED_UP requires verification code via verify_pickup_code RPC
  PICKED_UP: [],
  CANCELLED: [],
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
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
      return new Response(JSON.stringify({ success: false, message: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify admin
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

    const body = await req.json();
    const { orderId, newStatus, reason } = body;

    if (!orderId || !newStatus) {
      return new Response(
        JSON.stringify({ success: false, message: "Both orderId and newStatus are required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch current order
    const { data: order, error: orderFetchError } = await serviceClient
      .from("orders")
      .select("id, order_status, public_order_number")
      .eq("id", orderId)
      .single();

    if (orderFetchError || !order) {
      return new Response(
        JSON.stringify({ success: false, message: "Order not found." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const currentStatus = order.order_status;
    const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];

    if (!allowed.includes(newStatus)) {
      return new Response(
        JSON.stringify({
          success: false,
          message: `Illegal status transition from ${currentStatus} to ${newStatus}. Permitted next states: [${allowed.join(", ")}]`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prepare timestamp updates
    const updates: Record<string, any> = {
      order_status: newStatus,
    };

    if (newStatus === "READY_FOR_PICKUP") {
      updates.ready_at = new Date().toISOString();
      updates.pickup_status = "READY_FOR_PICKUP";
    } else if (newStatus === "PICKED_UP") {
      updates.picked_up_at = new Date().toISOString();
      updates.pickup_status = "PICKED_UP";
    } else if (newStatus === "CANCELLED") {
      updates.cancelled_at = new Date().toISOString();
    }

    // Perform order update
    const { error: updateError } = await serviceClient
      .from("orders")
      .update(updates)
      .eq("id", orderId);

    if (updateError) {
      throw updateError;
    }

    // Log event in order_events
    await serviceClient.from("order_events").insert({
      order_id: orderId,
      event_type: "STATUS_CHANGED",
      from_status: currentStatus,
      to_status: newStatus,
      actor_type: "ADMIN",
      actor_id: user.id,
      metadata: {
        reason: reason || null,
        admin_role: adminProfile.role,
        timestamp: new Date().toISOString(),
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        orderId,
        previousStatus: currentStatus,
        newStatus,
        message: `Order status successfully transitioned to ${newStatus}.`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("Unhandled error in admin-update-order-status:", err);
    return new Response(
      JSON.stringify({ success: false, message: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
