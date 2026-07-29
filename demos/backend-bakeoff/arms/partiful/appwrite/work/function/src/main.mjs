import { createHash } from "node:crypto";

const databaseId = "partiful";
const deliveriesTable = "notification_deliveries";
const attemptsTable = "effect_attempts";
const idFor = (value) => createHash("sha256").update(value).digest("hex").slice(0, 32);

async function appwrite(path, init = {}) {
  const endpoint = process.env.APPWRITE_EXTERNAL_ENDPOINT ?? process.env.APPWRITE_FUNCTION_API_ENDPOINT;
  const response = await fetch(`${endpoint}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-appwrite-project": process.env.APPWRITE_FUNCTION_PROJECT_ID,
      "x-appwrite-key": process.env.ARM_API_KEY ?? process.env.APPWRITE_FUNCTION_API_KEY,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(value.message ?? `Appwrite HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return value;
}

async function createRow(tableId, rowId, data) {
  return appwrite(`/tablesdb/${databaseId}/tables/${tableId}/rows`, {
    method: "POST",
    body: JSON.stringify({ rowId, data, permissions: [] }),
  });
}

export default async ({ req, res, log, error }) => {
  const body = req.bodyJson ?? {};
  const dedupeKey = body.dedupeKey ?? "scheduled-event-01";
  const eventId = body.eventId ?? "event-01";
  const attemptNumber = Number(body.attemptNumber ?? 1);
  const attemptId = idFor(`${dedupeKey}:${attemptNumber}`);
  let outcome = "delivered";
  let effectStatus = 0;
  try {
    const effect = await fetch(process.env.EFFECT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-effect-secret": process.env.EFFECT_SECRET,
      },
      body: JSON.stringify({ dedupeKey, eventId, attemptNumber }),
    });
    effectStatus = effect.status;
    const effectBody = await effect.json();
    outcome = effectBody.duplicate ? "duplicate-confirmed" : "delivered";
  } catch (caught) {
    outcome = "ambiguous";
    error(`effect ambiguity for ${dedupeKey}; retry is safe`);
  }

  try {
    await createRow(attemptsTable, attemptId, {
      dedupe_key: dedupeKey,
      attempt_number: attemptNumber,
      outcome,
      detail: `effect-http-${effectStatus || "unknown"}`,
    });
  } catch (caught) {
    if (caught.status !== 409) throw caught;
  }

  if (outcome !== "ambiguous") {
    try {
      await createRow(deliveriesTable, idFor(dedupeKey), {
        dedupe_key: dedupeKey,
        event_id: eventId,
        state: "delivered",
        delivery_count: 1,
      });
    } catch (caught) {
      if (caught.status !== 409) throw caught;
    }
  }
  log(`notification outcome=${outcome} keyHash=${idFor(dedupeKey)}`);
  return res.json({ ok: outcome !== "ambiguous", outcome, dedupeKey, attemptNumber }, outcome === "ambiguous" ? 502 : 200);
};
