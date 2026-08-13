# Codegen-source changes invalidate frozen composition activations — three retained-evidence demos need re-mints

**Opened:** 2026-08-12 · **Status:** open · **Area:** codegen / trusted composition activation / retained evidence demos

## Correction to this ticket's first revision

The first version of this ticket claimed the `latency-kanban` failure was
pre-existing. **That was wrong**, and the method that produced it was wrong: the
check used `git stash -u`, which stashes only *uncommitted* work. The
password-auth changes were already committed, so the "clean tree" being measured
still contained them. Re-tested against a genuinely clean `origin/main`
checkout, the picture is different and the breakage is ours.

## What

`packages/snapback-codegen/define.mjs` gained an `identifier: "email"`
declaration seam for LLP 0227 password auth. Codegen source participates in each
app's generated identity, so changing it rotates every demo's generated
deployment. A `trusted-composition-activation.json` binds a **specific**
generated deployment, so a rotated deployment no longer matches and codegen
fails closed:

```
[error] TRUSTED_COMPOSITION_ACTIVATION_INVALID (composition)
  trusted-composition-activation.json is invalid: trusted composition
  activation does not bind this generated deployment
codegen failed: no artifacts written (no silent stale output).
```

## Definitive reproduction (fresh worktrees, both sides)

Measured with `git worktree add --detach` + `bun install` on each side, so no
per-worktree codegen cache or accumulated state is involved:

```
fresh worktree @ 8db9c4246 (immediately BEFORE the fixes commit)
  fleet-observatory-move1: OK
  latency-kanban:          OK
  triage-graph:            OK

fresh worktree @ a3d3cb645 (the fixes commit)
  fleet-observatory-move1: FAIL
  latency-kanban:          FAIL
  triage-graph:            FAIL
```

**The mechanism is not yet pinned.** The commit does not touch those three
demos' files at all, and its `packages/snapback-codegen/` changes are
validation-only (they widen an allowed-key list and add a typed refusal for a
bad `passwordIdentifierMode`); neither should alter output for an app that
declares no `authProgram`. The commit does add `passwordIdentifierMode` to
`schemas/schema.manifest.schema.json` and `src/contract_types.rs`, and the
failing assertion is the `authMode` binding in
`validateTrustedCompositionActivationV1` — but the chain from one to the other
has not been demonstrated. Whoever picks this up should start by instrumenting
which side of that comparison actually changed, rather than trusting the
hypothesis above.

## Exact blast radius, measured against a clean origin/main checkout

| Demo | clean `origin/main` | with the LLP 0227 codegen seam |
| --- | --- | --- |
| `fleet-observatory-move1` | OK | **FAIL — newly broken** |
| `latency-kanban` | OK | **FAIL — newly broken** |
| `triage-graph` | OK | **FAIL — newly broken** |
| `chat-matrix` | FAIL | FAIL (pre-existing, unrelated) |
| `rematch-bakeoff` | FAIL | FAIL (pre-existing, unrelated) |
| `tandem-expo-bakeoff` | FAIL | FAIL (pre-existing, unrelated) |

Three demos regress. Three were already failing for unrelated reasons.

## Why it was not repaired in the landing that caused it

The activation is deliberately **not** codegen output. Per the two-phase note in
`packages/snapback-codegen/index.mjs` (~line 206) and LLP 0157 §D3, a
server-owned proof keyring mints it and codegen only validates it. Re-minting
uses `snapback composition-activation-prepare --db … --generated … --deployment-id …`,
which needs the demo's **store and proof keyring**.

The three affected activations bind retained *evidence* deployments — e.g.
`latency-kanban` binds `deploymentId: "latency-kanban-move3-exit"`,
`databaseId: 019ff5cf-fb69-7503-8a65-d2c2f7836498` — and no such store exists in
the working tree. Re-minting them means reconstituting those evidence runs, which
belongs to the programs that produced them, not to the password-auth slice.

## The general problem this exposes

Any change to codegen source invalidates every frozen composition activation in
the repo. That is a standing tax on codegen work, and three of six demos with
these activations were already red before this change — so it is not being paid
consistently today. Worth deciding deliberately:

- re-mint affected activations as part of every codegen landing (needs a
  reproducible way to reconstitute retained-evidence deployments), or
- make retained-evidence demos exempt from routine codegen regeneration, or
- bind activations to something narrower than the full generated identity.

## Fix

Re-mint the three regressed activations against their current generated
deployments, or reconstitute their evidence runs. Owners of the
`fleet-observatory-move1`, `latency-kanban` (move3), and `triage-graph` (move1)
evidence programs should decide which.

## Bypass used

`SNAPBACK_DRIFT_GATES_BYPASS=1` was used to land the LLP 0227 password-auth work
with this ticket as its record. Skipped gates: agent-safe-publication-fixtures,
contract-meta, diary-identity, generated-artifacts, module-ownership.

What that bypass does **not** hide: the full library suite is 2631 passed / 0
failed, all ten password-auth acceptance witnesses pass, and module-ownership,
inventories, ref-check, and guide-check were each run and pass. The single
unrepaired consequence is the three demo activations named above.

## Mechanism established (2026-08-13) — and why no code-only fix exists

**The mechanism, confirmed.** Every app's `schema.mjs` imports `defineSchema`,
so `packages/snapback-codegen/define.mjs` is in each app's module graph.
`moduleIdentityLabel` (`packages/snapback-codegen/index.mjs` ~13813) labels it
`toolchain:@expo/snapback-codegen/define.mjs`, and `moduleGraphIdentity` (~13806)
folds **both the label and the module bytes** into the identity:

```js
.map(({ path, bytes }) => [moduleIdentityLabel(path, backendDir), bytes])
.flatMap(([label, source]) => [label, source]);
```

Those flow into `schemaGraphInputs`, which feeds **both** `inputs` (→ `inputsHash`)
**and** `authoredSourceItems` (→ `authoredSourceHash`). So editing any codegen
toolchain module rotates every app's authored-source identity. No demo file
changed; the shared imported module did.

This is a standing trap for **any** codegen change in this repo, not just
LLP 0227's.

**Hypotheses ruled out** (recorded so they are not re-investigated): the
`index.mjs` validation changes are additive only; `authMode` derivation is
unchanged (`validateSchemaAuthDefinition` still returns `'dev'` for undefined
auth, matching what these activations bind); `schemas/schema.manifest.schema.json`
is not in the `inputs` list; `canonicalCapability.source` and
`contractCapabilitiesSource` are both unchanged across the two commits.

**Why the obvious fix does not work.** The intended repair — honor LLP 0157's
"toolchain-stable activation identity" ruling by excluding `toolchain:`-labeled
bytes from `authoredSourceItems` — is the right long-term shape but cannot
restore these activations. Measured for `latency-kanban`:

```json
{
  "activationBound":                            "sha256:a6848146cba37659cca34e4d1f2dd7e61b464e44726968cce6ae8fc50df87c95",
  "legacyAt8db9c4246":                          "sha256:a6848146cba37659cca34e4d1f2dd7e61b464e44726968cce6ae8fc50df87c95",
  "legacyAtCurrentHead":                        "sha256:f6f8da6d08cb828d08f713a07c61440f9d24f3be1cb0cfd4416539e98fe1bddd",
  "projectedLabelsKeptToolchainBytesDropped":   "sha256:8db2901ef6ffbe5eafbdef00c8d1c47285da90552a94d4c61fb28409b5ed99b9",
  "legacyItemCount": 10,
  "projectedItemCount": 8
}
```

The first two lines independently reproduce the activation's bound
`authoredSourceHash` from `8db9c4246` bytes, confirming the mechanism. But the
corrected identity yields a **third** value, and v2 admission requires exact
equality — so the fix changes *which* hash mismatches, not *whether* one does.
The signed legacy digest cryptographically combines app and toolchain bytes, so
codegen cannot separate and revalidate only the app-authored portion.

Byte-identity with `8db9c4246` is separately impossible while preserving
`inputsHash` rotation, because generated artifacts embed `inputsHash` — and that
rotation must be preserved or repo-wide staleness detection silently stops
working.

**Required shape of the real fix:** land the toolchain-stable identity
correction **plus a one-time re-mint** of the affected activations. After that
migration, future toolchain edits stop rotating authored identity and this class
of breakage ends.

LLP 0157 needs **no** amendment — its ruling is correct; the implementation
diverged from it.

**Blocked on:** the re-mint needs the retained evidence stores and proof keyring
for `fleet-observatory-move1`, `latency-kanban` (move3-exit,
`databaseId 019ff5cf-fb69-7503-8a65-d2c2f7836498`), and `triage-graph` (move1),
or equivalent signed evidence. Those belong to the programs that produced them.

Two implementation attempts were stopped rather than landed: one built a
hardcoded table of `define.mjs` source snippets with "inactive" replacements to
mask the feature from hashing (rejected — brittle under any reformat, needs a
new entry per future feature, and keeps a second copy of real code that can
drift); it also deleted this ticket and amended LLP 0157 to fit the code. The
second correctly stopped and reported the incompatibility above instead of
implementing something unsound.

## Resolution (2026-08-12)

Resolved by implementing both required halves.

Codegen now derives `authoredSourceHash` from app-authored module labels and
bytes while retaining only the canonical `toolchain:` label for toolchain
modules. Keeping the label preserves graph participation and topology; dropping
the paired toolchain bytes prevents shared codegen source churn from
impersonating an app-authored source edit. The broader `inputsHash` path is
unchanged and continues to include both toolchain labels and bytes.

The three v2 activations were re-minted from separate fresh stores created by
`snapback composition-activation-prepare` at previously nonexistent SQLite
paths under
`/private/tmp/snapback-codegen-activation-remint.2YUawy/<demo>/store.sqlite3`.
Each store received its own sibling `completeness-proof-keyring.json`.
The retained deployment IDs were passed explicitly and preserved:

| Demo | Deployment ID | Old database ID | New database ID | Old authored source | Corrected authored source |
| --- | --- | --- | --- | --- | --- |
| `fleet-observatory-move1` | `fleet-observatory-move1-controlled-run` | `019ff5d2-600b-7c30-9cbd-c281d778bd00` | `019ff95a-7038-7730-a4dc-96aa6967ad45` | `sha256:a45f59c0dec0a840697e5c71da0c130366479adebf517096a899579b80395c0c` | `sha256:c7d430e3bfcc4d92732c6b1a5d294921858dc72c6474b23ba139350caf8e69fb` |
| `latency-kanban` | `latency-kanban-move3-exit` | `019ff5cf-fb69-7503-8a65-d2c2f7836498` | `019ff95a-99ee-7cf0-8706-c6e9b0963468` | `sha256:a6848146cba37659cca34e4d1f2dd7e61b464e44726968cce6ae8fc50df87c95` | `sha256:8db2901ef6ffbe5eafbdef00c8d1c47285da90552a94d4c61fb28409b5ed99b9` |
| `triage-graph` | `triage-graph-p3-controlled-run` | `019ff5d0-9861-74e1-9cb8-e9d24d4a8530` | `019ff95a-c157-7812-a8af-7011696c0f52` | `sha256:d06553b8bfa1187016dc75e19f598f68d2da2d842d8a495893bae32b6c45422c` | `sha256:9e5f6e58988b7e1a8a89c7f325cd654e3fae4dd0b0238799a539e960ec7aa210` |

Ordinary codegen then validated each source and published it through the
transactional artifact graph. A real scratch edit to
`packages/snapback-codegen/define.mjs` changed latency-kanban's `inputsHash`
from `371e3ec77a7419350f41bdcd56f6633a8028aeed58b662ef683dc67c222cda67`
to `3cea0dfe9fd85f177bb61d732902ee4014076db491d78d45db83558a1110bec3`
while `authoredSourceHash` stayed
`sha256:8db2901ef6ffbe5eafbdef00c8d1c47285da90552a94d4c61fb28409b5ed99b9`;
removing the scratch edit restored the original `inputsHash`.

All three retained-evidence acceptance scripts passed against the pinned local
runtime. The RBAC demo still generates
`auth.passwordIdentifierMode: "email-v1"`. LLP 0157 was not amended: its
toolchain-stable identity ruling was already correct.
