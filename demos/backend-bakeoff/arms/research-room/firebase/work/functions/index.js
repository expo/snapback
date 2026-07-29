const { createHash } = require("node:crypto");
const { initializeApp } = require("firebase-admin/app");
const { FieldValue, Timestamp, getFirestore } = require("firebase-admin/firestore");
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2/options");

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 2 });

const db = getFirestore();
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function requireActor(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in before using this research room.");
  }
  return request.auth.uid;
}

async function requireMember(roomId, uid) {
  const snapshot = await db.doc(`rooms/${roomId}`).get();
  if (!snapshot.exists || !snapshot.get("memberIds")?.includes(uid)) {
    throw new HttpsError("permission-denied", "Room membership is required.");
  }
  return snapshot;
}

function questionPaths(roomId, questionId) {
  return {
    question: db.doc(`rooms/${roomId}/questions/${questionId}`),
    answer: db.doc(`rooms/${roomId}/answers/answer-${questionId}`),
    attempt: db.doc(`rooms/${roomId}/effectAttempts/attempt-${questionId}`),
  };
}

exports.health = onRequest((_request, response) => {
  response.json({
    ok: true,
    projectId: process.env.GCLOUD_PROJECT,
    service: "research-room-functions",
  });
});

// @ref LLP 0102#app-5-collaborative-ai-research-room — Durable progress and
// terminal settlement are authoritative backend writes, not client animation.
exports.executeQuestion = onCall(async (request) => {
  const uid = requireActor(request);
  const {
    roomId,
    questionId,
    dedupeKey,
    prompt,
    fault = "complete",
    delayMs = 80,
  } = request.data ?? {};
  if (![roomId, questionId, dedupeKey, prompt].every((value) => typeof value === "string" && value)) {
    throw new HttpsError("invalid-argument", "roomId, questionId, dedupeKey, and prompt are required.");
  }
  if (!["complete", "failed", "timed-out", "ambiguous"].includes(fault)) {
    throw new HttpsError("invalid-argument", "Unsupported deterministic outcome.");
  }
  await requireMember(roomId, uid);

  const { question, answer, attempt } = questionPaths(roomId, questionId);
  const created = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(question);
    if (existing.exists) {
      if (existing.get("dedupeKey") !== dedupeKey || existing.get("askerId") !== uid) {
        throw new HttpsError("already-exists", "Question identity belongs to another request.");
      }
      return false;
    }
    transaction.create(question, {
      askerId: uid,
      prompt,
      dedupeKey,
      status: "running",
      progressCount: 0,
      terminal: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(attempt, {
      questionId,
      dedupeKey,
      attemptNumber: 1,
      dispatchState: "accepted",
      settlement: "running",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });

  if (!created) {
    const existing = await question.get();
    return {
      deduplicated: true,
      questionId,
      status: existing.get("status"),
      progressCount: existing.get("progressCount"),
    };
  }

  const progressMessages = [
    "Validated room membership and source authority",
    "Retrieved deterministic keyword context",
    "Synthesized an answer against cited sources",
    "Verified citations and terminal settlement",
  ];

  for (let index = 0; index < progressMessages.length; index += 1) {
    await sleep(Math.max(10, Math.min(Number(delayMs) || 80, 1000)));
    const progressed = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(question);
      if (!current.exists || current.get("status") === "cancelled") {
        return false;
      }
      const progress = question.collection("progress").doc(`step-${String(index + 1).padStart(2, "0")}`);
      transaction.create(progress, {
        ordinal: index + 1,
        message: progressMessages[index],
        durable: true,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.update(question, {
        progressCount: index + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!progressed) {
      await attempt.update({
        dispatchState: "cancelled-before-terminal",
        settlement: "cancelled",
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { deduplicated: false, questionId, status: "cancelled" };
    }
  }

  const terminal = {
    complete: {
      status: "complete",
      settlement: "confirmed-complete",
      answerText: "Coastal wetlands retain carbon while reducing flood exposure.",
    },
    failed: {
      status: "failed",
      settlement: "confirmed-failure",
    },
    "timed-out": {
      status: "timed-out",
      settlement: "confirmed-timeout",
    },
    ambiguous: {
      status: "ambiguous",
      settlement: "unknown-after-dispatch",
    },
  }[fault];

  const committed = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(question);
    if (!current.exists || current.get("status") === "cancelled") {
      return false;
    }
    if (fault === "complete") {
      transaction.create(answer, {
        questionId,
        roomId,
        status: "complete",
        text: terminal.answerText,
        citations: [
          { sourceId: "source-001", span: "coastal wetlands" },
          { sourceId: "source-005", span: "flood exposure" },
        ],
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.update(question, {
      status: terminal.status,
      terminal: true,
      answerId: fault === "complete" ? answer.id : null,
      updatedAt: FieldValue.serverTimestamp(),
      settledAt: FieldValue.serverTimestamp(),
    });
    transaction.update(attempt, {
      dispatchState: "terminal",
      settlement: terminal.settlement,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });

  if (!committed) {
    await attempt.update({
      dispatchState: "cancelled-before-terminal",
      settlement: "cancelled",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { deduplicated: false, questionId, status: "cancelled" };
  }
  return {
    deduplicated: false,
    questionId,
    status: terminal.status,
    progressCount: progressMessages.length,
  };
});

exports.cancelQuestion = onCall(async (request) => {
  const uid = requireActor(request);
  const { roomId, questionId } = request.data ?? {};
  await requireMember(roomId, uid);
  const { question, attempt } = questionPaths(roomId, questionId);
  const result = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(question);
    if (!current.exists) {
      throw new HttpsError("not-found", "Question not found.");
    }
    if (current.get("terminal")) {
      return { confirmed: false, status: current.get("status") };
    }
    transaction.update(question, {
      status: "cancelled",
      terminal: true,
      cancelConfirmedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(attempt, {
      dispatchState: "cancel-confirmed",
      settlement: "cancelled",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { confirmed: true, status: "cancelled" };
  });
  return result;
});

exports.injectLatePatch = onCall(async (request) => {
  const uid = requireActor(request);
  const { roomId, questionId } = request.data ?? {};
  await requireMember(roomId, uid);
  const { question } = questionPaths(roomId, questionId);
  const persisted = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(question);
    if (!current.exists) {
      throw new HttpsError("not-found", "Question not found.");
    }
    if (current.get("status") === "cancelled") {
      return false;
    }
    const late = question.collection("progress").doc("late-injected");
    transaction.create(late, {
      ordinal: 99,
      message: "late injected patch",
      durable: true,
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  return { blocked: !persisted, persisted };
});

async function performRefresh(roomId) {
  const runId = "refresh-deterministic-v1";
  const run = db.doc(`rooms/${roomId}/refreshRuns/${runId}`);
  const existing = await run.get();
  if (existing.exists) {
    return { runId, deduplicated: true, status: existing.get("status") };
  }
  const sourceUrl = process.env.EXTERNAL_SOURCE_URL;
  const serverSecret = process.env.RESEARCH_REFRESH_SECRET;
  if (!sourceUrl || !serverSecret) {
    throw new Error("Server-side refresh configuration is missing.");
  }
  const response = await fetch(sourceUrl, {
    headers: { authorization: `Bearer ${serverSecret}` },
  });
  if (!response.ok) {
    throw new Error(`External source returned ${response.status}.`);
  }
  const payload = await response.json();
  const secretHash = createHash("sha256").update(serverSecret).digest("hex");
  await run.create({
    status: "complete",
    sourceId: payload.sourceId,
    sourceVersion: payload.version,
    fetchedTitle: payload.title,
    progress: [
      "scheduled",
      "fetch-started",
      "response-validated",
      "committed",
    ],
    dedupeKey: runId,
    secretHash,
    createdAt: Timestamp.now(),
    completedAt: Timestamp.now(),
  });
  return { runId, deduplicated: false, status: "complete" };
}

// @ref LLP 0102#app-5-collaborative-ai-research-room — The scheduled refresh
// has one durable, deduplicated run and keeps its credential server-side.
exports.scheduledRefresh = onSchedule("every 24 hours", async () => {
  await performRefresh("room-primary");
});
