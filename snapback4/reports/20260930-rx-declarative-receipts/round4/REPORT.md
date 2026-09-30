# RX round 4 — named scope reads

Date: 2026-09-30. Branch: `sb4-intent/rx-declarative-receipts`.
Round three: `69df821ddfafe66af583a234f8a7cbc4e34e9286`.
Merged `origin/main` at `0dad042375057d2dad8c429424713986581432e7`
first in `415b38135d`, without conflicts, preserving both sides. Its two
documentation changes remain in the merge. Read the prompts and reports for
rounds 0–3 and the complete round-three Grok and Astra reviews.
Nothing pushed or published.

## Fix and point-read audit

Grok's remaining P2 is fixed. The generated delivered, compact and seen
operations now read `@SCOPE@[id = @ARG@]`. These three substitutions are the
entire product delta. A second single-column unique scope key no longer makes
the generated family ambiguous. Index selection, authority and delivery
coverage rules are unchanged.

Audited both receipt projection and delivery generation paths. They share
`bind/receipts.q`; there is no separate `delivery.q`. `bind/delivery.rs`
validates authored delivery declarations and emits their bindings, not point
reads. The remaining generated member reads and rule probes already name
the mapped scope/principal columns; the message existence probe names the
mapped scope/position columns; the runs lookup names all three columns.
The positional-looking brackets left in the template are the `sync to`
audience declaration and update/delete targets holding previously read rows,
not positional point reads. No further template edit was needed.

Two new regressions add optional `slug: text <=80` / `unique slug` and
`creatorId: principal` / `unique creatorId` to the scope table. The fixture
has no authored scope point read, isolating compiler generation. Each case
executes all six generated surfaces. Delivery of `[3,3]` across absent
position 2 leaves live message 1 `sent`, including after compaction. Reporting
1 and then seen advances it to `read` and removes the covered run.

Before editing the template, the two tests ran against round-three product
source plus the clean main merge: **0 passed / 2 failed**, both with
`E_RECEIPTS_CLAUSE` and `rooms positional key has 2 declared unique keys of
arity 1; use named columns`. These are expected negative-control failures,
retained in [round3-control.log](./round3-control.log). Both tests pass with
the three substitutions; all prior receipt regressions remain unchanged.

As specified by LLP 3000.022 §14.3, hashing the template changes declarative
delivery fingerprints even for this semantics-preserving edit. Manual
fingerprints retain their existing contract and pinned compatibility tests.
No capability bump, storage migration, SDK change or runtime budget change.

## Verification

From `snapback4/`, exit 0 ([affected.log](./affected.log)):

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test --no-fail-fast \
  -p snapback4-lang -p snapback4-device \
  --test declarative_receipts --test delivery --test delivery_clause \
  --test delivery_integration --test delivery_replay_conversion --test guide
```

| Target | Passed | Failed | Ignored |
| --- | ---: | ---: | ---: |
| Declarative receipts | 48 | 0 | 0 |
| Language delivery | 16 | 0 | 0 |
| Delivery clause | 6 | 0 | 0 |
| Delivery integration | 3 | 0 | 0 |
| Delivery replay conversion | 2 | 0 | 1 existing |
| Device delivery | 30 | 0 | 0 |
| Whole guide | 106 | 0 | 0 |
| **Total** | **211** | **0** | **1 existing** |

SDK receipt checks against the rebuilt CLI and SDK output: **97 passed / 0
failed / 0 skipped / 0 cancelled**, exit 0
([sdk-receipts.log](./sdk-receipts.log)):

```sh
node --test --test-concurrency=3 \
  packages/snapback4/test/delivery.test.mjs \
  packages/snapback4/test/delivery-integrated.test.mjs \
  packages/snapback4/test/app-receipts.test.mjs \
  packages/snapback4/test/app-local-receipts.test.mjs \
  packages/snapback4/test/legacy-receipts.test.mjs
```

The CLI was rebuilt with `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
cargo build -p snapback4`; SDK output was rebuilt with
`bun run --cwd packages/snapback4 build`. Both exit 0
([cli-build.log](./cli-build.log), [sdk-build.log](./sdk-build.log)).
`ref-check --verbose`: 525 LLP documents, 10,006 references, zero errors and
zero unchecked references ([ref-check.log](./ref-check.log)).
New-test formatting and `git diff --check` pass.

Final verification failures: **ours 0, baseline 0, environmental 0**.
The two deliberate pre-fix regression failures are the only failing test
invocation this round; their full diagnostics are retained above.
The staged diff check flagged a terminal blank line in the saved Rust log;
removed only that blank line before the final diff check.

**No full suite was run this round**, as requested. No full-suite summary or
qualification is claimed. No new skips, reduced assertions, test counts,
timeouts, meter ceilings or wasm ratchet changes.

The retained round-three wasm was hashed and remeasured, not rebuilt
([wasm-retained.log](./wasm-retained.log)):
**1,988,204 B raw / 596,444 B gzip**, **803 B below** the unchanged
**597,247 B** ratchet. SHA-256:
`fe7a6fbd5ed83ca1cc8e9b872103594d9218b60053b2bfdb964e8ba0bfe0734b`,
identical to round three's recorded artifact. Compiler-template changes add
no device code; this is not a new wasm-build qualification.

## Scoped context and disposition

The read-only `llp-orient` pass used
`/home/ccheever/lanes/q03r4/vendor/llp/skills/llp-orient/SKILL.md`.
Scope: the receipt/delivery generator and its scope lookups. Governing
constraints: LLP 3000 §4 (independent Snapback 4 fence), LLP 3000.022 §2.2
(success is coverage), §14.1 (receipt mappings/authority), §14.2 (bounded
compaction) and §14.3 (template fingerprint). LLP 3000.022 remains in
`llp/current/`. Current authoring facts came from the receipts guide.
The existing template `@ref` still applies. No new design decision or guide
syntax is needed; report and append-only journal record this repair.
Hand-off: none for this finding.

This closes the supplied round-three P2. Automatic ordinal allocation,
recipient counts, join floors and the other explicitly deferred §14.5 work
remain outside this closing round. Local commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
