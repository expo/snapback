# Commission the standalone state-capture/custody Spec (LLP 0191 OQ3, ruled)

**Opened:** 2026-08-08 · **Ruling:** LLP 0191 "Author rulings" #3, Charlie Cheever 2026-08-08 (standalone; LLP 0158 as consumer)

A standalone Spec generalizing LLP 0158's custody-manifest model
(`copy`/`scrub`/`rotate`/`share`/`refuse` per member) into
**operation-specific profiles** for the durable-store envelope:

- `snapshot/backup` — consistent data cut (SQLite backup API or
  equivalent; never reliant on graceful-shutdown checkpoints) plus
  exactly the authority material needed to restore the *same* instance
  (auth keyring carried — the probed boot refusal).
- `restore` — verified input, target identity policy, activation barrier,
  predecessor fencing.
- `clone-for-test` — explicit authority inheritance/scrub policy, never
  inferred from copied filenames.
- `fork` — remains LLP 0158's scrub-and-mint semantics; 0158 is the fork
  profile and a conformance witness of this Spec, not its owner.
- `export` — data without operational secrets; the *logical*
  import/export seam stays with the bulk-transfer protocol
  (`20260730-auth-logical-export-import.md`, LLP 0191 §6).

Prerequisite bounded runtime fix (proceeds independently, not gated on
this Spec): shutdown WAL checkpoint —
`20260807-server-sigterm-strands-large-sqlite-wal.md`. Absorbs:
`20260808-sessions-store-copy-needs-auth-keyring-sibling.md` (boot
diagnostic should also name the missing sibling explicitly).

Sequencing per OQ5 ruling: small independent lane, early — does not queue
behind the D2/D4/D3 work.

## Progress

- **2026-08-10:** Drafted the standalone Spec as
  [LLP 0228](../../llp/0228-state-capture-custody.spec.md) (**Draft**). It
  generalizes the custody manifest across `snapshot/backup`, `restore`,
  `clone-for-test`, `fork`, and logical `export`, while leaving LLP 0158 as the
  fork profile and conformance witness. The LLP 0005 review loop is the next
  step. This note does **not** claim acceptance, implementation, or capability
  publication.
