from pathlib import Path
import json,statistics
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round3';repo=r/'lane';v=json.loads((e/'independent-verification.json').read_text());by={x['name']:x for x in v['runs']};names=[f'sealed-b-repack-{n}' for n in range(1,6)];times=[by[n]['commandMs'] for n in names];median=int(statistics.median(times));p95=max(times);a=by['sealed-a-ownbuild-1']['commandMs'];w=by['sealed-b-warm-ownbuild-1']['commandMs'];assert json.loads((e/'controls-verification.json').read_text())['allIntendedFailures']
llp=repo/'llp/3000.030-native-proof-in-minutes.rfc.md';heading='### NP-mac round 3 requalification, 2026-09-29';assert heading not in llp.read_text()
with llp.open('a') as f:f.write(f'''

{heading}

**§11 steps 1–4 pass; Status remains Accepted for the bounded slice.** The
[round-3 report](../snapback4/reports/20260929-np-macos-slice/round3/REPORT.md)
retains both round-2 NOT READY reviews, all development attempts, final receipts,
raw native dependency records, independent verification and control diagnostics.
Those prior reviews are not post-fix approvals.

Repack now requires the resolved app/Pods graph and complete compiler/linker
coverage, with actual input hashes and outside-root refusal. Search/include
paths, config/file lists, resources, scripts, compiler plug-ins and generated
inputs are covered or conservatively refused. Script/tool reuse is restricted
to the exact qualified installed tree. Product/intermediate/cache outputs stay
private; all target settings are checked, and unqualified copy phases refuse.
Grok's later post-pod finding is also fixed: source provenance, post-Pods/codegen
inputs and post-Xcode generated changes are separate stages. Repack reproduces
and compares the post-Pods stage before and after export. Ten guard mutations
are detected by tests; real external-header compilations demonstrate the original
compatibility hole. The prior Pods-link native attempt is inconclusive; its final
replacement starts with a passing baseline and asserts both injected link and
target in the refusal.

| Complete final run | Result |
| --- | --- |
| Own A | {a:,} ms; all three segments passed |
| Five repack+smoke runs | {', '.join(f'{x:,}' for x in times)} ms; all passed |
| Median / nearest-rank p95, n=5 | **{median:,} / {p95:,} ms**; final pinned sample {'meets' if p95<=120000 else 'misses'} 120,000 ms target |
| Warm own B | {w:,} ms; all three segments passed |
| Checks | 32 helper/preparation, 28 driver, 10 witness unit, 98 guide; ten killed guard mutations |
| Identity and controls | Native bytes/fingerprint and both input keys match; HBC 98; JS/assets/output differ; full runtime binding retained. Native/output, scheme/base, cold-error, post-success death and owner/listener controls fail for their intended reasons. |

The pre-final 195,327/141,120 ms successes under heavy shared load and the
three unlike-stage refusals remain visible. A preceding five-run stage sample
also passed, then was repeated after the copy-phase guard changed the adapter.
No unqualified speed or broader repeatability claim follows. Client/native core
remain published 0.4.7 bytes and the helper patch is unchanged from round 2.
No wasm change or cap increase, push, publication or benchmark admission.
''')
journal=repo/'snapback4/JOURNAL.md';title='## 2026-09-29 — NP-mac round 3: close native inputs and private outputs';assert title not in journal.read_text()
with journal.open('a') as f:f.write(f'''

{title}

Merged origin/main first (b65817c6b7), retaining both journal sides. Read Astra's
round-2 NOT READY review and Grok's later review in full. Closed their native
input and output-directory findings with all-target app/Pods graph checks,
compiler/linker coverage, actual dependency hashes, strict script/tool pins,
private Xcode output roots and conservative copy-phase refusal. Fixed the
additional wrong-stage baseline: both routes compare complete post-Pods/codegen
inputs, separately from live provenance and Xcode-generated changes.

Corrected round 2's Pods-link control to inconclusive. The replacement final
control follows a passing unmodified repack and asserts the exact injected link
and target in its refusal. Real arm64 compiler controls, ten killed guard
mutations, all §11 bounded controls and independent artifact verification pass.
Affected tests: 32 helper/preparation, 28 driver, 10 witness unit, 98 guide.

Final own A {a:,} ms; five complete repacks {', '.join(f'{x:,}' for x in times)} ms;
median/p95 {median:,}/{p95:,} ms; warm own B {w:,} ms. All three smoke segments
pass. Retained all earlier attempts, including load-affected slow successes and
wrong-stage refusals. LLP 3000.030 remains Accepted for this narrow qualification.
Published client/native-core bytes and the disclosed round-2 helper patch are
unchanged; no client/query/smoke relaxation, wasm change or budget increase.
Report: reports/20260929-np-macos-slice/round3/REPORT.md. Only the owned simulator
was used and removed. Nothing pushed or published. Commit carries
Co-Authored-By: GPT-6 Astra <noreply@openai.com>.
''')
print('appended one journal entry and round-3 LLP disposition')
