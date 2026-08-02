# PKG-02: LLP 0147 Phases A–B — the compiled Micro core, local-dev, with the stop rule

**Status:** Resolved 2026-08-02 — Phase B complete; stop rule not triggered
**Program:** follows PKG-01; its metrology is the measuring stick
**Systems:** Packaging, Codegen, Client SDK, Wire Protocol
**Related:** LLP 0147, LLP 0145 §D-D, LLP 0012, LLP 0063, the fixed
delta-lane egress defect (`eda8f231`), and the separate Full-client prerequisite
(`48fce9ff` after integration)

## Authorized scope and outcome

PKG-02 implemented LLP 0147 Phases A and B only: an additive local-dev Micro
profile, generated exact application surface, minimal generic transport,
optional live module, immutable byte attribution, and Phase-B negative proofs.
The existing package root and `./online` remain Full.

The stop rule did not trigger. Both runtime compositions are far below 20 kB
gzip, both generated entries are far below 25 kB gzip, and the generated
surface/unchecked-core split passes without re-importing the Full manifest
interpreter. The evidence therefore declares readiness for a separately
authorized Phase C to be commissioned.

This ticket did not implement Phase C. It makes no sessions, auth-obligation,
capability-class, React, browser, Expo/Metro, carrier, publication, or default
selection claim. Those remain explicit profile nonclaims.

## Phase A: immutable attribution and closure

The Phase-B supplemental ledger is
`tests/fixtures/client-bundle-metrology/baseline.micro-phase-b.v1.json`. It is
bound to source revision `95557db1`, the exact client/contract/React package
trees, Node 24.18.0, esbuild 0.28.1, the frozen minifier/compression method,
fixture inputs, and behavior commands.

| Profile | Minified | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| Micro core runtime | 6,740 B | 2,740 B | 2,400 B |
| Micro core + generated entry | 7,347 B | 2,960 B | 2,595 B |
| Micro live runtime | 12,470 B | 4,549 B | 3,989 B |
| Micro live + generated entry | 12,868 B | 4,712 B | 4,134 B |

The ledger also freezes the three experimental public subpaths and a root
negative. Its metafiles prove:

- core excludes `micro-live.mjs`;
- both generated profiles exclude Full `index.mjs`, RQS, outbox, and the
  Node/file-store arm;
- package root and `./online` do not import Micro; and
- sessions, React, browser carrier, Expo/Metro carrier, and external-app rows
  remain prospective `not-implemented` profiles rather than implied claims.

The metrology runner initially could not build its generated core fixture
because the internal `echo` descriptor collided with the exported `echo`
wrapper. The isolated instrument correction `95557db1` renames the descriptor
to `echoRef`; it changes no product closure or ceiling. After rebasing over
main's `605e290f` canonical-id compression, the immutable primary ledgers and
the new supplemental ledger pass together.

## Phase B: generated surface and runtime floor

Codegen now accepts a logical `snapback.micro-profile-input.v1` selection and
emits a digest-bound `microProfile.v1`, exact TypeScript declarations, and an
application-owned runtime entry. The selected incident-room fixture covers
query, mutation, action, and live query over the `core`, `operations`,
`authority-fence`, and `live` modules.

Focused proof establishes:

- strict TypeScript exact arguments/results; raw `invoke` and `subscribe`
  return `unknown` and forbid caller-selected result generics;
- stable refusals for duplicate/unknown operations, missing contracts,
  unsupported capability/lane/custody selections, and invalid module sets;
- byte-identical regeneration and runtime/declaration/profile drift refusal;
- complete generation tuple on every generated call and live subscription;
- one bounded retry for reads, no automatic retry for mutations/actions, and
  structured `SNAPBACK_MICRO_INDETERMINATE_OUTCOME` after effectful ambiguity;
- bounded JSON/envelope/diagnostic/version/frame validation and tolerant skip
  of syntactically valid unknown future frame kinds;
- delayed predecessor publication fencing across identity change;
- live snapshot/delta/replace ordering, version-gap and scoped resync,
  superseding resubscribe, stale-generation blanking, and explicit
  unsubscribe/dispose; and
- compatibility/package/browser closure remains green.

## Gate 11a: server-egress premise

The main-line fix `eda8f231` implements the conservative option identified in
LLP 0147 OQ10: only schema-exact `documents(table)` contracts use delta fanout.
Narrowed `records` and non-schema-exact `documents` take the full re-query plus
validated replacement path.

After `scripts/bootstrap-ibex-runtime` qualified the linked runtime, both
focused Rust arms passed:

- `narrowed_result_contract_uses_validated_replacement_lane`; and
- `narrowed_documents_descriptor_uses_validated_replacement_lane`.

The positive arm delivers a contract-valid change as `live_replace`. The
negative arm emits only the recovery sentinel for a contract-invalid change;
no delta or replacement carries the invalid row. Gate 11a's premise is green.

## Gate 22: contract-correct same-workload comparison

The first attempted operational comparison reported Micro 1,045 bytes versus
Full 700 bytes. It was not admissible Gate 22 evidence. Full's
`liveQuery(generatedRef)` reduced the reference to its function name before
fresh subscription, dropping argument validation and `expectedGeneration`.
The complete tuple accounts for 342 of the 345-byte apparent gap; unequal
synthetic `full-*`/`micro-*` labels account for the other three bytes.

That is a pre-existing Full correctness defect, not a Micro optimization. It
is isolated in
`issues/closed/20260802-full-livequery-drops-generated-reference.md` and fixed
by prerequisite commit `48fce9ff`. Its focused negative proves malformed
generated live arguments fail before network I/O; its positive proves the
complete tuple reaches valid admissions. PKG-02's comparison intentionally
depends on that commit and must land after it. Gate 22's “same workload” means
contract-correct Full, never a smaller request produced by violating LLP 0012.

The immutable first corrected run used Node 25 on the local M5 Max and nine
alternating samples of poll/local `resync_required` followed by an exact
superseding snapshot. It measures UTF-8 JSON bodies; equal headers and
transport framing are excluded:

| Metric | Full | Micro |
| --- | ---: | ---: |
| Reconnect request body | 508 B | 508 B |
| Reconnect response body | 534 B | 534 B |
| Reconnect total / rounds | 1,042 B / 2 | 1,042 B / 2 |
| Reconnect latency P50 | 0.128958 ms | 0.072875 ms |
| Startup P50 | 18.477667 ms | 2.053000 ms |

A labeled post-rebase confirmation kept the byte/round-trip shape identical
and measured reconnect P50 Full 0.117875 ms versus Micro 0.068000 ms, and
startup P50 Full 16.227042 ms versus Micro 1.691167 ms. This confirmation does
not replace or loosen the first corrected receipt.

## Verification

- `scripts/bootstrap-ibex-runtime` — exact link, launch, and restricted handler
  VM qualification passed;
- both focused `cargo test --locked --test live_delta_v0 ... -- --exact`
  commands — 1 passed each;
- `node packages/snapback-client/package.test.mjs`;
- `node packages/snapback-client/argument-validation.test.mjs`;
- `node packages/snapback-client/micro.test.mjs`;
- `node packages/snapback-client/micro-operational.test.mjs`;
- `node packages/snapback-codegen/micro-profile.test.mjs`;
- `node packages/snapback-client/browser-closure.test.mjs`;
- Node 24 `node scripts/client-bundle-metrology.mjs --check`;
- `./ref-check --verbose`; and
- `git diff --check`.

## Resolution

Phase B is complete and the stop rule is not triggered. A future Phase C may
be commissioned under separate authorization. Until it lands and supplies its
own receipts, Micro remains experimental local-dev evidence with no capability
or carrier claim.
