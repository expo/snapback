import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path";

import { validateJsonSchema } from "../lib/json-schema.mjs";
import { adaptClaudeSessionTree } from "./metering/adapters/claude-session.mjs";
import { adaptCodexSessionTree } from "./metering/adapters/codex-session.mjs";
import { adaptUnavailableFamily } from "./metering/adapters/unavailable.mjs";
import {
  inferCodexProductRoot,
  recoverCodexFileChanges,
} from "./metering/codex-native-evidence.mjs";
import {
  applyR2DriverV1TerminalCompatibility,
  bindFullJourneyAccountingValues,
  loadObservationCompatibility,
} from "./metering/manifest.mjs";
import {
  boundariesFromReceiptRecords,
  mergeBoundaryMaps,
  normalizeBoundaryMap,
} from "./metering/boundaries.mjs";
import { joinUsageToMilestones } from "./metering/joiner.mjs";
import { composeRunRecord } from "./metering/record-composer.mjs";
import {
  CURRENT_INSTRUMENT_PIN,
  CURRENT_TYPING_OBSERVATION_BOUNDARY_VERSION,
  OBSERVABILITY_BLOCKS,
  OBSERVATION_VERSION,
  observationLaneRunIdMatches,
  parseObservationJsonLines,
  projectMilestoneObservability,
  scorecardEligibility,
} from "./metering/observations.mjs";
import { parseJsonLines } from "./metering/jsonl.mjs";

const ATTEMPTED_STATUSES = new Set([
  "green",
  "capability-failure",
  "aborted",
]);
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const CURRENT_CHOREOGRAPHY_VERSION = "0.3.7-m8";
const PREVIOUS_INSTRUMENT_PIN = "social-messenger@0.3.3-m8";
const RETAINED_INSTRUMENT_PINS = new Set([
  PREVIOUS_INSTRUMENT_PIN,
  "social-messenger@0.3.4-m8",
  "social-messenger@0.3.6-m8",
]);
const RECEIPT_SCHEMA = JSON.parse(readFileSync(
  new URL("./choreography/receipts.schema.json", import.meta.url),
  "utf8",
));

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function inside(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function resolveArtifact(errors, artifactRoot, artifact, path) {
  if (!artifactRoot) {
    errors.push(`${path}: artifactRoot is required to resolve hash-linked evidence`);
    return null;
  }
  if (
    !artifact
    || typeof artifact !== "object"
    || typeof artifact.path !== "string"
    || artifact.path.length === 0
    || isAbsolute(artifact.path)
    || !SHA256.test(artifact.sha256 ?? "")
  ) {
    errors.push(`${path}: expected a relative path plus sha256:<lowercase hex>`);
    return null;
  }
  const absolute = resolve(artifactRoot, normalize(artifact.path));
  if (!inside(artifactRoot, absolute)) {
    errors.push(`${path}/path: artifact escapes the record evidence directory`);
    return null;
  }
  let contents;
  let canonical;
  try {
    if (lstatSync(absolute).isSymbolicLink()) throw new Error("symbolic links are forbidden");
    canonical = realpathSync(absolute);
    if (!inside(realpathSync(artifactRoot), canonical)) {
      throw new Error("canonical path escapes the record evidence directory");
    }
    if (!statSync(canonical).isFile()) throw new Error("not a file");
    contents = readFileSync(canonical);
  } catch (error) {
    errors.push(`${path}/path: cannot read retained artifact ${artifact.path}: ${error.message}`);
    return null;
  }
  const actual = sha256(contents);
  if (actual !== artifact.sha256) {
    errors.push(`${path}/sha256: digest mismatch; expected ${artifact.sha256}, received ${actual}`);
    return null;
  }
  return { absolute: canonical, contents, text: contents.toString("utf8") };
}

function retainedRelativeArtifact(errors, artifactRoot, relativePath, path) {
  if (
    !artifactRoot
    || typeof relativePath !== "string"
    || relativePath.length === 0
    || isAbsolute(relativePath)
  ) {
    errors.push(`${path}: expected a retained relative artifact path`);
    return null;
  }
  const absolute = resolve(artifactRoot, normalize(relativePath));
  if (!inside(artifactRoot, absolute)) {
    errors.push(`${path}: artifact escapes the record evidence directory`);
    return null;
  }
  try {
    if (lstatSync(absolute).isSymbolicLink()) throw new Error("symbolic links are forbidden");
    const canonical = realpathSync(absolute);
    if (!inside(realpathSync(artifactRoot), canonical)) throw new Error("canonical path escapes");
    if (!statSync(canonical).isFile()) throw new Error("not a file");
    const contents = readFileSync(canonical);
    return { contents, text: contents.toString("utf8"), sha256: sha256(contents) };
  } catch (error) {
    errors.push(`${path}: cannot read retained artifact ${relativePath}: ${error.message}`);
    return null;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function sameJson(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function parseArtifactJson(errors, loaded, path) {
  if (loaded === null) return null;
  try {
    return JSON.parse(loaded.text);
  } catch (error) {
    errors.push(`${path}: invalid JSON: ${error.message}`);
    return null;
  }
}

function physicalCurrentR2Identity(artifactRoot) {
  if (!artifactRoot) return false;
  // The retained native stream plus the R2 join manifest are physical campaign
  // identity. Treat malformed metadata as current-R2 too, so record-declared
  // versions cannot downgrade out of the complete replay validator.
  if (
    existsSync(resolve(artifactRoot, "events/codex-rollout.jsonl"))
    && existsSync(resolve(artifactRoot, "metering-manifest.json"))
  ) return true;
  for (const name of ["metering-manifest.json", "instrument.manifest.json"]) {
    try {
      const value = JSON.parse(readFileSync(resolve(artifactRoot, name), "utf8"));
      if (
        value?.driver?.id === "social-messenger-r2-native-cli-driver.v1"
        || value?.driver?.id === "social-messenger-full-journey-native-cli-driver.v1"
        || value?.instrumentPin === CURRENT_INSTRUMENT_PIN
        || /^2026-08-23-r2-published-0125\//u.test(value?.laneRunId ?? "")
      ) return true;
    } catch {
      // Absence is ordinary for legacy/additive records. The physical R2
      // identity above still routes malformed current evidence fail-closed.
    }
  }
  return false;
}

function codexCliVersion(errors, records, nativeSessionId, path) {
  const metadata = records.filter((record) => record?.type === "session_meta");
  const identities = new Set(metadata
    .map((record) => record?.payload?.id)
    .filter((value) => typeof value === "string"));
  if (identities.size !== 1 || !identities.has(nativeSessionId)) {
    errors.push(`${path}: native stream does not identify session ${nativeSessionId}`);
  }
  const versions = new Set(metadata
    .map((record) => record?.payload?.cli_version)
    .filter((value) => typeof value === "string" && value.length > 0));
  if (versions.size > 1) errors.push(`${path}: native stream has conflicting cli_version values`);
  return [...versions][0] ?? null;
}

// Current R2 provenance is a claim derived from the retained metering
// manifest, native rollout, original boundaries, and observations. Merely
// preserving a schema-shaped object is insufficient: every compatibility and
// native-version field is recomputed here. Extension-v2 records for older
// instrument pins retain their additive compatibility posture.
function validateCurrentMeteringProvenance(errors, record, extension, artifactRoot) {
  const path = "$/socialMessenger/meteringProvenance";
  const provenance = extension.meteringProvenance;
  if (!provenance || typeof provenance !== "object") {
    errors.push(`${path}: current instrument requires metering provenance`);
    return;
  }
  for (const field of ["manifest", "adapter", "observations", "recordBase"]) {
    if (!Object.hasOwn(provenance, field)) {
      errors.push(`${path}/${field}: current instrument requires this derived provenance field`);
    }
  }
  if (!Array.isArray(provenance.driver?.compatibilityEvents)) {
    errors.push(`${path}/driver/compatibilityEvents: current instrument requires an explicit array`);
  }
  const loadedManifest = resolveArtifact(errors, artifactRoot, provenance.manifest, `${path}/manifest`);
  const manifest = parseArtifactJson(errors, loadedManifest, `${path}/manifest`);
  if (manifest === null) return;
  requireEqual(
    errors,
    `${path}/manifestSha256`,
    provenance.manifestSha256,
    provenance.manifest?.sha256,
    "legacy manifest digest alias must equal the hash-bound manifest descriptor",
  );
  requireEqual(errors, `${path}/laneRunId`, provenance.laneRunId, manifest.laneRunId,
    "laneRunId must derive from the metering manifest");
  requireEqual(errors, `${path}/manifestVersion`, provenance.manifestVersion, manifest.manifestVersion,
    "manifestVersion must derive from the metering manifest");
  requireEqual(errors, `${path}/unavailableReason`, provenance.unavailableReason,
    manifest.unavailableReason ?? null, "unavailable reason must derive from the metering manifest");

  const loadedSessions = [];
  for (const [index, descriptor] of (manifest.sessions ?? []).entries()) {
    const sessionPath = `${path}/manifest/sessions/${index}`;
    const loaded = resolveArtifact(errors, artifactRoot, descriptor, sessionPath);
    if (loaded === null) continue;
    let records;
    try {
      records = parseJsonLines(loaded.text, descriptor.path);
    } catch (error) {
      errors.push(`${sessionPath}: invalid native stream: ${error.message}`);
      continue;
    }
    const nativeCliVersion = manifest.adapter === "codex"
      ? codexCliVersion(errors, records, descriptor.nativeSessionId, sessionPath)
      : null;
    loadedSessions.push({
      ...descriptor,
      records,
      nativeCliVersion,
      resolvedSha256: descriptor.sha256,
    });
  }
  const expectedSessions = loadedSessions.map((session) => ({
    sourceId: session.sourceId,
    parentSourceId: session.parentSourceId,
    role: session.role,
    nativeSessionId: session.nativeSessionId,
    nativeAgentId: session.nativeAgentId ?? null,
    nativeCliVersion: session.nativeCliVersion,
    path: session.path,
    sha256: session.resolvedSha256,
  }));
  if (!sameJson(provenance.sessions, expectedSessions)) {
    errors.push(`${path}/sessions: current native identities, nativeCliVersion, and digests must be re-derived from the manifest and streams`);
  }

  let channel = null;
  try {
    if (manifest.adapter === "codex") channel = adaptCodexSessionTree(loadedSessions);
    else if (manifest.adapter === "claude") channel = adaptClaudeSessionTree(loadedSessions);
    else if (manifest.adapter === "unavailable") {
      channel = adaptUnavailableFamily(manifest.capFamily, manifest.unavailableReason);
    }
  } catch (error) {
    errors.push(`${path}/adapter: native adapter replay failed: ${error.message}`);
  }
  if (channel !== null) {
    const expectedAdapter = {
      id: channel.adapter,
      version: channel.adapterVersion,
      compatibilityEvents: channel.compatibilityEvents ?? [],
    };
    if (!sameJson(provenance.adapter, expectedAdapter)) {
      errors.push(`${path}/adapter: identity and compatibilityEvents must equal native adapter replay`);
    }
  }

  const observationEvents = [];
  const observationsBySource = new Map();
  const expectedObservations = [];
  for (const [index, descriptor] of (manifest.observations ?? []).entries()) {
    const observationPath = `${path}/manifest/observations/${index}`;
    const loaded = resolveArtifact(errors, artifactRoot, descriptor, observationPath);
    if (loaded === null) continue;
    let events;
    try {
      events = parseObservationJsonLines(
        loaded.text,
        descriptor.path,
        { laneRunId: provenance.laneRunId },
      );
    } catch (error) {
      errors.push(`${observationPath}: invalid observation stream: ${error.message}`);
      continue;
    }
    observationEvents.push(...events.map((event) => ({
      ...event,
      evidenceSourceId: descriptor.sourceId,
    })));
    observationsBySource.set(descriptor.sourceId, events);
    expectedObservations.push({
      sourceId: descriptor.sourceId,
      path: descriptor.path,
      sha256: descriptor.sha256,
    });
  }
  if (!sameJson(provenance.observations, expectedObservations)) {
    errors.push(`${path}/observations: current observation provenance must equal the manifest's complete hash-bound source set`);
  }
  let observationJoinExceptions = [];
  try {
    observationJoinExceptions = loadObservationCompatibility(manifest, {
      events: observationEvents,
    });
  } catch (error) {
    errors.push(`${path}/observations: compatibility admission failed: ${error.message}`);
  }

  const boundaryLoaded = resolveArtifact(
    errors,
    artifactRoot,
    manifest.boundaries,
    `${path}/manifest/boundaries`,
  );
  const boundaryValue = parseArtifactJson(errors, boundaryLoaded, `${path}/manifest/boundaries`);
  if (boundaryValue === null) return;
  let recovery;
  try {
    recovery = applyR2DriverV1TerminalCompatibility({
      manifest,
      boundaryValue,
      observationEvents,
      clockCorrelation: manifest.clockCorrelation,
      loadedSessions,
    });
  } catch (error) {
    errors.push(`${path}/driver/compatibilityEvents: native terminal recovery failed: ${error.message}`);
    return;
  }
  const expectedDriver = {
    id: manifest.driver.id,
    stampedAt: manifest.driver.stampedAt,
    startedAt: manifest.driver.startedAt,
    compatibilityEvents: recovery.compatibilityEvents,
  };
  if (!sameJson(provenance.driver, expectedDriver)) {
    errors.push(`${path}/driver: identity and compatibilityEvents must equal native boundary replay`);
  }
  if (!sameJson(provenance.clockCorrelation, recovery.clockCorrelation)) {
    errors.push(`${path}/clockCorrelation: effective clock claim must equal native boundary replay`);
  }
  if (!sameJson(provenance.boundaries, {
    path: manifest.boundaries.path,
    sha256: manifest.boundaries.sha256,
  })) {
    errors.push(`${path}/boundaries: descriptor must equal the metering manifest boundary artifact`);
  }
  let fullJourneyAccounting = { channel, milestoneWallStarts: {}, separateTokenPhases: {} };
  if (manifest.driver.id === "social-messenger-full-journey-native-cli-driver.v1") {
    const boundaries = boundaryValue?.milestones ?? boundaryValue;
    if (Object.hasOwn(boundaries, "M7")) {
      resolveArtifact(
        errors,
        artifactRoot,
        manifest.freshSessionHandoff?.source,
        `${path}/manifest/freshSessionHandoff/source`,
      );
      resolveArtifact(
        errors,
        artifactRoot,
        manifest.freshSessionHandoff?.renderedPrompt,
        `${path}/manifest/freshSessionHandoff/renderedPrompt`,
      );
    }
    let replayValue = null;
    let replayReceiptValue = null;
    let replayFailureValue = null;
    if (boundaries.M8?.status === "green") {
      if (manifest.scaleReplayFailure !== undefined) {
        const replayFailureLoaded = resolveArtifact(
          errors,
          artifactRoot,
          manifest.scaleReplayFailure,
          `${path}/manifest/scaleReplayFailure`,
        );
        replayFailureValue = parseArtifactJson(
          errors,
          replayFailureLoaded,
          `${path}/manifest/scaleReplayFailure`,
        );
      } else {
        const replayLoaded = resolveArtifact(
          errors,
          artifactRoot,
          manifest.scaleReplay,
          `${path}/manifest/scaleReplay`,
        );
        replayValue = parseArtifactJson(errors, replayLoaded, `${path}/manifest/scaleReplay`);
        if (replayValue !== null) {
          const replayReceiptLoaded = resolveArtifact(
            errors,
            artifactRoot,
            replayValue.receipt,
            `${path}/manifest/scaleReplay/receipt`,
          );
          replayReceiptValue = parseArtifactJson(
            errors,
            replayReceiptLoaded,
            `${path}/manifest/scaleReplay/receipt`,
          );
        }
      }
    }
    try {
      fullJourneyAccounting = bindFullJourneyAccountingValues({
        manifest,
        boundaryValue,
        driverCompatibility: recovery,
        loadedSessions,
        channel,
        replayValue,
        replayReceiptValue,
        replayFailureValue,
      });
      channel = fullJourneyAccounting.channel;
    } catch (error) {
      errors.push(`${path}: full-journey accounting replay failed: ${error.message}`);
      return;
    }
  }
  const expectedReceipts = (manifest.receipts ?? []).map((receipt) => ({
    sourceId: receipt.sourceId,
    runId: receipt.runId,
    milestone: receipt.milestone,
    path: receipt.path,
    sha256: receipt.sha256,
  }));
  if (!sameJson(provenance.receipts, expectedReceipts)) {
    errors.push(`${path}/receipts: provenance must equal the manifest's receipt set`);
  }
  const expectedFirstDescriptor = manifest.firstProductEdit === null
    ? null
    : { path: manifest.firstProductEdit.path, sha256: manifest.firstProductEdit.sha256 };
  if (!sameJson(provenance.firstProductEdit, expectedFirstDescriptor)) {
    errors.push(`${path}/firstProductEdit: descriptor must equal the metering manifest marker`);
  }
  let firstProductEdit = null;
  if (manifest.firstProductEdit !== null) {
    const markerLoaded = resolveArtifact(
      errors,
      artifactRoot,
      manifest.firstProductEdit,
      `${path}/manifest/firstProductEdit`,
    );
    firstProductEdit = parseArtifactJson(errors, markerLoaded, `${path}/manifest/firstProductEdit`);
  }
  if (manifest.adapter === "codex") {
    const builder = loadedSessions.find((session) => session.role === "builder");
    if (builder !== undefined) {
      try {
        const cellId = provenance.laneRunId.split("/").at(-1);
        const productRoot = inferCodexProductRoot(builder.records, cellId);
        const recovered = recoverCodexFileChanges({
          records: builder.records,
          boundaryValue: recovery.boundaryValue,
          laneRunId: provenance.laneRunId,
          productRoot,
          sourceId: builder.sourceId,
          nativeSessionId: builder.nativeSessionId,
          nativeStreamSha256: builder.resolvedSha256,
        });
        if (!sameJson(firstProductEdit, recovered.firstProductEdit)) {
          errors.push(`${path}/firstProductEdit: marker must equal the first native product FileChange and its hash-bound provenance`);
        }
        const retainedFileChanges = observationsBySource.get("codex-file-change-observations");
        if (!sameJson(retainedFileChanges, recovered.events)) {
          errors.push(
            `${path}/observations: codex-file-change-observations must equal every commandless FileChange recovered from the immutable native rollout`,
          );
        }
      } catch (error) {
        errors.push(`${path}/firstProductEdit: native FileChange recovery failed: ${error.message}`);
      }
    }
  }

  const recordBaseLoaded = resolveArtifact(
    errors,
    artifactRoot,
    manifest.recordBase,
    `${path}/manifest/recordBase`,
  );
  const recordBase = parseArtifactJson(errors, recordBaseLoaded, `${path}/manifest/recordBase`);
  const expectedRecordBaseDescriptor = manifest.recordBase === undefined
    ? null
    : { path: manifest.recordBase.path, sha256: manifest.recordBase.sha256 };
  if (!sameJson(provenance.recordBase, expectedRecordBaseDescriptor)) {
    errors.push(`${path}/recordBase: descriptor must equal the hash-bound composition base`);
  }
  if (recordBase === null || channel === null) return;

  try {
    const receiptMaps = [];
    for (const [index, descriptor] of (manifest.receipts ?? []).entries()) {
      const receiptPath = `${path}/manifest/receipts/${index}`;
      const loaded = resolveArtifact(errors, artifactRoot, descriptor, receiptPath);
      if (loaded === null) throw new Error(`cannot load receipt ${descriptor.sourceId}`);
      receiptMaps.push(boundariesFromReceiptRecords(
        parseJsonLines(loaded.text, descriptor.path),
        descriptor.sourceId,
      ));
    }
    const boundaries = mergeBoundaryMaps(
      ...receiptMaps,
      normalizeBoundaryMap(recovery.boundaryValue),
    );

    let suiteStatusLinkage = null;
    if (manifest.suiteStatus !== null && manifest.suiteStatus !== undefined) {
      const loadedStatus = resolveArtifact(
        errors,
        artifactRoot,
        manifest.suiteStatus,
        `${path}/manifest/suiteStatus`,
      );
      const status = parseArtifactJson(errors, loadedStatus, `${path}/manifest/suiteStatus`);
      if (status === null) throw new Error("suite-status replay failed");
      suiteStatusLinkage = {
        input: { path: manifest.suiteStatus.path, sha256: manifest.suiteStatus.sha256 },
        milestones: Object.keys(boundaries)
          .filter((milestone) => (
            manifest.driver.id === "social-messenger-full-journey-native-cli-driver.v1"
            || milestone !== "M7"
          ))
          .map((milestone) => {
            const segment = status[milestone.toLowerCase()];
            if (!segment || typeof segment.pass !== "boolean") {
              throw new Error(`suite-status lacks ${milestone.toLowerCase()}.pass`);
            }
            let receipt = null;
            if (typeof segment.receipt === "string" && segment.receipt.length > 0) {
              const relativePath = relative(
                resolve(artifactRoot),
                resolve(dirname(resolve(artifactRoot, manifest.suiteStatus.path)), segment.receipt),
              ).split(sep).join("/");
              const loadedReceipt = retainedRelativeArtifact(
                errors,
                artifactRoot,
                relativePath,
                `${path}/manifest/suiteStatus/${milestone}/receipt`,
              );
              if (loadedReceipt === null) throw new Error(`cannot load ${milestone} suite receipt`);
              receipt = { path: relativePath, sha256: loadedReceipt.sha256 };
            }
            return { milestone, pass: segment.pass, receipt };
          }),
      };
    }

    const expectedProvenance = {
      manifestVersion: manifest.manifestVersion,
      laneRunId: manifest.laneRunId,
      manifest: provenance.manifest,
      driver: expectedDriver,
      manifestSha256: provenance.manifest.sha256,
      unavailableReason: channel.unavailableReason ?? null,
      adapter: {
        id: channel.adapter,
        version: channel.adapterVersion,
        compatibilityEvents: channel.compatibilityEvents ?? [],
      },
      clockCorrelation: recovery.clockCorrelation,
      sessions: expectedSessions,
      receipts: expectedReceipts,
      observations: expectedObservations,
      boundaries: { path: manifest.boundaries.path, sha256: manifest.boundaries.sha256 },
      firstProductEdit: expectedFirstDescriptor,
      recordBase: expectedRecordBaseDescriptor,
    };
    const patch = joinUsageToMilestones({
      channel,
      boundaries,
      firstProductEdit,
      observations: {
        events: recovery.observationEvents,
        evidence: expectedObservations.map(({ path: evidencePath, sha256: evidenceSha }) => ({
          path: evidencePath,
          sha256: evidenceSha,
        })),
        joinExceptions: observationJoinExceptions,
        windowExceptions: recovery.compatibilityEvents
          .flatMap((event) => event.observationTerminalInclusions ?? []),
      },
      suiteStatusLinkage,
      maxClockSkewMs: recovery.clockCorrelation.maxSkewMillis,
      wallClockOrigin: manifest.driver.startedAt,
      provenance: expectedProvenance,
      usageSettlements: recovery.usageSettlements,
      milestoneWallStarts: fullJourneyAccounting.milestoneWallStarts,
      separateTokenPhases: fullJourneyAccounting.separateTokenPhases ?? {},
      separateClockPhases: fullJourneyAccounting.separateClockPhases ?? {},
    });
    const expectedRecord = composeRunRecord({
      base: recordBase,
      patch,
      expectedMilestones: Object.keys(recordBase.socialMessenger?.milestones ?? {}),
    });
    if (!sameJson(record, expectedRecord)) {
      errors.push(
        "$: current-R2 record must equal the complete hash-bound native metering replay, including tokens, phases, walls, caps, charging, eligibility, and provenance",
      );
    }
  } catch (error) {
    errors.push(`${path}: complete native metering replay failed: ${error.message}`);
  }
}

function tokenActual(counts) {
  return Number.isInteger(counts?.input) && Number.isInteger(counts?.output)
    ? counts.input + counts.output
    : null;
}

function orientationTokenEvidenceAvailable(counts) {
  return Number.isInteger(counts?.input)
    && Number.isInteger(counts?.output)
    && (counts?.cacheRead === null || Number.isInteger(counts?.cacheRead))
    && (counts?.cacheWrite === null || Number.isInteger(counts?.cacheWrite))
    && (counts?.reasoning === null || Number.isInteger(counts?.reasoning));
}

function exactFlags(flags, expected) {
  return Array.isArray(flags)
    && flags.length === expected.length
    && flags.every((flag, index) => flag === expected[index]);
}

function requireEqual(errors, path, actual, expected, rule) {
  if (actual !== expected) {
    errors.push(`${path}: ${rule}; expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function validateReasoningSubset(errors, counts, path) {
  if (
    Number.isInteger(counts?.reasoning)
    && Number.isInteger(counts?.output)
    && counts.reasoning > counts.output
  ) {
    errors.push(`${path}/reasoning: reasoning must be a subset of output`);
  }
}

function integerSum(record) {
  return Object.values(record ?? {}).reduce(
    (sum, value) => sum + (Number.isInteger(value) ? value : 0),
    0,
  );
}

function validateD06Observability(errors, milestone, value, path) {
  const semantic = value.semanticActions;
  if (semantic?.claimed === true) {
    requireEqual(
      errors,
      `${path}/semanticActions/total`,
      semantic.total,
      integerSum(semantic.byClass),
      "semantic-action total must equal the closed-taxonomy class counts",
    );
    requireEqual(
      errors,
      `${path}/semanticActions/total`,
      semantic.total,
      integerSum(semantic.byDisposition),
      "semantic-action total must equal progress + correction",
    );
    if (semantic.binaryExcavation > semantic.byClass?.["source-inspection"]) {
      errors.push(
        `${path}/semanticActions/binaryExcavation: binary excavation must be a subclass of source-inspection`,
      );
    }
    requireEqual(
      errors,
      `${path}/semanticActions/byClass/retry`,
      semantic.byClass?.retry,
      integerSum(semantic.byRetriedClass),
      "every retry must project the class retried",
    );
    if (semantic.byClass?.retry > semantic.byDisposition?.correction) {
      errors.push(`${path}/semanticActions/byClass/retry: retry actions must be correction actions`);
    }
  }

  const episodes = value.failureToRecoveryEpisodes;
  if (episodes?.claimed === true) {
    requireEqual(
      errors,
      `${path}/failureToRecoveryEpisodes/total`,
      episodes.total,
      integerSum(episodes.byCarrier),
      "episode total must equal carrier counts",
    );
    requireEqual(
      errors,
      `${path}/failureToRecoveryEpisodes/total`,
      episodes.total,
      integerSum(episodes.byAttribution),
      "episode total must equal attribution counts",
    );
    requireEqual(
      errors,
      `${path}/failureToRecoveryEpisodes/total`,
      episodes.total,
      integerSum(episodes.byOutcome),
      "episode total must equal recovered + unresolved",
    );
  }

  if (
    value.restartReseed?.claimed === true
    && value.restartReseed.destructiveReseeds > value.restartReseed.reseeds
  ) {
    errors.push(
      `${path}/restartReseed/destructiveReseeds: destructive reseeds must be a subset of reseeds`,
    );
  }

  const hostLoad = value.hostLoad;
  if (hostLoad?.claimed === true) {
    requireEqual(
      errors,
      `${path}/hostLoad/contamination`,
      hostLoad.contamination,
      Array.isArray(hostLoad.breaches) && hostLoad.breaches.length > 0,
      "host-load contamination must match retained breaches",
    );
    if (Date.parse(hostLoad.endedAt) < Date.parse(hostLoad.startedAt)) {
      errors.push(`${path}/hostLoad/endedAt: host-load window ends before it starts`);
    }
    for (const [index, breach] of (hostLoad.breaches ?? []).entries()) {
      if (breach.observed <= breach.ceiling) {
        errors.push(
          `${path}/hostLoad/breaches/${index}/observed: a breach must exceed its ceiling`,
        );
      }
    }
  }

  const interruptions = value.apiInterruptions;
  if (interruptions?.claimed === true) {
    requireEqual(
      errors,
      `${path}/apiInterruptions/interrupted`,
      interruptions.interrupted,
      Array.isArray(interruptions.windows) && interruptions.windows.length > 0,
      "API interruption flag must match retained windows",
    );
    for (const [index, window] of (interruptions.windows ?? []).entries()) {
      if (
        window.recoveredAt !== null
        && Date.parse(window.recoveredAt) < Date.parse(window.startedAt)
      ) {
        errors.push(
          `${path}/apiInterruptions/windows/${index}/recoveredAt: recovery precedes interruption`,
        );
      }
    }
  }

  if (milestone && semantic?.claimed === true && episodes?.claimed === true) {
    const correctionActions = semantic.byDisposition?.correction;
    if (Number.isInteger(correctionActions) && correctionActions < episodes.total) {
      errors.push(
        `${path}/semanticActions/byDisposition/correction: each failure-to-recovery episode must contain at least its first failed action`,
      );
    }
  }
}

function loadObservationEvidence(errors, extension, artifactRoot) {
  const artifacts = extension.meteringProvenance?.observations ?? [];
  const evidence = [];
  const events = [];
  const paths = new Set();
  for (const [index, artifact] of artifacts.entries()) {
    const path = `$/socialMessenger/meteringProvenance/observations/${index}`;
    if (paths.has(artifact?.path)) {
      errors.push(`${path}/path: duplicate observation artifact path`);
      continue;
    }
    paths.add(artifact?.path);
    const loaded = resolveArtifact(errors, artifactRoot, artifact, path);
    if (loaded === null) continue;
    let sourceEvents;
    try {
      sourceEvents = parseObservationJsonLines(
        loaded.text,
        artifact.path,
        { laneRunId: extension.meteringProvenance?.laneRunId },
      );
    } catch (error) {
      errors.push(`${path}: invalid observation event stream: ${error.message}`);
      continue;
    }
    for (const event of sourceEvents) {
      if (!observationLaneRunIdMatches(
        event.laneRunId,
        extension.meteringProvenance?.laneRunId,
      )) {
        errors.push(`${path}: observation laneRunId does not match metering provenance`);
      }
      event.laneRunId = extension.meteringProvenance?.laneRunId;
    }
    events.push(...sourceEvents.map((event) => ({
      ...event,
      evidenceSourceId: artifact.sourceId,
    })));
    evidence.push({ path: artifact.path, sha256: artifact.sha256 });
  }
  events.sort((left, right) => (
    Date.parse(left.at) - Date.parse(right.at) || left.sequence - right.sequence
  ));
  return { evidence, events };
}

function validateObservationBinding(errors, record, extension, artifactRoot, currentInstrument) {
  const attempted = Object.entries(extension.milestones ?? {}).filter(
    ([, value]) => ATTEMPTED_STATUSES.has(value?.status),
  );
  const hasObservability = attempted.some(([, value]) => (
    OBSERVABILITY_BLOCKS.some((block) => value?.[block] !== undefined)
  ));
  if (!currentInstrument && !hasObservability) return;

  if (currentInstrument) {
    if (extension.observabilityProtocol !== "social-messenger-observation.v1") {
      errors.push("$/socialMessenger/observabilityProtocol: current instrument must identify the typed observation protocol");
    }
    if (!Array.isArray(extension.meteringProvenance?.observations)) {
      errors.push("$/socialMessenger/meteringProvenance/observations: current instrument must declare its complete observation artifact set, including an empty set for all-non-claim records");
    }
  }

  const loaded = loadObservationEvidence(errors, extension, artifactRoot);
  let observationJoinExceptions = [];
  if (currentInstrument && extension.meteringProvenance?.manifest) {
    const manifestLoaded = resolveArtifact(
      errors,
      artifactRoot,
      extension.meteringProvenance.manifest,
      "$/socialMessenger/meteringProvenance/manifest",
    );
    const manifest = parseArtifactJson(
      errors,
      manifestLoaded,
      "$/socialMessenger/meteringProvenance/manifest",
    );
    if (manifest !== null) {
      try {
        observationJoinExceptions = loadObservationCompatibility(manifest, loaded);
      } catch (error) {
        errors.push(`$/socialMessenger/meteringProvenance/observations: compatibility admission failed: ${error.message}`);
      }
    }
  }
  const exclusions = extension.meteringProvenance?.driver?.compatibilityEvents
    ?.flatMap((event) => event.observationHandoffExclusions ?? []) ?? [];
  const withoutInstrumentation = loaded.events.filter((event) => !exclusions.some((excluded) => (
    excluded.observationSourceId === event.evidenceSourceId
    && excluded.milestone === event.milestone
    && excluded.sequence === event.sequence
    && excluded.at === event.at
    && excluded.type === event.type
    && excluded.actionId === event.actionId
    && excluded.actionClass === event.actionClass
    && excluded.disposition === event.disposition
  )));
  const terminalInclusions = extension.meteringProvenance?.driver?.compatibilityEvents
    ?.flatMap((event) => event.observationTerminalInclusions ?? []) ?? [];
  const observationSkewMillis = Number.isInteger(
    extension.meteringProvenance?.clockCorrelation?.maxSkewMillis,
  )
    ? extension.meteringProvenance.clockCorrelation.maxSkewMillis
    : 0;
  const ordered = attempted
    .filter(([, value]) => Number.isInteger(value?.authoring?.terminalSequence))
    .sort((left, right) => (
      left[1].authoring.terminalSequence - right[1].authoring.terminalSequence
    ));
  const observationWindow = new Map(ordered.map(([milestone, value], index) => [
    milestone,
    {
      lower: index === 0 ? null : Date.parse(ordered[index - 1][1].authoring.terminalAt),
      upper: Date.parse(value.authoring.terminalAt),
    },
  ]));
  const effectiveEvents = [];
  for (const event of withoutInstrumentation) {
    const window = observationWindow.get(event.milestone);
    if (!window) {
      errors.push(`$/socialMessenger/meteringProvenance/observations: ${event.type} names unattempted milestone ${event.milestone}`);
      continue;
    }
    const at = Date.parse(event.at);
    const retainedTerminalInclusion = terminalInclusions.some((included) => (
      included.observationSourceId === event.evidenceSourceId
      && included.milestone === event.milestone
      && included.sequence === event.sequence
      && included.at === event.at
      && included.type === event.type
      && included.eventSha256 === sha256(JSON.stringify(event))
    ));
    if (at > window.upper + observationSkewMillis && !retainedTerminalInclusion) continue;
    if (window.lower !== null && at < window.lower - observationSkewMillis) continue;
    effectiveEvents.push(event);
  }
  for (const [milestone, value] of attempted) {
    const path = `$/socialMessenger/milestones/${milestone}`;
    let projected;
    try {
      projected = projectMilestoneObservability({
        events: effectiveEvents,
        evidence: loaded.evidence,
        milestone,
        joinExceptions: observationJoinExceptions,
      });
    } catch (error) {
      errors.push(`${path}: observation projection failed: ${error.message}`);
      continue;
    }
    for (const block of OBSERVABILITY_BLOCKS) {
      if (value[block] === undefined) {
        if (currentInstrument) {
          errors.push(`${path}/${block}: current instrument requires an explicit claimed or non-claimed block`);
        }
        continue;
      }
      if (!sameJson(value[block], projected[block])) {
        errors.push(
          `${path}/${block}: record block does not equal the projection recomputed from its typed, hash-verified observation events`,
        );
      }
    }
  }

  const observedMilestones = Object.fromEntries(attempted.map(([milestone, value]) => [
    milestone,
    Object.fromEntries(OBSERVABILITY_BLOCKS.map((block) => [
      block,
      value[block] ?? { claimed: false, reason: "absent" },
    ])),
  ]));
  const expectedEligibility = scorecardEligibility({
    milestones: observedMilestones,
    phaseUsageAvailable: Number.isInteger(record.tokens?.input)
      && Number.isInteger(record.tokens?.output),
    orientationEvidenceAvailable: extension.firstProductEdit?.at !== null
      && Number.isInteger(extension.firstProductEdit?.orientationBytes)
      && orientationTokenEvidenceAvailable(extension.firstProductEdit?.orientationTokens),
  });
  if (!sameJson(extension.efficiencyScorecardEligibility, expectedEligibility)) {
    errors.push(
      "$/socialMessenger/efficiencyScorecardEligibility: eligibility must equal the validator-recomputed phase, claim, load, and interruption consequences",
    );
  }
}

function loadSuiteReceiptAttestations(errors, extension, artifactRoot, currentInstrument) {
  const byMilestone = new Map();
  if (!currentInstrument) return byMilestone;
  const receipts = Array.isArray(extension.meteringProvenance?.receipts)
    ? extension.meteringProvenance.receipts
    : [];
  for (const [index, descriptor] of receipts.entries()) {
    const path = `$/socialMessenger/meteringProvenance/receipts/${index}`;
    const milestone = descriptor?.milestone;
    if (!/^M[1-8]$/u.test(milestone ?? "")) continue;
    const loaded = resolveArtifact(errors, artifactRoot, descriptor, path);
    if (loaded === null) continue;
    let records;
    try {
      records = parseJsonLines(loaded.text, descriptor.path);
    } catch (error) {
      errors.push(`${path}: invalid choreography receipt stream: ${error.message}`);
      continue;
    }
    for (const [recordIndex, record] of records.entries()) {
      const receiptPath = `${path}/records/${recordIndex}`;
      const schemaErrors = validateJsonSchema(RECEIPT_SCHEMA, record);
      if (schemaErrors.length > 0) {
        errors.push(
          `${receiptPath}: receipt does not satisfy receipts.schema.json: ${schemaErrors.join("; ")}`,
        );
        continue;
      }
      if (record.version !== CURRENT_CHOREOGRAPHY_VERSION) {
        errors.push(
          `${receiptPath}/version: current instrument requires ${CURRENT_CHOREOGRAPHY_VERSION}; received ${record.version ?? "none"}`,
        );
        continue;
      }
      for (const [timingIndex, timing] of (record.timings ?? []).entries()) {
        if (timing.settlementWaitMs > timing.durationMs) {
          errors.push(
            `${receiptPath}/timings/${timingIndex}/settlementWaitMs: settlement wait exceeds the complete attempt duration`,
          );
        }
      }
      if (record?.runId !== descriptor.runId) {
        errors.push(`${path}: receipt ${recordIndex + 1} does not match retained runId`);
      }
      if (
        typeof record?.segment === "string"
        && record.segment.toUpperCase() !== milestone
      ) {
        errors.push(`${path}: receipt ${recordIndex + 1} does not match ${milestone}`);
      }
      if (
        record?.type === "segment-summary"
        && record?.version === CURRENT_CHOREOGRAPHY_VERSION
        && record?.segment?.toUpperCase() === milestone
      ) {
        const attestations = byMilestone.get(milestone) ?? [];
        attestations.push(record);
        byMilestone.set(milestone, attestations);
      }
    }
  }
  return byMilestone;
}

function validateSuiteStatusLinkage(errors, extension, artifactRoot, currentInstrument) {
  const linkage = extension.suiteStatusLinkage;
  if (!linkage) {
    if (currentInstrument) {
      errors.push("$/socialMessenger/suiteStatusLinkage: current instrument requires hash-bound suite-status custody");
    }
    return;
  }
  const receiptAttestations = loadSuiteReceiptAttestations(
    errors,
    extension,
    artifactRoot,
    currentInstrument,
  );
  const input = resolveArtifact(
    errors,
    artifactRoot,
    linkage.input,
    "$/socialMessenger/suiteStatusLinkage/input",
  );
  let statuses = null;
  if (input !== null) {
    try {
      statuses = JSON.parse(input.text);
    } catch (error) {
      errors.push(`$/socialMessenger/suiteStatusLinkage/input: invalid JSON: ${error.message}`);
    }
    if (!statuses || Array.isArray(statuses) || typeof statuses !== "object") {
      errors.push("$/socialMessenger/suiteStatusLinkage/input: expected an object keyed by milestone");
      statuses = null;
    }
  }
  const linked = new Set();
  const linkageMilestones = Array.isArray(linkage.milestones) ? linkage.milestones : [];
  for (const [index, entry] of linkageMilestones.entries()) {
    const path = `$/socialMessenger/suiteStatusLinkage/milestones/${index}`;
    if (!entry || typeof entry !== "object" || !/^M[1-8]$/u.test(entry.milestone ?? "")) {
      errors.push(`${path}/milestone: expected M1 through M8`);
      continue;
    }
    if (linked.has(entry.milestone)) {
      errors.push(
        `${path}/milestone: duplicate suite-status milestone`,
      );
    }
    linked.add(entry.milestone);
    if (!Object.hasOwn(extension.milestones ?? {}, entry.milestone)) {
      errors.push(
        `$/socialMessenger/suiteStatusLinkage/milestones/${index}/milestone: linked milestone is absent from the run record`,
      );
    }
    const status = statuses?.[entry.milestone.toLowerCase()];
    if (!status || typeof status !== "object" || typeof status.pass !== "boolean") {
      errors.push(`${path}: retained suite-status input lacks ${entry.milestone.toLowerCase()}`);
      continue;
    }
    if (status.pass !== entry.pass) {
      errors.push(`${path}/pass: value differs from the retained suite-status input`);
    }
    if (currentInstrument) {
      const attestations = receiptAttestations.get(entry.milestone) ?? [];
      const milestoneRecord = extension.milestones?.[entry.milestone];
      const requiredAttestations = milestoneRecord?.status === "green" ? 1 : 0;
      if (
        attestations.length > 1
        || (requiredAttestations === 1 && attestations.length !== 1)
      ) {
        errors.push(
          `${path}: expected ${requiredAttestations === 1 ? "exactly one" : "at most one"} hash-verified ${CURRENT_CHOREOGRAPHY_VERSION} segment-summary, received ${attestations.length}`,
        );
      } else if (attestations.length === 1) {
        const attestation = attestations[0];
        if (attestation.suite?.pass !== entry.pass) {
          errors.push(`${path}/pass: value differs from the refusal-time segment-summary`);
        }
        if ((attestation.suite?.receipt ?? null) !== (status.receipt ?? null)) {
          errors.push(`${path}/receipt: suite-status path differs from the refusal-time segment-summary`);
        }
        if (
          (attestation.suite?.receiptSha256 ?? null)
          !== (entry.receipt?.sha256 ?? null)
        ) {
          errors.push(`${path}/receipt/sha256: digest differs from the refusal-time segment-summary`);
        }
        if (
          milestoneRecord?.status === "green"
          && (
            attestation.green !== true
            || attestation.choreography?.pass !== true
            || Date.parse(attestation.recordedAt)
              !== Date.parse(milestoneRecord.authoring?.firstGreenAt)
            || Date.parse(attestation.recordedAt)
              > Date.parse(milestoneRecord.authoring?.terminalAt)
          )
        ) {
          errors.push(`${path}: green milestone lacks a matching first-green ${CURRENT_CHOREOGRAPHY_VERSION} segment-summary`);
        }
      }
    }
    if (entry.pass && entry.receipt === null) {
      errors.push(`${path}/receipt: pass:true requires a retained receipt artifact`);
    }
    const rawReceipt = status.receipt ?? null;
    if (rawReceipt !== null && (typeof rawReceipt !== "string" || rawReceipt.length === 0)) {
      errors.push(`${path}/receipt: suite-status receipt must be null or a non-empty string`);
      continue;
    }
    if (rawReceipt === null) {
      if (entry.receipt !== null) {
        errors.push(`${path}/receipt: record links a receipt absent from suite-status input`);
      }
      continue;
    }
    if (isAbsolute(rawReceipt)) {
      errors.push(`${path}/receipt: suite-status receipt path must be relative to its input file`);
      continue;
    }
    const canonicalArtifactRoot = artifactRoot ? realpathSync(artifactRoot) : null;
    if (!canonicalArtifactRoot) {
      errors.push(`${path}/receipt: artifactRoot is required to resolve the suite receipt`);
      continue;
    }
    const expectedPath = resolve(dirname(input?.absolute ?? canonicalArtifactRoot), normalize(rawReceipt));
    if (!inside(canonicalArtifactRoot, expectedPath)) {
      errors.push(`${path}/receipt: suite-status receipt escapes the record evidence directory`);
      continue;
    }
    let canonicalExpectedPath;
    try {
      canonicalExpectedPath = realpathSync(expectedPath);
      if (!inside(canonicalArtifactRoot, canonicalExpectedPath)) {
        throw new Error("canonical path escapes the record evidence directory");
      }
    } catch (error) {
      errors.push(`${path}/receipt: cannot resolve suite-status receipt path: ${error.message}`);
      continue;
    }
    const receipt = entry.receipt === null
      ? null
      : resolveArtifact(errors, artifactRoot, entry.receipt, `${path}/receipt`);
    if (receipt === null) {
      if (entry.receipt === null) errors.push(`${path}/receipt: referenced suite receipt is not retained`);
      continue;
    }
    if (resolve(receipt.absolute) !== resolve(canonicalExpectedPath)) {
      errors.push(`${path}/receipt/path: linked artifact does not resolve to the suite-status receipt path`);
    }
  }
  for (const [milestone, value] of Object.entries(extension.milestones ?? {})) {
    if (
      (milestone !== "M7" || extension.runScope === "full")
      && ATTEMPTED_STATUSES.has(value?.status)
      && !linked.has(milestone)
    ) {
      errors.push(
        `$/socialMessenger/suiteStatusLinkage/milestones: attempted ${milestone} lacks hash-linked suite status`,
      );
    }
  }
}

// Cross-field charging equalities are deliberately adjacent to the composed
// schema: JSON Schema can constrain each field and flag shape, but cannot
// express chargedTokens === tokenCap or chargedTokens === input + output.
// @ref LLP 0201#d2--quantitative-instrument — published driver-shaped records
// preserve the cap/abort charging rules and honest native/null token posture.
export function validateSocialMessengerRecordSemantics(record, { artifactRoot = null } = {}) {
  const errors = [];
  const extension = record?.socialMessenger;
  if (extension === null || typeof extension !== "object") return errors;
  const physicalCurrentIdentity = physicalCurrentR2Identity(artifactRoot);
  const currentInstrument = extension.instrumentVersion === CURRENT_INSTRUMENT_PIN
    || (physicalCurrentIdentity && extension.instrumentVersion !== PREVIOUS_INSTRUMENT_PIN);
  const currentProtocolMarker = extension.observabilityProtocol === OBSERVATION_VERSION
    && !RETAINED_INSTRUMENT_PINS.has(extension.instrumentVersion);
  const currentOrientationMarker = (
    extension.orientation?.instrument?.pin === CURRENT_INSTRUMENT_PIN
    || extension.orientation?.instrument?.versions?.choreography === CURRENT_CHOREOGRAPHY_VERSION
  );
  if (!currentInstrument && (currentProtocolMarker || currentOrientationMarker)) {
    errors.push(
      `$/socialMessenger/instrumentVersion: current observability/orientation markers require ${CURRENT_INSTRUMENT_PIN}`,
    );
  }
  if (
    currentInstrument
    && extension.typingObservationBoundaryVersion
      !== CURRENT_TYPING_OBSERVATION_BOUNDARY_VERSION
  ) {
    errors.push(
      `$/socialMessenger/typingObservationBoundaryVersion: ${CURRENT_INSTRUMENT_PIN} requires ${CURRENT_TYPING_OBSERVATION_BOUNDARY_VERSION}`,
    );
  }

  for (const [milestone, value] of Object.entries(extension.milestones ?? {})) {
    if (value === null || typeof value !== "object") continue;
    const path = `$/socialMessenger/milestones/${milestone}`;
    const authoring = value.authoring ?? {};
    const charging = value.charging ?? {};
    const caps = value.caps ?? {};
    const actualTokens = tokenActual(authoring.tokens);
    validateReasoningSubset(errors, authoring.tokens, `${path}/authoring/tokens`);
    // @ref LLP 0201#d2--quantitative-instrument — D0.6 records hash-linked
    // semantic actions, recovery, lifecycle, assertion wait, and contamination.
    validateD06Observability(errors, milestone, value, path);
    if (currentInstrument && value.status === "green") {
      for (const owner of ["suite", "choreography"]) {
        if (
          value.browserAssertionWait?.[owner]?.claimed === true
          && value.browserAssertionWait[owner].attempts === 0
        ) {
          errors.push(
            `${path}/browserAssertionWait/${owner}/attempts: green current-instrument milestones require at least one measured ${owner} settlement attempt`,
          );
        }
      }
    }
    if (
      currentInstrument
      && value.status === "green"
      && value.semanticActions?.claimed === true
      && value.semanticActions.total === 0
    ) {
      errors.push(
        `${path}/semanticActions/total: green current-instrument milestones require at least one native-driver semantic action`,
      );
    }
    if (!ATTEMPTED_STATUSES.has(value.status)) continue;

    switch (authoring.terminalReason) {
      case "green":
        if (!exactFlags(charging.flags, [])) {
          errors.push(`${path}/charging/flags: green charging requires no flags`);
        }
        requireEqual(
          errors,
          `${path}/charging/chargedWallSeconds`,
          charging.chargedWallSeconds,
          value.adjudication?.adjudicatedCapabilityFailure === true
            ? caps.wallCapSeconds
            : authoring.wallSeconds,
          "green charges actual wall unless grader-adjudicated",
        );
        requireEqual(
          errors,
          `${path}/charging/chargedTokens`,
          charging.chargedTokens,
          actualTokens,
          "green charges actual input + output",
        );
        break;
      case "token-cap":
        if (!exactFlags(charging.flags, ["capped-tokens"])) {
          errors.push(`${path}/charging/flags: token-cap requires exactly capped-tokens`);
        }
        requireEqual(
          errors,
          `${path}/charging/chargedTokens`,
          charging.chargedTokens,
          caps.tokenCap,
          "token-cap charges the token cap",
        );
        requireEqual(
          errors,
          `${path}/charging/chargedWallSeconds`,
          charging.chargedWallSeconds,
          authoring.wallSeconds,
          "token-cap charges actual wall",
        );
        break;
      case "wall-cap":
      case "native-usage-settlement-timeout":
        if (!exactFlags(charging.flags, ["capped-wall"])) {
          errors.push(
            `${path}/charging/flags: ${authoring.terminalReason} requires exactly capped-wall`,
          );
        }
        requireEqual(
          errors,
          `${path}/charging/chargedWallSeconds`,
          charging.chargedWallSeconds,
          caps.wallCapSeconds,
          `${authoring.terminalReason} charges the wall cap`,
        );
        requireEqual(
          errors,
          `${path}/charging/chargedTokens`,
          charging.chargedTokens,
          actualTokens,
          `${authoring.terminalReason} charges actual input + output`,
        );
        break;
      case "abort":
        if (!exactFlags(charging.flags, ["aborted"])) {
          errors.push(`${path}/charging/flags: abort requires exactly aborted`);
        }
        requireEqual(
          errors,
          `${path}/charging/chargedWallSeconds`,
          charging.chargedWallSeconds,
          caps.wallCapSeconds,
          "abort charges the wall cap",
        );
        requireEqual(
          errors,
          `${path}/charging/chargedTokens`,
          charging.chargedTokens,
          actualTokens,
          "abort charges actual input + output",
        );
        break;
      default:
        break;
    }
  }
  validateReasoningSubset(
    errors,
    extension.firstProductEdit?.orientationTokens,
    "$/socialMessenger/firstProductEdit/orientationTokens",
  );
  if (currentInstrument && physicalCurrentR2Identity(artifactRoot)) {
    validateCurrentMeteringProvenance(errors, record, extension, artifactRoot);
  }
  // @ref LLP 0201#d2--quantitative-instrument — current records either bind
  // typed observation streams or retain explicit non-claims; the validator
  // derives eligibility from the same events.
  validateObservationBinding(errors, record, extension, artifactRoot, currentInstrument);
  // @ref LLP 0281#w6-suite-status-linkage-ergonomics — a retained linkage
  // covers every attempted milestone; the choreography refuses it earlier.
  validateSuiteStatusLinkage(errors, extension, artifactRoot, currentInstrument);
  return errors;
}

export function validateSocialMessengerRunRecord(
  schema,
  record,
  { schemas = [], tolerateAdditiveFields = false, artifactRoot = null } = {},
) {
  return [
    ...validateJsonSchema(schema, record, { schemas, tolerateAdditiveFields }),
    ...validateSocialMessengerRecordSemantics(record, { artifactRoot }),
  ];
}
