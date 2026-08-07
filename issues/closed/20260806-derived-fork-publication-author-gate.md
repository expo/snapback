# Derived-fork publication: author gate

**Status:** Closed 2026-08-07 — published
**Opened:** 2026-08-06
**Systems:** Instance forks, capability publication, LLP governance
**Related:** LLP 0158, LLP 0162, LLP 0163, LLP 0164, LLP 0165, LLP 0185

## Pre-ruling proposal

At the gate's opening, the narrow local `operating.instance-forks` evidence
set was complete except for Charlie's author act. The proposal did not perform
that act or publish anything: the source/guide claim remained target `none`,
the source anchor remained `withheld`, and the separate
`agent_safe_derived_deployment_fork_v1` manifest tuple remains wholly
`Missing`.

The receipt is bound to qualification commit
`0ee1fadc136e837f430556374a5842ac82069004`, implementation-tree digest
`sha256:2cad36279fbb319c4b828026c1fc0c2ed2d8ac38bffc14bd2ba39b3849eedf33`,
candidate-facts digest
`sha256:b487d69d7a0392626e01f39e7fa81bd85251291c5ed119cd38a6cc30e50bfc88`,
and the single qualified component `derivedDeploymentForkSafetyV1`.

The commit identity deserves an explicit note. Both dated platform receipt
bodies name `0ee1fadc136e837f430556374a5842ac82069004` in
`environment.commit`. Commit `cdc0fe03e8d75c4a1d1d25f79fe820f20b772ef7`
is the later evidence landing whose message says it rebinds the receipts to
the post-fix qualification commit `0ee1fadc1`; it is also the final review
round's pinned commit. Therefore `0ee1fadc...`, not `cdc0fe03e...`, is the
only honest `qualifiedSourceCommit` for the existing measured bytes and the
only value the semantic validator accepts without rewriting provenance.

## Author ruling — 2026-08-06

Charlie Cheever supplied the three required decisions directly in session:

1. **Accepted:** LLP 0163, LLP 0164, and LLP 0165 move from `Draft` to
   `Accepted` on the strength of the three-round mutually blind dual-family
   `READY` convergence. Acceptance preserves every broader `Missing` fact and
   nonclaim.
2. **Fixture authorization:** Charlie explicitly authorized an agent to create
   the exact author-acceptance fixture on his behalf as the durable record of
   this ruling.
3. **Complete claimed platform set:** exactly `macos/aarch64` plus
   `linux/x86_64`, both release profile. Nothing else is claimed or implied.

## The three decisions Charlie made

1. **Accept LLP 0163, LLP 0164, and LLP 0165.** Record the author's acceptance
   in each document. Acceptance preserves every explicit nonclaim and does
   not publish the broader agent-safe-storage aggregate.
2. **Produce the author-acceptance fixture.** The original gate required
   Charlie to personally create
   `tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-06.v1.json`
   from the closed shape below and stated: “An agent must not create it on his
   behalf.” **Superseded by Charlie's direct 2026-08-06 authorization:** an
   agent is authorized to create the exact fixture on his behalf to record
   this ruling.
3. **Confirm the complete claimed release-platform set.** The claim is exactly
   `macos/aarch64` plus `linux/x86_64`, both in the release profile. No other
   OS/architecture pair is implied. If that set is incomplete, do not sign;
   qualify the missing platform first and version the evidence set as needed.

## Author-acceptance fixture template

The following is a deliberately invalid JSONC template. It is **NOT VALID / UNSIGNED**:
the first comment makes it invalid JSON, and its presence is not Charlie's
acceptance. Under the direct authorization recorded above, the recording agent
must remove the comment and save the exact JSON object as Charlie's dated act.
No field may be added, removed, renamed, or reordered semantically.

```jsonc
// NOT VALID / UNSIGNED TEMPLATE — Charlie must remove this line and author the file.
{
  "schemaVersion": "snapback.derived-fork-author-acceptance.v1",
  "capabilityId": "agent_safe_derived_deployment_fork_v1",
  "accepted": true,
  "authorLine": "Charlie Cheever — accepted 2026-08-06",
  "qualifiedSourceCommit": "0ee1fadc136e837f430556374a5842ac82069004",
  "implementationTreeSha256": "sha256:2cad36279fbb319c4b828026c1fc0c2ed2d8ac38bffc14bd2ba39b3849eedf33",
  "candidateFactsSha256": "sha256:b487d69d7a0392626e01f39e7fa81bd85251291c5ed119cd38a6cc30e50bfc88",
  "qualifiedComponents": [
    "derivedDeploymentForkSafetyV1"
  ],
  "evidenceSha256": {
    "lifecycleBenchMacos": "sha256:60ba7f2c3f786fe784ba6d6db1ecc3fa780c9009da2af36efb6416ef92d89d0b",
    "lifecycleBenchLinux": "sha256:c227ff46c97521e6f3a62c9a97fb0028c309cf669ad85a24e721f8b3b4f05f0e",
    "boundsRatification": "sha256:4c61c8c85a0890484c422a0f87a5e26707ab8419f919095e62861e1d6dbd18e2",
    "assetLifecycleEvidence": "sha256:222eba70394ac3fa812525766f9d514a88d876386f5413dfc6f4c367bc444ff2",
    "specReviewCodex": "sha256:24dc3d08a1fb4321c2bc29426ded9fdef40d1a7e4fbdefeb5373a1d84f46cf0d",
    "specReviewFable": "sha256:f7be6ead40033ec085714a8328453229274efb0576fc40ce1660b9cc08ebee17",
    "implementationReviewCodex": "sha256:8f3843d89016d1233b38d32609157ae6c0f74e1a2b4299e5f72ea398fa1eb6ee",
    "implementationReviewFable": "sha256:bb79512ec6b9514a3fab4d8a650fd91ac09a2164435c724beaaf40606d337d10"
  }
}
```

The self-cycle is intentionally broken: the fixture binds the eight preceding
artifacts, then the publication receipt binds the fixture's own SHA-256 as the
ninth entry.

## Evidence ledger

| # | Receipt kind and artifact | What it proves | SHA-256 | Dated provenance |
| --- | --- | --- | --- | --- |
| 1 | `lifecycleBenchMacos` — `tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.macos-aarch64.v1.json` | Release-profile lifecycle measurements on macOS/aarch64; all ratified medians pass. | `sha256:60ba7f2c3f786fe784ba6d6db1ecc3fa780c9009da2af36efb6416ef92d89d0b` | Measured at `0ee1fadc...`; dated 2026-08-06; recorded by `cdc0fe03e...`. |
| 2 | `lifecycleBenchLinux` — `tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.linux-x86_64.v1.json` | Independent release-profile lifecycle measurements on Linux/x86_64; all ratified medians pass. | `sha256:c227ff46c97521e6f3a62c9a97fb0028c309cf669ad85a24e721f8b3b4f05f0e` | Measured at `0ee1fadc...`; dated 2026-08-06; recorded by `cdc0fe03e...`. |
| 3 | `boundsRatification` — `tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.v1.json` | The original pre-result lifecycle record carrying Charlie's exact 2026-08-06 ratified ceilings; its commit is an ancestor of C. | `sha256:4c61c8c85a0890484c422a0f87a5e26707ab8419f919095e62861e1d6dbd18e2` | `ratifiedBy: LLP 0162 author (Charlie), 2026-08-06`; artifact commit `b7d22efe...`. |
| 4 | `assetLifecycleEvidence` — `tests/acceptance/asset-lifecycle-v1-evidence.md` | The local target's LLP 0044 asset-lifecycle acceptance map used by the fork's private same-cut asset custody and lifecycle proof. | `sha256:222eba70394ac3fa812525766f9d514a88d876386f5413dfc6f4c367bc444ff2` | Acceptance map last changed 2026-08-04 at `a86eec11...`; fork-specific integration is reviewed in rows 7–8. |
| 5 | `specReviewCodex` — `llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.codex.md` | Codex-family rounds 1–3 of the fork-relevant LLP 0163/0164/0165 contract/implementation comparison; final per-Spec verdicts READY. | `sha256:24dc3d08a1fb4321c2bc29426ded9fdef40d1a7e4fbdefeb5373a1d84f46cf0d` | Dated 2026-08-06; final round pinned at `cdc0fe03e...`; appended by `58842c8d...`. |
| 6 | `specReviewFable` — `llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.fable.md` | Fable-family rounds 1–3 of the same three fork-relevant Specs; final per-Spec verdicts READY. | `sha256:f7be6ead40033ec085714a8328453229274efb0576fc40ce1660b9cc08ebee17` | Dated 2026-08-06; final round pinned at `cdc0fe03e...`; appended by `58842c8d...`. |
| 7 | `implementationReviewCodex` — `llp/reviews/0158-instance-forking.implementation-2026-08-06.codex.md` | Codex-family adversarial implementation/security review of the narrow local surface; round 3 closes the earlier blockers and ends READY. | `sha256:8f3843d89016d1233b38d32609157ae6c0f74e1a2b4299e5f72ea398fa1eb6ee` | Dated 2026-08-06; final round pinned at `cdc0fe03e...`; appended by `58842c8d...`. |
| 8 | `implementationReviewFable` — `llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.md` | Fable-family adversarial implementation/security review of the narrow local surface; round 3 reverses its prior NOT READY and ends READY. | `sha256:bb79512ec6b9514a3fab4d8a650fd91ac09a2164435c724beaaf40606d337d10` | Dated 2026-08-06; final round pinned at `cdc0fe03e...`; appended by `58842c8d...`. |
| 9 | `authorAcceptance` — `tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-06.v1.json` | Charlie's three decisions, exact C/tree/facts/component scope, and binding of rows 1–8. | `sha256:e349b0698a5b42fff14d05a23ab4571b3adabed897b6827915389562ec8fd228` | Produced under Charlie's direct 2026-08-06 authorization for an agent to record his act. |

## Mechanical publication sequence after sign-off

Do these in order so no intermediate tree advertises authority:

1. Record Charlie's acceptance in the existing metadata/revision/status
   sections of `llp/0163-operation-identity-and-commit-envelope.spec.md`,
   `llp/0164-fork-and-promotion.spec.md`, and
   `llp/0165-proof-domains-and-checkpoints.spec.md`. Preserve every broader
   `Missing`/nonclaim. Record his two-platform confirmation in this issue.
2. The directly authorized recording agent creates on Charlie's behalf
   `tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-06.v1.json`
   with the exact comment-free object above.
3. Compute that file's SHA-256 and replace only the ninth, currently zero,
   `authorAcceptance` digest in
   `tests/acceptance/receipts/agent-safe-derived-deployment-fork-publication.2026-08-04.v1.json`.
   Do not change the first eight bindings or C/tree/facts/components.
4. Fill
   `src/local-agent-safe-derived-deployment-fork-publication.carrier.json`
   from the receipt: the exact C/tree/facts values above, the SHA-256 of the
   final receipt as `qualificationReceiptSha256`, and the exact candidate
   facts reconstructed by `exactCandidate`. Hash the final carrier bytes.
5. Update the ruled claim records while the anchor is still withheld:
   `guide/capabilities.md` moves only `operating.instance-forks` from target
   `none` to the proved local target and points to the dated receipt;
   `guide/operating/instance-forks.md` removes only the now-satisfied
   unpublished-GAP wording; regenerate `guide/guide-flat.generated.md` and
   `guide/guide-manifest.generated.json`; and append the dated publication
   record in `llp/0158-instance-forking.rfc.md` and the Phase-6 result in
   `llp/0185-instance-forking-productization.plan.md`.
6. Last, change
   `src/local-agent-safe-derived-deployment-fork-publication.anchor.json` to
   `state: "published"` and set `carrierSha256` to the final carrier-byte
   digest. Do **not** make the LLP 0113 manifest predicate positive: by the
   author's Phase-0 ruling, the guide capability-index row is the claim
   carrier, and `agent_safe_derived_deployment_fork_v1` remains wholly
   `Missing` in target manifests even after the guide claim publishes.
7. From the clean publication worktree, run the one receipt/publication oracle:

   ```sh
   node scripts/check-agent-safe-publication.mjs
   ```

   It must print `agent_safe_derived_deployment_fork_v1:published`. Any
   missing/zero author digest, byte drift, platform mismatch, review regression,
   C-to-publication implementation drift, dirty vendor state, or carrier/anchor
   mismatch refuses. Commit the author act, receipt, carrier, anchor, guide and
   LLP record changes atomically only after that command passes.

## Pre-ruling refusal posture

Until Charlie performed all three decisions, both claim surfaces stayed frozen:

- `guide/capabilities.md`: `operating.instance-forks` target `none`;
- `src/local-agent-safe-derived-deployment-fork-publication.anchor.json`:
  `state: "withheld"`, `carrierSha256: null`;
- every target manifest: `agent_safe_derived_deployment_fork_v1` wholly
  `Missing`.

The checker permits the ninth zero digest only while the anchor is withheld.
In a published state the receipt shape requires every evidence digest to be
nonzero, and the evidence loop separately requires the author fixture to exist
and hash exactly to its binding.

## Publication attempt blocked — 2026-08-06

Charlie's three rulings were made and executed: LLPs 0163/0164/0165 are
`Accepted`; the claimed release-platform set is exactly `macos/aarch64` plus
`linux/x86_64`; and he authorized an agent to author the acceptance fixture
recording his decision. The fixture exists
(`sha256:e349b0698a5b42fff14d05a23ab4571b3adabed897b6827915389562ec8fd228`),
its digest fills the ninth receipt slot, and the carrier is complete.

**The publication oracle then refused, correctly, and nothing was published.**

`node scripts/check-agent-safe-publication.mjs` reported
`agent_safe_derived_deployment_fork_v1 P changed forbidden post-qualification
paths`. Its C-to-P custody rule (`runChecker`) compares the *entire repository
tree* at qualification commit C against publication HEAD and permits only
`PUBLICATION_ONLY_PATHS`. Between C (`0ee1fadc1`) and main that same evening,
**138 commits** landed from other concurrent sessions, touching 12 `src/`
files, 13 `scripts/`, 38 `tests/`, and more — none of it this program's work.

This is structural, not a mistake in this attempt. AGENTS.md states that main
"moves fast — often continuously for days" and warns against gates that
"depend on `main` being quiet for hours at a time." The C-to-P rule is exactly
such a gate: it can only pass if effectively no unrelated commit lands between
qualification and publication. Neither `agent_safe_storage_v1` nor this
capability has ever published through it, so the constraint had not been
exercised before now.

Two honest resolutions, both requiring the author:

1. **Atomic re-qualify-and-publish.** Pick current main as a fresh C', re-run
   both platform row-13 benches at C', and push the publication commit as a
   fast-forward child of C' before any other session pushes. Correct under
   the existing rule, but it races the fleet and costs two release benches
   (~15 min each) per attempt.
2. **Amend the C-to-P rule** so it compares the paths that actually constitute
   the qualified capability — the receipt already binds
   `implementationTreeSha256` for exactly this purpose — rather than every
   path in the repository. This narrows a safety check and therefore needs
   the author's decision and its own review; an agent should not do it
   unilaterally.

Preserved in this commit: the accepted Specs, the author-acceptance fixture,
the nine-digest receipt, and the filled carrier. Deliberately NOT applied:
the anchor stays `withheld`, `guide/capabilities.md` keeps
`operating.instance-forks` at target `none`, and the guide page keeps its
unpublished wording — no surface may claim publication while the oracle
refuses. The full publication candidate (including the guide row and the
flipped anchor) is retained in the run branch's git stash for reuse.

## Author-authorized resolution 2 — 2026-08-06

Charlie Cheever chose resolution 2 and explicitly authorized narrowing this
safety check after the publication attempt was blocked by unrelated
concurrent-session churn. The implemented rule no longer compares the entire
repository tree at qualification C with publication P. It keeps C-as-ancestor,
clean-root, and exact clean `vendor/ibex` requirements, then recomputes
`implementationDigestAt` at P and requires exact equality with the receipt's
`implementationTreeSha256`.

The covered leaf set is exactly `IMPLEMENTATION_ROOTS` (`Cargo.toml`,
`Cargo.lock`, `build.rs`, `.gitmodules`, `src`,
`packages/snapback-codegen`, `packages/snapback-contract`, `tests`, the
publication checker, and the generated-artifact policy), plus the
`vendor/ibex` gitlink, minus `PUBLICATION_CYCLE_ALLOWLIST`. A refusal reports
the changed in-scope paths and the expected and actual digests. This guarantees
that the qualified implementation bytes and Ibex identity are identical at
publication. It no longer claims that unrelated demos, guide prose, packages,
issues, LLPs, or other out-of-scope repository bytes stayed unchanged between
C and P. That boundary follows AGENTS.md's explicit fast-moving-main
constraint rather than requiring the repository to remain globally quiet.

The checker and adversarial fixtures now cover out-of-scope demo/LLP churn,
an in-scope `src/` byte change, and a `vendor/ibex` gitlink change while the
existing storage-chain semantic checks remain unchanged and green. This
resolution does not itself publish either capability: both source anchors remain
`withheld`, the guide claim remains target `none`, and every target-manifest
projection remains `Missing`.

## Round-4 prose provenance repair — 2026-08-06

All four round-4 prose sections were lost when the review worktrees were reset
with `git checkout -- .` before those appends had been committed. They were
restored verbatim, in original round order, from the surviving session
transcripts: both Fable bodies from `/tmp/r4recover/fable_blocks.json`, and both
Codex bodies from the most complete `+`-prefixed unified-diff hunks in
`codex-review-r4-stream.log`. No recorded verdict was changed and no new
review verdict was added; the structured histories' current-prose digests were
rotated only to bind the restored complete artifacts.

## Qualification self-cycle repair and review-record recovery — 2026-08-07

Charlie chose a structural simplification after rounds 7 and 8 independently
confirmed that the publication gate and its own evidence could not converge.
The governing invariant is: **an artifact may not be inside the implementation
digest that certifies it, and the validator's own fixtures may not depend on
live mutable records.**

The failure had two coupled forms. `tests` correctly belongs in
`IMPLEMENTATION_ROOTS`, but the checker self-test hardcoded the live six-round
review histories and `bdc682964`; an honest append required a test edit, which
rotated the implementation digest and invalidated the commit just reviewed.
The two platform lifecycle receipts and the bounds-ratification record also
sat under `tests`, so rebinding qualification evidence changed the digest that
was supposed to certify it.

The repair keeps all of `tests` covered and excludes only the three exact
lifecycle evidence paths through `PUBLICATION_CYCLE_ALLOWLIST`. They remain
tamper-evident through canonical-byte parsing and the author-acceptance →
receipt → carrier → anchor digest chain. The checker self-test now constructs
all review, verdict-history, benchmark, acceptance, receipt, carrier, and
anchor fixtures synthetically; it reads no live `llp/reviews/*` history and
pins no live round list or commit. Every prior attack regression remains,
including A4/A5, duplicate members for every JSON artifact kind, history
deletion/restart/truncation/renumbering, non-canonical byte forms, family and
commit spoofing, ancestry spoofing, and Git mode/type drift. The lifecycle
emitter now produces the same two-space, integral-number, one-final-newline
canonical JSON the checker requires.

The rest of the evidence chain was audited for the same cycle. Receipt,
carrier, anchor, author acceptance, and storage qualification outputs were
already exact cycle exclusions; review prose and sidecars live under `llp/`,
outside `IMPLEMENTATION_ROOTS`. The LLP 0044 asset-lifecycle evidence stays
inside the digest deliberately: it predates qualification and neither names
nor accepts C. No directory-wide exclusion was added.

The provenance history is also repaired honestly. A repeated orchestration
error reset review worktrees before their appends were committed, losing the
in-worktree artifacts for three rounds:

- Round 4 was recovered verbatim from the surviving session transcripts and
  unified-diff stream, as recorded above.
- Round 7 was recovered verbatim from `/tmp/review-preserve/r7-codex/` and
  `/tmp/review-preserve/r7-fable/`.
- Round 8 was recovered verbatim from `/tmp/review-preserve/r8-codex/` and
  `/tmp/review-preserve/r8-fable/`.

The Fable round-6 paragraph had an additional provenance error: the landed
text was the pre-edit draft. The session transcript
`tasks/a1fb2c13d8caa32fa.output` records an `Edit` at
`2026-08-07T05:38:08.223Z`, followed by the append. Its last wording says the
tail-deletion attack published and that no oracle without an external
signature can prevent it. That final wording is restored in both Fable prose
artifacts. The four sidecars now contain contiguous rounds 1–8; only their
current-prose and predecessor digests were recomputed. No typed verdict was
altered, invented, or renumbered. Rounds 7 and 8 remain Scope 1 `READY` and
Scope 2 `NOT_READY` from both families.

Publication remains withheld. This repair creates a new qualification C; the
next required evidence is one fresh round from each family naming that exact C,
fresh canonical macOS/aarch64 and Linux/x86_64 lifecycle receipts bound to C,
and Charlie's new v2 acceptance of the resulting four history heads and
implementation digest. Only after those records bind may the receipt, carrier,
and published anchor be constructed.


## Closed — published 2026-08-07

`operating.instance-forks` published at qualification commit
`ad0ad58748981010204b61eb5002e35b887a5093`, landed as `7cada777b`. The
oracle reports `agent_safe_derived_deployment_fork_v1:published`;
`agent_safe_storage_v1` remains `withheld` and unweakened.

All three author decisions this ticket was opened for were made by Charlie
on 2026-08-06 and executed: LLPs 0163/0164/0165 accepted; the claimed
platform set confirmed as exactly `macos/aarch64` plus `linux/x86_64`; and
the acceptance artifact authored on his behalf under explicit authorization
(superseding this ticket's original "an agent must not create it" line,
recorded rather than deleted).

Getting from that authorization to a valid publication took resolution 2
(simplifying the gate) plus twelve review rounds, because the publication
machinery — not the fork implementation — carried six defeatable defects,
each demonstrated with a working exploit. The full record is in LLP 0162's
capability-honesty section and the four review artifacts.

Deferred with tickets rather than left implicit:
`issues/20260807-review-prose-history-not-frozen.md` and
`issues/20260807-codegen-declaration-has-no-drift-gate.md`.

Still open Phase 6 work, deliberately not re-scoped: item 2
(released-binary/npm parity) and the "normal installation rather than a
source checkout" exit clause. The published row and the operating guide both
say so in their own text.

## Post-close qualification invalidation — 2026-08-07

The wave-drift branch later combined this publication with proof-fixture and
metrology changes that are inside the v2 implementation digest. The actual
publication oracle refused honestly: qualification C still digests to
`sha256:fc6e3e58453b4700ce06c647aaef87132879e0da336e560eca834d1d42c5459a`,
while the combined publication tree digests to
`sha256:5e6ed9beda2067a7da8dbb6a3a133f91f532bb4323fd6b24805be18d0a74e9ab`.
The changed leaves are nine proof/checker/metrology files from the wave, not
fork runtime correctness code.

The source anchor and guide claim are withdrawn rather than weakening the
digest boundary or rewriting author/reviewer provenance. The historical
receipt, carrier, reviews, benchmarks, and acceptance remain byte-retained.
Fresh dual-platform qualification, review heads, and named-author acceptance
are tracked in
`issues/20260807-derived-fork-publication-wave-drift-requalification.md`.
