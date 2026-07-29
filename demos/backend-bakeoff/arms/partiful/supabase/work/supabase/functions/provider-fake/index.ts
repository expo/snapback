import { createClient } from "npm:@supabase/supabase-js@2.111.0";

Deno.serve(async (request) => {
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const providerSecret = request.headers.get("x-provider-secret");
  if (providerSecret !== service) return json({ error: "UNAUTHORIZED" }, 401);
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const parsed = new URL(request.url);

  if (request.method === "GET" && parsed.pathname.includes("/status/")) {
    const dedupeKey = decodeURIComponent(parsed.pathname.split("/status/")[1]);
    const result = await admin.from("provider_deliveries").select("*").eq("dedupe_key", dedupeKey).maybeSingle();
    if (result.error) return json({ error: result.error.message }, 500);
    return json({
      delivered: Boolean(result.data),
      receipt: result.data?.receipt ?? null,
      deliveryCount: result.data?.delivery_count ?? 0
    });
  }

  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const body = await request.json();
  const dedupeKey = request.headers.get("idempotency-key") ?? "";
  if (!dedupeKey || !body.eventId) return json({ error: "INVALID_REQUEST" }, 400);
  const receipt = `fake-provider:${dedupeKey}`;
  const existing = await admin.from("provider_deliveries").select("*").eq("dedupe_key", dedupeKey).maybeSingle();
  if (existing.error) return json({ error: existing.error.message }, 500);
  if (existing.data) {
    return json({ receipt: existing.data.receipt, deduplicated: true, deliveryCount: existing.data.delivery_count });
  }
  const inserted = await admin.from("provider_deliveries").insert({
    dedupe_key: dedupeKey,
    event_id: body.eventId,
    receipt,
    delivery_count: 1
  }).select().single();
  if (inserted.error) return json({ error: inserted.error.message }, 500);
  return json({ receipt, deduplicated: false, deliveryCount: 1 });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
