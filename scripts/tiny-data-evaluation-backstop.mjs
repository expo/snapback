#!/usr/bin/env node

// LLP 0256's pre-clock D10 control. This check never promotes, withdraws, or
// rewrites a doorway. It verifies the Experimental/non-default freeze and
// stages only the one required repository issue when the clock expires.
// @ref LLP 0256#clock-and-missed-disposition-backstop

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const EVALUATION_ROOT = 'benchmarks/tiny-data-surface/v1';
const RECEIPT = `${EVALUATION_ROOT}/clock/publication-receipt.v1.json`;
const RAW_INDEX = `${EVALUATION_ROOT}/raw-record-index.v1.json`;
const DISPOSITION = `${EVALUATION_ROOT}/rulings/d10-disposition.v1.json`;
const DOORWAY_PIN = `${EVALUATION_ROOT}/preregistration/experimental-doorways.v1.json`;
const RECEIPT_SCHEMA = 'snapback.tiny-data-publication-clock.v1';
const RAW_INDEX_SCHEMA = 'snapback.tiny-data-raw-record-index.v1';
const DISPOSITION_SCHEMA = 'snapback.tiny-data-d10-disposition.v1';
const MISSED_CODE = 'SNAPBACK_DATA_SURFACE_D10_MISSED_DISPOSITION';
const INVALID_CODE = 'SNAPBACK_DATA_SURFACE_D10_CLOCK_INVALID';

const hasOnlyKeys = (value, keys) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.keys(value).every((key) => keys.includes(key))
);

const parseJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const iso = (value, field) => {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw new TypeError(`${field} must be a canonical UTC instant`);
  }
  return time;
};
const digest = (value) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const ensureInside = (root, path) => {
  const absolute = resolve(root, path);
  if (absolute === resolve(root) || !absolute.startsWith(`${resolve(root)}${sep}`)) {
    throw new TypeError(`path escapes repository: ${path}`);
  }
  return absolute;
};

function activeStop(receipt) {
  if (
    !hasOnlyKeys(receipt, [
      'schemaVersion',
      'publicationIdentity',
      'closureDigest',
      'publishedAt',
      'stopAt',
      'amendments',
    ])
    ||
    receipt?.schemaVersion !== RECEIPT_SCHEMA
    || typeof receipt.publicationIdentity !== 'string'
    || typeof receipt.closureDigest !== 'string'
    || !Array.isArray(receipt.amendments)
  ) throw new TypeError('publication receipt has the wrong closed shape');
  const publishedAt = iso(receipt.publishedAt, 'publishedAt');
  let stopAt = iso(receipt.stopAt, 'stopAt');
  if (stopAt !== publishedAt + (90 * 24 * 60 * 60 * 1_000)) {
    throw new TypeError('initial stopAt must be exactly 90 days after publishedAt');
  }
  for (const [index, amendment] of receipt.amendments.entries()) {
    if (
      !hasOnlyKeys(amendment, [
        'author',
        'commit',
        'reason',
        'eligibleConfigurationVersions',
        'recordedAt',
        'newStopAt',
      ])
      ||
      amendment?.author !== 'Charlie Cheever'
      || typeof amendment.commit !== 'string'
      || typeof amendment.reason !== 'string'
      || !Array.isArray(amendment.eligibleConfigurationVersions)
    ) throw new TypeError(`amendments[${index}] has the wrong closed shape`);
    const recordedAt = iso(amendment.recordedAt, `amendments[${index}].recordedAt`);
    const next = iso(amendment.newStopAt, `amendments[${index}].newStopAt`);
    if (recordedAt >= stopAt || recordedAt < publishedAt || next <= stopAt) {
      throw new TypeError(`amendments[${index}] is not prospective`);
    }
    stopAt = next;
  }
  return { publishedAt, stopAt };
}

function completeRounds(root, publishedAt) {
  const path = join(root, RAW_INDEX);
  if (!existsSync(path)) return [];
  const index = parseJson(path);
  if (index?.schemaVersion !== RAW_INDEX_SCHEMA || !Array.isArray(index.rounds)) {
    throw new TypeError('raw record index has the wrong closed shape');
  }
  return index.rounds.filter((round) => {
    if (
      typeof round?.roundId !== 'string'
      || typeof round?.configurationVersion !== 'string'
      || typeof round?.complete !== 'boolean'
      || typeof round?.qualified !== 'boolean'
    ) throw new TypeError('raw record index carries a malformed round');
    if (!round.complete || !round.qualified) return false;
    return iso(round.completedAt, `${round.roundId}.completedAt`) >= publishedAt;
  }).sort((left, right) => left.completedAt.localeCompare(right.completedAt));
}

function dispositionBefore(root, boundary) {
  const path = join(root, DISPOSITION);
  if (!existsSync(path)) return null;
  const disposition = parseJson(path);
  if (
    disposition?.schemaVersion !== DISPOSITION_SCHEMA
    || disposition.author !== 'Charlie Cheever'
    || !['promote', 'continue', 'revise', 'fold', 'withdraw'].includes(disposition.ruling)
    || typeof disposition.commit !== 'string'
  ) throw new TypeError('D10 disposition has the wrong closed shape');
  return iso(disposition.recordedAt, 'disposition.recordedAt') < boundary
    ? disposition
    : null;
}

function freezeViolations(root, pin) {
  if (
    pin?.schemaVersion !== 'snapback.tiny-data-experimental-doorways.v1'
    || !Array.isArray(pin.packages)
  ) throw new TypeError('experimental doorway pin has the wrong closed shape');
  const violations = [];
  for (const entry of pin.packages) {
    const manifest = parseJson(join(root, entry.manifest));
    if (entry.maturityField && manifest.snapback?.maturity !== 'Experimental') {
      violations.push(`${entry.manifest} maturity is not Experimental`);
    }
    for (const [subpath, expected] of Object.entries(entry.exports ?? {})) {
      if (JSON.stringify(manifest.exports?.[subpath]) !== JSON.stringify(expected)) {
        violations.push(`${entry.manifest} ${subpath} changed from its frozen doorway`);
      }
    }
    for (const forbidden of entry.forbiddenMetadata ?? []) {
      const segments = forbidden.split('.');
      let value = manifest;
      for (const segment of segments) value = value?.[segment];
      if (value !== undefined) violations.push(`${entry.manifest} gained forbidden ${forbidden}`);
    }
  }
  return violations;
}

function findTicket(issuesRoot, signature) {
  if (!existsSync(issuesRoot)) return null;
  const marker = `snapback-data-surface-d10-signature: ${signature}`;
  return readdirSync(issuesRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => join(issuesRoot, entry.name))
    .find((path) => readFileSync(path, 'utf8').includes(marker)) ?? null;
}

function stageTicket({ root, issuesRoot, receipt, rounds, boundary, signature, violations, date }) {
  const existing = findTicket(issuesRoot, signature);
  if (existing) return { path: existing, created: false };
  const path = join(issuesRoot, `${date.replaceAll('-', '')}-tiny-data-surface-d10-disposition.md`);
  if (existsSync(path)) throw new TypeError(`unrelated ticket already occupies ${relative(root, path)}`);
  mkdirSync(issuesRoot, { recursive: true });
  const choices = ['promote', 'continue', 'revise', 'fold', 'withdraw'];
  writeFileSync(path, `# Tiny data surface D10 disposition required

<!-- snapback-data-surface-d10-signature: ${signature} -->

- Verdict: \`${MISSED_CODE}\`
- Publication: \`${receipt.publicationIdentity}\`
- Closure: \`${receipt.closureDigest}\`
- Clock: \`${receipt.publishedAt}\` through \`${new Date(boundary).toISOString()}\`
- Complete qualified rounds: ${rounds.length}
- Raw index: [\`${RAW_INDEX}\`](../${RAW_INDEX})
- Doorway pin: [\`${DOORWAY_PIN}\`](../${DOORWAY_PIN})
- Freeze verification: ${violations.length === 0 ? 'Experimental/non-default doorways unchanged' : `VIOLATED — ${violations.join('; ')}`}

Charlie Cheever must record one ruling: ${choices.map((choice) => `\`${choice}\``).join(', ')}.
The backstop does not infer continuation. After disposition, record the ruling
under \`${EVALUATION_ROOT}/rulings/\`, add the resolution here, and move this
ticket to \`issues/closed/\`.
`);
  return { path, created: true };
}

export function runTinyDataEvaluationBackstop({
  root = ROOT,
  issuesDir = 'issues',
  now = new Date(),
  env = process.env,
} = {}) {
  try {
    const receiptPath = join(root, RECEIPT);
    if (!existsSync(receiptPath)) {
      return 0;
    }
    const receipt = parseJson(receiptPath);
    const clock = activeStop(receipt);
    const rounds = completeRounds(root, clock.publishedAt);
    const roundBoundary = rounds.length >= 3 ? iso(rounds[2].completedAt, 'third round') : Infinity;
    const boundary = Math.min(clock.stopAt, roundBoundary);
    const observedAt = now instanceof Date ? now.getTime() : Date.parse(now);
    if (!Number.isFinite(observedAt)) throw new TypeError('injected now is invalid');
    if (observedAt < boundary) {
      return 0;
    }
    if (dispositionBefore(root, boundary)) {
      console.log('[tiny-data-d10] DISPOSED: an author ruling was recorded before the active stop');
      return 0;
    }
    const pin = parseJson(join(root, DOORWAY_PIN));
    const violations = freezeViolations(root, pin);
    const signature = digest({
      code: MISSED_CODE,
      publicationIdentity: receipt.publicationIdentity,
      closureDigest: receipt.closureDigest,
      boundary: new Date(boundary).toISOString(),
      doorwayPin: digest(pin),
    });
    const issuesRoot = ensureInside(root, issuesDir);
    const ticket = stageTicket({
      root,
      issuesRoot,
      receipt,
      rounds,
      boundary,
      signature,
      violations,
      date: env.SNAPBACK_DATA_D10_TICKET_DATE ?? new Date(observedAt).toISOString().slice(0, 10),
    });
    console.error(
      `[tiny-data-d10] ${MISSED_CODE}: ${ticket.created ? 'FILED' : 'RETAINED'} `
        + `${relative(root, ticket.path)}`,
    );
    if (violations.length > 0) {
      console.error(`[tiny-data-d10] FREEZE VIOLATION: ${violations.join('; ')}`);
      return 2;
    }
    return 1;
  } catch (error) {
    console.error(`[tiny-data-d10] ${INVALID_CODE}: ${error?.message ?? error}`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runTinyDataEvaluationBackstop();
}
