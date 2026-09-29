from pathlib import Path
import json
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round2';repo=r/'lane';s=json.loads((e/'qualification-summary.json').read_text());v=json.loads((e/'independent-verification.json').read_text());runs={x['name']:x for x in v['runs']};a=runs['sealed-a-ownbuild-2'];b=runs['timed-b-warm-ownbuild-1']
p=repo/'llp/3000.030-native-proof-in-minutes.rfc.md';text=p.read_text();lines=text.splitlines();lines=[('**Revised:** 2026-09-29 (NP-mac round 2: selected-bundle, served-fact, native-input and process cleanup fixes; §11 requalified)') if l.startswith('**Revised:**') else l for l in lines];text='\n'.join(lines)+'\n'
assert '### NP-mac round 2 requalification' not in text
text+=f'''
### NP-mac round 2 requalification, 2026-09-29

**§11 steps 1–4 pass again; Status remains Accepted.** The
[round-2 report](../snapback4/reports/20260929-np-macos-slice/round2/REPORT.md)
retains the two complete round-1 reviews, every failed/development attempt,
final-code A/B runs, controls, byte verification and exact local artifact paths.
The earlier NOT READY reviews are not post-fix approvals.

| Round-1 finding | Round-2 disposition and evidence |
| --- | --- |
| Astra/Grok: embedded bytes versus executed bytes | Native observation resolves RN SourceCode.scriptURL to the verified installed main.jsbundle and hashes that selected file. Helper/driver enforce Release/Hermes, runtime __DEV__ false, selected URL/path and absent launcher/updates manifests. Real alternate-file selection and runtime-dev controls fail; unit identity mutations fail. |
| Astra: stale runs/held can excuse loading | Driver reads the owned backend's committed generation/schema/programs and binds them to host generation/store identity. Every kept fact and both kept generations must match before the helper's first query. Source-race driver test and real runs/held injection controls fail, with zero issued queries. |
| Astra: native inputs beyond directory inventories | Bounded Xcode reference/config/include/input-list/path audit refuses uncovered inputs and custom scripts/flags/tools. External Swift edits reproduced unchanged Expo fingerprints but now refuse. Ignored-directory and escaping Pods symlink tests also refuse. |
| Astra: preparation descendants outlive lease | Keep the leader unreaped and project lease held through bounded group SIGTERM then SIGKILL cleanup. Unit and actual interrupted-preparation controls stop a SIGTERM-resistant descendant before lease release. |
| Astra: surviving HBC mutation | Actual preparation-level wrong-version own-build/repack tests fail before receipts. Deleting both version guards is now a killed mutation. |
| Grok: ignored Pods sources | Full source Pods tree and generated header target tree join the native compatibility key; uncovered symlink targets refuse. Real compiler-byte edit and escaping-link controls refuse before install. |
| Grok: conditional native queries misclassified server-only | Refuse eligible native queries in generic smoke; application witnesses must test device module availability. Driver/helper tests and guard mutation cover it. No compiler/client change. |
| Grok: disallow every device-classified E_OFFLINE | Not adopted: the explicit supervisor ruling in round 1 preserves data or an explained refusal. Receipts report actual refusal, not returned data; device loading still fails. That rule and its limits remain in LLP 3000.011.005.000 §2. |

| Complete measured run | Result |
| --- | --- |
| Own A, all three segments | {a['commandMs']:,} ms |
| Five repack+smoke runs | {', '.join(format(runs[f'timed-b-repack-{i}']['commandMs'], ',') for i in range(1,6))} ms; all passed |
| Median / nearest-rank p95, n=5 | **{s['medianMs']:,} / {s['nearestRankP95Ms']:,} ms**; target ≤120,000 ms passes |
| Delta from round 1 median / p95 | {s['medianDeltaMs']:+,} / {s['p95DeltaMs']:+,} ms; shared warm-host observations, not isolated guard-cost estimates |
| Warm own B, all three segments | {b['commandMs']:,} ms |
| Identity | HBC 98; actual selected installed file checked on every launch; A/B native Mach-O, native fingerprint and Pods key equal, JS/assets/output differ. |
| Controls | Scheme/base tampering, real cold error and post-restart-success death fail; existing owner/listener preserved; every new runtime/preparation control fails for its intended reason. |
| Checks | 28 helper/preparation tests, 28 driver tests, 10 witness unit tests, 98 guide checks; eight killed guard mutations. Independent artifact verification and ref-check recorded with the report. |

The dedicated simulator boot cost was 24,212 ms separately. No cold tool,
dependency or Xcode/runtime download measurement is claimed. Published 0.4.7
client/native-core bytes remain unchanged; the seven-file local witness helper
patch is disclosed. No wasm change or budget increase. The later wider-host
repeatability, M6/M8 admission and publication increments remain separate.
Nothing was pushed or published; the owned simulator was deleted after collection.
'''
p.write_text(text)
p=repo/'snapback4/JOURNAL.md';text=p.read_text();assert 'NP-mac round 2 — selected bundle' not in text
text+=f'''

## 2026-09-29 — NP-mac round 2 — selected bundle, kept facts and preparation ownership

Requalified LLP 3000.030 §11 after Astra's round-1 NOT READY review. Native
startup now hashes the actual RN-selected installed file and rejects unknown,
remote/alternate selection, runtime dev and launcher/updates state. Smoke facts
come from the committed served generation; every runs/held fact and generation
matches the kept backend before querying. The bounded adapter refuses external
native/config/build inputs, custom scripts/flags/tools and uncovered Pods links;
the full source Pods tree and generated header target tree are keyed. Preparation retains its leader identity and
project lease through bounded group SIGTERM/SIGKILL cleanup. Preparation-level
wrong-HBC tests kill the formerly surviving both-guards deletion.

Both reviews were read in full. Grok's Pods and conditional-native issues are
addressed; eligible native queries now require an application witness. Its
requested device E_OFFLINE ban is not adopted because the supervisor explicitly
preserved data-or-explained-refusal in round 1. No core/compiler/client semantics,
published package or wasm bytes changed.

A and the final warm own B pass all three segments. Five final-code repacks pass:
median {s['medianMs']/1000:.3f} s, nearest-rank p95 {s['nearestRankP95Ms']/1000:.3f} s
(round 1: 46.109 / 56.639 s; changes {s['medianDeltaMs']/1000:+.3f} /
{s['p95DeltaMs']/1000:+.3f} s). Real alternate bundle/dev/stale facts, external
native/Pods inputs, interrupted descendant, scheme/base, cold error, post-success
death and owner/port controls fail as intended. 28 helper, 28 driver, 10 witness
unit and 98 guide checks pass; eight guard-removal mutations are killed.
LLP 3000.030 remains Accepted. [Round-2 report](reports/20260929-np-macos-slice/round2/REPORT.md)
retains commands, hashes, timings, every failed/development attempt and review
dispositions. Only owned simulator 13ABE380-D739-4436-A348-E8C23B959C0C was used;
it was deleted after collection. No push/publication. Required merge
859d250c39 preserved both journal sides; this is one appended round-2 entry.
'''
p.write_text(text)
