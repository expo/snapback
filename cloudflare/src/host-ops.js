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
//
// Overlay semantics are kept point-for-point with src/runtime.rs
// (apply_buffered_to_point / materialize_insert / merge_buffered_into_query):
// a patch on a missing row stays a miss, buffered reads re-fetch the full
// stored row before overlaying, and the overlay stamps the invocation's
// frozen clock into _createdAt/_updatedAt (ENG-23582).

function snapbackFail(code, message) {
  return { ok: false, code, message };
}

const TABLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Manifest-derived physical-table gate (ENG-23578): handler-provided table
// names never reach SQL identifier position unless they are declared in the
// app schema AND are plain identifiers. Local Rust storage validates plans
// against the schema; this is the same boundary for the Cloudflare leg.
export function physicalTableName(table, allowedTables) {
  const name = String(table || '');
  if (!allowedTables.has(name) || !TABLE_IDENTIFIER.test(name)) {
    return null;
  }
  return `app_${name}`;
}

// A single handler invocation's mutable context against the coordinator's
// SQLite. `sql` is `ctx.storage.sql` (synchronous). `mode` is
// query|mutation. `nowMs` is frozen for the invocation (LLP 0007 replay).
// `tables` is the schema-declared table-name set (ENG-23578).
export class HostContext {
  constructor({ sql, mode, nowMs, epoch, newId, tables }) {
    this.sql = sql;
    this.mode = mode;
    this.nowMs = nowMs;
    this.epoch = epoch;
    this.newId = newId;
    this.tables = tables || new Set();
    this.writes = []; // buffered BufferedWrite {kind, table, id, values}
    this.reads = []; // captured read dependencies (for the live matcher)
    this.observedVersion = null;
  }

  ensureWritable(op) {
    if (this.mode !== 'mutation') {
      return snapbackFail('SNAPBACK_HANDLER_WRITE_IN_QUERY', `query handler attempted ctx.db.${op}`);
    }
    return null;
  }

  physicalTable(table) {
    return physicalTableName(table, this.tables);
  }

  unknownTable(op, table) {
    return snapbackFail(
      'SNAPBACK_HANDLER_HOST_CALL_INVALID',
      `ctx.db.${op} referenced table "${table}", which is not declared in the app schema`
    );
  }

  // Storage read of a table with the supported filters/order/limit pushed into
  // SQLite. `physical` has already passed the schema-table gate; filter and
  // order FIELD names are handler-provided too, so fieldExpr identifier-gates
  // them (throwing into db.query's stable host-call diagnostic) and every
  // VALUE rides a bind parameter (ENG-23578). The buffered overlay still
  // reuses applyPlan, but ordinary reads avoid full-table JS scans. On the
  // proof's typed, non-null schema subset the SQLite comparisons agree with
  // applyPlan/matchFilter; ties break on the id column, matching applyPlan's
  // _id tie-break.
  storageQuery(physical, plan) {
    const where = [];
    const params = [];
    // json_extract yields 1/0 for JSON booleans, and the SQLite binding layer
    // takes no boolean/undefined params — coerce at the boundary.
    const sqlParam = (value) => {
      if (typeof value === 'boolean') return value ? 1 : 0;
      return value === undefined ? null : value;
    };
    for (const filter of plan.filters || []) {
      const target = literalValue(filter.value);
      switch (filter.op) {
        case 'Eq':
          where.push(`${fieldExpr(filter.field)} = ?`);
          params.push(sqlParam(target));
          break;
        case 'In':
          if (!Array.isArray(target) || target.length === 0) {
            where.push('0');
          } else {
            where.push(`${fieldExpr(filter.field)} IN (${target.map(() => '?').join(', ')})`);
            params.push(...target.map(sqlParam));
          }
          break;
        case 'Lt':
          where.push(`${fieldExpr(filter.field)} < ?`);
          params.push(sqlParam(target));
          break;
        case 'Lte':
          where.push(`${fieldExpr(filter.field)} <= ?`);
          params.push(sqlParam(target));
          break;
        case 'Gt':
          where.push(`${fieldExpr(filter.field)} > ?`);
          params.push(sqlParam(target));
          break;
        case 'Gte':
          where.push(`${fieldExpr(filter.field)} >= ?`);
          params.push(sqlParam(target));
          break;
        default:
          // Fail loud like every neighboring boundary: an unrecognized op is
          // a bad plan, not an empty result.
          throw new Error(`unsupported query filter op ${filter.op}`);
      }
    }
    let sql = `SELECT row_json FROM ${physical}`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    const order = (plan.order || [])
      .map((entry) => `${fieldExpr(entry.field)} ${entry.direction === 'Desc' ? 'DESC' : 'ASC'}`)
      .join(', ');
    if (order) sql += ` ORDER BY ${order}, id ASC`;
    if (plan.limit != null) {
      sql += ' LIMIT ?';
      params.push(Number(plan.limit));
    }
    const rows = [];
    const cursor = this.sql.exec(sql, ...params);
    for (const record of cursor) {
      rows.push(JSON.parse(record.row_json));
    }
    return rows;
  }

  storageGet(physical, id) {
    const cursor = this.sql.exec(`SELECT row_json FROM ${physical} WHERE id = ?`, id);
    for (const record of cursor) {
      return JSON.parse(record.row_json);
    }
    return null;
  }

  bufferedForTable(table) {
    return this.writes.filter((write) => write.table === table);
  }

  // Mirrors materialize_insert (src/runtime.rs): a buffered insert's
  // effective view carries the frozen handler clock; the authoritative
  // version/timestamps are assigned at commit.
  materializeInsert(id, values) {
    return { _id: id, _createdAt: this.nowMs, _updatedAt: this.nowMs, ...values };
  }

  // Mirrors apply_buffered_to_point (src/runtime.rs): a patch against a row
  // that does not exist yet is a no-op at commit, so the effective view stays
  // a miss (ENG-23582 divergence 1); an applied patch bumps _updatedAt
  // (divergence 3).
  applyBufferedToPoint(table, id, stored) {
    let current = stored;
    for (const write of this.writes) {
      if (write.table !== table || write.id !== id) continue;
      if (write.kind === 'insert') {
        current = this.materializeInsert(id, write.values);
      } else if (write.kind === 'patch') {
        if (current) {
          current = { ...current, ...write.values, _updatedAt: this.nowMs };
        }
      } else if (write.kind === 'delete') {
        current = null;
      }
    }
    return current;
  }

  // Mirrors merge_buffered_into_query (src/runtime.rs): drop touched rows
  // from the (already filtered, unlimited) base set, recompute each touched
  // row's effective view from its FULL stored row, keep it only if it still
  // matches the plan's filters, then re-sort and re-apply the limit
  // (ENG-23582 divergence 2: overlaying onto filtered skeletons lost stored
  // columns).
  mergeBufferedIntoQuery(physical, plan, baseRows) {
    const touched = new Set(this.bufferedForTable(plan.table).map((write) => write.id));
    const merged = baseRows.filter((row) => !touched.has(row._id));
    for (const id of touched) {
      const stored = this.storageGet(physical, id);
      const row = this.applyBufferedToPoint(plan.table, id, stored);
      if (row && (plan.filters || []).every((filter) => matchFilter(row, filter))) {
        merged.push(row);
      }
    }
    return applyPlan(merged, { ...plan, filters: [] });
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
        const physical = this.physicalTable(plan.table);
        if (!physical) return this.unknownTable('query', plan.table);
        this.reads.push({ kind: 'query', table: plan.table, plan });
        const hasBuffered = this.bufferedForTable(plan.table).length > 0;
        let stored;
        try {
          stored = this.storageQuery(physical, hasBuffered ? { ...plan, limit: null } : plan);
        } catch (error) {
          return snapbackFail(
            'SNAPBACK_HANDLER_HOST_CALL_INVALID',
            `ctx.db.query received an unsupported query plan: ${error.message}`
          );
        }
        const version = this.currentVersion();
        this.observedVersion = Math.max(this.observedVersion || 0, version);
        const rows = hasBuffered
          ? this.mergeBufferedIntoQuery(physical, plan, stored)
          : stored;
        return { ok: true, value: { version, rows } };
      }
      case 'db.get': {
        const physical = this.physicalTable(args.table);
        if (!physical) return this.unknownTable('get', args.table);
        const stored = this.storageGet(physical, args.id);
        this.reads.push({ kind: 'point', table: args.table, id: args.id });
        const version = this.currentVersion();
        this.observedVersion = Math.max(this.observedVersion || 0, version);
        return { ok: true, value: this.applyBufferedToPoint(args.table, args.id, stored) };
      }
      case 'db.insert': {
        const denied = this.ensureWritable('insert');
        if (denied) return denied;
        if (!this.physicalTable(args.table)) return this.unknownTable('insert', args.table);
        const id = this.newId();
        this.writes.push({ kind: 'insert', table: args.table, id, values: args.values || {} });
        return { ok: true, value: id };
      }
      case 'db.patch': {
        const denied = this.ensureWritable('patch');
        if (denied) return denied;
        const physical = this.physicalTable(args.table);
        if (!physical) return this.unknownTable('patch', args.table);
        const stored = this.storageGet(physical, args.id);
        // Point reads on patch/delete are captured exactly as on the Rust
        // path (capture_point_read, ENG-23582 divergence 4).
        this.reads.push({ kind: 'point', table: args.table, id: args.id });
        const existed = this.applyBufferedToPoint(args.table, args.id, stored) != null;
        this.writes.push({ kind: 'patch', table: args.table, id: args.id, values: args.values || {} });
        return { ok: true, value: existed };
      }
      case 'db.delete': {
        const denied = this.ensureWritable('delete');
        if (denied) return denied;
        const physical = this.physicalTable(args.table);
        if (!physical) return this.unknownTable('delete', args.table);
        const stored = this.storageGet(physical, args.id);
        this.reads.push({ kind: 'point', table: args.table, id: args.id });
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
// indexed field, ordered by one field, optional take. Equal sort keys
// tie-break by _id, matching the Rust merge path's deterministic ordering.
export function applyPlan(rows, plan) {
  let result = rows.filter((row) => (plan.filters || []).every((filter) => matchFilter(row, filter)));
  if ((plan.order || []).length) {
    result.sort((a, b) => compareValues(a._id, b._id));
    for (const order of plan.order.slice().reverse()) {
      const dir = order.direction === 'Desc' ? -1 : 1;
      result.sort((a, b) => compareValues(a[order.field], b[order.field]) * dir);
    }
  }
  if (plan.limit != null) result = result.slice(0, plan.limit);
  return result;
}

function matchFilter(row, filter) {
  const value = row[filter.field];
  const target = literalValue(filter.value);
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

function fieldExpr(field) {
  const name = String(field || '');
  if (!TABLE_IDENTIFIER.test(name)) {
    throw new Error(`invalid query field ${name}`);
  }
  return name === '_id' ? 'id' : `json_extract(row_json, '$.${name}')`;
}

function literalValue(value) {
  return value && value.Literal !== undefined ? value.Literal : value;
}

function compareValues(a, b) {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a < b ? -1 : 1;
}
