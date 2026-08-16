import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';

export function calendarDate(now = new Date()) {
  return now.toISOString().slice(0, 10).replaceAll('-', '');
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

export class EvidenceWriter {
  constructor({ root, platform, date = calendarDate(), metadata = {} }) {
    this.platform = platform;
    this.date = date;
    this.directory = join(root, platform);
    this.base = `${date}-phase2-${platform}`;
    this.jsonlPath = join(this.directory, `${this.base}.jsonl`);
    this.markdownPath = join(this.directory, `${this.base}.md`);
    this.metadata = { ...metadata };
    this.records = [];
    mkdirSync(this.directory, { recursive: true });
    writeFileSync(this.jsonlPath, '', { mode: 0o600 });
  }

  record(probe, step, { expected, observed, verdict, durationMs = null }) {
    const entry = Object.freeze({
      schemaVersion: 'snapback.native-custody-evidence.v1',
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

  finalize({ overallVerdict, failure = null }) {
    const lines = [
      `# LLP 0258 Phase 2 native custody — ${this.platform}`,
      '',
      `- Date: ${this.date}`,
      `- Overall verdict: **${overallVerdict}**`,
      `- Evidence schema: \`snapback.native-custody-evidence.v1\``,
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
      '- Bearers are projected only as SHA-256 digests inside the app process.',
      '- Passwords and recovery codes are not written to this receipt or JSONL.',
      '- Screenshots show only public probe status and typed diagnostic codes.',
      '',
    );
    writeFileSync(this.markdownPath, `${lines.join('\n')}\n`, { mode: 0o600 });
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

export function scanEvidenceForLeaks(root, { forbiddenLiterals = [] } = {}) {
  const findings = [];
  const exact = forbiddenLiterals.filter((value) => typeof value === 'string' && value.length > 0);
  const forbiddenField = /"(?:bearer|password|recoveryCodes?|token|authorization)"\s*:/giu;
  for (const file of filesUnder(root)) {
    const bytes = readFileSync(file);
    for (const literal of exact) {
      if (bytes.includes(Buffer.from(literal))) {
        findings.push({ file: relative(root, file), kind: 'literal', sha256Only: false });
      }
    }
    if (/\.(?:md|jsonl|json|txt)$/u.test(file)) {
      const text = bytes.toString('utf8');
      for (const match of text.matchAll(forbiddenField)) {
        findings.push({ file: relative(root, file), kind: 'forbidden-field', field: match[0].split('"')[1] });
      }
    }
  }
  return Object.freeze({ ok: findings.length === 0, findings: Object.freeze(findings) });
}
