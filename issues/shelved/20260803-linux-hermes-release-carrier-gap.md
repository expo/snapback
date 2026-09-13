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

## 2026-08-07 update

- Exit bullet 1 is met: a published asset exists for the current vendored
  identity `e639a7bad8bf-9a846368e133`; its attestation, checksum, and in-bundle
  profile-provenance receipt were verified. The receipt binds Hermes source
  commit `e639a7bad8bfca844d982afa54fac786c65a8856`, patch-stack digest
  `sha256-9a846368e13304659cb6e0d4be78853bad6415de01f68a4191f7cd9b3af2c7d7`,
  and Linux cache key
  `e639a7bad8bf-p9a846368e133-ba60b2b604a01c-blaf521ddda077-a4d422defe361-i6e939803e5b0-olinux`.
  The tarball SHA-256 is
  `fed145eaf0fcd1f7e80a4fa8f3701c46b47c2f06c0b63d3e8f6ad0a6254286a5`.
- Exit bullet 2 is met by `scripts/stage-linux-hermes-release.mjs`, which derives
  identity from committed Ibex gitlink `4c34c831aa087d6783b0d68f281cdb374ed7fc89`
  through Ibex's own helpers, verifies the exact release carrier, and refuses
  stale or ambiguous staging state.
- Exit bullet 3 is partially met: the Hermes `lib/` half of the prebuilt closure
  is automated and documented. The Rust-binary half remains a documented manual
  independent build, and the Fly builder memory shape is unchanged.
- Exit bullet 4: a dry run of resolve + verify + stage was performed against the
  published asset on 2026-08-07 on a macOS host with an uninitialized submodule
  (identity derived from the `SNAPBACK_IBEX_CHECKOUT` object database at the
  committed gitlink). `stage`, `--check`, and `--check --prebuilt-lib` all
  succeeded; the staging receipt recorded `stagedAt` 2026-08-07T19:07:25.880Z,
  tarball SHA-256
  `fed145eaf0fcd1f7e80a4fa8f3701c46b47c2f06c0b63d3e8f6ad0a6254286a5`, and
  attestation verified against the reviewed workflow. The staged
  `lib/libhermesvm.so` digest
  (`647edffe66af5c886dac71e0021a7b30495969896f38efbcf62a700fa2c489d9`)
  independently matches the bundle receipt's `binaryDigest`. Removing the
  object-database source refused with
  `SNAPBACK_HERMES_CARRIER_IDENTITY_SOURCE_UNAVAILABLE`. A full Fly deploy was
  not exercised in this dry run; the remaining tail is one routine drill using
  the staged carrier.
