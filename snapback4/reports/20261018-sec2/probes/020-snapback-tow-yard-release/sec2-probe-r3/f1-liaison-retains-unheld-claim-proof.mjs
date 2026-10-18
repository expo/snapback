import { writeFileSync } from 'node:fs';
import { actor, intake, claim, q, m, request, sent, ready, gap } from './probe-lib.mjs';

// Only supplied identities and public operations. Restore the role even on failure.
const owner = actor('owner', 1), manager = actor('manager');
const original = ready(await q('myRole', owner));
if (original.role !== 'owner') throw new Error('Setup requires the supplied owner role');
const vehicle = await intake({}, actor('clerk'), owner);
const ownershipClaim = await claim(vehicle, owner);
let observed = { present: false };
try {
  sent(await m('grantRole', manager, { who: owner.principal, role: 'liaison' }));
  const role = ready(await q('myRole', owner));
  const detail = await q('vehicleDetail', owner, { vehicle: vehicle.id });
  const claims = await q('myClaims', owner);
  const leaked = claims.body?.data?.find(c => c.id === ownershipClaim.id);
  const proof = await request('/assets/' + ownershipClaim.proof.id, owner, undefined, { method: 'GET' });
  observed = {
    vehicle: vehicle.id, onHold: vehicle.onHold, role: role.role,
    detailDenied: detail.body?.denied ?? null, returnedClaim: leaked ?? null,
    proofDownloadStatus: proof.status,
    present: role.role === 'liaison' && vehicle.onHold === false
      && !!detail.body?.denied && leaked?.vehicle === vehicle.id
      && leaked?.proof?.id === ownershipClaim.proof.id && proof.status === 200,
  };
} finally {
  sent(await m('grantRole', manager, { who: owner.principal, role: original.role }));
}
writeFileSync(new URL('./f1-claim-proof-observed.json', import.meta.url), JSON.stringify(observed, null, 2) + '\n');
gap(observed.present, 'A user assigned the liaison role retains claim details and downloadable ownership proof for an unheld vehicle through myClaims, even though vehicleDetail refuses that vehicle.');
