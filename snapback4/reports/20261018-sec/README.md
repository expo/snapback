# SEC evidence — 2026-10-18

Source: sb4-b16-sec, base ccb9f752d1. No push, publication or version bump.
Design: LLP 3000.036.004. Fresh Muse and Codex marked both design revisions
3 and 5 READY. Implementation reviews and subsequent corrections are retained
verbatim under llp/reviews/3000.036.004-sec-code-r*.

## Implemented

Independent `invariant` declarations; a bounded, exhaustive Kleene implication
kernel and separate Lean soundness/completeness lemmas; explicit whole-path
blockers; `audit` / `check --audit` text and JSON; inherited grant writers;
automatic schema/fixture engine exploration in default `test`; current-role,
grant-argument, global bootstrap, optional evidence, deadline and refusal-oracle
advice. Non-whitespace Unicode characters now determine text minimums.
The security card, discovery pointers and starter privacy declarations ship
in the 0.4.32 guide changes entry without changing the package version.

## Reproduction evidence

`inputs.json` records the original read-only sources and SHA-256 digests for
50 wave-16 and 100 wave-15 schemas. `corpus.json` is the checker/advice run;
`corpus-operations.json` adds actual generated engine calls: 150 schemas,
zero compile diagnostics, 2,024 operations exercised, 32,384 attempts,
18,461 refusals, zero invented spec violations. All original schemas have
zero invariant declarations. This is compatibility/exploration evidence,
not a claim that the original apps satisfy their privacy specifications.
Unsupported samples and boundaries are recorded per schema.

`high-findings.json` retains actual engine counterexamples for the six
high-finding schemas copied under lang/tests/security/wave16. Separate tests
patch five authority rule sets and require the generated violations to vanish.
The 015 custody assertion is refuted at schema-valid trusted seed ingress;
it does not claim an ordinary application trace or a completed repaired custody
workflow. The 045 strict repair-note interpretation remains a documented
bakeoff-spec interpretation rather than an invented platform bypass.

`difftest/report.json`: seeds 0–19,999, 1,220,035 executions, zero disagreement
signatures. `devices/report.json`: seeds 0–999, 27,922 executions, zero signatures.
`lean/report.json`: 20,000 cases, 16,697 agreements, 3,173 unsupported,
130 disagreements in the four pre-existing signature classes (3 rule/not-found,
25 prelude, 67 next, 35 continuation). Counts match the retained integration15
baseline exactly; there is no new-signature or full-equivalence claim.

## Limits of this delivery

A proof of direct table admission is a component, not a whole-exposure theorem.
Unmodeled wire activity, refusal/collision, derived aggregate, maintenance,
raw-probe, owned-field, referential, temporal, opaque job/native and device
paths stay explicitly unproved. Latest server role authority cannot prove
fresh revocation on a disconnected device. Physical timing/resource channels
and operator/system trust are named exclusions; service seats are not exempt.
Default generated engine tests do not qualify unauthenticated HTTP, actual
revoked-device histories, arbitrary operation sequences or all asset fixture
ledgers. General aggregate/time proofs and a repaired 015 custody workflow
remain follow-up work. No zero-security-holes capability claim is made.

Implementation reviews: round 5 Codex and Muse both READY at 685364545e.
Clean wasm: 2,372,893 B raw / 723,411 B gzip / 545,200 B Brotli;
budget 723,911 B = measured gzip +500 B, over=0.
Qualification logs and final command results are indexed after completion.


## Final qualification

See `qualification.json` for results, snapshots and the Cargo environment;
`logs/` holds compressed raw output, including failures and reruns. The original
workspace invocation reached its 3,600-second guard during clique. Its three
unfinished active cases all passed individually; all 41 unstarted simulation
targets and workspace documentation tests passed. CLI/check/census/guide
integration corrections have passing affected runs. One unmodified shutdown
unit test failed intermittently in the last full CLI target and passed in
isolation; its ticket preserves the observation rather than hiding it.

The full client pool completed 412 files, with seven initially failed files;
all eight affected rerun files passed 168 tests. Both full-count model files
passed 81 tests. The latest installed security card and all todo/web/social/
production/chat-web/chat-Expo starters pass, including broadened-rule failures.
`current-packs/` retains the exact client/platform bytes and SHA-256 manifest
for that run at 2ba00705fc. Its platform is a freshly built debug CLI test
fixture; the production musl artifact belongs to the separate Linux consumer
snapshot below. Neither is a publication receipt. `mac/` retains Mac Studio evidence for the verifier,
text minima and all changed starter variants in the designated scratch tree.

`linux/consumer.json` is the successful fresh-pack Linux consumer qualification
at 6cdeef3c1a, including Ubuntu and Alpine. It explicitly says suite not-run and
publicationQualified=false: full test.sh was forbidden, and the Rust/client
battery ran separately. Later changes are the chat declarations, prose and test
records, qualified through the latest installed starter packs; this is not an
exact-final-HEAD publication receipt. Qualified tarballs and all proof JSON are
retained. Consumer source/build outputs remain under the dedicated /tmp output;
28 rebuildable node_modules directories were removed afterward for shared disk
space. No credentials were copied. The known 1,636 dead-run SQLite sidecars were
removed; target has zero SQLite scratch files after completion.
