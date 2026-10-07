#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const PROTOCOL = 'clique-native/1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class FixtureDescriptorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FixtureDescriptorError';
    this.code = code;
  }
}

function requireRunId(value, code = 'fixture-run-id-invalid') {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new FixtureDescriptorError(code, 'run ID must use the canonical lowercase UUID spelling');
  }
  return value;
}

// @ref LLP 0201.000#3 — queued bodies are derived from the current driver nonce.
export function queuedBodiesForRun(runId) {
  requireRunId(runId);
  return [`${runId}:first`, `${runId}:second`];
}

/**
 * Complete a backend-produced descriptor without letting an adapter hand-type
 * the two measurement bodies. All other fields remain backend-owned.
 */
export function createFixtureDescriptor(fields, options = {}) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new FixtureDescriptorError('fixture-descriptor-object', 'fixture fields must be an object');
  }
  const runId = options.runId ?? fields.runId;
  requireRunId(runId);
  return {
    ...fields,
    protocol: PROTOCOL,
    runId,
    queuedBodies: queuedBodiesForRun(runId),
  };
}

/** Validate semantics JSON Schema cannot express: equality to this handoff's run. */
export function validateFixtureDescriptor(descriptor, currentRunId) {
  requireRunId(currentRunId, 'fixture-current-run-id-invalid');
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw new FixtureDescriptorError('fixture-descriptor-object', 'fixture descriptor must be an object');
  }
  if (descriptor.protocol !== PROTOCOL) {
    throw new FixtureDescriptorError('fixture-protocol', `protocol must be ${PROTOCOL}`);
  }
  if (descriptor.runId !== currentRunId) {
    throw new FixtureDescriptorError('fixture-run-id-current', 'descriptor runId does not equal the current handoff run ID');
  }
  const expected = queuedBodiesForRun(currentRunId);
  if (!Array.isArray(descriptor.queuedBodies)
      || descriptor.queuedBodies.length !== 2
      || descriptor.queuedBodies[0] !== expected[0]
      || descriptor.queuedBodies[1] !== expected[1]) {
    throw new FixtureDescriptorError(
      'fixture-queued-bodies-current-run',
      'queuedBodies must be exactly ["<current runId>:first", "<current runId>:second"]',
    );
  }
  return descriptor;
}

function usage() {
  return 'usage: fixture.mjs <construct|validate> --run-id <canonical-lowercase-uuid> [json-file]';
}

function cliArguments(argv) {
  const command = argv[0];
  const runIndex = argv.indexOf('--run-id');
  if (!['construct', 'validate'].includes(command) || runIndex < 0 || !argv[runIndex + 1]) {
    throw new FixtureDescriptorError('fixture-cli-arguments', usage());
  }
  const remaining = argv.slice(1).filter((_, index, all) => index !== runIndex - 1 && index !== runIndex);
  if (remaining.length > 1) throw new FixtureDescriptorError('fixture-cli-arguments', usage());
  return { command, runId: argv[runIndex + 1], file: remaining[0] };
}

async function main(argv) {
  try {
    const { command, runId, file } = cliArguments(argv);
    const text = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
    const input = JSON.parse(text);
    if (command === 'construct') {
      process.stdout.write(`${JSON.stringify(createFixtureDescriptor(input, { runId }))}\n`);
    } else {
      const descriptor = validateFixtureDescriptor(input, runId);
      process.stdout.write(`${JSON.stringify({ valid: true, runId, queuedBodies: descriptor.queuedBodies })}\n`);
    }
  } catch (error) {
    const code = error instanceof FixtureDescriptorError ? error.code : 'fixture-json-invalid';
    process.stderr.write(`${JSON.stringify({ valid: false, code, message: String(error.message ?? error) })}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main(process.argv.slice(2));
}
