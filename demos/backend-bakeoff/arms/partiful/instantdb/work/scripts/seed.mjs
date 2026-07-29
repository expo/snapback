import { chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  actorEmail,
  dbForTarget,
  ids,
  namespace,
  queryCounts,
  receiptsDir,
  runtimeDir,
  sha256,
  writeJson,
} from './lib.mjs';

const db = dbForTarget();
const actors = {};
for (const [name, displayName] of [
  ['alice', 'Alice Host'],
  ['bob', 'Bob Guest'],
  ['mallory', 'Mallory Outsider'],
]) {
  const email = actorEmail(name);
  const token = await db.auth.createToken({ email });
  const user = await db.auth.verifyToken(token);
  actors[name] = { id: user.id, email, token, displayName };
}

const actorPath = resolve(runtimeDir, 'actors.json');
writeJson(actorPath, actors);
chmodSync(actorPath, 0o600);

const now = Date.now();
const eventIds = Array.from({ length: 20 }, (_, index) => ids.event(index));
const transactions = [];
for (const actor of Object.values(actors)) {
  transactions.push(
    db.tx.profiles[actor.id]
      .update({ email: actor.email, displayName: actor.displayName })
      .link({ user: actor.id }),
  );
}

for (let index = 0; index < eventIds.length; index += 1) {
  const eventId = eventIds[index];
  const event = db.tx.events[eventId]
    .update({
      slug: `${namespace}-event-${String(index + 1).padStart(2, '0')}`,
      title: index === 0 ? 'Rooftop Summer Supper' : `Gathering ${String(index + 1).padStart(2, '0')}`,
      startsAt: now + (index + 1) * 86_400_000,
      capacity: index === 0 ? 50 : 24,
      guestListVisible: index === 0,
      public: index !== 19,
      hostId: actors.alice.id,
      cohostId: index === 1 ? actors.bob.id : undefined,
      privateHostNote: `Host-only operations note ${index + 1}`,
    })
    .link({ host: actors.alice.id });
  transactions.push(index === 1 ? event.link({ cohost: actors.bob.id }) : event);
}

const contendedEventId = eventIds[0];
const invitationIds = [];
const seatClaimIds = [];
for (let index = 0; index < 49; index += 1) {
  const invitationId = ids.opaque();
  const claimId = ids.opaque();
  invitationIds.push(invitationId);
  seatClaimIds.push(claimId);
  const inviteeId = index === 0 ? actors.bob.id : `fixture-guest-${String(index).padStart(2, '0')}`;
  let invitation = db.tx.invitations[invitationId]
    .update({
      key: `${namespace}:invite:${index}`,
      eventId: contendedEventId,
      inviteeId,
      role: 'guest',
      response: 'yes',
      plusOne: 0,
      guestListVisible: true,
      updatedAt: now,
    })
    .link({ event: contendedEventId });
  if (index === 0) invitation = invitation.link({ invitee: actors.bob.id });
  transactions.push(invitation);
  transactions.push(
    db.tx.seatClaims[claimId]
      .update({
        seatKey: `${namespace}:event-0:seat-${index}`,
        eventId: contendedEventId,
        claimantId: inviteeId,
        occupied: true,
        claimedAt: now,
      })
      .link({ event: contendedEventId, ...(index === 0 ? { claimant: actors.bob.id } : {}) }),
  );
}

const finalSeatId = ids.opaque();
transactions.push(
  db.tx.seatClaims[finalSeatId]
    .update({
      seatKey: `${namespace}:event-0:seat-49`,
      eventId: contendedEventId,
      claimantId: 'unclaimed',
      occupied: false,
      claimedAt: now,
    })
    .link({ event: contendedEventId }),
);

await db.transact(transactions);
const counts = await queryCounts(db);
const occupancy = await db.query({
  seatClaims: { $: { where: { eventId: contendedEventId } } },
});
const occupiedCount = occupancy.seatClaims.filter((claim) => claim.occupied).length;
if (counts.events !== 20 || counts.invitations !== 49 || counts.seatClaims !== 50 || occupiedCount !== 49 || counts.$users !== 3) {
  throw new Error(`seed mismatch: ${JSON.stringify(counts)}`);
}

writeJson(resolve(runtimeDir, 'fixture.json'), {
  eventIds,
  contendedEventId,
  invitationIds,
  bobInvitationId: invitationIds[0],
  seatClaimIds,
  finalSeatId,
  finalSeatKey: `${namespace}:event-0:seat-49`,
});
writeJson(resolve(receiptsDir, 'seed-receipt.json'), {
  capturedAt: new Date().toISOString(),
  authoritativeCounts: counts,
  authoritativeOccupiedSeatCount: occupiedCount,
  fixture: {
    events: 20,
    guestsOnContendedEvent: 49,
    contendedCapacity: 50,
    simultaneousRsvpAttempts: 2,
    wallBurstPosts: 20,
    assetBytes: 262144,
    actors: 3,
    concurrentClients: 2,
  },
  contendedEventIdSha256: sha256(contendedEventId),
  actorPrincipals: Object.fromEntries(
    Object.entries(actors).map(([name, actor]) => [
      name,
      {
        idSha256: sha256(actor.id),
        emailSha256: sha256(actor.email),
        tokenSha256: sha256(actor.token),
      },
    ]),
  ),
  targetIdentityPath: 'receipts/target-provision-redacted.json',
  containsCredentialValues: false,
});
process.stdout.write(`${JSON.stringify({ ok: true, counts })}\n`);
