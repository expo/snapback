#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ref LLP 0259#4-firstreadprofilev1--budget-the-bytes-the-carrier-sends —
// lane-local benchmark steering is charged as delivered bytes and must remain
// below the same hard ceiling as a template start packet.
export const MAX_LANE_STEERING_BYTES = 16 * 1024;
export const AGENTS_FILE = 'AGENTS.md';
export const ORIENTATION_FILE = 'BENCHMARK-ORIENTATION.md';
export const LANE_REPORT_FILE = 'lane-report.json';
export const FIRST_EDIT_MARKER_FILE = 'first-product-edit.json';

export const DEFAULT_SELECTED_SKILLS = Object.freeze(['snapback-authoring']);

const REPORTING_PATHS = new Set([
  AGENTS_FILE,
  ORIENTATION_FILE,
  LANE_REPORT_FILE,
  FIRST_EDIT_MARKER_FILE,
  'run-log.md',
  'diary.md',
  'essay.md',
  'final-report.md',
]);

const OUT_OF_SCOPE_SKILL_FAMILIES = Object.freeze([
  {
    family: 'device-eas-delivery',
    code: 'BENCHMARK_PREFLIGHT_OUT_OF_SCOPE_DEVICE_EAS_SKILL',
    patterns: [
      /(^|[-_.])eas($|[-_.])/i,
      /physical[-_. ]?(phone|device)/i,
      /device[-_. ]?delivery/i,
      /expo[-_. ]?(app[-_. ]?)?delivery/i,
      /native[-_. ]?delivery/i,
    ],
  },
  {
    family: 'generic-app-scaffold',
    code: 'BENCHMARK_PREFLIGHT_OUT_OF_SCOPE_GENERIC_APP_SCAFFOLD_SKILL',
    patterns: [
      /(^|[-_.])tuft($|[-_.])/i,
      /generic[-_. ]?app/i,
      /app[-_. ]?scaffold/i,
      /create[-_. ]?expo[-_. ]?app/i,
      /expo[-_. ]?app[-_. ]?(build|builder|scaffold)/i,
    ],
  },
]);

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableUnique(values) {
  return [...new Set(values)];
}

function markdownPath(path) {
  return path.replaceAll(' ', '%20');
}

function displayPath(from, path) {
  const rel = relative(from, path);
  return rel.startsWith(`..${sep}`) || rel === '..' ? path : rel || '.';
}

function firstExisting(candidates, label) {
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`${label} is missing; checked: ${candidates.join(', ')}`);
  }
  return found;
}

export function resolveInstrumentArtifacts({ instrumentRoot, sourceRoot = instrumentRoot }) {
  const instrument = resolve(instrumentRoot);
  const source = resolve(sourceRoot);
  const choose = (label, ...paths) => firstExisting(paths.map((path) => resolve(path)), label);

  return Object.freeze({
    brief: choose(
      'social-messenger brief',
      join(instrument, 'social-messenger.md'),
      join(instrument, 'briefs/social-messenger.md'),
      join(source, 'benchmarks/briefs/social-messenger.md'),
    ),
    contract: choose(
      'social-messenger contract',
      join(instrument, 'CONTRACT.md'),
      join(instrument, 'tools/social-messenger/CONTRACT.md'),
      join(source, 'benchmarks/tools/social-messenger/CONTRACT.md'),
    ),
    assertions: choose(
      'assertion manifest',
      join(instrument, 'assertions.json'),
      join(instrument, 'schema/social-messenger/assertions.json'),
      join(source, 'benchmarks/schema/social-messenger/assertions.json'),
    ),
    applicability: choose(
      'applicability manifest',
      join(instrument, 'applicability.json'),
      join(instrument, 'schema/social-messenger/applicability.json'),
      join(source, 'benchmarks/schema/social-messenger/applicability.json'),
    ),
    fixtureReadme: choose(
      'fixture README',
      join(instrument, 'fixtures/README.md'),
      join(instrument, 'fixtures/social-messenger/README.md'),
      join(source, 'benchmarks/fixtures/social-messenger/README.md'),
    ),
    fixtureRoot: choose(
      'fixture root',
      join(instrument, 'fixtures'),
      join(instrument, 'fixtures/social-messenger'),
      join(source, 'benchmarks/fixtures/social-messenger'),
    ),
    uiRoot: choose(
      'UI kit root',
      join(instrument, 'ui'),
      join(instrument, 'tools/social-messenger/ui'),
      join(source, 'benchmarks/tools/social-messenger/ui'),
    ),
    choreographyRoot: choose(
      'choreography root',
      join(instrument, 'choreography'),
      join(instrument, 'tools/social-messenger/choreography'),
      join(source, 'benchmarks/tools/social-messenger/choreography'),
    ),
  });
}

function assertionSummary(assertionManifest, milestones) {
  return milestones.map((milestone) => {
    const record = assertionManifest.milestones?.[milestone];
    if (!record || !Array.isArray(record.assertions)) {
      throw new Error(`assertion manifest has no ${milestone} assertions`);
    }
    const counts = { 'suite-required': 0, choreo: 0, grader: 0, simulator: 0 };
    for (const assertion of record.assertions) {
      if (Object.hasOwn(counts, assertion.executor)) counts[assertion.executor] += 1;
    }
    return { milestone, title: record.title, counts };
  });
}

function artifactLink(laneDir, label, path) {
  return `[${label}](${markdownPath(displayPath(laneDir, path))})`;
}

export function renderLaneAgents({
  laneId,
  profile,
  milestones,
  selectedSkills,
}) {
  const skills = selectedSkills.map((skill) => `\`${skill}\``).join(', ');
  return `# Benchmark lane start packet

This directory is lane \`${laneId}\`. Before the first product edit, read
\`${ORIENTATION_FILE}\` once. It is the sole benchmark orientation artifact;
follow its links only when the named trigger occurs.

## Task classification

- Web-only Expo Router benchmark, milestones ${milestones.join(', ')}.
- Snapback profile: \`${profile}\`.
- No physical-device or delivery workflow is in scope.
- Do not substitute a generic Expo, Tuft, or other app scaffold for the pinned
  Snapback lane setup.

## Skill route

The only applicable skill set is: ${skills}. This lane packet is its bounded,
task-selected projection. Do not load device-delivery, EAS-delivery, or generic
app-scaffolding skill families. Use \`snapback guide <query>\` only after a
structured refusal, failed proof, or an unresolved fact not covered by the
orientation artifact.

## Measurement boundary

The harness records the first product edit. Edits to the generated steering
files and reporting files are not product edits. Keep pre-edit orientation
bytes and the first-edit usage snapshot in \`${LANE_REPORT_FILE}\`; milestone
authoring token counts start after that snapshot.
`;
}

export function renderOrientation({
  laneDir,
  laneId,
  profile,
  milestones,
  backendPin,
  instrumentPin,
  selectedSkills,
  artifacts,
  assertionManifest,
  applicabilityManifest,
}) {
  const summaries = assertionSummary(assertionManifest, milestones);
  const fixture = (name) => join(artifacts.fixtureRoot, name);
  const scope = milestones.map((milestone) => `\`${milestone}\``).join(', ');
  const assertionRows = summaries.map(({ milestone, title, counts }) => (
    `| ${milestone} | ${title} | ${counts['suite-required']} | ${counts.choreo} | ${counts.grader} | ${counts.simulator} |`
  )).join('\n');
  const applicabilityVersion = applicabilityManifest.manifestVersion ?? 'unversioned';

  return `# Benchmark orientation — ${laneId}

Generated by \`benchmarks/tools/lane-setup.mjs\`. This is the sole benchmark
orientation artifact. Read it once,
then begin product work. The links below are lookup entrypoints, not six
additional first reads.

## Scope and contract

- Build Clique for ${scope}, in order, as a web-only Expo Router lane.
- Backend/profile: \`${profile}\`; package pin: \`${backendPin}\`.
- Instrument pin: \`${instrumentPin}\`; applicability manifest:
  \`${applicabilityVersion}\`.
- The brief is authoritative for product behavior: ${artifactLink(laneDir, 'social-messenger brief', artifacts.brief)}.
- Shared names, test IDs, determinism, and fixture grammar come from
  ${artifactLink(laneDir, 'the coordination contract', artifacts.contract)}.
- Interaction proof is two browser contexts. Device launch, EAS delivery, and
  generic scaffold substitution are outside this lane.

## Assertion applicability

Every in-scope \`suite-required\` assertion must appear in the coverage
manifest. Choreography assertions are driven by the frozen two-client harness;
grader assertions remain independent. Details:
${artifactLink(laneDir, 'assertions.json', artifacts.assertions)} and
${artifactLink(laneDir, 'applicability.json', artifacts.applicability)}.

| Milestone | Scope | Suite | Choreo | Grader | Simulator |
| --- | --- | ---: | ---: | ---: | ---: |
${assertionRows}

## Fixture entrypoints

- Personas and credentials: ${artifactLink(laneDir, 'personas.json', fixture('personas.json'))}.
- Replay grammar: ${artifactLink(laneDir, 'action-schema.json', fixture('action-schema.json'))}; replay through the app's own write path.
- Milestone inputs: ${milestones.map((milestone) => artifactLink(laneDir, `starter-${milestone.toLowerCase()}.log`, fixture(`starter-${milestone.toLowerCase()}.log`))).join(', ')}.
- Media: ${artifactLink(laneDir, 'media/manifest.json', fixture('media/manifest.json'))}.
- UI kit: ${artifactLink(laneDir, 'ui/', artifacts.uiRoot)}. Keep component contracts and \`sm-*\` vocabulary unchanged.
- Two-client proof: ${artifactLink(laneDir, 'choreography/', artifacts.choreographyRoot)}; pass the app origin via \`CHOREO_BASE_URL\`.

## Required lane outputs

- \`run-log.md\` — timestamps, lookups, retries, corrections, and owned PIDs.
- \`coverage-manifest.json\` — every in-scope suite assertion mapped to a test.
- \`receipts/<milestone>/\` — suite and choreography receipts.
- \`diary.md\` — milestone-by-milestone build experience.
- \`essay.md\` — qualitative comparison written before metric tallying.
- \`final-report.md\` — milestones, proofs, pins, correction loops, and gaps.
- \`${LANE_REPORT_FILE}\` — machine report; preserve the generated
  \`orientation\` block and replace the top-level \`firstProductEdit\` seed
  with the metering joiner's harness-native snapshot.
- \`${FIRST_EDIT_MARKER_FILE}\` — the lane driver stamps this immediately
  before the first product edit; pass it to the metering joiner's
  \`--first-product-edit\` input.

## Start now

Applicable skill set: ${selectedSkills.map((skill) => `\`${skill}\``).join(', ')}.
Create \`run-log.md\`, record the start and M1 boundary, then scaffold only the
pinned Snapback path and make the first product edit. Escalate to linked detail
only when the relevant assertion, fixture, or refusal requires it.
`;
}

export function classifyOutOfScopeSkill(skill) {
  if (DEFAULT_SELECTED_SKILLS.includes(skill)) return null;
  for (const family of OUT_OF_SCOPE_SKILL_FAMILIES) {
    if (family.patterns.some((pattern) => pattern.test(skill))) {
      return { family: family.family, code: family.code };
    }
  }
  return null;
}

export function preflightSelectedSkills(selectedSkills) {
  return stableUnique(selectedSkills).flatMap((skill) => {
    const classification = classifyOutOfScopeSkill(skill);
    if (!classification) return [];
    return [{
      ...classification,
      skill,
      milestone: 'M1',
      severity: 'warning',
      message: `${skill} belongs to the out-of-scope ${classification.family} family for this web-only lane`,
    }];
  });
}

function commandFromEvent(event) {
  return event?.item?.command
    ?? event?.command
    ?? event?.tool_input?.command
    ?? event?.input?.command
    ?? null;
}

function explicitSkillFromEvent(event) {
  if (!['skill.loaded', 'benchmark.skill.loaded'].includes(event?.type)) return null;
  return event.skill ?? event.skillId ?? event.name ?? null;
}

export function skillsLoadedByEvent(event) {
  const explicit = explicitSkillFromEvent(event);
  if (explicit) return [explicit];
  const command = commandFromEvent(event);
  if (typeof command !== 'string' || !command.includes('SKILL.md')) return [];
  const skills = [];
  const expression = /(?:^|[\s'"`])[^\s'"`]*\/skills\/([^/\s'"`]+)\/SKILL\.md(?=$|[\s'"`])/g;
  for (const match of command.matchAll(expression)) skills.push(match[1]);
  return stableUnique(skills);
}

function normalizeChangedPath(path, laneDir) {
  if (typeof path !== 'string') return null;
  const absolute = isAbsolute(path) ? resolve(path) : resolve(laneDir, path);
  const rel = relative(resolve(laneDir), absolute);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel;
}

export function productEditsByEvent(event, laneDir) {
  const changes = event?.item?.changes ?? event?.changes ?? [];
  if (!Array.isArray(changes)) return [];
  return changes.flatMap((change) => {
    const path = normalizeChangedPath(change?.path, laneDir);
    if (!path || REPORTING_PATHS.has(path) || path.startsWith('receipts/')) return [];
    return [path];
  });
}

export function analyzePreM1Events(events, { laneDir }) {
  const selectedSkills = [];
  let firstProductEdit = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (firstProductEdit === null) {
      selectedSkills.push(...skillsLoadedByEvent(event));
      const edits = productEditsByEvent(event, laneDir);
      if (edits.length > 0) {
        firstProductEdit = { eventIndex: index, paths: edits };
      }
    }
  }
  const skills = stableUnique(selectedSkills);
  return {
    selectedSkills: skills,
    firstProductEdit,
    warnings: preflightSelectedSkills(skills),
  };
}

export function createFirstProductEditMarker(orientation, at) {
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) {
    throw new TypeError('first product edit marker at must be an RFC 3339 timestamp');
  }
  if (!Number.isInteger(orientation?.deliveredBytes) || orientation.deliveredBytes < 0) {
    throw new TypeError('orientation.deliveredBytes must be a non-negative integer');
  }
  if (!Array.isArray(orientation.selectedSkills)) {
    throw new TypeError('orientation.selectedSkills must be an array');
  }
  return {
    at,
    orientationBytes: orientation.deliveredBytes,
    selectedSkills: [...orientation.selectedSkills],
  };
}

function parseJsonLines(value) {
  return value.split(/\r?\n/).filter((line) => line.trim() !== '').map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`invalid JSONL at line ${index + 1}: ${error.message}`);
    }
  });
}

function writeGenerated(path, contents) {
  if (existsSync(path)) {
    const current = readFileSync(path, 'utf8');
    if (current !== contents) {
      throw new Error(`refusing to overwrite non-matching generated file: ${path}`);
    }
    return;
  }
  writeFileSync(path, contents, { encoding: 'utf8', flag: 'wx' });
}

export function generateLaneSetup({
  laneDir,
  laneId,
  instrumentRoot,
  sourceRoot = instrumentRoot,
  profile = 'snapback-explicit-v1',
  milestones = ['M1', 'M2', 'M3'],
  backendPin,
  instrumentPin,
  selectedSkills = DEFAULT_SELECTED_SKILLS,
}) {
  if (!laneId) throw new Error('laneId is required');
  if (!backendPin) throw new Error('backendPin is required');
  if (!instrumentPin) throw new Error('instrumentPin is required');
  if (!instrumentRoot) throw new Error('instrumentRoot is required');
  const target = resolve(laneDir);
  mkdirSync(target, { recursive: true });
  const skills = stableUnique(selectedSkills);
  const artifacts = resolveInstrumentArtifacts({ instrumentRoot, sourceRoot });
  const assertionManifest = JSON.parse(readFileSync(artifacts.assertions, 'utf8'));
  const applicabilityManifest = JSON.parse(readFileSync(artifacts.applicability, 'utf8'));

  const agents = renderLaneAgents({ laneId, profile, milestones, selectedSkills: skills });
  const orientation = renderOrientation({
    laneDir: target,
    laneId,
    profile,
    milestones,
    backendPin,
    instrumentPin,
    selectedSkills: skills,
    artifacts,
    assertionManifest,
    applicabilityManifest,
  });
  const deliveredBytes = byteLength(agents) + byteLength(orientation);
  if (deliveredBytes > MAX_LANE_STEERING_BYTES) {
    throw new Error(`lane steering is ${deliveredBytes} bytes; maximum is ${MAX_LANE_STEERING_BYTES}`);
  }

  const orientationRecord = {
    schemaVersion: 'benchmark-orientation.v1',
    selectedSkills: skills,
    artifacts: [
      { path: AGENTS_FILE, bytes: byteLength(agents), sha256: sha256(agents) },
      { path: ORIENTATION_FILE, bytes: byteLength(orientation), sha256: sha256(orientation) },
    ],
    uniqueBytes: deliveredBytes,
    deliveredBytes,
    preflightWarnings: preflightSelectedSkills(skills),
  };
  const firstProductEdit = {
    at: null,
    orientationBytes: null,
    orientationTokens: {
      input: null,
      output: null,
      cacheRead: null,
      cacheWrite: null,
      reasoning: null,
    },
    selectedSkills: [],
  };
  const report = `${JSON.stringify({
    schemaVersion: 'benchmark-lane-report.v1',
    laneId,
    orientation: orientationRecord,
    firstProductEdit,
  }, null, 2)}\n`;

  writeGenerated(join(target, AGENTS_FILE), agents);
  writeGenerated(join(target, ORIENTATION_FILE), orientation);
  writeGenerated(join(target, LANE_REPORT_FILE), report);
  return {
    laneDir: target,
    files: [AGENTS_FILE, ORIENTATION_FILE, LANE_REPORT_FILE],
    orientation: orientationRecord,
  };
}

function parseArguments(argv) {
  const [command = 'setup', ...rest] = argv;
  if (!['setup', 'preflight', 'mark-first-edit'].includes(command)) {
    throw new Error(`unknown command ${command}; expected setup, preflight, or mark-first-edit`);
  }
  const options = { command, milestones: ['M1', 'M2', 'M3'], selectedSkills: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    const value = rest[index + 1];
    if (argument === '--lane-dir') options.laneDir = value;
    else if (argument === '--lane-id') options.laneId = value;
    else if (argument === '--instrument-root') options.instrumentRoot = value;
    else if (argument === '--source-root') options.sourceRoot = value;
    else if (argument === '--profile') options.profile = value;
    else if (argument === '--backend-pin') options.backendPin = value;
    else if (argument === '--instrument-pin') options.instrumentPin = value;
    else if (argument === '--milestones') options.milestones = value.split(',').map((item) => item.trim());
    else if (argument === '--skill') options.selectedSkills.push(value);
    else if (argument === '--events') options.events = value;
    else if (argument === '--lane-report') options.laneReport = value;
    else if (argument === '--at') options.at = value;
    else if (argument === '--out') options.out = value;
    else throw new Error(`unknown argument ${argument}`);
    index += 1;
  }
  if (options.selectedSkills.length === 0) options.selectedSkills = [...DEFAULT_SELECTED_SKILLS];
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.command === 'setup') {
    const result = generateLaneSetup(options);
    for (const warning of result.orientation.preflightWarnings) {
      process.stderr.write(`[${warning.code}] ${warning.message}\n`);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  if (options.command === 'mark-first-edit') {
    if (!options.laneReport) throw new Error('--lane-report is required for mark-first-edit');
    if (!options.at) throw new Error('--at is required for mark-first-edit');
    const reportPath = resolve(options.laneReport);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const marker = createFirstProductEditMarker(report.orientation, options.at);
    const outputPath = resolve(options.out ?? join(dirname(reportPath), FIRST_EDIT_MARKER_FILE));
    writeGenerated(outputPath, `${JSON.stringify(marker, null, 2)}\n`);
    const result = { outputPath, marker };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  if (!options.events) throw new Error('--events is required for preflight');
  if (!options.laneDir) throw new Error('--lane-dir is required for preflight');
  const events = parseJsonLines(readFileSync(resolve(options.events), 'utf8'));
  const result = analyzePreM1Events(events, { laneDir: options.laneDir });
  for (const warning of result.warnings) {
    process.stderr.write(`[${warning.code}] ${warning.message}\n`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[BENCHMARK_LANE_SETUP_FAILED] ${error.message}\n`);
    process.exitCode = 1;
  }
}
