---
title: Versioned seeds
id: backend.versioned-seed
order: 8
audience: agent-first
capabilities: [backend.versioned-seed]
authorities: [llp/0109-versioned-seed-evolution.spec.md, llp/0056-scoped-roles-and-memberships.rfc.md, src/seed_identity.rs, src/storage.rs, src/server.rs, packages/snapback-codegen/seed-artifact.mjs, packages/snapback-client/index.mjs, packages/snapback-cli/index.mjs, packages/snapback-vite/lifecycle.mjs, tests/conformance/versioned-seed-v1.manifest.json]
examples: [demos/party-wall]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-07
reviewed-authorities-digest: sha256:d7472d809b09c8d3009cae85e794bb85f54db6098441f82a8b50424cf0f2459f
---

# Versioned seeds

> **Local target only.** This page describes the local dev/test target.
> Hosted compiled-seed custody remains an explicit GAP.

Use a versioned seed to establish a known fixture on a fresh database. Use a
migration to evolve durable data, or an explicit reset-install when destroying
the current instance is intended. A versioned seed is never an upsert.

## Author the identity

Add a portable `seedVersion` beside `tables` in `snapback/seed.json`. Codegen
emits `generated/seed.artifact.json` with the app id and a canonical
content digest. Changing the table bytes requires a new version. Reusing one
version for different bytes refuses `SNAPBACK_SEED_VERSION_REUSED`.

The identity is scoped to the current data-version stream. The first install
stores the rows, identity, and receipt atomically. Repeating the exact artifact
returns a pure `matched` observation of the establishing receipt. Presenting a
different identity to an installed stream refuses
`SNAPBACK_SEED_MIGRATION_REQUIRED`; it does not modify rows.

Named tables count as targets even when their seed arrays are empty. Occupied
targets without an active identity refuse as nonempty or partially untracked
data. This prevents Snapback from silently adopting a legacy database.

## Seed membership fixture seats through the declared lane

Versioned seeds may name membership tables and install **fixture seats**
(LLP 0100 §8b's routed lane, owned by LLP 0109 §8's dated amendment). The
first-landing refusal (`SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED`) is
retired: a named membership table — empty or with fixture rows — is a legal
seed target and reset target. The lane is declaration-checked, never raw:

- fixture seats enter through the host's seed writer and carry per-row
  `seed` provenance; a fixture row that names a host-managed provenance
  column refuses as an undeclared field;
- the same-transaction activation scan enforces the closed role vocabulary,
  non-null axes, `(principal, resource)` uniqueness, resource referential
  integrity, and — under `lastHolder` — an eligible protected holder per
  live resource, refusing the **whole** install otherwise;
- a **reset-install retires every runtime seat and restores exactly the
  fixture seats in the same one-transaction cut** that rotates the
  data-version stream and the authorization incarnation
  (declared-restore semantics — one incarnation cut, never a stream of
  per-row kicks), so a principal holding a runtime-only seat is provably
  denied afterwards while fixture authority survives.

Runtime bootstrap is unchanged: product flows still create protected
resources through the generated membership `bootstrap()` method under a
real principal — the fixture lane is for seeds, resets, and test personas,
not an application write path.

Trusted dev/import tooling has a separate governed membership writer. In that
lane, a `lastHolder`-protected resource and an eligible holder must appear in
the same seed transaction or the whole write refuses with
`SNAPBACK_MEMBERSHIP_ACTIVATION_UNPROTECTED_RESOURCE`. Party Wall exercises
this dev-only fixture shape on a sibling server; do not present it as a
sessions-mode deployment seed or as a roster raw-write escape for handlers.

## Use the generated lifecycle

`SnapbackClient.ensureVersionedSeed(artifact)` is the non-destructive install
path. `previewVersionedSeed` reports the current/requested identity and exact
direct, derived, total, and reset-deletion counts without changing the
database or WAL. Preview is still an administrative NonProd operation.

For an intentional destructive change, preview `resetInstall`, retain its
tagged predecessor stream (`absent` or the exact present UUIDv7), and pass that
carrier to `resetInstallVersionedSeed`. `clearVersionedSeed` uses the same
predecessor check and coordinated reset but installs no successor identity.
Stale predecessor carriers and historical operation replays refuse.

The managed CLI and Vite lifecycle consume the generated artifact through the
same client methods. They preflight `versioned_seed_install_v1` or
`versioned_seed_reset_v1` and never fall back to legacy `ensure`, `seed`, or
`reset(seed)`. A watch reload therefore matches or reports drift; it does not
reset a populated database.

For `snapback dev`, “seed on first run” means the database did not exist when
that command created its managed server. The CLI installs the generated
artifact through the versioned protocol, then subsequent starts and watch
reloads make only the non-destructive `matched` observation. Existing
databases are never guessed to be fresh. A sessions-mode app is established
from its closed schema/functions startup carrier first; versioned seed remains
outside the legacy startup `seed` member and runs through the named
administrative operation after activation.

The direct administrative routes are
`/_snapback/api/app/seed/{ensure-v1,preview-v1,reset-install-v1,clear-v1}`.
Automation can instead use the corresponding
`app.seed.{ensure,preview,reset-install,clear}.v1` host operations. All four
require AdminWrite plus the NonProd profile, and host-operation bodies place
the closed seed request only under `input`.

## Expect the reset blast radius on connected clients

A receipted reset-install (or clear) retires the **entire pre-reset world**,
deliberately including authority — reset never resurrects it. Every already
connected client is permanently done, not transiently disconnected:

- Live-query holders receive `SNAPBACK_AUTH_STREAM_RESET` as a **terminal**
  error; the client closes for auth and reconnect retries will not recover
  it.
- Pre-reset session tokens invalidate globally: later mutations from any
  client still holding one fail `SNAPBACK_AUTH_REQUIRED`.
- A fresh email-code sign-in for the same email mints a **new** principal,
  so seats/roles must be re-entered through whatever the restored seed
  provides (for example invites); nothing re-links the old principal.

Rigs and admin tools should not learn this from an incidental throw out of
an unrelated await: `SnapbackClient.authTerminalStatus()` is the synchronous
terminal-auth fact (`{ terminated, code, authorityDisposition, atMs }`), and
`subscribeAuthTerminal(listener)` fires at the cut — rebuild the session
(fresh sign-in or explicit custody replacement, which clears the fact)
instead of retrying. Suites that reset mid-run must plan to re-authenticate
every persona afterwards.

## Run the loop against a sessions-mode app

The seed lifecycle is admin-gated, so on a dev-mode app an admin-token client
is enough. A **sessions-mode** app needs three additional facts, each of which
is a refusal if you miss it:

1. **The admin client must also carry a session bearer.** An admin-token-only
   client cannot offer the auth-client protocol, which sessions mode requires.
   Construct it as
   `createExternalSessionClient(url, { bearerToken, adminToken })` — a persona
   bearer minted through the
   [test-persona recipe](../auth/sessions-and-principals.md#mint-test-personas-the-complete-local-recipe)
   plus the admin token for the seed routes.
2. **Pass `requestedMode: 'sessions'` on every seed call.** The seed methods
   default to `dev` and refuse a sessions app with
   `SNAPBACK_SEED_CROSS_MODE_UNSUPPORTED` until the mode is stated
   explicitly. The refusal is deliberate: a cross-mode install would seed
   identities the running app cannot authenticate.
3. **Take `expectedDataVersionStream` from the preview.** The active stream is
   `preview.current.dataVersionStream`; a stale value from an earlier run
   refuses as a historical operation.

With those three, `resetInstallVersionedSeed` is the paved sessions reset: it
leaves the database in a state the next `snapback dev` accepts, unlike a raw
database wipe, which strands the seed identity. Remember that the reset
invalidates every bearer minted before it, including the one that performed
it — mint personas *after* the install, and never seed captured principal ids
(see
[reset invalidates sessions](../auth/sessions-and-principals.md#reset-invalidates-sessions-and-reissues-principals)).

When the fixture itself needs password-backed accounts, application profile
rows, and typed avatar assets, use the app-owned
[sessions fixture installer](../recipes/sessions-fixture-install.md). It signs
up or verifies each real principal after the administrative seed lifecycle;
it does not smuggle principal ids or asset records into this protocol.

## Interpret refusals

- `SNAPBACK_SEED_MIGRATION_REQUIRED`: migrate, or explicitly reset-install.
- `SNAPBACK_SEED_VERSION_REUSED`: choose a new version for changed bytes.
- `SNAPBACK_SEED_NONEMPTY_UNTRACKED` or
  `SNAPBACK_SEED_PARTIAL_UNTRACKED`: inspect the existing data; reset-install
  only if its deletion is intended.
- `SNAPBACK_SEED_OPERATION_HISTORICAL`: obtain a fresh predecessor stream and
  operation id.
- `SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED`: keep total direct plus changed
  maintained-projection outputs at or below 1,024. An acceptance fixture that
  genuinely needs more rows does not belong in a seed — load it through the
  gated batch-ingest recipe in
  [loading large deterministic fixtures](../testing/large-fixtures.md).
- `SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED`: the selected target does not
  advertise the required protocol; there is no compatibility fallback.

For the local dev loop, `snapback reset --dev-fresh` is the paved one-shot
escape from this whole lifecycle cluster: it creates a fresh database,
re-installs the versioned seed, and has a supervised Expo loop re-mint its
ordinary session. Every individual refusal above remains unchanged for partial
operations; the command composes the deterministic destructive path instead of
weakening those guards.

The local protocol is advertised as **experimental** while LLP 0109 remains in
Review. The executable manifest is the advertisement gate: every required
local row must pass, while hosted compiled-seed custody stays visibly GAP.
