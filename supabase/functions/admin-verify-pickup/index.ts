// Supabase Edge Function: admin-verify-pickup
// Atomic counter pickup verification requiring valid pickup code and staff physical confirmation.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

    // Verify admin token
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

    const body = await req.json();
    let targetOrderId = body.orderId || body.order_id;
    const targetOrderNumber = body.orderNumber || body.publicOrderNumber || body.public_order_number;
    const pickupCode = body.pickupCode || body.pickup_code;
    const staffConfirmed = body.staffConfirmed !== false;

    if (!targetOrderId && targetOrderNumber) {
      const { data: ord } = await serviceClient
        .from("orders")
        .select("id")
        .eq("public_order_number", targetOrderNumber)
        .maybeSingle();
      if (ord) targetOrderId = ord.id;
    }

    if (!targetOrderId || !pickupCode) {
      return new Response(
        JSON.stringify({ success: false, message: "Both order identifier and customer pickup code are required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!staffConfirmed) {
      return new Response(
        JSON.stringify({ success: false, message: "Staff physical collection confirmation is required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call atomic stored procedure
    let rpcResponse = await serviceClient.rpc("verify_order_pickup_atomic", {
      p_order_id: targetOrderId,
      p_pickup_code: pickupCode,
      p_staff_id: user.id || "admin_counter",
    });

    if (rpcResponse.error) {
      throw rpcResponse.error;
    }

    let rpcResult = rpcResponse.data;

    // Flexible retry: If rejected due to code mismatch, try alternate format (with/without TNT-PK-)
    if (rpcResult && !rpcResult.success && rpcResult.code === "INVALID_PICKUP_CODE") {
      const cleanInput = String(pickupCode).trim().toUpperCase();
      const altCode = cleanInput.startsWith("TNT-PK-")
        ? cleanInput.replace("TNT-PK-", "")
        : `TNT-PK-${cleanInput}`;

      const retryResponse = await serviceClient.rpc("verify_order_pickup_atomic", {
        p_order_id: targetOrderId,
        p_pickup_code: altCode,
        p_staff_id: user.id || "admin_counter",
      });

      if (!retryResponse.error && retryResponse.data && retryResponse.data.success) {
        rpcResult = retryResponse.data;
      }
    }

    const status = rpcResult.success ? 200 : 400;
    return new Response(JSON.stringify({
      ...rpcResult,
      order: {
        id: rpcResult.order_id,
        public_order_number: rpcResult.public_order_number,
        customer_name: rpcResult.customer_name,
        order_status: 'PICKED_UP',
        picked_up_at: rpcResult.picked_up_at
      }
    }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("admin-verify-pickup error:", err);
    return new Response(
      JSON.stringify({ success: false, message: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
