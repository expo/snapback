from pathlib import Path
import json,hashlib,time
r=Path('/Users/ccheever/sb4-np');repo=r/'lane';e=r/'evidence/round4'
def read(p):return json.loads(p.read_text())
assert read(e/'controls-verification.json')['allIntendedFailures']
assert read(e/'independent-verification.json')['fullSmokePass']
assert all(x['exitStatus']==0 for x in read(e/'cleanup.json')['commands'])
rows={}
for family in ['astra','grok']:
 p=r/f'reviews/npmac-r3.{family}.md';copied=e/f'input-{family}-review.md'
 assert p.read_bytes()==copied.read_bytes(),'review changed: reread it before finishing'
 rows[family]={'exists':True,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'readInFull':True,'verdict':'NOT READY (round-3 repack)'}
(e/'reviews-final.json').write_text(json.dumps({'checkedAt':int(time.time()*1000),'reviews':rows},indent=2))
p=repo/'llp/3000.030-native-proof-in-minutes.rfc.md';s=p.read_text().replace('**Status:** Draft','**Status:** Accepted',1)
s=s.replace('Current\nruntime/timing results will be filled after the commissioned build protocol.', '''**The round-4 build-route §11 protocol passes; Status is Accepted for that
route only.** A completes all three segments in 145,014 ms. The five warm B
builds all pass: 199,870 / 196,228 / 148,926 / 172,045 / 148,047 ms. Median
**172,045 ms**, nearest-rank p95 **199,870 ms**, n=5. Every invocation includes
preparation, install, all smoke segments, capture finalization and hashing;
no attempt was discarded. Shared-host load varied and is retained per command.
No complete cold-proof measurement was made; stage 0's 359 s cold native
build/install is preparation context with smoke/setup additional.

All six own-build receipts are immutable and independently verified against
complete app/build-result inventories, HBC, preserved native records, selected
bundle/runtime observations, generation/facts, app probes and finalized artifacts.
A/B HBC and output hashes differ; native Mach-O equality is not demanded of a
real Xcode rebuild. Eight retained messages, changed marker/PNG, config/font/
local media observations and server-only classifications remain unchanged.

Seven real output controls (four linker files plus the existing three directory
settings) refuse their exact injected setting/path and preserve outside sentinel
hashes before compilation. Built-output tampering refuses before install; real
cold error and death after a successful restart receipt fail. Simulator owner,
listener and interrupted group/lease controls pass. Checks pass: 31 helper/
preparation, 28 driver, 10 witness unit, 99 guide; four deliberate guard removals
are detected from a passing baseline. Both round-3 reviews were rechecked.
Repack stays withdrawn, including Grok's late flag/overlay finding; none of these
results is a complete compatibility-key, general SDK or M6/M8 admission claim.
The witness card and M1 READMEs offer --build with these measured costs.
Published 0.4.7 client/native-core bytes and the disclosed helper patch are
unchanged. No wasm change/budget increase, push or publication.''')
assert 'results will be filled' not in s;p.write_text(s)
p=repo/'snapback4/JOURNAL.md';entry='''

## 2026-09-29 — NP-mac round 4: withdraw repack; qualify own-build smoke

Merged origin/main first as 9bc0a72037, preserving every journal line from both
parents. Read prompts/reports r0–r3 and Astra's full round-3 NOT READY review;
Grok's NOT READY review arrived during controls and was read/rechecked. Following
the supervisor's ruling, removed the repack implementation and its reuse loop,
asset helper, eligibility pin and emitted proof label. Old CLI/helper selectors
refuse before preparation with --build recovery. LLP 3000.030 keeps the full
deferred design, all findings (including Grok's missed Swift flags/overlays) and
historical timings; no complete native compatibility-key claim remains.

Own-build keeps non-GUI Xcode/simctl, immutable build/proof receipts, actual
selected installed HBC binding, served-generation residency facts, unchanged
smoke classifications, process-group cleanup and private outputs. Custom linker
map/dependency/LTO/SDK-import destinations now refuse, with canonical resolved
checks for every app/Pods target. Seven real output controls preserve outside
sentinels; a Pod-target command-boundary test detects removal of the resolved guard.

A's full smoke passed in 145,014 ms. Five complete warm B --build runs, after a
visible JS/PNG edit, all passed: 199,870 / 196,228 / 148,926 / 172,045 / 148,047 ms.
Median 172,045 ms; nearest-rank p95 199,870 ms. Shared-host load and every attempt
are retained; no quiet-host or cold end-to-end claim. Guide/M1/Expo READMEs use
these honest timings; six-minute cold native preparation remains historical
stage-0 context with smoke/setup additional. LLP 3000.030 stays Accepted for the
build route only. Repack remains withdrawn regardless of historical speed.

Actual tampered-output, cold-error, post-success-death, owner/listener and
interrupted-descendant controls passed. Independent inventories/HBC/build-result/
record/receipt/artifact checks passed for all six successes; 31 helper, 28 driver,
10 witness unit and 99 guide tests passed, with four detecting guard mutations.
The 0.4.7 published client/native core and seven-file helper patch are unchanged;
no wasm/budget change. Owned simulator 4DBA489E-DE5A-4ECE-B0FD-8DEC30CBFA17 was
deleted after collection. One appended entry; nothing pushed or published.
Report: reports/20260929-np-macos-slice/round4/REPORT.md. Commit carries
Co-Authored-By: GPT-6 Astra <noreply@openai.com>.
'''
assert '## 2026-09-29 — NP-mac round 4:' not in p.read_text();p.write_text(p.read_text()+entry)
print('Build acceptance and one journal entry finalized')
