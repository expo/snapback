# Local publication carriers lagged their implementation lineage

**Status:** Closed — resolved by the required second carrier refresh
**Opened:** 2026-08-06
**Reopened:** 2026-08-06
**Systems:** Publication, local storage, conformance
**Related:** LLP 0110, LLP 0135, LLP 0166

The relation-activity, sequence-allocation, and local persistent-store
publication gates all refused because their governed carriers still pinned an
older `src/storage.rs` digest after the day's Rust landings. The same mismatch
reproduced with Node 24.18.0 outside the keep-going sweep, so it was repository
lineage drift rather than a missing worktree artifact or toolchain difference.

## Resolution

After the owning Rust changes were complete, the governed
`scripts/refresh-publication-carrier.mjs` path recomputed source and receipt
digests and updated the embedded manifest/test anchors. No verifier or
qualification requirement was weakened.

Verification with Node 24.18.0:

- `tests/conformance/relation-activity-publication-v1.mjs` — passed
- `tests/conformance/sequence-allocation-publication-v1.mjs` — passed
- `tests/conformance/local-persistent-store-publication-v1.mjs` — passed

## Recurrence and release impact

The fifth 0.1.11 successor-release attempt fetched and pinned clean
`origin/main` at
`cdc0fe03e8d75c4a1d1d25f79fe820f20b772ef7`. The complete 134-gate proof,
with Exact required under Node 24.18.0, passed 21 gates and then failed
`relation-activity-publication` because all three governed carriers still
name this `src/storage.rs` digest:

```text
expected: sha256:1c2a8eef417393325cd189cac83ab5e0fba4d08ae9bf26cb7a569314daaa55f8
actual:   sha256:975d82019b536561573a6edaffa8fe42521ed8277c9c366a73a1c0d57ccf28ff
```

Focused execution confirmed the identical mismatch in
`sequence-allocation-publication` and `local-persistent-store-publication`.
This is not machine-local state: every compared byte is tracked.

Commit `d2bd5fbbdb74ce798a1062642229f85c96e86d4a` refreshed the three carrier
digests and their embedded test anchors, but that same commit subsequently
changed `src/storage.rs` while closing the clippy/fork batch. The carrier's
`1c2a8eef...` value matches an intermediate construction state: the parent
file hashes to `95053e99...`, while the final committed file hashes to
`975d8201...`.

Per LLP 0041's central-proof gate, publication stopped before staging. npm
authentication remained valid, and a read-only registry check found
`latest: 0.1.10` with 0.1.11 absent on all ten package names. No release
ledger or tarball batch was created, no package was published, no dist-tag
moved, and no public cold-install or LLP 0176 G4 smoke ran.

## Required second resolution

- Run the governed publication-carrier refresh only after the final source
  tree is fixed, so all three carriers and their exact embedded carrier-byte
  assertions bind the final `src/storage.rs` bytes.
- Preserve the qualification receipts and verifier requirements; do not make
  the gates ignore source drift.
- Re-run all three focused conformance gates under Node 24.18.0.
- Re-run the complete 134-gate proof on a freshly fetched, clean
  `origin/main` candidate before staging another 0.1.11 batch.

## Second resolution — 2026-08-06

The governed `scripts/refresh-publication-carrier.mjs` path was rerun under
Node 24.18.0 after the final source tree was fixed at HEAD
`cdc0fe03e8d75c4a1d1d25f79fe820f20b772ef7`. All three carriers now bind the
final `src/storage.rs` bytes at
`sha256:975d82019b536561573a6edaffa8fe42521ed8277c9c366a73a1c0d57ccf28ff`:

- relation/activity carrier:
  `sha256:0823025f2ec6bb9370511243bf25fc16097d4be9a71dcc5ab580ba187f95f91d`
  →
  `sha256:28c653aa79e6474f72f4f5c479e591334299b9290e80f1531b596cf6844bd602`;
- sequence-allocation carrier:
  `sha256:27bfc90f6fd297a3e686060cf8a061d9fd1ce395a7d964bfd8ebeb6d8aa0ecc9`
  →
  `sha256:4d2163706b672926f628903e1765cb4f64801ed13e4eef22cf9bb241080c394b`;
- local persistent-store carrier:
  `sha256:7f02a23cead46756453dd0ba3bb9e784062e5636214b9a29e5e35f69ef0777cb`
  →
  `sha256:f7203c31a458fcd7aa8730590bcd08c6f4bfd38afd39dae8de3185cb47ad4caa`.

The relation/activity and sequence embedded carrier-byte assertions, the Rust
carrier digests and exact source assertions, and the persistent-store anchor
were refreshed together. Qualification and supporting receipts were preserved
byte-for-byte, and no verifier or source-drift requirement was weakened.

Focused verification under Node 24.18.0:

- `tests/conformance/relation-activity-publication-v1.mjs` — passed;
- `tests/conformance/sequence-allocation-publication-v1.mjs` — passed;
- `tests/conformance/local-persistent-store-publication-v1.mjs` — passed;
- `scripts/check-agent-safe-publication.mjs` — passed, with
  `agent_safe_storage_v1` and `agent_safe_derived_deployment_fork_v1` still
  withheld;
- `scripts/check-inventories.mjs` — passed (227 package tests, 24 demos, 276
  publication leaves, 60 guide pages / 190 snippets).

The complete clean-candidate proof remains a pre-staging requirement for the
next 0.1.11 attempt; this repair neither substitutes for nor weakens that gate.
