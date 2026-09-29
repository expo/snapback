from pathlib import Path
import json
r=Path('/Users/ccheever/sb4-np');repo=r/'lane';e=r/'evidence/round5'
t=json.loads((e/'timings.json').read_text());assert json.loads((e/'controls-verification.json').read_text())['allIntendedFailures']
median=t['medianMs'];p95=t['nearestRankP95Ms'];times=' / '.join(f"{x['durationMs']:,}" for x in t['runs'][1:])
llp=repo/'llp/3000.030-native-proof-in-minutes.rfc.md';title='### NP-mac round 5: fresh build output and complete flag destinations'
assert title not in llp.read_text()
with llp.open('a') as f:f.write(f'''

{title}

**The build-route §11 protocol passes; Status remains Accepted for that bounded
route only.** The [round-5 report](../snapback4/reports/20260929-np-macos-slice/round5/REPORT.md)
retains both round-4 reviews, their dispositions, exact commands, every attempt,
raw receipts/native records, controls and independent byte verification.
Astra's NOT READY and Grok's READY WITH CHANGES are pre-fix reviews, not approval
of this revision. Grok arrived during the initial sample and was read in full.

| Finding | Round-5 disposition |
| --- | --- |
| Astra High: successful SKIP_BUNDLING leaves old HBC | Refuse nonempty raw and unmasked resolved settings, pin it empty on build, canonically check/remove the previous product bundle, then require a newly present bundle. Warm A→B regressions cover setting refusal and an exit-zero skipped phase; real warm control retains A with no B receipt/install. Pinned RN script reproduction confirms exit-zero preservation. |
| Astra/Grok Medium: Swift output flags bypass private audit | Audit real OTHER_SWIFT_FLAGS and OTHER_MODULE_VERIFIER_FLAGS on every resolved app/Pods target. Unwrap each forwarded token into its compiler channel; reject malformed cross-channel arguments. Output destinations must be absolute and canonically private, including symlink parents; unknown flags refuse. Resolved Pod interface/index/diagnostic sentinels are preserved before build. |
| Astra Medium: SOURCEMAP_FILE escapes | Refuse nonempty raw/resolved values and pin empty on build; outside sentinel controls pass. Refuse producer/name/config/argument overrides and require the resolved pinned Hermes compiler path. |
| Astra Low: command-status guard removal survives | Failed-Xcode fixture retains a complete valid B product and dependencies but issues no receipt; deleting the status guard fails the test. |
| Grok Medium: PER_ARCH_OBJECT_FILE_DIR / COMPILATION_CACHE_CAS_PATH | Raw overrides refuse and every resolved target destination is checked canonically. Conditional/raw, Pod sentinel, symlink-parent and real app controls pass. |

Final A completes all segments in **181,477 ms**. Five measured warm B builds
all pass: **{times} ms**. Median **{median:,} ms**, nearest-rank p95
**{p95:,} ms**, n=5 complete successes including preparation, install, capture
finalization and hashing. Shared-host load is retained; these are not universal
or quiet-host guarantees. Compared with round 4, median changes by
{median-172045:+,} ms and p95 by {p95-199870:+,} ms, not an isolated guard-cost estimate.

Every earlier attempt remains visible: pre-Grok A passed in 171,717 ms; B was
intentionally interrupted for the late review. After final A, a final-code B
attempt hit a full shared disk during snapshotting and issued no build/proof/run
receipt. ENOSPC also prevented recording its final CLI status/time, which stay
unknown. Removing only the lane's rebuildable Rust incremental cache recovered
space. The declared five-run measured sample began after recovery with the same
final code and native cache; no attempt was silently substituted or called a pass.
Final A/B reuse the normal account and eight-message fixture from pre-final A.

All six final receipts are independently verified against complete app and
xcresult inventories, HBC/compiler identity, selected installed URL/path/runtime,
served-generation facts, native records and finalized artifacts. The visible
JS/PNG changes A→B and the unchanged smoke contract pass. Ten real output-setting
controls preserve outside sentinels; tamper, uncaught cold error, post-success
death, simulator owner/listener and interrupted descendant controls pass.
Checks: 31 helper/preparation/smoke, 28 driver, 10 witness unit and 99 guide;
ten guard-removal mutations are detected. The seven-file local helper patch and
published 0.4.7 client/native-core bytes are unchanged. No wasm change, cap increase,
push or publication. Repack, general native-input closure, physical devices,
M6/M8 admission and broader repeatability remain outside this acceptance.
''')
journal=repo/'snapback4/JOURNAL.md';header='## 2026-09-29 — NP-mac round 5: require fresh JS and private compiler outputs'
assert header not in journal.read_text()
with journal.open('a') as f:f.write(f'''

{header}

Fetched and merged origin/main first (already up to date). Read prompts/reports
r0–r4, Astra's full NOT READY review and the later Grok READY WITH CHANGES review;
both were rechecked. Repack stays withdrawn. Build now rejects nonempty unmasked
SKIP_BUNDLING/SOURCEMAP_FILE and unsafe producer overrides, pins both empty for
Xcode, removes the previous canonical product bundle and requires new output.
Resolved app/Pod Swift and module-verifier flags use their real names, unwrap
-Xcc/-Xfrontend by compiler channel and reject escaping output destinations.
PER_ARCH_OBJECT_FILE_DIR and COMPILATION_CACHE_CAS_PATH get the same canonical
private-output checks. A failed Xcode command retaining a valid product cannot
issue a receipt. Every finding has a detecting test; ten guard mutations fail.

Final A passed full smoke in 181,477 ms. Five complete warm B builds passed:
{times} ms; median {median:,} ms, nearest-rank p95 {p95:,} ms.
LLP 3000.030 remains Accepted for the bounded build route. The pre-final A success,
B interruption for late review, and a final-code disk-full snapshot failure remain
in evidence. ENOSPC prevented that attempt's final time/status record; neither is
invented. Only our rebuildable Rust incremental cache was removed to recover space.
No test/archive jobs ran beside the five measured builds; shared-host load is retained.

Independent app/HBC/receipt/xcresult/native-record/runtime/generation checks pass
for all six final successes. Actual warm-skip, ten output sentinels, tampered
output, cold startup error, post-success death, owner/listener and interrupted
descendant controls pass. Final checks: 31 helper, 28 driver, 10 witness unit,
99 guide and ref-check. No client/core/wasm or helper-patch change; cap unchanged.
Owned simulator 70220322-4798-470D-BE66-E17EAED0B7FD was deleted after collection.
Report: reports/20260929-np-macos-slice/round5/REPORT.md. One appended entry;
commit carries Co-Authored-By: GPT-6 Astra <noreply@openai.com>.
Nothing pushed or published.
''')
print('Appended one LLP measurement record and one journal entry')
