# Charter — close the two round-2 MATERIAL findings

You are a FRESH Codex fixer (you wrote none of the prior code, fixes, or
reviews). **You do not commit.** Use apply_patch. Never run
git commit/push/rebase.

Input: REVIEW-CANDIDATE-r2.md — read it completely. Implement exactly its
two Required fixes:

1. **Proof binding closure (M2 continuation)** — refuse media proof
   creation/admission unless a concrete function artifact generation is
   available (no Option/None collapse; a media-bearing function without an
   implementationHash-derived generation must refuse loudly, not bind
   None==None); bind the proof to the authoritative commit identity actually
   supplied to storage, with an explicit non-absent representation for lanes
   that genuinely have no client identity (e.g. a closed enum
   {ClientMutation(digest), NoClientIdentity} — never Option). Add
   None-collapse adversarial tests and the action-hosted child test that
   swaps the separately carried commit identity
   (anchors: src/runtime.rs:409-419,517-539; src/auth/invocation.rs;
   src/manifest.rs:3792-3810; src/local.rs:12830-12871,21943-22001;
   src/storage.rs:4011-4022; src/storage/tests.rs:17374-17446).
2. **Outbox replay compatibility (new IN-DELTA)** — every internal
   generation-bound mutation reference the SDK reconstructs (replay at
   packages/snapback-client/index.mjs:7154-7157, stranded re-record at
   :8187-8191, and any sibling site) includes kind: "Mutation"; remove the
   masking kind-insertion from GeneratedMutationReplayClientDouble
   (outbox-store.test.mjs:49-60,1742-1759) so replay/stranded tests run the
   PRODUCTION SnapbackClient reconstruction; add the review's probe shape as
   a regression test (queue offline → replay against a fetch stub →
   replayed:1, zero terminal retirement). Also decide + test the
   PERSISTED-record case: an intent stored by an older client version whose
   persisted reference lacks kind must replay (derive kind from the durable
   record's own facts — it is by construction a mutation), never terminally
   retire.

Do not weaken the strict external gate. @ref the invariants.

Verify and report verbatim: the new/updated Rust tests (media acceptance +
provenance modules, and your new None-collapse/commit-identity tests); the
COMPLETE client package chain (env -u FORCE_COLOR SNAPBACK_CLIENT_RQS_DIR=
/tmp/rqs-f2 npm test --workspace @expo/snapback-client); reference-kind
suite; ./ref-check --verbose. Report (REPORT-fixround2.md): per-finding
implementation, tests + exact counts, deviations.
