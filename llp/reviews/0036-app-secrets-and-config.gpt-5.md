# Review: LLP 0036 — App secrets and configuration

**Reviewer family:** GPT-5 / Codex (OpenAI)
**Provider / runtime:** Codex CLI (`codex exec --sandbox read-only`) run in this repository; model self-reported as "GPT-5 Codex"
**Date:** 2026-07-02
**Redacted:** No — the review prompt named in-repo paths; the Codex session read the working-tree LLP corpus and source directly. Content was sent to OpenAI via the Codex CLI under the author's explicit `/llp-review 0036` request.
**Method:** cli-runner — LLP 0005 standard review prompt plus the author's requested emphasis (stress-test all deployment scenarios: local, AWS, Cloudflare, containers/K8s, Fly/Railway, CI/preview, multi-replica, backup/restore, graduation). The reviewer was directed to read LLP 0009, 0029, 0031, 0024, 0018, 0014, 0028 and `src/runtime.rs`, `src/admin.rs`, `src/cli.rs`, `src/manifest.rs` to verify claims.

> **Independence (LLP 0005).** LLP 0036 was authored by a Claude session on
> 2026-07-02; this GPT/Codex session did not author the draft, so this is a
> genuine cross-family review. It reviewed the draft at its initial
> working-tree state, before the revision pass that responded to it.

## Overall assessment

Model: GPT-5 Codex, OpenAI, running as an independent GPT-family reviewer in this Codex session.

This is a good RFC direction and probably the right subsystem to add. The strongest idea is treating app secrets/config as declared, inspectable deployment state rather than ad hoc `.env` folklore. It fits the LLP corpus: 0009 wants explicit secret capabilities, 0029 G4 names the current env-blob seam as insufficient, 0024 wants one machine-readable host-ops surface, 0031 gives the admin route lane, and 0028 gives a real manifest precedent.

I would keep it in Draft. The local v1 slice is plausible, but the hosted story is under-specified in exactly the places Charlie asked to stress-test: writes, reads, `pending`, who can observe `applied`, multi-replica rollout, backup/restore, and local-to-hosted graduation. The RFC names these as target seams, but it does not yet pin enough target contracts to prevent incompatible implementations.

## Strengths (cite sections)

- `Summary` and `Motivation`: The product framing is correct. “The install story is the product story” is not fluff here; All Aboard and future notifications/AI gateways need this or every demo regresses to README archaeology.

- `Declared configuration in the manifest`: Carrying declarations in the generated manifest is a good reuse of the cron precedent in LLP 0028. Public metadata in source, private values in deployment state, is the right split.

- `The store and the target seam (D1, D2)`: Rejecting the app SQLite database as the local secret store is correct. It aligns with LLP 0007 export portability, LLP 0010 reset/seed loops, and LLP 0009’s “secrets are not app data” posture.

- `Runtime exposure (D5)`: Actions-only secret exposure matches LLP 0009 and LLP 0028’s action model. Keeping queries/mutations from reading host config directly is especially important given read-set validation.

- `Status model and app visibility (D4)`: Rejecting `ctx.secrets.has()` in queries is a strong systems call. The host-maintained status table is the right long-term shape if reserved host tables are accepted.

- `Operations and projections (LLP 0024)`: Making CLI, HTTP, MCP, and wizard projections of the same host-ops core is exactly the kind of corpus fit LLP 0024 is trying to force.

- `The setup wizard (D3)`: Inheriting LLP 0031’s route/admin model instead of inventing a secrets-specific auth path is architecturally clean.

- `Agent-driven acquisition (D6)`: The automation ladder is useful if kept as metadata plus ordinary ops, not as a Snapback-operated broker.

## Concerns (each with severity high/medium/low and what would resolve it)

- **High: Hosted write/apply semantics are not a contract yet.**  
  The RFC introduces `pending`, but it does not define a target contract precise enough for Cloudflare Workers, Fly/Railway env injection, ECS/Fargate task env, Kubernetes projected secrets, or multi-replica VMs. For each target, the RFC needs to pin: where writes go, what runtime reads, whether reads are per-invocation or cached, what event changes `pending` to `applied`, and whether Snapback can observe that transition or only infer it.  
  Resolve by adding a “target semantics matrix” with columns: write authority, durable backend, runtime read source, apply boundary, apply observer, rollback behavior, stale-read max, and restart/redeploy requirement.

- **High: Cloudflare has a bootstrap/control-plane problem.**  
  The RFC says Cloudflare uses Workers secrets/bindings and has deploy-time writes. But an in-app admin wizard running inside a Worker generally cannot mutate that Worker’s own secret bindings unless there is an external deploy controller or a Cloudflare API token with enough authority. Storing that API token inside the same app becomes a meta-secret problem.  
  Resolve by splitting “in-runtime config.set” from “deployment-controller config.set”. For Cloudflare, likely `config.set` should produce a pending deployment instruction unless a separate operator-side Snapback deploy tool has Cloudflare API authority.

- **High: Multi-user local machines make loopback-open secret writes too risky.**  
  The RFC correctly notes auto-minted persistent tokens are the right whole-admin fix, but then proceeds with loopback-open writes for v1. `config.set` is not more destructive than `app.reset`, but it is more sensitive: it captures real provider credentials. On a shared dev box, any local user/process can overwrite or test secrets.  
  Resolve by making auto-minted admin tokens a prerequisite for the setup wizard’s write path, or by narrowing v1 to single-user local with an explicit capability warning and no “recommended” posture for shared machines.

- **High: The current and proposed runtime secret API still needs a real handle design.**  
  Current code injects `SNAPBACK_ACTION_SECRETS` as a plain JSON object into `ctx.secrets`. The RFC says “handles” and “no read-back,” but examples like using a key in an Authorization header require eventual exposure to `fetch`. A JS action that holds the key can exfiltrate it; 0009 allows that honestly, but the API shape matters.  
  Resolve by specifying the TypeScript/JS secret API: `ctx.secrets.get(name)` returns an opaque `SecretString`/handle, which APIs accept directly, with explicit `expose()` only where unavoidable, redaction semantics, serialization behavior, and tests proving secrets do not stringify/log accidentally.

- **High: Per-action grants are promised but not designed.**  
  LLP 0029 G4 asks for scoped keys and per-action grants. 0036 declares entries but does not pin how actions declare which entries they may receive. If every action gets `ctx.secrets.get(anyName)`, the design closes storage but not scoping.  
  Resolve by adding manifest-level usage/grant metadata, e.g. function `requiredConfig: [{ name, access: "read" | "rotate" }]`, load-time validation for probes and cron actions, and runtime denial when an action asks for an undeclared entry.

- **High: Multi-replica scale-out is under-modeled.**  
  Local file store works for one process. On two VM replicas, two containers, or a Kubernetes deployment, `.snapback/config.json` is either not shared, shared unsafely, or mounted read-only from a secret object. AWS Secrets Manager/SSM and GCP Secret Manager avoid that, but need caching/invalidation rules.  
  Resolve by making “file store” explicitly single-writer/single-instance only, with file locking and atomic replace. Multi-replica profiles should require an external secret manager or a read-only mounted secret plus rollout semantics.

- **Medium: Backup/restore and local-to-hosted graduation need explicit behavior.**  
  The RFC says reset preserves config and SQLite export should not contain secrets, which is right. It does not say what `snapback export`, backup restore, preview clone, or local-to-hosted deploy carries: declarations only, status rows, verified flags, secret names, non-secret config values, or nothing.  
  Resolve by adding a portability section: app-data exports exclude secret values; deployment backups may include encrypted/target-native secret references only if operator-owned; local-to-hosted graduation imports declarations and prompts/rebinds values; verification state should probably reset unless target-attested.

- **Medium: The status table creates a second boundary that needs sharper rules.**  
  Host-maintained `_snapback_config_status` is attractive, but it mixes deployment state into app-visible storage. The RFC says “not synced to clients by default,” yet Snapback’s table/sync model does not currently have reserved table semantics. Non-secret values “ride the same mechanism,” which may make deployment config part of app backup/export unless carefully fenced.  
  Resolve by requiring an LLP 0004/0007 reserved-system-table decision before v2, including export/sync/default-auth behavior and whether non-secret config values are deployment state or app state.

- **Medium: Verification probes can become quota-abuse and confused-deputy paths.**  
  `config.verify` runs an action that may hit a vendor API. On local loopback or a compromised admin token, this is an API-quota burn tool. For pooled keys, repeated verify can also mark health incorrectly if rate-limited.  
  Resolve by specifying rate limits, cooldowns, probe idempotency, timeout bounds, and whether verify uses the same egress allowlist and per-action grants as production actions.

- **Medium: AWS/container semantics are too collapsed.**  
  “AWS = Secrets Manager or SSM runtime API” is plausible for EC2 and ECS/Fargate if the app fetches at runtime under IAM. But many ECS/Fargate deployments inject secrets as env vars at task start, which is restart-only. Kubernetes similarly differs between env injection and projected volumes.  
  Resolve by modeling “runtime secret manager fetch” and “environment/projection injection” as separate backend classes, not just target names.

- **Medium: CI and preview environments need a different posture.**  
  CI should often use ephemeral secrets, fake providers, or recorded data. Preview environments may have per-branch config and cleanup. The RFC does not define how required secrets block acceptance, how to supply test-only values, or how preview secrets are deleted.  
  Resolve by adding environment scopes: `local`, `test`, `preview`, `staging`, `production`, with policy for required entries, fake providers, and TTL/cleanup.

- **Low: Agent acquisition is useful but currently too prominent for v1.**  
  The metadata is good, but the automation ladder risks making the RFC look larger and more speculative than the v1 subsystem.  
  Resolve by keeping `howToGet`/`acquisition` in v1 as passive metadata, and moving `awaiting-human` and L2/L3 acquisition states to v2+.

## Suggestions

Add a deployment scenario appendix with explicit answers:

| Scenario | Writes go to | Reads come from | `pending` means | Who observes `applied` | Main breakage |
|---|---|---|---|---|---|
| Single-user local | 0600 file | file/store seam | brief atomic-write window or none | same process | file perms only |
| Multi-user local | 0600 file + admin token | file/store seam | same as local | same process | loopback-open admin is unsafe |
| Own VM, one process | 0600 file or env source | file/store seam | immediate after atomic write | same process | backups may miss/expose file |
| Own VM, multi-replica | external secret manager or shared config service | runtime fetch/cache | not all replicas refreshed | controller/health probe | split-brain values |
| EC2 | Secrets Manager/SSM or local file | runtime fetch/cache | write accepted, cache stale | app health/config generation | IAM/caching |
| ECS/Fargate env injection | Secrets Manager/SSM at task start | env/task | new task definition/deploy needed | deploy controller | old tasks keep old values |
| Kubernetes | Secret object | env or projected volume | rollout or projection delay | controller/pod generation | env never updates without restart |
| Fly/Railway | platform secret vars | env injection | restart/redeploy required | platform deploy state | runtime cannot apply |
| Cloudflare Workers | Workers secret/binding via deploy controller | binding | deployment not yet active | deploy controller or version probe | app cannot self-mutate binding |
| CI | injected test secret or fake provider | env/file | job-local only | test harness | leaking logs/artifacts |
| Preview | per-preview secret namespace | target-specific | rollout/TTL pending | preview controller | cleanup/orphan secrets |
| Backup/restore | declarations plus optional secret references | target rebinding | restored app unbound until set | operator/deploy tool | accidental secret export |

Make “config generation” a first-class concept. For immediate stores, every write increments a per-app config generation. Actions receive generation metadata. Multi-replica targets can report which generation a replica is serving. This gives `applied` something concrete to mean.

Separate backend classes from deployment targets:

- `local-file-immediate`
- `runtime-secret-manager-fetch`
- `env-injected-restart`
- `projected-secret-eventual`
- `deploy-time-binding`
- `external-controller-managed`

Then map targets to backend classes. This avoids pretending “AWS” or “Kubernetes” has one secret behavior.

Add a `config.plan` or dry-run operation. Before setting hosted config, an agent should be able to ask: “Can this target apply now? Will it require restart? Which credentials are needed? What will become pending?”

Make v1 acceptance include negative tests: query/mutation cannot see config, action cannot access undeclared secret, logs do not contain secret values after thrown errors, `JSON.stringify(ctx.secrets.get(...))` does not leak, reset preserves config, export excludes values.

## Novel ideas

- **Attested applied checks:** For hosted targets, have each runtime expose a redacted `configGeneration` and declaration hash in health/inspect. A deploy controller flips `pending` to `applied` only after enough live replicas report the new generation.

- **Secret-backed fetch helpers:** Instead of forcing action code to expose secrets into strings, provide helpers like `ctx.fetch.withSecretHeader(secret, "Authorization", format)` or `ctx.secrets.get(name).asBearer()` that only unwrap at the host fetch boundary and redact errors.

- **Config recipes for demos:** Let open-source apps ship “fake/recorded provider profiles” in the manifest, so All Aboard can say: recorded feed works with no key; live feed requires `caltrainFeed`. This improves CI and first-run experience without weakening production.

- **Operator-owned vault plugin interface:** Keep v1 file store, but design the seam so advanced users can bring `pass`, 1Password CLI, Doppler, AWS SSM, or Vault as external resolvers without Snapback becoming Vault.

- **Two-person or explicit-delegation policy for paid acquisition:** The acquisition metadata could mark `humanCommitment: ["terms", "payment"]`, letting agents proceed only when a prior delegation token exists. That is more precise than prose around “human commitments.”

## Open questions

- What exactly is the JS/TS type of a secret handle, and which host APIs can consume it without exposing a string?

- How does an action declare it is allowed to use `caltrainFeed`? Is this per action, per cron job, per probe, or per bundle?

- Is auto-minted admin auth required before secrets v1, or is shared-machine local explicitly out of scope?

- For Cloudflare, who owns the API authority to write Workers secrets: the app runtime, a local deploy CLI, a hosted Snapback control plane, or the human using `wrangler`?

- What is the formal state machine for `unset`, `set/unverified`, `verified`, `failed`, `pending`, `applied`, `stale`, and `awaiting-human`?

- Are non-secret config values deployment state, app state, or both? Do they export, reset, sync, and migrate?

- How are secret pools represented: ordered list, named members, weights, health, cooldown, last-used index, target-local state?

- How does backup/restore treat verification state and secret references?

- What is the preview/CI story for required secrets: fake providers, optional profiles, or fail-closed missing config?

- Can hosted multi-tenant Snapback ever let app-authored probes run during setup before the app is fully configured, and under what resource/egress limits?

## Recommended next step

revise-and-stay-Draft
