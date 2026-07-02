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
  // The most recent config.verify outcome, folded into the next inspect view so
  // the Secrets surface can show "verify ran and said X" next to durable state.
  let lastVerify = null;
  const loadView = async () => buildView(...(await loadFacts(client)), lastVerify);
  return createSnapbackSystemContractSurface({
    runtime,
    targetSurface: 'Snapback admin Contract',
    resources: {
      inspect: async () => loadView(),
      tableScan: emptyScan,
      runResult: emptyRun,
    },
    commands: {
      refresh: async (_args, { publishOne }) => {
        // An explicit refresh drops the transient probe-result note; the
        // durable verified state on each entry is what remains authoritative.
        lastVerify = null;
        publishOne('inspect', await loadView());
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
        publishOne('inspect', await loadView());
      },
      // config.verify: run the entry's probe, remember the outcome (ok or the
      // failure diagnostic — never a value), and republish so the Secrets
      // surface shows both the fresh verification state and the probe result.
      verifyConfig: async ({ entry }, { publishOne }) => {
        if (!entry) return;
        try {
          const outcome = await client.verifyConfigEntry(entry);
          lastVerify = {
            entry: outcome.entry || entry,
            ok: !!outcome.ok,
            detail: (outcome.verified && outcome.verified.diagnostic) || '',
          };
        } catch (error) {
          lastVerify = { entry, ok: false, detail: error.message };
        }
        publishOne('inspect', await loadView());
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

// Inspect is required (its failure is the console's error state); config status
// is optional so the console keeps working against a server without the
// LLP 0036 routes — the Secrets surface then reports itself unavailable.
async function loadFacts(client) {
  return Promise.all([
    client.inspect(),
    typeof client.configStatus === 'function'
      ? client.configStatus().then(
          (status) => ({ available: true, status }),
          (error) => ({ available: false, error: error.message }),
        )
      : { available: false, error: 'config status is not supported by this client' },
  ]);
}

function buildView(s, configResult, lastVerify) {
  const sv = s.server || {};
  const st = s.storage || {};
  const rt = s.runtime || {};
  const sc = s.schema || {};
  const fnManifest = s.functions || {};
  const cm = s.capabilityManifest || {};
  const eph = s.ephemeral || {};
  const ld = s.liveDelivery || {};
  const subs = s.subscriptions || [];
  const diags = s.recentDiagnostics || [];
  const admin = s.admin || {};
  const tables = sc.tables || [];
  const fns = fnManifest.functions || [];

  const errorDiagnostics = diags.filter((d) => d.severity === 'Error' || d.severity === 'Fatal').length;
  const config = shapeConfig(configResult, fns, lastVerify);

  return {
    id: 'inspect',
    ui: {
      config,
      // identity + status strip
      target: s.target || '—',
      loadedAt: `updated ${timeLabel()}`,
      address: `${sv.host}:${sv.port}`,
      exposureLabel: sv.loopback ? 'loopback only' : 'exposed',
      exposureTone: sv.loopback ? 'ok' : 'warn',
      storageLabel: sv.storageMode === 'memory' ? 'in-memory' : 'file-backed',
      tokenLabel: admin.tokenConfigured
        ? 'admin token set'
        : admin.writesRequireToken
          ? 'writes need token'
          : 'open on loopback',
      tokenTone: admin.tokenConfigured ? 'accent' : admin.writesRequireToken ? 'warn' : 'muted',
      // Missing required config is a whole-deployment fact ("the app is not
      // fully set up"), so it earns a strip badge on every surface.
      showConfigAlert: config.available && config.missingCount > 0,
      configAlertLabel: `config: ${config.missingCount} required missing`,

      // overview dashboard tiles
      tiles: [
        { key: 'tables', label: tables.length === 1 ? 'Table' : 'Tables', value: String(tables.length), alert: false },
        { key: 'functions', label: fns.length === 1 ? 'Function' : 'Functions', value: String(fns.length), alert: false },
        { key: 'config', label: config.declaredCount === 1 ? 'Config entry' : 'Config entries', value: config.available ? String(config.declaredCount) : '—', alert: config.available && config.missingCount > 0 },
        { key: 'subs', label: 'Live subscriptions', value: String(subs.length), alert: false },
        { key: 'diags', label: 'Diagnostics', value: String(diags.length), alert: errorDiagnostics > 0 },
      ],

      // overview cards
      server: [
        kv('target', 'Target', s.target || '—', { mono: true }),
        kv('address', 'Address', `${sv.host}:${sv.port}`, { mono: true }),
        kv('exposure', 'Exposure', sv.loopback ? 'loopback only' : 'non-loopback (exposed)', { tone: sv.loopback ? 'ok' : 'warn' }),
        kv('uptime', 'Uptime', fmtDuration(sv.uptimeMs)),
        kv('pid', 'PID', String(sv.pid), { mono: true }),
        kv('started', 'Started', fmtTime(sv.startedAtMs)),
      ],
      storage: [
        kv('mode', 'Mode', sv.storageMode === 'memory' ? 'in-memory' : 'file-backed'),
        kv('path', 'SQLite path', st.sqlitePath || '—', { mono: true }),
        kv('version', 'Data version', String(st.version), { mono: true }),
        kv('tables', 'Tables', String((st.tables || []).length)),
        kv('hash', 'Schema hash', sc.schemaHash || '—', { mono: true }),
      ],
      runtime: [
        kv('engine', 'Engine', rt.canonicalEngine || '—'),
        kv('hostplan', 'Host-plan runtime', yn(rt.hostPlanRuntime), { tone: rt.hostPlanRuntime ? 'ok' : 'faint' }),
        kv('ibex', 'Ibex CLI', rt.ibexCli && rt.ibexCli.available ? rt.ibexCli.version || 'available' : 'unavailable', { tone: rt.ibexCli && rt.ibexCli.available ? 'ok' : 'warn' }),
        kv('bridge', 'ctx.db bridge', rt.ibexCtxDbHostBridge || '—', { tone: stateTone(rt.ibexCtxDbHostBridge) }),
        kv('async', 'Async handlers', rt.asyncHandlerCompletion || '—', { tone: stateTone(rt.asyncHandlerCompletion) }),
        kv('lock', 'Lock across async', rt.sqliteLockHeldAcrossAsync || '—', { tone: stateTone(rt.sqliteLockHeldAcrossAsync) }),
      ],
      adminCaps: [
        { key: 'console', k: 'Console', on: !!admin.console },
        { key: 'explorer', k: 'Data explorer', on: !!admin.dataExplorer },
        { key: 'runner', k: 'Function runner', on: !!admin.functionRunner },
        { key: 'cleanup', k: 'Ephemeral cleanup', on: !!admin.ephemeralCleanup },
        { key: 'edit', k: 'Direct row edit', on: !!admin.directDataEdit },
        { key: 'sql', k: 'Raw SQL', on: !!admin.rawSql },
        { key: 'wtoken', k: 'Writes require token', on: !!admin.writesRequireToken },
      ],
      gaps: (s.capabilityGaps || []).map((g) => ({ key: g, label: g })),
      hasGaps: (s.capabilityGaps || []).length > 0,

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
        { key: 'fa', label: 'Fanout attempts', value: String(ld.totalFanoutAttempts || 0) },
        { key: 'd', label: 'Deliveries', value: String(ld.totalDeliveries || 0) },
        { key: 's', label: 'Skipped', value: String(ld.totalSkipped || 0) },
        { key: 'lfs', label: 'Last fanout subs', value: String(ld.lastFanoutSubscriptions || 0) },
        { key: 'ld', label: 'Last deliveries', value: String(ld.lastDeliveries || 0) },
        { key: 'ls', label: 'Last skipped', value: String(ld.lastSkipped || 0) },
      ],
      ephemeral: [
        { key: 'rooms', label: 'Rooms', value: String(eph.roomCount || 0), alert: false },
        { key: 'entries', label: 'Entries', value: String(eph.entryCount || 0), alert: false },
        { key: 'subs', label: 'Subscribers', value: String(eph.subscriberCount || 0), alert: false },
        { key: 'bytes', label: 'Value bytes', value: fmtBytes(eph.valueBytes || 0), alert: false },
        { key: 'coalesced', label: 'Coalesced', value: String(eph.coalescedUpdates || 0), alert: false },
        { key: 'resync', label: 'Resync required', value: String(eph.resyncRequired || 0), alert: (eph.resyncRequired || 0) > 0 },
        { key: 'rejected', label: 'Rejected', value: String(eph.rejectedPublishes || 0), alert: (eph.rejectedPublishes || 0) > 0 },
        { key: 'rate', label: 'Rate-limited', value: String(eph.rateLimitedPublishes || 0), alert: (eph.rateLimitedPublishes || 0) > 0 },
        { key: 'oversized', label: 'Oversized', value: String(eph.oversizedPublishes || 0), alert: (eph.oversizedPublishes || 0) > 0 },
        { key: 'unauth', label: 'Unauthorized', value: String(eph.unauthorizedRequests || 0), alert: (eph.unauthorizedRequests || 0) > 0 },
        { key: 'expired', label: 'Expired', value: String(eph.expiredEntries || 0), alert: false },
        { key: 'disc', label: 'Disconnected', value: String(eph.disconnectedEntries || 0), alert: false },
      ],
      canCleanup: !!admin.ephemeralCleanup,

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

/* ---------------- config / secrets ---------------- */

// @ref LLP 0036#status-model-and-app-visibility-d4 — one status primitive,
// projected: declared × set × verified × applied per entry, names and states
// only. This shaping renders the primitive; it never sees a value.
function shapeConfig(configResult, fns, lastVerify) {
  if (!configResult || !configResult.available) {
    return {
      available: false,
      error: (configResult && configResult.error) || '',
      declaredCount: 0,
      missingCount: 0,
      tiles: [],
      entries: [],
      hasEntries: false,
      generationLabel: '',
      backendClass: '',
      readyLabel: '',
      readyTone: 'muted',
      missingLabel: '',
      setupHref: SETUP_HREF,
    };
  }
  const status = configResult.status || {};
  const entries = status.entries || [];
  const missing = status.required_missing || status.requiredMissing || [];
  const setCount = entries.filter((e) => e.set).length;
  const verifiedOk = entries.filter((e) => e.verified && e.verified.ok).length;
  return {
    available: true,
    error: '',
    declaredCount: entries.length,
    missingCount: missing.length,
    tiles: [
      { key: 'declared', label: 'Declared', value: String(entries.length), alert: false },
      { key: 'set', label: 'Set', value: String(setCount), alert: false },
      { key: 'missing', label: 'Missing required', value: String(missing.length), alert: missing.length > 0 },
      { key: 'verified', label: 'Verified OK', value: String(verifiedOk), alert: false },
    ],
    generationLabel: `generation ${status.generation ?? 0}`,
    backendClass: status.backendClass || status.backend_class || '—',
    readyLabel: missing.length === 0
      ? 'all required entries set'
      : `${missing.length} required ${missing.length === 1 ? 'entry' : 'entries'} missing`,
    readyTone: missing.length === 0 ? 'ok' : 'warn',
    missingLabel: missing.join(', '),
    setupHref: SETUP_HREF,
    hasEntries: entries.length > 0,
    entries: entries.map((e) => shapeConfigEntry(e, fns, lastVerify)),
  };
}

function shapeConfigEntry(e, fns, lastVerify) {
  // D8 legibility: "which functions can see this key" — joined from the
  // manifest's per-function `uses` grants (a probe is implicitly granted).
  const usedBy = fns
    .filter((f) => (f.uses || []).includes(e.name))
    .map((f) => ({ key: f.name, label: f.name }));
  const verified = e.verified || null;
  const verifiedLabel = !e.set
    ? ''
    : verified
      ? verified.ok
        ? `verified ${fmtTime(verified.atMs)}`
        : 'verify failed'
      : e.probe
        ? 'unverified'
        : '';
  const changedParts = [];
  if (e.lastChangedMs) changedParts.push(`changed ${fmtTime(e.lastChangedMs)}`);
  if (e.source) changedParts.push(`via ${e.source}`);
  const verifyResult = lastVerify && lastVerify.entry === e.name ? lastVerify : null;
  return {
    name: e.name,
    description: e.description || '',
    purpose: e.purpose || '',
    secretLabel: e.secret ? 'secret' : 'config',
    secretTone: e.secret ? 'accent' : 'default',
    requiredLabel: e.required ? 'required' : 'optional',
    poolLabel: e.pool ? `pool ×${e.memberCount || 0}` : '',
    setLabel: e.set
      ? e.pool
        ? `set (${e.memberCount} ${e.memberCount === 1 ? 'key' : 'keys'})`
        : 'set'
      : 'not set',
    setTone: e.set ? 'ok' : e.required ? 'warn' : 'default',
    verifiedLabel,
    verifiedTone: verified ? (verified.ok ? 'ok' : 'err') : 'default',
    verifyDiagnostic: verified && !verified.ok ? verified.diagnostic || '' : '',
    pendingLabel: e.applyState && e.applyState !== 'applied' ? e.applyState : '',
    changedLabel: changedParts.join(' '),
    howToGet: e.howToGet || '',
    usedBy,
    hasUsedBy: usedBy.length > 0,
    canVerify: !!e.probe && e.set,
    verifyRan: !!verifyResult,
    verifyOk: !!(verifyResult && verifyResult.ok),
    verifyLabel: verifyResult ? (verifyResult.ok ? 'probe ok' : 'probe failed') : '',
    verifyDetail: (verifyResult && verifyResult.detail) || '',
  };
}

const SETUP_HREF = '/_snapback/admin/setup';

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
    // D8 per-action config grants: the entries this function may receive.
    grants: (f.uses || []).map((u) => ({ key: u, label: u })),
    hasGrants: (f.uses || []).length > 0,
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
