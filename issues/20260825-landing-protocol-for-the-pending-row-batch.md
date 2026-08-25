# Landing protocol for the pending row batch: source first, regenerate once

Status: open
Date: 2026-08-25
Systems: Tooling, Testing
Related: llp/0232-optimistic-landing.decision.md,
  issues/20260825-a-closes-rows-trailer-is-a-claim-not-a-label.md,
  issues/20260825-none-of-the-nine-landed-rows-were-closed.md

## The measurement

Ten lane commits are pending review, carrying ~11 claimed rows. Measured against `origin/main` at
`9d0a69f41`:

| Lane | Conflict markers | Source files | `guide/` files | Total files |
|---|---:|---:|---:|---:|
| sesscommit | 70 | 3 | 0 | 10 |
| q43 | 268 | 20 | 7 | 40 |
| authtail | 346 | 6 | 63 | 80 |
| c009res | 489 | 12 | 63 | 84 |
| q05 | 564 | 14 | 5 | 36 |
| q12 | 572 | 36 | 5 | 81 |
| p1raw | 822 | 17 | 63 | 88 |
| authroot | 762 | 25 | 63 | 95 |
| svcfence | 1317 | 14 | 7 | 34 |
| soundroots | 2314 | 82 | 5 | 196 |

**The conflicts are not in the source.** Source footprints are 3–36 files; the conflict counts are
driven by each lane independently regenerating the artifact chain — most carry 63 changed `guide/`
files. Ten lanes each regenerated `guide-flat.generated.md`, `guide-flat.reference.generated.md`,
`guide-manifest.generated.json`, `diagnostics-registry.json` and `diagnostics.md` from a different base,
so every pair collides, and `main` has regenerated them twice more in the meantime from other sessions.

## The protocol

> **Land source only. Skip every lane's generated artifacts. Regenerate the chain once, after the last
> source commit lands.**

Concretely, per lane, in ascending source-footprint order:

1. Cherry-pick, taking `origin/main`'s version of every `guide/` path and any other generated artifact.
   Do not hand-merge a generated file — ever. The generated content is a function of the source, so
   merging it is merging a derived value.
2. Keep the lane's source, its security-boundary fixtures, and its `Closes-rows:` trailer.
3. After the batch, run the generators in chain order —
   `node scripts/generate-diagnostics-registry.mjs` then `node scripts/generate-guide-manifest.mjs` —
   and commit the regenerated artifacts **once**.
4. `node scripts/check-inventories.mjs` must pass. It is the only step that sees the whole chain;
   grepping the diff for new `SNAPBACK_` codes is explicitly insufficient, and the registry records
   emitting *sites*, so moved Rust lines invalidate it even with no new code.

## Two hazards this batch will hit

- **`tests/fixtures/security-boundaries/`** — `Cargo.toml`, `Cargo.lock` and `attacks.v1.json` are
  touched by nearly every lane because each adds witnesses. These are *not* generated; they must be
  merged, keeping every lane's entries. Expect real conflicts here and resolve by union.
- **`main` moves during the batch.** It took three attempts and one aborted mid-rebase to land a single
  row earlier today, because another session regenerated the same artifacts between the rebase and the
  push. Fetch immediately before each push, and land in small steps rather than one large rebase.

## Ordering

Ascending source footprint, so the smallest merges establish the base and the largest resolves against
the most-settled tree: **sesscommit → authtail → c009res → q05 → svcfence → p1raw → q43 → authroot →
q12 → soundroots**.

Nothing lands before its review returns and its trailer is verified per row. This protocol is about how
to land what has *already* earned it, not a licence to land early.
