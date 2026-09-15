# How to read this archive

This is a selected evidence archive. It preserves received reports, scores and
grades separately from the orchestrator's qualifications. It is not a runnable
clone of every app or a complete copy of the external packet. Consult the final
README for actual phase outcomes and their limits.

`PACKET-README.md` is the packet's original preparation/deviation text plus its
dated completed-execution note. Earlier future-tense instructions are retained
history, not the final phase state. `protocol/execution-summary.json` derives
the actual twelve-phase lifecycle and whole-cell elapsed time.

`custody/*copy-manifest.json` enumerates the files copied by each archival step,
with source path, byte count and SHA-256. Earlier qualification files have their
own receipts; the final cumulative archive index also includes them. A copied
builder or supplement `custody.json` is an **original external custody inventory**:
its list may include source files that were hashed or retained outside this
repository. The original source counts 145/62/130 are not counts of locally
archived source files.

`ARCHIVE.sha256` covers every selected file except itself, including earlier
committed qualifications, derived documents, copy manifests and validation
receipts. It is an inventory, not a claim that the omitted external packet is
reconstructible. Verification and credential-scan receipts bind their explicitly
listed observation scope; later administrative receipts/index files do not
retroactively expand a scan's scope.

Selected authored Quarry, workers, search/Insights screens and client files are
archived. Other authored files remain external, as do most generated outputs.
Astra's selected Quarry includes generated configuration/schedule lines; Muse's
generated residency facts were added explicitly in the additional-evidence copy.
Neither is a new product implementation or a generated publication leaf.

Original absolute paths in verbatim reports and audits remain as provenance.
Use this map to find the corresponding selected copies:

| Original location | Repository location / limit |
| --- | --- |
| `lanebriefs/cell-custody-0.2.10/<lane>/builder/` | `<lane>/builder/`; lifecycle files moved to `logs/` |
| `…/<lane>/builder-supplement/` | Selected files at `<lane>/builder-supplement/`; original inventory is broader |
| `…/astra/builder-quarry/` | `astra/builder-quarry/` |
| `…/<lane>/observed-attempts/` | `<lane>/observed-attempts/` |
| `…/<lane>/grade/` | `<lane>/grading/`; lifecycle files moved to `logs/` |
| Packet `scores/astra/FINAL.md` and `scores/muse/FINAL.md` | Respective `<lane>/holistic-score.md` |
| Packet `scores/grok/raw.out` | `grok/holistic-score.md`, including its received public preface |
| Packet `scores/muse/FINAL.provenance.json` | `muse/holistic-score.provenance.json`; raw Muse stream remains external |
| Packet `logs/*.start.json` / `*.end.json` | `logs/`; raw model streams and stderr remain external unless a separately named sanitized artifact is retained |
| Packet Astra `evidence/` search, scale and M3 files | Selected `astra/additional-evidence/`; capture was after Astra grading and before M7, with earlier hashes matched where stated |
| Packet Astra grader removal result JSON | `astra/grading/evidence/` |
| `lanebriefs/*-AUDIT.md` and reporting comparisons | `audits/`, verbatim; bounded orchestrator audits, not additional blind reviews or independent grades |
| External Muse interruption/driver helpers and receipts | `protocol/`; original nonzero builder exit is preserved |
| External completed-grade aggregation receipt | `protocol/grade-summary-execution-20260915.json`; generated results at `grades/` |
| External pre-M7 source capture | `<lane>/m7/pre-source/custody.json`; this remains an external inventory, and its listed source bodies are not all copied here |
| External passive M7 observer tool and synthetic checks | `protocol/m7-custody-observer.py`, `check-m7-observer-v3.py` and `m7-observer-v3-checks.json`; the checker can be run on copies in a new temporary directory to preserve the received receipt |
| External completed M7 narratives | `<lane>/m7/{run-log,diary,essay-paragraphs,final-report}.md`, verbatim; original relative links resolve through the mapping below |
| External completed M7 source/package and late-process observations | `<lane>/m7/custody/`; scopes and observation times are explicit |
| Observer `cell-custody-0.2.10/<lane>/m7-observer/objects/<hash>` | Selected `<lane>/m7/observer/objects/<hash>`; `selected-events.json` maps original paths to copied versions |
| Live lane M7 JSON paths named in reports | Selected `<lane>/m7/evidence-files/<original lane-relative path>`; prior versions remain in observer objects |
| Observer source manifests | First/last original manifests and derived `source-change-history.json` under `<lane>/m7/observer/`; intermediate originals remain external |
| Selected final M7 app/Quarry and pre/initial/served schema variants | `<lane>/m7/source/<original lane-relative path>`; script bodies remain hash-only, source redactions have separate original/archive hashes |
| M7 recording helpers | `protocol/capture-final-m7.py`, `observe-m7-processes.py`, `stage-cell-m7-record.py`; operational observations/archiving, not benchmark or app changes |


The navigation control under `muse/qualifications/navigation-admission/` has a
separate mapping. Its tighter result and source are `result.json` and `probe.mjs`.
The earlier attempt's source and result are `first-attempt-probe.mjs` and
`first-attempt-result.json`; the schema is `schema.q`. The original first-attempt
custody receipt names files under its external working directory, including
check/server logs not all copied here under those names. It must not be read as
a claim that every original first-attempt file is present.

Received success markers are not independently certified by copying or hashing
them. For example, the Muse final expiry pass remains verbatim alongside the
observation that contradicts it; implemented optional failures in earlier
attempts remain failures. The generated score summary's narrative-only header
is also qualified by Grok's announced source spot checks. See the final README
and audits for the separate received and audited interpretations.
