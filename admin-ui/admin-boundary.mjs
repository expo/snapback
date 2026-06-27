// Snapback admin ↔ Contract bridge.
//
// Hydrates a reactive boundary from the privileged admin API (`/_snapback/api/*`)
// and exposes the link functions the .contract's `use … from` targets delegate
// to. All formatting lives here, in plain JS: the admin inspect/scan/run payloads
// are flattened into a declarative `data.ui.*` view model so the Contract
// template only reads flat, statically-named fields (the renderer forbids dynamic
// `row[col]` access). Boundary/link lifecycle comes from the shared system helper.
//
// @ref LLP 0017#console-surfaces — the console composes the headless admin
//   contract into views; the contract, not the template, is the source of truth.

import { createSnapbackSystemContractSurface } from '../packages/snapback-contract/index.mjs';

export async function createAdminSurface({ runtime, client }) {
  return createSnapbackSystemContractSurface({
    runtime,
    targetSurface: 'Snapback admin Contract',
    resources: {
      inspect: async () => loadView(client),
      tableScan: emptyScan,
      runResult: emptyRun,
    },
    commands: {
      refresh: async (_args, { publishOne }) => {
        publishOne('inspect', await loadView(client));
      },
      // The data explorer's parameterized read: fetch a page, pre-shape rows into
      // {key,text,sys} cells so the .contract uses static access, then republish.
      loadTable: async ({ table, offset }, { publishOne }) => {
        try {
          const scan = await client.scanTable(table, PAGE, offset || 0);
          publishOne('tableScan', shapeScan(scan));
        } catch (error) {
          publishOne('tableScan', { ...emptyScan(), loaded: true, table, error: error.message });
        }
      },
      // The function runner: parse the args text, invoke through the admin API's
      // normal runner path, and republish a shaped result. Errors become state.
      runFunction: async ({ name, argsText, userId }, { publishOne }) => {
        if (!name) return;
        let args;
        try {
          args = argsText && argsText.trim() ? JSON.parse(argsText) : {};
        } catch (error) {
          publishOne('runResult', {
            ...emptyRun(),
            ran: true,
            ok: false,
            error: `Invalid JSON arguments: ${error.message}`,
          });
          return;
        }
        const user = userId && userId.trim() ? userId.trim() : null;
        try {
          const result = await client.runFunction(name, {
            args,
            auth: { principal: user, session_id: null, user_id: user },
            read_set: [],
          });
          publishOne('runResult', shapeRun(result));
        } catch (error) {
          publishOne('runResult', { ...emptyRun(), ran: true, ok: false, error: error.message });
        }
      },
      // Ephemeral cleanup: a privileged runtime-state write, then republish inspect
      // so the realtime counters reflect the purge.
      cleanup: async (_args, { publishOne }) => {
        try {
          await client.cleanupEphemeral();
        } catch {
          /* surfaced on the next inspect; the panel stays usable */
        }
        publishOne('inspect', await loadView(client));
      },
    },
  });
}

const PAGE = 50;
const SYS_FIELDS = [
  { name: '_id', type: 'String' },
  { name: '_version', type: 'Integer' },
  { name: '_createdAt', type: 'Integer' },
  { name: '_updatedAt', type: 'Integer' },
];

/* ---------------- data explorer ---------------- */

function emptyScan() {
  return {
    id: 'scan',
    loaded: false,
    table: '',
    error: '',
    columns: [],
    rows: [],
    rangeLabel: '',
    countLabel: '',
    empty: false,
    canPrev: false,
    canNext: false,
    prevDisabled: true,
    nextDisabled: true,
    offset: 0,
  };
}

function shapeScan(scan) {
  const to = scan.offset + scan.rows.length;
  return {
    id: 'scan',
    loaded: true,
    table: scan.table,
    error: '',
    columns: scan.columns,
    empty: scan.rows.length === 0,
    rangeLabel: scan.total === 0 ? 'no rows' : `${scan.offset + 1}–${to} of ${scan.total}`,
    countLabel: `${scan.total} ${scan.total === 1 ? 'row' : 'rows'}`,
    canPrev: scan.offset > 0,
    canNext: to < scan.total,
    prevDisabled: scan.offset <= 0,
    nextDisabled: to >= scan.total,
    offset: scan.offset,
    rows: scan.rows.map((row, index) => ({
      id: String(scan.offset + index),
      cells: scan.columns.map((col) => ({
        key: col,
        text: cellText(row[col]),
        sys: col.charAt(0) === '_',
      })),
    })),
  };
}

function cellText(value) {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/* ---------------- function runner ---------------- */

function emptyRun() {
  return {
    id: 'run',
    ran: false,
    ok: false,
    fn: '',
    statusLabel: '',
    kindLabel: '',
    io: '',
    facts: '',
    error: '',
    payload: '',
    reads: [],
    writes: [],
    hasReads: false,
    hasWrites: false,
    hasPayload: false,
  };
}

function shapeRun(result) {
  const reads = result.reads && result.reads.length ? result.reads.join(', ') : '—';
  const writes = result.writes && result.writes.length ? result.writes.join(', ') : '—';
  const facts = [];
  if (result.version !== undefined && result.version !== null) facts.push(`version ${result.version}`);
  if (result.changed_count !== undefined && result.changed_count !== null) {
    facts.push(`${result.changed_count} changed`);
  }
  if (result.rows) facts.push(`${result.rows.length} ${result.rows.length === 1 ? 'row' : 'rows'}`);
  if (result.elapsed_ms !== undefined && result.elapsed_ms !== null) facts.push(`${result.elapsed_ms} ms`);
  const payload = result.rows !== undefined && result.rows !== null ? result.rows : result.result;
  const payloadText =
    payload === undefined || payload === null ? '' : JSON.stringify(payload, null, 2);
  const capturedReads = (result.captured_reads || []).map((r, i) => ({
    key: `r${i}`,
    label: capturedReadLabel(r),
  }));
  const capturedWrites = (result.captured_writes || []).map((w, i) => ({
    key: `w${i}`,
    label: `${w.op} ${w.table}/${shortId(w.id)}`,
    tone: w.op,
  }));
  return {
    id: 'run',
    ran: true,
    ok: !!result.ok,
    fn: result.function || '',
    statusLabel: result.ok ? 'ok' : 'failed',
    kindLabel: kindLabel(result.kind),
    io: `reads ${reads}   →   writes ${writes}`,
    facts: facts.join('  ·  '),
    error: result.diagnostic ? `${result.diagnostic.code}: ${result.diagnostic.message}` : result.error || '',
    payload: payloadText,
    hasPayload: payloadText !== '',
    reads: capturedReads,
    writes: capturedWrites,
    hasReads: capturedReads.length > 0,
    hasWrites: capturedWrites.length > 0,
  };
}

function capturedReadLabel(r) {
  const kind = r.kind || 'read';
  if (r.table && r.id) return `${kind} ${r.table}/${shortId(r.id)}${r.version != null ? ` @v${r.version}` : ''}`;
  if (r.table) return `${kind} ${r.table}`;
  return kind;
}

function shortId(id) {
  const s = String(id);
  return s.length > 12 ? `${s.slice(0, 8)}…` : s;
}

/* ---------------- inspect view model ---------------- */

async function loadView(client) {
  return buildView(await client.inspect());
}

function buildView(s) {
  const sv = s.server || {};
  const st = s.storage || {};
  const rt = s.runtime || {};
  const sc = s.schema || {};
  const fnManifest = s.functions || {};
  const cm = s.capabilityManifest || {};
  const eph = s.ephemeral || {};
  const ld = s.liveDelivery || {};
  const subs = s.subscriptions || [];
  const diags = s.recent_diagnostics || [];
  const admin = s.admin || {};
  const tables = sc.tables || [];
  const fns = fnManifest.functions || [];

  const errorDiagnostics = diags.filter((d) => d.severity === 'Error' || d.severity === 'Fatal').length;

  return {
    id: 'inspect',
    ui: {
      // identity + status strip
      target: s.target || '—',
      loadedAt: `updated ${timeLabel()}`,
      address: `${sv.host}:${sv.port}`,
      exposureLabel: sv.loopback ? 'loopback only' : 'exposed',
      exposureTone: sv.loopback ? 'ok' : 'warn',
      storageLabel: sv.storage_mode === 'memory' ? 'in-memory' : 'file-backed',
      tokenLabel: admin.token_configured
        ? 'admin token set'
        : admin.writes_require_token
          ? 'writes need token'
          : 'open on loopback',
      tokenTone: admin.token_configured ? 'accent' : admin.writes_require_token ? 'warn' : 'muted',

      // overview dashboard tiles
      tiles: [
        { key: 'tables', label: tables.length === 1 ? 'Table' : 'Tables', value: String(tables.length), alert: false },
        { key: 'functions', label: fns.length === 1 ? 'Function' : 'Functions', value: String(fns.length), alert: false },
        { key: 'subs', label: 'Live subscriptions', value: String(subs.length), alert: false },
        { key: 'diags', label: 'Diagnostics', value: String(diags.length), alert: errorDiagnostics > 0 },
      ],

      // overview cards
      server: [
        kv('target', 'Target', s.target || '—', { mono: true }),
        kv('address', 'Address', `${sv.host}:${sv.port}`, { mono: true }),
        kv('exposure', 'Exposure', sv.loopback ? 'loopback only' : 'non-loopback (exposed)', { tone: sv.loopback ? 'ok' : 'warn' }),
        kv('uptime', 'Uptime', fmtDuration(sv.uptime_ms)),
        kv('pid', 'PID', String(sv.pid), { mono: true }),
        kv('started', 'Started', fmtTime(sv.started_at_ms)),
      ],
      storage: [
        kv('mode', 'Mode', sv.storage_mode === 'memory' ? 'in-memory' : 'file-backed'),
        kv('path', 'SQLite path', st.sqlite_path || '—', { mono: true }),
        kv('version', 'Data version', String(st.version), { mono: true }),
        kv('tables', 'Tables', String((st.tables || []).length)),
        kv('hash', 'Schema hash', sc.schemaHash || '—', { mono: true }),
      ],
      runtime: [
        kv('engine', 'Engine', rt.canonical_engine || '—'),
        kv('hostplan', 'Host-plan runtime', yn(rt.host_plan_runtime), { tone: rt.host_plan_runtime ? 'ok' : 'faint' }),
        kv('ibex', 'Ibex CLI', rt.ibex_cli && rt.ibex_cli.available ? rt.ibex_cli.version || 'available' : 'unavailable', { tone: rt.ibex_cli && rt.ibex_cli.available ? 'ok' : 'warn' }),
        kv('bridge', 'ctx.db bridge', rt.ibex_ctx_db_host_bridge || '—', { tone: stateTone(rt.ibex_ctx_db_host_bridge) }),
        kv('async', 'Async handlers', rt.async_handler_completion || '—', { tone: stateTone(rt.async_handler_completion) }),
        kv('lock', 'Lock across async', rt.sqlite_lock_held_across_async || '—', { tone: stateTone(rt.sqlite_lock_held_across_async) }),
      ],
      adminCaps: [
        { key: 'console', k: 'Console', on: !!admin.console },
        { key: 'explorer', k: 'Data explorer', on: !!admin.data_explorer },
        { key: 'runner', k: 'Function runner', on: !!admin.function_runner },
        { key: 'cleanup', k: 'Ephemeral cleanup', on: !!admin.ephemeral_cleanup },
        { key: 'edit', k: 'Direct row edit', on: !!admin.direct_data_edit },
        { key: 'sql', k: 'Raw SQL', on: !!admin.raw_sql },
        { key: 'wtoken', k: 'Writes require token', on: !!admin.writes_require_token },
      ],
      gaps: (s.capability_gaps || []).map((g) => ({ key: g, label: g })),
      hasGaps: (s.capability_gaps || []).length > 0,

      // schema
      schemaHash: sc.schemaHash || '',
      appId: sc.appId || '',
      hasTables: tables.length > 0,
      tableSummary: `${tables.length} ${tables.length === 1 ? 'table' : 'tables'}`,
      tableNames: tables.map((t) => ({ key: t.name, name: t.name })),
      tables: tables.map((t) => ({
        name: t.name,
        syncable: !!t.syncable,
        syncableLabel: t.syncable ? 'syncable' : 'local',
        syncableTone: t.syncable ? 'accent' : 'muted',
        fieldSummary: `${(t.fields || []).length} fields`,
        fields: [
          ...(t.fields || []).map((f) => ({
            key: f.name,
            name: f.name,
            type: f.field_type,
            req: f.optional ? 'optional' : 'required',
            sys: false,
          })),
          ...SYS_FIELDS.map((f) => ({ key: f.name, name: f.name, type: f.type, req: 'system', sys: true })),
        ],
        indexesLabel:
          (t.indexes || []).map((i) => `${i.name} (${(i.fields || []).join(', ')})`).join('   ·   ') || 'none',
      })),

      // functions
      hasFunctions: fns.length > 0,
      functionSummary: `${fns.length} ${fns.length === 1 ? 'function' : 'functions'}`,
      bundleHash: fnManifest.bundleHash || '',
      functions: fns.map((f) => shapeFunction(f)),

      // capability manifest
      cap: {
        storageEngine: cm.storageEngine || '—',
        runtimeEngine: cm.runtimeEngine || '—',
        isolation: cm.mutationIsolationMode || '—',
        flags: [
          { key: 'live', label: 'Live subscriptions', on: !!cm.liveSubscriptions },
          { key: 'sync', label: 'Syncable live queries', on: !!cm.syncableLiveQueries },
          { key: 'online', label: 'Online-only queries', on: !!cm.onlineOnlyQueries },
          { key: 'replace', label: 'Replace-only queries', on: !!cm.replaceOnlyQueries },
          { key: 'offline', label: 'Offline retention', on: !!cm.offlineRetention },
          { key: 'optimistic', label: 'Optimistic replay', on: !!cm.optimisticReplay },
          { key: 'impersonation', label: 'Auth impersonation', on: !!cm.authImpersonation },
          { key: 'permdiag', label: 'Permission diagnostics', on: !!cm.permissionDiagnostics },
          { key: 'assets', label: 'Asset upload', on: !!cm.assetUpload },
          { key: 'actions', label: 'Outbound actions', on: !!cm.outboundActions },
          { key: 'cron', label: 'Cron', on: !!cm.cron },
          { key: 'notify', label: 'Notifications', on: !!cm.notifications },
        ],
        queryForms: (cm.supportedQueryForms || []).map((q) => ({ key: q, label: q })),
        hasForms: (cm.supportedQueryForms || []).length > 0,
        limits: (cm.resourceLimits || []).map((r) => ({
          key: r.name,
          name: r.name,
          status: r.status,
          tone: r.status === 'Enforced' ? 'ok' : r.status === 'Advisory' ? 'warn' : 'faint',
        })),
        hasLimits: (cm.resourceLimits || []).length > 0,
        gaps: (cm.capabilityGaps || []).map((g) => ({ key: g, label: g })),
        hasGaps: (cm.capabilityGaps || []).length > 0,
      },

      // realtime
      hasSubs: subs.length > 0,
      subCountLabel: String(subs.length),
      subscriptions: subs.map((x, i) => ({
        key: String(i),
        id: x.id,
        connection: x.connection_id,
        function: x.function,
      })),
      delivery: [
        { key: 'fa', label: 'Fanout attempts', value: String(ld.total_fanout_attempts || 0) },
        { key: 'd', label: 'Deliveries', value: String(ld.total_deliveries || 0) },
        { key: 's', label: 'Skipped', value: String(ld.total_skipped || 0) },
        { key: 'lfs', label: 'Last fanout subs', value: String(ld.last_fanout_subscriptions || 0) },
        { key: 'ld', label: 'Last deliveries', value: String(ld.last_deliveries || 0) },
        { key: 'ls', label: 'Last skipped', value: String(ld.last_skipped || 0) },
      ],
      ephemeral: [
        { key: 'rooms', label: 'Rooms', value: String(eph.room_count || 0), alert: false },
        { key: 'entries', label: 'Entries', value: String(eph.entry_count || 0), alert: false },
        { key: 'subs', label: 'Subscribers', value: String(eph.subscriber_count || 0), alert: false },
        { key: 'bytes', label: 'Value bytes', value: fmtBytes(eph.value_bytes || 0), alert: false },
        { key: 'coalesced', label: 'Coalesced', value: String(eph.coalesced_updates || 0), alert: false },
        { key: 'resync', label: 'Resync required', value: String(eph.resync_required || 0), alert: (eph.resync_required || 0) > 0 },
        { key: 'rejected', label: 'Rejected', value: String(eph.rejected_publishes || 0), alert: (eph.rejected_publishes || 0) > 0 },
        { key: 'rate', label: 'Rate-limited', value: String(eph.rate_limited_publishes || 0), alert: (eph.rate_limited_publishes || 0) > 0 },
        { key: 'oversized', label: 'Oversized', value: String(eph.oversized_publishes || 0), alert: (eph.oversized_publishes || 0) > 0 },
        { key: 'unauth', label: 'Unauthorized', value: String(eph.unauthorized_requests || 0), alert: (eph.unauthorized_requests || 0) > 0 },
        { key: 'expired', label: 'Expired', value: String(eph.expired_entries || 0), alert: false },
        { key: 'disc', label: 'Disconnected', value: String(eph.disconnected_entries || 0), alert: false },
      ],
      canCleanup: !!admin.ephemeral_cleanup,

      // diagnostics
      hasDiags: diags.length > 0,
      diagSummary: `${diags.length} recent`,
      diagnostics: diags.map((d, i) => ({
        key: String(i),
        code: d.code,
        subsystem: d.subsystem,
        message: d.message,
        sevLabel: d.severity,
        sevTone: severityTone(d.severity),
        details: hasDetails(d.details) ? JSON.stringify(d.details, null, 2) : '',
        hasDetails: hasDetails(d.details),
      })),
    },
  };
}

function shapeFunction(f) {
  const rt = f.runtime || {};
  const reads = (f.readSetSummary && f.readSetSummary.tables) || [];
  const writes = (f.writeSetSummary && f.writeSetSummary.tables) || [];
  let planLabel = 'runtime';
  let planSummary = '';
  let planJson = '';
  let source = '';
  let isIbex = false;
  if (rt.HostPlan) {
    planLabel = 'host plan';
    planJson = JSON.stringify(rt.HostPlan, null, 2);
    if (rt.HostPlan.Query) {
      const q = rt.HostPlan.Query;
      const where = (q.filters || []).map((fl) => `${fl.field} ${fl.op} ${valueExpr(fl.value)}`).join(' and ');
      planSummary = `read ${q.table}` + (q.indexed_by ? ` via ${q.indexed_by}` : '') + (where ? ` where ${where}` : '');
    } else if (rt.HostPlan.Mutation) {
      planSummary = (rt.HostPlan.Mutation.steps || [])
        .map((step) => {
          const op = Object.keys(step)[0];
          return `${op.toLowerCase()} ${step[op].table}`;
        })
        .join(', ');
    }
  } else if (rt.IbexModule) {
    planLabel = 'ibex module';
    isIbex = true;
    source = rt.IbexModule.source || '(no source captured)';
    planSummary = `export ${rt.IbexModule.export || 'default'}`;
  }
  return {
    name: f.name,
    kind: f.kind,
    kindLabel: kindLabel(f.kind),
    kindTone: f.kind === 'Mutation' ? 'warn' : 'accent',
    auth: f.authRequirement || '—',
    syncability: f.syncabilityClass || '—',
    reads: reads.length ? reads.join(', ') : '—',
    writes: writes.length ? writes.join(', ') : '—',
    io: `reads ${reads.length ? reads.join(', ') : '—'}   →   writes ${writes.length ? writes.join(', ') : '—'}`,
    caps: (f.requiredCapabilities || []).map((c) => ({ key: c, label: c })),
    hasCaps: (f.requiredCapabilities || []).length > 0,
    planLabel,
    planSummary: planSummary || '—',
    planJson,
    hasPlanJson: planJson !== '',
    source,
    isIbex,
  };
}

/* ---------------- helpers ---------------- */

function kv(key, k, v, opts = {}) {
  return { key, k, v, mono: !!opts.mono, tone: opts.tone || '' };
}

function kindLabel(kind) {
  if (!kind) return '';
  if (kind === 'LiveQuery') return 'live query';
  return String(kind).toLowerCase();
}

function valueExpr(v) {
  if (v === 'AuthUserId') return 'auth.user';
  if (v && typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function yn(b) {
  return b ? 'yes' : 'no';
}

function stateTone(state) {
  if (state === 'Available') return 'ok';
  if (state === 'Unavailable') return 'warn';
  return 'faint';
}

function severityTone(sev) {
  if (sev === 'Error' || sev === 'Fatal') return 'err';
  if (sev === 'Warning') return 'warn';
  return 'info';
}

function hasDetails(d) {
  if (d === null || d === undefined) return false;
  if (typeof d !== 'object') return true;
  return Object.keys(d).length > 0;
}

function timeLabel() {
  try {
    return new Date().toLocaleTimeString();
  } catch {
    return '';
  }
}

function fmtTime(ms) {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function fmtDuration(ms) {
  if (ms === undefined || ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  let s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  s %= 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.slice(0, 2).join(' ');
}
