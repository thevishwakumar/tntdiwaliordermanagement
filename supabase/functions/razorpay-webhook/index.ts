// Supabase Edge Function: razorpay-webhook
// Secure, idempotent webhook receiver for Razorpay payment notifications.
// Verifies raw request body HMAC SHA256 signature using RAZORPAY_WEBHOOK_SECRET.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-razorpay-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const lenA = a.length;
  const lenB = b.length;
  let mismatch = lenA ^ lenB;
  const maxLen = Math.max(lenA, lenB);
  for (let i = 0; i < maxLen; i++) {
    const charA = i < lenA ? a.charCodeAt(i) : 0;
    const charB = i < lenB ? b.charCodeAt(i) : 0;
    mismatch |= charA ^ charB;
  }
  return mismatch === 0;
}

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
    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") || "";

    if (!supabaseUrl || !supabaseServiceKey || !webhookSecret) {
      throw new Error("Webhook environment secrets are not configured.");
    }

    const receivedSignature = req.headers.get("x-razorpay-signature");
    if (!receivedSignature) {
      return new Response(
        JSON.stringify({ success: false, message: "Missing x-razorpay-signature header." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Preserve raw text body for cryptographic signature calculation
    const rawBody = await req.text();
    if (rawBody.length > 65536) {
      return new Response(JSON.stringify({ success: false, message: "Payload too large." }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    const isSignatureValid = timingSafeEqual(expectedSignature, receivedSignature);

    if (!isSignatureValid) {
      console.error("[Security Alert] Invalid Razorpay webhook signature rejected.");
      return new Response(
        JSON.stringify({ success: false, message: "Invalid webhook digital signature." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const event = JSON.parse(rawBody);
    const eventId = event.event_id || (event.payload?.payment?.entity?.id ? `${event.payload.payment.entity.id}_${event.event}` : String(event.created_at));
    const eventType = event.event;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Deduplication check via webhook_events table
    const { data: existingEvent } = await supabase
      .from("webhook_events")
      .select("id")
      .eq("provider_event_id", eventId)
      .maybeSingle();

    if (existingEvent) {
      return new Response(
        JSON.stringify({ success: true, message: "Webhook event already processed (idempotent duplicate)." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Record webhook event receipt
    await supabase.from("webhook_events").insert({
      provider_event_id: eventId,
      event_type: eventType,
      payload: event,
      status: "PROCESSING"
    });

    const paymentEntity = event.payload?.payment?.entity;
    const orderEntity = event.payload?.order?.entity;
    const rzpOrderId = paymentEntity?.order_id || orderEntity?.id;

    if (!rzpOrderId) {
      await supabase.from("webhook_events").update({ status: "IGNORED_NO_ORDER_ID" }).eq("provider_event_id", eventId);
      return new Response(
        JSON.stringify({ success: true, message: "Event ignored: No associated order ID." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Locate internal order via payments or orders table
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, public_order_number, total_paise, payment_status, order_status, pickup_code_hash")
      .eq("razorpay_order_id", rzpOrderId)
      .maybeSingle();

    if (orderErr || !order) {
      await supabase.from("webhook_events").update({ status: "IGNORED_ORDER_NOT_FOUND" }).eq("provider_event_id", eventId);
      return new Response(
        JSON.stringify({ success: true, message: "No matching internal order found." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date().toISOString();

    if (eventType === "payment.captured" || eventType === "order.paid") {
      // If already paid, do not overwrite or alter status
      if (order.payment_status === "PAID") {
        await supabase.from("webhook_events").update({ status: "PROCESSED_ALREADY_PAID" }).eq("provider_event_id", eventId);
        return new Response(
          JSON.stringify({ success: true, message: "Order is already marked PAID." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Generate secure store pickup code if not present
      const randomHex = Math.floor(1000 + Math.random() * 9000).toString();
      const pickupCode = order.pickup_code_hash || `TNT-PK-${randomHex}`;

      await supabase.from("orders").update({
        order_status: "PAID",
        payment_status: "PAID",
        paid_at: now,
        pickup_code_hash: pickupCode,
        updated_at: now
      }).eq("id", order.id);

      await supabase.from("order_events").insert({
        order_id: order.id,
        event_type: "WEBHOOK_PAYMENT_CAPTURED",
        from_status: order.order_status,
        to_status: "PAID",
        actor_type: "SYSTEM",
        actor_id: "RAZORPAY_WEBHOOK",
        metadata: {
          event_id: eventId,
          event_type: eventType,
          razorpay_payment_id: paymentEntity?.id,
          razorpay_order_id: rzpOrderId,
          pickup_code: pickupCode,
          verified_at: now
        }
      });

      await supabase.from("webhook_events").update({ status: "PROCESSED" }).eq("provider_event_id", eventId);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Order ${order.public_order_number} confirmed via webhook.`,
          orderId: order.id,
          publicOrderNumber: order.public_order_number
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (eventType === "payment.failed") {
      // If order is already paid, do not corrupt verified paid status
      if (order.payment_status === "PAID") {
        await supabase.from("webhook_events").update({ status: "PROCESSED_FAILED_IGNORED_ALREADY_PAID" }).eq("provider_event_id", eventId);
        return new Response(
          JSON.stringify({ success: true, message: "Order is already PAID; failed payment event ignored." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await supabase.from("orders").update({
        payment_status: "FAILED",
        updated_at: now
      }).eq("id", order.id);

      await supabase.from("order_events").insert({
        order_id: order.id,
        event_type: "WEBHOOK_PAYMENT_FAILED",
        from_status: order.order_status,
        to_status: order.order_status,
        actor_type: "SYSTEM",
        actor_id: "RAZORPAY_WEBHOOK",
        metadata: {
          event_id: eventId,
          error_code: paymentEntity?.error_code,
          error_description: paymentEntity?.error_description,
          timestamp: now
        }
      });

      await supabase.from("webhook_events").update({ status: "PROCESSED" }).eq("provider_event_id", eventId);

      return new Response(
        JSON.stringify({ success: true, message: "Payment failure recorded." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase.from("webhook_events").update({ status: "PROCESSED_UNHANDLED_TYPE" }).eq("provider_event_id", eventId);
    return new Response(
      JSON.stringify({ success: true, message: `Event ${eventType} acknowledged.` }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("Unhandled error in razorpay-webhook:", err);
    return new Response(
      JSON.stringify({ success: false, message: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
