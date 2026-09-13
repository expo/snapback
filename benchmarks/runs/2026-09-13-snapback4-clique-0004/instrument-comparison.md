# Instrument comparison limits

This record compares the frozen instrument in the September 13 Snapback 4
campaign with the September 12 Snapback 4 packet and the September 5 full
three-model campaign. The complete machine-readable inventory, including every
changed path and old/new file digest, is in
[`instrument-comparison.json`](./instrument-comparison.json).

## Identity

| Packet | Instrument commit | Files | Inventory SHA-256 |
| --- | --- | ---: | --- |
| September 5 full three-model | `f40559f37722c79178be664a11f8a6485f1508fd` | 170 | `1e5eedccb31c0a552a9446315a60ce67dbec2e6c3b38e6cfdad6a6286d33db5f` |
| September 12 Snapback 4 | `409954115f151a72dd95e897c5f00f36877f11e0` | 177 | `5055fa1206846ad9f51744b117001cb1fbed5b61dc865b355125015355251df4` |
| September 13 Snapback 4 | `409954115f151a72dd95e897c5f00f36877f11e0` | 177 | `5055fa1206846ad9f51744b117001cb1fbed5b61dc865b355125015355251df4` |

The September 12 and September 13 instrument directories are byte-identical:
all 177 relative paths and file SHA-256 digests match. The September 5 and
September 13 directories share 170 paths; 123 are unchanged, 47 changed, no
September 5 path was removed, and 7 paths were added.

Several central comparator inputs remain byte-identical between September 5
and September 13: the main brief, assertion manifest and applicability map,
grader prompt and report schema, and the 13,014,016-byte scale log and its
committed digest file. Their exact hashes are recorded in the JSON artifact.

## Material September 5 drift

- The fixture pack changes from `0.2.1-m8` to `0.2.2-m8`. The M3 `Weekend
  Plans` group now has Alice, Bob and Carol instead of Alice, Bob, Carol and
  Erin. One membership action was removed, two Erin-authored messages were
  reassigned to Carol, and the related starter and combined invariants were
  regenerated. The choreography self-test now refuses this fixture drift.
  This changes the executable M3 seed and receipt scenario even though the
  brief and assertion manifest did not change.
- The UI kit changes from `0.3.2-m8` to `0.3.3-m8`, and choreography changes
  from `0.3.6-m8` to `0.3.8-m8`. The current kit adds literal React Native Web
  ARIA state, `data-source-uri` media evidence and explicit video-poster
  handling. Choreography can validate the new media evidence path. These
  changes affect the observable implementation contract and executable
  acceptance behavior.
- The current protocol clears `EXPO_PUBLIC_SNAPBACK_URL` and
  `VITE_SNAPBACK_URL` before builder launch to prevent cross-lane backend
  selection. The September 5 protocol did not include this isolation rule.
- Metering, run-record schemas and validators now bind evidence to a fuller
  campaign identity and retain historical manifests only when the physical
  packet and submitted identity agree. These changes affect evidence
  admissibility and efficiency records.
- The September 5 environment overlay describes three backend lanes sharing
  the M5 Max in parallel with expected contention. The current campaign runs
  builders serially on that host and records different Playwright installation
  conditions. Wall-clock measurements therefore have an additional scheduling
  and environment difference.

## Comparison posture

September 12 results, if cited, use the exact same instrument bytes as the
current run. Product versions, builder conditions and model behavior still
need their ordinary run-level disclosures.

September 5 results are useful contextual anchors because the principal brief,
assertion manifest, grader contract and scale workload are unchanged. They are
not strict same-instrument magnitude comparisons: executable fixtures, UI and
choreography, launch isolation, metering custody and host scheduling changed.
The current independent result must also report its 101-ID subtotal separately
from the 18-ID M8 supplement when compared with September 5, whose structured
grader reports omitted M8.

## Reproduction

For each directory, the inventory digest is SHA-256 over sorted repetitions of
the UTF-8 relative path, one NUL byte, the lowercase per-file SHA-256, and one
newline. File contents and instrument directories were read only during this
audit.
