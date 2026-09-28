// Independent model: authored writes/acquisitions, never copied query results.
export function random(seed) { let s = seed; return n => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) % n; }; }
export const compare = (a, b) => a.at - b.at || Buffer.compare(Buffer.from(a.id), Buffer.from(b.id));
export class SearchModel {
    rows = new Map();
    images = new Map();
    members = new Set(['live', 'left']);
    held = new Set();
    pending = new Set();
    constructor(rows) {
        for (const row of rows) this.rows.set(row.id, {...row});
    }
    write(row) {
        this.rows.set(row.id, {...row});
        // A deletion while an acquired membership is live survives a later
        // departure in that sync. Unacquired replacement bodies do not replace
        // the delivered image of a scope that has already departed.
        if (this.members.has(row.room) && this.held.has(row.room)
            && row.expires != null && row.expires <= Date.now()) this.pending.add(row.id);
    }
    sync() {
        for (const id of this.pending) this.images.delete(id);
        this.pending.clear();
        for (const room of this.members) {
            for (const [id, row] of this.images) if (row.room === room) this.images.delete(id);
            for (const [id, row] of this.rows) if (row.room === room) this.images.set(id, {...row});
        }
        this.held = new Set(this.members);
    }
    reset() {
        this.images.clear(); this.held.clear(); this.pending.clear();
    }
    readable(online, now = Date.now()) {
        const rows = online ? new Map([...this.rows].filter(([, row]) => this.members.has(row.room))) : new Map();
        for (const [id, row] of this.images) {
            if ((!online || !this.held.has(row.room)) && !rows.has(id)) rows.set(id, row);
        }
        return [...rows.values()].filter(row => !row.tombstone && (row.expires == null || row.expires > now) && row.text.startsWith('cof'));
    }
}
// Independent consumed position and traversal stability; source cursors and
// returned row IDs never determine the expected page.
export class KeysetModel {
    constructor(rows, direction) { this.direction = direction; this.restart(rows); }
    restart(rows) {
        this.position = null;
        this.stable = new Map(rows.map(row => [row.id, { at: row.at, room: row.room }]));
        this.counts = new Map();
    }
    observe(rows) {
        const visible = new Map(rows.map(row => [row.id, row]));
        for (const [id, original] of this.stable) {
            const row = visible.get(id);
            if (!row || row.at !== original.at || row.room !== original.room) this.stable.delete(id);
        }
    }
    remaining(rows) {
        const sign = this.direction === 'first' ? 1 : -1;
        return rows.filter(row => !this.position || sign * compare(row, this.position) > 0)
            .sort((a, b) => sign * compare(a, b));
    }
    consume(expected) {
        if (expected.length) this.position = { at: expected.at(-1).at, id: expected.at(-1).id };
        for (const row of expected) this.counts.set(row.id, (this.counts.get(row.id) ?? 0) + 1);
    }
}
export function schema({ direction, limit, mutable }) {
    return `use personas alice, bob
table members:
  room: id
  principal: principal
  unique room, principal
  read <- exists members[.room, viewer]
  insert <- exists members[.room, viewer]
  delete <- true
  sync to members[.room]
table messages:
  room: id
${mutable ? '' : '  immutable room'}
  text: text <=200
  at: time
  tombstone: bool
  expires: time ?
  expire at .expires
  search text
  read <- exists members[.room, viewer]
  insert <- true
  update <- true
  sync to members[.room]
  retain delivered-history
query search(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone ${direction} ${limit} by .at after c
mutation leave(room: id):
  delete members[room, viewer]
mutation join(room: id):
  insert members { room, principal: 'dev:bob' }
mutation edit(id: messages, text: text <=200, at: time, expires: time ?):
  update messages[id] { text, at, expires }
${mutable ? 'mutation relocate(id: messages, room: id, text: text <=200, at: time):\n  update messages[id] { room, text, at }' : ''}
`;
}
