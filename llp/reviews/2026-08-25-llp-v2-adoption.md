# Curation pass — 2026-08-25 (LLP v2 overlay adoption)

First Snapback pass under upstream LLP 0011 / 0011.000, run as the v1→v2
migration: overlays, path-is-not-lifecycle, and the status exemption. Overlay
link changes below are applied with this landing. Status hygiene for the
too-small finding is proposed, not applied.

```
PROMOTE
  + link 0000-snapback.explainer.md          Active root; Role: Root belongs in
                                            foundation from the moment it is Active
  + link 0002-canonical-local-target.decision.md
                                            Active standing decision; the
                                            canonical local target is a kernel
                                            constraint
  + link 0031-server-route-taxonomy.spec.md Active current-truth spec for the
                                            HTTP/route contract
  ! too-small                               binding product contracts live in
                                            Accepted/Implemented/Draft docs
                                            (0189, 0130, 0225, 0037, 0007,
                                            0010, 0012, 0061, …) that cannot
                                            enter foundation until they are
                                            Active. Status hygiene is a follow-on
                                            curation, not a mass promotion in
                                            this landing.
ARCHIVE
  = current/ empty                          the v1 corpus was never a declared
                                            working set; llp-create will link
                                            new work. Tombstoned 0254/0255/0256
                                            and the 0070 amendment stay out of
                                            both overlays.
REALIGN (foundation = 0000, 0002, 0031)
  * conflict check                          no contradiction between the three
                                            kernel docs and the overlay/status
                                            rules this landing encodes
  * ref-check vs overlay rules              Snapback's checker now gates
                                            overlays, dotted sub-LLPs, and
                                            Tombstoned-by-status exemption
                                            while keeping its source-scan policy
  * path-migration straggler gate           llp-tombstones exemption is
                                            Status: Tombstoned, not
                                            llp/tombstones/
  * unimplemented                           none in this kernel demand code
                                            that doesn't exist
```

## Applied

- Created `llp/current/` and `llp/foundation/` as relative-symlink overlays
  (`.gitkeep` keeps an empty `current/` in git).
- Moved `llp/tombstones/*` into `llp/` and removed `llp/tombstones/`.
- Linked 0000, 0002, and 0031 into `foundation/`.
- Updated `AGENTS.md`, `ref-check`, LLP 0000, LLP 0070's tombstone pointer,
  LLP 0276's straggler exemption, and the path-migration manifest.
