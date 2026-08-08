import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

import { fail } from './failure.mjs';
import {
  assertSupportedRequiredClaimFields,
  loadCommittedRecordInventory,
  loadRecordsFromPaths,
} from './record-loader.mjs';

const FAIRNESS_FIELDS = [
  'coldContext',
  'publishedSurfacesOnly',
  'sameModelAndEffort',
  'sameMachine',
  'counterbalancedSerial',
  'competitorWebDocs',
  'priorFamiliarity',
  'authParity',
];

const ACTION_CLASSES = new Set([
  'guide-reference-lookup',
  'package-source-read',
  'binary-string-excavation',
  'edit',
  'process-launch',
  'proof-command',
  'retry',
]);

const REDACTION_REASON_CODES = new Set([
  'PRIVATE_ORIGINAL',
  'PRIVATE_TOOL_ARGUMENT',
  'PRIVATE_TRANSCRIPT',
  'SECRET_PATTERN',
  'PII_EMAIL',
  'PII_PHONE',
  'PRIVATE_PATH',
  'MACHINE_IDENTIFIER',
]);

function trackedFiles(root) {
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) fail('GIT_INVENTORY_FAILED', result.stderr.trim() || 'git ls-files failed');
  return new Set(result.stdout.split('\0').filter(Boolean));
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail('INVALID_JSON', `${label} is not valid JSON: ${error.message}`);
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('DISCLOSURE_INCOMPLETE', `${label} must be an object`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail('DISCLOSURE_INCOMPLETE', `${label} must be a non-empty string`);
  }
  return value;
}

function isInside(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep));
}

function markdownAnchorExists(text, fragment) {
  const anchors = text
    .split(/\r?\n/)
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, '').trim().toLowerCase()
      .replace(/[`*_]/g, '')
      .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-'));
  return anchors.includes(fragment.toLowerCase());
}

function resolveJsonPointer(value, fragment) {
  if (fragment === '') return true;
  if (!fragment.startsWith('/')) return false;
  let current = value;
  for (const part of fragment.slice(1).split('/')) {
    const key = decodeURIComponent(part).replaceAll('~1', '/').replaceAll('~0', '~');
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) return false;
    current = current[key];
  }
  return true;
}

// @ref LLP 0197#the-standard — rule 12: every claim evidence pointer resolves before arithmetic renders.
export function resolveEvidencePointer({ root, pointer, committed }) {
  requireString(pointer, 'evidence pointer');
  const hash = pointer.indexOf('#');
  const file = hash === -1 ? pointer : pointer.slice(0, hash);
  const fragment = hash === -1 ? '' : pointer.slice(hash + 1);
  if (file.startsWith('/') || file.split('/').includes('..')) {
    fail('UNSAFE_EVIDENCE_POINTER', `${pointer}: pointer must be repository-relative`);
  }
  const absolute = resolve(root, file);
  if (!isInside(root, absolute)) fail('UNSAFE_EVIDENCE_POINTER', `${pointer}: pointer escapes repository`);
  if (committed && !committed.has(file)) {
    fail('UNCOMMITTED_EVIDENCE', `${pointer}: evidence is not committed`);
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    fail('MISSING_EVIDENCE', `${pointer}: evidence file does not resolve`);
  }
  if (fragment) {
    const text = readFileSync(absolute, 'utf8');
    let found = false;
    if (file.endsWith('.json')) {
      try {
        found = resolveJsonPointer(JSON.parse(text), fragment);
      } catch {
        found = false;
      }
    } else {
      found = markdownAnchorExists(text, fragment);
    }
    if (!found) fail('MISSING_EVIDENCE_FRAGMENT', `${pointer}: evidence fragment does not resolve`);
  }
  return absolute;
}

function validateSanitizedTrace({ root, pointer, committed, expectedSynthetic }) {
  const path = resolveEvidencePointer({ root, pointer, committed });
  const trace = readJson(path, pointer);
  assertObject(trace, pointer);
  const rootFields = new Set(['schemaVersion', 'synthetic', 'sanitizer', 'reviewRequired', 'invocations']);
  const unknownRootFields = Object.keys(trace).filter((field) => !rootFields.has(field));
  if (unknownRootFields.length > 0) {
    fail('PRIVATE_MATERIAL_IN_PUBLIC_TRACE', `${pointer}: unknown public trace field(s): ${unknownRootFields.join(', ')}`);
  }
  if (trace.schemaVersion !== 1 || trace.sanitizer !== 'llp0197-rule5-v1'
      || trace.reviewRequired !== true || !Array.isArray(trace.invocations)) {
    fail('INVALID_SANITIZED_TRACE', `${pointer}: expected the v1 sanitizer marker, reviewRequired true, and invocations[]`);
  }
  if (trace.synthetic !== expectedSynthetic) {
    fail('SYNTHETIC_LABEL_MISMATCH', `${pointer}: synthetic label differs from its machine record`);
  }
  if (trace.invocations.length === 0) {
    fail('INVALID_SANITIZED_TRACE', `${pointer}: sanitized trace must retain at least one invocation`);
  }
  const forbidden = new Set(['arguments', 'args', 'transcript', 'stdout', 'stderr', 'original']);
  for (const [index, invocation] of trace.invocations.entries()) {
    assertObject(invocation, `${pointer}: invocations[${index}]`);
    const invocationFields = new Set([
      'actionClass',
      'toolName',
      'timing',
      'resultStatus',
      'evidenceId',
      'integrityCommitment',
      'redactions',
    ]);
    const unknownInvocationFields = Object.keys(invocation)
      .filter((field) => !invocationFields.has(field));
    if (unknownInvocationFields.length > 0) {
      fail('PRIVATE_MATERIAL_IN_PUBLIC_TRACE', `${pointer}: invocations[${index}] has unknown field(s): ${unknownInvocationFields.join(', ')}`);
    }
    for (const field of forbidden) {
      if (Object.hasOwn(invocation, field)) {
        fail('PRIVATE_MATERIAL_IN_PUBLIC_TRACE', `${pointer}: invocations[${index}].${field} is forbidden`);
      }
    }
    if (!ACTION_CLASSES.has(invocation.actionClass)) {
      fail('INVALID_SANITIZED_TRACE', `${pointer}: invocations[${index}].actionClass is not normalized`);
    }
    requireString(invocation.toolName, `${pointer}: invocations[${index}].toolName`);
    requireString(invocation.timing?.startedAt, `${pointer}: invocations[${index}].timing.startedAt`);
    requireString(invocation.timing?.finishedAt, `${pointer}: invocations[${index}].timing.finishedAt`);
    const duration = Date.parse(invocation.timing.finishedAt) - Date.parse(invocation.timing.startedAt);
    if (Object.keys(invocation.timing).some((field) => !['startedAt', 'finishedAt', 'durationMs'].includes(field))) {
      fail('PRIVATE_MATERIAL_IN_PUBLIC_TRACE', `${pointer}: invocations[${index}].timing has unknown fields`);
    }
    if (!Number.isFinite(duration) || duration < 0 || invocation.timing.durationMs !== duration) {
      fail('INVALID_SANITIZED_TRACE', `${pointer}: invocations[${index}].timing is inconsistent`);
    }
    if (!['success', 'error', 'timeout', 'cancelled'].includes(invocation.resultStatus)) {
      fail('INVALID_SANITIZED_TRACE', `${pointer}: invocations[${index}].resultStatus is invalid`);
    }
    if (!/^ev_[a-f0-9]{32}$/.test(invocation.evidenceId ?? '')) {
      fail('INVALID_SANITIZED_TRACE', `${pointer}: invocations[${index}].evidenceId is not opaque`);
    }
    if (!/^hmac-sha256:[a-f0-9]{64}$/.test(invocation.integrityCommitment ?? '')) {
      fail('UNKEYED_INTEGRITY_COMMITMENT', `${pointer}: invocations[${index}] lacks an HMAC-SHA-256 commitment`);
    }
    if (!Array.isArray(invocation.redactions)) {
      fail('INVALID_SANITIZED_TRACE', `${pointer}: invocations[${index}].redactions must list reason codes`);
    }
    for (const redaction of invocation.redactions ?? []) {
      if (typeof redaction?.field !== 'string' || !REDACTION_REASON_CODES.has(redaction.reasonCode)
          || Object.keys(redaction).some((field) => !['field', 'reasonCode'].includes(field))) {
        fail('INVALID_SANITIZED_TRACE', `${pointer}: invocations[${index}] has an unknown redaction reason`);
      }
    }
  }
}

function validateManifest(manifest) {
  if (manifest.schemaVersion !== 1) fail('UNSUPPORTED_MANIFEST', 'manifest.schemaVersion must be 1');
  requireString(manifest.claimId, 'manifest.claimId');
  requireString(manifest.title, 'manifest.title');
  requireString(manifest.brief, 'manifest.brief');
  if (typeof manifest.synthetic !== 'boolean') {
    fail('DISCLOSURE_INCOMPLETE', 'manifest.synthetic must explicitly label synthetic status');
  }
  assertSupportedRequiredClaimFields(manifest.requiredClaimFields);
  if (!Array.isArray(manifest.recordFiles) || manifest.recordFiles.length === 0) {
    fail('NO_CLAIM_RECORDS', 'manifest.recordFiles must select at least one machine record');
  }
  const lanes = manifest.lanes;
  if (!Array.isArray(lanes) || lanes.length !== 2) {
    fail('UNSUPPORTED_COMPARISON', 'the initial checked publisher requires exactly two lane configurations');
  }
  const laneIds = new Set();
  for (const [index, lane] of lanes.entries()) {
    requireString(lane.id, `manifest.lanes[${index}].id`);
    requireString(lane.displayName, `manifest.lanes[${index}].displayName`);
    assertObject(lane.match, `manifest.lanes[${index}].match`);
    requireString(lane.match.lane, `manifest.lanes[${index}].match.lane`);
    if (laneIds.has(lane.id)) fail('DUPLICATE_LANE', `duplicate lane id ${lane.id}`);
    laneIds.add(lane.id);
  }
  const primary = assertObject(manifest.primaryComparison, 'manifest.primaryComparison');
  if (!laneIds.has(primary.subjectLaneId) || !laneIds.has(primary.controlLaneId)) {
    fail('INVALID_PRIMARY_COMPARISON', 'primary subject/control must name declared lane IDs');
  }
  if (primary.subjectLaneId === primary.controlLaneId) {
    fail('INVALID_PRIMARY_COMPARISON', 'primary subject and control must differ');
  }
  if (!Array.isArray(primary.metrics) || primary.metrics.length === 0
      || primary.metrics.some((metric) => !['wallClock', 'tokens'].includes(metric))) {
    fail('UNSUPPORTED_METRIC', 'primary metrics must select wallClock and/or tokens');
  }
  const policy = assertObject(primary.successPolicy, 'manifest.primaryComparison.successPolicy');
  if (!Number.isInteger(policy.expectedAttemptsPerLane) || policy.expectedAttemptsPerLane < 1) {
    fail('INVALID_SUCCESS_POLICY', 'expectedAttemptsPerLane must be a positive integer');
  }
  if (policy.minimumSuccessCount !== 3) {
    fail('INVALID_SUCCESS_POLICY', 'minimumSuccessCount must be the LLP 0197 floor of 3');
  }
  if (policy.minimumSuccessRate !== null
      && (typeof policy.minimumSuccessRate !== 'number'
        || policy.minimumSuccessRate < 0 || policy.minimumSuccessRate > 1)) {
    fail('INVALID_SUCCESS_POLICY', 'minimumSuccessRate must be null or a number from 0 to 1');
  }
  if (typeof policy.maximumSuccessRateDifference !== 'number'
      || policy.maximumSuccessRateDifference < 0 || policy.maximumSuccessRateDifference > 1) {
    fail('INVALID_SUCCESS_POLICY', 'maximumSuccessRateDifference must be a number from 0 to 1');
  }

  const disclosures = assertObject(manifest.disclosures, 'manifest.disclosures');
  const fairness = assertObject(disclosures.fairness, 'manifest.disclosures.fairness');
  for (const field of FAIRNESS_FIELDS) requireString(fairness[field], `manifest.disclosures.fairness.${field}`);
  const proofBar = assertObject(disclosures.proofBar, 'manifest.disclosures.proofBar');
  requireString(proofBar.statement, 'manifest.disclosures.proofBar.statement');
  if (typeof proofBar.equal !== 'boolean') fail('DISCLOSURE_INCOMPLETE', 'proofBar.equal must be boolean');
  const aid = assertObject(disclosures.aid, 'manifest.disclosures.aid');
  const versions = assertObject(disclosures.versionPinning, 'manifest.disclosures.versionPinning');
  for (const laneId of laneIds) {
    const proof = assertObject(proofBar.perLane?.[laneId], `proofBar.perLane.${laneId}`);
    requireString(proof.statement, `proofBar.perLane.${laneId}.statement`);
    if (!Array.isArray(proof.evidence) || proof.evidence.length === 0) {
      fail('DISCLOSURE_INCOMPLETE', `proofBar.perLane.${laneId}.evidence must not be empty`);
    }
    const laneAid = assertObject(aid.perLane?.[laneId], `aid.perLane.${laneId}`);
    if (!['bare-start', 'aid-assisted'].includes(laneAid.classification)) {
      fail('DISCLOSURE_INCOMPLETE', `aid.perLane.${laneId}.classification is invalid`);
    }
    requireString(laneAid.eligibilityPolicy, `aid.perLane.${laneId}.eligibilityPolicy`);
    if (!Array.isArray(laneAid.artifacts)) fail('DISCLOSURE_INCOMPLETE', `aid.perLane.${laneId}.artifacts must be an array`);
    if (laneAid.classification === 'aid-assisted' && laneAid.artifacts.length === 0) {
      fail('DISCLOSURE_INCOMPLETE', `aid-assisted lane ${laneId} must name its artifacts`);
    }
    for (const artifact of laneAid.artifacts) {
      requireString(artifact.name, `aid.perLane.${laneId}.artifact.name`);
      requireString(artifact.version, `aid.perLane.${laneId}.artifact.version`);
      requireString(artifact.source, `aid.perLane.${laneId}.artifact.source`);
    }
    const pin = assertObject(versions.perLane?.[laneId], `versionPinning.perLane.${laneId}`);
    requireString(pin.platform, `versionPinning.perLane.${laneId}.platform`);
    requireString(pin.version, `versionPinning.perLane.${laneId}.version`);
    assertObject(pin.environment, `versionPinning.perLane.${laneId}.environment`);
  }
  const machineClasses = [...laneIds]
    .map((laneId) => versions.perLane[laneId].environment.machineClass);
  if (machineClasses.some((value) => typeof value !== 'string' || value.length === 0)
      || new Set(machineClasses).size !== 1) {
    fail(
      'MACHINE_PIN_MISMATCH',
      'every lane must pin the same non-empty environment.machineClass',
    );
  }
  const review = assertObject(disclosures.humanReview, 'manifest.disclosures.humanReview');
  if (review.status !== 'approved') fail('HUMAN_REVIEW_MISSING', 'human disclosure review must be approved');
  requireString(review.reviewerRole, 'manifest.disclosures.humanReview.reviewerRole');
  requireString(review.reviewedAt, 'manifest.disclosures.humanReview.reviewedAt');
  if (!Number.isFinite(Date.parse(review.reviewedAt))) {
    fail('DISCLOSURE_INCOMPLETE', 'humanReview.reviewedAt must be an RFC 3339 timestamp');
  }
  requireString(review.evidence, 'manifest.disclosures.humanReview.evidence');
}

function exactPin(value, label) {
  requireString(value, label);
  if (/^(latest|next|canary|unknown|unrecorded|null|n\/?a)$/i.test(value) || /[~^*<>]/.test(value)) {
    fail('VERSION_NOT_PINNED', `${label} is a tag or range, not an exact version`);
  }
}

function matchLane(record, lane) {
  return Object.entries(lane.match).every(([field, expected]) => record[field] === expected);
}

function tokenTotal(record) {
  if (record.tokens.input === null || record.tokens.output === null) return null;
  return record.tokens.input + record.tokens.output;
}

function metricValue(record, metric) {
  if (metric === 'wallClock') return record.wallClock.totalSeconds;
  if (metric === 'tokens') return tokenTotal(record);
  fail('UNSUPPORTED_METRIC', `unsupported metric ${metric}`);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatNumber(value, digits = 3) {
  if (value === null) return 'null';
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}

function formatMetric(value, metric) {
  if (value === null) return 'null';
  return metric === 'wallClock' ? `${formatNumber(value)} s` : formatNumber(value);
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function validateCounterbalance(recordsByLane, lanes) {
  const laneCount = lanes.length;
  const repetitions = new Map();
  for (const [laneId, records] of recordsByLane) {
    for (const item of records) {
      const repetition = item.record.publication.repetition;
      const entries = repetitions.get(repetition) ?? [];
      entries.push({ laneId, position: item.record.publication.position });
      repetitions.set(repetition, entries);
    }
  }
  for (const [repetition, entries] of repetitions) {
    const positions = new Set(entries.map((entry) => entry.position));
    const laneIds = new Set(entries.map((entry) => entry.laneId));
    if (entries.length !== laneCount || positions.size !== laneCount || laneIds.size !== laneCount
        || [...positions].some((position) => position < 1 || position > laneCount)) {
      fail('ORDER_SCHEDULE_INVALID', `repetition ${repetition} does not place every lane exactly once`);
    }
  }
  for (const lane of lanes) {
    const counts = Array.from({ length: laneCount }, () => 0);
    for (const item of recordsByLane.get(lane.id)) counts[item.record.publication.position - 1] += 1;
    if (Math.max(...counts) - Math.min(...counts) > 1) {
      fail('ORDER_SCHEDULE_UNBALANCED', `${lane.id} position counts ${counts.join('/')} differ by more than one`);
    }
  }
}

function eligibility(recordsByLane, laneIds, policy, proofBarEqual) {
  const counts = Object.fromEntries(laneIds.map((laneId) => {
    const records = recordsByLane.get(laneId);
    return [laneId, records.filter((item) => item.record.publication.resultStatus === 'success').length];
  }));
  const rates = Object.fromEntries(laneIds.map((laneId) => [laneId, counts[laneId] / policy.expectedAttemptsPerLane]));
  const reasons = [];
  if (!proofBarEqual) reasons.push('UNEQUAL_PROOF_BAR');
  if (policy.expectedAttemptsPerLane < policy.minimumSuccessCount) reasons.push('N_BELOW_THREE');
  if (laneIds.some((laneId) => counts[laneId] < policy.minimumSuccessCount)) reasons.push('SUCCESS_COUNT_BELOW_THREE');
  if (policy.minimumSuccessRate === null) reasons.push('MISSING_SUCCESS_RATE_FLOOR');
  if (policy.minimumSuccessRate !== null
      && laneIds.some((laneId) => rates[laneId] < policy.minimumSuccessRate)) {
    reasons.push('SUCCESS_RATE_BELOW_FLOOR');
  }
  if (Math.max(...Object.values(rates)) - Math.min(...Object.values(rates))
      > policy.maximumSuccessRateDifference) {
    reasons.push('SUCCESS_RATE_DIFFERENCE_EXCEEDS_THRESHOLD');
  }
  return { eligible: reasons.length === 0, reasons, counts, rates };
}

function computeAggregates({ manifest, recordsByLane, eligibilityResult }) {
  const { subjectLaneId, controlLaneId, metrics } = manifest.primaryComparison;
  const output = {};
  for (const metric of metrics) {
    const byLane = {};
    for (const lane of manifest.lanes) {
      const successful = recordsByLane.get(lane.id)
        .filter((item) => item.record.publication.resultStatus === 'success');
      const values = successful.map((item) => metricValue(item.record, metric));
      if (eligibilityResult.eligible && values.some((value) => value === null)) {
        fail('CLAIM_METRIC_MISSING', `${lane.id}: successful ${metric} observations contain explicit null and cannot support a ratio`);
      }
      const measured = values.filter((value) => value !== null);
      byLane[lane.id] = {
        values,
        median: median(measured),
        min: measured.length === 0 ? null : Math.min(...measured),
        max: measured.length === 0 ? null : Math.max(...measured),
      };
    }
    let ratioOfMedians = null;
    let medianPairedRatio = null;
    let pairedRatios = [];
    if (eligibilityResult.eligible) {
      if (byLane[controlLaneId].median === 0) fail('ZERO_CONTROL_MEDIAN', `${metric}: control median is zero`);
      ratioOfMedians = byLane[subjectLaneId].median / byLane[controlLaneId].median;
      const controlByRepetition = new Map(recordsByLane.get(controlLaneId)
        .filter((item) => item.record.publication.resultStatus === 'success')
        .map((item) => [item.record.publication.repetition, metricValue(item.record, metric)]));
      pairedRatios = recordsByLane.get(subjectLaneId)
        .filter((item) => item.record.publication.resultStatus === 'success')
        .map((item) => {
          const repetition = item.record.publication.repetition;
          const subjectValue = metricValue(item.record, metric);
          const controlValue = controlByRepetition.get(repetition);
          if (controlValue === undefined || subjectValue === null || controlValue === null || controlValue === 0) {
            fail('PAIRED_AGGREGATION_INCOMPLETE', `${metric}: repetition ${repetition} lacks a nonzero successful pair`);
          }
          return { repetition, ratio: subjectValue / controlValue };
        });
      medianPairedRatio = median(pairedRatios.map((pair) => pair.ratio));
    }
    output[metric] = { byLane, ratioOfMedians, medianPairedRatio, pairedRatios };
  }
  return output;
}

function renderMarkdown({ manifest, recordsByLane, eligibilityResult, aggregates }) {
  const laneById = new Map(manifest.lanes.map((lane) => [lane.id, lane]));
  const subject = laneById.get(manifest.primaryComparison.subjectLaneId);
  const control = laneById.get(manifest.primaryComparison.controlLaneId);
  const lines = [
    '<!-- GENERATED by benchmarks/tools/publish.mjs; edit the records or manifest, never this arithmetic. -->',
    '',
    `# ${manifest.title}`,
    '',
    `Synthetic fixture: **${manifest.synthetic ? 'yes' : 'no'}**`,
    '',
  ];

  if (eligibilityResult.eligible) {
    lines.push('## Primary cost comparison', '');
    lines.push(`Primary convention: **${subject.displayName} ÷ ${control.displayName}**, ratio of lane medians. The median of paired repetition ratios is shown beside it.`, '');
  } else {
    lines.push('## Capability outcomes (headline)', '');
    lines.push(`Cost ratios are **omitted**: ${eligibilityResult.reasons.join(', ')}.`, '');
  }

  lines.push('| Lane | Successful / attempted | Success rate |', '|---|---:|---:|');
  for (const lane of manifest.lanes) {
    lines.push(`| ${escapeCell(lane.displayName)} | ${eligibilityResult.counts[lane.id]} / ${manifest.primaryComparison.successPolicy.expectedAttemptsPerLane} | ${formatNumber(eligibilityResult.rates[lane.id] * 100, 1)}% |`);
  }
  lines.push('');

  for (const metric of manifest.primaryComparison.metrics) {
    const aggregate = aggregates[metric];
    const title = metric === 'wallClock' ? 'Wall-clock' : 'Tokens';
    lines.push(`### ${title}`, '');
    if (eligibilityResult.eligible) {
      lines.push(
        '| Ratio of lane medians | Median of paired repetition ratios | Paired ratios by repetition |',
        '|---:|---:|---|',
        `| ${formatNumber(aggregate.ratioOfMedians)}x | ${formatNumber(aggregate.medianPairedRatio)}x | ${aggregate.pairedRatios.map((pair) => `r${pair.repetition}: ${formatNumber(pair.ratio)}x`).join('; ')} |`,
        '',
      );
    }
    lines.push('| Lane | Median | Range | Successful raw values |', '|---|---:|---:|---|');
    for (const lane of manifest.lanes) {
      const values = aggregate.byLane[lane.id];
      lines.push(`| ${escapeCell(lane.displayName)} | ${formatMetric(values.median, metric)} | ${formatMetric(values.min, metric)}–${formatMetric(values.max, metric)} | ${values.values.map((value) => formatMetric(value, metric)).join(', ')} |`);
    }
    lines.push('', `#### ${title} distribution chart`, '');
    const maximum = Math.max(...manifest.lanes.map((lane) => aggregate.byLane[lane.id].median ?? 0), 1);
    lines.push('| Lane | Median bar |', '|---|---|');
    for (const lane of manifest.lanes) {
      const value = aggregate.byLane[lane.id].median;
      const blocks = value === null ? 0 : Math.max(1, Math.round((value / maximum) * 20));
      lines.push(`| ${escapeCell(lane.displayName)} | ${value === null ? 'unmeasured' : `${'█'.repeat(blocks)} ${formatMetric(value, metric)}`} |`);
    }
    lines.push('');
  }

  lines.push('## All attempt values', '');
  lines.push('| Lane | Repetition | Attempt | Outcome | Wall | Tokens | Record + digest | Proof evidence | Sanitized trace |', '|---|---:|---|---|---:|---:|---|---|---|');
  for (const lane of manifest.lanes) {
    for (const item of recordsByLane.get(lane.id)) {
      const publication = item.record.publication;
      lines.push(`| ${escapeCell(lane.displayName)} | ${publication.repetition} | ${escapeCell(publication.attemptId)} | ${publication.resultStatus} | ${formatMetric(item.record.wallClock.totalSeconds, 'wallClock')} | ${formatMetric(tokenTotal(item.record), 'tokens')} | \`${item.file}\`<br>\`${item.record.recordDigest}\` | ${publication.proofEvidence.map((pointer) => `\`${pointer}\``).join(', ')} | \`${publication.sanitizedTrace}\` |`);
    }
  }
  lines.push('');

  lines.push('## Proof bar', '', manifest.disclosures.proofBar.statement, '');
  lines.push(`Equal proof bar: **${manifest.disclosures.proofBar.equal ? 'yes' : 'no'}**`, '');
  for (const lane of manifest.lanes) {
    const proof = manifest.disclosures.proofBar.perLane[lane.id];
    lines.push(`- ${lane.displayName}: ${proof.statement} (${proof.evidence.map((pointer) => `\`${pointer}\``).join(', ')})`);
  }
  lines.push('');

  lines.push('## Fairness notes', '');
  for (const field of FAIRNESS_FIELDS) lines.push(`- ${manifest.disclosures.fairness[field]}`);
  lines.push('');

  lines.push('## Aid and version disclosure', '');
  lines.push('| Lane | Aid class and artifacts | Exact platform version | Pinned environment |', '|---|---|---|---|');
  for (const lane of manifest.lanes) {
    const aid = manifest.disclosures.aid.perLane[lane.id];
    const pin = manifest.disclosures.versionPinning.perLane[lane.id];
    const artifacts = aid.artifacts.length === 0
      ? 'none'
      : aid.artifacts.map((artifact) => `${artifact.name}@${artifact.version} (${artifact.source})`).join('; ');
    lines.push(`| ${escapeCell(lane.displayName)} | ${aid.classification}; ${escapeCell(artifacts)}; eligibility: ${escapeCell(aid.eligibilityPolicy)} | ${escapeCell(pin.platform)} ${escapeCell(pin.version)} | ${escapeCell(Object.entries(pin.environment).sort().map(([key, value]) => `${key}=${value}`).join('; '))} |`);
  }
  lines.push('');

  const harness = recordsByLane.get(manifest.lanes[0].id)[0].record.harness;
  lines.push(`Harness pin: \`${harness.name}\`; model \`${harness.model}\`; effort \`${harness.effort ?? 'null'}\`.`, '');

  const review = manifest.disclosures.humanReview;
  lines.push('## Publication-safe evidence review', '');
  lines.push(`Approved ${review.reviewedAt} by role \`${review.reviewerRole}\`; evidence: \`${review.evidence}\`.`, '');
  return `${lines.join('\n')}\n`;
}

// @ref LLP 0197#the-standard — rule 12: this is the sole record-to-comparison arithmetic path.
export function buildCheckedPublication({ root, manifestPath, requireCommitted = true }) {
  if (manifestPath.startsWith('/') || manifestPath.split('/').includes('..')) {
    fail('UNSAFE_MANIFEST_PATH', 'manifest path must be repository-relative');
  }
  const committed = requireCommitted ? trackedFiles(root) : null;
  if (committed && !committed.has(manifestPath)) {
    fail('UNCOMMITTED_MANIFEST', `${manifestPath} is not committed`);
  }
  const manifest = readJson(resolve(root, manifestPath), manifestPath);
  validateManifest(manifest);

  let loaded;
  if (requireCommitted) {
    const inventory = loadCommittedRecordInventory({ root });
    const byFile = new Map(inventory.records.map((item) => [item.file, item]));
    const historicalByFile = new Map(inventory.historical.map((item) => [item.file, item]));
    loaded = manifest.recordFiles.map((file) => {
      const item = byFile.get(file);
      if (!item && historicalByFile.has(file)) {
        fail(
          'HISTORICAL_RECORD_NOT_CLAIMABLE',
          `${file}: missing ${historicalByFile.get(file).missingFields.join(', ')}`,
        );
      }
      if (!item) fail('UNCOMMITTED_RECORD', `${file} is not a committed machine record`);
      return item;
    });
  } else {
    loaded = loadRecordsFromPaths({ root, paths: manifest.recordFiles, requireCommitted: false });
  }

  const selected = new Set();
  const attemptIds = new Set();
  const recordsByLane = new Map(manifest.lanes.map((lane) => [lane.id, []]));
  for (const item of loaded) {
    if (selected.has(item.file)) fail('DUPLICATE_RECORD', `${item.file} appears more than once`);
    selected.add(item.file);
    const matches = manifest.lanes.filter((lane) => matchLane(item.record, lane));
    if (matches.length !== 1) fail('LANE_MATCH_FAILED', `${item.file} matches ${matches.length} lane configurations`);
    const lane = matches[0];
    if (item.record.brief !== manifest.brief) fail('BRIEF_MISMATCH', `${item.file}: expected brief ${manifest.brief}`);
    if (item.record.synthetic !== manifest.synthetic) fail('SYNTHETIC_LABEL_MISMATCH', `${item.file}: synthetic label differs from manifest`);
    if (!item.record.authParity?.posture || !item.record.authParity?.notes) {
      fail('FAIRNESS_DISCLOSURE_MISSING', `${item.file}: authParity posture and notes are required`);
    }
    for (const field of manifest.requiredClaimFields) {
      if (!Object.hasOwn(item.record, field)) fail('MISSING_REQUIRED_CLAIM_FIELD', `${item.file}: missing ${field}`);
    }
    if (item.record.publication.comparisonSet !== manifest.claimId) {
      fail('COMPARISON_SET_MISMATCH', `${item.file}: publication.comparisonSet does not match ${manifest.claimId}`);
    }
    if (attemptIds.has(item.record.publication.attemptId)) {
      fail('DUPLICATE_ATTEMPT_ID', `${item.file}: duplicate attemptId ${item.record.publication.attemptId}`);
    }
    attemptIds.add(item.record.publication.attemptId);
    recordsByLane.get(lane.id).push(item);
  }

  const harnessPins = new Set(loaded.map(({ record }) => JSON.stringify({
    name: record.harness.name,
    model: record.harness.model,
    effort: record.harness.effort,
  })));
  if (harnessPins.size !== 1) fail('HARNESS_MISMATCH', 'name, model, and effort must be identical across the comparison set');

  const policy = manifest.primaryComparison.successPolicy;
  for (const lane of manifest.lanes) {
    const records = recordsByLane.get(lane.id);
    records.sort((left, right) => left.record.publication.repetition - right.record.publication.repetition);
    if (records.length !== policy.expectedAttemptsPerLane) {
      fail('ATTEMPT_COUNT_MISMATCH', `${lane.id}: expected ${policy.expectedAttemptsPerLane}, found ${records.length}`);
    }
    const repetitions = new Set(records.map((item) => item.record.publication.repetition));
    if (repetitions.size !== records.length) fail('DUPLICATE_REPETITION', `${lane.id}: repetition IDs are not unique`);
    const pin = manifest.disclosures.versionPinning.perLane[lane.id];
    exactPin(pin.version, `versionPinning.perLane.${lane.id}.version`);
    if (!Object.values(pin.environment).includes(pin.version)) {
      fail('VERSION_PIN_MISMATCH', `${lane.id}: exact platform version must appear in the pinned environment`);
    }
    for (const [key, value] of Object.entries(pin.environment)) {
      requireString(value, `versionPinning.perLane.${lane.id}.environment.${key}`);
      for (const item of records) {
        if (item.record.harness.environment?.[key] !== value) {
          fail('VERSION_PIN_MISMATCH', `${item.file}: harness.environment.${key} does not equal ${value}`);
        }
      }
    }
    const aid = manifest.disclosures.aid.perLane[lane.id];
    for (const artifact of aid.artifacts) exactPin(artifact.version, `aid.perLane.${lane.id}.${artifact.name}.version`);
  }
  const repetitionSets = manifest.lanes.map((lane) => recordsByLane.get(lane.id)
    .map((item) => item.record.publication.repetition).join(','));
  if (new Set(repetitionSets).size !== 1) fail('PAIRED_REPETITIONS_MISMATCH', 'lanes do not share the same repetition IDs');
  validateCounterbalance(recordsByLane, manifest.lanes);

  for (const item of loaded) {
    resolveEvidencePointer({ root, pointer: item.record.diary, committed });
    for (const loop of item.record.correctionLoops) {
      resolveEvidencePointer({ root, pointer: loop.evidence, committed });
    }
    for (const pointer of item.record.publication.proofEvidence) {
      resolveEvidencePointer({ root, pointer, committed });
    }
    validateSanitizedTrace({
      root,
      pointer: item.record.publication.sanitizedTrace,
      committed,
      expectedSynthetic: item.record.synthetic,
    });
  }
  for (const lane of manifest.lanes) {
    for (const pointer of manifest.disclosures.proofBar.perLane[lane.id].evidence) {
      resolveEvidencePointer({ root, pointer, committed });
    }
  }
  resolveEvidencePointer({ root, pointer: manifest.disclosures.humanReview.evidence, committed });

  const eligibilityResult = eligibility(
    recordsByLane,
    manifest.lanes.map((lane) => lane.id),
    policy,
    manifest.disclosures.proofBar.equal,
  );
  const aggregates = computeAggregates({ manifest, recordsByLane, eligibilityResult });
  return {
    markdown: renderMarkdown({ manifest, recordsByLane, eligibilityResult, aggregates }),
    manifest,
    eligibility: eligibilityResult,
    aggregates,
  };
}
