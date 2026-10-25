// Supabase Edge Function: create-order
// Validates customer inputs, authoritative product prices in paise, and creates order atomically.
// Generates genuine Razorpay order for online payment confirmation.

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
    const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID") || "";
    const razorpaySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";

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
      pickupDate,
      pickupTime,
      idempotencyKey: bodyIdempotencyKey
    } = body;

    const idempotencyKey = req.headers.get("idempotency-key") || bodyIdempotencyKey || null;

    // Normalize items to ensure snake_case product_id
    const normalizedItems = (items || []).map((it: any) => ({
      product_id: it.product_id || it.productId || it.id,
      quantity: Number(it.quantity)
    }));

    // Call atomic stored procedure
    const { data, error } = await supabase.rpc("create_order_atomic", {
      p_customer_name: customerName,
      p_customer_mobile: customerMobile,
      p_customer_email: customerEmail || null,
      p_customer_notes: customerNotes || null,
      p_items: normalizedItems,
      p_idempotency_key: idempotencyKey,
      p_pickup_date: pickupDate || null,
      p_pickup_time: pickupTime || null
    });

    if (error) {
      console.error("Atomic order creation error:", error);
      return new Response(
        JSON.stringify({ success: false, message: error.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate genuine Razorpay order if keys are configured
    let razorpayOrderId = null;
    if (razorpayKeyId && razorpaySecret && data.total_paise > 0) {
      try {
        const authHeader = "Basic " + btoa(`${razorpayKeyId}:${razorpaySecret}`);
        const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
          method: "POST",
          headers: {
            "Authorization": authHeader,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            amount: data.total_paise,
            currency: "INR",
            receipt: String(data.public_order_number || data.order_id).slice(0, 40),
            notes: {
              order_id: data.order_id,
              public_order_number: data.public_order_number
            }
          })
        });

        if (rzpRes.ok) {
          const rzpData = await rzpRes.json();
          razorpayOrderId = rzpData.id;
        } else {
          console.warn("Razorpay API returned non-OK status:", await rzpRes.text());
        }
      } catch (rzpErr) {
        console.error("Failed to create Razorpay order:", rzpErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        ...data,
        razorpayOrderId,
        razorpayKeyId: razorpayKeyId || null
      }),
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
