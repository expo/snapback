import { createHmac } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { relative, resolve, sep } from 'node:path';

import { canonicalJson } from './canonical-json.mjs';
import { fail } from './failure.mjs';

const ACTION_CLASSES = new Set([
  'guide-reference-lookup',
  'package-source-read',
  'binary-string-excavation',
  'edit',
  'process-launch',
  'proof-command',
  'retry',
]);

const RESULT_STATUSES = new Set(['success', 'error', 'timeout', 'cancelled']);

const SCRUBBERS = [
  {
    code: 'SECRET_PATTERN',
    replacement: '<redacted:secret>',
    regex: /\b(?:AKIA[0-9A-Z]{16}|(?:sk|ghp|github_pat|xox[baprs])[_-][A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]+=*|(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+)/gi,
  },
  {
    code: 'PII_EMAIL',
    replacement: '<redacted:email>',
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    code: 'PII_PHONE',
    replacement: '<redacted:pii>',
    regex: /\+\d[\d ().-]{7,}\d/g,
  },
  {
    code: 'PRIVATE_PATH',
    replacement: '<redacted:path>',
    regex: /(?:(?<![:/])\/(?:[^/\s"'`,;]+\/)+[^\s"'`,;]+|[A-Za-z]:\\(?:[^\\\s"'`,;]+\\)+[^\s"'`,;]+)/g,
  },
  {
    code: 'MACHINE_IDENTIFIER',
    replacement: '<redacted:machine-id>',
    regex: /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|(?:\d{1,3}\.){3}\d{1,3}|[A-Za-z0-9][A-Za-z0-9._-]*\.(?:local|lan|internal)|host(?:name)?\s*[:=]\s*[^\s,;]+)\b/gi,
  },
];

function inside(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep));
}

function readKey({ root, keyFile, allowUnsafeTestPaths }) {
  if (!keyFile) fail('HMAC_KEY_MISSING', 'SNAPBACK_BENCHMARK_HMAC_KEY_FILE must name the out-of-repo key file');
  const absolute = resolve(keyFile);
  if (!existsSync(absolute)) fail('HMAC_KEY_MISSING', 'the named HMAC key file does not exist');
  const real = realpathSync(absolute);
  if (!allowUnsafeTestPaths && inside(root, real)) {
    fail('HMAC_KEY_IN_REPOSITORY', 'the HMAC key file must be outside the repository');
  }
  const linkStat = lstatSync(absolute);
  if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
    fail('HMAC_KEY_UNSAFE', 'the HMAC key must be a regular, non-symlink file');
  }
  if ((linkStat.mode & 0o077) !== 0) {
    fail('HMAC_KEY_PERMISSIONS', 'the HMAC key file must not be group/world accessible');
  }
  const key = readFileSync(real);
  if (key.length < 32) fail('HMAC_KEY_TOO_SHORT', 'the HMAC key must contain at least 32 bytes');
  return key;
}

function keyedHex(key, purpose, value) {
  return createHmac('sha256', key).update(`${purpose}\0`).update(value).digest('hex');
}

function scrubString(value) {
  let sanitized = value;
  const codes = [];
  for (const scrubber of SCRUBBERS) {
    scrubber.regex.lastIndex = 0;
    if (scrubber.regex.test(sanitized)) {
      codes.push(scrubber.code);
      scrubber.regex.lastIndex = 0;
      sanitized = sanitized.replace(scrubber.regex, scrubber.replacement);
    }
  }
  return { value: sanitized, codes };
}

function containsSensitiveString(value) {
  return SCRUBBERS.some((scrubber) => {
    scrubber.regex.lastIndex = 0;
    return scrubber.regex.test(value);
  });
}

function scanPublic(value, path = '$') {
  if (typeof value === 'string' && containsSensitiveString(value)) {
    fail('PUBLIC_SCRUB_SCAN_FAILED', `${path}: secret/PII/path scanner still matches public output`);
  }
  if (Array.isArray(value)) value.forEach((item, index) => scanPublic(item, `${path}/${index}`));
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) scanPublic(child, `${path}/${key}`);
  }
}

function requireIso(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || !/^\d{4}-\d\d-\d\dT/.test(value)) {
    fail('UNSAFE_REDACTION_REQUIRED_FIELD', `${label} must survive as an RFC 3339 timestamp`);
  }
  return value;
}

function ensurePrivateStore({ root, privateStore, allowUnsafeTestPaths }) {
  if (!privateStore) fail('PRIVATE_STORE_MISSING', '--private-store must name an access-controlled store');
  const absolute = resolve(privateStore);
  if (!existsSync(absolute)) mkdirSync(absolute, { recursive: true, mode: 0o700 });
  const storeStat = lstatSync(absolute);
  if (storeStat.isSymbolicLink() || !storeStat.isDirectory()) {
    fail('PRIVATE_STORE_UNSAFE', 'private evidence store must be a regular, non-symlink directory');
  }
  const real = realpathSync(absolute);
  if (!allowUnsafeTestPaths && inside(root, real)) {
    fail('PRIVATE_STORE_IN_REPOSITORY', 'the private evidence store must be outside the repository');
  }
  if ((storeStat.mode & 0o077) !== 0) {
    fail('PRIVATE_STORE_PERMISSIONS', 'private evidence store must have mode 0700 or stricter');
  }
  return real;
}

function ensureEvidenceDirectory(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const directoryStat = lstatSync(path);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()
      || (directoryStat.mode & 0o077) !== 0) {
    fail('PRIVATE_STORE_UNSAFE', 'private evidence directory is not a mode-0700 regular directory');
  }
}

function retainedInformation(value) {
  return value.replace(/<redacted:[^>]+>/g, '').replace(/[^A-Za-z0-9]/g, '').length;
}

// @ref LLP 0197#the-standard — rule 5: public audit metadata is separated from keyed private originals.
export function sanitizeTrace({
  root,
  rawTrace,
  privateStore,
  keyFile,
  allowUnsafeTestPaths = false,
}) {
  if (!rawTrace || rawTrace.schemaVersion !== 1 || !Array.isArray(rawTrace.invocations)) {
    fail('INVALID_RAW_TRACE', 'raw trace must have schemaVersion 1 and invocations[]');
  }
  if (typeof rawTrace.synthetic !== 'boolean') {
    fail('INVALID_RAW_TRACE', 'raw trace must explicitly label synthetic status');
  }
  if (rawTrace.invocations.length === 0) fail('INVALID_RAW_TRACE', 'raw trace must contain at least one invocation');
  const key = readKey({ root, keyFile, allowUnsafeTestPaths });
  const store = ensurePrivateStore({ root, privateStore, allowUnsafeTestPaths });

  const invocations = rawTrace.invocations.map((invocation, index) => {
    if (!ACTION_CLASSES.has(invocation.actionClass)) {
      fail('UNSAFE_REDACTION_REQUIRED_FIELD', `invocations[${index}].actionClass is missing or not a normalized class`);
    }
    if (!RESULT_STATUSES.has(invocation.resultStatus)) {
      fail('UNSAFE_REDACTION_REQUIRED_FIELD', `invocations[${index}].resultStatus is missing or not normalized`);
    }
    const startedAt = requireIso(invocation.startedAt, `invocations[${index}].startedAt`);
    const finishedAt = requireIso(invocation.finishedAt, `invocations[${index}].finishedAt`);
    const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
    if (durationMs < 0) {
      fail('UNSAFE_REDACTION_REQUIRED_FIELD', `invocations[${index}] finishes before it starts`);
    }
    if (typeof invocation.toolName !== 'string' || invocation.toolName.length === 0) {
      fail('UNSAFE_REDACTION_REQUIRED_FIELD', `invocations[${index}].toolName is missing`);
    }
    const scrubbedToolName = scrubString(invocation.toolName);
    if (retainedInformation(scrubbedToolName.value) < 2) {
      fail(
        'UNSAFE_REDACTION_REQUIRED_FIELD',
        `invocations[${index}].toolName consists only of material that must be redacted`,
      );
    }

    const original = canonicalJson(invocation);
    const evidenceId = `ev_${keyedHex(key, `evidence-id:${index}`, original).slice(0, 32)}`;
    const integrityCommitment = `hmac-sha256:${keyedHex(key, 'integrity', original)}`;
    const evidenceRoot = resolve(store, 'evidence');
    ensureEvidenceDirectory(evidenceRoot);
    const evidenceDirectory = resolve(evidenceRoot, evidenceId);
    ensureEvidenceDirectory(evidenceDirectory);
    const originalPath = resolve(evidenceDirectory, 'original.json');
    if (existsSync(originalPath)) {
      const originalStat = lstatSync(originalPath);
      if (originalStat.isSymbolicLink() || !originalStat.isFile()
          || (originalStat.mode & 0o077) !== 0) {
        fail('PRIVATE_STORE_UNSAFE', `${evidenceId}: private original is not a mode-0600 regular file`);
      }
      const existing = readFileSync(originalPath, 'utf8');
      if (existing !== original) {
        fail('PRIVATE_EVIDENCE_COLLISION', `${evidenceId}: existing private original differs`);
      }
    } else {
      writeFileSync(originalPath, original, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    }

    const redactions = [
      { field: '$', reasonCode: 'PRIVATE_ORIGINAL' },
      ...(Object.hasOwn(invocation, 'arguments')
        ? [{ field: 'arguments', reasonCode: 'PRIVATE_TOOL_ARGUMENT' }]
        : []),
      ...(Object.hasOwn(invocation, 'transcript')
        ? [{ field: 'transcript', reasonCode: 'PRIVATE_TRANSCRIPT' }]
        : []),
      ...scrubbedToolName.codes.map((reasonCode) => ({ field: 'toolName', reasonCode })),
    ];
    return {
      actionClass: invocation.actionClass,
      toolName: scrubbedToolName.value,
      timing: { startedAt, finishedAt, durationMs },
      resultStatus: invocation.resultStatus,
      evidenceId,
      integrityCommitment,
      redactions,
    };
  });

  const sanitized = {
    schemaVersion: 1,
    synthetic: rawTrace.synthetic,
    sanitizer: 'llp0197-rule5-v1',
    reviewRequired: true,
    invocations,
  };
  scanPublic(sanitized);
  return sanitized;
}

export function parseRawTraceFile({ root, inputPath, allowUnsafeTestPaths = false }) {
  const absolute = resolve(inputPath);
  if (!existsSync(absolute)) fail('INVALID_RAW_TRACE', 'raw trace file does not exist');
  const real = realpathSync(absolute);
  if (!allowUnsafeTestPaths && inside(root, real)) {
    fail('RAW_TRACE_IN_REPOSITORY', 'raw traces must not be read from a repository path');
  }
  try {
    return JSON.parse(readFileSync(real, 'utf8'));
  } catch (error) {
    fail('INVALID_RAW_TRACE', `cannot parse raw trace: ${error.message}`);
  }
}
