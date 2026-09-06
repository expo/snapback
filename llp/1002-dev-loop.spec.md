# LLP 1002: The dev loop — one owner, thirteen verbs, the wire, the client

**Type:** Spec
**Status:** Draft
**Systems:** `snapback2/crates/snapback2` (the binary: owner, server, verbs), `snapback2/packages/compiler` (project lowering, worker), `snapback2/packages/snapback2` (authoring runtime, client, React, test runner, shim), `snapback2/scripts/measure.mjs`
**Author:** Claude Fable 5 (orchestrator) — implementers: codex gpt-5.6-sol, lanes B0 (compiler + authoring surface), B1 (owner + server + verbs), B2 (`init`, `test`, `why`, `trace`, `guide`), D (client + React + evaluator)
**Date:** 2026-08-29
**Revised:** 2026-09-06 (native logical SSE body; CLI help and executable migration recovery); 2026-09-05 (keyword index fallback and recipe list; generated Quarry keyword guide, landed outbox/client custody; auth review: failed-transition custody, read restoration barrier, session kind, paused offline retries; client-owned auth restoration and retry lifecycle; catalog naming rewrites, Clique L2; shared live transport, bounded derived verification, mutation-read guidance, installed consumer qualification)
**Related:** LLP 1000, LLP 1001 (the engine this serves), LLP 1003 (effects),
LLP 0329.016 §5 (the design this implements verbatim where it can), LLP
0329.016 §5.11 (the verb table — no verb exists without its row), LLP
0329.016 §8 (gates), LLP 0331 §"Failure and disclosure semantics" /
§"Amendment to ruling 0" (Draft Research influence, not a governing
Snapback2 spec), `issues/closed/20260830-snapback2-align-rules-with-llp-0331.md`

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
   life so successors compile warm. Nothing else is ever spawned, with one
   exception recorded by LLP 1006 §14a (amended 2026-09-03): the media helper
   `snapback2-media`, spawned per finalize job and short-lived, with a cleared
   environment, a timeout, and a memory ceiling — resource isolation for
   decoders, not a second worker.
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
   rows: Record<table, Row[]> }`; it is applied as one engine-owned `seed`
   commit; `reset` re-applies it. Personas are prefix-minted, and no seed row
   may carry the core-reserved system token in an `Id` or `Ref`.
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
  columns: { principal: t.principal(), displayName: t.text(50),
             handle: t.text(20), avatarUrl: t.optional(t.text(2048)),
             bio: t.text(200), location: t.text(50),
             link: t.optional(t.text(2048)) }, // application `id` and `byId` are implicit
  indexes: { byPrincipal: { columns: ['principal'], unique: true },
             byHandle: { columns: ['handle'], unique: true } },
  rules: { read: rule.public('profiles are public'), insert: rule.viewerIs('principal'),
           update: rule.viewerIs('principal'), delete: rule.deny() },
  constraints: [{ unique: 'byPrincipal' }, { unique: 'byHandle' },
                { immutable: ['principal'] },
                { text: { field: 'displayName', min: 1 } },
                { text: { field: 'handle', min: 3, format: 'handle' } },
                { text: { field: 'avatarUrl', format: 'url' } },
                { text: { field: 'link', format: 'url' } }],
})
export const conversations = table({
  columns: { title: t.text(120), creatorId: t.principal() },
  indexes: { byIdCreator: { columns: ['id', 'creatorId'], unique: true } },
  rules: { read: rule.exists(memberships, 'byConversationPrincipal',
             [rule.field('id'), rule.viewer]),
           insert: rule.viewerIs('creatorId'), update: rule.deny(), delete: rule.deny() },
  constraints: [{ finalExistsOnInsert: { table: 'memberships',
    index: 'byConversationPrincipalRole',
    key: [rule.field('id'), rule.field('creatorId'), rule.literal('admin')] } }],
})
// `var` permits this reciprocal static descriptor reference; authored modules are lowered, not executed.
export var memberships = table({
  columns: { conversationId: t.ref(conversations), principal: t.principal(),
             role: t.enum(['member', 'admin']), joinedAt: t.time() },
  indexes: {
    byConversationPrincipal: { columns: ['conversationId', 'principal'], unique: true },
    byConversationPrincipalRole: { columns: ['conversationId', 'principal', 'role'] },
  },
  rules: {
    read: rule.exists(memberships, 'byConversationPrincipal',
      [rule.field('conversationId'), rule.viewer]),
    insert: rule.or(
      rule.exists(memberships, 'byConversationPrincipalRole',
        [rule.field('conversationId'), rule.viewer, rule.literal('admin')]),
      rule.and(rule.viewerIs('principal'),
        rule.eq(rule.field('role'), rule.literal('admin')),
        rule.created(conversations, 'byIdCreator',
          [rule.field('conversationId'), rule.viewer]))),
    update: rule.and(
      rule.exists(memberships, 'byConversationPrincipalRole',
        [rule.oldField('conversationId'), rule.viewer, rule.literal('admin')]),
      rule.eq(rule.oldField('conversationId'), rule.nextField('conversationId')),
      rule.eq(rule.oldField('principal'), rule.nextField('principal')),
      rule.eq(rule.oldField('role'), rule.literal('member')),
      rule.eq(rule.nextField('role'), rule.literal('admin'))),
    delete: rule.or(rule.viewerIs('principal'),
      rule.exists(memberships, 'byConversationPrincipalRole',
        [rule.field('conversationId'), rule.viewer, rule.literal('admin')])),
  },
  constraints: [{ unique: 'byConversationPrincipal' },
                { immutable: ['conversationId', 'principal', 'joinedAt'] }],
})
export const typing = channel({ args: { conversationId: t.ref(conversations) },
  publish: rule.exists(memberships, 'byConversationPrincipal',
    [rule.field('conversationId'), rule.viewer]),
  subscribe: rule.exists(memberships, 'byConversationPrincipal',
    [rule.field('conversationId'), rule.viewer]), ttlMs: 4000 })
export default schema({
  auth: { password: true, guests: true },
  tables: { profiles, conversations, memberships, /* … */ },
  maintains: [{ count: 'messages', by: ['conversationId'], into: 'messageCounts' }],
  channels: { typing },
})
```

The canonical chat project is also the M1–M3 account/relationship/RBAC proof. Its
profile has viewer-derived immutable `principal`, unique handle, display-name
and handle minima, closed handle syntax, optional absolute avatar/link URLs,
and the agreed field maxima; identity email never enters the app table. Its
public posts carry a nominal author and remain globally readable under an
explicit `public(reason)` rule. A unique `(follower, followed)` row is an
ordinary public product-selection relationship: `followingFeed` traces it,
while `globalFeed` and the post table rule do not. `setFollow` derives the
follower from `ctx.viewer`, so unfollow changes Following selection without
granting or revoking post authority.

Conversation shells, membership rows, messages, and the maintained
`messageCounts` row are all readable only through the viewer's current
membership in that conversation. The canonical outsider journey reads the
conversation summary as a non-member and proves that neither its title nor its
maintained activity count crosses that boundary.

The implicit application `id` is insert/upsert data, not update data: `db.update`
patches omit it from their authored type, while every `db.upsert` row supplies
it and the engine requires it to equal the addressed key.

The serving owner supplies `ctx.newId()` from a namespace-qualified range whose
high-water mark is durably advanced before the range is exposed. Transaction
rejection, owner crash, reset, and restart can leave gaps but cannot repeat an
exposed id; the format is disjoint from legacy clock/counter ids. Read-only
queries and channels do not reserve ranges.

The group surface creates 2–50-person groups atomically: the creator is the
only bootstrap admin, every other initial seat is a member, and a conversation
cannot commit without that creator-admin seat. Current admins may add members,
promote member → admin, and remove another seat; any member may leave. Adding
the acting admin as a second seat is refused. Deliberately, there is no
last-admin invariant: a sole admin may leave, producing an adminless group
whose remaining members cannot mint authority. Remove/re-add creates a new row
identity; a captured operation against the removed id cannot retarget it.
Promote/remove bind the loaded target row to the authored conversation argument,
and the admin remove path refuses the viewer's own seat so self-departure stays
on the named leave path. A private message send admits both the sender and the
recipient through current memberships in that same conversation before it
inserts the message or emits its outbox row; a public profile is not delivery
authority, and a rejected send commits neither artifact.

`t`: `id()`, `principal()`, `text(max)`, `int()`, `bool()`, `time()`, `ref(table)`,
`json(maxBytes)`, `optional(x)`, `list(x, { max })`, and (folded 2026-08-30
from the column-type survey) `enum(['dm', 'group'])` and `decimal(scale)` /
`money(currency, scale = 2)`. `principal()` is the nominal authority scalar:
generated types use branded `Principal`, `ctx.viewer` has that type, and a
`Ref<table>` is rejected where `Principal` is required even though the current
wire encodes both as ID-shaped strings. A `Decimal` column or arg is typed
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
`decimal(9.99, 2)` helper produces it. Floats never exist anywhere. `rule`:
`public(reason)`, `allow()`, `deny()`, `eq(a,b)`, `ne(a,b)`, `and(…)`,
`or(…)`, `not(r)`, `exists(table, index, key[])`,
`created(table, index, key[])`, `system()`, `viewerIs(field)`
(= `eq(field(f), viewer)`); terms `field(name)`, `oldField(name)`,
`nextField(name)`, `viewer`, `literal(v)`. `rule.system()` is convenience syntax only and lowers exactly
to `Eq(Viewer, Literal(Id("system")))`; there is no `principal(kind)` surface
or `PrincipalKind` rule term. `rule.exists` and `rule.created` take exactly
three arguments. `created` is valid only in a table insert rule and proves an
exact indexed row was inserted earlier in that transaction. `oldField` and
`nextField` are valid only in table update rules; an update rule sees both row
images once, and ordinary `field` names the next image.
The compiler resolves every rule field and index, checks compatible operands
for `eq`/`ne`, requires exact point-probe key arity, and checks every key term
against its indexed column. In particular, `viewer` can inhabit only a
Principal position. The engine repeats those checks while certifying raw
project JSON, so handcrafted IR has no less strict lane.
Constraints add `text` and `finalExistsOnInsert` to `unique`, `cap`,
`appendOnly`, and `immutable`. The final-exists target table is a static string
(which avoids schema declaration cycles); its exact indexed point must exist at
the end of every execution that inserted a source row, or the transaction
rolls back.
Rule-input visibility is derived by LLP 1001 §9 from the referenced table's
active read policy, including its exact self-readable indexed-row proof; a
fourth visibility/options argument is a sited `E_RULE_INVALID` refusal and no
`input_visibility` value enters project JSON. Each admitted form lowers 1:1
to LLP 1001's `RuleExpr`/`RuleTerm`/`ColumnType`/`Constraint`/`Maintain`/
`Channel`. Programs are unchanged from spike S2 except that tables are
imported from `./schema` and `emit(effectRef, payload)` is a statement (LLP
1001 §8). `effect({...})` is LLP 1003 §1.

**Pinned certificate identity ruling (2026-08-30, Charlie Cheever via
orchestrator).** The compiler keeps inference, but its provenance rules are
closed: (1) literals are `Const`; (2) direct operation arguments are `Arg`;
(3) `ctx.viewer` is `Viewer`; (4) fields selected from proven row bindings are
`Shape`; (5) an explicit transform is `Computed`; and (6) a composite keeps its sole
non-`Const` origin, becomes `Shape` when origins mix, and is `Computed` when
any member is computed. A transparent immutable alias preserves that result.
Selecting a member from an object literal or immutable local composite follows
that member's origin; a property base not proven as either a row or such a
composite matches no rule.
`args` and `ctx` are composites in this domain (`args.<field>` is `Arg` and
`ctx.viewer` is `Viewer`), so assertions, helper substitution, immutable
aliases, nested composites, and spreads all use the same recursive member
selection. Object members resolve in authored override order; a required known
spread can decide the selected leaf, while an optional or unknown override with
different possible origins refuses. Collection items are classified as
alternatives at the selected remaining member path, never from the collection's
aggregate origin; disagreement between possible elements refuses. Identity
`map`, `filter`, ordering/slicing, aliases, and chains retain a proven row
collection, while a transforming `map` classifies its returned elements by the
same path-aware rule. Pure helper expansion applies the same rules to the helper
body and never to the helper name, is lexically captured, and refuses cycles or
expansion beyond 128 recursive levels. Lexical bindings take precedence over
spelling: only the handler's actual `args`/`ctx` bindings are composites, including
renamed destructuring bindings, and a stable `let` classifies exactly like a
`const`. Every binding form, including loop bindings and lowered collection
specializations, preserves ambiguity; an authored `orderedPair` destructuring
default is refused until it can be lowered rather than discarded. A nested path
under one declared operation argument (for example `args.payload.inner.key`)
remains `Arg`: provenance records the input origin while the full field path
remains in IR. An unknown or mutable binding matches no single rule and refuses
with `E_PROVENANCE_AMBIGUOUS`; the standard envelope carries family and source
site. Its pasted rewrite names only direct origins actually discovered through
the binding and member-selection path. Incomplete discovery retains every known
candidate plus an explicit `<unknown origin>` marker in an intentionally
non-lowerable sentinel expression; member names never guess an argument. A
multi-origin or unknown-origin refusal therefore never has a compiling paste.

**Collection mutation ruling (2026-08-31, Charlie Cheever).** Mutation is
admitted only on a collection locally allocated in the handler from a literal
or spread copy, with one binding identity and no alias before or after the
mutation; the admitted empty `Map`/`Set` constructors lower to the same local
array ownership. A collection selected from another structure, an operation
argument, or a binding connected to another name refuses at the mutation site
with a rewrite that makes an explicit local spread copy. Branch alternatives
merge their collection mutation deltas by maximum. Nested loop deltas compose
multiplicatively through every statically bounded level; a composition the
compiler cannot prove refuses in the `E_UNBOUND` family instead of certifying
an additive underestimate. The mutation analysis follows lowering order: it
sees body-local declarations and reserves every inherited collection to its
proven end-of-loop facts before emitting a nested loop domain. Mutation counts
whose controlling collection keeps growing instead of reaching the bounded
analysis fixed point refuse `E_UNBOUND_LOOP`.

Aliasing is closed over syntactic escapes, not only identifier assignments. A
collection escapes when it appears as a call argument, an object/array member,
a return value, or a ternary/logical arm. A mutation after such an escape
refuses at the mutation with the same spread-copy rewrite; read-only escaped
collections and an escape after the final mutation remain admitted. This is
deliberately conservative: whether a helper retains or copies its argument is
not part of the proof. Conditional-expression statements fork and merge the
same environments as `if`/`else`.

Read-site
identity is independently pinned to `<module-basename>.<export>.<ordinal>`,
where the zero-based ordinal follows read/write source order inside that export
and is shared through helper expansion. Operands lower once in authored order;
writes reserve their ordinal even though the current `WriteSite` serde shape has
no site string. Local names and formatting are not inputs.

**Collection identity amendment (implemented 2026-09-01).** Map keys and Set
values are restricted to authored primitive strings, numbers, booleans, or
null. Their array-backed lowering compares with JavaScript `SameValueZero`,
including treating the IR's `Id` and `String` tags as the same authored string;
unlike ordinary IR `Eq`, it never substitutes structural equality. Composite
Map keys and Set values refuse at compile time because bounded data IR carries
values, not JavaScript object identities. Map values remain unrestricted. Map
construction and `set` materialize each key before any later value setup so
modeled inputs retain authored operand order.

## 3. The compiler worker and the project JSON

Protocol, JSON lines on stdin/stdout, one request in flight:

```
→ { "id": 0, "op": "probe", "root": "/abs/project" }
← { "id": 0, "ok": true, "protocol": "snapback2/compiler-worker/v1", "operations": ["compile", "seed", "journeys"] }
← { "id": 0, "ok": false, "protocol": "snapback2/compiler-worker/v1", "operations": ["compile", "seed", "journeys"], "dependency": "compiler-core.mjs" | "typescript" }
→ { "id": 1, "op": "compile", "root": "/abs/project" }
← { "id": 1, "ok": true, "project": <ProjectJson>, "sources": { "todos.list": { "file": "snapback/todos.ts", "line": 14, "col": 14 } }, "apiDts": "<text>", "ms": 212 }
← { "id": 1, "ok": false, "diagnostics": [ <Refusal> ] }        // ALL diagnostics, one per module at least
→ { "id": 2, "op": "seed", "root": "…" }  ← { "id": 2, "ok": true, "seed": { "personas": [...], "rows": {...} } }
→ { "id": 3, "op": "journeys", "root": "…" }  ← { "id": 3, "ok": true, "files": ["snapback/tests/todos.test.ts"] }
```

`probe` is the lightweight `doctor` handshake. It verifies the fixed compiler
chunk and the TypeScript dependency before returning the exact protocol token;
the binary also requires the matching request id and exact lowering-operation
set. The worker lazily loads that heavy compiler chunk for `compile`, `seed`,
and `journeys`. A missing closure leaf becomes stable `E_OWNER_NO_COMPILER`
guidance; it is not disguised as an operation refusal. The blocking compiler
and isolated-package tests execute every advertised lowering operation.

`ProjectJson` is LLP 1001 §4's serde shape, with `programs[].name` qualified
(`todos.list`) and `schema.effects` listing the effect names. The compiler's
`rule.system()` lowering consumes the core-owned
`snapback2-core/ir-contract.json` token rather than spelling a second copy.
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

Quarry naming refusals derive candidate indexes, key columns, and nominal types
from the catalog. A wrong key reports expected and actual types. An unambiguous
replacement expression survives the Quarry diagnostic remap as executable
`rewrite` text; guidance without a concrete edit remains a comment (Clique L2,
GPT-6 Astra, 2026-09-05).
A bare `refuse()` uses its message as the rewrite; unexpected caught failures do likewise.
The registered Quarry language checks live in `src/quarry-language-checks.ts`, keeping `src/test.ts` within the source line cap.

`api.d.ts` (written to `.snapback/build/api.d.ts`, never committed) augments
the client's `Api` interface with every op's arg and result types, inferred
from the authored modules by the `typescript` checker:

```ts
declare module 'snapback2/client' { interface Api { todos: { list: Op<{ take?: number }, Todo[]>; add: Op<{ title: string }, { id: string }> } } }
```

## 4. The wire

HTTP/1.1, JSON bodies, `Content-Type: application/json`; CORS `*` in `dev`
mode with preflight methods `GET, POST, OPTIONS` (cross-origin SSE needs
`GET`). The allowed request headers are `Authorization`, `Content-Type`, and
`X-Snapback-As`; `X-Snapback-Control` is deliberately excluded, so a web page
cannot preflight access to the local control capability. Every refusal on every route — including a rejected mutation and a
channel refusal — carries the full envelope below; `guide` and `family` are
required fields in the client's public types as well as in its validator. Authentication: `Authorization: Bearer <token>`; in `dev` mode
`X-Snapback-As: <name>` selects a persona (created on first use; §1.6).

| route | body → response |
|---|---|
| `GET /` | `{ ok, version, generation, mode, url }` |
| `POST /api/auth/signup` | `{ email, password }` → `{ token, viewer }` |
| `POST /api/auth/login` | `{ email, password }` → `{ token, viewer }` |
| `POST /api/auth/guest` | `{}` → `{ token, viewer }` |
| `POST /api/auth/logout` | → `{ ok }` |
| `GET /api/auth/me` | → `{ viewer, kind }` |
| `POST /api/query` | `{ op, args }` → complete/capped `{ state, data, seq, next: cursor \| null }`, partial `{ state, data?, seq, reason }`, or denied `{ state, seq, rule }` |
| `POST /api/mutation` | `{ op, args }` → `{ state: "committed", seq, data }` \| `{ state: "rejected", code, family, message, rewrite? }` |
| `GET /api/subscribe?op=&args=<urlencoded json>` | SSE; `id: <seq>`; each `data:` frame is **exactly a query response object** (`{ state: "complete" \| "capped" \| "partial" \| "denied", data, seq, … }`) or a refusal envelope (`{ state: "refused", code, family, message, … }`, terminal); the server never sends `live`/`stale` — those are client connection facts; a `: heartbeat` comment every 15 s (review ruling 2026-08-30) |
| `POST /api/channel/<name>/publish` | `{ args, payload }` → `{ ok: true }` \| `{ state: "refused", code }` |
| `GET /api/channel/<name>/subscribe?args=` | SSE; `data: { from, payload, at }`; the owner drops the stream when a commit touches the probe's key and re-admission fails |
| `GET /api/manifest` | `{ generation, ops: { "todos.list": { kind, args } }, channels, auth }` |

**Shared live transport (2026-09-05; implementer: Codex, this change).** The
public client multiplexes query and channel subscriptions on one SSE connection
per client and authority. `POST /api/live` opens it and first emits
`data: {"session":"<random capability>"}`. `POST /api/live/control` carries
`{ session, add: [{ id, path, lastEventId? }], remove: [id] }`, or
`{ session, close: true }`; it returns `{ ok: true }`. Controls require the
same bearer/persona as the connection. Every child is independently admitted by
the existing owner query/channel action; the stream capability grants no data
authority. A child path is only a query or channel subscription path, including
its existing receipt/validator arguments.

Deliveries are `data: { id, seq: number|null, data, terminal }`; `data` keeps the
existing query/channel envelope. A disconnected child emits `{ id, closed:
true }`. Terminal errors stop only that child; authentication expiry still
fences the client's exact bearer. Subscription ids are unique within the
connection. Adds/removes are batched and serialized by the client, so changing
the mounted set does not interrupt other live queries or ephemeral channels.
Physical connection loss makes each logical subscription retry through its
existing stale/offline and authorization rules. Query reconnect is full
re-delivery (or the existing receipt validator path), not event-id replay;
channels do not replay missed ephemeral events. Heartbeats remain 15 seconds.

One physical stream consumes one SSE worker (48 available under the current
server budget); one client supports 256 logical subscriptions. Each owner
child retains its bounded single-slot queue: query deliveries coalesce and
channel overflow disconnects that child. Client demultiplexing similarly bounds
pending query data and refuses an overflowing channel consumer. The shared
stream lasts until client close, offline, authority replacement, or network
loss; close explicitly releases its owner children. Standalone GET subscription
routes remain available to raw wire consumers and the CLI proof harness.

This replaces the public client's connection-per-subscription transport. It
works on the existing HTTP/1.1 local server and needs no TLS or HTTP/2 setup.
The Chromium 153 probe received all 60 live query deliveries, then a mutation
update on every query and an ordinary query result, over one HTTP/1.1 SSE
connection. This is transport qualification, not a new Clique benchmark result.

**Native logical streams (2026-09-06; GPT-6 Astra, `s2/clique-native-sync`).**
Demultiplexed children pass `{ ok: true, body }` directly to the SSE consumer;
they are not HTTP responses. React Native 0.81.5's global `Response`
(`whatwg-fetch` 3.6.20) accepts a stream but exposes no `body`, even when
`createExpoClient` uses the streaming `expo/fetch` (LLP 1013 §2, decision 6).
Reconstructing a child with that constructor caused published 0.0.6's native
`E_NETWORK: SSE response has no body`. Physical fetch responses still undergo
HTTP validation; logical framing, terminal authority evidence, and cancellation
are unchanged. Regressions use the actual native constructor with a separate
streaming fetch fixture. They do not qualify a device: the recorded Clique
native M6 acceptance remains **FAILED** until separately rerun.

**Wire amendments — 2026-08-30/2026-09-03.** `Capped` carries no `take`, site,
or stop reason. Complete/capped alone carry `next`; complete and empty capped
use `null`, while nonempty capped uses the last returned result-page row
(LLP 1001 §3). Partial, denied, mutations, and refusals omit it.

Typed states are 200. Protocol errors are 4xx with the **refusal envelope**,
which is the only error shape on every surface (HTTP, CLI `--json`, worker):

```json
{ "code": "E_BOUND_TAKE_REQUIRED", "family": "bound", "message": "…", "site": "snapback/todos.ts:14:9",
  "rule": "every scan names take", "rewrite": "scan(todos.byOwner, [ctx.viewer], { take: 100 })", "guide": "bound/scan" }
```

A mutation denied by a table rule is the stable envelope
`{ state: "rejected", code: "E_RULE", family: "rule", guide: "rule/runtime", … }`;
the wire never shortens that code to `rule` or misclassifies it as input.

Families (this wave): `bound`, `opaque`, `schema`, `rule`, `auth`, `args`,
`op`, `successor`, `effect`, `input`, `owner`. A code without a family, a
site (where one exists), and a `guide` slug is a bug.

Control routes (loopback only, `X-Snapback-Control: <secret>` from
`owner.json`): `GET /control/status`, `POST /control/apply { project }`,
`POST /control/migrate { project, plan }`, `POST /control/reset`,
`POST /control/fork { name }`, `GET /control/logs?since=<seq>&limit=`,
`GET /control/personas`, `POST /control/persona { name }`,
`POST /control/why { op, args, as }`, `GET /control/trace?seq=`,
`GET /control/subscriptions`, `POST /control/verdicts { table, as }`
(the engine's read-rule verdict for EVERY stored row of the table under a persona — an ad-hoc certified read
that never touches the served generation; `test`'s rules check uses it),
`POST /control/outbox/<id>/requeue`, `POST /control/clock { advanceMs }`,
`POST /control/stop { cause }`.

Clock advances are non-negative. A negative `advanceMs` is refused before the
owner changes its offset, sweeps sessions, or reruns live state.

## 5. The owner

- **Start.** `dev` → compile (worker) → `Generation::certify` → open
  `.snapback/store.sqlite` → `Runtime::open` (or successor) → bind a free
  loopback port (or `--port`, honored or refused `E_OWNER_PORT_TAKEN`) → write
  `owner.json { pid, port, url, secret, generation, startedAt, mode }` → print
  exactly one line `SNAPBACK_URL=http://127.0.0.1:<port>` (and the JSON form
  under `--json`) → detach: the foreground process exits 0 after the owner
  is ready; the owner runs with stdin closed and stdout/stderr to
  `.snapback/log.jsonl`. `--foreground` keeps it attached (for `test` and
  CI). Owner startup refuses a symlinked/non-directory `.snapback/`, otherwise
  creates or repairs it to mode `0700` on Unix; `owner.json` is atomically
  replaced from an unpredictable, create-new, mode-`0600` temporary file. Its
  256-bit control secret always comes from the operating-system CSPRNG.
- **Attach.** If `owner.json` names a live pid whose `/control/status`
  answers with the same project root, print the same line and exit 0. Keyed
  by project root, not port.
- **Watch.** Poll `snapback/**/*.ts` mtimes every 200 ms; on change,
  compile → certify → `apply_successor`; on refusal, log it, keep serving the
  last generation, and answer `/control/status` with `applying`/`refused`
  (+ the plan, written to `.snapback/migration-<gen>.json`). Subscriptions
  re-execute and deliver on an applied successor. Once the watcher has saved a
  destructive plan, its refusal carries `migrationFile` and `applyCommand`:
  `snapback2 dev --project '<absolute root>' --apply-migration '<absolute plan>'`,
  with shell-quoted paths. Review the plan before running that command while the
  owner remains running; `dev --status` then shows `ready` and the plan's generation.
  A failed plan write reports that failure instead of offering an application command.
  Relative `--apply-migration` paths resolve from the command's working directory,
  even with `--project`. `check` compiles, certifies, and refreshes the build cache;
  it does not install the checked generation. A refused successor keeps the old
  generation active until explicitly applied or replaced by an admitted successor.
- **Exit.** Only `dev --stop`, a signal, or a fatal error; every exit writes
  `{ exited: cause }` to the log and removes `owner.json`. No exit 0 with an
  empty stdout.
- **Threads.** One writer thread owns the `Runtime` behind a channel; HTTP
  connections are threads (`tiny_http` or std-only); SSE streams hold a
  receiver and are fanned out by the writer after each commit
  (`invalidated` → `rerun` → deliveries; `changed: false` is not sent). No
  tokio.
- **Mutation ids.** Mutation and effect-then contexts reserve a fixed id range
  through the runtime's narrow allocator API. The store commits its allocator
  high-water mark before the context can consume the range. Queries, live
  query re-execution, channel operations, and other read-only contexts carry
  no allocator range.
- **Session authority.** Every bearer action resolves to
  `(Principal, auth_epoch, expires_at)` in the writer before an engine context
  is built. Live-query and channel entries retain that exact epoch, not only
  the principal. The writer sweeps persisted expiries before dispatch, after a
  development-clock advance, before fan-out, and on a bounded `recv_timeout`
  while otherwise idle. Bearer resolution and logout repeat that sweep using
  the exact same captured clock sample used for authentication, so crossing
  the expiry boundary after an earlier dispatch sweep cannot delete an epoch
  before its retained streams are fenced. Logout deletes and fences only the matching epoch;
  its live/query and channel streams receive terminal `E_AUTH_SESSION`, while
  another session for the same principal continues. An action admitted before
  an expiry/logout may finish; the logout response is produced only after all
  earlier writer actions settle, the session row is gone, and its terminal
  events are queued. Later actions cannot authenticate. HTTP heartbeats are
  not an authorization timer.
- **Owner states** on `/control/status`: `ready | applying(gen) |
  refused(plan) | exited(cause)`, plus `generation`, `seq`, `subscriptions`,
  `effects` (LLP 1003's runner state), `personas`.

## 6. Verbs (this wave)

Every verb: `--json`, `--as <persona>` where a principal matters, capped
output with a `…and N more (--limit)` hint, no prompt without a TTY, exit 0
ok / 1 refused (typed) / 2 usage or environment. No arguments, `--help`, and
`-h` show command summaries and exit 0. Every existing command accepts `--help`
or `-h` before project lookup, compilation, or owner actions; unknown command
names still exit 2. `init` help includes the defaults, supported template/client
combinations, and an executable initialization sequence; `dev` and `check` help
distinguish source validation from owner installation.

| verb | syntax | does |
|---|---|---|
| `init` | `snapback2 init [dir] [--template chat\|todos] [--client react\|none]` | idempotent scaffold (§10) |
| `check` | `snapback2 check [--project dir]` | compile + certify + write the build cache; prints `ok <gen> <N> ops` or every refusal |
| `dev` | `snapback2 dev [--port N] [--foreground] [--stop] [--status] [--apply-migration file] [--serve]` | §5 |
| `run` | `snapback2 run <op> [args-json] --as <persona\|system>`; `--file`, `--plan`, `--wait`, `--cancel`, `--resume` | one query/mutation or a queued job through the owner (LLP 1016 D6) |
| `test` | `snapback2 test [--blocked reason] [--journeys-only] [--derived-only]` | §7 |
| `why` | `snapback2 why <query> [args-json] --as <persona>` | §8 |
| `trace` | `snapback2 trace <seq \| latest \| job_id>` | §8 |
| `data` | `snapback2 data <table> [--index name --prefix json] [--after token] [--limit 50] --as <persona>` | bounded rule-checked paging as the persona; prints `next` (limit ≤ 500) |
| `logs` | `snapback2 logs [--since seq] [--limit 100]` | structured log lines from `log.jsonl` + `_commits` |
| `persona` | `snapback2 persona list` | dev personas; first use creates them |
| `reset` | `snapback2 reset` | `reset_data` + seed, including clearing jobs |
| `guide` | `snapback2 guide [grammar \| app \| <symbol> \| <E_CODE> \| <recipe>]` | §8 |
| `doctor` | `snapback2 doctor` | today's, plus: compiler worker found and answers; effects engine state; owner state if any |

**Amendment 2026-09-05 (LLP 1016 J1b):** `fork` and `persona create` CLI adapters are deleted; `POST /control/fork` and `Store::snapshot_to` remain. `run` operates jobs and ad hoc files; `trace` also accepts job IDs.

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
   row sees none of the owner-scoped rows. The accepted seed is exhaustive, not
   row-sampled: reserve at most 16,384 row/persona probes across restricted
   tables before executing them. For a maintained table the total seed-row
   count is a conservative upper bound. A table that exceeds the remaining
   budget is `blocked` with its row bound, persona count, and a rewrite to use
   a smaller representative seed and authored journeys for larger scenarios.
   Other check families still run. Paging is limited by the seeded row bound;
   a repeated non-null cursor fails, while `capped` with no cursor remains
   the deliberate non-uniform-rule terminal form.
3. `bounds` — every query runs as every seed persona; its authoritative trace
   is `⊆` its certificate (`E_TRACE_SUBSET` is the failure). Derived `t.ref`
   arguments take IDs only from that table's seed rows; a bare `<x>Id: t.id()`
   resolves an unambiguous singular/plural table name or blocks rather than
   guessing an unrelated seed row.
4. `invalidation` — subscribe, capture that retained subscription's exact stored
   authoritative trace, run a persona-seed mutation (seed-derived arguments
   under a seeded or deterministic synthetic dev persona), and independently
   intersect the trace's exact/range keys with the commit's physical `touched`
   keys. Re-run the query to compare its before/after state and result. A
   concrete overlap whose output changed must
   record invalidation and produce an SSE delivery at the commit's exact
   `seq`; an overlap whose output stayed equal must record invalidation and
   preserve SSE silence; a concrete key-disjoint write must record neither
   invalidation nor delivery and preserve silence. A zero-write committed
   response is not evidence and the harness tries a later deterministic
   candidate. This corrects the former static-site/unconditional-delivery
   wording: a fresh-scope insert cannot affect an existing scope, and a role
   update may require a conservative rerun without changing the visible
   query result. Static certificate intersections only prioritize candidates;
   they do not decide concrete overlap. For each query, group mutations by
   their certificate-intersection signature (the set of shared table/index
   sites, including an empty signature). Witness one physical representative
   per group, plus concrete-disjoint silence per query. This is representative
   invalidation coverage, not proof of every operation pair: the receipt lists
   each group's candidate operations and whether it was witnessed, and each
   actual rejected, zero-write, or physical attempt with its exact oracle
   disposition. Operation-specific behavior belongs in authored journeys;
   every generic mutation still receives its own independent replay check.
   Candidate search uses the first two seeded scopes and first six personas
   (at most 12), in deterministic seed order. Each query spends at most 32
   attempts finding group witnesses and 64 including the silence fallback;
   missing evidence or budget exhaustion blocks, never passes. Effect `then` mutations
   are recorded as excluded system-only continuations here and remain covered
   by replay through the engine's purpose-specific private system entry point,
   not by inventing a privileged served persona.
5. `replay` — every seed mutation, run twice against two forks of the seeded
   store with the same pinned `now`/`newId`s, yields byte-identical traces.
   The same 12-candidate search applies; lack of a committing witness blocks
   and the receipt states the selection limit.
   **Revision 2026-09-04:** an asset-typed mutation is recorded as `skipped` in both invalidation and replay with reason `E_ASSET_PROBE_NEEDS_UPLOAD` ("asset-typed arguments are proven by an upload journey, not the generic prover"), which is a pass-with-note because only the upload journey can mint the ready ledger row that LLP 1006 §6 requires.
6. `effects` — every effect declaration has a runner able to run it, or the
   check is `blocked: no engine in this build` (LLP 1003 §4).

**Named authorization proofs.** The canonical chat/alignment qualification
records the following stable proof names in its test receipt; a lower-level
unit test may support one but does not replace the served-loop proof:

7. `live-revocation` — subscribe as a currently admitted conversation
   member, delete that exact membership through a named mutation, and require
   the next delivery at the mutation's `seq` to be `denied`. An unchanged or
   empty payload does not suppress the state transition, and no
   post-revocation row is delivered.
8. `successor-policy-fence` — retain a subscription/request handle from
   generation G, apply G+1 with a denying replacement policy, and require the
   retained handle and a fresh invocation to resolve under G+1. A predecessor
   program/certificate is rejected or replanned; it never runs against the
   current store through the served surface. Generation identity is
   schema-scoped, so a program-only replacement may carry G's generation hash;
   the receipt also binds the predecessor and replacement certificate
   `plan_hash` values and requires them to differ. Cleanup always reapplies the
   exact original project instead of treating a matching schema hash as proof
   that the original program is active.
9. `grant-incarnation-aba` — capture an intent against one membership row,
   remove it, recreate the same `(scope, principal)` relation with a new
   immutable row identity/incarnation or version across an owner restart,
   replay the captured intent, and require refusal with the successor row
   unchanged. A generated successor id must differ from the removed id; a
   process-local allocator does not satisfy this proof.

The scoped-authority alignment cannot be reported complete unless all three
pass on that fixture. An unrelated project with no scoped relationship does
not synthesize them. If a project or qualification declares the canonical
membership recipe but lacks enough seed/program evidence to run an applicable
proof safely, that proof is `blocked` with the reason, not silently reported
as pass. LLP 0331 motivated these cases as research; this implemented spec
and LLP 1001 own their Snapback2 contract.

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
  Denied read sites also carry local `E_RULE` diagnostics with a site,
  rewrite, and `auth` recipe pointer: mutation lookups obey the same read
  authority, and write permission does not elevate them. These diagnostics
  never enter served execution envelopes; hidden and missing point reads
  retain the same ordinary result. To inspect a mutation lookup without
  writes, use a query containing that lookup. `why` refuses mutation names
  with `E_OP_KIND` before execution: the CLI sends `queryOnly: true`, checked
  against the active operation by the owner, so hot successors cannot turn
  inspection into a write. The protected `/control/why` harness retains its
  mutation execution for collecting authoritative offline-replay traces.
- `trace <seq>`: the commit record (program, principal, writes, touched
  keys), the outbox rows it emitted and their real states, and the
  subscriptions it invalidated with their delivery seqs — intent → commit →
  invalidation → delivery — read from the owner's bounded per-commit ledger
  (last 1,000 commits, per owner lifetime — a commit older than the current
  owner's start reports `ledger: unavailable (owner restarted at <ts>)`, never
  empty arrays) and the store's `_outbox`, never reconstructed from program
  syntax or the current subscription set (review rulings 2026-08-30).
- `guide`: `grammar` (one screen, hand-written, in the package), `app`
  (tables, rules, ops with bounds, channels, personas — from the generation),
  `<symbol>` (the JSDoc on the `snapback2` module's declaration), `<E_CODE>`
  (the family's wrong/right pair), `<recipe>` (`auth`, `live-query`,
  `effects`, `offline`, `personas`, `operator`, `job`, `schedule`, `quarry`,
  `testing` — budgeted Markdown files shipped in the package). After page, refusal,
  and symbol lookup, `<keyword>` serves its grammar line and defining paragraph
  from an index generated at package build time from
  the existing guide pages; a matching symbol keeps its declaration and gains that
  excerpt under one header. Missing, unreadable, or invalid keyword indexes never
  suppress a symbol hit. A keyword-only lookup with a missing index is unknown;
  unreadable or invalid indexes return `E_OWNER_GUIDE` only when keyword help is
  needed. Unknown-name guidance includes index keys when readable. `--json` keeps
  `{ page, content }`; no pages are scanned at lookup time.
  `guide init`, `guide dev`, and `guide check` serve the corresponding built-in
  command help before symbol lookup, keeping the same `{ page, content }` envelope.
  The remaining guide bytes are served from the package, not embedded in the binary.

## 9. The client (`snapback2/client`, `snapback2/react`, `snapback2/test`)

```ts
const client = createClient({ url, token?, tokenStore? } | { url, as }) // storage is explicitly keyed; `as` is dev-only and exclusive
await client.ready                                  // restore barrier before any data request
client.auth.signup / login / guest / logout / me
await client.query(api.todos.list, { take: 50 })       // → { state, data, seq, … } — never throws on a typed state
await client.mutation(api.todos.add, { title })       // → committed | rejected | queued
const sub = client.subscribe(api.todos.list, args, (r) => …)   // SSE; { state: live|stale|refused|partial }; sub.close(); sub.until(pred)
client.channel(api.typing, args).publish(payload) / .subscribe(cb)
```

`api` is a proxy (`api.todos.list` → `{ op: 'todos.list' }`) typed *only* by
the `Api` augmentation in `.snapback/build/api.d.ts` (no index signature: a
typo is a compile error; channels are members too). The view on `useQuery`
is the discriminated union `hydrating | complete | capped | partial | denied
| refused | stale`, each carrying its applicable receipt fields (`reason`,
`rule`, `since`, `seq`; complete/capped carry `next: Cursor | null`), plus two orthogonal
facts: `live: boolean` (a
subscription is connected and this view is its latest delivery — the RFC's
"live" state is this flag, so a capped page on a live query is `capped` with
`live: true`) and `connection`. A transport failure (network, HTTP 5xx, a
stream idle past 2× the heartbeat) is `stale(since)` with reconnect and
backoff; only a 4xx envelope on the stream is a terminal `refused`; `useMutation` returns
`{ run, inFlight, pending, ready, status, last, transport }`: `inFlight` marks an
active call, `pending` lists this operation's durable queued intents, and `last`
is `committed | rejected | queued`. With local-first custody (LLP 1012 §7),
`queued` means saved on the device for FIFO replay after resume; transport loss
keeps the same intent for retry. `status: OutboxStatus` explains readiness,
the next action, queued count, and fence; `useOutbox()` exposes entries, and
`outbox.drain()`/`settled()` return `{ stopped, remaining }` (`OutboxSettlement`).
A thrown transport failure leaves `last` untouched, sets `transport` (a
retryable `SnapbackRefusal`, cleared by a successful run), and rejects `run()`;
a 503 after commit must never look like a server rejection.
Every 4xx envelope on `query()`/`mutation()`
throws `SnapbackRefusal`; subscriptions deliver `refused`. **Transport status
is not a query state**: hooks and the provider expose `connection: connected |
reconnecting | offline` separately, and a network failure leaves a query
`hydrating` with `connection: reconnecting`, never `refused`.

The default fetch transport binds the host global receiver, so browser JSON
and SSE requests work without a custom fetch wrapper. An explicitly supplied
fetch implementation retains its existing invocation contract.

The headless client is the sole auth owner. An `AuthTokenStore` has explicit
`load()` and `save(token | null)` methods; the package exports a browser
storage adapter, but never chooses `localStorage`, `sessionStorage`, or any
other persistent custody by default. The adapter requires a non-empty,
backend-specific storage key; a client rejects `as` combined with `token` or
`tokenStore`, so a request never carries ambiguous persona and bearer
authority; raw requests carrying both are refused too. Persona clients cannot
run signup, login, guest, or logout bearer transitions. `client.ready` settles the initial load
before any query, mutation, subscription, channel action, or `me` request can
reach the network. Browser storage protects restart continuity, not XSS: code
executing in the page origin can read a bearer held by browser JavaScript.

`snapshot.auth` owns the single auth state machine for the client; all React,
Expo, and React Native `useAuth()` instances render that snapshot. Its states
are `hydrating`, `authenticated` with `viewer`, `anonymous`, and `refused` with
a refusal envelope. A stored bearer starts restoration without a mounted hook;
persona and tokenless clients keep their lazy first `me()` check. All callers
join one in-flight `me()`. During hydrating, `restoringViewer` may show only a
previously confirmed principal bound to the current token. It is display
continuity, never fresh authorization or a reason to run an additional query;
LLP 1012's partition, epoch, and coverage fences still decide offline reads.

A transport-class restoration failure with a bearer stays hydrating, retains
custody, and schedules retries after 1, 2, 4, 8, 16, then at most 30 seconds.
`retryAt` is the next scheduled Unix time in milliseconds. A subsequent
connection transition to `connected` or `reconnecting` retries immediately;
connection changes caused by that auth request cannot trigger another attempt.
Only `E_AUTH`, `E_AUTH_REQUIRED`, and `E_AUTH_SESSION` make a failed `me()`
anonymous and clear custody (expiry still seals the offline partition). Other
coded refusals remain refused and get one attempt per reconnect. Storage and
protocol failures remain visible, without automatic retries. Logout, authority
replacement, account switch, restart, and close stop timers and suppress old
responses, including responses from a transport that ignores abort. Session
replacement publishes its new viewer with its token and auth generation only
after custody has settled, including the wire's `kind` and `authEpoch`. A
failed signup/login/guest attempt whose custody is unchanged preserves the
confirmed auth snapshot, or resumes hydrating with a retry timer if it
interrupted restoration. Metadata/resume failures reject `ready` without
replacing already-confirmed auth. Hooks wait for `ready` before deciding whether
a tokenless client needs its lazy first `me()`.

While a bearer is hydrating, mounted reads wait for confirmation or answer
from existing offline coverage; the token-bound display field supplies no
network authority. Explicit `me()` replaces its backoff timer. `offline()`
pauses retry clocks without splitting a pending `me()` flight; an offline
restart remains paused until `online()`. An online restart starts the new
client's normal restoration. A closed client's `auth` is only its last view, without `retryAt` or any
current-authorization claim. Anonymous snapshots omit `refusal`.

The client maintains a local monotonically increasing `authGeneration` that
is never the server bearer or epoch. Signup, login, guest, logout, restore,
expiry, and principal replacement are serialized transitions. Before a
successor token/anonymous snapshot becomes observable, persistence has
settled, every old query/channel transport is closed, delayed old-generation
responses are suppressed, and React query identity moves to the new cache
partition. A terminal `E_AUTH_SESSION` clears current and persisted custody
and never reconnects the old bearer. Terminal evidence is keyed by the bearer,
not discarded merely because an overlapping transition already fenced its
request: cleanup runs on its own serialized custody queue, clears only while
that bearer remains current, and carries a completion marker so a replacement
started during slow persistence still suppresses the old response. Successful
replacement custody is never cleared by a delayed predecessor response.
Closing during persistence never resurrects the instance or changes it from
`offline`; a login token whose durable save completed may remain available to
a future client's explicit restore, while the closed operation rejects.
Explicit transitions wait for already
dispatched writes to settle; operations queued behind the barrier use only the
successor authority. A locally suppressed response is never represented as a
server `rejected` mutation because it may already have committed.

Local-first custody is implemented in LLP 1012: the durable range store and
FIFO outbox follow its partition sealing, wiping, and replay-fence rules
(§§4–7), alongside the in-memory transport and React cache identity fences.

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
  and are assigned the standalone TypeScript twin; the Contract-native
  (Exact 2) arm hosts none and links `snapback2-core`'s interpreter. Both run
  the merged RBAC, Bytes, and capped-completeness corpus. The public web and
  Expo clients carry certified programs and held receipts for the twin's
  offline reads and queued mutation predictions (LLP 1012 §§6–7). Two
  evaluator implementations, assigned by runtime, never a third.
- **Coverage is client-issuable; absence and authorization are not**
  (LLP 0329.021 P5): the twin never manufactures an absence or a verdict; a
  read whose result depends on an absence the receipt does not carry is
  `partial`, never `complete`. A held hidden relationship row is not
  authorization: replay requires an exact rule-hash/input-digest/principal/
  epoch verdict, and a miss is `partial(missing-authority)`. Negation cannot
  invert that unknown into access, and a local mutation that observes it rolls
  back every tentative write before returning partial. The same authority
  rule binds maintained targets: prediction starts an aggregate at zero only
  from an exact authority-issued `byId` absence, or updates a held target row;
  an unheld target with no absence rolls the mutation back as partial.
`SnapbackProvider({ url, as? })` and an optional `<DevOverlay/>` (persona,
connection, generation, last refusal).
Reconnect with backoff; a lost SSE stream reports `stale(since)` until the
first delivery after reconnect. The evaluator twin gains `Emit` as a
no-op that consumes one id (LLP 1001 §8) and one corpus case proving it.

## 10. `init`

Idempotent: writes only files that do not exist, updates the managed block
in `AGENTS.md` (≤ 40 lines: the five verbs an agent needs, the grammar
pointer, three gotchas), adds `.snapback/` to `.gitignore`, adds
`.snapback/build/api.d.ts` to `tsconfig.json` `include`, pins `snapback2` in
`package.json`. Templates: `todos` (one table, two ops, a seed, one journey)
and `chat` (profiles, posts, follows, conversations, memberships, messages,
typing channel, a `notify` effect, seed, and account/relationship/RBAC journeys) — the chat template
carries the account-, relationship-, and scoped-role-relevant Clique M1–M3 shape.
`--client react` adds a Vite React app under `src/` that reads
`VITE_SNAPBACK_URL`. `init` then runs `check` and prints the next command.

## 11. Measured

`scripts/measure.mjs` measures `check_project_s` (`check` on the chat
fixture), `init_to_dev_s` (`init` → `dev` ready, fresh dir), and
`consumer_smoke_s` (pack the current binary/helper and built shim, install
those tarballs in a temporary consumer, then run the installed `doctor`,
`guide auth`, public client/React imports, and both templates' React build,
`init`, `check`, `dev`, and `test`). The consumer uses no workspace links or
compiler/template environment overrides. Every step and receipt verdict is
recorded. The installed-consumer rung replaces the duplicate core-test run;
`test.sh` retains the complete Rust executable tests and doctests.

The whole consumer rung, including packing and installation, is scored against
30 s. An engine-less development build accepts only an explicit `effects`
blocked receipt whose other checks all pass; zero checks cannot pass.
Publication repeats this consumer proof against the actual staged production
tarballs and requires every check to pass, including effects. The packed
README travels with the compiler, client, templates, and guide. Gates from
`rules/RULES.md`: `check` < 1 s, `doctor` < 0.5 s; from LLP 0329.016 §8:
`init` → `dev` ≤ 10 s. This implements LLP 1007 §5 item 7 (2026-09-05).

## Deferred (not binding)

`deploy`/`rollback`, `secret`, previews, claim codes, export, MCP, `--changed`,
persona grants, the Expo and Exact 2 arms, result diffs on the wire, the
schedule kind, retention.

## Author decisions and open questions

0. **The surface, after LLP 0329.017.** A Contract-block (additive) front end
   lowers 17/17 S1 programs and refuses 8/8 first attempts *at parse*, where
   the TypeScript front end refuses them by policy after they type-check.
   This spec keeps TypeScript for the React-web-first benchmark (the gauntlet
   measures naturally written TypeScript; a Contract surface scores 0 there
   by construction) and treats the Contract block as the Exact 2 arm's
   authoring form over the same IR. **Resolved 2026-08-30:** keep inference
   under §2's closed rules, refuse every unmatched provenance origin with
   `E_PROVENANCE_AMBIGUOUS`, and pin site identity to module, export, and
   ordinal. Classification is body-derived and name-independent: the LLP
   0329.017 C4 trio is reproducibly `Arg` / `Arg` / `Computed`, because two helper
   bodies pass their argument through while the third applies a template-string
   transform. That disagreement is principled rather than silent; helper names
   cannot affect either fact.
1. `tiny_http` versus a std-only server (size vs. correctness of chunked SSE).
2. Whether `init --client react` should exist before the React arm has a
   benchmark run, or `init` should scaffold the backend only.
3. `tick` as a control route (dev only) versus `ctx.now()` bound to the
   request — the spec takes the control route.
