# Snapback 4 code and architecture review — 2026-09-16

Requested by Charlie Cheever: review the project, obtain independent Grok and
Muse reviews, file actionable tickets, write up major direction questions,
then repair what can be safely completed and push main.

Baseline: repository `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15`, Snapback 4
0.2.26. Reviewers inspected the same production source. Documentation/tickets
were drafted concurrently near finalization; reports disclose that where seen.

## Received reviews and scope

- [Grok 4.6, xhigh](3000-code-review-20260916-grok.md): local CLI; the first invocation stopped at orientation, then the same session completed the source review.
- [Muse first pass](3000-code-review-20260916-muse.md) and [supplement](3000-code-review-20260916-muse-supplement.md): remote Linux CLI at the same pin. The first pass could read/search but its shell sandbox failed; the second used read-only shell instructions and filled the named gaps. The CLI's default model was used; no unsupported model identity is inferred.
- [Codex gpt-5.6-sol, xhigh](3000-code-review-20260916-sol.md): separate read-only review lane, plus lead GPT-6 review and reproduction.

Reviewers were instructed not to read each other's reports, spawn agents,
clone, mutate source or run full builds. Raw reports are preserved with their
own confidence labels; their assertions are not automatically accepted.

Aggregate coverage: core interpreter/rules/storage/identity/assets/actions,
effects/jobs/native/partition protocol; compiler/binder/code generation and
current authoring guides; HTTP/CLI/deploy/rollback; device memory/SQLite/FFI;
online/local/web/React/server TypeScript; Expo Swift bridge; publication,
build and test machinery; the experimental Postgres boundary. Large test,
measurement and language files were sampled by semantic boundary. This is a
complete project-scope review, not a claim that every line or third-party
dependency was audited. No new live browser, iOS simulator or power-loss
qualification was performed. Existing suites and focused executable probes
supply the validation listed below.

## Accepted findings and tickets

| Finding | Evidence at review | Ticket |
|---|---|---|
| Late online asset success after close | Delayed-fetch probe returned a 13-byte blob URL after close | [asset lifecycle](../../issues/20260916-snapback4-online-asset-after-close.md) |
| Native build chooses an old crate's wasm | Built zzz_old, renamed to aaa_new, changed behavior; check still copied zzz_old bytes | [artifact selection](../../issues/20260916-snapback4-native-build-selects-stale-artifact.md) |
| Native fuel does not bound host allocation/logs | Three reviewers traced guest lengths allocated before range validation, no memory limiter, unbounded log retention | [native bounds](../../issues/20260916-snapback4-native-host-memory-bounds.md) |
| Durable native state crosses code revisions | Declaration-only digest documented in LLP 3000.005 and traced in manual/scheduled admission | [continuation identity](../../issues/20260916-snapback4-native-job-continuation-code-identity.md) |
| Fixed client snapshot page cannot recover from legal wide rows | Sol connected existing real-server oversized-page regression to hardcoded PAGE=4000 and terminal refusal | [snapshot recovery](../../issues/20260916-snapback4-snapshot-page-size-recovery.md) |
| Indivisible join/commit can exceed response bound | Lead probe: limit1 returned45 events /18006410 bytes, above16777216; Sol independently traced expansion | [sync progress](../../issues/20260916-snapback4-sync-indivisible-join-progress.md) |
| Physical rule and membership-history work is unbounded | Complete history reconstruction and expired-sibling scans precede visible page/probe bounds | [physical work](../../issues/20260916-snapback4-physical-rule-probe-work.md) |
| Browser store shared without exclusive owner | All three external reviewers traced no-Web-Locks branch, disabled journal and orphan adoption | [browser ownership](../../issues/20260916-snapback4-web-store-without-locks.md) |
| Client IDs manufacture future milliseconds and use weak fallback | Muse/lead traced per-ID timestamp advance and Math.random fallback | [client IDs](../../issues/20260916-snapback4-client-id-clock-and-entropy.md) |
| Rust normalization collides over valid names | Lead/Sol/Muse: fooBar/foo_bar, Self, underscore and namespace cases | [Rust emission](../../issues/20260916-snapback4-rust-codegen-identifier-collisions.md) |
| Nullable target sync group readable online but absent in snapshot | Lead Rust probe: no diagnostics, online row, snapshot([],1) | [null group](../../issues/20260916-snapback4-null-sync-group.md) |
| Partial npm publication cannot converge on rerun | Sol traced unconditional platform-then-client publication and immutable version retry | [publication](../../issues/20260916-snapback4-publication-cannot-resume.md) |
| Service credential trust is wider than row-rule seat names suggest | Grok/Sol paths plus supported service:worker tests and identity-admin endpoints | [trust model](../../issues/20260916-snapback4-service-worker-trust-boundary.md) |
| Durable history/principals lack coordinated retirement | Lead/Sol histories/receipts plus Muse guest principal retention | [retention](../../issues/20260916-snapback4-durable-record-retention.md) |
| Route authority test races a 50 ms fixture deadline | Untouched baseline failure, pending diagnosis | [route fixture](../../issues/20260916-snapback4-route-admission-test-deadline.md) |

Postgres mismatched-ID replay is already tracked in
[the existing C3 ticket](../../issues/20260915-snapback4-postgres-replay-skips-the-id-binding.md).
The baseline acquisition assertion is already tracked in
[its existing ticket](../../issues/20260916-snapback4-acquisition-readiness-client-test-baseline.md).
Those were not filed again. The Postgres binding repair was also observed in an active, independently supervised C3 lane on the fleet (dirty dedicated worktree); this review does not overwrite or duplicate that lane's work.

## Recommendations not accepted as new defects

- **Cross-seat claim/verification as an immediate ACL bypass (Grok 1–2):** the supported worker intentionally uses service:worker for other declared seats. Any service also administers account sessions. There is no existing per-seat worker isolation contract. The authority ambiguity is accepted as architecture/documentation work above; a single route-name comparison would break the runtime without narrowing all privileged paths.
- **Bounded journal overflow loses an admitted write (Grok 5/Muse S3):** journal capture before the first await is best effort; ordinary successful admission waits for IDB persistence, and failure discards memory. Closing before admission completes has narrower documented guarantees. No new reproduction disproved that contract. The no-locks branch is separately accepted.
- **undefined-vs-absent React argument key collision (Muse V5):** the JSON wire drops undefined object fields too; the two shapes are not distinct supported backend arguments. BigInt is outside that wire. No defect established.
- **Production Origin reflection (Grok 10/Muse V4):** bearer credentials are explicit and no cookie credentials are enabled; development persona/system doors have their own origin fence. No browser credential disclosure was shown. Origin allowlists are an optional deployment policy, not an authorization repair demonstrated here.
- **Signup email existence (Grok 9):** explicit account creation and useful duplicate-account refusal expose existence by design; generic success would require an email-verification/recovery flow that is not the current implementation. No new ticket without a changed product contract.
- **Output E_BOUND after construction (Grok 6):** indivisible output abort is an intentional existing correction; physical allocation remains covered by the resource research. Do not restore oversized successful responses merely to keep a capped-read shape.
- **Abort under worker admission saturation (Grok 7):** bounded overload shedding intentionally closes excess work rather than block a serving thread on an overload response. Clients treat transport failure as retryable. No additional correctness break established.
- **Expo path traversal (Muse N4):** the supported local client constructs its store name with encodeURIComponent; direct custom opener calls are trusted application code. No untrusted path through the paved client was found.
- **No mandatory notarization (Muse N6):** signed-only publication is explicitly represented, logged and tested. No unrequested policy change to required notarization follows from review.
- **Asset grant/send race (Muse S6):** a transfer already authorized may finish while a row changes; the existing transfer grant/once-consumption protocol handles that lifetime. Recalling authorized bytes is not the current contract.
- **Postgres global-sequence index (Muse S7):** withdrawn by Muse after inspecting per-partition storage access.
- **Cross-tab session refresh and large acknowledgement maps (Muse S4/S5):** conditional hypotheses without a closed supported-path reproduction. Kept in the raw report, not promoted to validated defects.
- **CLI SQL user-selected huge --limit (Muse V6):** trusted local developer chooses materialization size. No network authority or new default-path issue; lower priority than the admitted request bounds above.

Many September 13 Open ticket copies have matching closed resolutions and
implemented repairs. This review did not resurrect their historical claims:
private file modes, dev origin fencing, session/KDF changes, upload staging,
asset cache/range/once behavior, catalog authentication and server CSPRNG are
present. Existing performance and witness tickets remain scoped to their own
measurements.

## Architecture write-ups

Updated existing documents rather than minting overlapping numbers:

- [3000.000](../3000.000-atomic-schema-and-release-activation.research.md): content-bound native continuation, conservative parking versus retaining old executable versions.
- [3000.001](../3000.001-durable-replica-and-write-lifecycle.research.md): one durable browser ownership contract, platform alternatives, lifecycle fences and client ID time.
- [3000.002](../3000.002-end-to-end-resource-bounds.research.md): staged byte-bounded sync, authority-history checkpoints/retention, private physical work and native allocation.
- [3000.009 §16](../3000.009-general-purpose-backend.rfc.md#16-code-review-2026-09-16-worker-credential-trust-research): deployment-trusted workers versus isolated integration capabilities. This is research, not a new author acceptance.

The evidence supports focused protocol redesigns, not a wholesale rewrite of
SQLite, the interpreter or the backend. Device atomic visibility and revocation
must survive any sync fragmentation; privacy-uniform probe behavior must
survive any physical-work bound. No new ceiling or unrelated gate is added.

## Verification and repair status

Initial untouched baseline on Linux, Node 24.13.1, Rust 1.97.0:
`scripts/test.sh` finished in 705 s. Build, wasm, package/chat/Expo typechecks,
fixture tests and the majority of Rust/client tests passed. Two stages were
red: one route admission assertion (expected one request, got zero under a
50 ms fixture deadline), and the already-tracked acquisition test (`guarded`
expected E_OFFLINE but got an online answer). Baseline logs were retained
outside the repository; these are not attributed to review repairs.

Repair implementation and final qualification will be recorded here before
landing. Npm publication is not an action performed by this review.
