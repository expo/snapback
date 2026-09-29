# Round 10 failure accounting

All failures below are **ours**. None is attributed to baseline or environment.
There are no unexpected failing tests in this round's qualification.

## Intentional before-fix failures

`node --test --test-concurrency=2 --test-name-pattern='round 10'
packages/snapback4/test/hook-retention-fences.test.mjs
packages/snapback4/test/ordinary-search.test.mjs`, run against the existing
round-9 built client/server: **0 pass / 5 fail**, exit 1.

- `round 10 process: device-evaluated E_HTTP_RESPONSE replaces mounted peers without HTTP`
- `round 10 process: device-evaluated E_STORE_BUSY replaces mounted peers without HTTP`
- `round 10 process: device-evaluated APP_DENIED replaces mounted peers without HTTP`
- `round 10 mixed search process: missing searchCurrent preserves the page and deadlines`
- `round 10 mixed search wasm: missing searchCurrent preserves the page and deadlines`

The first three fail because a mounted peer still has data instead of the
evaluated denial; the HTTP-query counter is zero. The latter two fail because
the retained page was replaced by E_INPUT. All five pass after the fix, then
all 11 final new cases and all 1,059 affected cases pass. No timeout or assertion
was relaxed. The immutable before output is [before.log.gz](./before.log.gz).

## Orientation/setup errors

- Guessed LLP filename `3000.029-authority-aware-hook-retention.spec.md` was absent;
  read the actual `3000.029-hook-retention-with-invalidation.rfc.md` instead.
- The test glob `*decoder*` matched no file and made that combined lookup exit 2;
  used the existing fence/search/transport tests found by `rg --files`.
- Guessed `src/query-input.ts` was absent; inspected the existing query and
  transport implementations instead.
- Guessed `src/input.ts` was absent; read the actual validation sites and tests.

These read-only lookup failures changed no repository state. Build, typecheck,
whole guide, server overload, affected tests, ref-check and whitespace checks
pass. No complete suite was invoked.
