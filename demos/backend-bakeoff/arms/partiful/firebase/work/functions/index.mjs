import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const region = "us-west1";
const PRIMARY_EVENT = "event-01";
const CONTENDED_EVENT = "event-capacity";

function requireUid(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "PARTY_AUTH_REQUIRED");
  return uid;
}

async function eventAndRole(eventId, uid) {
  const eventRef = db.doc(`events/${eventId}`);
  const invitationRef = db.doc(`events/${eventId}/invitations/${uid}`);
  const [eventSnapshot, invitationSnapshot] = await Promise.all([
    eventRef.get(),
    invitationRef.get(),
  ]);
  if (!eventSnapshot.exists) {
    throw new HttpsError("not-found", "PARTY_EVENT_NOT_FOUND");
  }
  const event = eventSnapshot.data();
  let role = null;
  if (event.hostUid === uid) role = "host";
  else if ((event.cohostUids ?? []).includes(uid)) role = "cohost";
  else if (invitationSnapshot.exists && invitationSnapshot.data().status === "active") {
    role = invitationSnapshot.data().role ?? "guest";
  }
  return { eventRef, event, invitationRef, role };
}

function requireRole(actual, allowed) {
  if (!actual || !allowed.includes(actual)) {
    throw new HttpsError("permission-denied", "PARTY_NOT_AUTHORIZED");
  }
}

export const upsertEvent = onCall({ region }, async (request) => {
  const uid = requireUid(request);
  const eventId = String(request.data?.eventId ?? "");
  if (!eventId.startsWith("event-")) {
    throw new HttpsError("invalid-argument", "PARTY_BAD_EVENT_ID");
  }
  const eventRef = db.doc(`events/${eventId}`);
  const publicRef = db.doc(`publicEvents/${eventId}`);
  const controlsRef = db.doc(`eventControls/${eventId}`);
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(eventRef);
    if (current.exists && current.data().hostUid !== uid) {
      throw new HttpsError("permission-denied", "PARTY_HOST_ONLY");
    }
    const createdAt = current.exists ? current.data().createdAt : FieldValue.serverTimestamp();
    const revision = current.exists ? Number(current.data().revision ?? 0) + 1 : 1;
    transaction.set(eventRef, {
      hostUid: uid,
      cohostUids: current.exists ? current.data().cohostUids ?? [] : [],
      guestListVisibility: current.exists
        ? current.data().guestListVisibility ?? "guests"
        : "guests",
      capacity: Number(request.data?.capacity ?? 50),
      attendanceCount: current.exists ? current.data().attendanceCount ?? 0 : 0,
      title: String(request.data?.title ?? "Untitled event"),
      location: String(request.data?.location ?? "TBD"),
      startsAt: Timestamp.fromMillis(Number(request.data?.startsAtMs ?? Date.now() + 86400000)),
      revision,
      createdAt,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(publicRef, {
      title: String(request.data?.title ?? "Untitled event"),
      location: String(request.data?.location ?? "TBD"),
      startsAt: Timestamp.fromMillis(Number(request.data?.startsAtMs ?? Date.now() + 86400000)),
      published: true,
      artPath: current.exists ? current.data().artPath ?? null : null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(controlsRef, {
      eventId,
      hostUid: uid,
      cohostUids: current.exists ? current.data().cohostUids ?? [] : [],
      doorCode: String(request.data?.doorCode ?? "HOST-ONLY"),
      internalNote: String(request.data?.internalNote ?? "Private host controls"),
      revision,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  return { eventId, settled: true };
});

export const setGuestListVisibility = onCall({ region }, async (request) => {
  const uid = requireUid(request);
  const eventId = String(request.data?.eventId ?? "");
  const visibility = String(request.data?.visibility ?? "");
  if (!["guests", "hosts"].includes(visibility)) {
    throw new HttpsError("invalid-argument", "PARTY_BAD_VISIBILITY");
  }
  const { eventRef, role } = await eventAndRole(eventId, uid);
  requireRole(role, ["host", "cohost"]);
  await eventRef.update({
    guestListVisibility: visibility,
    updatedAt: FieldValue.serverTimestamp(),
    revision: FieldValue.increment(1),
  });
  return { eventId, visibility };
});

export const setCohost = onCall({ region }, async (request) => {
  const uid = requireUid(request);
  const eventId = String(request.data?.eventId ?? "");
  const targetUid = String(request.data?.targetUid ?? "");
  const enabled = Boolean(request.data?.enabled);
  const { eventRef, event, role } = await eventAndRole(eventId, uid);
  requireRole(role, ["host"]);
  const cohostUids = new Set(event.cohostUids ?? []);
  if (enabled) cohostUids.add(targetUid);
  else cohostUids.delete(targetUid);
  await Promise.all([
    eventRef.update({
      cohostUids: [...cohostUids].sort(),
      revision: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }),
    db.doc(`eventControls/${eventId}`).update({
      cohostUids: [...cohostUids].sort(),
      revision: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }),
  ]);
  return { eventId, targetUid, enabled };
});

export const rsvp = onCall({ region }, async (request) => {
  const uid = requireUid(request);
  const eventId = String(request.data?.eventId ?? "");
  const response = String(request.data?.response ?? "");
  const plusOneCount = Number(request.data?.plusOneCount ?? 0);
  if (!["yes", "no", "maybe"].includes(response)) {
    throw new HttpsError("invalid-argument", "PARTY_BAD_RSVP");
  }
  if (!Number.isInteger(plusOneCount) || plusOneCount < 0 || plusOneCount > 3) {
    throw new HttpsError("invalid-argument", "PARTY_BAD_PLUS_ONE");
  }
  const eventRef = db.doc(`events/${eventId}`);
  const invitationRef = db.doc(`events/${eventId}/invitations/${uid}`);
  const rsvpRef = db.doc(`events/${eventId}/rsvps/${uid}`);
  return db.runTransaction(async (transaction) => {
    const [eventSnapshot, invitationSnapshot, rsvpSnapshot] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(invitationRef),
      transaction.get(rsvpRef),
    ]);
    if (!eventSnapshot.exists || !invitationSnapshot.exists) {
      throw new HttpsError("permission-denied", "PARTY_INVITATION_REQUIRED");
    }
    const invitation = invitationSnapshot.data();
    if (invitation.status !== "active") {
      throw new HttpsError("permission-denied", "PARTY_INVITATION_REVOKED");
    }
    const event = eventSnapshot.data();
    const previousSeats = rsvpSnapshot.exists ? Number(rsvpSnapshot.data().seats ?? 0) : 0;
    const nextSeats = response === "yes" ? 1 + plusOneCount : 0;
    const nextAttendance = Number(event.attendanceCount ?? 0) - previousSeats + nextSeats;
    if (nextAttendance > Number(event.capacity)) {
      throw new HttpsError("resource-exhausted", "PARTY_CAPACITY_REACHED");
    }
    transaction.set(rsvpRef, {
      eventId,
      uid,
      displayName: invitation.displayName,
      response,
      plusOneCount,
      seats: nextSeats,
      revision: rsvpSnapshot.exists ? Number(rsvpSnapshot.data().revision ?? 0) + 1 : 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(eventRef, {
      attendanceCount: nextAttendance,
      revision: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {
      eventId,
      response,
      plusOneCount,
      attendanceCount: nextAttendance,
    };
  });
});

export const revokeInvitation = onCall({ region }, async (request) => {
  const uid = requireUid(request);
  const eventId = String(request.data?.eventId ?? "");
  const targetUid = String(request.data?.targetUid ?? "");
  const { role } = await eventAndRole(eventId, uid);
  requireRole(role, ["host", "cohost"]);
  await db.runTransaction(async (transaction) => {
    const invitationRef = db.doc(`events/${eventId}/invitations/${targetUid}`);
    const controlsRef = db.doc(`eventControls/${eventId}`);
    const invitation = await transaction.get(invitationRef);
    if (!invitation.exists) throw new HttpsError("not-found", "PARTY_INVITATION_NOT_FOUND");
    transaction.update(invitationRef, {
      status: "revoked",
      revokedAt: FieldValue.serverTimestamp(),
      revokedBy: uid,
    });
    transaction.update(controlsRef, {
      internalNote: `revocation-${targetUid}`,
      revision: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { eventId, targetUid, status: "revoked" };
});

async function deliverNotification({ eventId, effectKey, mode, reason }) {
  const effectRef = db.doc(`notificationEffects/${effectKey}`);
  const reservation = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(effectRef);
    const previous = snapshot.exists ? snapshot.data() : null;
    if (previous?.status === "known_success") {
      return {
        terminal: true,
        attemptCount: previous.attemptCount,
        providerInvocationCount: previous.providerInvocationCount,
      };
    }
    const attemptCount = Number(previous?.attemptCount ?? 0) + 1;
    transaction.set(effectRef, {
      eventId,
      effectKey,
      idempotencyKey: effectKey,
      mode,
      reason,
      status: "attempting",
      attemptCount,
      providerInvocationCount: Number(previous?.providerInvocationCount ?? 0) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(db.doc(`notificationAttempts/${effectKey}-${attemptCount}`), {
      eventId,
      effectKey,
      attemptNumber: attemptCount,
      mode,
      status: "attempting",
      createdAt: FieldValue.serverTimestamp(),
    });
    return { terminal: false, attemptCount };
  });
  if (reservation.terminal) {
    return { effectKey, deduped: true, ...reservation };
  }

  const endpoint = process.env.PARTY_NOTIFICATION_ENDPOINT;
  if (!endpoint) throw new HttpsError("failed-precondition", "PARTY_EFFECT_CONFIG_MISSING");
  try {
    const response = await fetch(`${endpoint}/deliver`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: effectKey, eventId, mode, reason }),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error(`provider status ${response.status}`);
    const provider = await response.json();
    await Promise.all([
      effectRef.update({
        status: "known_success",
        providerReceiptId: provider.receiptId,
        providerDeduped: Boolean(provider.deduped),
        settledAt: FieldValue.serverTimestamp(),
      }),
      db.doc(`notificationAttempts/${effectKey}-${reservation.attemptCount}`).update({
        status: "known_success",
        providerReceiptId: provider.receiptId,
        settledAt: FieldValue.serverTimestamp(),
      }),
    ]);
    return {
      effectKey,
      deduped: Boolean(provider.deduped),
      attemptCount: reservation.attemptCount,
      providerReceiptId: provider.receiptId,
    };
  } catch (error) {
    await Promise.all([
      effectRef.update({
        status: "ambiguous",
        ambiguity: "provider may have accepted before transport failure",
        errorClass: error?.name ?? "Error",
        settledAt: FieldValue.serverTimestamp(),
      }),
      db.doc(`notificationAttempts/${effectKey}-${reservation.attemptCount}`).update({
        status: "ambiguous",
        ambiguity: "provider may have accepted before transport failure",
        settledAt: FieldValue.serverTimestamp(),
      }),
    ]);
    throw new HttpsError("unavailable", "PARTY_EFFECT_AMBIGUOUS");
  }
}

export const sendNotification = onCall({ region }, async (request) => {
  const uid = requireUid(request);
  const eventId = String(request.data?.eventId ?? "");
  const effectKey = String(request.data?.effectKey ?? "");
  const mode = String(request.data?.mode ?? "known-success");
  const { role } = await eventAndRole(eventId, uid);
  requireRole(role, ["host", "cohost"]);
  if (!effectKey.startsWith(`${eventId}:`)) {
    throw new HttpsError("invalid-argument", "PARTY_BAD_EFFECT_KEY");
  }
  if (!["known-success", "ambiguous-first"].includes(mode)) {
    throw new HttpsError("invalid-argument", "PARTY_BAD_EFFECT_MODE");
  }
  return deliverNotification({
    eventId,
    effectKey,
    mode,
    reason: String(request.data?.reason ?? "event update"),
  });
});

async function runReminder(eventId, dateKey) {
  const scheduleId = `event-reminder-${eventId}`;
  const runId = `${scheduleId}-${dateKey}`;
  const runRef = db.doc(`reminderRuns/${runId}`);
  const created = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(runRef);
    if (existing.exists) return false;
    transaction.create(runRef, {
      eventId,
      scheduleId,
      runId,
      dedupeKey: runId,
      status: "running",
      startedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (!created) return { runId, deduped: true };
  const effect = await deliverNotification({
    eventId,
    effectKey: `reminder:${runId}`,
    mode: "known-success",
    reason: "scheduled reminder",
  });
  await runRef.update({
    status: "complete",
    effectKey: effect.effectKey,
    completedAt: FieldValue.serverTimestamp(),
  });
  return { runId, deduped: false, effectKey: effect.effectKey };
}

export const runReminderNow = onCall({ region }, async (request) => {
  const uid = requireUid(request);
  const eventId = String(request.data?.eventId ?? PRIMARY_EVENT);
  const { role } = await eventAndRole(eventId, uid);
  requireRole(role, ["host"]);
  return runReminder(eventId, String(request.data?.dateKey ?? "2026-07-29"));
});

export const scheduledReminder = onSchedule(
  {
    region,
    schedule: "0 9 * * *",
    timeZone: "America/Los_Angeles",
    retryCount: 3,
  },
  async () => runReminder(PRIMARY_EVENT, new Date().toISOString().slice(0, 10)),
);
