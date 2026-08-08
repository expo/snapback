#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ref LLP 0010#ci-and-review-gates — the canonical proof is a fail-closed
// inventory; root production dependency advisories must not be covered only by
// the separately selected Exact/admin audit.
// @ref LLP 0175#d22-affected-proof — root lock/manifests and publication inputs
// select the affected production-dependency gate through the checked policy.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DISPOSITIONS_PATH = join(ROOT, 'scripts', 'js-production-audit-dispositions.v1.json');
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const KNOWN_SEVERITIES = new Set(['low', 'moderate', 'high', 'critical']);
const ADVISORY_PATTERN = /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/u;

function fail(code, message) {
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  if (args.length === 0) return { auditJsonPath: null };
  if (args.length === 2 && args[0] === '--audit-json') {
    return { auditJsonPath: args[1] };
  }
  throw new Error('usage: node scripts/check-js-production-audit.mjs [--audit-json <path|->]');
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function loadAuditJson(auditJsonPath) {
  if (auditJsonPath !== null) {
    const input = auditJsonPath === '-' ? readFileSync(0, 'utf8') : readFileSync(auditJsonPath, 'utf8');
    return parseJson(input, 'injected Bun audit output');
  }

  const result = spawnSync('bun', ['audit', '--production', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    const detail = result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}`;
    throw new Error(`bun audit --production could not complete: ${detail}`);
  }
  if (!result.stdout.trim()) {
    throw new Error(`bun audit --production returned exit ${result.status} without JSON output`);
  }
  return parseJson(result.stdout, 'Bun audit output');
}

function validateAudit(audit) {
  if (audit === null || Array.isArray(audit) || typeof audit !== 'object') {
    throw new Error('Bun audit output must be a package-keyed object');
  }
  const findings = [];
  for (const [packageName, advisories] of Object.entries(audit)) {
    if (!packageName || !Array.isArray(advisories) || advisories.length === 0) {
      throw new Error(`Bun audit package ${JSON.stringify(packageName)} must have advisories`);
    }
    for (const advisory of advisories) {
      const id = /\/advisories\/(GHSA-[^/?#]+)/u.exec(advisory?.url ?? '')?.[1];
      if (!ADVISORY_PATTERN.test(id ?? '')) {
        throw new Error(`Bun audit advisory for ${packageName} has no valid GHSA URL`);
      }
      if (!KNOWN_SEVERITIES.has(advisory.severity)) {
        throw new Error(`Bun audit advisory ${id} has unknown severity ${JSON.stringify(advisory.severity)}`);
      }
      if (typeof advisory.vulnerable_versions !== 'string' || !advisory.vulnerable_versions) {
        throw new Error(`Bun audit advisory ${id} has no vulnerable version range`);
      }
      findings.push({
        package: packageName,
        advisory: id,
        severity: advisory.severity,
        vulnerableVersions: advisory.vulnerable_versions,
      });
    }
  }
  return findings;
}

function lockedVersion(lockText, packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^    "${escaped}": \\["${escaped}@([^"\\s]+)"`, 'mu').exec(lockText);
  if (!match) throw new Error(`bun.lock does not resolve dispositioned package ${packageName}`);
  return match[1];
}

function validateDispositions(document, lockText) {
  if (document?.schemaVersion !== 'snapback.js-production-audit-dispositions.v1') {
    throw new Error('disposition file has an unsupported schemaVersion');
  }
  if (!Array.isArray(document.dispositions)) {
    throw new Error('disposition file must contain a dispositions array');
  }
  const byKey = new Map();
  for (const disposition of document.dispositions) {
    const key = `${disposition?.package}\u0000${disposition?.advisory}`;
    if (typeof disposition?.package !== 'string' || !disposition.package) {
      throw new Error('every disposition must name a package');
    }
    if (!ADVISORY_PATTERN.test(disposition.advisory ?? '')) {
      throw new Error(`disposition for ${disposition.package} must name a GHSA advisory`);
    }
    if (byKey.has(key)) throw new Error(`duplicate disposition for ${disposition.package} ${disposition.advisory}`);
    if (!KNOWN_SEVERITIES.has(disposition.severity)) {
      throw new Error(`disposition ${disposition.advisory} has an invalid severity`);
    }
    if (typeof disposition.vulnerableVersions !== 'string' || !disposition.vulnerableVersions) {
      throw new Error(`disposition ${disposition.advisory} must pin the vulnerable range`);
    }
    if (!/^\d+\.\d+\.\d+$/u.test(disposition.lockedVersion ?? '')) {
      throw new Error(`disposition ${disposition.advisory} must pin the locked version`);
    }
    const actualLockedVersion = lockedVersion(lockText, disposition.package);
    if (disposition.lockedVersion !== actualLockedVersion) {
      throw new Error(
        `disposition ${disposition.advisory} pins ${disposition.lockedVersion}, `
          + `but bun.lock resolves ${actualLockedVersion}`,
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(disposition.expiresOn ?? '')) {
      throw new Error(`disposition ${disposition.advisory} must have an ISO expiresOn date`);
    }
    for (const field of ['reachability', 'upstreamStatus', 'action']) {
      if (typeof disposition[field] !== 'string' || disposition[field].trim().length < 40) {
        throw new Error(`disposition ${disposition.advisory} must document ${field}`);
      }
    }
    byKey.set(key, disposition);
  }
  return byKey;
}

function main() {
  let options;
  let findings;
  let dispositions;
  try {
    options = parseArguments(process.argv.slice(2));
    findings = validateAudit(loadAuditJson(options.auditJsonPath));
  } catch (error) {
    fail('SNAPBACK_JS_PRODUCTION_AUDIT_EXEC_FAILED', error.message);
    return;
  }
  try {
    dispositions = validateDispositions(
      parseJson(
        readFileSync(DISPOSITIONS_PATH, 'utf8'),
        'JavaScript production audit dispositions',
      ),
      readFileSync(join(ROOT, 'bun.lock'), 'utf8'),
    );
  } catch (error) {
    fail('SNAPBACK_JS_PRODUCTION_AUDIT_DISPOSITION_INVALID', error.message);
    return;
  }

  const activeKeys = new Set();
  const unresolved = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const finding of findings) {
    const key = `${finding.package}\u0000${finding.advisory}`;
    activeKeys.add(key);
    const disposition = dispositions.get(key);
    if (disposition) {
      if (disposition.severity !== finding.severity
          || disposition.vulnerableVersions !== finding.vulnerableVersions) {
        unresolved.push(`${finding.package} ${finding.advisory}: disposition no longer matches audit metadata`);
      } else if (disposition.expiresOn < today) {
        unresolved.push(`${finding.package} ${finding.advisory}: disposition expired ${disposition.expiresOn}`);
      }
    } else if (BLOCKING_SEVERITIES.has(finding.severity)) {
      unresolved.push(`${finding.package} ${finding.advisory} (${finding.severity})`);
    }
  }

  const stale = [...dispositions.entries()]
    .filter(([key]) => !activeKeys.has(key))
    .map(([, disposition]) => `${disposition.package} ${disposition.advisory}`);
  if (stale.length > 0) {
    fail(
      'SNAPBACK_JS_PRODUCTION_AUDIT_DISPOSITION_STALE',
      `remove dispositions absent from the live audit: ${stale.join(', ')}`,
    );
    return;
  }
  if (unresolved.length > 0) {
    fail(
      'SNAPBACK_JS_PRODUCTION_AUDIT_UNRESOLVED_HIGH',
      `unresolved or expired production advisories: ${unresolved.join('; ')}`,
    );
    return;
  }

  const blocking = findings.filter(({ severity }) => BLOCKING_SEVERITIES.has(severity)).length;
  process.stdout.write(
    `[js-production-audit] PASS: ${findings.length} active advisories; `
      + `${blocking} high/critical; ${dispositions.size} current documented dispositions\n`,
  );
}

main();
