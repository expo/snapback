import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";

const databaseId = "research-room";
const permissions = ['read("team:research-members")'];
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const hash = (value) => createHash("sha256").update(value).digest("hex");

function request(url, init = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "https:" ? https : http;
    const body = init.body ?? "";
    const outgoing = transport.request(target, {
      method: init.method ?? "GET",
      headers: {
        ...(body ? { "content-length": Buffer.byteLength(body) } : {}),
        ...(init.headers ?? {}),
      },
      timeout: 20_000,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        text: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    outgoing.on("timeout", () => outgoing.destroy(new Error("request timed out")));
    outgoing.on("error", reject);
    if (body) outgoing.write(body);
    outgoing.end();
  });
}

async function appwrite(path, init = {}) {
  const endpoint = process.env.APPWRITE_EXTERNAL_ENDPOINT
    ?? process.env.APPWRITE_FUNCTION_API_ENDPOINT;
  const response = await request(`${endpoint}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-appwrite-project": process.env.APPWRITE_FUNCTION_PROJECT_ID,
      "x-appwrite-key": process.env.ARM_API_KEY
        ?? process.env.APPWRITE_FUNCTION_API_KEY,
      ...(init.headers ?? {}),
    },
  });
  const text = response.text;
  const value = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(value.message ?? `Appwrite HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return value;
}

function rowPath(tableId, rowId = "") {
  const base = `/tablesdb/${databaseId}/tables/${tableId}/rows`;
  return rowId ? `${base}/${rowId}` : base;
}

async function createRow(tableId, rowId, data) {
  return appwrite(rowPath(tableId), {
    method: "POST",
    body: JSON.stringify({ rowId, data, permissions }),
  });
}

async function getRow(tableId, rowId) {
  return appwrite(rowPath(tableId, rowId));
}

async function updateRow(tableId, rowId, data) {
  return appwrite(rowPath(tableId, rowId), {
    method: "PATCH",
    body: JSON.stringify({ data }),
  });
}

async function answerQuestion(body, log) {
  const questionId = body.questionId;
  if (!questionId) throw new Error("questionId is required");
  const answerId = `answer-${questionId}`;
  const question = await getRow("questions", questionId);
  if (question.cancelled || question.status === "cancelled") {
    return { ok: true, outcome: "cancelled-before-start", questionId };
  }
  try {
    await createRow("answers", answerId, {
      question_id: questionId,
      status: "processing",
      body: "",
      citations_json: "[]",
      effect_state: "pending",
    });
  } catch (error) {
    if (error.status !== 409) throw error;
    const existing = await getRow("answers", answerId);
    if (existing.status === "complete" || existing.status === "cancelled") {
      return { ok: true, outcome: "idempotent-existing", questionId, status: existing.status };
    }
  }
  await updateRow("questions", questionId, { status: "processing" });
  const labels = ["retrieving", "ranking", "drafting", "citing"];
  for (let index = 0; index < labels.length; index += 1) {
    const current = await getRow("questions", questionId);
    if (current.cancelled || current.status === "cancelled") {
      await updateRow("answers", answerId, {
        status: "cancelled",
        effect_state: "terminal",
      });
      log(`answer cancelled question=${questionId}`);
      return { ok: true, outcome: "cancelled", questionId, progressCount: index };
    }
    try {
      await createRow("answer_progress", `p-${questionId}-${index + 1}`, {
        question_id: questionId,
        sequence: index + 1,
        label: labels[index],
      });
    } catch (error) {
      if (error.status !== 409) throw error;
    }
    await sleep(180);
  }
  const terminal = await getRow("questions", questionId);
  if (terminal.cancelled || terminal.status === "cancelled") {
    await updateRow("answers", answerId, {
      status: "cancelled",
      effect_state: "terminal",
    });
    return { ok: true, outcome: "cancelled", questionId, progressCount: 4 };
  }
  await updateRow("answers", answerId, {
    status: "complete",
    body: "Durable attempt identity and an authoritative cancellation fence prevent late successful patches.",
    citations_json: JSON.stringify(["source-01", "source-02"]),
    effect_state: "confirmed",
  });
  await updateRow("questions", questionId, { status: "complete" });
  log(`answer completed question=${questionId} progress=4`);
  return { ok: true, outcome: "complete", questionId, progressCount: 4 };
}

async function refreshSource(body, log) {
  const refreshId = body.refreshId ?? "refresh-proof";
  try {
    const existing = await getRow("refresh_runs", refreshId);
    return { ok: true, outcome: "idempotent-existing", refreshId, status: existing.status };
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const sourceUrl = body.sourceUrl ?? "https://www.rfc-editor.org/rfc/rfc2606.txt";
  const response = await request(sourceUrl);
  if (!response.ok) throw new Error(`refresh fetch returned ${response.status}`);
  const content = response.text;
  await createRow("refresh_runs", refreshId, {
    source_url: sourceUrl,
    status: "complete",
    content_hash: hash(content),
    progress_count: 1,
    effect_state: "confirmed",
    secret_seen: Boolean(process.env.RESEARCH_CANARY),
  });
  log(`refresh completed id=${refreshId} bytes=${content.length}`);
  return { ok: true, outcome: "complete", refreshId, bytes: content.length };
}

export default async ({ req, res, log, error }) => {
  const body = req.bodyJson ?? {};
  try {
    const result = body.operation === "refresh"
      ? await refreshSource(body, log)
      : await answerQuestion(body, log);
    return res.json(result);
  } catch (caught) {
    error(`worker failed class=${caught.name ?? "Error"} status=${caught.status ?? "none"}`);
    return res.json({ ok: false, errorClass: caught.name ?? "Error" }, 500);
  }
};
