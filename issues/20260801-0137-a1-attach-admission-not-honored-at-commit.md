# A1 sweep: ctx.assets.attach admission never reaches the commit validator (row attachment impossible)

**Opened:** 2026-08-01
**Systems:** Assets, Runtime
**Related:** LLP 0137 (A1 arm), LLP 0044, demos/improvement-sweep/arms/a1-snapback-web/findings/0137-a1-f2-attach-admission-not-honored-at-commit.json

On packaged 0.1.7, `ctx.assets.attach(assetId, { upload })` succeeds in the
handler (returns the canonical asset id) but every write of that value into a
`v.assetRef` field fails the commit with `SNAPBACK_ASSET_REF_UNVERIFIED`.
Isolated across four variants (restricted/unrestricted field, attach-return
vs raw input id, minimal single-write mutation):
`demos/improvement-sweep/arms/a1-snapback-web/evidence/app/probe-attach.mjs`.
Consequence: no application can attach an asset to a row on the public
closure; `via-references` sharing and delete-refusal-while-referenced are
unreachable. This was the A1 arm's only check-level FAIL (A1-04).

Fix shape: make the host's transaction-scoped admission visible to the commit
validator for the same invocation's buffered writes, and add a
packaged-closure conformance test running the guide's own attach snippet
end-to-end.
