// Exit 0 only if a manager receives metadata for a future, uncompleted round.
import {account,m,q,sent,data,assert,tag,H} from './probe-lib.mjs';
const now=Date.now(), chief=account('chief'), manager=account('manager');
const shift=sent(await m('createShift',{label:`F1 future ${tag}`,startsAt:now+H,endsAt:now+3*H},chief));
const round=sent(await m('scheduleRound',{shiftId:shift.id,scheduledAt:now+2*H},chief));
assert.equal(round.status,'scheduled');
const report=await q('compliance',{from:round.scheduledAt-1,to:round.scheduledAt+1},manager);
const leaked=data(report).find(r=>r.id===round.id && r.status==='scheduled');
assert.ok(leaked,'No gap: the manager did not receive the uncompleted round.');
assert.equal(leaked.shift.id,shift.id);
console.log('GAP PRESENT: manager sees an uncompleted future round:',JSON.stringify(leaked));
