#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ref LLP 0259#4-firstreadprofilev1--budget-the-bytes-the-carrier-sends —
// lane-local benchmark steering inventories every delivered carrier, applies
// content-hash deduplication, and enforces the hard aggregate/component caps.
export const MAX_LANE_STEERING_BYTES = 16 * 1024;
export const MAX_GENERATED_PACKET_BYTES = 6 * 1024;
export const MAX_SKILL_BODY_BYTES = 10 * 1024;
export const AGENTS_FILE = 'AGENTS.md';
export const ORIENTATION_FILE = 'BENCHMARK-ORIENTATION.md';
export const LANE_REPORT_FILE = 'lane-report.json';
export const FIRST_EDIT_MARKER_FILE = 'first-product-edit.json';
export const INSTRUMENT_LINK = 'instrument';
export const INSTRUMENT_MANIFEST_FILE = 'instrument.manifest.json';
export const OFF_ALLOWLIST_SKILL_CODE = 'BENCHMARK_PREFLIGHT_OFF_ALLOWLIST_SKILL';

export const LANE_KINDS = Object.freeze({
  'snapback-web-clique': Object.freeze({
    backend: 'Snapback',
    carrier: 'web',
    defaultSkills: Object.freeze(['snapback-authoring']),
  }),
  'snapback-native-simulator': Object.freeze({
    backend: 'Snapback',
    carrier: 'native-simulator',
    defaultSkills: Object.freeze(['snapback-authoring']),
  }),
  'competitor-web': Object.freeze({
    backend: 'Convex',
    carrier: 'web',
    defaultSkills: Object.freeze([]),
  }),
});

export const SKILL_REGISTRY = Object.freeze({
  'snapback-authoring': Object.freeze({ family: 'snapback-authoring' }),
  'expo-app-delivery': Object.freeze({
    family: 'device-eas-delivery',
    code: 'BENCHMARK_PREFLIGHT_OUT_OF_SCOPE_DEVICE_EAS_SKILL',
  }),
  'eas-app-delivery': Object.freeze({
    family: 'device-eas-delivery',
    code: 'BENCHMARK_PREFLIGHT_OUT_OF_SCOPE_DEVICE_EAS_SKILL',
  }),
  'ios-device-build': Object.freeze({
    family: 'device-eas-delivery',
    code: 'BENCHMARK_PREFLIGHT_OUT_OF_SCOPE_DEVICE_EAS_SKILL',
  }),
  'physical-device-delivery': Object.freeze({
    family: 'device-eas-delivery',
    code: 'BENCHMARK_PREFLIGHT_OUT_OF_SCOPE_DEVICE_EAS_SKILL',
  }),
  'native-delivery': Object.freeze({
    family: 'device-eas-delivery',
    code: 'BENCHMARK_PREFLIGHT_OUT_OF_SCOPE_DEVICE_EAS_SKILL',
  }),
  'tuft-app-builder': Object.freeze({
    family: 'generic-app-scaffold',
    code: 'BENCHMARK_PREFLIGHT_OUT_OF_SCOPE_GENERIC_APP_SCAFFOLD_SKILL',
  }),
  'generic-app-scaffold': Object.freeze({
    family: 'generic-app-scaffold',
    code: 'BENCHMARK_PREFLIGHT_OUT_OF_SCOPE_GENERIC_APP_SCAFFOLD_SKILL',
  }),
  'create-expo-app': Object.freeze({
    family: 'generic-app-scaffold',
    code: 'BENCHMARK_PREFLIGHT_OUT_OF_SCOPE_GENERIC_APP_SCAFFOLD_SKILL',
  }),
  'expo-app-builder': Object.freeze({
    family: 'generic-app-scaffold',
    code: 'BENCHMARK_PREFLIGHT_OUT_OF_SCOPE_GENERIC_APP_SCAFFOLD_SKILL',
  }),
});

const REQUIRED_INSTRUMENT_ARTIFACTS = Object.freeze({
  brief: 'file',
  contract: 'file',
  assertions: 'file',
  applicability: 'file',
  fixtureReadme: 'file',
  fixtureRoot: 'directory',
  uiRoot: 'directory',
  uiVersion: 'file',
  choreographyRoot: 'directory',
  choreographyVersion: 'file',
  schemaVersion: 'file',
  baseRunRecordSchema: 'file',
  runRecordSchema: 'file',
  runRecordExtensionSchema: 'file',
  recordValidator: 'file',
  meteringRoot: 'directory',
  observabilityRoot: 'directory',
});

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableUnique(values) {
  return [...new Set(values)];
}

function toLogicalPath(path) {
  return path.split(sep).join('/');
}

function markdownPath(path) {
  return path.replaceAll(' ', '%20');
}

function isWithin(root, path) {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function checkedSnapshotPath(root, logicalPath, label) {
  if (typeof logicalPath !== 'string' || logicalPath.length === 0 || isAbsolute(logicalPath)) {
    throw new Error(`${label} must have a non-empty snapshot-relative path`);
  }
  const candidate = resolve(root, logicalPath);
  if (!isWithin(root, candidate) || !existsSync(candidate)) {
    throw new Error(`${label} does not resolve within the frozen instrument snapshot: ${logicalPath}`);
  }
  const canonical = realpathSync(candidate);
  if (!isWithin(root, canonical)) {
    throw new Error(`${label} escapes the frozen instrument snapshot: ${logicalPath}`);
  }
  return canonical;
}

function directoryDigest(root, label) {
  const entries = [];
  const visit = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(directory, entry.name);
      const logical = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const status = lstatSync(absolute);
      if (status.isSymbolicLink()) {
        throw new Error(`${label} contains a symbolic link, which is forbidden in a frozen snapshot: ${logical}`);
      }
      if (status.isDirectory()) visit(absolute, logical);
      else if (status.isFile()) {
        const contents = readFileSync(absolute);
        entries.push(`${logical}\0${contents.byteLength}\0${sha256(contents)}\n`);
      } else {
        throw new Error(`${label} contains an unsupported filesystem entry: ${logical}`);
      }
    }
  };
  visit(root);
  return sha256(entries.join(''));
}

function artifactDigest(path, kind, label) {
  const status = statSync(path);
  if (kind === 'file' && !status.isFile()) throw new Error(`${label} must be a file`);
  if (kind === 'directory' && !status.isDirectory()) throw new Error(`${label} must be a directory`);
  return kind === 'file' ? sha256(readFileSync(path)) : directoryDigest(path, label);
}

export function resolveInstrumentArtifacts({ instrumentRoot, instrumentPin }) {
  if (!instrumentRoot) throw new Error('instrumentRoot is required');
  if (!instrumentPin) throw new Error('instrumentPin is required');
  const root = realpathSync(resolve(instrumentRoot));
  const manifestPath = checkedSnapshotPath(root, INSTRUMENT_MANIFEST_FILE, 'instrument manifest');
  const manifestContents = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestContents.toString('utf8'));
  if (manifest?.schemaVersion !== 'benchmark-instrument-snapshot.v1') {
    throw new Error("instrument manifest schemaVersion must be 'benchmark-instrument-snapshot.v1'");
  }
  if (manifest.instrumentPin !== instrumentPin) {
    throw new Error(`instrument pin mismatch: requested ${instrumentPin}, snapshot declares ${manifest.instrumentPin ?? 'none'}`);
  }
  const artifactNames = Object.keys(manifest.artifacts ?? {}).sort();
  const expectedNames = Object.keys(REQUIRED_INSTRUMENT_ARTIFACTS).sort();
  if (JSON.stringify(artifactNames) !== JSON.stringify(expectedNames)) {
    throw new Error(`instrument manifest artifacts must be exactly: ${expectedNames.join(', ')}`);
  }

  const artifacts = {};
  for (const [name, expectedKind] of Object.entries(REQUIRED_INSTRUMENT_ARTIFACTS)) {
    const descriptor = manifest.artifacts[name];
    if (descriptor?.kind !== expectedKind || !/^[a-f0-9]{64}$/u.test(descriptor?.sha256 ?? '')) {
      throw new Error(`instrument manifest artifact ${name} must declare kind ${expectedKind} and a sha256 digest`);
    }
    const path = checkedSnapshotPath(root, descriptor.path, `instrument artifact ${name}`);
    const actualDigest = artifactDigest(path, descriptor.kind, `instrument artifact ${name}`);
    if (actualDigest !== descriptor.sha256) {
      throw new Error(`instrument artifact ${name} digest mismatch at ${descriptor.path}`);
    }
    artifacts[name] = Object.freeze({
      path,
      logicalPath: toLogicalPath(descriptor.path),
      kind: descriptor.kind,
      sha256: actualDigest,
    });
  }

  const choreographyVersion = readFileSync(artifacts.choreographyVersion.path, 'utf8').trim();
  const schemaVersion = readFileSync(artifacts.schemaVersion.path, 'utf8').trim();
  const uiVersion = readFileSync(artifacts.uiVersion.path, 'utf8').trim();
  if (!choreographyVersion || choreographyVersion !== manifest.versions?.choreography) {
    throw new Error(`choreography VERSION mismatch: manifest declares ${manifest.versions?.choreography ?? 'none'}, snapshot contains ${choreographyVersion || 'empty'}`);
  }
  if (!schemaVersion || schemaVersion !== manifest.versions?.schema) {
    throw new Error(`schema VERSION mismatch: manifest declares ${manifest.versions?.schema ?? 'none'}, snapshot contains ${schemaVersion || 'empty'}`);
  }
  if (!uiVersion || uiVersion !== manifest.versions?.ui) {
    throw new Error(`UI VERSION mismatch: manifest declares ${manifest.versions?.ui ?? 'none'}, snapshot contains ${uiVersion || 'empty'}`);
  }
  if (!isWithin(artifacts.choreographyRoot.path, artifacts.choreographyVersion.path)) {
    throw new Error('choreography VERSION must resolve within choreographyRoot');
  }
  if (!isWithin(artifacts.uiRoot.path, artifacts.uiVersion.path)) {
    throw new Error('UI VERSION must resolve within uiRoot');
  }

  return Object.freeze({
    root,
    manifest: Object.freeze({
      path: manifestPath,
      logicalPath: INSTRUMENT_MANIFEST_FILE,
      sha256: sha256(manifestContents),
      instrumentPin,
      versions: Object.freeze({
        schema: schemaVersion,
        ui: uiVersion,
        choreography: choreographyVersion,
      }),
    }),
    ...artifacts,
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

function childArtifact(parent, name) {
  const path = resolve(parent.path, name);
  if (!isWithin(parent.path, path) || !existsSync(path)) {
    throw new Error(`instrument child is missing from ${parent.logicalPath}: ${name}`);
  }
  return {
    path,
    logicalPath: `${parent.logicalPath}/${toLogicalPath(name)}`,
  };
}

function artifactLink(label, artifact) {
  return `[${label}](${markdownPath(`${INSTRUMENT_LINK}/${artifact.logicalPath}`)}) (snapshot \`${artifact.logicalPath}\`)`;
}

function laneDefinition(laneKind) {
  const definition = LANE_KINDS[laneKind];
  if (!definition) {
    throw new Error(`laneKind is required and must be one of: ${Object.keys(LANE_KINDS).join(', ')}`);
  }
  return definition;
}

function formattedSkills(selectedSkills) {
  return selectedSkills.length === 0
    ? 'none'
    : selectedSkills.map((skill) => `\`${skill}\``).join(', ');
}

export function renderLaneAgents({ laneId, laneKind, profile, milestones, selectedSkills }) {
  laneDefinition(laneKind);
  const kindLines = {
    'snapback-web-clique': `- Web-only Expo Router Clique benchmark, milestones ${milestones.join(', ')}.\n- Snapback profile: \`${profile}\`; two-browser-context interaction proof.\n- Physical-device, Simulator, and EAS delivery workflows are out of scope.\n- Do not substitute a generic Expo, Tuft, or other scaffold for the pinned Snapback path.`,
    'snapback-native-simulator': `- Native-carrier Clique benchmark, milestones ${milestones.join(', ')}.\n- Snapback profile: \`${profile}\`; proof runs headlessly on iOS Simulator.\n- Use \`xcrun simctl\` screenshots; web choreography cannot replace simulator proof.\n- Physical-device and EAS delivery remain out of scope.`,
    'competitor-web': `- Web-only Expo Router competitor-control benchmark, milestones ${milestones.join(', ')}.\n- Convex profile: \`${profile}\`; two-browser-context interaction proof.\n- Snapback packages, Snapback authoring instructions, and Snapback source are out of scope.\n- Follow the frozen competitor lane and brief; do not substitute a Snapback scaffold.`,
  }[laneKind];
  return `# Benchmark lane start packet

This directory is lane \`${laneId}\` of kind \`${laneKind}\`. Before the first
product edit, read \`${ORIENTATION_FILE}\` once. It is the sole generated
benchmark orientation artifact; follow a linked detail only when its named
trigger occurs.

## Task classification

${kindLines}

## Skill route

The configured pre-edit skill allowlist is: ${formattedSkills(selectedSkills)}.
Only those skill IDs are in scope. The driver inventories their complete
installed or embedded bodies in \`${LANE_REPORT_FILE}\`; do not load any other
skill before the first product edit.

## Measurement boundary

The driver stamps \`${FIRST_EDIT_MARKER_FILE}\` immediately before the first
product edit. That explicit timestamp—not inferred file-change events—closes
orientation. Retain its byte and native-token snapshot separately from M1
authoring in \`${LANE_REPORT_FILE}\`.
`;
}

function scopeAndProof(laneKind, { profile, backendPin, scope, artifacts }) {
  if (laneKind === 'snapback-native-simulator') {
    return `- Build Clique for ${scope}, in order, as the native iOS Simulator lane.\n- Backend/profile: Snapback \`${profile}\`; package pin: \`${backendPin}\`.\n- Prove via headless \`xcrun simctl\` screenshots; contract: ${artifactLink('simulator.md', childArtifact(artifacts.choreographyRoot, 'simulator.md'))}.\n- Web/headless checks may support acceptance but cannot replace simulator UI proof.`;
  }
  if (laneKind === 'competitor-web') {
    return `- Build the competitor-control app for ${scope}, in order, as a web-only Expo Router lane.\n- Backend/profile: Convex \`${profile}\`; package pin: \`${backendPin}\`.\n- Interaction proof uses two browser contexts and the frozen choreography.\n- Do not use Snapback packages, Snapback guides, or a Snapback scaffold.`;
  }
  return `- Build Clique for ${scope}, in order, as a web-only Expo Router lane.\n- Backend/profile: Snapback \`${profile}\`; package pin: \`${backendPin}\`.\n- Interaction proof uses two browser contexts and the frozen choreography.\n- Device launch, Simulator proof, EAS delivery, and generic scaffold substitution are out of scope.`;
}

export function renderOrientation({
  laneId,
  laneKind,
  profile,
  milestones,
  backendPin,
  instrumentPin,
  selectedSkills,
  artifacts,
  assertionManifest,
  applicabilityManifest,
}) {
  laneDefinition(laneKind);
  const summaries = assertionSummary(assertionManifest, milestones);
  const fixture = (name) => childArtifact(artifacts.fixtureRoot, name);
  const scope = milestones.map((milestone) => `\`${milestone}\``).join(', ');
  const assertionRows = summaries.map(({ milestone, title, counts }) => (
    `| ${milestone} | ${title} | ${counts['suite-required']} | ${counts.choreo} | ${counts.grader} | ${counts.simulator} |`
  )).join('\n');
  const applicabilityVersion = applicabilityManifest.manifestVersion ?? 'unversioned';
  const proofLabel = laneKind === 'snapback-native-simulator' ? 'native simulator proof' : 'two-client web proof';

  return `# Benchmark orientation — ${laneId}

Generated for lane kind \`${laneKind}\`. All links use the lane-local
\`${INSTRUMENT_LINK}/\` snapshot link so their bytes stay stable across run
layouts; never resolve a missing item against a live checkout.

## Scope and contract

${scopeAndProof(laneKind, { profile, backendPin, scope, artifacts })}
- Instrument pin: \`${instrumentPin}\`; choreography: \`${artifacts.manifest.versions.choreography}\`; applicability: \`${applicabilityVersion}\`.
- Product behavior: ${artifactLink('social-messenger brief', artifacts.brief)}.
- Shared names, IDs, determinism, and fixture grammar: ${artifactLink('coordination contract', artifacts.contract)}.

## Assertion applicability

Map every in-scope \`suite-required\` assertion to a test. Choreography,
simulator, and grader assertions retain their declared executors. Details:
${artifactLink('assertions.json', artifacts.assertions)} and
${artifactLink('applicability.json', artifacts.applicability)}.

| Milestone | Scope | Suite | Choreo | Grader | Simulator |
| --- | --- | ---: | ---: | ---: | ---: |
${assertionRows}

## Fixture entrypoints

- Personas: ${artifactLink('personas.json', fixture('personas.json'))}.
- Replay grammar: ${artifactLink('action-schema.json', fixture('action-schema.json'))}; use the app's write path.
- Inputs: ${milestones.map((milestone) => artifactLink(`starter-${milestone.toLowerCase()}.log`, fixture(`starter-${milestone.toLowerCase()}.log`))).join(', ')}.
- Media: ${artifactLink('media/manifest.json', fixture('media/manifest.json'))}.
- UI kit: ${artifactLink('ui/', artifacts.uiRoot)}; preserve component contracts and \`sm-*\` vocabulary.
- ${proofLabel}: ${artifactLink('choreography/', artifacts.choreographyRoot)}.

## Required lane outputs

- \`run-log.md\`, \`coverage-manifest.json\`, and \`receipts/<milestone>/\`.
- \`diary.md\`, \`essay.md\`, and \`final-report.md\`.
- \`${LANE_REPORT_FILE}\`: preserve \`orientation\`; join the harness-native
  \`firstProductEdit\` snapshot and deterministic preflight warnings.
- \`${FIRST_EDIT_MARKER_FILE}\`: stamp immediately before the first product edit
  and pass it to the metering joiner.

## Start now

Skill allowlist: ${formattedSkills(selectedSkills)}. Create \`run-log.md\`,
record the M1 boundary, scaffold only the \`${laneKind}\` path, and make the
first product edit. Open linked detail only for its assertion, fixture, or a
structured refusal.
`;
}

export function classifyOutOfScopeSkill(skill, { allowedSkillIds = [] } = {}) {
  if (new Set(allowedSkillIds).has(skill)) return null;
  const metadata = SKILL_REGISTRY[skill];
  if (!metadata) return null;
  return { family: metadata.family, code: metadata.code ?? OFF_ALLOWLIST_SKILL_CODE };
}

export function preflightSelectedSkills(loadedSkills, {
  allowedSkillIds = [],
  laneKind = 'snapback-web-clique',
} = {}) {
  return stableUnique(loadedSkills).flatMap((skill) => {
    const classification = classifyOutOfScopeSkill(skill, { allowedSkillIds });
    if (!classification) return [];
    return [{
      ...classification,
      skill,
      milestone: 'M1',
      severity: 'warning',
      message: `${skill} is registered as ${classification.family} and is not in the ${laneKind} lane allowlist`,
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

function parsedTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventTimestamp(event) {
  const candidates = [
    event?.at,
    event?.timestamp,
    event?.createdAt,
    event?.time,
    event?.ts,
    event?.item?.at,
    event?.item?.timestamp,
  ];
  for (const candidate of candidates) {
    const parsed = parsedTimestamp(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function analyzePreM1Events(events, { firstEditAt, allowedSkillIds, laneKind }) {
  const boundary = parsedTimestamp(firstEditAt);
  if (boundary === null) throw new TypeError('firstEditAt must be an RFC 3339 timestamp');
  const selectedSkills = [];
  for (const event of events) {
    const loaded = skillsLoadedByEvent(event);
    if (loaded.length === 0) continue;
    const timestamp = eventTimestamp(event);
    if (timestamp === null) {
      throw new Error(`skill-load event lacks a timestamp: ${loaded.join(', ')}`);
    }
    if (timestamp <= boundary) selectedSkills.push(...loaded);
  }
  const skills = stableUnique(selectedSkills);
  return {
    selectedSkills: skills,
    firstProductEdit: { at: firstEditAt, source: 'explicit-marker' },
    warnings: preflightSelectedSkills(skills, { allowedSkillIds, laneKind }),
  };
}

export function createFirstProductEditMarker(orientation, at, laneRunId) {
  if (typeof laneRunId !== 'string' || laneRunId.length === 0) {
    throw new TypeError('first product edit marker laneRunId must be a non-empty string');
  }
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
    laneRunId,
    at,
    orientationBytes: orientation.deliveredBytes,
    selectedSkills: [...orientation.selectedSkills],
  };
}

function sameArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
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

function normalizeSkillCarriers(skillCarriers, selectedSkills) {
  const selected = new Set(selectedSkills);
  const counts = new Map();
  const normalized = skillCarriers.map((carrier) => {
    if (!carrier || typeof carrier.skillId !== 'string' || typeof carrier.path !== 'string') {
      throw new Error('each skill carrier must declare skillId and path');
    }
    if (!selected.has(carrier.skillId)) {
      throw new Error(`skill carrier ${carrier.skillId} is not in the configured lane allowlist`);
    }
    const contents = readFileSync(resolve(carrier.path));
    if (contents.byteLength > MAX_SKILL_BODY_BYTES) {
      throw new Error(`skill body ${carrier.skillId} is ${contents.byteLength} bytes; maximum is ${MAX_SKILL_BODY_BYTES}`);
    }
    const occurrence = (counts.get(carrier.skillId) ?? 0) + 1;
    counts.set(carrier.skillId, occurrence);
    return {
      id: `skill:${carrier.skillId}:${occurrence}`,
      kind: 'skill-body',
      path: carrier.logicalPath ?? `skills/${carrier.skillId}/SKILL.md`,
      bytes: contents.byteLength,
      sha256: sha256(contents),
    };
  });
  for (const skill of selectedSkills) {
    if (!counts.has(skill)) {
      throw new Error(`selected skill ${skill} has no --skill-body steering carrier`);
    }
  }
  return normalized;
}

function steeringInventory(agents, orientation, skillCarriers) {
  const carriers = [
    { id: 'lane-agents', kind: 'lane-packet', path: AGENTS_FILE, bytes: byteLength(agents), sha256: sha256(agents) },
    { id: 'benchmark-orientation', kind: 'orientation', path: ORIENTATION_FILE, bytes: byteLength(orientation), sha256: sha256(orientation) },
    ...skillCarriers,
  ];
  const seen = new Set();
  let uniqueBytes = 0;
  const artifacts = carriers.map((carrier) => {
    const deduplicated = seen.has(carrier.sha256);
    if (!deduplicated) {
      seen.add(carrier.sha256);
      uniqueBytes += carrier.bytes;
    }
    return { ...carrier, deduplicated };
  });
  return { artifacts, uniqueBytes, deliveredBytes: uniqueBytes };
}

function ensureInstrumentLink(laneDir, instrumentRoot, canonicalRoot) {
  const linkPath = join(laneDir, INSTRUMENT_LINK);
  let status = null;
  try {
    status = lstatSync(linkPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (status !== null) {
    if (!status.isSymbolicLink()) {
      throw new Error(`${INSTRUMENT_LINK} must be a symbolic link to the frozen instrument snapshot`);
    }
    if (realpathSync(linkPath) !== canonicalRoot) {
      throw new Error(`${INSTRUMENT_LINK} symbolic link does not resolve to the frozen instrument snapshot`);
    }
    return;
  }
  symlinkSync(relative(laneDir, resolve(instrumentRoot)) || '.', linkPath, 'dir');
}

function initialFirstProductEdit() {
  return {
    at: null,
    orientationBytes: null,
    orientationTokens: { input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null },
    selectedSkills: [],
  };
}

export function generateLaneSetup({
  laneDir,
  laneId,
  laneKind,
  instrumentRoot,
  profile,
  milestones = ['M1', 'M2', 'M3'],
  backendPin,
  instrumentPin,
  selectedSkills,
  skillCarriers = [],
}) {
  if (!laneDir) throw new Error('laneDir is required');
  if (!laneId) throw new Error('laneId is required');
  const definition = laneDefinition(laneKind);
  if (!profile) throw new Error('profile is required');
  if (!backendPin) throw new Error('backendPin is required');
  const target = resolve(laneDir);
  const skills = stableUnique(selectedSkills ?? definition.defaultSkills);
  const artifacts = resolveInstrumentArtifacts({ instrumentRoot, instrumentPin });
  const assertionManifest = JSON.parse(readFileSync(artifacts.assertions.path, 'utf8'));
  const applicabilityManifest = JSON.parse(readFileSync(artifacts.applicability.path, 'utf8'));

  const agents = renderLaneAgents({ laneId, laneKind, profile, milestones, selectedSkills: skills });
  const orientation = renderOrientation({
    laneId,
    laneKind,
    profile,
    milestones,
    backendPin,
    instrumentPin,
    selectedSkills: skills,
    artifacts,
    assertionManifest,
    applicabilityManifest,
  });
  const generatedBytes = byteLength(agents) + byteLength(orientation);
  if (generatedBytes > MAX_GENERATED_PACKET_BYTES) {
    throw new Error(`generated lane packet is ${generatedBytes} bytes; maximum is ${MAX_GENERATED_PACKET_BYTES}`);
  }
  const normalizedSkillCarriers = normalizeSkillCarriers(skillCarriers, skills);
  const inventory = steeringInventory(agents, orientation, normalizedSkillCarriers);
  if (inventory.deliveredBytes > MAX_LANE_STEERING_BYTES) {
    throw new Error(`lane steering is ${inventory.deliveredBytes} bytes; maximum is ${MAX_LANE_STEERING_BYTES}`);
  }

  const orientationRecord = {
    schemaVersion: 'benchmark-orientation.v1',
    laneKind,
    instrument: {
      pin: artifacts.manifest.instrumentPin,
      manifest: { path: artifacts.manifest.logicalPath, sha256: artifacts.manifest.sha256 },
      versions: artifacts.manifest.versions,
    },
    selectedSkills: skills,
    artifacts: inventory.artifacts,
    uniqueBytes: inventory.uniqueBytes,
    deliveredBytes: inventory.deliveredBytes,
    preflightWarnings: [],
  };
  const report = `${JSON.stringify({
    schemaVersion: 'benchmark-lane-report.v1',
    laneId,
    orientation: orientationRecord,
    firstProductEdit: initialFirstProductEdit(),
  }, null, 2)}\n`;

  mkdirSync(target, { recursive: true });
  ensureInstrumentLink(target, instrumentRoot, artifacts.root);
  writeGenerated(join(target, AGENTS_FILE), agents);
  writeGenerated(join(target, ORIENTATION_FILE), orientation);
  writeGenerated(join(target, LANE_REPORT_FILE), report);
  return { laneDir: target, files: [AGENTS_FILE, ORIENTATION_FILE, LANE_REPORT_FILE], orientation: orientationRecord };
}

function joinedWarnings(existing, detected) {
  const byIdentity = new Map();
  for (const warning of [...existing, ...detected]) {
    byIdentity.set(`${warning.code}\0${warning.skill}`, warning);
  }
  return [...byIdentity.values()].sort((left, right) => (
    left.code.localeCompare(right.code) || left.skill.localeCompare(right.skill)
  ));
}

export function retainPreflightWarnings(reportPath, warnings) {
  const absolute = resolve(reportPath);
  const report = JSON.parse(readFileSync(absolute, 'utf8'));
  if (!Array.isArray(report?.orientation?.preflightWarnings)) {
    throw new Error('lane report has no orientation.preflightWarnings array');
  }
  const retained = joinedWarnings(report.orientation.preflightWarnings, warnings);
  report.orientation.preflightWarnings = retained;
  const contents = `${JSON.stringify(report, null, 2)}\n`;
  if (readFileSync(absolute, 'utf8') !== contents) {
    const temporary = `${absolute}.preflight-update`;
    writeFileSync(temporary, contents, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, absolute);
  }
  return retained;
}

function parseSkillBody(value) {
  const separator = value?.indexOf('=') ?? -1;
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error('--skill-body must be <registered-skill-id>=<path>');
  }
  return { skillId: value.slice(0, separator), path: value.slice(separator + 1) };
}

function parseArguments(argv) {
  const [command = 'setup', ...rest] = argv;
  if (!['setup', 'preflight', 'mark-first-edit'].includes(command)) {
    throw new Error(`unknown command ${command}; expected setup, preflight, or mark-first-edit`);
  }
  const options = { command, milestones: ['M1', 'M2', 'M3'], selectedSkills: [], skillCarriers: [], skillsSpecified: false };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    const value = rest[index + 1];
    if (argument === '--lane-dir') options.laneDir = value;
    else if (argument === '--lane-id') options.laneId = value;
    else if (argument === '--lane-kind') options.laneKind = value;
    else if (argument === '--instrument-root') options.instrumentRoot = value;
    else if (argument === '--profile') options.profile = value;
    else if (argument === '--backend-pin') options.backendPin = value;
    else if (argument === '--instrument-pin') options.instrumentPin = value;
    else if (argument === '--milestones') options.milestones = value.split(',').map((item) => item.trim());
    else if (argument === '--skill') {
      options.selectedSkills.push(value);
      options.skillsSpecified = true;
    } else if (argument === '--no-skills') {
      options.selectedSkills = [];
      options.skillsSpecified = true;
      index -= 1;
    } else if (argument === '--skill-body') options.skillCarriers.push(parseSkillBody(value));
    else if (argument === '--events') options.events = value;
    else if (argument === '--lane-report') options.laneReport = value;
    else if (argument === '--first-edit-marker') options.firstEditMarker = value;
    else if (argument === '--at') options.at = value;
    else if (argument === '--out') options.out = value;
    else throw new Error(`unknown argument ${argument}`);
    index += 1;
  }
  if (command === 'setup' && !options.skillsSpecified && options.laneKind) {
    options.selectedSkills = [...laneDefinition(options.laneKind).defaultSkills];
  }
  delete options.skillsSpecified;
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.command === 'setup') {
    const result = generateLaneSetup(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  if (options.command === 'mark-first-edit') {
    if (!options.laneReport) throw new Error('--lane-report is required for mark-first-edit');
    if (!options.laneId) throw new Error('--lane-id is required for mark-first-edit');
    if (!options.at) throw new Error('--at is required for mark-first-edit');
    const reportPath = resolve(options.laneReport);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    if (report.laneId !== options.laneId) {
      throw new Error('--lane-id must match lane-report.json laneId');
    }
    const marker = createFirstProductEditMarker(report.orientation, options.at, options.laneId);
    const outputPath = resolve(options.out ?? join(dirname(reportPath), FIRST_EDIT_MARKER_FILE));
    writeGenerated(outputPath, `${JSON.stringify(marker, null, 2)}\n`);
    const result = { outputPath, marker };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  if (!options.events) throw new Error('--events is required for preflight');
  if (!options.laneDir) throw new Error('--lane-dir is required for preflight');
  if (!options.laneReport) throw new Error('--lane-report is required for preflight');
  const reportPath = resolve(options.laneReport);
  if (reportPath !== resolve(options.laneDir, LANE_REPORT_FILE)) {
    throw new Error('--lane-report must name the lane directory lane-report.json');
  }
  const markerPath = resolve(options.firstEditMarker ?? join(options.laneDir, FIRST_EDIT_MARKER_FILE));
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const expectedMarker = createFirstProductEditMarker(report.orientation, marker.at, report.laneId);
  if (marker.laneRunId !== report.laneId) {
    throw new Error('first-edit marker laneRunId does not match the lane report');
  }
  if (
    marker.at !== expectedMarker.at
    || marker.orientationBytes !== expectedMarker.orientationBytes
    || !sameArray(marker.selectedSkills, expectedMarker.selectedSkills)
  ) {
    throw new Error('first-edit marker does not match the lane report orientation receipt');
  }
  const events = parseJsonLines(readFileSync(resolve(options.events), 'utf8'));
  const result = analyzePreM1Events(events, {
    firstEditAt: marker.at,
    allowedSkillIds: report.orientation.selectedSkills,
    laneKind: report.orientation.laneKind,
  });
  result.retainedWarnings = retainPreflightWarnings(reportPath, result.warnings);
  result.laneReport = reportPath;
  for (const warning of result.warnings) process.stderr.write(`[${warning.code}] ${warning.message}\n`);
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
