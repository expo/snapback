// Publishable-key readiness probe for the hosted Supabase project.
//
// Probes endpoints a publishable key is actually entitled to. The original
// matrix build probed `GET /rest/v1/` — the OpenAPI introspection root, which
// is deliberately secret-only for sb_publishable_*/sb_secret_* key projects —
// and misread the resulting 401 as "publishable key never authenticated"
// (REPORT.md §7.2). Auth health and a table read are the correct signals.

const timeout = () => AbortSignal.timeout(10_000);

export async function probeSupabasePublishable({ url, publishableKey }) {
  const checks = [];
  const probe = async (label, path, expect) => {
    let status = null;
    let detail = null;
    try {
      const response = await fetch(`${url}${path}`, { headers: { apikey: publishableKey }, signal: timeout() });
      status = response.status;
      if (!expect(status)) detail = (await response.text()).slice(0, 200);
    } catch (error) {
      detail = String(error);
    }
    checks.push({ label, path, status, ok: status !== null && expect(status), detail });
  };
  await probe('auth-health', '/auth/v1/health', (status) => status === 200);
  await probe('data-api-table-read', '/rest/v1/partiful_matrix_events?select=id&limit=1', (status) => status === 200);
  // Regression witness for the historical misprobe: the OpenAPI root is
  // EXPECTED to reject publishable keys. Its 401 is policy, not breakage.
  await probe('openapi-root-secret-only', '/rest/v1/', (status) => status === 401);
  return { ok: checks.every((check) => check.ok), checks };
}

if (import.meta.main) {
  const { loadLocalSecrets, requireSecret } = await import('../../backends/gateway/secrets.mjs');
  const secrets = loadLocalSecrets();
  const result = await probeSupabasePublishable({
    url: process.env.SUPABASE_URL ?? requireSecret(secrets, 'SUPABASE_URL'),
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? requireSecret(secrets, 'SUPABASE_PUBLISHABLE_KEY'),
  });
  console.log(JSON.stringify({ schemaVersion: 'partitime.supabase-publishable-probe.v1', ...result }, null, 2));
  if (!result.ok) process.exit(1);
}
