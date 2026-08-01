# qualified-package-staging takes ~90 min for one program; ~15 is achievable

**Status:** Open
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
