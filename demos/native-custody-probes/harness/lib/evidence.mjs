import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative } from 'node:path';

export function utcRunTimestamp(now = new Date()) {
  return now.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
}

export function shortRunId() {
  return randomBytes(4).toString('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function jsonlFrame(value) {
  return `${JSON.stringify(canonical(value))}\n`;
}

function artifactName(name) {
  if (typeof name !== 'string' || name.length === 0 || basename(name) !== name) {
    throw new TypeError('evidence artifact names must be non-empty basenames');
  }
  return name;
}

export class EvidenceWriter {
  constructor({
    root,
    platform,
    now = new Date(),
    runId = shortRunId(),
    metadata = {},
  }) {
    if (!/^[a-z0-9]{4,16}$/u.test(runId)) {
      throw new TypeError('evidence runId must contain 4-16 lowercase letters or digits');
    }
    this.platform = platform;
    this.timestamp = utcRunTimestamp(now);
    this.runId = runId;
    this.base = `${this.timestamp}-${runId}-phase2-${platform}`;
    this.directory = join(root, this.base);
    this.jsonlPath = join(this.directory, `${this.base}.jsonl`);
    this.markdownPath = join(this.directory, `${this.base}.md`);
    this.metadata = { ...metadata, runId, runTimestampUtc: this.timestamp };
    this.records = [];
    mkdirSync(root, { recursive: true, mode: 0o700 });
    // A run directory is an evidence identity. Reusing it is always a refusal,
    // never permission to truncate or append to another run's artifacts.
    mkdirSync(this.directory, { recursive: false, mode: 0o700 });
    writeFileSync(this.jsonlPath, '', { flag: 'wx', mode: 0o600 });
  }

  pathFor(name) {
    return join(this.directory, artifactName(name));
  }

  writeArtifact(name, contents) {
    const path = this.pathFor(name);
    writeFileSync(path, contents, { flag: 'wx', mode: 0o600 });
    return path;
  }

  record(probe, step, { expected, observed, verdict, durationMs = null }) {
    const entry = Object.freeze({
      schemaVersion: 'snapback.native-custody-evidence.v1',
      runId: this.runId,
      platform: this.platform,
      probe,
      step,
      expected,
      observed,
      verdict,
      durationMs,
      at: new Date().toISOString(),
    });
    appendFileSync(this.jsonlPath, jsonlFrame(entry), { mode: 0o600 });
    this.records.push(entry);
    return entry;
  }

  setMetadata(values) { Object.assign(this.metadata, values); }

  renderFinal({ overallVerdict, failure = null }) {
    const lines = [
      `# LLP 0258 Phase 2 native custody — ${this.platform}`,
      '',
      `- Run: \`${this.base}\``,
      `- Overall verdict: **${overallVerdict}**`,
      '- Evidence schema: `snapback.native-custody-evidence.v1`',
    ];
    for (const [key, value] of Object.entries(this.metadata)) {
      lines.push(`- ${key}: ${typeof value === 'string' ? value : `\`${JSON.stringify(value)}\``}`);
    }
    if (failure !== null) lines.push(`- Failing probe: \`${failure}\``);
    lines.push('', '## Probe results', '', '| Probe | Step | Expected | Observed | Verdict |', '|---|---|---|---|---|');
    for (const record of this.records) {
      const expected = JSON.stringify(record.expected).replaceAll('|', '\\|');
      const observed = JSON.stringify(record.observed).replaceAll('|', '\\|');
      lines.push(`| ${record.probe} | ${record.step} | \`${expected}\` | \`${observed}\` | ${record.verdict} |`);
    }
    lines.push(
      '',
      '## Safety posture',
      '',
      '- Bearer and recovery-code literals cross only the one-shot in-memory scanner channel; evidence stores only public hashes/counts.',
      '- Every run artifact, including host/device logs and raw PNG bytes, is scanned before this final verdict is written.',
      '- Screenshot OCR is out of scope; screenshot state is verified from the app-rendered structural milestone report before capture.',
      '',
    );
    return `${lines.join('\n')}\n`;
  }

  finalize({ overallVerdict, failure = null, rendered = null }) {
    const contents = rendered ?? this.renderFinal({ overallVerdict, failure });
    writeFileSync(this.markdownPath, contents, { flag: 'wx', mode: 0o600 });
    return { jsonlPath: this.jsonlPath, markdownPath: this.markdownPath };
  }
}

function filesUnder(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files;
}

export function scanEvidenceForLeaks(root, {
  forbiddenLiterals = [],
  virtualFiles = [],
} = {}) {
  const findings = [];
  const exact = [...new Set(forbiddenLiterals)]
    .filter((value) => typeof value === 'string' && value.length > 0);
  const forbiddenField = /"(?:bearer|password|recoveryCodes?|token|authorization)"\s*:/giu;
  const candidates = [
    ...filesUnder(root).map((file) => ({ name: relative(root, file), bytes: readFileSync(file) })),
    ...virtualFiles.map(({ name, bytes }) => ({
      name: artifactName(name),
      bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes)),
    })),
  ];
  for (const { name, bytes } of candidates) {
    for (const literal of exact) {
      if (bytes.includes(Buffer.from(literal))) {
        findings.push({ file: name, kind: 'literal', sha256Only: false });
      }
    }
    if (/\.(?:md|jsonl|json|txt|log)$/u.test(name)) {
      const text = bytes.toString('utf8');
      for (const match of text.matchAll(forbiddenField)) {
        findings.push({ file: name, kind: 'forbidden-field', field: match[0].split('"')[1] });
      }
    }
  }
  return Object.freeze({ ok: findings.length === 0, findings: Object.freeze(findings) });
}
