# Fable 5 review: green local checkpoint

**Reviewer:** Claude Fable 5 (`claude-fable-5`, max effort)  
**Requested revision:** `de9dcf21`  
**Review completed:** 2026-07-28  
**Mode:** fresh read-only implementation and evidence review  
**Outcome:** `NOT READY`

The following response is retained verbatim. The reviewer correctly notes that
the shared worktree advanced while it was reading; the final review will use a
pinned isolated checkout.

---

All checks are complete. Here is the review.

---

# Independent implementation & evidence review — backend-bakeoff improvement program

**Assigned anchor:** de9dcf21. **Actual state reviewed:** the shared worktree advanced to 5ce6781a *during this review* — a concurrent session cherry-picked four commits (af8aaac0, 41102abb, d436dd56, 5ce6781a) while I was reading. I re-verified every load-bearing finding against both revisions. This mid-review mutation is itself a process defect for an "independent final review": the review checkout should be pinned immutable. Note also that all script execution (ref-check, check-guide, node, hashing tools) is denied in this sandbox, so conclusions come from source reading, git history, and cross-receipt hash consistency — not from re-executing suites.

## Release blockers

**1. Capability-publication overclaim existed at the reviewed revision; the post-anchor fix invalidates all packaged-lane evidence.**
At de9dcf21, `local_relation_activity_publication_verified()` gated `bounded_children_v1`/`write_activity_v1` only on embedded-carrier byte integrity — *any* binary compiled from source, including the staged public runtime packages, advertised the pair, while LLP 0104/0108 require a package-attestation trust root that does not exist. The concurrent session's package audit found and fixed exactly this after the anchor: 5ce6781a adds a compile-time `SNAPBACK_BUILD_DISTRIBUTION` fact (`build.rs:239-318`, `src/identity.rs:20-31`), makes public-package builds withhold both capabilities as structured GAPs with fail-closed tests (`src/manifest.rs:5541-5588`, tests at `src/manifest.rs:6947-7039`), and makes `prepare-runtime.mjs` refuse binaries lacking the public-package identity. Consequences still open: the staged runtime binary (`packages/snapback-runtime-darwin-arm64/bin/snapback`, build stamp c86d3e06) predates the distribution fact entirely, and every packaged-lane receipt — the cold-install receipt (`acceptance/cold-install-react.v1.json`, sourceRevision 90e13112, `sourceDirty: true`) and the comparator run — predates the new authority. The packaged rebuild + staged cold-install rerun (now also owing the real-browser cold proof added in d436dd56) must execute and be retained before any packaged claim stands.

**2. The successful rerun matrix is not retained.**
The corrections ticket (`issues/20260727-bakeoff-first-rerun-corrections.md:67-68`) requires the complete matrix "rerun and retained." The only committed matrix receipt is the *failed* first rerun (`acceptance/results/bakeoff-first-rerun.v1.json`, old revision 1d57f9dd, verdict NOT READY). The successful comparator 6/6 receipt exists only in the gitignored `demos/backend-bakeoff/.snapback/comparator-receipt.json`; the Convex, Supabase (including its "transient Realtime retry"), contract, TypeScript, and build passes left no retained evidence at all. `COMPARISON.md:26` still defers the revised ranking to this rerun. The program cannot close on an evidence state whose only committed matrix receipt is a failure.

**3. The comparator receipt does not bind the code that executed it, and predates the last client fix.**
The on-disk receipt binds target, app artifact, and server binary (gitCommit c86d3e06 — I verified the crate source is unchanged through HEAD; only `tests/runtime_link_smoke_v0.mjs` differs), but records nothing about the `@snapback/client`/`@snapback/cli` bytes that produced its transport/cleanup claims. It was generated at 14:09, before the 08abc57e client-teardown fix (14:15) that changed `unsubscribeEphemeral` and provider grant release — the React receipts were regenerated after that fix in the same commit; the comparator lane was not. When the matrix is retained, regenerate the comparator receipt at the final revision and extend its schema to carry executing-package identity.

## Prior correction classes — verified closed in code with tests

- **write-activity scope containment:** `MutationStep::AssertCurrentRelation` executes in-transaction, checks both FK and active-incarnation axes (`src/storage.rs:3694-3737`); codegen restricts it to the host-owned plan and forces the uniform `SNAPBACK_ROW_NOT_FOUND` outcome (`packages/snapback-codegen/index.mjs:1742,1798`); delete/recreate isolation proven (`src/storage.rs:15576-15760`).
- **computed-constructor admission:** unresolvable element access, computed destructuring, and `Function` construction all fail closed (`packages/snapback-codegen/inline-handlers.mjs:163-235,287`).
- **React cleanup without AdminWrite:** child refcounts retire first, then grant-owned `releaseConnection(..., {ifIdle: true})`; sibling socket demand keeps the shared connection; teardown never manufactures socket state (`packages/snapback-react/index.mjs:1734-1760`, `packages/snapback-client/index.mjs:5278-5290`); LLP 0102 §closed-connection amended in the same commit.
- **runtime/artifact identity + sessions dev-loop:** `SNAPBACK_RUNTIME_ARTIFACT_IDENTITY_MISMATCH` with binary/stamp/recovery guidance and the one-command sessions startup inference, both package-tested (`packages/snapback-cli/sessions-dev-loop.test.mjs`, `load-generated.test.mjs`).
- **Contract closure items:** sealed `absent|visible` bounded-children discriminator (`packages/snapback-codegen/index.mjs:3707-3746`) with runtime "exactly one sealed result row" (`src/local.rs:15155`); search requires generated refs and rejects `after: null` before I/O (`packages/snapback-client/package.test.mjs:468-482`); exact discriminated seed carriers (`packages/snapback-client/index.d.mts:440-483`); comparator binds the server-minted principal, strips asserted user ids, and retains the identity nonclaim (`packages/snapback-cli/comparator-profile.mjs:69-70,1415-1470`), with Signal Desk's `session-owner-principal` check refusing configured aliases; browser-secret proof is a random 48-hex canary asserted absent from built assets (`scripts/snapback-package-cold-install.mjs:710-743`); the dual capability ids derive only from private target facts plus the compiled, sha-pinned carrier, with source-byte drift detection in the conformance runner (`src/manifest.rs:5366-5384`, `tests/conformance/relation-activity-publication-v1.mjs:34-45`) — and the carrier's executor/schema hashes bind current bytes (no changes to `src/local.rs`, `src/storage.rs`, `define.mjs` since the carrier refresh). 

## Hosted operator/provider/ephemeral truth — honest

`ephemeralHostedAdapter: false` in the generated manifest; `hosted-product-journey.v1.json` is `status: "failed"` with explicit failed rows and an all-false claim boundary; the supervisor installation witness separates its passed installation proof from `hostedProductJourneyPassed: false` / `hostedEphemeralCapabilityAdvertised: false`; both hosted tickets restate "capability remains false" at every checkpoint. HEAD's new async operator-transaction path is sound: copy-on-write state (`const next = clone(this.#state)`), authorization before the provider promise, sync entry refuses async/thenable executors, canonical `null` replays via `found` rather than truthiness, single-writer key held across the await, and the redacted outer journal advances the floor without response bytes (`packages/snapback-hosted-supervisor/operator-authority.mjs:618-684`, `operator-authority-transaction.mjs:104-214`).

Evidence consistency spot-check passed: the committed `artifacts.json` identity (schema b92a0aa2…, bundle 429def07…, inputs 049994aa…) matches all three receipts and the comparator identity exactly.

## Follow-ups (non-blocking)

1. **Receipt package digests under-bind:** `packageDigest` hashes a fixed entry-file list (`demos/backend-bakeoff/tests/react.mjs:194-206`) that misses imported runtime modules — `client/index.mjs` pulls `agent-authority-brand.mjs` and `rqs.mjs`; `react-binding.mjs` pulls `canonical-client-value.mjs` and `rqs.mjs`. A change to those files would not change the receipt digest. Hash the module closure (current state is consistent — verified via git that nothing drifted since the receipt commit).
2. **Restore-lock ignore anchoring:** `.gitignore:4` anchors `/.snapback.snapback.restore.lock` to the repo root, but the reservation is persistent by design ("stale lock entries are never unlinked", `src/instance_lock.rs:1518`) and the demo's copy now sits as permanent untracked noise. Add a recursive pattern or a demo-ignore entry.
3. React receipts record content hashes but no git source revision; adding one would make retention audits cheaper.
4. Process: run future independent reviews against a pinned, non-shared checkout — live cherry-picks landed here mid-review.

## Assessment

The four mandatory correction classes are genuinely closed with focused tests, the hosted lane is scrupulously honest, and the publication-authority mechanism is now strong — but the reviewed revision contained a material packaged-capability overclaim (confirmed by the concurrent fix), and the program's own evidence bar is unmet: the successful matrix is unretained, the comparator receipt doesn't bind its executing client and predates two relevant fixes, and the staged runtime/cold-install evidence predates the new distribution authority. Rebuild and restage the packaged runtime under the distribution fact, rerun the staged cold-install (with the browser proof), rerun and retain the complete matrix at one revision, then land the revised ranking.

VERDICT: NOT READY
