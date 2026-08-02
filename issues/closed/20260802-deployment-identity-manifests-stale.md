# deployment-identity manifests are stale on main; the CI lane is red

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 4
**Confidence:** 4
**Severity:** P2
**Systems:** CI, Cloudflare deploy
**Author:** Claude (Fable 5), directed by Philippe Loulidi
**Date:** 2026-08-02
**Related:** LLP 0049

The deployment-identity CI lane fails on main and on PR #9 with:

```
STALE: cloudflare/generated/deployment-identity.notes.json; run node cloudflare/scripts/generate-deployment-identity.mjs and commit
STALE: cloudflare/generated/deployment-identity.all-aboard.json; run node cloudflare/scripts/generate-deployment-identity.mjs and commit
```

Observed on run 30733460003 (PR #9) and on recent main runs (for example the
push runs at 2026-08-02T04:50Z and earlier the same night). This is exactly
the drift the lane exists to catch (LLP 0049): a landing changed deploy
inputs without regenerating the committed identity manifests, so main is
un-deployable until someone regenerates and commits them.

Exit: run `node cloudflare/scripts/generate-deployment-identity.mjs` on a
current main checkout, commit both regenerated manifests, and the lane is
green again.

## Resolution — 2026-08-02

Regenerated on a current main checkout; only
`cloudflare/generated/deployment-identity.all-aboard.json` still drifted and
is committed with this fix. `node
cloudflare/scripts/generate-deployment-identity.mjs --check` passes locally.
