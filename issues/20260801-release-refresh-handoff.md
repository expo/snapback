# Release refresh: packaged 0.1.x closure is stale; publish is prepared — promotion lane must run it

**Status:** OPEN — fix-wave α2 handoff (2026-08-01)
**Blocks:** retiring the packaged-asset FAIL class in practice (the three
closed 20260801-0137-a1/a4 packaged tickets are fixed in source but real
against the published 0.1.7 surface)

Determination, by the book (LLP 0113 §4.2 + scripts/snapback-publish.mjs):

- **Prepared and proven from this tree (2026-08-01):**
  `SNAPBACK_BUILD_DISTRIBUTION=public-package cargo build --release`
  satisfies `assertPublicPackageBuildIdentity` (clean commit, release
  profile), and `node scripts/snapback-publish.mjs --runtime-platforms
  host` completes DRY RUN green — every @expo/snapback-* package packs
  (per-package dry-run-ok lines + publish-ledger.json emitted under
  dist-publish/, not committed). The source tree needs nothing further.
- **Not executable from this session:** a real publish consumes a
  self-digested qualified ledger and clean staged receipts from BOTH
  platforms (the linux-x64 runtime package needs a linux host — machine
  fleet), publishes under an immutable non-default candidate tag, and the
  default-tag move is a separate externally-leased promotion — the
  promotion lane's serialized authority (LLP 0113/0111), which currently
  carries its own P0 (`20260801-promote-v3-lease-pin-refuses-v4`:
  promotion refuses the next-version pin).

**What the promotion lane must run:** fix its P0; produce the linux
staged receipt; run the qualified-ledger publish under a candidate tag
from a tree ≥ 5ed6d6b9 (which carries every packaged-asset fix:
cb608f7b-lineage attach admissions, f9679cf4 pasteable lanes, 0aba0280
sessions custody, 60a83597 chunk gate); then the leased default-tag
promotion. The three closed packaged tickets reference this handoff.
