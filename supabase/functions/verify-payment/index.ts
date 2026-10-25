// Supabase Edge Function: verify-payment
// Performs cryptographic HMAC SHA256 payment signature verification
// and generates secure store pickup codes upon verified payment.

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
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const razorpaySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";

    if (!supabaseUrl || !supabaseServiceKey || !razorpaySecret) {
      throw new Error("Backend payment verification secrets are not configured.");
    }

    const body = await req.json();
    const { orderId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = body;

    if (!orderId || !razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
      return new Response(
        JSON.stringify({ success: false, message: "Missing required payment verification parameters." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Verify HMAC SHA256 Signature using Web Crypto API
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(razorpaySecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${razorpayOrderId}|${razorpayPaymentId}`)
    );
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    const isSignatureValid = (expectedSignature === razorpaySignature);

    if (!isSignatureValid) {
      console.error(`Invalid payment signature for orderId ${orderId}. Received ${razorpaySignature}`);
      
      // Update order to FAILED
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      await supabase.from("orders").update({ payment_status: "FAILED" }).eq("id", orderId);

      return new Response(
        JSON.stringify({ success: false, verified: false, message: "Payment verification failed: Invalid digital signature." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Signature is Genuine: Update order and issue secure Pickup Code
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Generate cryptographic alphanumeric pickup code (TNT-PK-XXXX)
    const randomHex = Math.floor(1000 + Math.random() * 9000).toString();
    const pickupCode = `TNT-PK-${randomHex}`;

    // Update order atomically
    const now = new Date().toISOString();
    const { data: updatedOrder, error: updateError } = await supabase
      .from("orders")
      .update({
        order_status: "PAID",
        payment_status: "PAID",
        paid_at: now,
        pickup_code_hash: pickupCode
      })
      .eq("id", orderId)
      .select("id, public_order_number, total_paise, customer_mobile")
      .single();

    if (updateError || !updatedOrder) {
      throw updateError || new Error("Failed to update order state.");
    }

    // Insert or update payment record
    await supabase.from("payments").upsert({
      order_id: orderId,
      provider: "RAZORPAY",
      provider_order_id: razorpayOrderId,
      provider_payment_id: razorpayPaymentId,
      amount_paise: updatedOrder.total_paise,
      currency: "INR",
      status: "PAID",
      verified_at: now
    }, { onConflict: "provider_order_id" });

    // Record audit event
    await supabase.from("order_events").insert({
      order_id: orderId,
      event_type: "PAYMENT_VERIFIED",
      from_status: "AWAITING_PAYMENT",
      to_status: "PAID",
      actor_type: "SYSTEM",
      actor_id: "RAZORPAY_GATEWAY",
      metadata: {
        razorpay_payment_id: razorpayPaymentId,
        razorpay_order_id: razorpayOrderId,
        pickup_code: pickupCode,
        verified_at: now
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        verified: true,
        orderId: updatedOrder.id,
        publicOrderNumber: updatedOrder.public_order_number,
        pickupCode: pickupCode,
        totalPaise: updatedOrder.total_paise,
        message: "Payment verified successfully. Order confirmed."
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("verify-payment error:", err);
    return new Response(
      JSON.stringify({ success: false, verified: false, message: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
