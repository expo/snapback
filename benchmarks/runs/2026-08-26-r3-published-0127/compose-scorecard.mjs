#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateSocialMessengerRunRecord } from "../../tools/social-messenger/record-validator.mjs";

export const R3_SCORECARD_VERSION = "snapback.r3-run-scorecard.v1";
const RATIO_ROWS = Object.freeze([
  "semantic-correction-actions",
  "output-tokens",
  "m1-wall-to-first-green",
]);

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function range(values) {
  return { minimum: Math.min(...values), maximum: Math.max(...values) };
}

function metricValue(record, rowId) {
  const milestones = Object.values(record.socialMessenger.milestones);
  if (rowId === "semantic-correction-actions") {
    return milestones.reduce((total, milestone) => (
      total + milestone.semanticActions.byDisposition.correction
    ), 0);
  }
  if (rowId === "output-tokens") {
    return milestones.reduce((total, milestone) => total + milestone.authoring.tokens.output, 0);
  }
  if (rowId === "m1-wall-to-first-green") {
    return record.socialMessenger.milestones.M1.authoring.wallSeconds;
  }
  throw new Error(`R3_SCORECARD_ROW_UNSUPPORTED: ${rowId}`);
}

function successful(record, cell) {
  return cell.milestones.every((milestone) => (
    record.socialMessenger?.milestones?.[milestone]?.status === "green"
  ));
}

function defaultValidator(repositoryRoot, input) {
  const [baseSchema, extensionSchema, composedSchema] = [
    "benchmarks/schema/run-record.schema.json",
    "benchmarks/schema/social-messenger/run-record-extension.schema.json",
    "benchmarks/schema/social-messenger/run-record.schema.json",
  ].map((path) => JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")));
  return validateSocialMessengerRunRecord(composedSchema, input.record, {
    schemas: [baseSchema, extensionSchema],
    artifactRoot: input.artifactRoot,
  });
}

function contrastDefinitions(config) {
  const scoredLegs = [...new Set(config.cells
    .filter((cell) => !cell.claimEligibility.startsWith("exploratory-"))
    .map((cell) => cell.leg))];
  return scoredLegs.flatMap((leg) => [
    ...[...new Set(config.cells.filter((cell) => cell.leg === leg).map((cell) => cell.app))]
      .map((app) => ({
        id: `explicit-minus-familiar:${leg}:${app}`,
        leg,
        fixed: { app },
        first: { profile: "explicit" },
        second: { profile: "familiar" },
      })),
    ...[...new Set(config.cells.filter((cell) => cell.leg === leg).map((cell) => cell.profile))]
      .map((profile) => ({
        id: `clique-minus-coterie:${leg}:${profile}`,
        leg,
        fixed: { profile },
        first: { app: "Clique" },
        second: { app: "Coterie" },
      })),
  ]);
}

function matches(cell, fields) {
  return Object.entries(fields).every(([key, value]) => cell[key] === value);
}

function summarizeArm(inputs, definition, arm) {
  return inputs.filter(({ cell }) => (
    cell.leg === definition.leg
    && matches(cell, definition.fixed)
    && matches(cell, definition[arm])
  ));
}

function failureRates(validated) {
  const groups = new Map();
  for (const input of validated) {
    const id = `${input.cell.leg}:${input.cell.app}:${input.cell.profile}`;
    const group = groups.get(id) ?? { attempts: 0, successful: 0, failed: 0 };
    group.attempts += 1;
    if (input.successful) group.successful += 1;
    else group.failed += 1;
    groups.set(id, group);
  }
  return Object.fromEntries([...groups].sort(([left], [right]) => left.localeCompare(right)).map(
    ([id, group]) => [id, {
      ...group,
      failureRate: group.attempts === 0 ? null : group.failed / group.attempts,
    }],
  ));
}

function insufficientRow({ row, definition, first, second, floor }) {
  return {
    rowId: row.id,
    contrastId: definition.id,
    status: "insufficient successful replicates",
    aggregation: row.aggregation,
    successFloor: floor,
    sides: {
      first: {
        successful: first.filter((item) => item.successful).length,
        eligibleSuccessful: first.filter((item) => item.successful && item.eligible).length,
      },
      second: {
        successful: second.filter((item) => item.successful).length,
        eligibleSuccessful: second.filter((item) => item.successful && item.eligible).length,
      },
    },
  };
}

function composeRatioRow({ row, definition, first, second, floor }) {
  const firstSuccessful = first.filter((item) => item.successful && item.eligible);
  const secondSuccessful = second.filter((item) => item.successful && item.eligible);
  if (firstSuccessful.length < floor || secondSuccessful.length < floor) {
    return insufficientRow({ row, definition, first, second, floor });
  }
  const secondByReplicate = new Map(secondSuccessful.map((item) => [item.cell.replicate, item]));
  const pairs = firstSuccessful.flatMap((left) => {
    const right = secondByReplicate.get(left.cell.replicate);
    return right === undefined ? [] : [{ replicate: left.cell.replicate, first: left, second: right }];
  });
  if (pairs.length < floor) {
    return insufficientRow({ row, definition, first, second, floor });
  }
  const constituents = pairs.map((pair) => {
    const firstValue = metricValue(pair.first.record, row.id);
    const secondValue = metricValue(pair.second.record, row.id);
    return {
      replicate: pair.replicate,
      firstCellId: pair.first.cell.id,
      secondCellId: pair.second.cell.id,
      first: firstValue,
      second: secondValue,
      pairedDifference: firstValue - secondValue,
      pairedRatio: firstValue === 0 ? null : (firstValue - secondValue) / firstValue,
    };
  });
  const firstValues = constituents.map((item) => item.first);
  const secondValues = constituents.map((item) => item.second);
  const ratios = constituents.map((item) => item.pairedRatio).filter((value) => value !== null);
  return {
    rowId: row.id,
    contrastId: definition.id,
    status: ratios.length === constituents.length ? "computed" : "absolute-only",
    aggregation: row.aggregation,
    successFloor: floor,
    n: constituents.length,
    arms: {
      first: { median: median(firstValues), range: range(firstValues) },
      second: { median: median(secondValues), range: range(secondValues) },
    },
    medianPairedRatio: ratios.length === 0 ? null : median(ratios),
    medianPairedPercent: ratios.length === 0 ? null : median(ratios) * 100,
    constituents,
  };
}

export function composeScorecard({
  config,
  inputs,
  repositoryRoot,
  validateRecord = (input) => defaultValidator(repositoryRoot, input),
}) {
  if (config?.scoring?.composer?.path !== "compose-scorecard.mjs") {
    throw new Error("R3_SCORECARD_CONFIG_INVALID: config.scoring does not sanction this composer");
  }
  if (!Array.isArray(inputs)) throw new TypeError("R3 scorecard inputs must be an array");
  const cells = new Map(config.cells.map((cell) => [cell.id, cell]));
  const seen = new Set();
  const validated = inputs.map((input) => {
    const cell = cells.get(input.cellId);
    if (cell === undefined || seen.has(input.cellId)) {
      throw new Error(`R3_SCORECARD_INPUT_IDENTITY: ${input.cellId} is unknown or duplicated`);
    }
    seen.add(input.cellId);
    const errors = validateRecord(input);
    if (!Array.isArray(errors) || errors.length > 0) {
      throw new Error(
        `R3_SCORECARD_INPUT_INVALID: ${input.cellId} failed validation: ${
          Array.isArray(errors) ? errors.join("; ") : "validator returned a non-array verdict"
        }`,
      );
    }
    const isSuccessful = successful(input.record, cell);
    return {
      ...input,
      cell,
      successful: isSuccessful,
      eligible: input.record.socialMessenger.efficiencyScorecardEligibility?.eligible === true,
    };
  });

  const floor = config.scoring.successFloor.minimumSuccessfulReplicatesPerSide;
  const registeredRows = new Map(config.scoring.scorecardRows.map((row) => [row.id, row]));
  const ratioRows = contrastDefinitions(config).flatMap((definition) => {
    const first = summarizeArm(validated, definition, "first");
    const second = summarizeArm(validated, definition, "second");
    return RATIO_ROWS.map((rowId) => composeRatioRow({
      row: registeredRows.get(rowId),
      definition,
      first,
      second,
      floor,
    }));
  });
  return {
    version: R3_SCORECARD_VERSION,
    runId: config.runId,
    composer: config.scoring.composer,
    inputCount: validated.length,
    failureRates: failureRates(validated),
    ratioRows,
    excludedRows: config.scoring.scorecardRows
      .filter((row) => row.excluded === true)
      .map((row) => ({ id: row.id, rationale: row.rationale })),
  };
}

function parseArgs(argv) {
  const options = { configPath: null, outPath: null, records: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--harness-config") options.configPath = argv[++index];
    else if (arg === "--out") options.outPath = argv[++index];
    else if (arg === "--record") options.records.push(argv[++index]);
    else throw new Error(`R3_SCORECARD_USAGE: unknown argument ${arg}`);
  }
  if (options.configPath === null) {
    throw new Error("R3_SCORECARD_USAGE: --harness-config is required");
  }
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  const configPath = resolve(options.configPath);
  const runRoot = dirname(configPath);
  const repositoryRoot = resolve(runRoot, "../../..");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const explicit = new Map(options.records.map((value) => {
    const separator = value.indexOf("=");
    if (separator <= 0) throw new Error("R3_SCORECARD_USAGE: --record must be cellId=path");
    return [value.slice(0, separator), resolve(value.slice(separator + 1))];
  }));
  const inputs = config.cells.flatMap((cell) => {
    const recordPath = explicit.get(cell.id) ?? resolve(runRoot, "cells", cell.id, "record.json");
    if (!existsSync(recordPath)) return [];
    return [{
      cellId: cell.id,
      record: JSON.parse(readFileSync(recordPath, "utf8")),
      artifactRoot: dirname(recordPath),
      path: recordPath,
    }];
  });
  if (explicit.size !== inputs.filter((input) => explicit.has(input.cellId)).length) {
    throw new Error("R3_SCORECARD_INPUT_IDENTITY: one or more explicit records do not name configured cells");
  }
  const result = composeScorecard({ config, inputs, repositoryRoot });
  const bytes = `${JSON.stringify(result, null, 2)}\n`;
  if (options.outPath === null) process.stdout.write(bytes);
  else writeFileSync(resolve(options.outPath), bytes, { flag: "wx" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
