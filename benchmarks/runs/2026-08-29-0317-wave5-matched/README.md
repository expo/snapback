# LLP 0317 Wave 5 requalification attempt — 2026-08-29

Wave 5 exhausted the work admissible under its preregistration, but it did
not produce a matched-cell candidate comparison. Publication qualification
correctly refused Snapback `0.1.30` before any registry mutation, so candidate
cells could not start. The Familiar order was candidate-first, so its `0.1.29`
baseline cells also did not start.

Two entry-admitted same-instrument Explicit cells ran against published
Snapback `0.1.29`, but final curation found that neither retained a complete
preregistered measurement record:

| Cell | Host | Retained proof | Protocol correction loops |
| --- | --- | --- | ---: |
| `gpt-5.6-sol` / `xhigh` | Linux x86_64 (`expose-builder-pixel`) | application suites and choreography green; exact package/runtime/template identity retained; per-0317-obligation map and loop attribution incomplete; M7 environment-null | unknown |
| `grok-4.6` / `xhigh` | Darwin arm64 (`Charlies-MacBook-Pro-M5Max-Black.local`) | M3-M6/M8 suite/choreography pairs coherent; M1/M2 pair hashes disagree; exact runtime/template identity incomplete; per-0317-obligation map and loop attribution incomplete; M7 environment-null | unknown |

Both cells used `social-messenger@0.3.6-m8`, source revision
`eff33c5882fce03edfcd572fb1e0284344a3827d`, manifest SHA-256
`ee75020c41bb09186dc003e1f2cdf0dedebbb3adc21abfbfeb83addba2e64623`,
and published `@expo/snapback-*` packages at `0.1.29`. Their retained capsules
include the application source, package lock, orientation, selected skill,
generated artifacts, structured reports, and retained receipts. The Sol capsule
also retains failed-attempt receipts; the Grok cell folds its contrary evidence
into `correction-loops.json` rather than retaining overwritten receipt files,
and its M1/M2 retained receipts carry the hash-incoherence disclosed above.
The original unfiltered lanes and native model streams remain on
their execution hosts; each capsule's `RECORD.md` pins those locations and
digests.

## Claim boundary

These two N=1 Explicit cells are retained diagnostic evidence, not certified
Wave 5 baselines. The Sol application proof is green but its measurement
record is incomplete; the Grok cell additionally lacks a coherent complete
proof pair and exact identity. Their four and seven narrated episodes are
uncertified loop candidates, not protocol counts. They do not establish a
magnitude or ordering result, exercise the Familiar profile, or stand in for a
published `0.1.30` candidate. There is therefore no matched-pin comparison, no
per-obligation candidate proof, and no basis to mark LLP 0317.000 `Implemented`
or its parent `Active`.

The publication refusal is nevertheless positive O26 prevention evidence:
the cross-platform capability-coherence gate stopped a package set whose
codegen required `assets.media-collection.v1` while the Darwin public runtime
could not advertise it. That prevention result is not a substitute for the
candidate matrix.

See [PREREGISTRATION.md](./PREREGISTRATION.md),
[publication-entry-gate.md](./publication-entry-gate.md),
[entry-refusals.md](./entry-refusals.md), and
[existence-table.md](./existence-table.md) for the exact entry and claim
dispositions.
