# Reclaim Linux proof-runner disk before native builds

**Status:** In Progress
**Severity:** P1
**Systems:** CI, Build, Native runtime, Acceptance testing
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0010 §CI and Review Gates; GitHub Actions run 29630588762
**Marker:** ci, disk, github-actions, linux, local-proof

The canonical Linux proof exhausted its GitHub-hosted runner disk while the
main proof step was still running. GitHub's worker then failed to write its own
diagnostic log with `System.IO.IOException: No space left on device`, so the
runner crashed before it could finalize the proof step or upload normal logs.
Every setup, dependency, cache, and `cargo-audit` installation step had passed;
this was a proof-environment capacity failure rather than a product assertion.

The proof already reclaimed Cargo test artifacts before its later acceptance
binary link, but that cleanup point cannot help when the combined native Clippy
and test profiles fill the runner earlier. The hosted image also carries large
Android, .NET, and GHC toolchains that Snapback's Rust/JavaScript proof never
uses.

**Done when:**

- The Linux workflow removes only reviewed, image-owned unused toolchain paths
  on its fresh ephemeral VM.
- It measures the workspace filesystem afterward and fails early with a stable
  diagnostic below a 20 GiB proof budget.
- Workflow source tests pin the reclaim step, exact paths, threshold, and
  diagnostic.
- The remote canonical local-proof workflow completes successfully.

## Implemented; remote verification pending

The local-proof workflow now reclaims `/usr/local/lib/android`,
`/usr/share/dotnet`, and `/usr/local/.ghcup` immediately after checkout credential
attestation. It then measures the actual workspace filesystem and refuses to
begin dependency/native work unless at least 20 GiB remains, reporting
`SNAPBACK_CI_DISK_HEADROOM_LOW` instead of crashing mid-proof. The cleanup is
scoped to the fresh GitHub-hosted Linux VM and does not run from the portable
local proof script.

Keep this ticket open until a replacement `main` run completes the canonical
proof on the reclaimed GitHub-hosted runner.
