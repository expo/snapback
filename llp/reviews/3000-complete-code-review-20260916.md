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
| Late online asset success after close | Delayed-fetch probe returned a 13-byte blob URL after close | [asset lifecycle](../../issues/closed/20260916-snapback4-online-asset-after-close.md) |
| Native build chooses an old crate's wasm | Built zzz_old, renamed to aaa_new, changed behavior; check still copied zzz_old bytes | [artifact selection](../../issues/closed/20260916-snapback4-native-build-selects-stale-artifact.md) |
| Native fuel does not bound host allocation/logs | Three reviewers traced guest lengths allocated before range validation, no memory limiter, unbounded log retention | [native bounds](../../issues/closed/20260916-snapback4-native-host-memory-bounds.md) |
| Durable native state crosses code revisions | Declaration-only digest documented in LLP 3000.005 and traced in manual/scheduled admission | [continuation identity](../../issues/closed/20260916-snapback4-native-job-continuation-code-identity.md) |
| Fixed client snapshot page cannot recover from legal wide rows | Sol connected existing real-server oversized-page regression to hardcoded PAGE=4000 and terminal refusal | [snapshot recovery](../../issues/closed/20260916-snapback4-snapshot-page-size-recovery.md) |
| Indivisible join/commit can exceed response bound | Lead probe: limit1 returned45 events /18006410 bytes, above16777216; Sol independently traced expansion | [sync progress](../../issues/20260916-snapback4-sync-indivisible-join-progress.md) |
| Physical rule and membership-history work is unbounded | Complete history reconstruction and expired-sibling scans precede visible page/probe bounds | [physical work](../../issues/20260916-snapback4-physical-rule-probe-work.md) |
| Browser store shared without exclusive owner | All three external reviewers traced no-Web-Locks branch, disabled journal and orphan adoption | [browser ownership](../../issues/closed/20260916-snapback4-web-store-without-locks.md) |
| Client IDs manufacture future milliseconds and use weak fallback | Muse/lead traced per-ID timestamp advance and Math.random fallback | [client IDs](../../issues/20260916-snapback4-client-id-clock-and-entropy.md) |
| Rust normalization collides over valid names | Lead/Sol/Muse: fooBar/foo_bar, Self, underscore and namespace cases | [Rust emission](../../issues/closed/20260916-snapback4-rust-codegen-identifier-collisions.md) |
| Nullable target sync group readable online but absent in snapshot | Lead Rust probe: no diagnostics, online row, snapshot([],1) | [null group](../../issues/closed/20260916-snapback4-null-sync-group.md) |
| Partial npm publication cannot converge on rerun | Sol traced unconditional platform-then-client publication and immutable version retry | [publication](../../issues/closed/20260916-snapback4-publication-cannot-resume.md) |
| Service credential trust is wider than row-rule seat names suggest | Grok/Sol paths plus supported service:worker tests and identity-admin endpoints | [trust model](../../issues/20260916-snapback4-service-worker-trust-boundary.md) |
| Durable history/principals lack coordinated retirement | Lead/Sol histories/receipts plus Muse guest principal retention | [retention](../../issues/20260916-snapback4-durable-record-retention.md) |
| Route authority test races its short fixture deadline | Untouched baseline failure; report route also hardcoded 1 ms | [route fixture](../../issues/closed/20260916-snapback4-route-admission-test-deadline.md) |

The repair qualification also exposed [stale-refusal journal recovery](../../issues/closed/20260916-snapback4-journal-recovery-stale-refusal.md), recorded separately and repaired through the existing replay-admission path.

Postgres mismatched-ID replay is already tracked in
[the existing C3 ticket](../../issues/20260915-snapback4-postgres-replay-skips-the-id-binding.md).
The baseline acquisition assertion is already tracked in
[its existing ticket](../../issues/closed/20260916-snapback4-acquisition-readiness-client-test-baseline.md).
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
measurements. In particular, [the existing blocking-suite budget ticket](../../issues/20260913-snapback4-blocking-suite-over-60-seconds.md)
remains open: the baseline's 705 seconds does not satisfy the adopted 60-second
budget, even apart from its two assertion failures. No timing compliance is
claimed by this review.

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

The first repair candidate is `f6b514c35ec4cffc7fe102a51e583fcfba28f636`.
Its complete suite ran on a clean Linux checkout of that exact commit in
681 seconds. All 1,230 Rust tests passed (4 existing ignored tests); builds,
wasm, package/chat/Expo typechecks, chat compilation and fixture tests passed.
Client tests passed 507/508. The one failure was the cancellation-journal
ordering regression, which exposed eager recovery against stale rows before
catch-up. This is a failed candidate test, not a green complete-suite claim.

[The fresh Sol repair review](3000-code-review-20260916-repairs-sol.md)
identified two additional material gaps: source-checkout failures could block
exact-tarball resume, and custom persistence alternates could escape orphan
discovery. Both were accepted for follow-up repair. [Grok's independent repair review](3000-code-review-20260916-repairs-grok.md)
returned **NO MATERIAL FINDING REMAINS** for the same candidate without
receiving Sol's findings. Sol's additional findings were still accepted and
repaired; agreement is not required to act on a demonstrated defect.

The production follow-up is `7e0fc21da8d7675b4a5ec2a418604b2135c438a9`.
Its rebuilt client suite passed 512/513; the remaining failure was a new test
fixture opening a never-initialized primary without a backend, before the
intended malformed-orphan assertion. All original journal and stale-orphan
regressions passed. The fixture-only correction is
`ebc9f14621f05584b150444241c8706a9a7ec746`; production source is unchanged.
[Sol's final review](3000-code-review-20260916-repairs-sol-followup.md)
returned **NO MATERIAL FINDING REMAINS** for that exact commit.

Npm publication is not an action performed by this review.

## Delivered repair scope

Sixteen new findings received filesystem tickets, including the journal ordering
issue found during qualification. Eleven new tickets are repaired and closed;
the pre-existing acquisition fixture ticket is also closed. Five new tickets
remain open: indivisible sync progress, physical private-work bounds, secure
client entropy (time/order fixed), worker capability separation (trust documented),
and coordinated durable-record retention. The four architecture write-ups above
cover their component and protocol alternatives. The existing Postgres C3 work
is independently owned; the existing suite-budget ticket remains open.

Compatibility changes are explicit: legacy or changed-code native job runs park
before another chunk; built-in durable browser storage requires Web Locks;
custom persistence supplies a validated exclusive claim/recovery contract;
nullable target sync group columns now fail schema validation; publication reuse
requires explicit `--resume`. No server ceiling was raised.

## Final qualification

| Check | Revision/content | Result |
| --- | --- | --- |
| Complete Rust workspace suite | `f6b514c35`; later runtime changes are comments only | 1,230 passed, 4 existing ignored |
| Complete client suite | `ebc9f1462`, production built at `7e0fc21da` | 513 passed, 0 failed, 0 skipped, 66.93 s |
| Package typecheck and build | `7e0fc21da` | Passed |
| Affected guide suite | `7e0fc21da` | 37 passed |
| Native crate rename probe | Actual CLI built at `f6b514c35` | New artifact selected; stale artifact rejected |
| Publication | Mocked signing/registry suite, included in client run | 24 passed; no real npm commands against the registry |
| Source size and authored Markdown targets | Final authored scope | No source file over 1,500 lines; no missing local Markdown targets |

The complete blocking command at the first candidate was red on the journal
case; after correcting that path, the entire affected client suite was rebuilt
and rerun. The later test-only fix was followed by another complete client run.
The expensive unchanged Rust suite was not repeated. This is the aggregate
qualification of the final semantic change, not a claim that a final full
`scripts/test.sh` invocation returned zero or met the 60-second budget.

[Grok's production follow-up](3000-code-review-20260916-repairs-grok-followup.md)
returned **NO MATERIAL FINDING REMAINS** for `7e0fc21da`. Its
[final fixture follow-up](3000-code-review-20260916-repairs-grok-fixture.md)
also cleared `ebc9f1462`; both Sol and Grok therefore reviewed the exact final
production and test content with no material finding remaining.

Detailed logs are retained in the ignored local run ledger's `logs/` directory
and on the dedicated Linux verifier. Browser/Swift power-loss and live iOS
qualification were not performed; publication validation here is mocked.
