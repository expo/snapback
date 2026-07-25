// LLP 0049 Phase 1 Miniflare acceptance: the Cloudflare deploy-time-binding
// secrets backend (LLP 0036) for All Aboard.
//
// Exit evidence: a granted action observes a redacted descriptor handle; a
// missing configured value produces SNAPBACK_CONFIG_MISSING; the handler
// invocation payload carries descriptors only (asserted, not assumed);
// .expose()/.asBearer() fail closed with the profile's coded error; queries
// and mutations cannot access ctx.secrets; destructive reset does not clear
// configured secrets; the config.set walk-through attests `applied` via the
// generation carrier and stays `pending` without a generation-bearing
// activation; and no surface leaks configured key material.
//
// Run: node cloudflare/test/acceptance.secrets.mjs
import { startProof, ADMIN_TOKEN } from './harness.mjs';
import { buildBulkPayload, attestApplied, bindingNameFor } from '../config-set.mjs';

const KEY_A = 'test-511-key-alpha';
const KEY_B = 'test-511-key-beta';
const SECRET_BINDINGS = {
  [bindingNameFor('all-aboard', 'caltrainFeed')]: JSON.stringify([KEY_A, KEY_B]),
  SNAPBACK_CONFIG_GENERATION: '7',
  // directions is declared by the app but deliberately NOT set.
};

const EXPECTED_CHECKS = 16;
let checks = 0;
function check(label, condition) {
  checks += 1;
  if (!condition) {
    throw new Error(`ACCEPTANCE FAILED [${label}]`);
  }
  console.log(`ok ${checks} - ${label}`);
}

function containsKeyMaterial(value) {
  const text = JSON.stringify(value);
  return text.includes(KEY_A) || text.includes(KEY_B);
}

async function main() {
  const proof = await startProof({ app: 'all-aboard', port: 0, bindings: SECRET_BINDINGS });
  const base = await proof.url();
  const post = async (path, body) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return response.json();
  };
  try {
    // --- config status ----------------------------------------------------
    const status = await (await fetch(`${base}/_snapback/api/config/status`, {
      headers: { 'x-snapback-admin-token': ADMIN_TOKEN },
    })).json();
    const caltrain = status.declarations.find((entry) => entry.name === 'caltrainFeed');
    const directions = status.declarations.find((entry) => entry.name === 'directions');
    check(
      'config status reports declarations with set/missing state and pool member counts',
      caltrain.state === 'set' && caltrain.poolMembers === 2 && directions.state === 'missing'
    );
    check(
      'config status reports grant relationships, generation, and declaration hash',
      status.grants.refreshFeed.includes('caltrainFeed') &&
        status.grants.routeEstimate.includes('directions') &&
        status.generation === 7 &&
        /^sha256:[0-9a-f]{16}$/.test(status.declarationHash) &&
        status.backend === 'deploy-time-binding'
    );
    check('config status carries no key material', !containsKeyMaterial(status));

    // --- invocation payload: descriptors only ------------------------------
    const payload = await post('/_snapback/test/secrets-payload', { name: 'probeSecrets' });
    const grants = JSON.parse(payload.secretsJson);
    check(
      'action invocation payload carries descriptors only (asserted, not by convention)',
      grants.descriptorsOnly === true &&
        grants.entries.caltrainFeed.set === true &&
        grants.entries.caltrainFeed.memberCount === 2 &&
        !('values' in grants.entries.caltrainFeed) &&
        !containsKeyMaterial(payload)
    );

    // --- granted action sees redacted, fail-closed handles ----------------
    const run1 = await post('/_snapback/test/action', { name: 'probeSecrets' });
    const probe1 = run1.result;
    check('granted action receives ctx.secrets', run1.ok === true && probe1.secretsType === 'object');
    check(
      'every materialization path yields the redacted marker',
      probe1.caltrainFeed.marker === '[snapback secret caltrainFeed]' &&
        probe1.caltrainFeed.json === '"[snapback secret caltrainFeed]"' &&
        probe1.caltrainFeed.template === '[snapback secret caltrainFeed]'
    );
    check(
      '.expose() and .asBearer() fail closed with the profile coded error',
      probe1.caltrainFeed.exposeError === 'SNAPBACK_CONFIG_EXPOSE_UNSUPPORTED' &&
        probe1.caltrainFeed.bearerError === 'SNAPBACK_CONFIG_EXPOSE_UNSUPPORTED'
    );
    check(
      'a declared-but-unset entry produces SNAPBACK_CONFIG_MISSING',
      probe1.directions.granted === false && probe1.directions.error === 'SNAPBACK_CONFIG_MISSING'
    );
    check(
      'an entry outside the uses grant produces SNAPBACK_CONFIG_UNDECLARED',
      probe1.undeclared.granted === false && probe1.undeclared.error === 'SNAPBACK_CONFIG_UNDECLARED'
    );
    check('the action result carries no key material', !containsKeyMaterial(run1));

    // --- invocation-scoped opaque capabilities ---------------------------
    const run2 = await post('/_snapback/test/action', { name: 'probeSecrets' });
    const run3 = await post('/_snapback/test/action', { name: 'probeSecrets' });
    check(
      'secret capabilities are opaque and freshly scoped to each invocation',
      typeof probe1.caltrainFeed.descriptor.capabilityId === 'string' &&
        probe1.caltrainFeed.descriptor.capabilityId !== run2.result.caltrainFeed.descriptor.capabilityId &&
        run2.result.caltrainFeed.descriptor.capabilityId !== run3.result.caltrainFeed.descriptor.capabilityId
    );

    // --- queries and mutations are secret-free -----------------------------
    const queryProbe = await proof.query('probeSecretsQuery', {});
    const mutationProbe = await proof.mutation('probeSecretsMutation', {});
    check(
      'queries and mutations cannot access ctx.secrets',
      queryProbe.rows.secretsType === 'undefined' && mutationProbe.result.secretsType === 'undefined'
    );

    // --- destructive reset does not clear configured secrets ---------------
    await proof.reset();
    const statusAfterReset = await (await fetch(`${base}/_snapback/api/config/status`, {
      headers: { 'x-snapback-admin-token': ADMIN_TOKEN },
    })).json();
    const caltrainAfter = statusAfterReset.declarations.find((entry) => entry.name === 'caltrainFeed');
    check(
      'destructive reset leaves configured secrets and generation intact',
      caltrainAfter.state === 'set' && statusAfterReset.generation === 7
    );

    // --- config.set walk-through: pending -> applied attestation ----------
    const staged = statusAfterReset.generation + 1; // stage generation 8
    const bulk = buildBulkPayload('all-aboard', { caltrainFeed: JSON.stringify([KEY_A]) }, staged);
    check(
      'the bulk payload carries the changed entries plus the bumped generation in one activation',
      bulk[bindingNameFor('all-aboard', 'caltrainFeed')] === JSON.stringify([KEY_A]) &&
        bulk.SNAPBACK_CONFIG_GENERATION === String(staged)
    );
    // An entry write with NO generation-bearing activation: the runtime still
    // reports generation 7, so the writer's staged generation 8 stays pending.
    const pending = await attestApplied(base, staged, {
      timeoutMs: 1200,
      intervalMs: 300,
      adminToken: ADMIN_TOKEN,
      expectedEntries: { caltrainFeed: [KEY_A] },
    });
    check('without a generation-bearing activation the write stays pending', pending === 'pending');
    // The generation-bearing activation lands (a fresh deployment whose env
    // carries the bumped stamp — Miniflare's projection of the bulk write's
    // activation): the same attestation now reports applied.
    const activated = await startProof({
      app: 'all-aboard',
      port: 0,
      bindings: { ...SECRET_BINDINGS, SNAPBACK_CONFIG_GENERATION: String(staged) },
    });
    try {
      const activatedBase = await activated.url();
      const applied = await attestApplied(activatedBase, staged, {
        timeoutMs: 5000,
        intervalMs: 200,
        adminToken: ADMIN_TOKEN,
        expectedEntries: { caltrainFeed: [KEY_A, KEY_B] },
      });
      check('the generation-bearing activation attests applied via /_snapback/api/config/status', applied === 'applied');
    } finally {
      await activated.dispose();
    }

    if (checks !== EXPECTED_CHECKS) {
      throw new Error(`expected ${EXPECTED_CHECKS} checks, ran ${checks}`);
    }
    console.log(`\ncloudflare secrets acceptance: ${checks}/${EXPECTED_CHECKS} checks passed`);
  } finally {
    await proof.dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
