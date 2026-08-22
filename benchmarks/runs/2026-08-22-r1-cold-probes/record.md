# LLP 0295 R1 cold packed probes — 2026-08-22

**Status:** six packed web/provider cells green; the W6 native launch witness
is blocked by the available host and remains open. This is an R1 engineering
qualification record, not an R2/R3 comparative result and not an expansion of
the benchmark matrix.

## Pin and method

- Repository and `origin/main`: `fa36a048e8e08f188ca0d486f76f7bb12b3541f2`.
- Runtime: bootstrap-qualified `darwin-arm64` debug binary, SHA-256
  `4e82018109e49c94dfe6b0eea4f1af00f3610b632d9207defe8fdfdfd9207bf6`,
  restricted-no-eval VM qualification green.
- Node: `/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node`; Bun came
  from the repository pin.
- Every matrix invocation of
  `packages/snapback-cli/packed-dev-lifecycle.test.mjs` packed a new external
  tarball closure, installed it into a new directory, created a new SQLite
  store and two new durable auth partitions, and removed the directory after
  writing its receipt.
- The driver reused W1's real CLI attach / Vite plugin / Expo supervisor and
  provider paths, W3's Explicit and Familiar generated contracts, and the
  packed auth-settlement path. It did not inspect Snapback or Exact sources
  while executing any cold cell.

## Results

| Stack | Profile | M1 password + durable custody | Live two-client query | Additive schema, accounts/sessions intact | Result |
| --- | --- | --- | --- | --- | --- |
| Headless | Explicit | green, two distinct sessions | green, stream | green | PASS |
| Headless | Familiar | green, two distinct sessions | green, stream | green | PASS |
| Vite/Exact carrier | Explicit | green, two distinct sessions | green, stream | green | PASS |
| Vite/Exact carrier | Familiar | green, two distinct sessions | green, stream | green | PASS |
| Expo provider (web) | Explicit | green, two distinct sessions | green, stream | green; cold reattach after one binding term also green | PASS |
| Expo provider (web) | Familiar | green, two distinct sessions | green, stream | green; cold reattach after one binding term also green | PASS |
| Expo native extension | Explicit + Familiar package closure | not launched | not launched | packed crypto/parity and binding refresh green | BLOCKED — host evidence |

“Vite/Exact carrier” means the real packed Vite lifecycle/plugin plus the
generated application client contract used by W1. It does not promote a new
W7 Exact-runtime claim.

The six primary receipts are under [`receipts/`](./receipts/). Each contains
the package SHA closure, runtime identity, hashed session identifiers,
predecessor/successor deployment identities, the continuity declaration, and
per-phase action accounting.

## R1 invariants and accounting

| Criterion | Result |
| --- | ---: |
| Snapback source inspections in a cold cell | 0 |
| Exact source inspections in a cold cell | 0 |
| Custom relay or binding middleware | 0 |
| Destructive reseeds | 0 |
| Out-of-scope skill packets | 0 |
| Silent auth/query waits requiring an app timeout | 0 |
| Failures without an owner | 0 |

The deterministic Node carrier has no model-token stream, so every cell marks
tokens unavailable with that reason. It records the same six actions by phase:
M1 generate/process/choreography; additive-schema edit/generate; verification
suite. Consequently these cells retain their product findings but are
ineligible for token/output and model-wall scorecard comparisons, as LLP 0295
requires when metering is unavailable.

## Familiar independent-subscription fixture

The required
`tests/acceptance/familiar-six-subscription-contention-v1.mjs` run retained 12
live/current subscriptions (six per authenticated principal), fulfilled all
12 mutations, completed 72/72 independent scheduler turns with zero abandoned,
recorded zero authorization suspensions, and converged every independent write
within the 15-second ceiling. The six-reference totals were 1,631–1,697 ms;
the relational control was 212–224 ms. Both arms recorded zero misses and zero
overload conversions on this host.

The fixture's ordinary characterization mode initially exited nonzero because
it requires at least one load-sensitive overload miss. R1 observation mode
retains all correctness, authority, subscription, and scheduler assertions but
allows the zero-miss outcome. This classifies the first exit as an instrument
expectation owned by LLP 0200 / the existing contention ticket, not a product
failure. The independent form remains supported; the relational form remains
an optimization, not the only correct path. Full evidence is in
[`familiar-six-subscription-contention.json`](./receipts/familiar-six-subscription-contention.json).

## Native W6 extension

The gate is open: `55b266cf7da0289336c43fbcbf76659b202f1fa1`
(provider-owned native digest adapter) and
`38b2d9d5663e96658fa785bd24a50426a89789cf` (lazy supervised binding refresh)
are ancestors of the pin.

Both Expo profile cells forced the supervisor clock past a 60-second binding
term, performed a new provider boot while the original supervisor remained
running, received a refreshed binding with preserved descriptor, route,
capabilities, and supervisor generation, and restored the original password
session. The packed Expo closure, iOS/Android/WebCrypto digest parity, native
custody admission/refusal matrix, and no-consumer-polyfill closure tests also
passed.

The required cold native process launch could not run: this macOS host has only
`/Library/Developer/CommandLineTools`, `xcrun` cannot find `simctl`, `adb` is
absent, and the documented `~/Dropbox/APIKeys/MACHINE_FLEET.md` dispatch file
is absent. This is an environment/evidence blocker, not a Snapback failure.
The existing owner is
[`issues/20260821-expo-crypto-adapter-native-witness.md`](../../../issues/20260821-expo-crypto-adapter-native-witness.md);
the dated attempt is appended there rather than creating a duplicate issue.

## What a cold agent needed beyond the paved harnesses

1. Node 24 and the frozen root dependency install; the login-shell Node 22
   plus an absent root `ajv` dependency could not start the W3 control.
2. The public multi-persona recipe's stable `storagePartition` per actor. Two
   client objects deliberately share the default durable owner.
3. `transport: "stream"` for an actual pushed live witness; direct live-query
   calls default to polling.
4. For the Expo password/two-persona proof, decline the supervisor's
   convenience ordinary session, use stable per-persona partitions through the
   provider's public application-client factory, and opt out of the unrelated
   RQS store. The binding exchange and provider remained first-party. This
   corroborates the existing
   [`guide-gap supervised Expo mint`](../../../issues/20260822-guide-gap-supervised-expo-mint-two-client.md).
5. A simulator-capable host for the final native launch; no application crypto
   polyfill or binding workaround was needed.

## Failures by owner

| Observation | Classification | Owner / disposition |
| --- | --- | --- |
| Six primary packed cells | no failure | — |
| Ordinary six-sub fixture saw zero expected overload misses | instrument expectation; product path was greener | LLP 0200 and existing `20260820-familiar-live-subscription-contention` ticket; R1 observation receipt retained |
| Expo supervisor initially supplies one shared convenience session | documented harness/Guide gap, not binding middleware | LLP 0258 / LLP 0061; existing `20260822-guide-gap-supervised-expo-mint-two-client` ticket corroborated |
| Cold iOS/Android launch unavailable | environment/evidence blocker; no product verdict | LLP 0294 W6 / LLP 0258 D3-D7; existing native-witness ticket updated |
| Login Node 22 and missing root `ajv` | local harness setup | corrected with pinned Node 24 and frozen install; no product ticket |

No new repository issue was filed: no primary cell returned a genuine product
failure, and both outstanding non-green observations already had exact live
owners. Creating duplicate live tickets would violate repository issue policy.

## Verification

- `scripts/bootstrap-ibex-runtime` — PASS.
- W1 unchanged all-arm packed lifecycle control — PASS.
- W3 `scripts/familiar-vdoc-vertical-contract.mjs` — PASS, all catalogue rows
  verified and `pending: []`.
- Packed auth settlement proof — PASS.
- Six cold cell receipts — PASS.
- Familiar six-subscription R1 observation — PASS.
- Expo digest parity — 4/4 PASS.
- Expo native custody provider matrix — 30/30 PASS.
- Nested packed Expo closure — 1/1 PASS.
- `./ref-check --verbose` — PASS: 297 LLP documents, 6,800 references,
  zero errors and zero unchecked.
- Package test inventory — PASS: 328 declared test files.
- Aggregate inventory check — inherited FAIL: the pre-existing missing
  `competitive-checkpoint` generated publication leaves and `todo-v2` Exact
  generated snippet leaves. This change adds neither demo/generated path nor
  an inventory mismatch; the package-test inventory passed.
- Cold native simulator/emulator boot — BLOCKED by host tooling, owned as above.
