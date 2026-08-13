# Charter — resolve the delivery merge (fresh origin/main into the wave-1 candidate)

Mid-merge; parents: HEAD^ = candidate a0a1e2911 (this run), HEAD^2-to-be =
origin/main d87d8d9a9. **You do not commit** — resolve and `git add` each
file you resolve; leave the merge uncommitted. Never run
git commit/push/rebase/merge --abort. Rules per class:

1. LLP docs (llp/0236,0237,0238,0239,0240,0241,0242): UNION of intents.
   Main carries post-acceptance amendments (companion RFCs 0245-0249 in
   Related lists, dated Revised entries, prose updates). The candidate side
   carries this run's carry-ins ONLY in 0239 and 0240 (LLP 0235/0234
   Related additions + one integration sentence each). For 0236/0237/0238/
   0241/0242 the candidate side equals the accepted seed → main's version
   wins whole-file. For 0239/0240: start from MAIN's version and re-apply
   the candidate's carry-in hunks (diff 075cbafbb..a0a1e2911 -- llp/0239*
   llp/0240* shows them exactly). Never drop either side's Revised entries.
2. guide/capabilities.md: three-way union — main's new rows (0245-0249 era,
   password-auth changes) + the candidate's rows (handler-runtime,
   authority-profile, media, lifecycle) + the candidate's budget-tightened
   prose. HARD budget: wc -c < 55808 — tighten What prose further if the
   union overflows; never drop rows/aliases/witnesses/GAPs/owners/dates
   from EITHER side.
3. guide/clients/headless.md + guide/retrieval-eval.md: union of both
   sides' added sections/cases; renumber retrieval case ids if they collide;
   keep every case from both sides.
4. src/manifest.rs: hunk union — the candidate added authority_profile +
   AuthorityProfileV1 + media descriptor/result plumbing; main added its own
   fields/sections. Both must survive. After resolving, `cargo run --locked
   --bin snapback-schemagen` regenerates schemas/ — resolve
   schemas/schema.manifest.schema.json (and any other conflicted schema) by
   REGENERATION, never by hand.
5. packages/snapback-client/package.json + scripts/check-package-test-
   inventory.mjs: union of both sides' test entries; expectedTotal = the
   true union count (run the checker to verify).
6. Publication custody (src/local-*-publication*.json) + tests/conformance/
   relation-activity & sequence-allocation readers: take THEIRS
   (origin/main's freshest minted custody) verbatim.
7. Every remaining conflicted file (generated guide projections, demo
   generated dirs, registries, manifests): `git checkout --theirs` +
   `git add` — full regeneration follows on the merged tree.

After resolving ALL conflicts: run `node scripts/check-package-test-
inventory.mjs`, `cargo check --locked` (manifest.rs must compile), and
`node --check packages/snapback-codegen/index.mjs`. `git add` everything
you resolved (including the take-theirs class — add them yourself; do not
leave U paths). Report (REPORT-delivery-merge.md): per-class resolution
notes, the 0239/0240 carry-in hunks re-applied, capabilities byte count,
verification outputs, `git diff --name-only --diff-filter=U | wc -l` (must
be 0).
