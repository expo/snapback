// The JS host-op table for the Cloudflare target — the engine-neutral
// contract's Durable-Object-SQLite implementation (LLP 0040 §Version
// contract). It mirrors the Rust `IbexHostContext::handle_host_call` op table
// (db.query/get/insert/patch/delete, runtime.now/id/log) so a handler run on
// this target observes the same semantics as on the local target: buffered
// writes, read-your-writes overlay, ids and clock from the host, and version
// assigned atomically at commit.
//
// One invocation constructs one HostContext. A mutation's buffered writes are
// held here and committed as one local SQLite transaction by the coordinator
// (version allocation + row writes + journal append together), so LLP 0007's
// gap-free visibility holds by construction — exactly as on the local target.

function snapbackFail(code, message) {
  return { ok: false, code, message };
}

function systemFields(nowMs) {
  return { _createdAt: nowMs, _updatedAt: nowMs };
}

// A single handler invocation's mutable context against the coordinator's
// SQLite. `sql` is `ctx.storage.sql` (synchronous). `mode` is
// query|mutation. `nowMs` is frozen for the invocation (LLP 0007 replay).
export class HostContext {
  constructor({ sql, mode, nowMs, epoch, newId }) {
    this.sql = sql;
    this.mode = mode;
    this.nowMs = nowMs;
    this.epoch = epoch;
    this.newId = newId;
    this.writes = []; // buffered BufferedWrite {kind, table, id, values}
    this.reads = []; // captured read dependencies (for the live matcher)
  }

  ensureWritable(op) {
    if (this.mode !== 'mutation') {
      return snapbackFail('SNAPBACK_HANDLER_WRITE_IN_QUERY', `query handler attempted ctx.db.${op}`);
    }
    return null;
  }

  // Storage read of a table with the plan's filters applied in JS (the proof's
  // single-table query subset). Returns rows sorted per the plan's order.
  storageQuery(plan) {
    const rows = [];
    const cursor = this.sql.exec(`SELECT row_json FROM app_${plan.table}`);
    for (const record of cursor) {
      rows.push(JSON.parse(record.row_json));
    }
    return applyPlan(rows, plan);
  }

  storageGet(table, id) {
    const cursor = this.sql.exec(`SELECT row_json FROM app_${table} WHERE id = ?`, id);
    for (const record of cursor) {
      return JSON.parse(record.row_json);
    }
    return null;
  }

  bufferedForTable(table) {
    return this.writes.filter((write) => write.table === table);
  }

  applyBufferedToPoint(table, id, stored) {
    let current = stored;
    for (const write of this.writes) {
      if (write.table !== table || write.id !== id) continue;
      if (write.kind === 'insert' || write.kind === 'patch') {
        current = { ...(current || {}), ...write.values, _id: id };
      } else if (write.kind === 'delete') {
        current = null;
      }
    }
    return current;
  }

  mergeBufferedIntoQuery(plan, baseRows) {
    const byId = new Map();
    for (const row of baseRows) byId.set(row._id, row);
    for (const write of this.bufferedForTable(plan.table)) {
      if (write.kind === 'delete') {
        byId.delete(write.id);
      } else {
        const existing = byId.get(write.id) || { _id: write.id, ...systemFields(this.nowMs) };
        byId.set(write.id, { ...existing, ...write.values, _id: write.id });
      }
    }
    return applyPlan([...byId.values()], plan);
  }

  // The op dispatch — the JS analogue of dispatch_host_call. Returns
  // { ok:true, value } or { ok:false, code, message }.
  handle(op, args) {
    switch (op) {
      case 'db.query': {
        const plan = args.plan;
        if (!plan || !plan.table) {
          return snapbackFail('SNAPBACK_HANDLER_HOST_CALL_INVALID', 'ctx.db.query received an invalid query plan');
        }
        const stored = this.storageQuery(plan);
        this.reads.push({ kind: 'query', table: plan.table, plan });
        const rows = this.bufferedForTable(plan.table).length
          ? this.mergeBufferedIntoQuery(plan, this.storageQuery({ ...plan, limit: null }))
          : stored;
        return { ok: true, value: { version: this.currentVersion(), rows } };
      }
      case 'db.get': {
        const stored = this.storageGet(args.table, args.id);
        this.reads.push({ kind: 'point', table: args.table, id: args.id });
        return { ok: true, value: this.applyBufferedToPoint(args.table, args.id, stored) };
      }
      case 'db.insert': {
        const denied = this.ensureWritable('insert');
        if (denied) return denied;
        const id = this.newId();
        this.writes.push({ kind: 'insert', table: args.table, id, values: args.values || {} });
        return { ok: true, value: id };
      }
      case 'db.patch': {
        const denied = this.ensureWritable('patch');
        if (denied) return denied;
        const stored = this.storageGet(args.table, args.id);
        const existed = this.applyBufferedToPoint(args.table, args.id, stored) != null;
        this.writes.push({ kind: 'patch', table: args.table, id: args.id, values: args.values || {} });
        return { ok: true, value: existed };
      }
      case 'db.delete': {
        const denied = this.ensureWritable('delete');
        if (denied) return denied;
        const stored = this.storageGet(args.table, args.id);
        const existed = this.applyBufferedToPoint(args.table, args.id, stored) != null;
        this.writes.push({ kind: 'delete', table: args.table, id: args.id });
        return { ok: true, value: existed };
      }
      case 'runtime.now':
        return { ok: true, value: this.nowMs };
      case 'runtime.id':
        return { ok: true, value: this.newId() };
      case 'runtime.log':
        // Diagnostics-routed console; never data, never committed.
        return { ok: true, value: null };
      default:
        return snapbackFail('SNAPBACK_HANDLER_HOST_CALL_UNKNOWN', `unknown handler host call ${op}`);
    }
  }

  currentVersion() {
    const cursor = this.sql.exec('SELECT version FROM _snapback_version WHERE id = 1');
    for (const record of cursor) return Number(record.version);
    return 0;
  }
}

// Apply a plan's filters, order, and limit to an in-memory row set. The
// proof's supported query subset: single-table eq/in/range predicates over one
// indexed field, ordered by one field, optional take.
export function applyPlan(rows, plan) {
  let result = rows.filter((row) => (plan.filters || []).every((filter) => matchFilter(row, filter)));
  for (const order of (plan.order || []).slice().reverse()) {
    const dir = order.direction === 'Desc' ? -1 : 1;
    result.sort((a, b) => compareValues(a[order.field], b[order.field]) * dir);
  }
  if (plan.limit != null) result = result.slice(0, plan.limit);
  return result;
}

function matchFilter(row, filter) {
  const value = row[filter.field];
  const target = filter.value && filter.value.Literal !== undefined ? filter.value.Literal : filter.value;
  switch (filter.op) {
    case 'Eq': return value === target;
    case 'In': return Array.isArray(target) && target.includes(value);
    case 'Lt': return compareValues(value, target) < 0;
    case 'Lte': return compareValues(value, target) <= 0;
    case 'Gt': return compareValues(value, target) > 0;
    case 'Gte': return compareValues(value, target) >= 0;
    default: return false;
  }
}

function compareValues(a, b) {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a < b ? -1 : 1;
}
