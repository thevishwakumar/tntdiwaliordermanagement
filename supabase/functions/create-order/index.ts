// Supabase Edge Function: create-order
// Validates customer inputs, authoritative product prices in paise, and creates order atomically.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
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
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase backend configuration is missing.");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();

    const {
      customerName,
      customerMobile,
      customerEmail,
      customerNotes,
      items,
      idempotencyKey: bodyIdempotencyKey
    } = body;

    const idempotencyKey = req.headers.get("idempotency-key") || bodyIdempotencyKey || null;

    // Call atomic stored procedure
    const { data, error } = await supabase.rpc("create_order_atomic", {
      p_customer_name: customerName,
      p_customer_mobile: customerMobile,
      p_customer_email: customerEmail || null,
      p_customer_notes: customerNotes || null,
      p_items: items,
      p_idempotency_key: idempotencyKey
    });

    if (error) {
      console.error("Atomic order creation error:", error);
      return new Response(
        JSON.stringify({ success: false, message: error.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify(data),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("Unhandled error in create-order:", err);
    return new Response(
      JSON.stringify({ success: false, message: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
