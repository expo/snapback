# LLP 0036: App secrets and configuration

**Type:** RFC
**Status:** Accepted
**Systems:** Security, Runtime, API, Developer experience, Tooling, Deployment, Admin console, Demo apps
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-02
**Revised:** 2026-08-12 (the staging-time action redactor now scrubs every
string leaf before `runtime.log` telemetry capture, optional handler-console
stderr echo, and retained host-call trace arguments including host-fetch
headers; successful action result values remain the acknowledged local-profile
non-redacted surface)
**Revised:** 2026-08-08 (native server examples use the explicit `snapback start` spelling); 2026-07-12 (ENG-24338/ENG-24346: trusted local token discovery and fail-closed owner-only capability/config file handling; ENG-24344/ENG-24362/ENG-24363/ENG-24366: Cloudflare grants use immutable invocation-scoped opaque capability ids, full config status requires admin auth, pooled secrets enter only through stdin with requested member-state and generation attestation, and reversible encoded secret forms—including partial or mixed-case JSON Unicode escapes for BMP and astral values—are scrubbed at host fetch; earlier: 2026-07-07 ENG-23629 / LLP 0049 Phase 1: the first
`deploy-time-binding` backend landed on the Cloudflare proof target —
descriptor-only action grants (values never enter the handler isolate),
profile-scoped fail-closed `expose()`/`asBearer()` with
`SNAPBACK_CONFIG_EXPOSE_UNSUPPORTED`, one JSON-array Worker secret per pooled
entry with a durable modulo-applied rotation cursor, and the guided
`config.set` flow attesting `applied` through the `SNAPBACK_CONFIG_GENERATION`
secret-binding carrier; see the implementation-status banner. Earlier,
ENG-23493: the server's `config.verify` route now stages the probe under the instance lock, runs it detached under the ENG-23324 action watchdog, and records the outcome in a second short lock window — the "no hard timeout" probe gap is closed for server-triggered verifies; a stale detached run can no longer overwrite a newer retry's verification record. Earlier, 2026-07-04: admin console clarification: the old embedded fallback console was removed; the Contract/Exact admin console is now the single dashboard UI, with a no-dist diagnostic when its static build is unavailable. ENG-22752: the wizard's pre-provision empty state — `config.status` gained `appProvisioned` and the setup page now explains "no app has booted yet, open the app page once" instead of rendering nothing. D9 added — a read-only `.env`/JSON file *source* plus a durable store-path override (`--config-file`) that decouples the config store from the database, so `--memory` instances keep secrets across restarts; generalizes the `.env`-style source the v1 order named but shipped only as the deprecated `SNAPBACK_ACTION_SECRETS` env-blob. Design only — not yet built; see Implementation order §Near-term. Earlier, 2026-07-02: ratified Accepted by Charlie — the shipped v1 design with honest gaps banner; ledgered in LLP 0000. Also later same day, ENG-22598: the Contract admin console gained a Secrets surface projecting `config.status` with per-entry probe verify and grants legibility; see LLP 0017 §Implementation status. Earlier: v1 slice implemented on the local target at Charlie's direction — see the implementation-status banner for what is built versus the honest gaps; the status transition beyond Draft is left to the ratifying source per the LLP 0032 rules. Earlier same day: first review loop applied — cross-family GPT-5/Codex review, [reviews/0036-app-secrets-and-config.gpt-5.md](./reviews/0036-app-secrets-and-config.gpt-5.md), plus an author-side stress pass over the deployment matrix; added backend classes and the write-locus split (D7), config generations with attested apply, per-action grants (D8), the secret-handle API shape, probe execution rules, the transit rule, portability/backup/graduation semantics, and a strengthened multi-user posture in D3. Earlier same day: initial draft from the secrets design discussion)
**Related:** LLP 0000, LLP 0002, LLP 0003, LLP 0004, LLP 0007, LLP 0009, LLP 0010, LLP 0011, LLP 0012, LLP 0014, LLP 0015, LLP 0017, LLP 0018, LLP 0023, LLP 0024, LLP 0027, LLP 0028, LLP 0029, LLP 0030, LLP 0031, Diary 0008

## Summary

Snapback apps need external API keys and deployment-level settings: All Aboard
needs one to three rotating 511.org keys plus a directions key
([LLP 0027](./0027-all-aboard-caltrain-demo.plan.md)), the notifications
subsystem is defined as "a thin layer that you configure with your own provider
API keys" ([LLP 0000](./0000-snapback.explainer.md) §Notifications), and the v2
AI/data gateways are key-consuming subsystems by construction. Today the only
mechanism is `SNAPBACK_ACTION_SECRETS`, a process-wide JSON env blob
(`crates/snapback/src/runtime.rs`), named as gap G4 in
[LLP 0029](./0029-all-aboard-gap-closure.plan.md).

This RFC proposes **app configuration** as a first-class subsystem, with secret
values as the default flavor:

1. **Declared configuration** — app source declares what values it needs
   (name, purpose, secret or not, required or not, pooled or not, how to get
   one, an optional verification probe), carried in the generated manifest the
   way cron jobs are ([LLP 0028](./0028-cron-scheduled-execution.rfc.md)).
2. **A per-app store behind a seam of explicit backend classes** — a 0600
   file next to the SQLite database locally; the platform's secret facility
   on hosted targets (Cloudflare Workers bindings, AWS Secrets Manager/SSM,
   GCP Secret Manager, env injection on container platforms) — with write
   locus, apply boundary, and a per-app config generation as part of the
   contract, because on half the matrix the running server cannot write its
   own store.
3. **Capability-gated runtime exposure** — `ctx.secrets` handles in actions
   only, with rotation pools; non-secret values as readable config; both under
   the [LLP 0009](./0009-code-execution-security.rfc.md) §Secrets rules
   (secret-handle types, redaction, **no read-back**).
4. **One status primitive, many projections** — "what does this app need and
   what is missing?" answered machine-readably, then projected as CLI, HTTP,
   and MCP operations ([LLP 0024](./0024-agent-operating-surface.spec.md)), as
   a **setup wizard** on the admin lane for humans, and as structured
   acquisition metadata that lets **agents obtain keys themselves** where
   vendors allow it, asking a human only for the genuinely human steps.

The design goal for an open-source app like All Aboard: `git clone`, start the
server, open the printed setup URL, and be walked through each key — what it
is, why the app needs it, where to get one, paste it, verify it — with the same
flow drivable end-to-end by an agent through MCP instead of a browser.

> **Implementation status (2026-07-02, updated same day; Accepted same day —
> the ratified design is the v1 slice below plus the recorded v2+ scope, with
> the honest gaps standing as the boundary):** the v1 slice is
> **built and verified on the local target**: declared `config` entries and
> per-function `uses` grants in the generated manifest (validated fail-closed
> at codegen and again at manifest load), the 0600 sibling-file store
> (`<db>.config.json`, atomic replace, survives `app.reset` and server
> restarts), granted `ctx.secrets` handles with pool rotation and redacted
> coercion (`SNAPBACK_CONFIG_MISSING` / `SNAPBACK_CONFIG_UNDECLARED` on the
> wire), the gated `/_snapback/api/config/{status,plan,set,unset,verify}` ops
> with the transit rule and per-entry verify cooldown, the
> `/_snapback/admin/setup` wizard plus the printed install line, the one-time
> deprecated `SNAPBACK_ACTION_SECRETS` import, the All Aboard +
> egress-probe migration (G4 closed; acceptance:
> `demos/all-aboard/tests/acceptance/egress.mjs`, `crates/snapback/tests/config_v0.rs`), and
> a **Secrets surface in both admin consoles** projecting `config.status` —
> per-entry set/verified/apply state, `uses`-grant legibility, probe verify —
> with values write-only via the wizard (ENG-22598, LLP 0017).
> Honest gaps: on the LOCAL target `asBearer()` is `expose()` sugar — the
> true host-boundary unwrap exists on the Cloudflare deploy-time-binding
> profile (below) and comes to the local target with host-mediated fetch on
> the egress seam (G3); probes have a cooldown
> and — server-triggered — the ENG-23324 action watchdog (ENG-23493 staged
> the verify route's probe run off the instance lock; queries/mutations still
> have no wall-clock timeout); non-secret entries fail closed as
> unimplemented; the status/config
> table (D4 v2), hosted backends beyond the Cloudflare deploy-time-binding
> class, and acquisition levels L1+ are not built;
> CLI/MCP projections await the LLP 0024 surface (LLP 0032 P6).
>
> **Cloudflare `deploy-time-binding` backend as-built (2026-07-07, hardened
> 2026-07-12 under ENG-24344/24362/24363/24366):** the first hosted backend class landed on
> the LLP 0040/0049 proof target (`targets/cloudflare/src/coordinator.js`). Values
> live in gateway-Worker secret bindings under mechanical app-scoped names
> (`SNAPBACK_SECRET_ALL_ABOARD_CALTRAIN_FEED`), one JSON-array secret per
> pooled entry with the rotation cursor durable coordinator-side and applied
> modulo the current member count. Grants are **descriptor-only**: the
> handler invocation payload carries entry names, set/missing state, member
> count, and fresh invocation-scoped opaque capability ids — never values or
> a forgeable name/cursor descriptor (`descriptorsOnly` grants in the
> single-sourced ctx bootstrap) — and `expose()`/`asBearer()` **fail closed**
> with `SNAPBACK_CONFIG_EXPOSE_UNSUPPORTED` on this profile; values unwrap
> only at the coordinator's host-fetch boundary (LLP 0049 §Action Egress,
> Phase 2). Handles are immutable, and the host resolves ids only through the
> current function's private capability map. `config.set` is the guided controller flow
> (`targets/cloudflare/config-set.mjs`): one `wrangler secret bulk` activation
> carrying the changed entries plus the bumped `SNAPBACK_CONFIG_GENERATION`
> secret-binding stamp. Secret material enters as one validated JSON object on
> stdin, never argv; full `/config/status` requires the admin token. `applied`
> is **attested** by observing both generation ≥ staged and every requested
> declaration's set/member-count state (D7); an entry write with no
> generation-bearing activation stays `pending` — asserted by
> `targets/cloudflare/test/acceptance.secrets.mjs` (16 checks), which also pins
> reset-preserves-secrets, action-only grants, and no-key-material-on-any-
> surface.

## Motivation

**The install story is the product story.** Snapback's brief is that demos and
real apps should be trivial to run ([LLP 0000](./0000-snapback.explainer.md)
§Summary). For any app that talks to the outside world, the `.env.example`
ritual — find the right file, guess the variable names, hunt each vendor's
signup flow, restart, wonder why it still 401s — is the single worst step of
self-hosting. A backend that claims to be comprehensive and coherent (the Rails
comparison) should own this the way Rails owns credentials.

**The corpus already committed to the bottom half.**
[LLP 0009](./0009-code-execution-security.rfc.md) §Secrets defines the security
model: secrets are deployment-owned values, exposed as capability-gated handles,
never plain env vars in queries/mutations, with Valet's hard-won discipline
(secret-handle types, no read-back, never hash values into logs).
[LLP 0029](./0029-all-aboard-gap-closure.plan.md) §G4 names the missing store:
scoped keys, per-action grants, rotation pools, "env for local, a secret manager
for hosted." What no document designs is the **product layer**: declaration,
status, setup experience, and acquisition. That is this RFC.

**Agent-first cuts both ways.** The wizard is a human affordance, but the
first-class builder — and increasingly the first-class *operator* — is an agent
([LLP 0000](./0000-snapback.explainer.md) §Who Snapback is for). The core of
this design is therefore the machine-readable primitive (declared × set ×
verified), with the wizard as one projection of it. The same primitive is what
lets an agent notice a missing key, go sign up for one where that is possible,
set it, and verify it — reducing the human's role to the steps that are
genuinely theirs (payments, terms of service, email confirmation).

## Scope and non-goals

This is a **subsystem, not a secrets platform**. In scope: per-app deployment
configuration — API keys, provider credentials, and deployment-level settings —
declared by app source and provided by the operator or their agent.

Non-goals:

- **Not Vault.** No cross-app secret sharing, PKI, dynamic/leased credentials,
  or revocation machinery. One app's config is invisible to every other app
  ([LLP 0009](./0009-code-execution-security.rfc.md) §Isolation Model).
- **Not per-end-user credential storage.** A user OAuth-ing into their own
  external account is auth/app-data territory
  ([LLP 0011](./0011-auth-and-permissions.rfc.md)); this subsystem holds values
  owned by the *deployment*, not by its users.
- **Not encrypted-secrets-in-git.** Rails-style encrypted credentials files
  couple secrets to the source repo; Snapback secrets are per-deployment state
  and never belong in the repo or in generated bundles
  ([LLP 0009](./0009-code-execution-security.rfc.md) §Secrets).
- **Not a wallet.** Payment instruments for acquiring keys are never stored
  here; agent-driven acquisition (below) hands payment steps to a human.
- **Not an acquisition broker.** Snapback describes how to get each key in
  machine-readable form; it does not operate a marketplace or proxy vendor
  signups. General-purpose agents drive acquisition through the same public
  operations humans use.

## Decision register

Settled questions, each argued in its section below:

| # | Question | Decision |
|---|----------|----------|
| D1 | Local at-rest form | 0600 JSON file in the instance dir, **not** the app SQLite database; pluggable store seam for keychain/encrypted/hosted backends |
| D2 | Does config survive `app.reset`? | Yes — deployment-owned, not app data; explicit separate operation to wipe it |
| D3 | Wizard bootstrap auth | Inherit the LLP 0031 admin model — no secrets-specific auth fork; the recommended auto-mint landed (ENG-23443, LLP 0017 §Security Defaults): a served loopback instance without `SNAPBACK_ADMIN_TOKEN` mints a local admin token (persisted 0600, printed once, discoverable by same-user tooling), so config writes are never tokenless over HTTP |
| D4 | Can app code see config status? | Queries/mutations: only via a host-maintained status table through the normal commit path (v2); never via a host API that reads outside the snapshot. v1 floor: ops surfaces only |
| D5 | Secrets vs plain config | One declaration mechanism, `secret: true` by default; secret entries get handles in actions, non-secret entries get readable values |
| D6 | Agent acquisition | Structured acquisition metadata + the ordinary set/verify operations are the seam; a ladder of automation levels, with human commitments (terms, payment) named per entry and reserved for humans absent explicit delegation |
| D7 | Hosted write/apply semantics | Store backends are explicit classes, not target names; writes may be out-of-band of the running server (operator-side locus); `pending` is writer-computed, `applied` is attested via per-app config generations |
| D8 | Per-action scoping | Functions declare the entries they use (`uses`); undeclared access is denied at runtime and `uses` names are validated at manifest load — grants ship in v1, not later |
| D9 | Local file source vs durable store path | Two distinct seams: a read-only `.env`/JSON **source** seeds declared entries at startup (generalizing the deprecated `SNAPBACK_ACTION_SECRETS` blob to a file); an explicit **store path** (`--config-file`) makes the 0600 store durable independent of the database, so `--memory` instances keep config across restarts. Precedence: source < store < live write; pools need JSON, not `.env` |

## Design

### Declared configuration in the manifest

App source declares its configuration the way it declares cron jobs: in source,
carried into the generated function manifest, validated at manifest load
([LLP 0028](./0028-cron-scheduled-execution.rfc.md) establishes the pattern;
`crates/snapback/src/manifest.rs` carries `cronJobs` beside function definitions today).

Sketch of a declaration (authoring-surface syntax is
[LLP 0004](./0004-application-data-api.rfc.md)/[LLP 0020](./0020-core-authoring-surface.plan.md)
territory; the manifest fields are what this RFC pins):

```ts
config: {
  caltrainFeed: {
    description: "511.org Open Data API key",
    purpose: "Fetches the Caltrain GTFS-Realtime feed for live departures",
    secret: true,          // default true; explicit here for illustration
    required: true,        // default true
    pool: true,            // accepts 1..n values, rotated across requests
    probe: "verifyCaltrainKey",   // optional action that test-calls the API
    howToGet: "Request a free key at https://511.org/open-data/token. " +
      "The key arrives by email, typically within a day.",
    acquisition: {
      url: "https://511.org/open-data/token",
      kind: "email-delay",
      inputs: ["name", "email", "intended use"],
      cost: "free",
      humanCommitment: ["terms"],
    },
  },
  homeStation: {
    description: "Default station shown on first launch",
    secret: false,
    required: false,
    default: "22nd Street",
  },
},
```

Manifest fields per entry:

- `name` — addressable identifier; the unit of granting, setting, auditing.
- `description` / `purpose` — what it is and why this app needs it. These are
  what the wizard renders; they live in source and are public by construction.
- `secret` — default **true** (D5). Non-secret entries opt out explicitly, so
  misclassification fails safe: forgetting the flag makes a value *more*
  protected, never less.
- `required` — default true. The server starts with required entries missing
  (an unconfigured server must be able to serve the setup surface) but reports
  degraded status, and actions that request a missing entry fail with a
  machine-readable `CONFIG_MISSING` diagnostic naming the entry.
- `pool` — the entry holds an ordered set of values rotated across requests
  (the All Aboard key-pool case, absorbing
  [LLP 0029](./0029-all-aboard-gap-closure.plan.md) §G4).
- `probe` — the name of a declared action that exercises the value with a
  cheap authenticated call and returns ok/not-ok plus a diagnostic. Manifest
  load rejects a probe naming a non-existent action or a non-action function,
  the same way cron target validation works. Probes are ordinary actions, so
  they run under the same gated egress as everything else
  ([LLP 0029](./0029-all-aboard-gap-closure.plan.md) §G3) — verification gets
  no special network powers.
- `howToGet` — human prose rendered in the wizard.
- `acquisition` — the structured, agent-readable version of `howToGet`
  (§Agent-driven acquisition), including `humanCommitment`: the commitment
  kinds only a human may make for this entry (`terms`, `payment`), which
  agents may pass only under prior delegation naming them.
- `default` — non-secret entries only. A secret with a default is a contradiction.

**Functions declare what they use (D8).** Declaring an entry makes it *exist*;
only functions that name it *receive* it:

```ts
export const refreshFeed = action({
  uses: ["caltrainFeed"],
  handler: async (ctx) => { /* ctx.secrets.rotating("caltrainFeed") */ },
});
```

Manifest load validates every `uses` name against the declared entries (a
probe is implicitly granted the entry it verifies); at runtime,
`ctx.secrets.get()` on an entry the function did not declare fails with
`CONFIG_UNDECLARED` — distinct from `CONFIG_MISSING`, which means "declared
and granted, but no value set." This is the per-action scoping
[LLP 0029](./0029-all-aboard-gap-closure.plan.md) §G4 promised, and it is
what lets diagnostics and the admin surface answer "which functions can see
this key" — the legibility the Design-Mode test below depends on. Without
grants, the subsystem would close G4's storage half and silently drop its
scoping half.

Declared names, descriptions, and acquisition metadata are app source: public,
versioned, reviewed. Values never are.

### The store and the target seam (D1, D2, D7)

**Per-app addressing.** The store is addressed `(logical app, entry name)`.
Local v0 is one logical app per instance
([LLP 0018](./0018-app-instance-boundaries.rfc.md)), so this is trivially flat
today, but the addressing is pinned now because "one app cannot observe another
app's code, data, secrets" is already an isolation invariant
([LLP 0009](./0009-code-execution-security.rfc.md) §Isolation Model) and
retrofitting scoping into a flat store is exactly how G4's process-wide blob
happened.

**Local baseline: a 0600 file in the instance directory** — e.g.
`.snapback/config.json` beside the default `.snapback/dev.sqlite3`
(`crates/snapback/src/cli.rs`). Values plus minimal metadata (set-at timestamp, source, verified
state); file mode 0600; owned by the store seam, never read by app code.
Existing files are opened no-follow, must be regular and owned by the effective
service identity, and are repaired to owner-only mode before any value is read;
the config store's atomic replacement writes its same-directory temporary file
through the same owner-only helper before rename. Hosts without an implemented
owner/ACL validation backend fail closed for persistent store I/O; Windows is
in that state today rather than relying on an unknown inherited ACL (ENG-24346)
directly.

The on-disk format version is also a read/write compatibility boundary, not
advisory metadata. Only the exactly supported version may expose values or be
mutated. Older, newer, or otherwise unsupported versions return
`SNAPBACK_CONFIG_STORE_VERSION_UNSUPPORTED` and preserve the original bytes;
changing them requires an explicit migration. `[confirmed — Charlie Cheever /
Codex, 2026-07-12, ENG-24492]`

Alternatives considered:

- **In the app SQLite database.** Rejected. The app database is exported,
  dumped, copied, and reset freely by design — the root brief promises "export
  it freely" for app data, the admin console explores it, acceptance loops
  reset/seed it constantly
  ([LLP 0010](./0010-agent-dx-and-acceptance.spec.md)), and a database file
  shared for debugging must not carry live keys.
  [LLP 0009](./0009-code-execution-security.rfc.md) §Secrets already bans
  copying secrets into generated bundles; a database file is the same class of
  artifact. It would also entangle deployment state with the SQLite↔Postgres
  portability contract ([LLP 0007](./0007-storage-portability.spec.md)) for no
  benefit.
- **OS keychain (macOS Keychain, libsecret).** Rejected *as the default*:
  headless Linux servers and CI have no keychain or an awkward one, keychain
  prompts are hostile to agent-driven loops, and instance data stops being a
  directory you can move. Accepted as a *future optional backend* behind the
  store seam for operators who want it.
- **Encrypted file with a master key.** Rejected as the default because of
  master-key recursion: a key on the same disk beside the ciphertext is
  security theater, a keychain-held key inherits the keychain problems, and a
  human-memorized passphrase reintroduces a human in every loop. The honest
  statement — in the spirit of
  [LLP 0009](./0009-code-execution-security.rfc.md)'s "defense-in-depth, not a
  guarantee" — is that the local at-rest boundary **is the OS user boundary**
  (file permissions), exactly as it is for `.env` files and for the SQLite
  database itself, and we say so rather than decorating it. An
  encrypted-file backend stays possible behind the seam for operators with
  real external key custody.

**Config survives `app.reset` (D2).** Reset clears *app state*
([LLP 0024](./0024-agent-operating-surface.spec.md) `app.reset`); configuration
is deployment state. The demo and acceptance workflow resets constantly, and
re-entering the Caltrain keys after every reset would be install-story poison.
Wiping configuration is its own explicit operation (`config.unset` per entry;
a full-wipe flag can ride on reset for "factory reset" flows but is never the
default).

**Hosted targets: backend classes, not target names (D7).** "AWS" or
"Kubernetes" does not have one secret behavior — the same platform offers
several, and pretending otherwise is how a seam grows incompatible
implementations (the GPT-5 review pressed this and is right). The seam is
therefore a set of **backend classes**, and targets map onto them:

- `local-file-immediate` — the 0600 instance-dir file; in-server writes;
  applied immediately on atomic replace.
- `runtime-secret-manager-fetch` — AWS Secrets Manager or SSM Parameter
  Store, GCP Secret Manager, Azure Key Vault, read at runtime under the
  platform's ambient identity (instance/task IAM role); writes in-server or
  operator-side; applied on next read within a bounded cache TTL.
- `env-injected-restart` — 12-factor env injection: ECS/Fargate task env,
  Fly.io and Railway secret vars, plain containers; writes go to the platform
  out-of-band; applied on restart/redeploy.
- `projected-secret-eventual` — Kubernetes Secret objects projected as
  volumes; the kubelet refreshes them eventually; env-var-sourced K8s secrets
  are `env-injected-restart` instead.
- `deploy-time-binding` — Cloudflare Workers secrets/bindings; writes go
  through a deploy controller (`wrangler`, dashboard, or the Cloudflare API);
  applied when the new version activates.
- `external-resolver` (v2+) — an operator-owned resolver (1Password CLI,
  `pass`, Doppler, Vault) plugged behind the seam; bring one, don't become
  one.

| Target | Backend class | Writes go to | Runtime reads | Applied when |
|--------|--------------|--------------|---------------|--------------|
| Local dev; own VM/Hetzner/DO, one process | local-file-immediate | in-server ops → file | store seam, per invocation | immediately |
| EC2/ECS/GCP/Azure with runtime fetch | runtime-secret-manager-fetch | platform secret API (in-server or operator-side) | fetch + bounded cache | cache refresh |
| ECS task env; Fly.io; Railway; containers | env-injected-restart | platform CLI/API, out-of-band | process env at start | restart/redeploy |
| Kubernetes | env-injected-restart or projected-secret-eventual | Secret object via kubectl/controller | env at start, or projected file | rollout / kubelet sync |
| Cloudflare Workers | deploy-time-binding | deploy controller — never the Worker itself | bindings | version activation |

On AWS, SSM Parameter Store's standard tier is the scale-to-zero default
(no per-secret monthly cost) and Secrets Manager is the opt-up for operators
already invested in it — its managed-rotation machinery is not what Snapback's
pool rotation needs. Per-target mechanics and pricing above are stated as of
drafting and need verification in each target's strategy LLP as those are
written; Cloudflare's is [LLP 0014](./0014-cloudflare-strategy.rfc.md);
`[inferred]` for the rest until then.

**Write locus.** On several classes the running server *cannot write its own
store* — a Worker cannot mutate its own bindings; a container cannot rewrite
its injected env. `config.set` therefore has two homes with one contract:
**in-server** (file, runtime secret-manager writes) and **operator-side** (the
CLI driving the platform API from the operator's environment, where the
`wrangler`/cloud credentials live). Same operation id, same envelope; only the
locus differs. The wizard accepts value writes only where an in-server write
path exists; elsewhere it degrades honestly to **guided mode** — live status
plus the exact platform command to run ("`wrangler secret put CALTRAIN_FEED`"),
confirming completion via status once the value appears. It never pretends a
write path exists where one does not.

**Meta-secrets rule.** The credentials that authorize store writes (a
Cloudflare API token, AWS credentials, a kubeconfig) are the *operator's
ambient identity* and are never stored in the Snapback store — no recursion.
On AWS-class targets the bootstrap is the instance/task IAM role, no stored
credential at all, which is precisely why "use the platform facility" beats
inventing our own.

**Config generations make `applied` concrete.** Every applied change
increments a per-app **config generation**. The running server reports its
serving generation (plus the declaration hash) through gated inspect/status;
a write's envelope carries the generation it produced. `pending` is computed
by the **writer** — it knows it staged generation N and the platform has not
activated it; the running instance cannot see a staged Workers secret, and
in-server status never claims more than the instance can observe. `applied`
is **attested**: the writer (CLI, deploy controller) observes the runtime
report generation ≥ N — on multi-replica targets, enough replicas reporting
it. Without this, "did my set take effect?" has no honest answer on half the
matrix.

**Transit rule.** Value-carrying writes (`config.set`) are accepted only over
loopback or TLS; a non-loopback plaintext bind refuses them with a diagnostic
naming this rule. An SSH tunnel — loopback at the server — is the blessed
no-TLS path for VMs. Status reads carry no values and follow the ordinary
admin posture.

**Multi-replica limit.** The file backend is **single-instance by contract**:
one process, atomic replace (write-temp-then-rename), advisory lock; it
refuses to serve a fleet rather than letting replicas silently diverge.
Multi-replica deployments use the runtime-fetch or injection classes, with
generation reporting giving rollout visibility. This matches the local core's
single-writer shape ([LLP 0003](./0003-local-code-hosting-and-storage-core.rfc.md))
rather than fighting it.

**Portability, backup, and graduation.** The store is a **working copy, never
the system of record** for values — the vendor dashboard or the operator's
password manager is. Stated consequences, so nobody discovers them later:

- App-data exports never carry values. Declarations travel with source.
  Verification state does not survive migration — it attests that *this
  deployment's* values work, so the new target re-verifies.
- Instance-dir backups include `config.json`: restores come back configured,
  and backups therefore carry live keys. Operators who want secretless
  backups exclude the file and re-provision on restore; both postures are
  legitimate, and the docs say so rather than choosing silently.
- Local → hosted graduation **re-prompts for values**: no read-back means
  Snapback cannot export them, by design. The declaration, acquisition
  metadata, and wizard/CLI are what make re-provisioning cheap. This is a
  designed consequence of D1's no-read-back inheritance, not an oversight.

### External file source and durable store path (D9)

The local baseline derives the store's path from the database file (§The store
and the target seam): `.snapback/dev.sqlite3` → `.snapback/dev.sqlite3.config.json`.
Two consequences D1 did not address follow. First, an **in-memory** instance
(`--memory`, [LLP 0002](./0002-canonical-local-target.decision.md)) has no
database file, so its store is memory-only and its configuration evaporates on
stop — correct for a throwaway instance, a surprise for an operator who
configured keys through the wizard and restarted. Second, nothing lets two
instances, or two successive `--memory` runs, share one set of values. The v1
slice shipped only the deprecated `SNAPBACK_ACTION_SECRETS` env-blob import
(§Motivation); the general "`.env`-style input as a source" that item 2 of the
v1 order and [LLP 0009](./0009-code-execution-security.rfc.md) §Secrets both
name was never built as a file. D9 specifies both, and separates the two things
"a file for secrets" conflates:

- A **source** is read-only input the *operator* owns: a `.env` or JSON file
  Snapback reads at startup to seed declared entries and never writes back. The
  store stays authoritative; the source only fills entries the store leaves
  unset.
- A **store path** is read-write persistence Snapback *owns*: the versioned
  0600 JSON store (§The store and the target seam), at a path decoupled from
  the database so it survives independently. This is what carries wizard edits
  between `--memory` runs.

They are not interchangeable, and the format forces the split: a hand-authored
`.env`/plain-JSON file carries no set-at, source, verified, or pool-cursor
metadata, so it can *seed* the model but cannot *be* the store without silently
dropping that state on the first write. `.env`/JSON is a source; the store
keeps its own format.

**Store path override.** A `--config-file <path>` flag sets the store's path
explicitly, independent of `--memory` and `--db`.
`snapback start --memory --config-file .snapback/secrets.json` gives an ephemeral
database with a durable secrets store: `config.set`/wizard writes round-trip to
the file, verification state persists, and the next run reads them back.
Mechanically this is small — the store is already a separate sibling file, so
D9 makes its path a first-class input rather than a mechanical derivative of
`--db`. Under this flag the store keeps every existing invariant unchanged:
0600 mode, atomic replace (write-temp-then-rename), the single-instance
advisory lock (§Multi-replica limit), the versioned format, and verification
reset on any value change.

**File source.** A `--config-source <path>` seeds declared entries at startup,
generalizing the env-blob import from an env var to a file (and whether a
conventional `.env` in the instance dir is auto-loaded is an open question
below). It obeys the env-blob's rules unchanged: **only declared names are
imported**, everything else is reported `ignored` — a stray `.env` var never
silently becomes a secret — and each import is recorded `source: file-import`
so `config.status` stays honest about provenance. This is the near-term down
payment on the v2+ `external-resolver` backend class (§The store and the target
seam): the simplest member of that family, a flat file rather than 1Password or
Vault.

**Precedence.** When more than one populates an entry, later-and-more-
authoritative wins: **file source (seed) < persisted store < live `config.set`**.
A seed fills an unset entry; a value already in the store (something the
operator set) is not overwritten by a seed on the next boot; an explicit write
beats both. This is the ordinary `.env` < real-secret-manager layering, stated
so it is not emergent.

**Pools.** A `.env` file cannot express an ordered pool of *n* values under one
name without an ad-hoc convention, and the driving case is a pool (the All
Aboard 511.org key pool,
[LLP 0027](./0027-all-aboard-caltrain-demo.plan.md), absorbing
[LLP 0029](./0029-all-aboard-gap-closure.plan.md) §G4). So the rule is
explicit: **`.env` sources set single-value entries only; pools require JSON**
(an array per entry) or the store. Flat-file convenience never quietly
amputates rotation.

**What it must not become.** The point of this subsystem was to replace
`SNAPBACK_ACTION_SECRETS`'s flat process-wide blob with a declared, scoped,
pooled, verified model (§Motivation). A file source *feeds* that model — values
map to declared entries, cross the handler edge as handles, and stay scoped by
`uses` (D8) — it is not a bypass back to "a bag of env vars." No-read-back is
unchanged: values arriving from a file are still never readable through admin
or any op ([LLP 0009](./0009-code-execution-security.rfc.md) §Secrets); the
file feeds the store, and the store feeds only the runtime grant path.

Alternatives considered:

- **Make `--memory` config persistent by default** (auto-write a
  `.snapback/config.json` even with no database file). Rejected: an ephemeral
  database with durable secrets is a surprising split, and `--memory` means
  "throwaway instance." Persistence should be opt-in via `--config-file`, not a
  default that contradicts the flag the operator chose. The admin surface
  already reports storage mode ([LLP 0017](./0017-admin-console-inspection-surface.rfc.md));
  the wizard additionally warning "in-memory — configuration will not persist"
  is the honest floor when neither flag is set.
- **Store secrets in the in-memory database** so they share the instance's
  lifecycle. Rejected already by D1 — the database is exported, dumped, and
  reset freely and must not carry keys; an in-memory database is the same class
  of artifact and inherits the same objection.
- **Use the `.env`/JSON file as the read-write store** (write edits back into
  it). Rejected: plain `.env`/JSON has nowhere to record set-at, source,
  verified, and pool cursors, so admin writes would drop that metadata. A
  source stays read-only and the store keeps its versioned format; an operator
  who wants durable edits uses `--config-file`, one who wants an authoritative
  hand-maintained file treats it as a source and re-seeds.

**Security posture.** The store Snapback writes stays 0600. A source the
operator owns is outside Snapback's control, so Snapback **warns** (does not
fail) when a source file is group- or world-readable, and the docs carry the
same gitignore caution D1's `config.json` already earns — a source with live
keys committed to the repo is the classic footgun
([LLP 0009](./0009-code-execution-security.rfc.md) §Secrets bans secrets in the
repo and generated bundles). The transit rule (§The store and the target seam)
does not apply: these are local files, not a value-carrying request over the
wire.

### Runtime exposure (D5, D8)

**Secret entries: handles, actions only.** Actions receive `ctx.secrets`:
`ctx.secrets.get('name')` returns a secret handle; `ctx.secrets.rotating('name')`
returns the next pool member for pooled entries (round-robin per invocation;
per-member health/cooldown is an open question below). Both are gated by the
function's `uses` grant (D8): an undeclared entry is `CONFIG_UNDECLARED`.
Queries and mutations get no handles — unchanged from
[LLP 0009](./0009-code-execution-security.rfc.md) §Secrets, which also supplies
the non-negotiables this RFC inherits wholesale: secret-handle/`SecretString`
types at every host edge, log and diagnostic redaction, **no read-back API**
(list operations return names and status, never values), never hash a secret
value into an audit record, and honesty that a handler legitimately holding a
secret can exfiltrate it — this is defense-in-depth.

**The handle is a real type, not a convention.** Today's v0 injects a plain
JSON object as `ctx.secrets` (`crates/snapback/src/runtime.rs`) — exactly the shape Valet
shipped as a regression and fixed. The v1 handle is opaque: `toString()`,
`toJSON()`, template-literal coercion, and console inspection all yield a
redacted marker, never the value. The paved path never materializes the
string in app code at all — host APIs accept handles directly, e.g.
`fetch(url, { headers: { Authorization: key.asBearer() } })`-style helpers
that unwrap only at the host fetch boundary and redact the value from error
text and diagnostics. `key.expose()` exists as the explicit escape hatch for
vendor SDK shapes the helpers cannot cover: greppable in review, counted (not
valued) in diagnostics. Acceptance below includes the negative tests — an
accidental `JSON.stringify(ctx.secrets.get(...))`, a thrown error carrying a
header, a `console.log` of the handle — all must yield redaction, proven by
tests rather than asserted.

Detached actions snapshot a redactor from the same staging-time values used to
build their grant. Every error is scrubbed at the invocation boundary before a
public action envelope or cron/config retention sink can observe it. This is
deliberately separate from scrubbing against the current store: config may be
rotated or unset while native action work is in flight, and the old value must
remain redactable without being retained in a diagnostic (ENG-24560).
The same staged snapshot is installed on the synchronous runtime observation
boundary: `runtime.log` recursively scrubs authored string leaves before the
8 KiB telemetry allocator and before optional
`SNAPBACK_HANDLER_CONSOLE=stderr` echo, and host-call trace arguments are
scrubbed before retention so a `host.fetch` authorization header cannot become
trace evidence. Successful action return values are not diagnostic sinks and
remain unredacted in the local profile; callers must not treat this
defense-in-depth redactor as an exfiltration boundary.

The Cloudflare host-fetch scrub treats reversible encoding as a language, not
a short list of strings: each UTF-16 unit may be raw, a short JSON escape, or
one-or-more JSON-wrapping backslashes followed by a case-insensitive `uXXXX`.
The matcher spans the whole normalized secret, so full and partially escaped
BMP/astral values are removed without broad prefix redaction; URL/form and
double-URL encodings remain covered separately.

**Non-secret entries: readable values.** Actions read them via `ctx.config`.
Queries and mutations do *not* get a `ctx.config` host API — they see
configuration only through the status/config table below, so their reads stay
inside the database snapshot.

**Egress coupling.** Keys are usually used against specific hosts. The
declaration may optionally name intended hosts for diagnostics ("caltrainFeed
is used against `api.511.org`"), but enforcement belongs to the egress
allowlist seam ([LLP 0029](./0029-all-aboard-gap-closure.plan.md) §G3,
[LLP 0009](./0009-code-execution-security.rfc.md) §Runtime Boundary), not to
this subsystem.

### Status model and app visibility (D4)

The subsystem's primitive is one machine-readable answer per entry, built
from three orthogonal axes plus one overlay — names and states only, never
values; everything else projects from this:

- **value:** `unset → set` (per pool member for pooled entries);
- **verification:** `unverified → verified(at) | failed(diagnostic)`; every
  set/unset transition changes an opaque value revision and resets it to
  `unverified`, and it never survives migration to a new deployment (it
  attests *this* deployment's exact value identity);
- **application:** `applied(generation) | pending(staged generation)` —
  writer-computed and attested per §Config generations; on
  `local-file-immediate` this axis is trivially `applied`;
- **acquisition overlay (v2+):** `awaiting-human(reason)`,
  `reason ∈ {email-confirmation, payment, terms, captcha, other}` — present
  only while an assisted acquisition is in flight.

**Can app code see it?** An app wants to render "this deployment isn't
configured yet" — and ideally have that screen dismiss itself the moment the
operator pastes a key into the wizard. Options:

- **A host API in queries (`ctx.secrets.has('name')`).** Rejected, and not
  merely on taste: query results must be a function of the database snapshot,
  because commits validate against captured read sets
  ([LLP 0003](./0003-local-code-hosting-and-storage-core.rfc.md) §Execution
  and Write Semantics). A query reading config status reads *outside* the
  snapshot: its result can be stale-forever (nothing invalidates it when
  status changes) and its read is invisible to validation. This is the same
  class of hole the corpus closed elsewhere; not worth reopening for a
  boolean.
- **App polls an action.** Works today with zero new machinery, but it is
  boilerplate, race-prone, and not reactive — the setup screen lingers until
  the next poll.
- **A host-maintained status table (chosen, v2).** When an entry's status
  changes, the host writes the row (name, required, secret, set, verified-at,
  pending — no values) through the **normal commit path** into a reserved
  table (e.g. `_snapback_config_status`). Live queries over it invalidate and
  update like any other data; read-set validation sees the reads; the setup
  screen dismisses itself in realtime, which is also a good demo moment.
  Cost: reserved host-owned tables need blessing from
  [LLP 0004](./0004-application-data-api.rfc.md)/[LLP 0007](./0007-storage-portability.spec.md)
  (named as a coordination item below). Non-secret entry *values* ride the
  same mechanism (a config-values row set), which is what makes D5's split
  coherent for queries — with one fence stated now: non-secret values are
  **deployment state cached as rows**, the store stays the source of truth,
  and whether the mirrored tables participate in export, sync, and default
  authorization is explicitly part of that LLP 0004/0007 coordination, so
  deployment config does not leak into app backups by accident.
- **v1 floor.** Until the table lands, status is available on the ops
  surfaces only, and apps that want an in-app setup state poll an action.

**Who may see status?** The status table is not synced to clients by default;
exposing it is the app author's authorization decision like any other table.
Names and purposes are already public in source; set/unset is mild
reconnaissance ("which integrations are live"), which is why default-off is
the right posture even though the local single-operator case would tolerate
default-on.

### Operations and projections (LLP 0024)

One host-ops core, projected — the wizard is not a second implementation
([LLP 0024](./0024-agent-operating-surface.spec.md): same operations, same
envelope, every transport):

| Operation id | Purpose | Envelope facts |
|--------------|---------|----------------|
| `config.status` | the full state machine per entry, plus serving generation and declaration hash | names, states, generations, diagnostics; never values |
| `config.plan` | dry-run a set: which write locus, what credentials it needs, the apply boundary, what would go `pending` | plan facts; no write occurs |
| `config.set` | set an entry (or add a pool member) | `applied \| pending`, produced generation, value_changed |
| `config.unset` | remove an entry value (or pool member) | resulting state, produced generation |
| `config.verify` | run the entry's probe action | ok/not-ok + probe diagnostic |

`config.plan` is nearly free on `local-file-immediate` and earns its keep on
hosted targets, where "can this apply now, and with whose credentials?" is
exactly what an agent must know before acting.

**Cloudflare controller as built (ENG-24499 / ENG-24501, 2026-07-12).** The
guided writer fails before reading secret stdin unless the Wrangler package
installed under the repository root matches the exact version in the committed
Cloudflare pin and root lock; no installer or ambient executable participates.
One overall deadline bounds the authenticated initial status request, the
Wrangler child, retry sleeps, and every attestation request. A timed-out initial
read reports `SNAPBACK_CONFIG_STATUS_UNKNOWN` with no write attempted. A killed
child or unattested activation reports `SNAPBACK_CONFIG_APPLY_PENDING` and
directs the operator to inspect status before retrying, because remote
activation may have preceded the local timeout.

CLI verbs `snapback config status|plan|set|unset|verify` (value via `--stdin`
or prompt, never argv, which leaks into shell history and process lists);
control-plane MCP tools `snapback_config_*` mapping 1:1. These projections
land with the LLP 0024 surface (LLP 0032 P6); until then the gated HTTP twins
under `/_snapback/api/config/*` are the only transport, which is enough for
the wizard and for the admin console's Secrets surface (LLP 0017).

**Audit discipline** (inherited from
[LLP 0009](./0009-code-execution-security.rfc.md) §Secrets, extended one
field): every write logs `{who, when, entry, value_changed, source}` where
`source ∈ {wizard, cli, mcp, http, agent}` — no values, no value hashes.

**Probe rules.** Probes run only on explicit `config.verify` — never at
startup, never implicitly on set (an opt-in `--verify` flag on set is the one
exception), never in CI unless invoked. A probe is also a quota-burn tool
pointed at a vendor, so the host enforces a per-entry cooldown and a hard
timeout; pooled entries verify the member being added, not the whole pool.
Probes execute as ordinary actions — same egress allowlist, same grant, no
special network powers — and their results land in verification state and
diagnostics, never in logs as raw responses (a vendor error body can echo the
key that was sent).
The host stages the entry's opaque revision with the detached probe and records
the result only through a compare-and-set against that revision. A concurrent
set, unset, or delete-and-recreate discards the stale outcome with a stable
conflict diagnostic, even when the replacement has identical bytes; no value or
value hash is retained for this check (ENG-24563).

**Route placement** ([LLP 0031](./0031-server-route-taxonomy.spec.md)): the
API routes are `system-api` entries with `admin-write` (set/unset/verify) and
`admin-read` (status) policy in the declared route registry; the wizard page
is `system-static` console shell under `/_snapback/admin*`. The enforcement
test extends automatically because the registry is the single source.

### The setup wizard (D3)

A page in the admin console shell — `/_snapback/admin/setup` — rendered
entirely from manifest declarations plus `config.status`:

- **First run:** server startup already prints admin posture lines
  (`crates/snapback/src/cli.rs`); it additionally prints
  `config: 2 required entries missing → http://127.0.0.1:<port>/_snapback/admin/setup`
  when applicable. That printed line *is* the install instruction for the
  open-source case; the README step is "start it and open the link."
- **Pre-provision:** with inspect-first boot no manifest has loaded until the
  app page is opened once, so a fresh instance's `config.status` has no
  entries. The status payload carries `appProvisioned` so the wizard can say
  "no app has booted on this instance yet — open the app page once, then
  reload" instead of rendering an empty page, and can distinguish that from a
  provisioned app that genuinely declares no configuration (ENG-22752).
- **Per entry, one card:** description, purpose, `howToGet` prose with the
  acquisition link, a paste field (pooled entries get "add another key"), a
  **Verify** button that runs `config.verify`, and the resulting state. A
  `CONFIG_MISSING` diagnostic from a failing action deep-links to the card.
- **After set:** the card shows set/unset, last-changed, verified state —
  never the value, not even masked (no read-back exists to power it). Editing
  is replace-only.
- **Done state:** all required entries set (and verified where probes exist);
  the page says so and links to the app. Because "done" is defined by required
  entries only, every card is labeled `required` or `optional`, an unset
  optional entry renders as a neutral fact rather than a warning, and the
  ready banner names how many optional entries remain unset ("the app runs
  without them") — otherwise the banner and the cards contradict each other
  (ENG-22581: All Aboard's optional `caltrainFeed` read as "paste a key" next
  to "the app is ready").
- **On out-of-band targets** (§Write locus): the same page, but cards accept
  no values — each shows live status plus the exact platform command or
  dashboard step, and flips green when the applied value is observed. Guided
  mode is a first-class mode, not a failure.

**Bootstrap authorization.** How does a fresh `git clone` operator get write
access to `/_snapback/api/config/*`? Decision: **inherit the LLP 0031 admin
model unchanged** — since ENG-23443 that is: an explicit `SNAPBACK_ADMIN_TOKEN`
gates writes when set; without one, a served loopback instance **auto-mints** a
local admin token (persisted 0600 next to the database or ready file, printed
on the minting start, discoverable via a trusted local readiness descriptor's
mechanically-derived `adminTokenFile`; inspect's `admin.tokenFile` is status
metadata and is never followed by `--url` tooling (ENG-24338)); admin stays disabled
entirely on a non-loopback bind without a token (`crates/snapback/src/admin.rs`). Rationale:
`config.set` is
not a new authority class — the same lane already exposes `app.reset`, which is
*more* destructive — and a subsystem-private auth scheme would fork the admin
model and dodge the 0031 registry. Alternatives considered:

- **Auto-minted persistent token** (generated at first start, stored 0600 in
  the instance dir, printed once): strictly safer on shared/multi-user
  machines, where loopback-open means any local user's process holds admin.
  Right direction, wrong scope — it should harden the *whole* admin surface,
  so this RFC recommended it to
  [LLP 0031](./0031-server-route-taxonomy.spec.md)/[LLP 0017](./0017-admin-console-inspection-surface.rfc.md)
  as a change that should land **with or before the wizard** rather than
  special-casing config. The GPT-5 review pushed here, and the push was fair:
  `config.set` is less destructive than `app.reset` but more *sensitive* — it
  captures live provider credentials. **This landed as ENG-23443** (LLP 0017
  §Security Defaults): the serve path now always resolves an admin token on
  loopback, so the interim loopback-open single-user-machine posture is
  retired for served instances. The wizard needed no changes, as predicted:
  agents read the token file (filesystem access *is* local admin, honestly
  stated), humans paste the token the minting start printed.
- **Require a manually-set token before the wizard works:** fails the
  install story on step one; rejected.
- **Token embedded in the printed URL:** rejected — query strings land in
  logs, browser history, and referrer-adjacent surfaces. If a token is set,
  the wizard prompts for it exactly as the rest of the console does.

### Agent-driven acquisition (D6)

The wizard serves humans; the same flow should shrink toward zero humans as
vendors permit. The `acquisition` block is the seam — structured enough that
an agent can *plan* acquisition, not just render prose:

- `url` — where acquisition starts.
- `kind` — `instant` (self-serve, key issued in-flow) | `form` (form, issued
  in-flow) | `email-delay` (issued out-of-band later; the 511.org case) |
  `oauth-client` (register an app, obtain client id/secret) | `paid`
  (payment required) | `manual` (no automatable path known).
- `inputs` — what the vendor asks for (name, email, use description, org).
- `cost`, `latency` — human-honest hints ("free", "arrives within a day").
- `humanCommitment` — the commitment kinds only a human may make for this
  entry (`terms`, `payment`); absent means none beyond filling in a form.

**The automation ladder.** Each level uses the same store, ops, and audit —
nothing about the platform changes between levels, only who drives:

- **L0 — guided human** (v1): the wizard renders the metadata; the human does
  everything. This is the baseline and always remains available.
- **L1 — agent-assisted (v2+):** an agent (Design Mode session, CLI agent)
  opens the acquisition URL, prefills what it can, and hands the human
  exactly the blocking step. The ops surface represents this as the per-entry
  `awaiting-human: <reason>` overlay (§Status model), so "what do you need
  from me?" has a machine-readable answer and the human is interrupted once,
  with the right ask, instead of owning the whole flow. In v1 the
  `acquisition` block ships as **passive metadata only** — rendered by the
  wizard, readable by any agent — which already enables L2 behavior from
  capable agents without Snapback tracking the flow.
- **L2 — agent-acquired:** for `instant`/`form` kinds, an agent with browsing
  (and, where delegated, email access for `email-delay`) completes signup
  itself, then calls `config.set` and `config.verify`. The human's
  involvement collapses to the up-front delegation.
- **L3 — programmatic issuance:** where vendors offer key-provisioning APIs,
  acquisition is a plain API call. Nothing extra is needed from Snapback —
  which is the point: the seam is metadata plus the ordinary ops, not an
  acquisition engine.

**Trust rules for L1+:** the declaration's `humanCommitment` field names the
commitments only a human may make for that entry (`terms`, `payment`); an
agent may proceed past a named commitment only under prior delegation that
names it — per commitment kind and entry, never blanket, never inferred from
silence. Payment instruments are never stored in this subsystem; keys an
agent acquires follow the identical no-read-back handling (the agent that
acquired a key does not need to read it back — it set it); audit records
`source: agent` plus the acquiring agent's identity. Vendor anti-bot measures
are respected, not circumvented: a CAPTCHA is an `awaiting-human` reason,
definitionally.

This is deliberately most of the answer rather than a grand mechanism: the
declaration makes needs legible, the ops make fulfillment drivable, probes
make success checkable — a general agent supplies the rest.

### The Design-Mode test

Walking the root doc's litmus test ([LLP 0000](./0000-snapback.explainer.md)
§Who Snapback is for): a builder types "show real Caltrain departure times"
into a segment. The agent adds the fetch action *and* the `caltrainFeed`
declaration; `config.status` immediately reports a required entry missing;
Design Mode surfaces the card ("this needs a free 511.org key — want me to
request one? A confirmation will hit your email"); agent or human acquires;
`config.verify` goes green; the feature lights up. Every arrow in that chain
is a documented operation with a machine-readable result — the mapping is
legible to the agent at each step, which is what the test demands.

### Relationship to other subsystems

- **Notifications** ([LLP 0000](./0000-snapback.explainer.md) §Notifications)
  and the **v2 AI/data gateways** configure their provider keys through this
  subsystem; they are consumers, not parallel mechanisms.
- **Auth** ([LLP 0011](./0011-auth-and-permissions.rfc.md)): external auth
  *provider* credentials (OAuth client secrets, WorkOS/Clerk API keys) are
  deployment config and live here; user sessions, tokens, and per-user linked
  accounts stay in auth's own storage.
- **All Aboard** ([LLP 0027](./0027-all-aboard-caltrain-demo.plan.md),
  [LLP 0029](./0029-all-aboard-gap-closure.plan.md)): the driving demo.
  Migrating it off `SNAPBACK_ACTION_SECRETS` onto declared entries closes G4
  and unblocks G5's live-feed half; its acceptance id
  `action_secrets_keypool` should be satisfiable by the v1 slice.

## Implementation order

**v1 slice** (useful without LLP 0024's surface):

1. Manifest `config` section — secret entries only, with `pool`, `probe`,
   `howToGet`, `acquisition`, and per-function `uses` grants (D8); load-time
   validation of grants and probes.
2. File store at `.snapback/config.json` (0600, atomic replace, advisory
   lock, single-instance contract), per-app addressing, reset survival;
   one-time import from `SNAPBACK_ACTION_SECRETS` and `.env`-style input as a
   *source* (allowed by
   [LLP 0009](./0009-code-execution-security.rfc.md) §Secrets), after which
   the env blob is deprecated.
3. The opaque handle type (redacted coercion, host-boundary helpers,
   `expose()`), `ctx.secrets.get/rotating` backed by the store,
   `CONFIG_MISSING` / `CONFIG_UNDECLARED` diagnostics.
4. Gated HTTP ops under `/_snapback/api/config/*` (`status`, `plan`, `set`,
   `unset`, `verify`) + registry entries, the transit rule, and the per-app
   config generation counter (trivial locally, but it pins the contract the
   hosted targets need).
5. The setup wizard page rendering declarations + status, with per-entry
   Verify and the D3 posture banner.
6. All Aboard migrated; G4 closed — storage *and* scoping halves.

**Near-term (D9), design-complete, not yet built:** the durable store-path
override (`--config-file`, decoupling the store from `--db`/`--memory`) and the
general `.env`/JSON file *source* (`--config-source`, generalizing the shipped
`SNAPBACK_ACTION_SECRETS` env-blob import), with the source < store < live-write
precedence, the `.env`-single-value / JSON-pool rule, `source: file-import`
provenance, and the group/world-readable-source warning. Small in surface: the
store is already a separate sibling file, so this makes its path an explicit
input and adds a read-only seed path that reuses the existing declared-names-
only import. Pairs with the wizard/console "in-memory — will not persist"
warning noted in D9's alternatives.

**v2+:** non-secret entries and the host-maintained status/config tables
(after the LLP 0004/0007 reserved-table coordination); CLI and MCP
projections (with LLP 0032 P6); hosted store backends by class per target
strategy (Cloudflare first, [LLP 0014](./0014-cloudflare-strategy.rfc.md)),
operator-side write locus, and attested apply via generation reporting;
environment scopes and fake/recorded provider profiles for CI and preview
(All Aboard's recorded feed is the existing precedent); the `awaiting-human`
acquisition overlay (L1); keychain, encrypted-file, and external-resolver
(1Password, `pass`, Doppler, Vault) store backends; pool member
health/cooldown.

**Acceptance sketch** (in the [LLP 0010](./0010-agent-dx-and-acceptance.spec.md)
spirit — each claim agent-checkable): a fresh instance with a required entry
reports it via `config.status` and the startup line; setting via the wizard
flips status and is visible to a subsequent action invocation without
restart; `config.verify` runs the probe and records the result; reset
preserves config; the route registry test covers the new routes. And the
negative claims, which are the ones that rot silently: a query or mutation
has no path to config; an action reading an entry outside its `uses` grant
gets `CONFIG_UNDECLARED`; `JSON.stringify`, template coercion, `console.log`,
and thrown-error paths through a handle all yield redaction; a non-loopback
plaintext `config.set` is refused; no operation, log line, or console
response ever contains a set value; app-data export contains no values. For D9:
a value set under `--memory --config-file <path>` is present after a restart
with the same flag and absent under `--memory` alone; a `.env`/JSON source
seeds declared entries and reports undeclared names as `ignored`; and neither
path opens a value read-back — the durable store and the seeded entries still
return names and status only.

## Open questions

- **Reserved host-owned tables** — the `_snapback_config_status` shape needs
  an [LLP 0004](./0004-application-data-api.rfc.md)/[LLP 0007](./0007-storage-portability.spec.md)
  decision on reserved table-name prefixes, their portability semantics, and
  the export/sync/default-authorization fencing for mirrored non-secret
  values (§Status model).
- **Pool representation and member health** — v1 rotation is round-robin over
  an ordered list; whether members become named (weights, per-member
  verification, cooldown/quarantine on 429/401, per-target rotation state)
  is deferred until the live feed provides evidence.
- **Probe limits, concretely** — the rules above pin explicit-only execution,
  cooldown, and timeout; the concrete numbers, and whether hosted
  multi-tenant setups need stricter caps (may an app-authored probe run
  during setup, before the app is fully configured, and under what
  egress/resource limits?), remain open.
- **Attestation topology per target** — generations define `pending` →
  `applied`; which targets can host an attesting controller (post-deploy
  hook, rollout watcher) versus CLI-only attestation is per target strategy
  LLP. Cloudflare's account-level Secrets Store, as it matures, may also
  offer a runtime-writable backend class there `[inferred]`.
- **Admin token auto-mint** — resolved: landed as ENG-23443 in
  [LLP 0017](./0017-admin-console-inspection-surface.rfc.md) §Security
  Defaults (whole-surface hardening, no config special case); this RFC
  inherits it through the admin model as designed.
- **Environment scopes** — whether `local`/`test`/`preview`/`staging`/
  `production` scopes (per-scope values, fake-provider profiles, preview TTL
  and cleanup) are part of this subsystem or a deployment-profile concern;
  v1 ships without them and CI seeds via the env source.
- **Config change → warm VM interaction** — whether a config write invalidates
  warm per-bundle VMs (DK-4,
  [LLP 0009](./0009-code-execution-security.rfc.md) §Invocation Isolation) or
  values are read per-invocation; the v1 slice should read through the store
  per invocation and leave caching to the DK-4 machinery.
- **File source ergonomics (D9)** — whether Snapback auto-loads a conventional
  `.env`/`config.json` from the instance dir or requires an explicit
  `--config-source`, and whether a source is read once at startup or watched
  for change. A watched source blurs the source < store precedence and can
  silently resurrect a value the operator unset, so D9's first cut reads once
  at startup and requires the explicit flag, leaving auto-detection and
  watching to evidence. Also open: whether `--config-file` and `--config-source`
  are the right names next to the existing `--db`/`--memory`, and whether a
  single flag with a read-only/read-write mode is cleaner than two.
