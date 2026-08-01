# 0137 A2: the acceptance guide's raw reset leaves a database the dev loop then refuses (SNAPBACK_SEED_NONEMPTY_UNTRACKED)

- **Date:** 2026-08-01
- **Source:** LLP 0137 Phase 1, A2 snapback-web arm (external consumer, @expo/snapback-* 0.1.7)
- **Finding:** `demos/improvement-sweep/arms/a2-snapback-web/findings/0137-a2-f7-raw-reset-breaks-versioned-seed-identity.json`
- **Severity:** experience — two guide-taught paths collide; bit this arm twice

Sequence: suite follows testing/acceptance's `POST /_snapback/api/app/reset` with `{seed}` → rows now exist without versioned-seed identity → next `snapback dev` start refuses with `SNAPBACK_SEED_NONEMPTY_UNTRACKED` and the packaged loop is wedged until the operator deletes `.snapback/dev.sqlite3*` or runs a versioned reset-install. The refusal is honest and correctly coded; the trap is that the guide's own reset recipe produces the state.

Ask (either suffices):
- the refusal (and/or the raw reset response) names its recovery with the exact command (versioned reset-install or fresh database); or
- the acceptance guide routes suites to the versioned-seed lifecycle when a `seed.artifact.json` exists.

Witness: a suite that raw-resets can restart `snapback dev` by following only the printed diagnostic.

---

**RESOLVED 2026-08-01 (fix-wave α1): the refusal names its recovery.**
SNAPBACK_SEED_NONEMPTY_UNTRACKED / SNAPBACK_SEED_PARTIAL_UNTRACKED now
say: recover with the versioned reset-install
(POST /_snapback/api/app/seed/reset-install-v1) or a fresh database,
and name the raw-reset-with-inline-seed cause (src/storage.rs). The
witness the ticket asked for — restart by following only the printed
diagnostic — is satisfied by the message.
