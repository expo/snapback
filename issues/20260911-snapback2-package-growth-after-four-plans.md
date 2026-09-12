# Snapback 2 package growth exceeds the accepted byte baseline

**Status:** Open
**Priority:** P0 (measured budget breach)
**Owner:** Codex, four-plan implementation commission
**Date:** 2026-09-11
**Related:** LLP 1018.008, LLP 1018.008.005.000, LLP 1018.008.006.000, rules/RULES.md

`node snapback2/scripts/measure.mjs --check` retains a red byte verdict. The
same Node 24.18.0 / esbuild 0.25.9 / gzip 9 packaged ESM-closure measurement gives:

| Entry | Last accepted | Pristine bf8450849 | Four-plan candidate | Candidate delta from pristine |
| --- | ---: | ---: | ---: | ---: |
| client | 136,547 | 142,125 | 145,189 | +3,064 (+2.16%) |
| React | 146,166 | 152,478 | 155,056 | +2,578 (+1.69%) |
| Expo | 149,836 | 156,010 | 158,589 | +2,579 (+1.65%) |
| complete local runtime | 84,580 | 88,008 | 88,053 | +45 (+0.05%) |

All four entries already exceed the 1% guard on the pristine base. This program
adds further package bytes for composed page resources and shared recovery;
the total is not attributed to one implementation by subtracting individually
gzipped files. The complete local runtime remains below its 90,000-byte ceiling
and above its 80,000 target. No measurement root, ceiling, accepted baseline or
normal growth check was changed. The recorded candidate remains
`byte_baseline_accepted: false`; no package publication is qualified here.

Under the author's delegated plan judgment, the implementation retains these
reviewed shared owners and records this size trade explicitly. It does not
claim to have met the normal growth guard. Follow up by attributing the public
entry growth and removing unnecessary emitted code or sharing existing
implementation. Do not hide bytes in an unmeasured entry or grant the candidate
an accepted baseline by rerunning the same failing check. Any later budget
trade must preserve the actual before/after evidence.

The candidate record is the 2026-09-11T15:38:58.398Z append in
`snapback2/metrics/loop.jsonl`; matched pristine runtime evidence is retained in
`metrics/twin.jsonl`. Root's ignored raw logs and exact canonical measurement
functions are under `/tmp/snapback2-four-plans-{measure,baseline-runtime,baseline-package-bytes}.*`.

## One-time publication disposition — 2026-09-11

For the subsequent Linux-capable release, the author explicitly answered:
"Allow this release; retain size cleanup." The request disclosed the exact
client/React/Expo closures, **145,189 / 155,056 / 158,589 gzip bytes**, and the
unchanged **90,000-byte** complete-runtime ceiling. This is permission to
publish that measured package-size trade for this release, subject to all
remaining native/runtime/publication qualification. It does not reset an
accepted baseline, change the normal check, authorize later growth, or close
this cleanup ticket. The original measurements and red verdict remain intact.

## Attributed reduction — 2026-09-11

Source-mapped build attribution found duplicate `value-runtime`, `hash`,
`certificate-identity` and `cursor` code across existing package leaves. Routing
those modules through the existing private `image-runtime` leaf removes 69
duplicated function declarations. No algorithms, hash domains, public entry
closure or measurement roots changed. Canonical builds reproduce all 12 earlier
accepted/pristine/four-plan values; the isolated sharing patch reduces client,
React and Expo by 5,807/5,864/5,865 gzip bytes with byte-identical complete runtime.

The final combined source, including foreground and pending-receipt fixes,
measures **139,450 / 149,260 / 152,792 / 88,086** gzip bytes (client / React /
Expo / complete runtime), at `2026-09-11T18:42:07.888Z`. The net reductions from
the four-plan source are 5,739 / 5,796 / 5,797 bytes for the public entries; runtime
grows 33 bytes. All four still exceed the accepted 1% guard; runtime stays below
90,000 and above the 80,000 target. `byte_baseline_accepted` remains false.

The [attribution report](../benchmarks/runs/2026-09-11-snapback2-followup-diagnostics/bytes-report.md)
and adjacent JSON/CSV preserve module and leaf contributions, source hashes,
canonical closure definitions and all isolated experiments. Leaf gzip sums are
additive within one deduplicated closure; overlapping public entries and
source-module estimates must not be summed. Remaining work is further measured
deletion/sharing or an explicit budget trade, not automatic baseline acceptance.

The release lane incorporates this landed reduction without redoing its work.
The smaller public-entry closures remain within the author's disclosed
release-only exception; the normal guard and cleanup ticket remain open.

## Incremental acquisition implementation — 2026-09-11

The integrated source snapshot `b5c73f084` measures **140,687 / 150,564 /
154,061 / 89,024** gzip bytes (client / React / Expo / complete local runtime),
using pinned Node 24.18.0, esbuild 0.25.9 and gzip 9. The canonical record is
`2026-09-11T20:31:56.073Z`; its raw `dd629ae33` SHA is the ignored qualification
copy's inherited Git metadata, not its source. The run's source manifest binds
the actual snapshot. The retained acquisition evidence records that distinction.

Relative to the preceding final source, this integrated snapshot adds 1,237 /
1,304 / 1,269 / 938 bytes. The public-entry comparison also includes the
independently landed React starter media change; do not attribute every byte
to acquisition alone. The runtime stays under 90,000 but has only 976 bytes of
headroom and remains above its 80,000 target. All four normal 1% growth guards
remain red and `byte_baseline_accepted` remains false. This measurement neither
accepts a new baseline nor qualifies publication.


## Bounded bulk acquisition — 2026-09-11

The combined implementation of LLP 1018.008.007.002 measures **142,809 /
152,738 / 156,231 / 89,995 gzip bytes** (client / React / Expo / complete
local runtime), Node 24.18.0 / esbuild 0.25.9 / gzip 9. The 90,000 runtime
ceiling is unchanged and has five bytes of headroom; the 80,000 target and
existing package-growth guards remain unmet. `byte_baseline_accepted` is false.
An optional persisted-page restart selector was removed, and redundant
normalization/wrappers were deleted to fund the implementation. No budget
increase or publication qualification is inferred from this landing.

The same canonical loop run passes project check (0.433 s), doctor
(0.433/0.028 s), incremental rebuild (2.490 s) and affected consumer checks
(13.320 s). These are separate from full-suite duration and acquisition timing.
The actual record is appended to `snapback2/metrics/loop.jsonl`.

The final cancellation-boundary repair adds five runtime bytes and ten bytes
to each public closure relative to the full loop record above. The final runtime
record is in `twin.jsonl`; public closures use the exact canonical
`packagedEntryBytes` implementation on the final package build.

The subsequent foreground admission repair adds **85 bytes to each public
closure**, producing **142,894 / 152,823 / 156,316 / 89,995** gzip bytes. Its
network recovery module is outside the unchanged canonical local-runtime graph,
so runtime delta is zero. The same pinned canonical measurement was used;
neither the public growth guard nor runtime target is met or rebaselined.
