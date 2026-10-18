import { writeFileSync } from 'node:fs';
import { actor, intake, q, m, upload, ready, DAY, gap } from './probe-lib.mjs';

// Reproduce using only public operations and the supplied test sessions.
// An unclaimed vehicle already 31 days old must be committed to auction,
// rather than becoming releasable through a claim first filed after day 30.
const owner = actor('owner'), clerk = actor('clerk');
const vehicle = await intake({ towedAt: Date.now() - 31 * DAY }, clerk, owner);
const before = ready(await q('vehicleDetail', clerk, { vehicle: vehicle.id }));
const priorClaims = ready(await q('claimsFor', clerk, { vehicle: vehicle.id }));
if (priorClaims.length !== 0 || Date.now() - before.towedAt < 30 * DAY) {
  throw new Error('Fixture must be unclaimed and past the 30-day deadline');
}
const proof = await upload(owner);
const filed = await m('fileClaim', owner, { vehicle: vehicle.id, proof });
let decided = null, released = null;
if (filed.body?.state === 'sent') {
  decided = await m('decideClaim', clerk, { claim: filed.body.result.id, approve: true });
  if (decided.body?.state === 'sent') {
    released = await m('releaseVehicle', clerk, { vehicle: vehicle.id });
  }
}
const after = ready(await q('vehicleDetail', clerk, { vehicle: vehicle.id }));
const present = before.status === 'impounded'
  && filed.body?.state === 'sent'
  && filed.body.result.at > before.towedAt + 30 * DAY
  && decided?.body?.state === 'sent'
  && released?.body?.state === 'sent'
  && after.status === 'released';
writeFileSync(new URL('./f1-observed.json', import.meta.url), JSON.stringify({
  vehicle: vehicle.id, towedAt: before.towedAt, deadline: before.towedAt + 30 * DAY,
  priorClaims: priorClaims.length, filedAt: filed.body?.result?.at,
  filed: filed.body?.state, decided: decided?.body?.state,
  released: released?.body?.state, finalStatus: after.status, present,
}, null, 2) + '\n');
gap(present, 'An unclaimed 31-day-old vehicle accepts its first claim after day 30, clerk verification and release, bypassing the auction deadline before the daily sweep.');
