# LLP 1002: The dev loop — one owner, thirteen verbs, the wire, the client

**Type:** Spec
**Status:** Draft
**Systems:** `snapback2/crates/snapback2` (the binary: owner, server, verbs), `snapback2/packages/compiler` (project lowering, worker), `snapback2/packages/snapback2` (authoring runtime, client, React, test runner, shim), `snapback2/scripts/measure.mjs`
**Author:** Claude Fable 5 (orchestrator) — implementers: codex gpt-5.6-sol, lanes B0 (compiler + authoring surface), B1 (owner + server + verbs), B2 (`init`, `test`, `why`, `trace`, `guide`), D (client + React + evaluator)
**Date:** 2026-08-29
**Revised:** 2026-08-30
**Related:** LLP 1000, LLP 1001 (the engine this serves), LLP 1003 (effects), LLP 0329.016 §5 (the design this implements verbatim where it can), LLP 0329.016 §5.11 (the verb table — no verb exists without its row), LLP 0329.016 §8 (gates)

## Summary

LLP 0329.016 designed the loop; this spec is the first code that runs it.
The binary is **the one owner**: `snapback2 dev` checks the project, opens
the store, serves, watches, and applies hot successors; a second `dev`
attaches. The compiler stays TypeScript (it parses and typechecks the
authored modules with the `typescript` package) and runs as a **worker the
owner spawns** — the binary's own toolchain, not a supervised bundler. The
wire is JSON over HTTP/1.1 with SSE for subscriptions; every response carries
a typed state; every refusal carries a family, a site, and a rewrite. Thirteen
of the fifteen verbs land here; `deploy`/`rollback` and `secret` wait for a
hosted target and are the only rows of §5.11 left empty.

Implementers and date: codex gpt-5.6-sol (xhigh), lanes B0/B1/B2/D,
2026-08-29. Only what runs binds.

## 1. Decisions

1. **The binary owns; the compiler is its worker.** `snapback2 dev`, `check`,
   `test`, and `run` need the project compiled; the owner spawns
   `node <compiler.mjs> --worker` (path from `SNAPBACK2_COMPILER`, which the
   npm shim sets to its bundled compiler; else the sibling of the binary) and
   talks JSON lines over stdio (§3). The worker stays alive for the owner's
   life so successors compile warm. Nothing else is ever spawned.
2. **Project layout is fixed.** `snapback/schema.ts` (the schema, default
   export), `snapback/<module>.ts` (programs; `<module>` is the namespace),
   `snapback/seed.ts` (data, optional), `snapback/tests/*.test.ts` (journeys,
   optional). The build cache is `.snapback/` (gitignored by `init`):
   `build/project.json`, `build/certificates.json`, `build/api.d.ts`,
   `store.sqlite`, `owner.json`, `log.jsonl`, `receipts/`, `forks/`.
3. **Export name is the name.** A table is `export const profiles = table({…})`
   in `schema.ts`; a program is `export const list = query(…)` in `todos.ts`
   and is the op `todos.list`. There is no `name:` field anywhere.
4. **Seed is data, not code.** `seed.ts` exports `{ personas: string[],
   rows: Record<table, Row[]> }`; it is applied as one `seed` commit by the
   system principal; `reset` re-applies it.
5. **`stop` lives inside `dev`** (`snapback2 dev --stop`) so the verb table
   stays at fifteen rows.
6. **Personas never reach production.** The owner has a `mode` (`dev` |
   `serve`); `serve` refuses `X-Snapback-As` with `E_AUTH_PERSONA_NOT_DEV`
   and is the mode `deploy` will use.

## 2. The authored surface (the `snapback2` module)

The module exports inert descriptors — no body ever runs in the authoring
process — plus the types the compiler checks against (`lib.d.ts` becomes the
module's declaration; the compiler accepts and strips the import):

```ts
import { schema, table, t, rule, channel, query, mutation, effect, emit, seed } from 'snapback2'

export const profiles = table({
  columns: { handle: t.text(32), name: t.text(80) },              // `id: t.id()` and index `byId` are implicit
  indexes: { byHandle: { columns: ['handle'], unique: true } },
  rules: { read: rule.public('profiles are public'), insert: rule.viewerIs('id'),
           update: rule.viewerIs('id'), delete: rule.deny() },
})
export const memberships = table({
  columns: { conversationId: t.ref(conversations), userId: t.ref(profiles), lastReadAt: t.time() },   // refs name the exported table, not a string
  indexes: { byConvUser: { columns: ['conversationId', 'userId'], unique: true }, byUser: { columns: ['userId'] } },
  rules: { read: rule.exists(memberships, 'byConvUser', [rule.field('conversationId'), rule.viewer]),
           insert: rule.allow(), update: rule.viewerIs('userId'), delete: rule.viewerIs('userId') },
  constraints: [{ unique: 'byConvUser' }],
})
export const typing = channel({ args: { conversationId: t.id() },
  publish: rule.exists(memberships, 'byConvUser', [rule.field('conversationId'), rule.viewer]),
  subscribe: rule.exists(memberships, 'byConvUser', [rule.field('conversationId'), rule.viewer]), ttlMs: 4000 })
export default schema({
  auth: { password: true, guests: true },
  tables: { profiles, memberships, /* … */ },
  maintains: [{ count: 'messages', by: ['conversationId'], into: 'messageCounts' }],
  channels: { typing },
})
```

`t`: `id()`, `text(max)`, `int()`, `bool()`, `time()`, `ref(table)`,
`json(maxBytes)`, `optional(x)`, `list(x, { max })`, and (folded 2026-08-30
from the column-type survey) `enum(['dm', 'group'])` and `decimal(scale)` /
`money(currency, scale = 2)`. A `Decimal` column or arg is typed
`Decimal<S>` — a branded `number` of minor units — in `api.d.ts`; inside a
program the compiler scales a decimal literal written against a `Decimal<S>`
target (`price: 9.99` → `999` when `price` is `t.decimal(2)`), admits `+`, `-`,
comparisons, and `min`/`max` between operands of the same scale and `*` by an
`int`, and refuses everything else with `E_DECIMAL_SCALE` and a rewrite naming
the scales. **Every numeric literal written against a `Decimal<S>` target is in whole
units and is scaled** — `price: 2`, `price: 2.00`, and `price: 2e0` all lower
to `200` at scale 2 — so an integer literal can never be a silent 100× error;
minor units are only ever carried by a value already typed `Decimal<S>` (a
column read, an arg, the wire). The wire carries the integer; the client's
`decimal(9.99, 2)` helper produces it. Floats never exist anywhere. `rule`: `public(reason)`,
`allow()`, `deny()`, `eq(a,b)`, `ne(a,b)`, `and(…)`, `or(…)`, `not(r)`,
`exists(table, index, key[], { hidden? })`, `principal(kind)`, `viewerIs(field)`
(= `eq(field(f), viewer)`); terms `field(name)`, `viewer`, `literal(v)`. Each
lowers 1:1 to LLP 1001's `RuleExpr`/`RuleTerm`/`ColumnType`/`Constraint`/
`Maintain`/`Channel`. Programs are unchanged from spike S2 except that tables
are imported from `./schema` and `emit(effectRef, payload)` is a statement
(LLP 1001 §8). `effect({...})` is LLP 1003 §1.

## 3. The compiler worker and the project JSON

Protocol, JSON lines on stdin/stdout, one request in flight:

```
→ { "id": 1, "op": "compile", "root": "/abs/project" }
← { "id": 1, "ok": true, "project": <ProjectJson>, "sources": { "todos.list": { "file": "snapback/todos.ts", "line": 14, "col": 14 } }, "apiDts": "<text>", "ms": 212 }
← { "id": 1, "ok": false, "diagnostics": [ <Refusal> ] }        // ALL diagnostics, one per module at least
→ { "id": 2, "op": "seed", "root": "…" }  ← { "id": 2, "ok": true, "seed": { "personas": [...], "rows": {...} } }
→ { "id": 3, "op": "journeys", "root": "…" }  ← { "id": 3, "ok": true, "files": ["snapback/tests/todos.test.ts"] }
```

`ProjectJson` is LLP 1001 §4's serde shape, with `programs[].name` qualified
(`todos.list`), `schema.effects` listing the effect names, and
`effects[] = { name, grants, source, then }` (LLP 1003). `Refusal` is §4's
envelope. Diagnostics are collected per operation and per project up to a
bound (20 per operation, 50 per project); when a bound truncates, the last
entry is `E_DIAG_TRUNCATED` ("…and N more") — never a silent slice (review
ruling 2026-08-30). The one-shot form `node compiler.mjs --project <root>` prints the
same response and exits 0/1, so `check` works without the binary and the
compiler's own tests need no spawn. The binary's IR-file form is
`snapback2 check --ir <project.json>` (stdin when omitted) — `--project` on
the binary always means the §6 verb over a project directory. The compiler is bundled by esbuild into
`packages/snapback2/dist/compiler.mjs` and runs under Node ≥ 20 (no `Bun.*`).

`api.d.ts` (written to `.snapback/build/api.d.ts`, never committed) augments
the client's `Api` interface with every op's arg and result types, inferred
from the authored modules by the `typescript` checker:

```ts
declare module 'snapback2/client' { interface Api { todos: { list: Op<{ take?: number }, Todo[]>; add: Op<{ title: string }, { id: string }> } } }
```

## 4. The wire

HTTP/1.1, JSON bodies, `Content-Type: application/json`; CORS `*` in `dev`
mode. Authentication: `Authorization: Bearer <token>`; in `dev` mode
`X-Snapback-As: <name>` selects a persona (created on first use; §1.6).

| route | body → response |
|---|---|
| `GET /` | `{ ok, version, generation, mode, url }` |
| `POST /api/auth/signup` | `{ email, password }` → `{ token, viewer }` |
| `POST /api/auth/login` | `{ email, password }` → `{ token, viewer }` |
| `POST /api/auth/guest` | `{}` → `{ token, viewer }` |
| `POST /api/auth/logout` | → `{ ok }` |
| `GET /api/auth/me` | → `{ viewer, kind }` |
| `POST /api/query` | `{ op, args }` → `{ state: "complete" \| "capped" \| "partial" \| "denied", data, seq, take?, site?, rule?, reason? }` |
| `POST /api/mutation` | `{ op, args }` → `{ state: "committed", seq, data }` \| `{ state: "rejected", code, family, message, rewrite? }` |
| `GET /api/subscribe?op=&args=<urlencoded json>` | SSE; `id: <seq>`; each `data:` frame is **exactly a query response object** (`{ state: "complete" \| "capped" \| "partial" \| "denied", data, seq, … }`) or a refusal envelope (`{ state: "refused", code, family, message, … }`, terminal); the server never sends `live`/`stale` — those are client connection facts; a `: heartbeat` comment every 15 s (review ruling 2026-08-30) |
| `POST /api/channel/<name>/publish` | `{ args, payload }` → `{ ok: true }` \| `{ state: "refused", code }` |
| `GET /api/channel/<name>/subscribe?args=` | SSE; `data: { from, payload, at }`; the owner drops the stream when a commit touches the probe's key and re-admission fails |
| `GET /api/manifest` | `{ generation, ops: { "todos.list": { kind, args } }, channels, auth }` |

Typed states are 200. Protocol errors are 4xx with the **refusal envelope**,
which is the only error shape on every surface (HTTP, CLI `--json`, worker):

```json
{ "code": "E_BOUND_TAKE_REQUIRED", "family": "bound", "message": "…", "site": "snapback/todos.ts:14:9",
  "rule": "every scan names take", "rewrite": "scan(todos.byOwner, [ctx.viewer], { take: 100 })", "guide": "bound/scan" }
```

Families (this wave): `bound`, `opaque`, `schema`, `rule`, `auth`, `args`,
`op`, `successor`, `effect`, `input`, `owner`. A code without a family, a
site (where one exists), and a `guide` slug is a bug.

Control routes (loopback only, `X-Snapback-Control: <secret>` from
`owner.json`): `GET /control/status`, `POST /control/apply { project }`,
`POST /control/migrate { project, plan }`, `POST /control/reset`,
`POST /control/fork { name }`, `GET /control/logs?since=<seq>&limit=`,
`GET /control/personas`, `POST /control/persona { name }`,
`POST /control/why { op, args, as }`, `GET /control/trace?seq=`,
`GET /control/subscriptions`, `POST /control/stop { cause }`.

## 5. The owner

- **Start.** `dev` → compile (worker) → `Generation::certify` → open
  `.snapback/store.sqlite` → `Runtime::open` (or successor) → bind a free
  loopback port (or `--port`, honored or refused `E_OWNER_PORT_TAKEN`) → write
  `owner.json { pid, port, url, secret, generation, startedAt, mode }` → print
  exactly one line `SNAPBACK_URL=http://127.0.0.1:<port>` (and the JSON form
  under `--json`) → detach: the foreground process exits 0 after the owner
  is ready; the owner runs with stdin closed and stdout/stderr to
  `.snapback/log.jsonl`. `--foreground` keeps it attached (for `test` and
  CI).
- **Attach.** If `owner.json` names a live pid whose `/control/status`
  answers with the same project root, print the same line and exit 0. Keyed
  by project root, not port.
- **Watch.** Poll `snapback/**/*.ts` mtimes every 200 ms; on change,
  compile → certify → `apply_successor`; on refusal, log it, keep serving the
  last generation, and answer `/control/status` with `applying`/`refused`
  (+ the plan, written to `.snapback/migration-<gen>.json`). Subscriptions
  re-execute and deliver on an applied successor.
- **Exit.** Only `dev --stop`, a signal, or a fatal error; every exit writes
  `{ exited: cause }` to the log and removes `owner.json`. No exit 0 with an
  empty stdout.
- **Threads.** One writer thread owns the `Runtime` behind a channel; HTTP
  connections are threads (`tiny_http` or std-only); SSE streams hold a
  receiver and are fanned out by the writer after each commit
  (`invalidated` → `rerun` → deliveries; `changed: false` is not sent). No
  tokio.
- **Owner states** on `/control/status`: `ready | applying(gen) |
  refused(plan) | exited(cause)`, plus `generation`, `seq`, `subscriptions`,
  `effects` (LLP 1003's runner state), `personas`.

## 6. Verbs (this wave)

Every verb: `--json`, `--as <persona>` where a principal matters, capped
output with a `…and N more (--limit)` hint, no prompt without a TTY, exit 0
ok / 1 refused (typed) / 2 usage or environment.

| verb | syntax | does |
|---|---|---|
| `init` | `snapback2 init [dir] [--template chat\|todos] [--client react\|none]` | idempotent scaffold (§10) |
| `check` | `snapback2 check [--project dir]` | compile + certify + write the build cache; prints `ok <gen> <N> ops` or every refusal |
| `dev` | `snapback2 dev [--port N] [--foreground] [--stop] [--status] [--apply-migration file] [--serve]` | §5 |
| `run` | `snapback2 run <op> [args-json] --as <persona>` | one op through the owner; prints the wire response |
| `test` | `snapback2 test [--blocked reason] [--journeys-only] [--derived-only]` | §7 |
| `why` | `snapback2 why <query> [args-json] --as <persona>` | §8 |
| `trace` | `snapback2 trace <seq \| latest>` | §8 |
| `data` | `snapback2 data <table> [--index name --prefix json] [--limit 50] --as <persona>` | a bounded, rule-checked read as the persona (limit ≤ 500) |
| `logs` | `snapback2 logs [--since seq] [--limit 100]` | structured log lines from `log.jsonl` + `_commits` |
| `persona` | `snapback2 persona list \| create <name>` | dev personas (grants: deferred) |
| `fork` / `reset` | `snapback2 fork <name>`, `snapback2 reset` | `Store::snapshot_to(.snapback/forks/<name>.sqlite)`; `reset_data` + seed |
| `guide` | `snapback2 guide [grammar \| app \| <symbol> \| <E_CODE> \| <recipe>]` | §8 |
| `doctor` | `snapback2 doctor` | today's, plus: compiler worker found and answers; effects engine state; owner state if any |

## 7. `test` and the receipt

`test` starts a fresh owner (`--foreground`, ephemeral port, store at
`.snapback/test-<ts>.sqlite`, deleted after), applies the seed, then runs:

**Derived checks** (generated from the schema, certificate, and seed; visible
read-only in the receipt, never editable):
1. `certify` — every program certifies (the compiler's refusals are the
   failures).
2. `rules` — for every table with a non-public rule and every seed persona:
   `data <table> --as <persona>` returns only rows the rule admits (re-checked
   by evaluating the rule per row on the server) and a persona named in no
   row sees none of the owner-scoped rows.
3. `bounds` — every query runs as every seed persona; its authoritative trace
   is `⊆` its certificate (`E_TRACE_SUBSET` is the failure).
4. `invalidation` — for every query and every seed mutation whose write sites
   intersect the query's read sites: subscribe, run the mutation as its seed
   persona, assert a delivery arrives with the new `seq`; for a mutation whose
   write sites are disjoint, assert silence.
5. `replay` — every seed mutation, run twice against two forks of the seeded
   store with the same pinned `now`/`newId`s, yields byte-identical traces.
6. `effects` — every effect declaration has a runner able to run it, or the
   check is `blocked: no engine in this build` (LLP 1003 §4).

**Journeys**: `snapback/tests/*.test.ts` run by `node <test-runner.mjs>`
(spawned like the worker) against the same owner with the headless client
(§9): `journey(name, async ({ as, tick, url }) => …)`; `as('alice')` returns a
client bound to that persona; `tick(ms)` advances the owner's clock for
`ctx.now()` (`POST /control/clock`); each journey ≤ 5 s. A rerun re-samples
`now` from the owner's clock at rerun time, and a clock advance reruns every
subscription — a tick is a synthetic commit — so time-dependent live queries
advance (review ruling 2026-08-30). In a *query*, `ctx.now()` lowers to the
bucketed `ReadTime` input (LLP 0329.014.004: read time is a declared-
granularity clock); the compiler currently pins the granularity at 1 ms —
declaring it on the surface (`query({…}, { readTime: '1m' }, …)`) is deferred.

**Blocked is not pass** (review ruling 2026-08-30): the receipt verdict is
`blocked` (exit 1) when any check is blocked, naming which; `pass` needs every
check to pass. The `effects` check exists only for a project that declares
effects, so a project without effects passes on an engine-less build, and a
project with effects is honestly `blocked` there and passes on the published
(engine) build. Journeys are optional; a run with derived checks and no
journeys can pass; zero checks cannot.

**Journeys are built by `check`** (review ruling 2026-08-30): `check`
compiles and typechecks `snapback/tests/*.test.ts` into
`.snapback/build/tests/`, refusing type errors like any module; the runner
loads the built files and the shipped `snapback2/client` — nothing is
transpiled at test time.

**Receipt** (`.snapback/receipts/<ts>.json`, also printed): `{ binary: { version,
digest }, generation, commands: [...], checks: [{ name, kind: "derived" | "journey",
verdict: "pass" | "fail" | "blocked", ms, detail }], arms: ["headless"], verdict:
"pass" | "fail" | "blocked", scope: { changed: [...] } }`. Zero checks cannot pass;
`--blocked "reason"` writes a `blocked` receipt and exits 1.

## 8. `why`, `trace`, `guide`

- `why <query> --as p`: re-runs the read; prints, per examined row, the rule
  verdict and the rule inputs it touched (from `rule_inputs`); the read sites
  examined against the certificate's (take, examined, hoisted); and, if a live
  subscription for that op+args exists, its last delivery `seq` and whether
  the latest commit touched it.
- `trace <seq>`: the commit record (program, principal, writes, touched
  keys), the outbox rows it emitted and their real states, and the
  subscriptions it invalidated with their delivery seqs — intent → commit →
  invalidation → delivery — read from the owner's bounded per-commit ledger
  (last 1,000 commits) and the store's `_outbox`, never reconstructed from
  program syntax or the current subscription set (review ruling 2026-08-30).
- `guide`: `grammar` (one screen, hand-written, in the package), `app`
  (tables, rules, ops with bounds, channels, personas — from the generation),
  `<symbol>` (the JSDoc on the `snapback2` module's declaration), `<E_CODE>`
  (the family's wrong/right pair), `<recipe>` (`auth`, `live-query`,
  `effects`, `personas`, `testing` — ≤ 4 KB Markdown files shipped in the
  package). Served from the package, not embedded in the binary.

## 9. The client (`snapback2/client`, `snapback2/react`, `snapback2/test`)

```ts
const client = createClient({ url, token?, as? })     // `as` refused by a `serve` owner
client.auth.signup / login / guest / logout / me
await client.query(api.todos.list, { take: 50 })       // → { state, data, seq, … } — never throws on a typed state
await client.mutation(api.todos.add, { title })       // → committed | rejected
const sub = client.subscribe(api.todos.list, args, (r) => …)   // SSE; { state: live|stale|refused|partial }; sub.close(); sub.until(pred)
client.channel(api.typing, args).publish(payload) / .subscribe(cb)
```

`api` is a proxy (`api.todos.list` → `{ op: 'todos.list' }`) typed *only* by
the `Api` augmentation in `.snapback/build/api.d.ts` (no index signature: a
typo is a compile error; channels are members too). The view on `useQuery`
is the discriminated union `hydrating | complete | capped | partial | denied
| refused | stale`, each carrying its receipt fields (`take`/`site`, `reason`,
`rule`, `since`, `seq`), plus two orthogonal facts: `live: boolean` (a
subscription is connected and this view is its latest delivery — the RFC's
"live" state is this flag, so a capped page on a live query is `capped` with
`live: true`) and `connection`. A transport failure (network, HTTP 5xx, a
stream idle past 2× the heartbeat) is `stale(since)` with reconnect and
backoff; only a 4xx envelope on the stream is a terminal `refused`; `useMutation` returns
`{ run, pending, last }` with `last: committed | rejected` — `queued` is
reserved for the offline outbox (deferred) and never claimed before it exists
(review ruling 2026-08-30). Every 4xx envelope on `query()`/`mutation()`
throws `SnapbackRefusal`; subscriptions deliver `refused`. **Transport status
is not a query state**: hooks and the provider expose `connection: connected |
reconnecting | offline` separately, and a network failure leaves a query
`hydrating` with `connection: reconnecting`, never `refused`.

Three rulings folded 2026-08-30 from the client-tier arc (LLP 0329.018–.023):

- **Every state here is receipt-backed**, and the type says so: there is no
  `unknown`, no `cached`, no `empty: bool`. `hydrating` is *partially
  arrived* (a spinner); `partial(sites)` is *partially held* (coverage — the
  client cannot resolve it without the server); `complete` with `[]` is an
  authority's "no rows exist"; the three are never collapsed (LLP 0329.019
  A2, LLP 0329.023 F2). A foreign backend is a separately typed resource
  (`Cached | Stale | Failed`, LLP 0329.022) that this package does not
  provide and its types cannot be coerced into.
- **Evaluator per arm** (LLP 0329.018 F1): web and Expo host a JS runtime
  and run the 7.8 KB TypeScript twin; the Contract-native (Exact 2) arm hosts
  none and links `snapback2-core`'s interpreter — the same `ClientStore` the
  corpus already proves byte-identical. Two implementations, assigned by
  runtime, never a third.
- **Coverage is client-issuable; absence and authorization are not**
  (LLP 0329.021 P5): the twin never manufactures an absence or a verdict; a
  read whose result depends on an absence the receipt does not carry is
  `partial`, never `complete`. `SnapbackProvider({ url, as? })` and an
optional `<DevOverlay/>` (persona, connection, generation, last refusal).
Reconnect with backoff; a lost SSE stream reports `stale(since)` until the
first delivery after reconnect. The evaluator twin gains `Emit` as a
no-op that consumes one id (LLP 1001 §8) and one corpus case proving it.

## 10. `init`

Idempotent: writes only files that do not exist, updates the managed block
in `AGENTS.md` (≤ 40 lines: the five verbs an agent needs, the grammar
pointer, three gotchas), adds `.snapback/` to `.gitignore`, adds
`.snapback/build/api.d.ts` to `tsconfig.json` `include`, pins `snapback2` in
`package.json`. Templates: `todos` (one table, two ops, a seed, one journey)
and `chat` (profiles, conversations, memberships, messages, typing channel,
a `notify` effect, seed, two journeys) — the chat template is Clique M1's
shape. `--client react` adds a Vite React app under `src/` that reads
`VITE_SNAPBACK_URL`. `init` then runs `check` and prints the next command.

## 11. Measured

`scripts/measure.mjs` gains `check_project_s` (`check` on the chat template),
`init_to_dev_s` (`init` → `dev` ready, fresh dir), `test_s` (`test` on the
chat template). Gates from `rules/RULES.md`: `check` < 1 s, `doctor` < 0.5 s;
from LLP 0329.016 §8: `init` → `dev` ≤ 10 s, `test` on a template < 30 s.

## Deferred (not binding)

`deploy`/`rollback`, `secret`, previews, claim codes, export, MCP, `--changed`,
persona grants, the Expo and Exact 2 arms, result diffs on the wire, the
schedule kind, retention.

## Open author decisions

0. **The surface, after LLP 0329.017.** A Contract-block (additive) front end
   lowers 17/17 S1 programs and refuses 8/8 first attempts *at parse*, where
   the TypeScript front end refuses them by policy after they type-check.
   This spec keeps TypeScript for the React-web-first benchmark (the gauntlet
   measures naturally written TypeScript; a Contract surface scores 0 there
   by construction) and treats the Contract block as the Exact 2 arm's
   authoring form over the same IR. Two facts from that spike bind the
   compiler now: `provenance` and `site` are **authored facts, not derivable**
   (0329.017 C4) — the compiler's inference of them is a silent-wrongness
   surface and must become either an explicit annotation or a verified
   inference with a refusal when it cannot decide (`E_PROVENANCE_AMBIGUOUS`).
1. `tiny_http` versus a std-only server (size vs. correctness of chunked SSE).
2. Whether `init --client react` should exist before the React arm has a
   benchmark run, or `init` should scaffold the backend only.
3. `tick` as a control route (dev only) versus `ctx.now()` bound to the
   request — the spec takes the control route.
