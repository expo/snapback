// The Cloudflare-JS leg of the LLP 0048 conformance twin (ENG-23605).
//
// Executes twin-corpus cases against the deployed target's real invocation
// path in Miniflare — gateway → coordinator → handler Worker → JS host-op
// table (src/host-ops.js) → Durable-Object SQLite — and reports each case's
// raw outcome and committed storage for
// crates/snapback-conformance/src/bin/snapback-conformance-twin.rs
// to normalize, diff, and classify against the Ibex and workerd legs.
//
// Protocol: a JSON case list on stdin, `[{name, handler, kind, args}]` with
// kind "query" | "mutation"; a JSON result list on stdout,
// `[{name, outcome, committed}]` shaped exactly like the Rust legs'
// pre-normalization observations:
//   outcome   {ok:true, value:{version, rows}}                      (query)
//             {ok:true, value:{version, changedCount, result}}      (mutation)
//             {ok:false, code}                                      (failure)
//   committed {version, rows} from dumpItems, or {dumpFailed: code}
//
// Every case starts from the reset ground state (version 0, empty tables),
// matching the fresh LocalSnapback the Rust runner constructs per case.
// Classification is not this script's job: it exits 0 whenever every case
// produced an observation, and nonzero only on harness-level failure.
import { startProof } from './harness.mjs';

// Keep the never-settling corpus case (hangForever) fast: the coordinator's
// settlement deadline is deployment config, and the twin only asserts THAT
// it fires, not its production magnitude.
const SETTLEMENT_TIMEOUT_MS = '4000';

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function outcomeFromResponse(kind, response) {
  if (!response || response.ok !== true) {
    const outcome = {
      ok: false,
      code: (response && response.code) || 'SNAPBACK_TWIN_ENGINE_NO_RESPONSE',
    };
    if (outcome.code === 'SNAPBACK_APP_REFUSAL') {
      outcome.details = response.details ?? null;
    }
    return outcome;
  }
  if (kind === 'mutation') {
    return {
      ok: true,
      value: {
        version: response.version,
        changedCount: response.changedCount,
        result: response.result === undefined ? null : response.result,
      },
    };
  }
  return { ok: true, value: { version: response.version, rows: response.rows } };
}

async function main() {
  const cases = JSON.parse(await readStdin());
  const proof = await startProof({
    app: 'twin',
    bindings: { SNAPBACK_SETTLEMENT_TIMEOUT_MS: SETTLEMENT_TIMEOUT_MS },
  });
  const results = [];
  try {
    for (const testCase of cases) {
      await proof.reset();
      if (testCase.seed) {
        const seeded = await proof.mutation(testCase.seed.handler, testCase.seed.args);
        if (!seeded || seeded.ok !== true) {
          throw new Error(`seed mutation ${testCase.seed.handler} failed for ${testCase.name}`);
        }
      }
      const response =
        testCase.kind === 'mutation'
          ? await proof.mutation(testCase.handler, testCase.args)
          : await proof.query(testCase.handler, testCase.args);
      const outcome = outcomeFromResponse(testCase.kind, response);
      const dump = await proof.query('dumpItems', {});
      const committed =
        dump && dump.ok === true
          ? { version: dump.version, rows: dump.rows }
          : { dumpFailed: (dump && dump.code) || 'SNAPBACK_TWIN_ENGINE_NO_RESPONSE' };
      results.push({ name: testCase.name, outcome, committed });
    }
  } finally {
    await proof.dispose();
  }
  process.stdout.write(JSON.stringify(results));
}

main().catch((error) => {
  process.stderr.write(`twin-engine failed: ${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
