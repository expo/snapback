const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

initializeApp();
const db = getFirestore();

exports.sendMessage = onCall({ region: "us-west1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }
  const channelId = String(request.data?.channelId ?? "");
  const body = String(request.data?.body ?? "").trim();
  if (!channelId || !body || body.length > 2000) {
    throw new HttpsError("invalid-argument", "channelId and a body up to 2000 characters are required.");
  }

  const channelRef = db.doc(`channels/${channelId}`);
  return db.runTransaction(async (tx) => {
    const channel = await tx.get(channelRef);
    if (!channel.exists) {
      throw new HttpsError("not-found", "Channel not found.");
    }
    const data = channel.data();
    const isMember = Array.isArray(data.memberIds) && data.memberIds.includes(request.auth.uid);
    if (!isMember) {
      throw new HttpsError("permission-denied", "Channel membership is required to send.");
    }

    const sequence = Number(data.nextSequence ?? 0) + 1;
    const messageRef = channelRef.collection("messages").doc();
    tx.update(channelRef, { nextSequence: sequence });
    tx.create(messageRef, {
      authorId: request.auth.uid,
      body,
      sequence,
      createdAt: FieldValue.serverTimestamp()
    });
    return { id: messageRef.id, authorId: request.auth.uid, sequence };
  });
});
