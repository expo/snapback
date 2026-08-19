// The JS host-op table for the Cloudflare target — the engine-neutral
// contract's Durable-Object-SQLite implementation (LLP 0040 §Version
// contract). It mirrors the Rust `IbexHostContext::handle_host_call` op table
// (db.query/get/insert/patch/delete, runtime.now/id/log,
// mutation.settlement) so a handler run on this target observes the same
// semantics as on the local target: buffered writes, read-your-writes overlay,
// ids and clock from the host, and version assigned atomically at commit.
//
// One invocation constructs one HostContext. A mutation's buffered writes are
// held here and committed as one local SQLite transaction by the coordinator
// (version allocation + row writes + journal append together), so LLP 0007's
// gap-free visibility holds by construction — exactly as on the local target.
//
// Overlay semantics are kept point-for-point with crates/snapback/src/runtime.rs
// (apply_buffered_to_point / materialize_insert / merge_buffered_into_query):
// a patch on a missing row stays a miss, buffered reads re-fetch the full
// stored row before overlaying, and the overlay stamps the invocation's
// frozen clock into _createdAt/_updatedAt (ENG-23582).

function snapbackFail(code, message) {
  return { ok: false, code, message };
}

const TABLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SYSTEM_FIELDS = new Set(['_id', '_version', '_createdAt', '_updatedAt']);
export const QUERY_MAX_LIMIT = 1024;
export const QUERY_DEFAULT_LIMIT = QUERY_MAX_LIMIT;
export const QUERY_MAX_IN_ITEMS = 500;
export const QUERY_MAX_FILTER_BINDINGS = 500;
export const QUERY_MAX_BUFFERED_WRITES = 1024;
export const QUERY_INTERNAL_OVERFETCH_MAX = QUERY_MAX_LIMIT + QUERY_MAX_BUFFERED_WRITES;

const effectiveQueryLimit = (plan) => plan.limit == null ? QUERY_DEFAULT_LIMIT : plan.limit;

function fieldType(field) {
  return String(field.type || field.field_type || '').toLowerCase();
}

function tableManifest(schemaTables, table) {
  return schemaTables instanceof Map ? schemaTables.get(String(table || '')) || null : null;
}

function queryError(code, message) {
  const error = new Error(message);
  error.snapbackCode = code;
  return error;
}

function validatePortableQueryShape(plan) {
  if (plan.limit != null && (!Number.isSafeInteger(plan.limit) || plan.limit < 0 || plan.limit > QUERY_MAX_LIMIT)) {
    throw queryError(
      'SNAPBACK_QUERY_LIMIT_INVALID',
      `query limit must be a non-negative safe integer no greater than ${QUERY_MAX_LIMIT}`
    );
  }
  let inItems = 0;
  let filterBindings = 0;
  for (const filter of plan.filters || []) {
    let addedBindings = 1;
    if (filter.op === 'In') {
      const target = literalValue(filter.value);
      if (!Array.isArray(target)) {
        throw queryError('SNAPBACK_QUERY_FILTER_VALUE_INVALID', `query In filter on ${filter.field} expects an array`);
      }
      inItems += target.length;
      if (inItems > QUERY_MAX_IN_ITEMS) {
        throw queryError(
          'SNAPBACK_QUERY_IN_ITEMS_EXCEEDED',
          `query In operands contain ${inItems} total items; maxInItems is ${QUERY_MAX_IN_ITEMS}`
        );
      }
      addedBindings = target.length;
    }
    filterBindings += addedBindings;
    if (filterBindings > QUERY_MAX_FILTER_BINDINGS) {
      throw queryError(
        'SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED',
        `query filters bind ${filterBindings} values after ${filter.field}; maxFilterBindings is ${QUERY_MAX_FILTER_BINDINGS}`
      );
    }
  }
}

function validateQueryFilterTypes(table, plan) {
  const fields = new Map((table.fields || []).map((field) => [field.name, field]));
  for (const filter of plan.filters || []) {
    const declared = fields.get(filter.field) || null;
    const system = SYSTEM_FIELDS.has(filter.field);
    if (!declared && !system) {
      throw queryError('SNAPBACK_UNKNOWN_FIELD', `unknown field ${table.name}.${filter.field}`);
    }
    const target = literalValue(filter.value);
    const values = filter.op === 'In' ? target : [target];
    if (declared && fieldType(declared) === 'json') {
      throw queryError(
        'SNAPBACK_QUERY_FILTER_UNSUPPORTED_FIELD_TYPE',
        `query filter ${table.name}.${filter.field} has non-portable Json type`
      );
    }
    for (const value of values) {
      let valid;
      if (value === null) valid = Boolean(declared?.optional);
      else if (system) {
        valid = filter.field === '_id'
          ? typeof value === 'string'
          : Number.isSafeInteger(value) && value >= 0;
      } else {
        const type = fieldType(declared);
        valid = type === 'string' ? typeof value === 'string'
          : type === 'boolean' ? typeof value === 'boolean'
          : type === 'integer' ? Number.isSafeInteger(value)
          : (type === 'real' || type === 'number' || type === 'float')
            ? typeof value === 'number' && Number.isFinite(value)
            : false;
      }
      if (!valid) {
        throw queryError(
          'SNAPBACK_QUERY_FILTER_VALUE_INVALID',
          `query filter ${table.name}.${filter.field} has a value incompatible with its declared type`
        );
      }
    }
  }
}

function writeFailure(code, message, details = null) {
  return { ok: false, code, message, ...(details ? { details } : {}) };
}

function validateFieldValue(table, field, value) {
  if (value === null) {
    if (field.optional) return null;
    return writeFailure(
      'SNAPBACK_FIELD_TYPE_MISMATCH',
      `expected ${fieldType(field) || 'declared'} value for ${table.name}.${field.name}`,
      { table: table.name, field: field.name, expected: fieldType(field) || null }
    );
  }
  const type = fieldType(field);
  let valid = false;
  if (type === 'string') valid = typeof value === 'string';
  else if (type === 'boolean') valid = typeof value === 'boolean';
  else if (type === 'integer') valid = Number.isSafeInteger(value);
  else if (type === 'real' || type === 'number' || type === 'float') {
    valid = typeof value === 'number' && Number.isFinite(value);
  } else if (type === 'json') {
    try {
      valid = JSON.stringify(value) !== undefined;
    } catch (_) {
      valid = false;
    }
  }
  return valid
    ? null
    : writeFailure(
        'SNAPBACK_FIELD_TYPE_MISMATCH',
        `expected ${type || 'declared'} value for ${table.name}.${field.name}`,
        { table: table.name, field: field.name, expected: type || null }
      );
}

// Manifest-enforced portable write boundary (LLP 0007). Insert validation
// materializes absent optional fields as null, matching the local SQLite
// document shape; patches validate only the fields they carry.
export function validateWriteValues(schemaTables, tableName, values, { insert = false } = {}) {
  const table = tableManifest(schemaTables, tableName);
  if (!table) {
    return writeFailure('SNAPBACK_UNKNOWN_TABLE', `unknown table ${tableName}`);
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return writeFailure('SNAPBACK_HANDLER_HOST_CALL_INVALID', `ctx.db write values for ${tableName} must be an object`);
  }
  const fields = new Map((table.fields || []).map((field) => [field.name, field]));
  const orderedKeys = Object.keys(values).sort();
  // Match the local BTreeMap boundary: inserts reject protected/unknown keys
  // before checking required/value constraints, while patches validate each
  // sorted key completely before moving to the next key.
  for (const key of orderedKeys) {
    if (SYSTEM_FIELDS.has(key)) {
      return writeFailure('SNAPBACK_SYSTEM_FIELD_WRITE', `${key} is managed by Snapback`, { table: table.name, field: key });
    }
    const field = fields.get(key);
    if (!field) {
      return writeFailure('SNAPBACK_UNKNOWN_FIELD', `unknown field ${table.name}.${key}`, { table: table.name, field: key });
    }
    if (!insert) {
      const invalid = validateFieldValue(table, field, values[key]);
      if (invalid) return invalid;
    }
  }
  const normalized = Object.create(null);
  const defineNormalized = (key, value) => Object.defineProperty(normalized, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  if (insert) {
    for (const field of table.fields || []) {
      if (Object.prototype.hasOwnProperty.call(values, field.name)) {
        const invalid = validateFieldValue(table, field, values[field.name]);
        if (invalid) return invalid;
        defineNormalized(field.name, values[field.name]);
      } else if (field.optional) {
        defineNormalized(field.name, null);
      } else {
        return writeFailure(
          'SNAPBACK_FIELD_MISSING',
          `required field ${table.name}.${field.name} is missing`,
          { table: table.name, field: field.name }
        );
      }
    }
  } else {
    for (const key of orderedKeys) defineNormalized(key, values[key]);
  }
  return { ok: true, values: normalized };
}

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
  constructor({ sql, mode, nowMs, epoch, newId, tables, schemaTables = null, runMutation = null, hostFetch = null, hostStreams = null, control = null }) {
    this.sql = sql;
    this.mode = mode;
    this.nowMs = nowMs;
    this.epoch = epoch;
    this.newId = newId;
    this.tables = tables || new Set();
    this.schemaTables = schemaTables || new Map();
    this.control = control;
    this.writes = []; // buffered BufferedWrite {kind, table, id, values}
    this.reads = []; // captured read dependencies (for the live matcher)
    this.observedVersion = null;
    // Action-only host capabilities (LLP 0049 Phase 2): the coordinator
    // injects these for mode 'action' — runMutation reacquires the
    // invocation mutex per commit; hostFetch is the coordinator's
    // secret-resolving egress boundary. Queries and mutations get neither.
    this.runMutationHook = runMutation;
    this.hostFetchHook = hostFetch;
    this.hostStreams = hostStreams;
    this.lastStreamProgressCommitAt = 0;
    // An out-of-band trusted denial produced by a host op inside an ACTION
    // (a nested mutation refusing across action.runMutation), recorded so
    // the typed code can survive the action boundary without letting a
    // handler-forged {code: ...} become typed — the JS analogue of
    // denial_witness on IbexHostContext (crates/snapback/src/runtime.rs, 0137 a4-f5).
    this.denialWitness = null;
  }

  abandon(code = 'SNAPBACK_ACTION_TIMEOUT', message = 'the invocation was abandoned') {
    if (this.control) {
      this.control.abandoned = true;
      this.control.code = code;
      this.control.message = message;
    }
  }

  abandonedFailure() {
    if (!this.control || !this.control.abandoned) return null;
    return snapbackFail(
      this.control.code || 'SNAPBACK_HANDLER_STALE_CONTINUATION',
      this.control.message || 'the invocation is no longer active'
    );
  }

  // @ref LLP 0076#author-decisions--2026-07-23 — decision 4: the host rate
  // fence emits the profile-neutral SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED.
  reserveStreamProgressCommit() {
    if (!this.hostStreams?.hasOpen()) return null;
    const now = Date.now();
    if (now - this.lastStreamProgressCommitAt < 100) {
      return snapbackFail(
        'SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED',
        'stream progress exceeds ten authoritative commits per second'
      );
    }
    this.lastStreamProgressCommitAt = now;
    return null;
  }

  async closeResponseStreams() {
    if (this.hostStreams) await this.hostStreams.closeAll();
  }

  ensureWritable(op) {
    if (this.mode !== 'mutation') {
      return snapbackFail('SNAPBACK_HANDLER_WRITE_IN_QUERY', `query handler attempted ctx.db.${op}`);
    }
    return null;
  }

  ensureBufferedWriteCapacity() {
    if (this.writes.length >= QUERY_MAX_BUFFERED_WRITES) {
      return snapbackFail(
        'SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED',
        `one mutation may buffer at most ${QUERY_MAX_BUFFERED_WRITES} writes`,
      );
    }
    return null;
  }

  // Actions reach durable state only through ctx.runMutation (LLP 0028
  // §Execution) — never through direct db host calls. The ctx bootstrap
  // denies these client-side; this is the host-side half of the gate.
  ensureNotAction(op) {
    if (this.mode === 'action') {
      return snapbackFail(
        'SNAPBACK_HANDLER_HOST_CALL_INVALID',
        `action handler attempted ctx.db.${op}; actions read/write durable state only through ctx.runMutation`
      );
    }
    return null;
  }

  physicalTable(table) {
    return physicalTableName(table, this.tables);
  }

  unknownTable(op, table) {
    return snapbackFail(
      'SNAPBACK_UNKNOWN_TABLE',
      `ctx.db.${op} referenced table "${table}", which is not declared in the app schema`
    );
  }

  // Storage read of a table with the supported filters/order/limit pushed into
  // SQLite. `physical` has already passed the schema-table gate; filter and
  // order FIELD names are handler-provided too, so fieldExpr identifier-gates
  // them (throwing into db.query's stable host-call diagnostic) and every
  // VALUE rides a bind parameter (ENG-23578). The buffered overlay still
  // reuses applyPlan, but ordinary reads avoid full-table JS scans. The
  // SQLite comparisons agree with applyPlan/matchFilter, including SQL
  // three-valued logic on null/missing fields (ENG-23606: matchFilter
  // mirrors the NULL-never-matches WHERE semantics, same as
  // filter_matches_row in crates/snapback/src/live_matcher.rs); ties break on the id
  // column, matching applyPlan's _id tie-break.
  storageQuery(physical, plan, storageLimit = effectiveQueryLimit(plan)) {
    const table = tableManifest(this.schemaTables, plan.table);
    if (!table) throw new Error(`unknown table ${plan.table}`);
    validatePortableQueryShape(plan);
    if (!Number.isSafeInteger(storageLimit) || storageLimit < 0 || storageLimit > QUERY_INTERNAL_OVERFETCH_MAX) {
      throw queryError(
        'SNAPBACK_QUERY_LIMIT_INVALID',
        `internal query overfetch must not exceed ${QUERY_INTERNAL_OVERFETCH_MAX}`
      );
    }
    validateQueryFilterTypes(table, plan);
    const declaredFields = new Map((table.fields || []).map((field) => [field.name, field]));
    const ensureQueryField = (field) => {
      const name = String(field || '');
      if (!SYSTEM_FIELDS.has(name) && !declaredFields.has(name)) {
        const error = new Error(`unknown field ${table.name}.${name}`);
        error.snapbackCode = 'SNAPBACK_UNKNOWN_FIELD';
        throw error;
      }
      return name;
    };
    const ensureOrderableQueryField = (field) => {
      const name = ensureQueryField(field);
      if (declaredFields.get(name)?.field_type === 'Json') {
        const error = new Error(`query order field ${table.name}.${name} has non-portable Json type`);
        error.snapbackCode = 'SNAPBACK_QUERY_ORDER_UNSUPPORTED_FIELD_TYPE';
        throw error;
      }
      return name;
    };
    let requestedIndex = null;
    if (plan.indexed_by != null) {
      const name = String(plan.indexed_by);
      requestedIndex = (table.indexes || []).find((index) => index.name === name) || null;
      if (!requestedIndex) {
        const error = new Error(`query declares index "${name}" which table "${table.name}" does not define`);
        error.snapbackCode = 'SNAPBACK_QUERY_UNKNOWN_INDEX';
        throw error;
      }
    }
    const where = [];
    const params = [];
    // json_extract yields 1/0 for JSON booleans, and the SQLite binding layer
    // takes no boolean/undefined params — coerce at the boundary.
    const sqlParam = (value) => {
      if (typeof value === 'boolean') return value ? 1 : 0;
      return value === undefined ? null : value;
    };
    for (const filter of plan.filters || []) {
      ensureQueryField(filter.field);
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
    if (requestedIndex) sql += ` INDEXED BY ${physicalIndexName(table.name, requestedIndex.name)}`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    const order = (plan.order || [])
      .map((entry) => `${fieldExpr(ensureOrderableQueryField(entry.field))} ${entry.direction === 'Desc' ? 'DESC' : 'ASC'} NULLS LAST`)
      .join(', ');
    if (order) sql += ` ORDER BY ${order}, id ASC`;
    sql += ' LIMIT ?';
    params.push(Number(storageLimit));
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

  // Mirrors materialize_insert (crates/snapback/src/runtime.rs): a buffered insert's
  // effective view carries the frozen handler clock; the authoritative
  // version/timestamps are assigned at commit.
  materializeInsert(id, values) {
    return { _id: id, _createdAt: this.nowMs, _updatedAt: this.nowMs, ...values };
  }

  // Mirrors apply_buffered_to_point (crates/snapback/src/runtime.rs): a patch against a row
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

  // Mirrors merge_buffered_into_query (crates/snapback/src/runtime.rs): drop touched rows
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
  // { ok:true, value } or { ok:false, code, message }; the action-only ops
  // return promises (the coordinator's serveHostCall awaits). As in
  // dispatch_host_call, every op result crosses the witness-recording seam
  // before it reaches the handler.
  handle(op, args) {
    return this.recordActionDenialWitness(this.dispatchOp(op, args));
  }

  // 0137 a4-f5 mirror of dispatch_host_call's recording arm: a trusted
  // platform denial produced by a host op during an action is recorded
  // out-of-band, so restoreDenialWitness (envelope.mjs) can surface the
  // recorded uniform bytes past the handler-envelope fold. Mode-gated to
  // actions exactly as on the Rust side; sync op results stay synchronous.
  recordActionDenialWitness(result) {
    if (this.mode !== 'action') return result;
    const record = (settled) => {
      if (settled && settled.ok === false && settled.code === 'SNAPBACK_AUTH_PERMISSION_DENIED') {
        this.denialWitness = settled;
      }
      return settled;
    };
    return result && typeof result.then === 'function' ? result.then(record) : record(result);
  }

  // Take semantics mirror take on the Rust side: one restoration per
  // recorded witness.
  takeDenialWitness() {
    const witness = this.denialWitness;
    this.denialWitness = null;
    return witness;
  }

  dispatchOp(op, args) {
    const abandoned = this.abandonedFailure();
    if (abandoned) return abandoned;
    switch (op) {
      case 'action.runMutation': {
        if (this.mode !== 'action' || typeof this.runMutationHook !== 'function') {
          return snapbackFail(
            'SNAPBACK_ACTION_CONTEXT_UNAVAILABLE',
            'ctx.runMutation is available to actions only'
          );
        }
        const streamRateFailure = this.reserveStreamProgressCommit();
        if (streamRateFailure) return streamRateFailure;
        return this.runMutationHook(String(args.name || ''), args.args || {});
      }
      case 'action.streamOpen': {
        if (this.mode !== 'action' || !this.hostStreams) {
          return snapbackFail(
            'SNAPBACK_ACTION_CONTEXT_UNAVAILABLE',
            'ctx.fetchStream is available to actions only'
          );
        }
        return this.hostStreams.open(args || {});
      }
      case 'action.streamRead': {
        if (this.mode !== 'action' || !this.hostStreams) {
          return snapbackFail(
            'SNAPBACK_ACTION_CONTEXT_UNAVAILABLE',
            'ctx.fetchStream reader is available to actions only'
          );
        }
        return this.hostStreams.read(String(args.streamId || ''));
      }
      case 'action.streamCancel': {
        if (this.mode !== 'action' || !this.hostStreams) {
          return snapbackFail(
            'SNAPBACK_ACTION_CONTEXT_UNAVAILABLE',
            'ctx.fetchStream reader is available to actions only'
          );
        }
        return this.hostStreams.cancel(String(args.streamId || ''));
      }
      case 'host.fetch': {
        if (this.mode !== 'action' || typeof this.hostFetchHook !== 'function') {
          return snapbackFail(
            'SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED',
            'host fetch is an action-only capability'
          );
        }
        return this.hostFetchHook(args || {});
      }
      case 'db.query': {
        const actionDenied = this.ensureNotAction('query');
        if (actionDenied) return actionDenied;
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
          const table = tableManifest(this.schemaTables, plan.table);
          validatePortableQueryShape(plan);
          validateQueryFilterTypes(table, plan);
          const storageLimit = hasBuffered
            ? Math.min(
              effectiveQueryLimit(plan) + this.bufferedForTable(plan.table).length,
              QUERY_INTERNAL_OVERFETCH_MAX,
            )
            : effectiveQueryLimit(plan);
          stored = this.storageQuery(physical, plan, storageLimit);
        } catch (error) {
          const code = error && error.snapbackCode;
          if (typeof code === 'string') {
            return snapbackFail(code, error.message);
          }
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
        const actionDenied = this.ensureNotAction('get');
        if (actionDenied) return actionDenied;
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
        const full = this.ensureBufferedWriteCapacity();
        if (full) return full;
        if (!this.physicalTable(args.table)) return this.unknownTable('insert', args.table);
        const insertValues = Object.prototype.hasOwnProperty.call(args, 'values') ? args.values : {};
        const validated = validateWriteValues(this.schemaTables, args.table, insertValues, { insert: true });
        if (!validated.ok) return validated;
        const id = this.newId();
        this.writes.push({ kind: 'insert', table: args.table, id, values: validated.values });
        return { ok: true, value: id };
      }
      case 'db.patch': {
        const denied = this.ensureWritable('patch');
        if (denied) return denied;
        const full = this.ensureBufferedWriteCapacity();
        if (full) return full;
        const physical = this.physicalTable(args.table);
        if (!physical) return this.unknownTable('patch', args.table);
        const patchValues = Object.prototype.hasOwnProperty.call(args, 'values') ? args.values : {};
        const validated = validateWriteValues(this.schemaTables, args.table, patchValues, { insert: false });
        if (!validated.ok) return validated;
        const stored = this.storageGet(physical, args.id);
        // Point reads on patch/delete are captured exactly as on the Rust
        // path (capture_point_read, ENG-23582 divergence 4).
        this.reads.push({ kind: 'point', table: args.table, id: args.id });
        const existed = this.applyBufferedToPoint(args.table, args.id, stored) != null;
        this.writes.push({ kind: 'patch', table: args.table, id: args.id, values: validated.values });
        return { ok: true, value: existed };
      }
      case 'db.delete': {
        const denied = this.ensureWritable('delete');
        if (denied) return denied;
        const full = this.ensureBufferedWriteCapacity();
        if (full) return full;
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
      // @ref LLP 0043#handler-visible-settlement-identity-2026-08-08 — the hosted proof
      // has no client-mutation replay ledger, so mutation mode exposes the
      // honest all-null twin while preserving the mutation-only contract.
      case 'mutation.settlement':
        if (this.mode === 'query') {
          return snapbackFail(
            'SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE',
            'queries are never queued or settled; only mutations carry a settlement identity'
          );
        }
        if (this.mode === 'action') {
          return snapbackFail(
            'SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE',
            'actions carry no settlement identity; call ctx.runMutation and read ctx.mutation.settlement() inside that mutation'
          );
        }
        return { ok: true, value: { clientMutationId: null, settlementId: null } };
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
  validatePortableQueryShape(plan);
  let result = rows.filter((row) => (plan.filters || []).every((filter) => matchFilter(row, filter)));
  if ((plan.order || []).length) {
    result.sort((a, b) => compareValues(a._id, b._id));
    for (const order of plan.order.slice().reverse()) {
      const dir = order.direction === 'Desc' ? -1 : 1;
      result.sort((a, b) => compareOrderValues(a[order.field], b[order.field], dir));
    }
  }
  result = result.slice(0, effectiveQueryLimit(plan));
  return result;
}

function matchFilter(row, filter) {
  const value = row[filter.field];
  const target = literalValue(filter.value);
  // SQL three-valued logic, matching filter_matches_row (crates/snapback/src/live_matcher.rs)
  // and the storageQuery pushdown: a null/missing column value satisfies no
  // operator, and a null literal on the right matches nothing either —
  // `IS NULL` is not an expressible predicate in this query subset
  // (ENG-23606: the overlay previously matched `Eq null` and ranked null
  // below everything for ranges, so results flipped with buffered writes).
  if (value === null || value === undefined) return false;
  if ((target === null || target === undefined) && filter.op !== 'In') return false;
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

export function physicalIndexName(table, index) {
  const tableName = String(table || '');
  const indexName = String(index || '');
  if (!TABLE_IDENTIFIER.test(tableName) || !TABLE_IDENTIFIER.test(indexName)) {
    throw new Error(`invalid index identity ${tableName}.${indexName}`);
  }
  return `idx_app_${tableName}_${indexName}`;
}

function literalValue(value) {
  return value && value.Literal !== undefined ? value.Literal : value;
}

function compareValues(a, b) {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'string' && typeof b === 'string') return compareUnicodeScalars(a, b);
  return a < b ? -1 : 1;
}

function compareUnicodeScalars(left, right) {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex);
    const rightPoint = right.codePointAt(rightIndex);
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    leftIndex += leftPoint > 0xFFFF ? 2 : 1;
    rightIndex += rightPoint > 0xFFFF ? 2 : 1;
  }
  if (leftIndex === left.length && rightIndex === right.length) return 0;
  return leftIndex === left.length ? -1 : 1;
}

// NULL is last in both directions (LLP 0007). Direction applies only to
// present values; multiplying a NULL-aware comparator by -1 would make DESC
// NULL-first and diverge from the portable contract.
function compareOrderValues(a, b, direction) {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return compareValues(a, b) * direction;
}
