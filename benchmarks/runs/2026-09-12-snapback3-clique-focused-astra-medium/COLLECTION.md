# Focused continuous-builder evidence collection

This directory is a selected public copy of the immutable focused Astra builder snapshot. It records builder evidence and provenance only; the independent continuous grade was still running when the collection was made. The run was a seeded-code focused continuation, not a cold-from-zero full Clique attempt.

## Contents

- [`builder/`](builder/) preserves the authored app/schema/scripts, `API.md`, operational `BUILD.md`, M7 `HANDOFF.md`, builder diary/essay/final report, selected result summaries, all 24 retained acquisition attempts, paging/storage/fixture evidence, screenshots, and all 65 command/test/server/install logs.
- [`provenance/packet/`](provenance/packet/) preserves prompt, launcher receipts, PID/custody manifest, capacity and port preflight, fixed-source/package/instrument records, freeze receipt, and the complete private-snapshot content/symlink manifest.
- [`provenance/actor-token-usage.json`](provenance/actor-token-usage.json) records token counts directly from the retained native trace plus the qualified foreground clocks. It makes no billing inference from cached tokens.
- [`provenance/static-asset-supplement.json`](provenance/static-asset-supplement.json) records the separately frozen static-asset supplement and its verification against the builder's own source-freeze receipt.
- [`provenance/public-selection.json`](provenance/public-selection.json) lists every frozen-snapshot file selected or omitted and the reason.
- [`collection-manifest.json`](collection-manifest.json) hashes each selected public payload file. It intentionally excludes itself.

## Builder-reported scope and results

The builder reports 25 scoped passes and one separately retained whole-HTTP-batch failure, with 24 acquisition attempts. Its final viewport-confirmed series reports three complete 10,000-message probe acquisitions with full offline ID verification and three 100,000-message hub timeouts. These are builder reports pending independent assessment. They are not a full-milestone, native Apple, full-hub, comparative score, or M7 claim.

The retained native trace reports 18,471,459 input tokens, including 18,139,648 cached input tokens, and 104,619 output tokens, of which 45,234 are reported reasoning output. The native total is 18,576,078 tokens. The foreground launcher interval is 4,162 seconds. The builder separately records a 4,131.105-second combined work clock from its first in-lane clock read through final handoff; that clock includes dependency installation, repairs, attempts, measurements, and handoff. Packet preparation preceded the actor and is excluded.

## Provenance and omissions

The private package is `snapback3@0.0.1-experimental.0`, tarball SHA-256 `719eba5bfaffeebf117ca3e10d60d830da2ca4ca735693ea0e46f0d6317fcb4e`. Every one of its 108 regular payload files matched the installed copy byte-for-byte. The 134 additional installed paths recorded in the freeze receipt all belong to the nested TypeScript npm dependency subtree; they are preserved as raw observations and are not classified as package-payload changes or a platform patch. The 185-file instrument, 35 copied UI files, and two public product-doc files matched their preflight identities.

The first grader-copy staging pass temporarily omitted 65 `.log` evidence files because its narrative exclusion rule was too broad. Before any grader launch, those files were restored byte-for-byte from the unchanged immutable snapshot, the grade input and freeze receipt were rehashed, and the final freeze was marked ready. This was a grader-copy preparation correction; builder source and evidence were never repaired.

The immutable snapshot's name-based `**/node_modules/**` filter also omitted 18 delivered Expo static assets under `dist/assets/node_modules` (20,261 bytes). The original snapshot remains unchanged. Each omitted asset was matched by path, byte size, and SHA-256 against `builder/artifacts/source-freeze.json`, then preserved in a separate read-only EPYC snapshot and ignored local archive. Its public manifest is [`provenance/packet/snapshots/builder-final-static-assets.manifest.json`](provenance/packet/snapshots/builder-final-static-assets.manifest.json). This supplement completes private custody of the delivered app assets; it is not a builder-source repair.

Public omissions are dependency trees, `.git`, SQLite/WAL/SHM databases, generated `dist` bundles including the private static-asset supplement, the 100k-row projected fixture/seed/timestamp data, the 100k-ID expectation list, copied metering/choreography implementation, and raw Codex transport/native rollout content. The complete snapshot, supplement, and raw model traces remain in ignored local retained archives and on EPYC. No bearer/session credential was found in the selected public files; frozen test fixture credentials are permitted evidence.
