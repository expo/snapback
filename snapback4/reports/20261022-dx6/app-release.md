# DX6 implicit-retirement response custody

The broader App model exposed a real I12 regression while validating staging-clock changes. A held mutation had already executed, and its body was parsed during local credential cleanup, but its caller received `pending`. Instrumented copies of the SDK confirmed the parsed body reached capture only after raw close had ended capture; the App still owned local session cleanup.

The first release-only hold repaired online seed 2321 but the required full model exposed an earlier peer-fencing path at seed 2656. The final implementation gives each scope one reference-counted capture lifetime before teardown. Every scheduled scoped credential set/delete and retirement task owns a reference, including overlapping cleanup and clients that appear after preparation began. Release waits only for existing local cleanup; it does not wait for an authentication operation or remote revocation queue. The existing global-logout publication order remains intact.

The local model then exposed seed 788: a validated body could still wait behind extra decoder/caller promise continuations while cleanup released its last reference. Both transports now capture once in `readResponse`'s synchronous validated-body callback, before that decoder resolves to its caller. Seed 2873 exposed the complementary live-client boundary: a body validated before close was not retained while later settlement crossed a fence. An invocation now retains validated bodies throughout its live and closing lifetime. Completed capture is irreversible; later begin/hold calls cannot reopen it. ClosingResponses has no new timer, microtask grace or network wait. The minimized histories for all four seeds run against online and local clients without weakening their full outcome oracle.

The local post-admission close branch also preserves its settlement entry through close arbitration instead of returning pending early. Actual Wasm and native devices announce committed outbox work while the admission continuation is held; both new regression cases retain the full dispatched outcome after close overtakes that continuation. A direct decoder/cutoff test also verifies that bodies received after completion cannot replace a known outcome or turn an unknown one into success.

The initial affected App group also found a synthetic fixture using the literal Unicode bearer `token-慢`, which Fetch Headers correctly refuses. The fixture now encodes the bearer suffix as ASCII while retaining the actual Unicode principal and all storage-key collision assertions. Its complete 14-test file passes.

This implements the existing cutoff in LLP 3000.013 §6 and §12.7, now pointed to by the DX6 amendment. The raw response still belongs to its invocation; unknown responses after cleanup retain their original retry ID.

At this implementation commit, the final full online/local 5,000-history model and expanded App/HTTP/close tests are running; their results are recorded in `app-release-model-final.log` and `app-release-affected-final.log`. Prior to the last live-body/early-admission repair, the expanded affected group passed 220/220 and online 5,000 passed; the local model correctly blocked completion at seed 2873. All minimized histories and the three new direct/actual-device cutoff tests now pass. The workstream coordinator owns final qualification, reviews and platform checks.


Final source 0bf50ac186 scopes retained E_AUTH responses to the dispatch's
monotonic rotation revision, at capture and delivery. Plain sign-out preserves
its own known refusal; rotating away invalidates retiring responses even after
failed/canceled rotation. An adopted successor remains current while local
persistence finishes. Focused security passes 26/26; expanded App/HTTP/close/
security 329/329; both full 5,000-history tiers pass 60/60. The earlier retained-pack
candidate fails the stale-refusal negative controls. The installed DX6 hook runs
the entire session-security file and passes against the final tarball.

Both fresh R6 reviews return READY on the same committed amendment/source.
Fresh Linux consumer qualification passes on Ubuntu 24.04 and Alpine, with no
publication receipt; source and tarball digests are in verification.json and
linux-consumer.json. The canonical 23-file client run passes 383, fails 0 and skips
one unavailable historical binary. Assigned-Mac final verification remains
partial due to connectivity; WORKSTREAM-REPORT.md records that gap explicitly.
