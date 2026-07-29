import { createClient } from "npm:@supabase/supabase-js@2.111.0";

const cors = { "content-type": "application/json" };

Deno.serve(async (request) => {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const endpoint = Deno.env.get("NOTIFY_ENDPOINT") ?? `${url}/functions/v1/provider-fake`;
    const providerHeaders = {
      authorization: `Bearer ${service}`,
      apikey: service,
      "x-provider-secret": service
    };

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false }
    });
    const body = await request.json();
    const { eventId, dedupeKey, fault = "none" } = body;
    const { data: event, error: eventError } = await userClient
      .from("events").select("id").eq("id", eventId).single();
    if (eventError || !event) return json({ error: "EVENT_FORBIDDEN" }, 403);

    const admin = createClient(url, service, { auth: { persistSession: false } });
    const prior = await admin.from("notification_attempts")
      .select("*").eq("dedupe_key", dedupeKey).order("attempt_no", { ascending: false }).limit(1);
    if (prior.error) throw prior.error;
    const last = prior.data[0];
    if (last?.state === "succeeded") {
      return json({ state: "succeeded", deduplicated: true, attemptNo: last.attempt_no, receipt: last.provider_receipt });
    }

    if (last?.state === "ambiguous") {
      const statusResponse = await fetch(`${endpoint}/status/${encodeURIComponent(dedupeKey)}`, { headers: providerHeaders });
      const statusBody = await statusResponse.json();
      if (statusBody.delivered) {
        const attemptNo = last.attempt_no + 1;
        const recorded = await record(admin, eventId, dedupeKey, attemptNo, "succeeded", statusBody.receipt, statusResponse.status, "reconciled-ambiguous");
        return json({ state: "succeeded", reconciled: true, attemptNo, receipt: recorded.provider_receipt });
      }
    }

    const attemptNo = (last?.attempt_no ?? 0) + 1;
    let response: Response;
    try {
      response = await fetch(`${endpoint}/deliver`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": dedupeKey, ...providerHeaders },
        body: JSON.stringify({ eventId, actor: "authenticated-edge-principal", fault })
      });
    } catch (error) {
      const recorded = await record(admin, eventId, dedupeKey, attemptNo, "ambiguous", "", 0, `transport:${String(error)}`);
      return json({ state: recorded.state, attemptNo }, 202);
    }

    if (fault === "ambiguous-after-accept") {
      const recorded = await record(admin, eventId, dedupeKey, attemptNo, "ambiguous", "", response.status, fault);
      return json({ state: recorded.state, attemptNo }, 202);
    }

    const provider = await response.json();
    const state = response.ok ? "succeeded" : "failed";
    const recorded = await record(admin, eventId, dedupeKey, attemptNo, state, provider.receipt ?? "", response.status, fault);
    return json({ state: recorded.state, attemptNo, receipt: recorded.provider_receipt }, response.ok ? 200 : 502);
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
});

async function record(admin: ReturnType<typeof createClient>, eventId: string, dedupeKey: string, attemptNo: number, state: string, receipt: string, code: number, fault: string) {
  const result = await admin.rpc("record_effect_attempt", {
    target_event: eventId,
    target_dedupe: dedupeKey,
    target_attempt: attemptNo,
    target_state: state,
    target_receipt: receipt,
    target_code: code,
    target_fault: fault
  });
  if (result.error) throw result.error;
  return result.data;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
