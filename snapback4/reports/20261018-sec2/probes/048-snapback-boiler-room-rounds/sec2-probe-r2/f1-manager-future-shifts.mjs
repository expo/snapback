// Exit 0 if a manager can enumerate shift metadata unrelated to completed rounds.
import {account, m, q, sent, data, assert, tag, H} from './probe-lib.mjs';

const now = Date.now();
const chief = account('chief');
const shift = sent(await m('createShift', {
  label: `F1 private future ${tag}`,
  startsAt: now + 24 * H,
  endsAt: now + 32 * H,
}, chief));
assert.deepEqual(data(await q('shiftRounds', {shift: shift.id}, chief)), []);

let exposed = false;
for (const manager of [account('manager'), account('manager', 1)]) {
  let c;
  for (let page = 0; page < 4; page++) {
    const response = await q('shiftsList', c ? {c} : {}, manager);
    if (!Array.isArray(response.body.data)) break;
    const leaked = response.body.data.find(row => row.id === shift.id);
    if (leaked) {
      assert.equal(leaked.label, shift.label);
      assert.equal(leaked.startsAt, shift.startsAt);
      assert.equal(leaked.endsAt, shift.endsAt);
      console.log('GAP PRESENT: manager received an empty future shift outside any completed-round report:', JSON.stringify(leaked));
      exposed = true;
      break;
    }
    c = response.body.next;
    if (!c) break;
  }
}
assert.ok(exposed, 'No gap: neither manager received the future shift metadata.');
