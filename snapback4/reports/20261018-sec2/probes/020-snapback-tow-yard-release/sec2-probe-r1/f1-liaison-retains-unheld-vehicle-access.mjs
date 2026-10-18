import { actor, intake, q, m, sent, ready, gap } from './probe-lib.mjs';

// A legitimate manager assigns a former owner the single liaison role.
// The liaison must see only vehicles under an investigative hold.
const owner = actor('owner', 1), manager = actor('manager');
const original = ready(await q('myRole', owner));
if (original.role !== 'owner') throw new Error('Fixture account must initially be an owner');
const vehicle = await intake({}, actor('clerk'), owner);
let present = false;
try {
  sent(await m('grantRole', manager, { who: owner.principal, role: 'liaison' }));
  const role = ready(await q('myRole', owner));
  const detail = await q('vehicleDetail', owner, { vehicle: vehicle.id });
  const list = await q('myVehicles', owner);
  present = role.role === 'liaison'
    && detail.body?.data?.id === vehicle.id
    && detail.body.data.onHold === false
    && list.body?.data?.some(row => row.id === vehicle.id && row.onHold === false);
} finally {
  sent(await m('grantRole', manager, { who: owner.principal, role: original.role }));
}
gap(present, 'A confirmed liaison role can read and list an unheld vehicle through retained ownership, including VIN, tow location, fees and photos.');
