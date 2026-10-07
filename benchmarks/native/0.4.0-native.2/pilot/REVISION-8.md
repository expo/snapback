# Revision 8 — Phase-2 cleanup EPERM and retained measurement continuation

Authority: Lane P3 user instruction, 2026-10-07. Governing context is
LLP 0201.000 §§3–7 and LLP 0201 D7. This corrects the pilot harness; the
qualified native.2 instrument, builder source, prompts and aids are unchanged.

## Defect and classification

In `clique-native-pilot2-20261006-round2`, chain
`chain-fec3cb18-ab16-41cd-b308-1a679a8e034c` completed Snapback 4 authoring,
including M1–M8, final report and essay. Both attempt-01 source audits returned
all checks true. Its semantic handoff result records `pass: true`, before
compilation and device work. `finally: stop(process)` then raised macOS EPERM
and replaced the successful return. Stage-based attribution incorrectly called
that exception a semantic builder refusal. No native product outcome exists.

Owned group and PID cleanup now treats ESRCH and EPERM as reasons to recheck
live, non-zombie membership. It retains bounded TERM/KILL escalation and fails
if live members remain after the final recheck. EPERM alone never establishes
either successful cleanup or a product failure. ProcessOwner still checks each
PID/start identity immediately before signaling, preserves foreign processes,
and skips zombies. The signal audit covers `common.stop` (`killpg` and direct
`kill`), `ProcessOwner.cleanup` (`kill`), `wait_builder` (`kill(pid, 0)`, probe
only), `convex-owned.py` (direct child, same group), and the Node Convex preflight
(direct child, bounded escalation and `ps` recheck). Test-owned inert process
termination is not a product cleanup path. The qualified driver's signal sites
are outside this harness revision and remain frozen.

Semantic refusal now requires an explicit invalid descriptor/schema or a
recognized semantic validator refusal. Launch errors, unavailable validators,
unexpected output and cleanup errors classify as `operator-setup` harness
defects, never as a builder handoff refusal. A passing semantic result is written
and returned with separately recorded cleanup errors; the caller checks cleanup
before compilation. Cleanup in command, source-audit, installation, browser,
Convex wrapper and preflight paths retains the primary result/error and records
cleanup separately. An unresolved cleanup failure stops progression even when
the preceding semantic or measurement result succeeded. It grants no automatic
setup retry and does not erase observed product failures.

## Sealed record and one-use continuation

`attempts/snapback4-cleanup-refusal-reclassified/RECLASSIFICATION.json`
supersedes the incorrect attempt-01 attribution as
`harness-defect-cleanup-failure`, `outcomeClass: operator-setup`,
`productOutcome: null`, `setupRerunsConsumed: 0`. The old attempt, scratch,
builder lane, custody snapshot and stopped chain remain in place. Full retained
inventories, successful semantic result, completed builder end and prior seal
are bound into the record; revision metadata binds its hash.

`pilot-chain.sh --resume-cleanup-refusal` admits this record once, verifies
retained evidence, no live owned builder/semantic group, free lane ports and a
cold Convex lane, then runs:

1. Snapback 4 `after-builder.sh --resume-cleanup-refusal`: attempt-02, fresh
   scratch from unchanged custody, static admission, both normal gating source
   audits, semantic handoff, Release build and ordinary M6/M8 measurement.
2. The original Convex builder, with unchanged prompt, aids and authoring rules.
3. The ordinary Convex measurement path.

A failed gating step still stops the chain. Neither special admission nor
reclassification bypasses audits or semantic validation. Reuse after a new
chain/attempt refuses. The excluded attempt-01 does not consume the ordinary
single setup rerun allowance; that allowance still needs explicit attribution.

This native.2 packet began as a fresh seal containing revision-7 harness source,
without importing the native.1 packet's revision history. Preserve that original
seal verbatim as `PACKET.v1.sha256` and `PACKET.v7.sha256`; these are aliases of
the same native.2 baseline, not invented intermediate revisions. Preserve its
source under `preparation/revision8/prior-packet/`. The next documented source
revision is 8, with its exact diff and record hashes in `metadata/revision-8.json`.
All older seals present in a packet are retained.

## Verification

Regressions exercise zombies appearing between membership sampling and TERM or
KILL, EPERM/ESRCH with surviving live members, direct-child and ProcessOwner
signals, a real semantic validator pass followed by injected cleanup failure,
unavailable validators, preservation of primary command errors, record tampering,
one-use admission, and serial continuation. Run `scripts/selftest.py` on macOS
and `scripts/verify.py --ready` against the resealed packet; receipts belong in
`preparation/revision8/`. No product pass or score follows from Release progress.
Only eb1000 and the Apartment mini are used, with the dedicated simulator.
