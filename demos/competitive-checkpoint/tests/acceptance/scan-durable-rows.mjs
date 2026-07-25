// @ref LLP 0076#acceptance — "diagnostics and retained receipts pass
// secret/private-data scans": the DURABLE-row half on the gate-bearing hosted
// target (single-instance-container-vm.v1). The local-arm halves (envelope
// scrubbing, retained instrument receipts) are witnessed separately; this
// scan covers the rows the remote drill retains on the hosted machine.
//
// Usage:
//   node scan-durable-rows.mjs \
//     --attempts <sqlite3 -json dump of _snapback_stream_attempts> \
//     --messages <sqlite3 -json dump of the app messages table> \
//     --conversations <sqlite3 -json dump of the app conversations table> \
//     --out <receipt path>
//
// The dumps are produced ON the machine (fly ssh console -C "sqlite3 -json
// ...") so the bytes scanned are the durable bytes the hosted target actually
// retains. Live secret values to hunt for arrive ONLY via environment
// (SNAPBACK_DRILL_SCAN_SECRET_<NAME>); the receipt records named classes and
// verdicts, never values.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index].replace(/^--/, ''), process.argv[index + 1]);
}
const requiredArg = (name) => {
  const value = args.get(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
};

const inputs = {
  attempts: readFileSync(requiredArg('attempts'), 'utf8'),
  messages: readFileSync(requiredArg('messages'), 'utf8'),
  conversations: readFileSync(requiredArg('conversations'), 'utf8'),
};

// The protocol fixture's staged secret corpus: the same values the local-arm
// envelope suite stages and the retained-receipt scan hunts. None of them is
// ever staged on the drill machine, so any hit is a hard failure.
const FIXTURE_SECRET_CORPUS = [
  'test-511-key-alpha',
  'test-ors-key-omega',
  'stream-secret-value-7f3a',
];

// Live machine-secret classes, provided by the operator via environment so
// the scan hunts the real credential bytes present in the machine process
// environment during the drill. Values never enter this receipt.
const liveSecretClasses = Object.entries(process.env)
  .filter(([name, value]) => name.startsWith('SNAPBACK_DRILL_SCAN_SECRET_') && value)
  .map(([name, value]) => ({
    class: name.replace('SNAPBACK_DRILL_SCAN_SECRET_', '').toLowerCase(),
    value,
  }));

// Upstream-request material: the machine-loopback source URL must never be
// retained in a durable row (the local-arm lib witness "URL path never
// retained" — this is its hosted durable-row twin).
const UPSTREAM_MATERIAL = [
  process.env.SNAPBACK_DRILL_SOURCE_URL ?? 'http://127.0.0.1:4488',
  '127.0.0.1:4488',
  '/stream"',
  '/slow"',
  '/ambiguous"',
];

const MARKERS = ['[snapback secret'];

function scan(tableName, text) {
  const findings = [];
  const hunt = (needle, kind, label) => {
    if (needle.length > 0 && text.includes(needle)) {
      findings.push({ kind, class: label });
    }
  };
  for (const value of FIXTURE_SECRET_CORPUS) hunt(value, 'fixture-secret', value);
  for (const { class: label, value } of liveSecretClasses) hunt(value, 'live-secret', label);
  for (const value of UPSTREAM_MATERIAL) hunt(value, 'upstream-material', value);
  for (const value of MARKERS) hunt(value, 'marker', value);
  return {
    table: tableName,
    bytesScanned: Buffer.byteLength(text, 'utf8'),
    rowCount: countRows(text),
    sha256: createHash('sha256').update(text).digest('hex'),
    findings,
  };
}

function countRows(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

const tables = [
  scan('_snapback_stream_attempts', inputs.attempts),
  scan('messages', inputs.messages),
  scan('conversations', inputs.conversations),
];
const totalFindings = tables.reduce((sum, table) => sum + table.findings.length, 0);

const receipt = {
  schemaVersion: 'snapback.competitive-checkpoint.durable-row-scan.v0',
  protocol: 'llp-0075-convex-checkpoint-v0',
  adapterProfile: 'single-instance-container-vm.v1',
  scannedAt: new Date().toISOString(),
  scope: 'durable rows retained on the hosted target after the remote-streaming drill run: the host StreamAttemptV1 records plus the fixture app tables',
  needleClasses: {
    fixtureSecretCorpus: FIXTURE_SECRET_CORPUS,
    liveSecretClasses: liveSecretClasses.map((entry) => entry.class),
    upstreamMaterial: UPSTREAM_MATERIAL,
    markers: MARKERS,
  },
  tables,
  verdict: totalFindings === 0 ? 'PASS' : 'FAIL',
};

const outPath = requiredArg('out');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`);
if (totalFindings > 0) {
  console.error(`durable-row scan FAIL: ${totalFindings} finding(s)`);
  for (const table of tables) {
    for (const finding of table.findings) {
      console.error(`  ${table.table}: ${finding.kind} ${finding.class}`);
    }
  }
  process.exit(1);
}
console.log(`durable-row scan PASS: ${tables.map((t) => `${t.table}=${t.rowCount ?? '?'} rows`).join(', ')} -> ${outPath}`);
