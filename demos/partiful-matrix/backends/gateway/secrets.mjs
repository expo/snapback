import { readFileSync } from 'node:fs';
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
  const source = readFileSync(resolve(root, '.agent-local-secrets.md'), 'utf8');
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
