// Generates .env (gitignored) with the PUBLIC cell configuration, pulling the
// Supabase URL/publishable key and Convex URL from the repo's local secrets
// file. Nothing privileged is ever written here.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..');
const source = readFileSync(resolve(repoRoot, '.agent-local-secrets.md'), 'utf8');
// The secrets file may hold placeholder template lines (NAME=...) above the
// real assignment; take the last non-placeholder match.
const get = (name) => {
  const matches = [...source.matchAll(new RegExp(`^\\s*(?:[-*]\\s*)?\`?${name}\`?\\s*=\\s*(.+?)\\s*$`, 'gm'))]
    .map((match) => match[1].replace(/^"|"$/g, ''))
    .filter((value) => value && value !== '...');
  return matches.at(-1);
};

const deployKey = get('CONVEX_DEPLOY_KEY') ?? '';
const convexSlug = deployKey.includes('|') ? deployKey.split('|')[0].split(':').pop() : null;
const lines = [
  `EXPO_PUBLIC_SUPABASE_URL=${get('SUPABASE_URL') ?? ''}`,
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${get('SUPABASE_PUBLISHABLE_KEY') ?? ''}`,
  `EXPO_PUBLIC_CONVEX_URL=${convexSlug ? `https://${convexSlug}.convex.cloud` : (get('CONVEX_URL') ?? '').replace(/\/$/, '')}`,
];
writeFileSync(resolve(import.meta.dirname, '..', '.env'), lines.join('\n') + '\n');
console.log('[chat-matrix] expo/.env written (public values only)');
