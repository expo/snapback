import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const EXPO_SUPERVISOR_ORIGIN_ENV = 'EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN';

export function isLoopbackHost(host) {
  const normalized = String(host).toLowerCase().replace(/^\[|\]$/gu, '');
  return normalized === '::1'
    || normalized === 'localhost'
    || normalized.startsWith('127.');
}

function routeInvalid(message, origin) {
  const error = new TypeError(`SNAPBACK_EXPO_ROUTE_INVALID: ${message}`);
  error.code = 'SNAPBACK_EXPO_ROUTE_INVALID';
  error.diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code: error.code,
    severity: 'error',
    message,
    details: Object.freeze({ origin }),
  });
  return error;
}

// @ref LLP 0181#e1--simulatoremulator-loop — the only persisted development
// client fact is the credential-free, device-local rendezvous origin. The
// expiring binding and ordinary session still arrive over the no-store
// supervisor exchange and never enter this file.
export function writeExpoClientEnvironment(directory, origin) {
  let parsed;
  try { parsed = new URL(origin); } catch {
    throw routeInvalid(
      'the Expo client environment origin must be an absolute HTTP origin',
      origin,
    );
  }
  if (
    parsed.protocol !== 'http:'
    || (!isLoopbackHost(parsed.hostname) && parsed.hostname !== '10.0.2.2')
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) {
    throw routeInvalid(
      'the Expo client environment origin must be a credential-free device-local HTTP origin',
      origin,
    );
  }

  const environmentPath = join(resolve(directory), '.env.local');
  const existed = existsSync(environmentPath);
  const current = existed ? readFileSync(environmentPath, 'utf8') : '';
  const newline = current.includes('\r\n') ? '\r\n' : '\n';
  const lines = current === '' ? [] : current.split(/\r?\n/u);
  if (lines.at(-1) === '') lines.pop();
  const assignment = `${EXPO_SUPERVISOR_ORIGIN_ENV}=${parsed.origin}`;
  const assignmentPattern = new RegExp(
    `^\\s*(?:export\\s+)?${EXPO_SUPERVISOR_ORIGIN_ENV}\\s*=`,
    'u',
  );
  const nextLines = [];
  let replaced = false;
  for (const line of lines) {
    if (!assignmentPattern.test(line)) {
      nextLines.push(line);
    } else if (!replaced) {
      nextLines.push(assignment);
      replaced = true;
    }
  }
  if (!replaced) nextLines.push(assignment);
  const next = `${nextLines.join(newline)}${newline}`;
  if (next !== current) writeFileSync(environmentPath, next, { mode: 0o600 });
  return Object.freeze({
    formatVersion: 1,
    path: environmentPath,
    key: EXPO_SUPERVISOR_ORIGIN_ENV,
    origin: parsed.origin,
    state: next === current ? 'unchanged' : (existed ? 'updated' : 'created'),
  });
}
