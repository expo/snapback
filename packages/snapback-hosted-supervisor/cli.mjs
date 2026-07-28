#!/usr/bin/env node
// The production transport is intentionally tiny: one closed request on stdin
// and one secret-free response. Provider bearers remain in supervisor custody.
import { HostedSupervisor, SupervisorRefusal } from './index.mjs';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
try {
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (request?.schemaVersion !== 'snapback.hosted-supervisor-request.v1') {
    throw new SupervisorRefusal('SNAPBACK_SUPERVISOR_REQUEST_INVALID', 'unknown request schema');
  }
  const supervisor = new HostedSupervisor(request.state);
  if (request.operation !== 'admitRoster') {
    throw new SupervisorRefusal('SNAPBACK_SUPERVISOR_OPERATION_UNKNOWN', 'unknown supervisor operation');
  }
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 'snapback.hosted-supervisor-response.v1',
    ok: true,
    result: supervisor.admitRoster(request.input),
  })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 'snapback.hosted-supervisor-response.v1',
    ok: false,
    diagnostic: {
      code: error instanceof SupervisorRefusal ? error.code : 'SNAPBACK_SUPERVISOR_INTERNAL',
      message: String(error?.message ?? error).slice(0, 512),
    },
  })}\n`);
  process.exitCode = 2;
}
