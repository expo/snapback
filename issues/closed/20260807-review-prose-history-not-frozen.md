# Review prose history is a current-state binding, not a frozen per-round record

**Status:** Resolved (2026-08-07)
**Opened:** 2026-08-07
**Systems:** Publication, LLP governance, Testing
**Related:** LLP 0162; `issues/20260806-derived-fork-publication-author-gate.md`;
`llp/reviews/0158-instance-forking.implementation-2026-08-06.{codex,fable}.md`

Found as R9-2 by the Fable round-9 review of the derived-fork publication
chain, and judged Material but non-blocking by that reviewer.

`reviewArtifactSha256` in the v2 verdict histories binds the **current**
complete prose artifact, not the prose as it stood at each recorded round.
The chain therefore cannot attest what an earlier round actually said. The
reviewer demonstrated the consequence: it published a tree whose entire
Fable prose history had been replaced with "All rounds were READY", and the
oracle did not object.

This is the same class as F8-2 (a round-6 restoration that silently
reinstated a defence its reviewer had retracted). No oracle caught that one
either — it was caught by a later reviewer holding the original session
transcripts. That is not a repeatable control.

It sits inside the already-disclosed non-claim (repository artifacts are
unsigned and not transparency-logged, so an actor with commit access who
rewrites the record and the named-author acceptance together is outside the
guarantee), which is why it did not block publication. But it makes the
prose record — the human-readable half of the evidence, and the half people
actually read — the weakest link in a chain whose machine-readable half is
now well defended.

**Suggested fix (from the reviewer):** add a frozen per-round prose digest,
so each round's entry attests the artifact bytes as of that round and any
later rewrite of earlier prose is detectable.

Deferred deliberately: the fix edits the checker, which lives inside
`IMPLEMENTATION_ROOTS`, so it rotates the qualification digest and requires
a fresh qualification cycle (new C, new dual-platform receipts, fresh dual-
family verdicts). Land it with the next cycle that needs one anyway rather
than spending a cycle on it alone.

Also worth folding in at that time: the `build.rs` allowlist mirror test is
one-directional (it fails closed, so this is a robustness nit, not a hole).

## Implementation note — 2026-08-07

Implemented on branch `codex/pub-chain-hardening-20260807`; lands with the
fresh derived-fork requalification cycle. New verdict rounds bind a frozen
artifact-prefix byte length and SHA-256, while the exact twelve pre-change
rounds remain honestly recognized as current-artifact-only legacy history.
The negative corpus rebinds the outer chain after replacing earlier prose with
“All rounds were READY” and now fails on the named frozen-history digest. The
`build.rs` publication-cycle allowlist mirror assertion is also bidirectional;
its prior one-way form already failed closed, so this is robustness hardening,
not closure of a publication hole.

## Resolution (2026-08-07)

Implemented and landed on main in `0a60693cc` ("fix(publication): freeze
per-round review prose history"): new rounds carry frozen per-round prose
digests (increasing frozen lengths, prefix digests re-verified), the twelve
pre-hardening rounds are admitted only as an exact known legacy inventory with
no fabricated digests, and the demonstrated "All rounds were READY" rewrite is
refused by a negative fixture. The build.rs allowlist mirror test is now
bidirectional. The deferral condition ("next cycle that needs a new C") was
met by the 2026-08-07 withdrawal — the requalification cycle
(`issues/20260807-derived-fork-publication-wave-drift-requalification.md`)
qualifies a tree that already contains this fix.
