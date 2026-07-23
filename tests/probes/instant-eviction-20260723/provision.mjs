// Provision a fresh ephemeral InstantDB app (no auth required) because the
// human-provisioned admin token does not match the provisioned app id.
// Writes the new credentials to .env.ephemeral (secret) and prints only the
// public app id + expiry.
import { writeFileSync } from 'fs';

const resp = await fetch('https://api.instantdb.com/dash/apps/ephemeral', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'llp-0086-cc3-3-probe' }),
});
const body = await resp.json();
if (!resp.ok) {
  console.log('FAILED', resp.status, JSON.stringify(body));
  process.exit(1);
}
const app = body.app;
writeFileSync(
  new URL('./.env.ephemeral', import.meta.url),
  `INSTANT_APP_ID=${app.id}\nINSTANT_APP_ADMIN_TOKEN=${app['admin-token']}\n`,
  { mode: 0o600 },
);
console.log('OK app id:', app.id, 'expires_ms:', body.expires_ms, 'title:', app.title);
