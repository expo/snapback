# qualified-package-staging takes ~90 min for one program; ~15 is achievable

**Status:** Open — 90-minute serial assemble is historical; Linux/Hermes remainder
**Impact:** 4
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Severity:** P2
**Systems:** CI, Packaging, Developer experience
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-08-01
**Related:** LLP 0041, issues/20260731-sd6-scope-migration-and-rebuild.md
**Marker:** release-lane


## Triage (2026-08-26 leftover sweep)

Still open, but the 90-minute serial assemble is **historical**. `.eas/workflows/qualified-package-staging.yml` now builds linux/darwin in parallel with two-pass store qualification; last recorded wall ~18m. Remaining work is the Linux-runtime/Hermes portion of the ~15-minute target, not serial package assembly. See also `issues/shelved/20260803-linux-hermes-release-carrier-gap.md`.

## Execution checkpoint — 2026-08-01

The structural migration is implemented and the first retained EAS execution
passed end to end. The timing exit remains open because the successful warm
run took 18m29s rather than the target 15m:

- staging moved from `.github/workflows/qualified-package-staging.yml` to
  `.eas/workflows/qualified-package-staging.yml` under the dedicated
  `@expo/snapback-ci` EAS project;
- `linux_runtime` (`linux-large`) and `darwin_runtime` (`macos-large`) are
  dependency-free roots and therefore build concurrently;
- the macOS assembly job waits for both native artifacts, preserves the Linux
  cross-host attestation, executes and revision-checks the transported macOS
  runtime, and emits the same nine-package qualified staging ledger;
- macOS and Linux staged cold-install proofs fan out concurrently after
  assembly, then one retention job requires all nine tarballs and both
  receipts; and
- Hermes build/install caches are restored from authority-bound keys and saved
  under source-revision-specific keys. Cargo target caching was removed after
  compression/upload overhead made it counterproductive. LLP 0041 §Qualified
  staging substrate — 2026-08-01 records why cache reuse does not replace any
  output proof.

Successful run:
[019fbd18-6ad1-744b-98cd-684945ae0ad7](https://expo.dev/accounts/expo/projects/snapback-ci/workflows/019fbd18-6ad1-744b-98cd-684945ae0ad7),
source revision `87cc4ac358082e51c2781d0241c4ee761b9cd24e`.

- macOS runtime: 6m43s; Linux runtime: 14m42s, launched together;
- assembly: 1m18s;
- macOS staged proof: 1m46s; Linux staged proof: 1m59s, launched together;
- final retention: 28s; total wall time: 18m29s; and
- retained output: a 66.5 MB qualified release containing nine tarballs and
  both platform receipts.

The current EAS schema validator accepts the workflow and the file is below
EAS's 16 KiB limit. The structural waste is removed (roughly 90m to 18m29s),
but the ticket remains open for the final 3m29s: the Linux runtime build alone
now consumes 14m42s, and the required assembly/proof tail follows it.

Measured across five runs of `.github/workflows/qualified-package-staging.yml`
(30460781040 .. 30684007891): total ~90 min, of which `linux-runtime` ~36 min
and `assemble` (macos-15) ~51 min run **serially**; the staged proofs
themselves take 2–9 min. The same release build is ~2.5 min warm / ~10–15 min
cold on an M-series laptop and materially faster on the fleet's Hetzner box.
Charlie's reaction (2026-08-01, mid-publish-night): "that seems crazy. its
just one program." He is right; the cost is structural, not essential:

1. **Serialization.** `assemble` needs the Linux artifact only at packing
   time, at the end. Building macOS in parallel with Linux and folding the
   artifact in at assembly removes ~35 min of pure wait.
2. **No compile cache.** The clean-source posture currently implies
   recompiling every object from nothing. The provenance claim binds source
   revision → output digests, and every proof (cold-install, comparator,
   runtime-qualify) tests the output binary; a content-addressed cache
   (sccache keyed by toolchain + lockfile digest) memoizes compilation
   without weakening anything the ledger asserts. If the posture is read
   more strictly, record the cache decision as a dated LLP 0041 note rather
   than paying 60+ min per run silently.
3. **Runner class.** Hosted 4-core runners (the macOS ones especially) are
   the slowest available substrate. Larger hosted runners or the existing
   fleet as self-hosted runners cut wall-clock further; Hermes-from-source
   on Linux is a fixed cost worth caching regardless.

4. **Substrate: EAS Workflows (Charlie, 2026-08-01: "can i run on eas
   workflows instead of github?").** The staging lane is the portable
   half — custom jobs on ubuntu-x64 + macOS arm64 workers with artifact
   passing — and EAS's M-series Mac workers directly attack the worst
   job. GitHub-bound pieces are downstream: the promotion proof-plan
   helper dispatches a GitHub matrix by design, and the SD-6 lineage
   records `expo/snapback` as the GitHub proof-repo slug. Mixed mode
   (EAS builds + GitHub proofs) is viable immediately; a wholesale move
   is a dated LLP 0041 decision. Dogfooding upside is real.

Exit: the lane produces the identical qualified ledger + receipts in
~15 min or better — via parallelism + cache + faster workers on
whichever substrate is chosen (EAS evaluated per item 4) — with any
cache/posture/substrate decision recorded as a dated LLP 0041 note; no
proof weakened, no digest skipped.
