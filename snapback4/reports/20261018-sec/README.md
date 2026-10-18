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
