# LLP 1015: The Snapback 2 control plane — the owner is the control plane

**Type:** RFC
**Status:** Draft — proposal, binds nothing (`rules/RULES.md`: only
implemented specs bind, and a spec needs an implementer and a date; §9 has
neither yet). Sequenced after the loop bar by `rules/NOT-DOING.md`
("Media collections, push, cron, vector/search, **hosted control planes**,
multi-region, federation … one hosted target: that is the feature list
until the bar is met"). This RFC is the design for that one hosted target's
control plane, written so that when the bar is met the three empty rows of
the verb table have a spec to implement. Author rulings of 2026-09-05 (§8)
let lane H0 start before the bar and name Cloudflare the preferred substrate,
gated on the §11 experiments.
**Systems:** `snapback2/crates/snapback2` (`deploy`, `rollback`, `secret`;
`dev --serve`; `/control/*` in `src/control.rs`, `src/serve.rs`, `src/owner.rs`),
`snapback2/crates/snapback2-core` (store snapshot, `_releases`, `_tokens`,
`_secrets`), `snapback2/crates/snapback2-effects` (secret grants),
`snapback2/packages/compiler` (secret declarations in the certificate), a new
Snapback 2 project `snapback2/registry/` (the registry app), `rules/NOT-DOING.md`
**Author:** Claude Fable 5.1, commissioned by Charlie Cheever 2026-09-05 in
session
**Date:** 2026-09-05
**Revised:** 2026-09-05 (a — author rulings folded: §8 answered; §5 provider
ruling; §7 H0 before the bar; §11 experiments added; D2, D10, D12, D13 and §1
amended); 2026-09-05 (initial)
**Related:** **LLP 1014** (the evidence this answers; §7 items are cited as
"1014 §7.n"), LLP 1000, LLP 1002 §1 (decision 6: `serve` mode; decision 5:
fifteen verbs) §4 (the wire) §5 (the owner), LLP 1003 (effects and grants),
LLP 1006 (assets: what a release carries), LLP 1009 (Shelved; `logs`),
LLP 1012 §13 (the trade), LLP 0329.016 §5.9 (deploy, previews, tokens,
rollback, export) §5.10 (isolation, MCP) §5.11 (the verb table) §9.9 (the
week-one hosted target); Snapback 1: LLP 0036 (config `status`), LLP 0072
(rollback posture; control vs application plane), LLP 0103/0104 (Expo-hosted),
LLP 0111 (Fly), LLP 0150 (token acquisition, the v2 direction);
`rules/RULES.md`, `rules/NOT-DOING.md`

## Summary

LLP 1014 read Snapback 1's twenty-four control-plane LLPs and fourteen
providers and found that the field's control plane is five objects on four
surfaces, that Snapback 1 built the safety end first and never reached the
URL, and that the single-binary products serve their admin surface from the
app itself — which is what Snapback 2's owner already does behind
`.snapback/owner.json`.

This RFC proposes the smallest control plane that fills the three empty rows
of the verb table (`deploy`, `rollback`, `secret`) and nothing else:

1. **The owner is the control plane.** A hosted app is the same binary
   running `dev --serve` on one machine with one volume. Its existing
   `/control/*` routes admit a bearer token in `serve` mode instead of the
   loopback secret. `logs`, `why`, `trace`, and `data` gain `--env`; that is
   the dashboard.
2. **Five objects.** App, environment (`production` plus TTL'd previews),
   release (an append-only ledger in the store), snapshot (taken at every
   deploy), token (one kind, three capabilities, expiry required). Secrets
   are a write-only property of an environment, declared by effects and
   checked by `check`.
3. **One registry, itself a Snapback 2 app, off the request path.** It does
   the three things an owner cannot do for itself — create a machine, mint a
   claim URL, re-issue a token — and nothing an app needs to serve. An app
   answers with the registry down; that is a test.
4. **Account-less first deploy.** `snapback2 deploy` with no token creates a
   temporary app (72 h, capped), prints the URL and a claim URL, and writes
   the binding. Claiming makes it permanent.
5. **Rollback includes data, loudly.** `rollback` restores the previous
   release and its snapshot; if commits landed since, it refuses unless the
   agent names the count.
6. **Caps, not bills.** Per-environment caps on store bytes, egress, and
   effect calls refuse with a family and a rewrite.

The deletions that pay for it are in §1: no browser console, no catalog, no
adapters or hosting profiles, no lifecycle engine, no org/team model, no
target-neutral contract. The design is one new project, three verbs, seven
routes, three store tables, and no new check.

The author's rulings of 2026-09-05 are folded in (§8): Cloudflare is the
preferred substrate if the §11 experiments pass, with Fly Machines as the
control arm; the claim identity is the Expo account and EAS's account,
organization, and project model flows into the hosted version; `run --env
production` exists; the browser console is deferred, not refused; and lane H0
may start before the loop bar.

## 1. What this RFC is counterweighted by

`rules/RULES.md`: moving something onto the doing-list takes something off.
`rules/NOT-DOING.md` already carries "one hosted target" on the feature list
and the verb table already has the three rows; what this RFC adds is one
deployable (the registry). It pays with these lines onto `NOT-DOING.md`, each
evidenced by LLP 1014:

| Not building | Why (LLP 1014) |
| --- | --- |
| **A browser admin console, in this RFC.** | 4 of 126 Snapback 1 diaries mention it; 110 `ADMIN` codes; the products whose dashboard drifts from their CLI are the ones with a separate console (§3.3, F7). The verbs are the console. The author will build a user-focused console later, on the same routes; the agentic API comes first (ruling 2026-09-05). |
| **A control catalog, an operation registry, or a second projection of the control routes** (`AdminClient`, host-ops envelope, generated MCP config). | LLP 0184's catalog drifted within days (§3.4 cause 3). One table in `control.rs`; MCP later reads it. |
| **Adapters, hosting profiles, target descriptors, a target-neutral lifecycle engine.** | Two half-adapters and ten interfaces for zero served apps (§3.4 cause 4). One target, one provision effect. |
| **Leases, fences, a supervisor, `ambiguous` operation states.** | The owner is exclusive by construction (`E_STORE_OWNED`); a deploy is a successor applied by the one process that can apply it (§3.4 cause 1). |
| **An organization or team model of our own.** | The hosted version uses EAS's account, organization, and project model (ruling 2026-09-05; D12). A token is the unit of sharing between machines. |
| **Keypair-bound grants, device flows, consent compilers (LLP 0150).** | The field's weaker shape — an opaque token with scope and expiry — is what agents use today (F3). v2 direction, recorded in §8. |
| **Multi-region, HA, autoscaling, zero-downtime activation.** | Already on the list; restated so `deploy`'s receipt can say "bounded downtime" honestly, as LLP 0072 did. |
| **Provider credentials in the CLI.** | The CLI holds Snapback tokens only; the registry holds the provider credential (F3; LLP 0072's plane boundary). |

Nothing here adds a blocking check, a script, a registry file, or a config
file the agent must know about. The binding file (`.snapback/deploy.json`)
is written by `deploy` into the existing gitignored build cache.

## 2. Decisions

Each names its evidence. "Owner" means the running `snapback2` process that
owns a store (LLP 1002 §5); "registry" means the one Snapback 2 app of §5.

### D1 — The owner is the control plane

A hosted environment is one machine running `snapback2 dev --serve` against
one volume holding `.snapback/store.sqlite`. Its `/control/*` routes are the
control plane. Today (`serve.rs`) they are loopback-only and gated by
`X-Snapback-Control` matching `.snapback/owner.json`; in `serve` mode they
additionally admit `Authorization: Bearer sb2_…` from any origin over TLS,
verified against `_tokens` (D6). Nothing is projected anywhere else: the
verbs call the routes, MCP (later) calls the routes, and there is no third
client. Evidence: 1014 §7.1, F7; the fourteen routes in `control.rs`.

Routes by mode (`dev` = local owner, loopback secret; `serve` = hosted,
token):

| Route | `dev` | `serve` | Capability | Notes |
| --- | --- | --- | --- | --- |
| `GET /control/status` | yes | yes | read | adds `environment`, `release`, `meters`, `binaryVersion` |
| `GET /control/logs` | yes | yes | read | bounded, `since`, structured (LLP 1002 §8) |
| `POST /control/why`, `GET /control/trace`, `GET /control/subscriptions`, `POST /control/verdicts` | yes | yes | read | unchanged |
| `POST /control/data` | yes | yes | read | in `serve`, runs as the system principal (D10); capped; logged |
| `POST /control/apply`, `POST /control/migrate` | yes | yes | deploy | the successor path `deploy` already needs (LLP 1002 §5) |
| `POST /control/release` (new) | no | yes | deploy | upload one release; owner applies it as a successor, probes, appends the ledger |
| `GET /control/releases` (new) | yes | yes | read | the append-only ledger |
| `POST /control/rollback` (new) | no | yes | deploy / admin | code-only is `deploy`; with data is `admin` (D5) |
| `POST /control/snapshot` (new) | yes | yes | deploy | local snapshots retain `POST /control/fork`; the CLI adapter is deleted (2026-09-05, LLP 1016 J1b); hosted snapshots are named by release |
| `GET /control/secrets`, `PUT /control/secret/<name>`, `DELETE /control/secret/<name>` (new) | yes | yes | read / deploy | names and set-state on `GET`; never a value (D7) |
| `POST /control/token`, `DELETE /control/token/<id>` (new) | no | yes | admin | mint and revoke (D6) |
| `POST /control/reset`, `POST /control/fork`, `GET /control/personas`, `POST /control/persona`, `POST /control/clock` | yes | **refused** | — | `E_CONTROL_DEV_ONLY`, family `control`, rewrite "use snapshot / rollback / a token" |
| `POST /control/stop` | yes | yes | admin | the machine restarts the process; used by the registry for destroy |

**Amendment 2026-09-05 (LLP 1016 J1b):** The `fork` CLI adapter is deleted; its route and snapshot primitive remain. Jobs add `GET /control/jobs`, `GET /control/job/<id>` (read), `POST /control/job`, and `POST /control/job/<id>/cancel|resume` (admin). `status` includes running/queued/parked job counts. These use the loopback control secret today; H0 owns token admission. `persona create` is deleted from the CLI; first use creates a persona.

Seven new routes in the original H0 proposal. Every refusal carries a family, a site, and a rewrite (LLP
1002 §4). Every response carries `environment` and `release` so an agent can
never mistake which app it is talking to.

### D2 — Five objects, and where each lives

| Object | Identity | Lives in | Who creates it |
| --- | --- | --- | --- |
| **app** | `app_<ulid>` | registry `apps` | registry, at first `deploy` or claim |
| **environment** | `<app>/production` or `<app>/<preview-name>` | registry `environments` + one machine + one volume | registry |
| **release** | `rel_<sha256 of the release bundle>` | the environment's store, `_releases` (append-only) | the owner, on `POST /control/release` |
| **snapshot** | `snap_<release>_<seq>` | the environment's volume, `.snapback/snapshots/` | the owner, before applying a release |
| **token** | `sb2_<random 32 bytes, base32>`; stored as a hash | the environment's store, `_tokens` | the owner, on `POST /control/token`; the registry at provision and claim |
| secret | name | the environment's store, `_secrets` | `secret set` |

The committed project carries no identity. Like Convex's `CONVEX_DEPLOYMENT`
and Vercel's `.vercel/project.json`, the binding is local and gitignored:
`.snapback/deploy.json` holds `{ app, environments: { production: { url,
tokenRef } , … } }`. Tokens live in `~/.config/snapback2/credentials.json`
(0600) keyed by `url`, or in the environment as `SNAPBACK2_TOKEN` for CI and
agents. A token is self-describing (D6), so CI needs exactly one variable.
Two clones with two bindings are two apps; one binding shared through the
token is one app. Evidence: 1014 §7.2, F1; the field's binding files (§2 of
1014).

In the hosted version the tenant is EAS's: at claim time an app is bound to
an EAS project under an EAS account (D12), the registry stores those ids,
and it owns no account, organization, or team table of its own.

### D3 — Environments: `production` and previews

`snapback2 deploy` targets `production`. `snapback2 deploy --preview [name]
[--expires 72h] [--from production]` creates a preview environment: a fresh
machine and volume, a fresh store with the seed applied (the `reset`
semantic), or — with `--from production` — a copy of production's latest
snapshot (the `fork` semantic). Previews carry their own tokens and their own
secrets (unset by default; the refusal of D7 names them). Default TTL 72 h,
maximum 14 d, renewable by redeploying; the registry reaps expired previews
and reports the reaping in `deploy --json` for that app. There is no
`staging` object; a preview named `staging` with `--expires 14d`, redeployed
weekly, is staging. Evidence: 1014 F8a, F9 (Cloudflare 60 min, Neon 72 h,
Instant 2 weeks), §3.5 (Snapback 1's forks: TTL, scrubbed credentials,
resource admission).

### D4 — A release is what `check` produced, and the ledger is append-only

A release bundle is the build cache's outputs with nothing else: the project
JSON and certificate (LLP 1001 §4, LLP 1002 §3), the client stubs, the
effects' TypeScript, the seed, the asset admission manifest (LLP 1006), and
the exact `snapback2` binary version the bundle was checked with. It is
content-addressed. `deploy`:

1. runs `check` (the gate; a red `check` is a red `deploy`, same envelope);
2. compares the bundle's binary version with the environment's
   (`/control/status`); a mismatch refuses `E_DEPLOY_BINARY_SKEW` with the
   rewrite "run `snapback2 deploy --upgrade`", which asks the registry to
   restart the machine on the newer binary first;
3. `POST /control/snapshot` (D5);
4. `POST /control/release` — the owner applies the release as a successor
   in place when additive, or from the migration plan the bundle carries
   when destructive (LLP 1002 §5's `--apply-migration`, unchanged), then
   probes itself (manifest, one query as the system principal, one
   subscription open/close) and appends `_releases`;
5. prints the URL, the release id, the applied migration summary, and the
   meters.

There is no separate `plan`/`apply`/`status`/`activate` family: `check` is
the plan, the owner's successor is the apply, the ledger is the status.
Rollback posture is not a field the agent fills in; it is derived — the
predecessor is compatible (code-only rollback) if and only if the applied
successor was additive, which the owner knows. Evidence: 1014 F11b (`check`
and successor plans are stronger than the field's migration push), §3.5
(LLP 0072's rollback ontology), Heroku's ledger (§4.1).

### D5 — Rollback includes data, loudly

Every deploy snapshots the store before applying (SQLite online backup to
`.snapback/snapshots/`; the same primitive as `fork`). `snapback2 rollback
[--to <release>]`:

- defaults to the previous release;
- if the successor between was additive, restores **code only** and says so
  (`restored: "code"`, the LLP 0072 `codeOnly` posture);
- if it was destructive, or `--data` is given, restores **the snapshot taken
  at that deploy**; before doing so it counts commits in the ledger since the
  snapshot and, when the count is non-zero, refuses `E_ROLLBACK_DISCARDS`
  naming the count, with the rewrite "rerun with `--discard-commits N`";
  the verb never prompts (LLP 0329.016 §5.11: no prompt without a TTY);
- keeps the URL and every token; appends a ledger row of kind `rollback`.

Snapshots are retained for the last five releases plus every release from the
last 30 days; the registry's reaper trims the rest. Evidence: 1014 §7.6,
F5 (Neon/Replit checkpoints, PlanetScale's revert window; Bolt's failure),
LLP 0072's refusal to let "a dashboard button imply every migration is
reversible."

### D6 — One token kind, three capabilities, expiry required

A token is `sb2_` plus 32 random bytes. The owner stores its hash in
`_tokens` with `{ environment, capability, expiresAt, label, createdBy }` and
verifies in constant time. Three capabilities, each a superset of the last:

| Capability | Admits | Default expiry | Who mints it |
| --- | --- | --- | --- |
| `read` | `status`, `logs`, `why`, `trace`, `subscriptions`, `verdicts`, `data` (system-principal, capped), `releases`, `secrets` (names) | 24 h | any `deploy` or `admin` token holder; MCP by default |
| `deploy` | `read` + `release`, `apply`, `migrate`, `snapshot`, code-only `rollback`, `secret set/unset` | 30 d | an `admin` token holder; the registry at claim, written to the claimer's credentials file |
| `admin` | `deploy` + `rollback --data`, `token` mint/revoke, `stop`, environment delete (via the registry) | 30 d, maximum 90 d | the registry at claim; an `admin` holder may mint another |

`snapback2 secret` is the verb for secrets; token operations live under
`deploy`: `snapback2 deploy --token create --env production --capability read
--expires 2h [--save-env]` and `--token revoke <id>`, so the verb table stays
at fifteen (LLP 1002 decision 5). Tokens are printed once, never logged, and
never appear in `--json` output other than the mint response. A token is
scoped to one environment; a preview's token cannot touch production.
Evidence: 1014 §7.5, F3 (Convex `deployment token create --expiration
--save-env`, Neon project-scoped keys, PlanetScale TTL, Fly macaroons).

### D7 — Secrets are names, declared by effects, checked at `check`

Effects declare the secrets they read (LLP 1003's grant model already binds
`fetch` to declared hosts; secrets are one more grant kind on the effect
descriptor, spelled in the `.q` effect block and reaching the compiler as a
list of names). `check` refuses an undeclared read `E_EFFECT_SECRET_UNDECLARED`
(family `effects`) and records the declared set in the certificate.

`snapback2 secret set NAME [--env production]` reads the value from stdin, or
from a secure prompt only when a TTY exists; `secret list` prints names,
set-state, and last-set time per environment and never a value; `secret
unset NAME`. The owner stores values in `_secrets`, readable only by the
effects runner through the grant. `deploy` refuses `E_DEPLOY_SECRET_UNSET`
naming every declared secret that is unset in the target environment, with
the rewrite `snapback2 secret set NAME --env <env>`. Values never appear in
argv, logs, receipts, `--json`, `why`, `trace`, or any route response; a
value write over a non-TLS transport is refused. No KMS in v1: one machine
holds one app's store on one encrypted volume. Evidence: 1014 §7.8, F4;
LLP 0036's `status` primitive (the best-liked piece of the Snapback 1
surface, §3.5).

### D8 — Account-less first deploy with a claim URL

`snapback2 deploy` with no binding and no token asks the registry for a
**temporary app**: the registry provisions a `production` environment with
a 72 h TTL and the temporary caps (store 100 MB, egress 1 GB/day, 10,000
effect calls/day, 100 subscribers), returns the URL, a `deploy` token, and a
claim URL; `deploy` proceeds as in D4, prints all three, and writes the
binding. The human opens the claim URL, authenticates (D12), and the app
becomes permanent under their account with the ordinary caps; the registry
re-issues an `admin` token to the claimer's session and revokes nothing the
agent holds until it expires. Unclaimed apps are destroyed at TTL with their
snapshots. A second agent with the binding file redeploys the same app. A
proof-of-work or rate limit on temporary creation is the registry's concern
(Cloudflare's precedent) and is not specified here. Evidence: 1014 §7.4,
F8a.

### D9 — Caps, not bills

Every environment carries caps: store bytes, egress bytes per day, effect
invocations per day, concurrent subscribers, and preview TTL. The owner
enforces the first four (it already counts all of them) and refuses at the
cap with family `quota` and a rewrite naming the meter and the verb that
raises it; `status` and `deploy --json` report the meters. There is no bill
in v1 and no alert: a refused write is the alert. Numbers for the permanent
caps are the author's (§8). Evidence: 1014 F9 (the $34,895 alarm loop;
"budget alerts are email"); LLP 0329.016 §5.9.

### D10 — Production data is read as the system principal, never a persona

`serve` mode refuses `X-Snapback-As` (LLP 1002 decision 6, shipped).
`data --env production`, `why --env production`, and `run --env production`
act as the reserved system principal (`rule.system()`), require a `read`
token for reads and an `admin` token for `run` of a mutation, are capped
like every other read, and append a ledger row `{ kind: "operator", op,
token, at }` so the trace answers "who read this." Evidence: 1014 F8c (the
guarantee must live below the model — here in the owner's admission, not in
a tool description); LLP 1002 §8. Ruled 2026-09-05: `run --env production`
exists, `admin` only, ledgered (§8.4).

### D11 — Static stability is a test

The registry is never consulted on a request path. An environment serves
queries, mutations, subscriptions, assets, and effects with the registry
unreachable; `deploy`, `rollback`, `secret`, and every read verb work with
the registry unreachable once a binding and a token exist, because they talk
to the owner. Only creating an app or preview, claiming, upgrading the
binary, and re-issuing a token after loss need the registry. This is one
test in `scripts/test.sh`'s budget: start an owner in `serve` mode with a
registry URL that refuses connections, run the corpus's chat journey, deploy
a release to it, roll it back. Evidence: 1014 §7.7, F6 (AWS REL11-BP04).

### D12 — Identity for the claim is the Expo account (ruled 2026-09-05)

This is an EAS product. The claim URL is an Expo login; claiming binds the
app to an EAS project under the claimer's EAS account, and from then on the
EAS account, organization, and project model is the tenant model of the
hosted version (LLP 0103's posture, carried over). Concretely: who may mint
an `admin` token for an environment is "a member of the owning EAS account
whose EAS role allows it"; the registry stores EAS ids and never its own
membership; billing, if any, is EAS's. Snapback 2's own signup/login (LLP
1001) is used only where there is no registry — the local `serve`-mode
contract tests of lane H0 — and by the registry's effects to talk to Expo.
Evidence: 1014 §4.2 and §4.10 (a project *is* the cloud provider's project),
LLP 0103.

### D13 — No browser console in this RFC; the verbs are the console

There is no `status` verb: `dev --status` is the local spelling and
`deploy --status --env production` prints `/control/status` for a hosted
environment, meters and release included. A human who wants to look at
production data runs `snapback2 data --env production todos --json`.
Evidence: 1014 §7.9, F7, §3.3. Ruling 2026-09-05: a user-focused console
comes later, after the hosted version; it reads the same `/control/*` table
and adds no route a verb does not have.

### D14 — Export is deploying to a directory

`snapback2 deploy --target dir:<path>` writes the release bundle and a
snapshot into `<path>`; `snapback2 init --from <path>` re-creates the project
with its store. The local directory is the zeroth target, needs no registry
and no token, and is the whole backup story. Evidence: 1014 §7.11, F10.

### D15 — MCP comes after the verbs, from the same table

When MCP lands (LLP 0329.016 §5.10: thin, read-only by default, write tools
split by blast radius), its tools are the `read` rows of D1 by default, with
`deploy`-capability tools behind an explicit flag and `admin` tools absent.
It reads no second catalog. Evidence: 1014 §7.10, F8c.

## 3. Day one, hosted, as a transcript

```text
$ snapback2 deploy
check: ok (2 tables, 6 programs, 1 effect; 212 ms)
registry: created app_01J9… (temporary, expires in 72h)
release rel_3f9a… applied (additive; 0 rows rewritten); snapshot snap_3f9a…_1 kept
SNAPBACK_URL=https://app-01j9.snapback.app
claim: https://snapback.app/claim/7GQ4-MZ2T   (expires with the app)
token: deploy, expires 2026-10-05 (saved to ~/.config/snapback2/credentials.json)
meters: store 1.2 MB / 100 MB · egress 0 / 1 GB · effects 0 / 10,000

$ snapback2 secret set STRIPE_KEY --env production < ./stripe.key
set STRIPE_KEY (production); declared by effects: charge.capture

$ snapback2 deploy --preview pr-14 --expires 3d --from production
…SNAPBACK_URL=https://app-01j9-pr-14.snapback.app
refused E_DEPLOY_SECRET_UNSET: STRIPE_KEY is declared by charge.capture and unset in pr-14
  rewrite: snapback2 secret set STRIPE_KEY --env pr-14
(the preview is created and serving; its effect will refuse until the secret is set)

$ snapback2 logs --env production --since 10m --json | jq '.[] | select(.family=="quota")'

$ snapback2 rollback
refused E_ROLLBACK_DISCARDS: 14 commits landed after snap_3f9a…_1
  rewrite: snapback2 rollback --discard-commits 14   (or: --to rel_3f9a… without --data for code only)

$ snapback2 deploy --token create --env production --capability read --expires 2h --save-env
wrote SNAPBACK2_TOKEN to .env.snapback (read, production, expires 2026-09-05T20:12Z)
```

Every line above is a `--json` envelope with the same fields; the text is a
projection of it.

## 4. The wire

Requests to `/control/*` in `serve` mode carry `Authorization: Bearer
sb2_…`. The owner verifies the hash, the environment, the capability, and
the expiry, then dispatches through the existing `control::route`. New
route bodies:

| Route | Body | Response |
| --- | --- | --- |
| `POST /control/release` | multipart: `bundle` (the content-addressed tar), `plan` (optional migration plan the bundle's `check` validated) | `{ release, applied: "additive" \| "destructive", migration, probes, snapshot }` |
| `POST /control/rollback` | `{ to?: release, data?: bool, discardCommits?: n }` | `{ restored: "code" \| "code+data", from, to, discarded }` |
| `POST /control/snapshot` | `{ label? }` | `{ snapshot, bytes }` |
| `GET /control/releases` | — | `[{ release, at, kind: "deploy" \| "rollback" \| "operator", by, applied, binary }]` |
| `GET /control/secrets` / `PUT /control/secret/<name>` / `DELETE …` | `PUT`: the raw value as the body, `content-type: text/plain`; TLS required | names with `{ set: bool, setAt, declaredBy: [effect] }` |
| `POST /control/token` / `DELETE /control/token/<id>` | `{ capability, expires, label }` | `{ id, token, expiresAt }` once; then `{ id, revoked: true }` |

The registry's own API is a Snapback 2 wire (LLP 1002 §4): `mutation
apps.createTemporary`, `apps.claim`, `environments.create`,
`environments.destroy`, `environments.upgradeBinary`, `tokens.reissue`, and
`query apps.mine`. `deploy` calls them like any client.

## 5. The registry, a Snapback 2 app

`snapback2/registry/snapback/schema.q` and its programs are the first
production Snapback 2 program (1014 §7.13). Sketched as tables and rules
rather than code, because the Quarry spelling is the implementer's:

| Table | Columns (beyond `id`) | Rules |
| --- | --- | --- |
| `accounts` | `email`, `createdAt` | read: self |
| `apps` | `account?` (null while temporary), `name`, `createdAt`, `expiresAt?`, `caps` | read/write: `account == viewer`; temporary rows readable by no persona, only by the effects |
| `environments` | `app`, `name`, `url`, `machine`, `volume`, `binary`, `expiresAt?`, `state: provisioning \| ready \| destroyed`, `caps`, `controlSecretRef` | read: via `app`; write: effects only (`rule.system()`) |
| `claims` | `app`, `code`, `expiresAt`, `claimedBy?` | read: none; consumed by `apps.claim` |
| `reissues` | `environment`, `capability`, `at`, `by` | read: via `app`; the audit of token re-issue |

Effects (LLP 1003, with `--features hermes`): `provision` (create a machine
with the pinned binary image and a volume, wait for `/control/status`, write
the environment row and its control secret), `destroy`, `upgradeBinary`,
`reapExpired` (a `schedule`; one kind, per `NOT-DOING.md`), and `reissueToken`
(calls the environment's `/control/token` with the provision-time control
secret). The provider credential is one secret of the registry app, set with
`snapback2 secret set` like any other. The registry runs on the same hosted
target as an ordinary environment of an ordinary app named `registry`, and
deploys with `snapback2 deploy`.

**Provider (author ruling 2026-09-05):** Cloudflare is the preferred
substrate — EAS Hosting already runs on Cloudflare Workers for Platforms with
a commercial agreement in place (LLP 0103) — *provided* the §11 experiments
show the engine can run there within the bars and without a port that
`rules/NOT-DOING.md` forbids. Fly Machines is the control arm of those
experiments and the fallback: one Machine plus one volume per environment
maps one-to-one onto the owner's exclusivity (`E_STORE_OWNED`), the Machines
API creates in seconds, and Snapback 1 retained working Fly observation and
backup primitives (LLP 0111). Whichever wins changes only the `provision`
effect. On Cloudflare with EAS, the registry shrinks: accounts, projects,
billing, the dashboard, and request logs are EAS's; the registry keeps only
the environment-to-instance mapping, control secrets, token re-issue, and
reaping.

## 6. Measurements to record

Each lands as a line in `snapback2/metrics/` with the landing that produces
it (LLP 1012 §14's precedent), and each carries a budget that
`scripts/measure.mjs --check` can hold:

| Number | Budget |
| --- | --- |
| `deploy` to URL, warm environment, additive release (the second deploy) | 15 s |
| `deploy` to URL, new temporary app (machine create + first release) | 60 s |
| `rollback`, code only | 5 s |
| `rollback --data`, 100 MB store | 30 s |
| `secret set` | 2 s |
| `deploy --preview --from production`, 100 MB store | 60 s |
| the static-stability test (D11) in `scripts/test.sh` | inside the 60 s gate; it is one owner and one refused connection |
| bytes added to the binary by the three verbs | recorded, no budget |

## 7. Sequencing and the trade

Author ruling 2026-09-05 (§8.7): lane H0 may start before the loop bar; it
needs no provider and no registry, and `rules/NOT-DOING.md` §Moves records
the trade. H1 onward wait for the bar and for the §11 experiments. Four
lanes, in order, each landing behind `scripts/test.sh` and the measured loop:

- **H0 — the contract, no provider.** `deploy --target dir:`, the release
  bundle and `_releases` ledger, `snapshot`, `rollback` with the discard
  accounting, `secret` with declarations in `check`, the `serve`-mode token
  admission, and the static-stability test. Everything runs locally against
  an owner in `serve` mode; nothing needs a machine. This lane is the whole
  contract and is testable in the 60 s gate.
- **H1 — the registry and the URL.** The registry app, the `provision` and
  `destroy` effects on the chosen provider, temporary apps with claim URLs,
  the binding file. The first hosted Snapback 2 app is the registry.
- **H2 — previews, caps, and reaping.** `--preview`, `--from production`,
  the meters and `quota` refusals, the reaper.
- **H3 — tokens for agents, and MCP.** `deploy --token`, the `read`
  capability's defaults, the MCP projection of the `read` rows.

What comes off the doing-list to pay for the registry deployable is in §1;
the offsetting item for starting H0 early is the browser admin console,
deferred until after the hosted version (§1, §8). Nothing in this RFC moves
the media/Expo slice, LLP 1009, or LLP 1012.

## 8. Author decisions — rulings of 2026-09-05

Asked in the first revision; answered by the author the same day in session.

1. **The hosted provider.** Ruled: Cloudflare is the natural preference —
   EAS is already on Cloudflare with a deal in place — but "maybe it's too
   gnarly"; run experiments first. §5 and §11 carry the ruling. Fly Machines
   is the control arm and the fallback.
2. **Claim identity.** Ruled: the Expo account, once they want to claim it;
   this is an EAS product. D12 rewritten. The EAS organization, team, and
   project model flows into the hosted version; the registry owns none of
   its own.
3. **The permanent caps** (D9). Ruled: the proposed numbers are reasonable
   to start (store 1 GB, egress 10 GB/day, 100,000 effect calls/day, 1,000
   subscribers; temporary apps 100 MB / 1 GB / 10,000 / 100). *Preview
   lifetime* means the TTL after which a preview environment is destroyed:
   72 h by default, renewed by redeploying, 14 d maximum (D3).
4. **`run --env production`.** Ruled: yes. `admin` only, every use
   ledgered (D10).
5. **Previews copying secrets.** Not answered; the recommendation stands as
   the default: never (D7, D3). Veto any time.
6. **Token default expiries** (D6). Ruled: reasonable — read 24 h, deploy
   30 d, admin 30 d with a 90 d maximum.
7. **H0 before the loop bar.** Ruled: yes. `rules/NOT-DOING.md` records the
   exception and the trade; §7 sequences it.

Also ruled: no browser console *for now* — "a user focused admin console
later; focus on the agentic API" (D13, §1); the registry as a Snapback 2 app
is accepted with reservation ("seems ok i guess"), so §11's EAS study also
asks how much of it EAS already is.

## 9. Implementer and date

None. Per `rules/RULES.md` this is a proposal until an implementer and a date
are written here; the verb table's three rows stay empty until then.

## 10. Non-claims

This RFC does not accept itself, does not change `rules/NOT-DOING.md` (it
proposes the lines of §1 for the author to add when H0 is commissioned), does
not choose the provider or the claim identity, does not claim any hosted
readiness, security posture, or availability, and does not revive any Snapback
1 control-plane document. It does not specify billing; there is none in v1.

## 11. The Cloudflare feasibility experiments (ruling 2026-09-05)

The author prefers Cloudflare and asked for experiments before committing.
The engine is a Rust binary that owns one SQLite file exclusively (WAL,
`E_STORE_OWNED`, successors applied in place). What Cloudflare offers today,
read on 2026-09-05: **Containers** with ephemeral disk ("when a Container
instance goes to sleep, the next time it is started it will have a fresh
disk"; disk snapshots "coming soon"; FUSE to R2 possible; cold start 1–3 s;
`sleepAfter` idle sleep; the February 2026 limit increase), **Durable
Objects with SQLite** (10 GB per object on the paid plan, point-in-time
recovery, GA April 2025), **R2** (S3-compatible), and **Workers for
Platforms** (dispatch namespaces with per-tenant limits, the substrate EAS
Hosting already uses). Three arms and one study:

| Arm | What runs | What is measured |
| --- | --- | --- |
| **A — Container + R2** | the unmodified binary in a Container behind its Durable Object; on wake, restore the store from R2; while awake, replicate WAL segments to R2 (Litestream-shaped; Snapback 1's lane in `guide/operating/replication.md` is the prior art); the DO forwards the wire | cold start to first successful query; restore time at 10 / 100 / 1,000 MB; write latency with replication on; RPO (replication lag at the moment of sleep); idle cost per app; whether `sleepAfter` cooperates with open SSE subscriptions |
| **B — Durable-Object-native** | `snapback2-core` compiled to wasm32 with a storage trait over the DO's synchronous `storage.sql`; the wire served by the DO | first a paper measure: every rusqlite touch point and every WAL/transaction assumption in `Store`, the successor rebuilds, and `_meta/_commits/_outbox`; then, only if that count is small, the 106-case corpus inside a DO; CPU ms per query against native; port size in lines. This arm collides with `rules/NOT-DOING.md` "WASM anywhere"; the author would have to move that line |
| **C — Fly Machines (control)** | the unmodified binary on one Machine with one volume | the same measures as A, so A's numbers have a comparison |
| **S-EAS (paper)** | how an app becomes an EAS project; the `expo.app` subdomain and preview-URL shape; whether `snapback2 deploy` calls EAS's deployment API or the registry; which registry tables EAS already is (accounts, projects, billing, dashboard, logs) | the registry's remaining scope, and the D8 claim flow's exact steps under Expo login |

**Pass bars.** Cold start to first successful query ≤ 3 s; warm query p50
over the wire ≤ 25 ms from the same region; restore of a 100 MB store ≤
10 s; RPO ≤ 1 s, or every mutation acknowledged only after its durable
write; the corpus chat journey green over the wire. Arm B additionally: the
port ≤ 1,500 new lines and the corpus 106 of 106.

**Decision rule.** If A meets the bars, Cloudflare Containers is the
substrate and `provision` is a Container-plus-DO effect. If A fails and B
meets them, the author rules on the WASM line. If both fail, Fly.

**Budget and record.** Three lane-days for A, one for B's paper measure,
one for C, one for S-EAS. Results land as lines in `snapback2/metrics/` and
as a dated amendment to §5 of this document. Owner: unassigned; this is not
a spec until it has one.
