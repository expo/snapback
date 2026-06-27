// Snapback admin ↔ Contract bridge.
//
// Mirrors the Snapback Contract adapter shape, but over the *admin* API:
// it hydrates a reactive boundary from `/_snapback/api/inspect` and exposes the
// link functions the .contract's `use ... from` targets delegate to. The inspect
// payload is flattened into a `data.ui.*` view model here (in plain JS) so the
// Contract template stays declarative — no formatting logic in the view.

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
      // The data explorer's parameterized read: fetch a page, pre-shape rows
      // into {key,text,sys} cells so the .contract uses static access, not
      // row[col], and republish to the boundary.
      loadTable: async ({ table, offset }, { publishOne }) => {
        try {
          const scan = await client.scanTable(table, PAGE, offset || 0);
          publishOne('tableScan', shapeScan(scan));
        } catch (error) {
          publishOne('tableScan', { ...emptyScan(), loaded: true, table, error: error.message });
        }
      },
      // The function runner: parse the args text, invoke through the admin API's
      // normal function runner path, and republish a shaped result. Errors
      // become displayable state.
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
            error: `Invalid JSON args: ${error.message}`,
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
    },
  });
}

const PAGE = 50;

function emptyScan() {
  return {
    id: 'scan',
    loaded: false,
    table: '',
    error: '',
    columns: [],
    rows: [],
    rangeLabel: '',
    canPrev: false,
    canNext: false,
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
    rangeLabel: scan.total === 0 ? '0 of 0' : `${scan.offset + 1}–${to} of ${scan.total}`,
    canPrev: scan.offset > 0,
    canNext: to < scan.total,
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

function emptyRun() {
  return { id: 'run', ran: false, ok: false, fn: '', kind: '', io: '', facts: '', error: '', payload: '' };
}

function shapeRun(result) {
  const reads = result.reads && result.reads.length ? result.reads.join(', ') : '—';
  const writes = result.writes && result.writes.length ? result.writes.join(', ') : '—';
  const facts = [];
  if (result.version !== undefined && result.version !== null) facts.push(`version ${result.version}`);
  if (result.changed_count !== undefined && result.changed_count !== null) {
    facts.push(`${result.changed_count} changed`);
  }
  if (result.rows) facts.push(`${result.rows.length} rows`);
  facts.push(`${result.elapsed_ms} ms`);
  const payload = result.rows !== undefined && result.rows !== null ? result.rows : result.result;
  return {
    id: 'run',
    ran: true,
    ok: !!result.ok,
    fn: result.function || '',
    kind: result.kind === 'LiveQuery' ? 'live query' : result.kind ? String(result.kind).toLowerCase() : '',
    io: `reads ${reads}   →   writes ${writes}`,
    facts: facts.join('  ·  '),
    error: result.diagnostic ? `${result.diagnostic.code}: ${result.diagnostic.message}` : '',
    payload: payload === undefined || payload === null ? '' : JSON.stringify(payload, null, 2),
  };
}

async function loadView(client) {
  return buildView(await client.inspect());
}

// Flatten the admin inspect payload into the view model the .contract renders.
function buildView(s) {
  const sv = s.server;
  const st = s.storage;
  const rt = s.runtime;
  const e = s.ephemeral;
  const fns = (s.functions && s.functions.functions) || [];
  const diags = s.recent_diagnostics || [];
  return {
    id: 'inspect',
    ui: {
      target: s.target,
      address: `${sv.host}:${sv.port}`,
      exposure: sv.loopback ? 'loopback only' : 'non-loopback (exposed)',
      uptime: fmtDuration(sv.uptime_ms),
      pid: String(sv.pid),
      storageMode: sv.storage_mode === 'memory' ? 'in-memory' : 'file-backed',
      sqlitePath: st.sqlite_path || '—',
      dataVersion: String(st.version),
      schemaHash: (s.schema && s.schema.schema_hash) || '—',
      engine: rt.canonical_engine,
      ibex: rt.ibex_cli.available ? rt.ibex_cli.version || 'available' : 'unavailable',
      writesRequireToken: s.admin.writes_require_token ? 'yes' : 'no',
      gaps: s.capability_gaps || [],
      tableCount: String(((s.schema && s.schema.tables) || []).length),
      functionCount: String(fns.length),
      diagnosticCount: String(diags.length),
      eph: {
        rooms: String(e.room_count),
        entries: String(e.entry_count),
        subscribers: String(e.subscriber_count),
        resync: String(e.resync_required),
        rejected: String(e.rejected_publishes),
        rateLimited: String(e.rate_limited_publishes),
      },
      tables: ((s.schema && s.schema.tables) || []).map((t) => ({
        name: t.name,
        syncable: t.syncable,
        syncableLabel: t.syncable ? 'syncable' : 'local',
        fields: [
          { name: '_id', type: 'String', sys: true },
          ...((t.fields) || []).map((f) => ({ name: f.name, type: f.field_type, sys: false })),
          { name: '_version', type: 'Integer', sys: true },
          { name: '_createdAt', type: 'Integer', sys: true },
          { name: '_updatedAt', type: 'Integer', sys: true },
        ],
        indexes: ((t.indexes) || []).map((i) => `${i.name} (${i.fields.join(', ')})`).join(', ') || '—',
      })),
      functions: fns.map((f) => {
        const io = planIo(f);
        return {
          name: f.name,
          kindLabel: f.kind === 'LiveQuery' ? 'live query' : f.kind.toLowerCase(),
          io: `reads ${io.reads}   →   writes ${io.writes}`,
        };
      }),
      diagnostics: diags.map((d, i) => ({
        id: String(i),
        code: d.code,
        subsystem: d.subsystem,
        message: d.message,
      })),
    },
  };
}

// Mirror of the Rust plan_io: show what a function reads and writes.
function planIo(fn) {
  const rt = fn.runtime;
  if (rt && rt.HostPlan) {
    if (rt.HostPlan.Query) return { reads: rt.HostPlan.Query.table, writes: '—' };
    if (rt.HostPlan.Mutation) {
      const reads = new Set();
      const writes = new Set();
      for (const step of rt.HostPlan.Mutation.steps || []) {
        if (step.Insert) writes.add(step.Insert.table);
        if (step.Patch) { reads.add(step.Patch.table); writes.add(step.Patch.table); }
        if (step.Delete) { reads.add(step.Delete.table); writes.add(step.Delete.table); }
      }
      return { reads: [...reads].join(', ') || '—', writes: [...writes].join(', ') || '—' };
    }
  }
  return { reads: '—', writes: '—' };
}

function fmtDuration(ms) {
  if (ms < 1000) return `${ms} ms`;
  let s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  s %= 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.slice(0, 2).join(' ');
}
