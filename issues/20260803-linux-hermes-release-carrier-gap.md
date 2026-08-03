# Publish current Linux Hermes artifacts for remote release carriers

**Status:** Open
**Systems:** Ibex/Hermes, Linux packaging, Fly drill, CI
**Related:** LLP 0010, LLP 0075, LLP 0123; `vendor/ibex`

The competitive-checkpoint Fly runbook says to download the exact patched
Linux Hermes bundle from the Ibex `hermes-artifacts` release workflow. During
the 2026-08-03 LLP 0132 qualification, no published asset matched the vendored
Ibex/Hermes identity. The previously staged bundle belonged to an older source
and patch stack and correctly failed current provenance validation.

The qualification therefore rebuilt Hermes from vendored Ibex commit
`2afa439b`, Hermes commit `e639a7bad8bfca844d982afa54fac786c65a8856`, and
patch-stack digest
`sha256-9a846368e13304659cb6e0d4be78853bad6415de01f68a4191f7cd9b3af2c7d7`
on an independent x86_64 Linux host. The resulting tarball SHA-256 is
`75d7202611cbe4d912f21f83f10384852331d9c043512c1076724cfab0b8751a`.
This was sufficient evidence for the one qualification, but it is not the
ordinary maintained publication path.

The same run also showed that Fly's default Depot builder can be below the
memory required to optimize the ordinary Snapback release and lib-test
instrument. The repository now has a checksum-bound `Dockerfile.prebuilt`
fallback, but a routine drill should not require manually reproducing both the
Hermes and Rust release closures.

## Exit

- The vendored Ibex identity has a published, immutable Linux x86_64 artifact
  with the profile-provenance receipt and checksum expected by the drill.
- A maintained command resolves and stages that exact identity, refusing stale
  or ambiguous assets.
- The Fly carrier either has a builder shape known to complete the ordinary
  release profile or a documented, automated independent-build handoff that
  emits the complete checksum/source-revision closure consumed by
  `Dockerfile.prebuilt`.
- A clean qualification dry run exercises the maintained path without relying
  on operator-local ignored artifacts left by an earlier run.
