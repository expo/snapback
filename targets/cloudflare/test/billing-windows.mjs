// LLP 0040 §Measurements — billing/usage counters for the idle windows, read
// from the Cloudflare GraphQL analytics API. "Steady compute drops to zero" is
// only evidence if the billing surface agrees, so this reads the surfaces the
// invoice is computed from:
//
//   - workersInvocationsAdaptive        requests / duration (GB-s) / wallTime
//   - durableObjectsInvocationsAdaptiveGroups   DO request counts
//   - durableObjectsPeriodicGroups      activeTime (the DO duration meter),
//                                       websocket message counts, storage units
//   - durableObjectsStorageGroups       stored bytes
//
// Used two ways:
//   - imported by acceptance.remote.mjs to attach real counters to the
//     idle-window checks;
//   - as a CLI to read any window, e.g. the multi-hour overnight idle of a
//     deployment, hourly-bucketed to expose the scheduled-wakeup rate:
//
//       CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
//         node targets/cloudflare/test/billing-windows.mjs \
//         --scripts snapback-notes-proof,snapback-notes-handler \
//         --start 2026-07-08T00:00:00Z --end 2026-07-08T08:00:00Z --hourly
//
// Analytics attribution can lag ingestion by minutes (fresh scripts have shown
// `scriptName: "__unknown__"` shortly after first deploy — ENG-23632); callers
// must treat "no rows yet" as attribution lag, not as zero, until the window
// is comfortably in the past. Every dataset read is independent: a dataset
// that errors is reported under `errors` instead of sinking the others.

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

async function graphql(apiToken, query, variables) {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).join('; '));
  }
  return payload.data;
}

function accountWrap(inner) {
  return `query ($accountTag: string!, $start: Time!, $end: Time!, $scripts: [string!]) {
    viewer { accounts(filter: { accountTag: $accountTag }) { ${inner} } }
  }`;
}

const DATASETS = {
  workersInvocations: (hourly) => `
    workersInvocationsAdaptive(
      limit: 1000,
      filter: { scriptName_in: $scripts, datetime_geq: $start, datetime_leq: $end }
    ) {
      sum { requests errors duration wallTime }
      dimensions { scriptName${hourly ? ' datetimeHour' : ''} }
    }`,
  durableObjectInvocations: (hourly) => `
    durableObjectsInvocationsAdaptiveGroups(
      limit: 1000,
      filter: { scriptName_in: $scripts, datetime_geq: $start, datetime_leq: $end }
    ) {
      sum { requests errors wallTime responseBodySize }
      dimensions { scriptName${hourly ? ' datetimeHour' : ''} }
    }`,
  // NB: this dataset has no script identity at all (its filter rejects
  // scriptName_in and its dimensions lack scriptName), so these rows are
  // ACCOUNT-WIDE DO totals for the window. Fine for this account — it runs
  // only the snapback proof workers — and the summary labels it as such.
  durableObjectPeriodic: (hourly) => `
    durableObjectsPeriodicGroups(
      limit: 1000,
      filter: { datetime_geq: $start, datetime_leq: $end }
    ) {
      sum {
        activeTime cpuTime subrequests
        inboundWebsocketMsgCount outboundWebsocketMsgCount
        storageReadUnits storageWriteUnits storageDeletes
        exceededCpuErrors exceededMemoryErrors fatalInternalErrors
      }
      ${hourly ? 'dimensions { datetimeHour }' : ''}
    }`,
  durableObjectStorage: () => `
    durableObjectsStorageGroups(
      limit: 100,
      filter: { datetime_geq: $start, datetime_leq: $end }
    ) {
      max { storedBytes }
    }`,
};

// Reads every dataset for [startISO, endISO] over the given script names.
// Returns { window, datasets, errors } — a dataset that fails lands in
// `errors` with its message and never blocks the rest.
export async function readBillingWindow({ accountId, apiToken, scripts, startISO, endISO, hourly = false }) {
  const variables = { accountTag: accountId, start: startISO, end: endISO, scripts };
  const datasets = {};
  const errors = [];
  for (const [name, build] of Object.entries(DATASETS)) {
    try {
      const data = await graphql(apiToken, accountWrap(build(hourly)), variables);
      const account = data?.viewer?.accounts?.[0] ?? {};
      const key = Object.keys(account)[0];
      let rows = key ? account[key] : [];
      // Datasets whose filter can't take scriptName_in are grouped by
      // scriptName and narrowed here instead.
      if (Array.isArray(rows)) {
        rows = rows.filter(
          (row) => !row?.dimensions?.scriptName || scripts.includes(row.dimensions.scriptName)
        );
      }
      datasets[name] = rows;
    } catch (error) {
      errors.push({ dataset: name, message: String(error?.message ?? error) });
    }
  }
  return {
    window: { start: startISO, end: endISO, scripts, hourly },
    datasets,
    errors,
  };
}

// Collapses a readBillingWindow() result into the handful of billing-relevant
// totals the idle-window evidence needs. Missing datasets stay null so the
// report can distinguish "zero" from "not read".
export function summarizeBillingWindow(read) {
  const sumOver = (rows, pick) =>
    rows == null ? null : rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
  const workers = read.datasets.workersInvocations;
  const doInvocations = read.datasets.durableObjectInvocations;
  const doPeriodic = read.datasets.durableObjectPeriodic;
  const doStorage = read.datasets.durableObjectStorage;
  return {
    workerRequests: sumOver(workers, (r) => r.sum?.requests),
    workerDurationGbS: sumOver(workers, (r) => r.sum?.duration),
    durableObjectRequests: sumOver(doInvocations, (r) => r.sum?.requests),
    // Account-wide (durableObjectsPeriodicGroups carries no script identity).
    durableObjectActiveTimeUs: sumOver(doPeriodic, (r) => r.sum?.activeTime),
    durableObjectCpuTimeUs: sumOver(doPeriodic, (r) => r.sum?.cpuTime),
    websocketMessagesIn: sumOver(doPeriodic, (r) => r.sum?.inboundWebsocketMsgCount),
    websocketMessagesOut: sumOver(doPeriodic, (r) => r.sum?.outboundWebsocketMsgCount),
    storageReadUnits: sumOver(doPeriodic, (r) => r.sum?.storageReadUnits),
    storageWriteUnits: sumOver(doPeriodic, (r) => r.sum?.storageWriteUnits),
    maxStoredBytes: doStorage == null ? null : Math.max(0, ...doStorage.map((r) => r.max?.storedBytes ?? 0)),
    datasetErrors: read.errors.length ? read.errors : undefined,
  };
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const scripts = (flag('scripts') ?? '').split(',').filter(Boolean);
  const startISO = flag('start');
  const endISO = flag('end');
  if (!accountId || !apiToken || scripts.length === 0 || !startISO || !endISO) {
    console.error(
      'usage: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node billing-windows.mjs ' +
        '--scripts a,b --start <ISO> --end <ISO> [--hourly]'
    );
    process.exit(2);
  }
  const read = await readBillingWindow({
    accountId,
    apiToken,
    scripts,
    startISO,
    endISO,
    hourly: args.includes('--hourly'),
  });
  console.log(JSON.stringify({ ...read, summary: summarizeBillingWindow(read) }, null, 2));
}
