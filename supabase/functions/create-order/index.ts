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
      fulfilmentMethod,
      deliveryAddress,
      idempotencyKey: bodyIdempotencyKey
    } = body;

    // Fast edge validation to drop invalid requests early under high concurrency
    if (!customerName || typeof customerName !== 'string' || customerName.trim().length < 2 || customerName.length > 100) {
      return new Response(
        JSON.stringify({ success: false, message: "Customer name must be between 2 and 100 characters." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!customerMobile || typeof customerMobile !== 'string' || customerMobile.trim().length < 10 || customerMobile.length > 20) {
      return new Response(
        JSON.stringify({ success: false, message: "Customer mobile must be a valid 10-digit mobile number." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      return new Response(
        JSON.stringify({ success: false, message: "Items list must contain between 1 and 50 products." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawIdempotency = req.headers.get("idempotency-key") || bodyIdempotencyKey || null;
    const idempotencyKey = rawIdempotency ? String(rawIdempotency).trim().slice(0, 128) : null;

    // Normalize items to ensure snake_case product_id
    const normalizedItems = items.map((it: any) => ({
      product_id: String(it.product_id || it.productId || it.id || '').trim().slice(0, 64),
      quantity: Math.max(1, Math.min(50, Math.floor(Number(it.quantity) || 1)))
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
      p_pickup_time: pickupTime || null,
      p_fulfilment_method: fulfilmentMethod || 'PICKUP',
      p_delivery_address: deliveryAddress || null
    });

    if (error) {
      console.error("Atomic order creation error:", error);
      return new Response(
        JSON.stringify({ success: false, message: error.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If this is an existing duplicate order, preserve and return its existing razorpay_order_id
    if (data.is_duplicate) {
      const { data: existingOrder } = await supabase
        .from("orders")
        .select("razorpay_order_id")
        .eq("id", data.order_id)
        .single();

      if (existingOrder?.razorpay_order_id) {
        return new Response(
          JSON.stringify({
            success: true,
            ...data,
            razorpayOrderId: existingOrder.razorpay_order_id,
            razorpayKeyId: razorpayKeyId || null,
            razorpay_order_id: existingOrder.razorpay_order_id,
            razorpay_key_id: razorpayKeyId || null
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
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

          // Crucial: Store razorpay_order_id in orders record for verification and webhook binding
          await supabase
            .from("orders")
            .update({ razorpay_order_id: razorpayOrderId })
            .eq("id", data.order_id);

          // Record pending payment entry
          await supabase
            .from("payments")
            .upsert({
              order_id: data.order_id,
              provider: "RAZORPAY",
              provider_order_id: razorpayOrderId,
              amount_paise: data.total_paise,
              currency: "INR",
              status: "PENDING"
            }, { onConflict: "provider_order_id" });
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
        razorpayKeyId: razorpayKeyId || null,
        razorpay_order_id: razorpayOrderId,
        razorpay_key_id: razorpayKeyId || null
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
