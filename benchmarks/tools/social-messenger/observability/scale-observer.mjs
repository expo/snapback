#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const STATES = new Set(["starting", "running", "succeeded", "failed", "cancelled", "refused"]);
const TERMINAL = new Set(["succeeded", "failed", "cancelled", "refused"]);
const OUTCOMES = new Set(["application", "platform", "setup", "instrument"]);

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

export function observeScaleStatus(value, { path = null, sha256 = null, observedAt = new Date().toISOString() } = {}) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new TypeError("scale status must be an object");
  const unknown = Object.keys(value).filter((key) => ![
    "schemaVersion", "runId", "pid", "state", "actions", "updatedAt", "outcomeClass", "receipt",
  ].includes(key));
  if (unknown.length > 0) throw new Error(`scale status has unknown field: ${unknown[0]}`);
  if (value.schemaVersion !== "social-messenger.scale-status.v1") {
    throw new Error("scale status must use social-messenger.scale-status.v1");
  }
  requiredString(value.runId, "scale status runId");
  if (!Number.isInteger(value.pid) || value.pid <= 0) throw new TypeError("scale status pid must be a positive integer");
  if (!STATES.has(value.state)) throw new TypeError(`scale status state is invalid: ${value.state}`);
  if (!Number.isInteger(value.actions?.applied) || value.actions.applied < 0) {
    throw new TypeError("scale status actions.applied must be a non-negative integer");
  }
  if (!Number.isInteger(value.actions?.total) || value.actions.total <= 0) {
    throw new TypeError("scale status actions.total must be a positive integer");
  }
  if (value.actions.applied > value.actions.total) throw new Error("scale status applied actions exceed total actions");
  if (!Number.isInteger(value.actions?.failed) || value.actions.failed < 0) {
    throw new TypeError("scale status actions.failed must be a non-negative integer");
  }
  const unknownActions = Object.keys(value.actions).filter((key) => !["applied", "total", "failed"].includes(key));
  if (unknownActions.length > 0) throw new Error(`scale status actions has unknown field: ${unknownActions[0]}`);
  if (!Number.isFinite(Date.parse(value.updatedAt))) throw new TypeError("scale status updatedAt must be RFC3339");
  const terminal = TERMINAL.has(value.state);
  if (value.state === "succeeded" && value.actions.applied !== value.actions.total) {
    throw new Error("succeeded scale status must have applied every action");
  }
  if (value.state === "succeeded" && value.actions.failed !== 0) {
    throw new Error("succeeded scale status cannot retain failed actions");
  }
  if (value.state !== "succeeded" && terminal && !OUTCOMES.has(value.outcomeClass)) {
    throw new Error("non-green terminal scale status requires an outcomeClass");
  }
  if (!terminal && value.outcomeClass != null) throw new Error("non-terminal scale status cannot declare an outcomeClass");
  if (value.state === "succeeded" && value.outcomeClass != null) throw new Error("succeeded scale status cannot declare an outcomeClass");
  if (terminal && (typeof value.receipt !== "string" || value.receipt.length === 0)) {
    throw new Error("terminal scale status requires a retained receipt path");
  }
  const ageMs = Math.max(0, Date.parse(observedAt) - Date.parse(value.updatedAt));
  return {
    schemaVersion: "social-messenger.scale-observation.v1",
    runId: value.runId,
    detachedPid: value.pid,
    state: value.state,
    terminal,
    outcomeClass: value.outcomeClass ?? null,
    actions: {
      applied: value.actions.applied,
      total: value.actions.total,
      failed: value.actions.failed,
      percent: Math.round((value.actions.applied / value.actions.total) * 1_000) / 10,
    },
    updatedAt: value.updatedAt,
    observedAt,
    ageMs,
    receipt: value.receipt ?? null,
    statusIdentity: path === null ? null : { path, sha256 },
  };
}

export async function readScaleObservation(path) {
  const absolutePath = resolve(path);
  const bytes = await readFile(absolutePath);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  return observeScaleStatus(JSON.parse(bytes), { path: absolutePath, sha256: digest });
}

function parseArgs(argv) {
  const options = { path: null, follow: false, intervalMs: 1_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--status") options.path = argv[++index];
    else if (arg === "--follow") options.follow = true;
    else if (arg === "--interval") options.intervalMs = Number(argv[++index]);
    else throw new Error(`unknown scale-observer option: ${arg}`);
  }
  if (!options.path) throw new Error("--status is required");
  if (!Number.isInteger(options.intervalMs) || options.intervalMs < 100) throw new Error("--interval must be at least 100ms");
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let previousIdentity = null;
  while (true) {
    const file = await stat(options.path);
    const identity = `${file.size}:${file.mtimeMs}`;
    if (identity !== previousIdentity) {
      const observation = await readScaleObservation(options.path);
      process.stdout.write(`STRUCTURED SCALE OBSERVATION ${JSON.stringify(observation)}\n`);
      previousIdentity = identity;
      if (observation.terminal) return;
    }
    if (!options.follow) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, options.intervalMs));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`scale observer refusal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
