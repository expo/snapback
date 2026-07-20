// Deploys the UNION codebase (chat + mirrored partiful modules — see
// convex/events.ts header), sets the OpenRouter key as a deployment env var,
// and re-seeds the partiful fixture so the sibling demo stays green.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { convexDeploymentUrl } from '../../partiful-matrix/backends/gateway/convex.ts';
import { loadLocalSecrets, requireSecret } from '../../partiful-matrix/backends/gateway/secrets.mjs';
import { loadOpenRouterKey } from '../gateway/openrouter.ts';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const secrets = loadLocalSecrets(repoRoot);
const deployKey = requireSecret(secrets, 'CONVEX_DEPLOY_KEY');
const convexUrl = convexDeploymentUrl(deployKey);
const env = { ...process.env, CONVEX_DEPLOY_KEY: deployKey };

const deployed = spawnSync('npx', ['convex', 'deploy', '--typecheck', 'enable'], {
  cwd: import.meta.dirname,
  env,
  stdio: 'inherit',
});
if (deployed.status !== 0) process.exit(deployed.status ?? 1);

const envSet = spawnSync('npx', ['convex', 'env', 'set', 'OPENROUTER_API_KEY', loadOpenRouterKey()], {
  cwd: import.meta.dirname,
  env,
  stdio: 'inherit',
});
if (envSet.status !== 0) process.exit(envSet.status ?? 1);

const partifulSeed = JSON.parse(readFileSync(resolve(repoRoot, 'demos/partiful-matrix/shared/seed.json'), 'utf8'));
const response = await fetch(`${convexUrl}/api/mutation`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ path: 'events:seed', args: partifulSeed, format: 'json' }),
});
const payload = await response.json();
if (!response.ok || payload.status !== 'success') {
  throw new Error(payload?.errorMessage || `partiful reseed failed with HTTP ${response.status}`);
}
console.log('[chat-matrix] Convex union deploy complete; OpenRouter key set; partiful fixture reseeded');
