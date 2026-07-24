import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ASSIGNMENT = /^\s*(?:[-*]\s*)?(?:`)?([A-Z][A-Z0-9_]+)(?:`)?\s*=\s*(.+?)\s*$/;

function unquote(value) {
  const trimmed = value.trim().replace(/^`|`$/g, '');
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function loadLocalSecrets(root = resolve(import.meta.dirname, '..', '..', '..', '..')) {
  const values = {};
  // Clean measurement worktrees may deliberately consume the operator's
  // ignored credential file from the primary checkout. Only the directory
  // path crosses the process boundary; secret values remain in memory and
  // never enter receipts or generated artifacts.
  const credentialRoot = process.env.PARTITIME_LOCAL_SECRETS_ROOT ?? root;
  const path = resolve(credentialRoot, '.agent-local-secrets.md');
  if (!existsSync(path)) return values;
  const source = readFileSync(path, 'utf8');
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(ASSIGNMENT);
    if (match) values[match[1]] = unquote(match[2]);
  }
  return values;
}

export function requireSecret(values, ...names) {
  for (const name of names) {
    if (typeof values[name] === 'string' && values[name].length > 3) return values[name];
  }
  throw new Error(`missing local credential: ${names.join(' or ')}`);
}
