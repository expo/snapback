import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import seed from '../../shared/seed.json' with { type: 'json' };
import { convexDeploymentUrl } from '../gateway/convex.ts';
import { loadLocalSecrets, requireSecret } from '../gateway/secrets.mjs';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..');
const secrets = loadLocalSecrets(repoRoot);
const deployKey = requireSecret(secrets, 'CONVEX_DEPLOY_KEY');
const convexUrl = convexDeploymentUrl(deployKey);

const deployed = spawnSync('npx', ['convex', 'deploy', '--typecheck', 'enable'], {
  cwd: import.meta.dirname,
  env: { ...process.env, CONVEX_DEPLOY_KEY: deployKey },
  stdio: 'inherit',
});
if (deployed.status !== 0) process.exit(deployed.status ?? 1);

const response = await fetch(`${convexUrl}/api/mutation`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ path: 'events:seed', args: seed, format: 'json' }),
});
const text = await response.text();
const payload = text ? JSON.parse(text) : null;
if (!response.ok || payload.status !== 'success') {
  throw new Error(payload?.errorMessage || `seed failed with HTTP ${response.status}`);
}
console.log('[partiful-matrix] Convex schema, functions, and deterministic fixture are ready');
