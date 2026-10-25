// Supabase Edge Function: admin-products
// Manages master product catalogue, pricing in paise, and stock levels.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (req.method === "GET") {
    try {
      const client = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);
      const { data: products, error } = await client
        .from("products")
        .select("*")
        .order("created_at", { ascending: true });

      if (error) throw error;

      return new Response(JSON.stringify({ success: true, products }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ success: false, message: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  if (req.method === "POST") {
    try {
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
        return new Response(JSON.stringify({ success: false, message: "Invalid session" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
      const { data: adminProfile } = await serviceClient
        .from("admin_profiles")
        .select("role, is_active")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (!adminProfile) {
        return new Response(JSON.stringify({ success: false, message: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const { productId, priceInPaise, stockQuantity, description, isActive } = body;

      if (!productId) {
        return new Response(JSON.stringify({ success: false, message: "productId required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      if (priceInPaise !== undefined) {
        const p = parseInt(priceInPaise, 10);
        if (p <= 0) {
          return new Response(JSON.stringify({ success: false, message: "Price must be positive" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        updates.price_in_paise = p;
      }
      if (stockQuantity !== undefined) updates.stock_quantity = parseInt(stockQuantity, 10);
      if (description !== undefined) updates.description = description;
      if (isActive !== undefined) updates.is_active = Boolean(isActive);

      const { data: updatedProduct, error: updateError } = await serviceClient
        .from("products")
        .update(updates)
        .eq("id", productId)
        .select()
        .single();

      if (updateError) throw updateError;

      return new Response(JSON.stringify({ success: true, product: updatedProduct }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ success: false, message: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response(JSON.stringify({ success: false, message: "Method not allowed" }), {
    status: 405,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
