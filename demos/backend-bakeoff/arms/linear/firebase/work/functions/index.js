const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { HttpsError, onCall } = require("firebase-functions/v2/https");

initializeApp();
const db = getFirestore();

async function requireMember(transaction, orgId, uid) {
  const membership = await transaction.get(
    db.doc(`organizations/${orgId}/members/${uid}`),
  );
  if (!membership.exists) {
    throw new HttpsError("permission-denied", "Organization membership is required.");
  }
}

exports.moveIssue = onCall({ region: "us-west1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication is required.");
  const issueId = String(request.data?.issueId ?? "");
  const expectedRevision = Number(request.data?.expectedRevision);
  const boardPosition = Number(request.data?.boardPosition);
  if (!issueId || !Number.isSafeInteger(expectedRevision) || !Number.isSafeInteger(boardPosition)) {
    throw new HttpsError("invalid-argument", "issueId, expectedRevision, and boardPosition are required.");
  }
  return db.runTransaction(async (transaction) => {
    const issueRef = db.doc(`issues/${issueId}`);
    const issue = await transaction.get(issueRef);
    if (!issue.exists) throw new HttpsError("not-found", "Issue not found.");
    const data = issue.data();
    await requireMember(transaction, data.orgId, request.auth.uid);
    if (data.revision !== expectedRevision) {
      throw new HttpsError("aborted", "revision-conflict", {
        expectedRevision,
        currentRevision: data.revision,
      });
    }
    const activityRef = db.collection("activities").doc();
    transaction.update(issueRef, {
      boardPosition,
      revision: expectedRevision + 1,
      updatedAt: FieldValue.serverTimestamp(),
      lastActorId: request.auth.uid,
    });
    transaction.create(activityRef, {
      orgId: data.orgId,
      issueId,
      actorId: request.auth.uid,
      kind: "issue_moved",
      boardPosition,
      revision: expectedRevision + 1,
      createdAt: FieldValue.serverTimestamp(),
    });
    return {
      issueId,
      boardPosition,
      revision: expectedRevision + 1,
      activityId: activityRef.id,
    };
  });
});

exports.addComment = onCall({ region: "us-west1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication is required.");
  const issueId = String(request.data?.issueId ?? "");
  const body = String(request.data?.body ?? "").trim();
  if (!issueId || !body || body.length > 4000) {
    throw new HttpsError("invalid-argument", "issueId and a comment up to 4000 characters are required.");
  }
  return db.runTransaction(async (transaction) => {
    const issue = await transaction.get(db.doc(`issues/${issueId}`));
    if (!issue.exists) throw new HttpsError("not-found", "Issue not found.");
    const issueData = issue.data();
    await requireMember(transaction, issueData.orgId, request.auth.uid);
    const commentRef = db.collection("comments").doc();
    const activityRef = db.collection("activities").doc();
    transaction.create(commentRef, {
      orgId: issueData.orgId,
      issueId,
      authorId: request.auth.uid,
      body,
      sequence: Date.now(),
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(activityRef, {
      orgId: issueData.orgId,
      issueId,
      actorId: request.auth.uid,
      kind: "comment_added",
      commentId: commentRef.id,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { commentId: commentRef.id, activityId: activityRef.id };
  });
});
