# LLP 1002: The dev loop — one owner, thirteen verbs, the wire, the client

**Type:** Spec
**Status:** Draft
**Systems:** `snapback2/crates/snapback2` (the binary: owner, server, verbs), `snapback2/packages/compiler` (project lowering, worker), `snapback2/packages/snapback2` (authoring runtime, client, React, test runner, shim), `snapback2/scripts/{measure,publish,consumer-smoke}.mjs`
**Author:** Claude Fable 5 (orchestrator) — implementers: codex gpt-5.6-sol, lanes B0 (compiler + authoring surface), B1 (owner + server + verbs), B2 (`init`, `test`, `why`, `trace`, `guide`), D (client + React + evaluator)
**Date:** 2026-08-29
**Revised:** 2026-09-11 (Metro and the build cache: scaffold block list and out-of-tree journey staging; the client URL names its owner); 2026-09-11 (compiler certification obeys prebuilt owner custody); 2026-09-11 (portable multi-platform publication staging and exact-shim host qualification); 2026-09-11 (prebuilt native-binary custody across overlapping inventories); 2026-09-11 (measured native long-tail scheduling and verified artifact preservation); 2026-09-11 (bounded package scheduling and explicit post-fixture artifact boundary); 2026-09-09 (keyword guide cards and final Quarry headers, atomic expectedGeneration mutation admission, real template auth and nested hook session/actions, implementer GPT-6 Astra); 2026-09-09 (docs round-2 review fixes: imperative query retry scope and positive Quarry route); 2026-09-09 (docs round-1 review fixes: query retries versus mutation submission, established follower account, nested-page drain limits and public recovery repairs); 2026-09-09 (integrated shipped-docs accuracy: real chat README declarations, client/recovery scaffold route, composite continuation and public recovery examples); 2026-09-08 (lane D final focused repair: conditional stale-cache recovery and multi-fence effect guide coverage); 2026-09-08 (lane D second repair pass: valid guide fences, legal walk repairs, published family context, successor recovery and unique-source regression pins); 2026-09-08 (lane D review fixes: complete requirement metadata, conservative lookup explanations, executable families, CLI spelling repairs and complete subscriptions); 2026-09-08 (diagnostics say the fix: missing bounds, spelling repairs, current families, wrapping check, source-mapped why prose; implementer GPT-6 Astra, lane D); 2026-09-08 (Lane C final repair: reject statement-bearing expressions throughout policy probes; admit usable inbox arrays before comparison); 2026-09-08 (Lane C round 2: protected-independent guard proof, candidate rejection reasons, isolated count journey); 2026-09-08 (Lane C review: proved carrier projections, derived policy counts, executable Vite precedence and seeded maintain assertions); 2026-09-08 (templates are products, elegance program Lane C, implementer GPT-6 Astra); 2026-09-08 (LLP 1001.000 typed latest-state channels, leases and snapshot clients); 2026-09-08 (resource-aware blocking Rust test scheduling and paired timing); 2026-09-07 (generated insert/merge consumer type bindings; implementer GPT-6 Astra); 2026-09-07 (independent Quarry diagnostics, checked-type repair advice, lexical failure isolation and merge discovery ordering; implementer GPT-6 Astra); 2026-09-07 (preserve unrelated prefixed optional packages; staged platform dependency selection and exact-lock packaging regression; durable browser-follower admission and unknown-outcome recovery; client-owned observed query snapshots; explicit named-journey verification and executable React startup; startup cleanup fixture custody); 2026-09-06 (app guide operation/certificate custody; native logical SSE body; CLI help and executable migration recovery; auth startup recovery and held transition reads; queued transitions, interrupted sync, live held reads); 2026-09-05 (keyword index fallback and recipe list; generated Quarry keyword guide, landed outbox/client custody; auth review: failed-transition custody, read restoration barrier, session kind, paused offline retries; client-owned auth restoration and retry lifecycle; catalog naming rewrites, Clique L2; shared live transport, bounded derived verification, mutation-read guidance, installed consumer qualification)
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

The TypeScript sketch below is historical; Quarry is the current authoring
surface (LLP 1004 and LLP 1018.000). Channel declarations and values now follow
LLP 1001.000. The original inert-descriptor model was:

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
on the named leave path. **Superseded 2026-09-08:** the single-recipient send described here is deleted.
`messages.send` admits the sender, delivers to every current member, and
notifies every other member; a rejected send commits neither message nor outbox work.
See [templates are products](#templates-are-products).

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
remains in IR. **Superseded 2026-09-08:** the following TypeScript-binding
refusal/sentinel protocol is historical; direct Quarry binding replaces it
(LLP 1018.000). Unknown Quarry names emit `E_QUARRY_UNKNOWN`; type failures emit
`E_QUARRY_TYPE`. The old provenance-ambiguity diagnostic has been deleted. Historically, its
pasted rewrite named only direct origins discovered through binding and member
selection. Incomplete discovery retained known candidates plus an explicit
`<unknown origin>` marker in a non-lowerable sentinel; member names did not
guess an argument. Those historical multi-origin/unknown-origin refusals had
no compiling paste; this sentinel protocol does not govern Quarry.

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

**Bounded list selection in Quarry.** A nullable list's declared maximum and
proof of presence are independent. A loop may eliminate absence with `if`
presence narrowing or a bounded required alternative: `values ?? []`,
`values ?? more`, nested nullable alternatives ending in a required list, or
`values ?? [expression, ...]`, including effectful literal components. The bound
of the selection is the maximum across all possible alternatives, with each
branch retaining its actual declared maximum; a larger fallback is never cut
to the left alternative's maximum.

Quarry's `.length` selection on a modeled bounded list returns its element
count, including through immutable aliases and nested object captures. It has
the same presence requirement as `count`: nullable alternatives do not establish
presence. Length selection preserves the list's binding identity, snapshot and
bound; it supplies no new read-key authority. An actual object member named
`length` remains ordinary member selection.

The operands-once and binding-provenance rules above apply to the entire
selection. A present empty list counts as present and bypasses the fallback.
Expressions authored inside a fallback evaluate lazily, exactly once in
authored order when selected; an earlier captured fallback evaluates eagerly
at its earlier binding. Immutable aliases, object captures, and subsequent uses retain
the original selected list snapshot, without re-evaluating the selection or
its components. Source Decimal scales and minor-unit values survive selection
and capture independently of destination conversions; a destination cannot
change the captured source facts. Page-derived loop domains remain subject to
[LLP 1017's complete-fanout rule](1017-cap-and-complete-fanout.rfc.md#32-the-rule).

Destination conversion preserves null through modeled optional scalars, lists
and object members. It captures the operand once and converts only its present
value; nested list conversion keeps the source maximum. The converted
expression's representation is tracked separately so an enclosing container
does not convert it again. This supplies no new source members, presence or
read-key authority, and never changes retained source captures.

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
← { "id": 1, "ok": true, "project": <ProjectJson>, "sources": { "todos.list": { "file": "snapback/todos.q", "line": 14, "col": 14 } }, "apiDts": "<text>", "ms": 212 }
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
Recoverable Quarry statement failures retain independent bound statements for
diagnostics only. Failed statements roll back their bound output, fresh-name
counters, and only the local names that statement could publish; valid programs
do not copy their accumulated scope per statement. Uses of failed bindings
suppress dependent cascades. A fresh argument, binding, loop or match binder
clears failure only in its lexical environment, after its initializer or domain
has been validated. Merge discovery is bound in the outer scope before dependent
lane prefixes, and that bound expression is lowered once, including guards and
ID allocation. Parser and schema failures stay outside statement recovery. Any
recovered typed refusal returns the complete bounded diagnostic envelope before
effect lowering, program IR, API declarations or inspection artifacts can escape.
Presence advice comes from bound source and contextual destination types:
`! else CODE` is offered only when removing absence repairs the mismatch or
dereference. A text assigned to a Boolean still needs `true` or `false`; a
null-only value needs a value. These cause facts are part of direct typed value
comparison and add no wire fields. The diagnostic recovery controls are
registered in `src/quarry-diagnostic-checks.ts`.
The registered Quarry language checks live in `src/quarry-language-checks.ts`, keeping `src/test.ts` within the source line cap.

`api.d.ts` (written to `.snapback/build/api.d.ts`, never committed) augments
the client's `Api` interface with every op's argument and result types, emitted
from the same bound Quarry facts used for program IR. Row aliases contain
concrete field types; they do not depend on TypeScript data descriptors.
Insert and merge regressions consume the emitted augmentation through the
complete SDK with the Expo config, checking exact Boolean fields and
rejecting numeric assignments even with `skipLibCheck`:

```ts
declare module 'snapback2/client' { interface Api { todos: { list: Op<{ take?: number }, Todo[]>; add: Op<{ title: string }, { id: string }> } } }
```

## 4. The wire

HTTP/1.1, JSON bodies, `Content-Type: application/json`. Development CORS
reflects only literal loopback origins; other browser origins are refused before
body parsing or identity lookup. Allowed preflight headers are `Authorization`,
`Content-Type`, and `Cache-Control`; persona and control headers are excluded.
Browser requests (`Origin` or `Sec-Fetch-Site`) cannot select personas, including
same-origin browser requests. Local CLI/journey requests retain first-use
`X-Snapback-As` personas; `serve` refuses them. Every refusal carries the full
envelope below. Authentication uses a case-insensitive `Bearer` scheme.
Request lines and individual headers are bounded to 16 KiB before allocation;
aggregate headers are bounded to 64 KiB (414/431). JSON bodies retain the 1 MiB
bound. A connection-thread creation failure sheds that connection, preserving
the owner's listener. The control secret uses constant-time byte comparison. The parser caps
connection-reader threads and pending connections at 128, uses five-second idle
read/write timeouts, and sheds individual allocation/spawn failures. Asset GETs
share the four-worker media/upload class, preserving the JSON pool.
Password inputs are at most 256 UTF-8 bytes (signup still requires eight
characters). Password HTTP routes admit at most two concurrent attempts,
eight per normalized account, sixteen per IP, and thirty-two per owner within
sixty seconds; denied admission returns `E_AUTH_RATE_LIMIT`/429 before the KDF.
Unknown-email and wrong-password attempts retain the same dummy-hash work.

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
| `POST /api/channel/<name>/set` | `{ args, lease, version, value }` → `{ ok: true }` or the complete refusal envelope |
| `POST /api/channel/<name>/clear` | `{ args, lease, version }` → `{ ok: true }` or the complete refusal envelope |
| `GET /api/channel/<name>/subscribe?args=` | SSE; immediate and coalesced `{ state: "snapshot", key, lease, entries }`; entries contain `{ key, from, value, expiresAt }`, no durable sequence; subscribe revocation terminates and publish revocation removes the entry (LLP 1001.000) |
| `GET /api/manifest` | `{ generation, ops: { "todos.list": { kind, args } }, channels, auth }` |

**Shared live transport (2026-09-05; implementer: Codex, this change).** The
public client multiplexes query and channel subscriptions on one SSE connection
per client and authority. `POST /api/live` opens it and first emits
`data: {"session":"<random capability>"}`. `POST /api/live/control` carries
`{ session, add: [{ id, path }], remove: [id] }`, or
`{ session, close: true }`; it returns `{ ok: true }`. Controls require the
same bearer/persona as the connection. Reconnection creates fresh replaceable
query/channel snapshots; Last-Event-ID is not a resume protocol and the client
does not send it. Existing held receipts remain visible during reconnection.
Live control waits at most 250 ms before E_OWNER_BUSY; it does not pin a worker
for ten seconds. Every child is independently admitted by
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
channels mint fresh leases and deliver fresh room snapshots, with no replay
or automatic value republish. Heartbeats remain 15 seconds and do not renew
a stored channel value's TTL (LLP 1001.000).

One physical stream consumes one SSE worker (48 available under the current
server budget); one client supports 256 logical subscriptions. Each owner
child retains its bounded single-slot queue: query and channel deliveries
coalesce independently to their latest complete state, with terminal refusals
taking precedence. Client demultiplexing also coalesces each child. Channels
add 64 handles per room, 1024 per owner, 1 KiB scopes and 4 KiB values
(LLP 1001.000); capacity refuses a new child rather than truncating a room. The shared
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
{ "code": "E_UNBOUND_SCAN", "family": "bound", "message": "`todos[viewer]` reads a range; name its bound", "site": "snapback/todos.q:14:9",
  "rewrite": "todos[viewer] first 50 by byOwner", "guide": "quarry/indexes" }
```

**Generation-bound writes (2026-09-09).** `POST /api/mutation` accepts
`expectedGeneration`, the exact manifest `programGeneration` hash (schema
plus certified operations; the schema-only `generation` is insufficient). The sole writer
compares it before resolving the operation or decoding its arguments, in the
same admitted action as execution. A mismatch returns a terminal rejected
result with `reason: "generation_changed"`, `code: "E_GENERATION_CHANGED"`,
family `successor`, and the repair to refresh the manifest and submit a new
write. It runs no program and advances no application commit. A malformed
expectation is `E_INPUT`; omitted expectations intentionally execute against
the current generation (raw tools and cold offline intents).

The SDK binds plain mutations to its last observed manifest generation, when
available, and
asset substitutions to the descriptor generation captured before upload. That
expectation is persisted with a queued asset intent and resent unchanged.
Replay first authenticates and consults its existing terminal ledger; a lost
successful response stays successful across successors, including a mutation
that becomes a schedule-only target. Present-null expectations remain malformed
on replay as on the plain route; absence alone opts out. For a fresh replay,
valid grant/slice admission precedes the expectation check; a mismatch claims
that slice and records the refusal atomically. The SDK never retries a
generation refusal as a different write or silently reinterprets uploaded
arguments under a successor. Ordinary non-asset offline intents continue to
use the admitted live program and their read-trace OCC contract.

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

`POST /control/why` defaults `queryOnly` to true. Only the protected
trace-harvest harness opts into mutation execution with `queryOnly: false`.

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
  empty stdout. Shutdown wakes every idle multiplexed stream immediately;
  the stream's 15-second heartbeat wait can never hold the process beyond the
  two-second `dev --stop` observation boundary.
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

**Focused verification (2026-09-07).** `test --journey "name"` executes only
journeys registered under that exact name, including every duplicate within
and across files. `--journey=VALUE` accepts literal option-shaped names such as
`--help` and `-h`; only a `--journey` value is exempt from help scanning.
`test --blocked -h` and `test --project -h` retain baseline help behavior (also
with `--help`). Each focused body process verifies the ordered discovery
identity before execution: one SHA-256 of the ordered JSON list of name and
compiled function-source pairs (`Function.prototype.toString`). The fixed-size
identity avoids a per-registration command-argument tax. Changed names, body source,
order or duplicate counts fail visibly, including swapped distinct bodies with
one name. A discovery index or name vector alone is not execution identity.
This does not inspect captured values or sandbox authored code; captured setup
must remain stable across processes, and every stable duplicate still runs.
Full-suite selection is unchanged; exit-status validation below applies to all runs. Focused execution skips the top-level derived families;
durable journey clients still run embedded offline checks. It preserves backend
compilation and certification plus per-journey process isolation and deadlines,
and records `scope.journey` on success and failure receipts. A missing name fails
with available names; loading or compilation failures remain failures. It cannot
combine with `--derived-only` or `--blocked`. This is explicit selection, not
an automatic affected-coverage claim; plain `test` still proves the full suite.
`--derived-only` runs the top-level derived families except the effects witness
check, runs no journeys, and records `scope.derivedOnly: true` on its receipts.

A parsed passing receipt cannot mask an unsuccessful discovery/body process
exit. Retain reported checks and add the host failure when no failure was
already reported. The existing host termination after a completed receipt's
250 ms exit grace remains cleanup, not a new journey failure.

`test` starts a fresh owner (`--foreground`, ephemeral port, store at
`.snapback/test-<ts>.sqlite`, deleted after), applies the seed, then runs
derived checks and journeys.

The multiplexed live transport's explicit `close` control is a synchronous
resource boundary: its successful response is withheld until the physical SSE
handler has removed the session, unsubscribed its children, and returned its
bounded SSE worker token. A caller may open a successor transport immediately
after that response; it never needs sleeps or external pacing to stay below the
48-worker ceiling.

Startup cleanup owns scratch and store paths before the first fallible setup
step, and reaps the directly launched owner before removing those paths and
SQLite sidecars. Its Unix regression fixture launches `/bin/sleep` directly
and asserts that the recorded PID no longer exists. A PATH-resolved `node`
may be a launcher such as Volta; killing that launcher can leave its Node
descendant alive, so it is not a stand-in for the directly launched owner.

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
   per group, plus concrete-disjoint silence per query when such a commit can
   exist. If every eligible mutation's certified write sites are confined to
   tables covered by that query's whole-index authoritative ranges, every
   nonzero commit necessarily overlaps; the silence proof is inapplicable and
   the receipt names that fact instead of requiring an unrelated product
   operation. Point/ranged reads, mixed-table writes, missing commits, and
   incomplete write-site coverage do not qualify for this exception. This is
   representative invalidation coverage, not proof of every operation pair: the receipt lists
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
   **Revision 2026-09-10 (LLP 1021 §3–§4):** with an engine, the check counts
   witnesses, not probes: every declared effect needs one successful authored
   witness among the journeys that ran — a real emission, executed by the real
   engine against a provider the journey bound with
   `effects.provider(origin, handler)` (the test owner's transport is
   bound-only; an unbound origin is `E_EFFECT_UNBOUND`), its declared `then`
   committed. A granted effect requires at least one substituted request in
   that sent attempt; a grant-less effect records `provider: { declared: false }`.
   The receipt lists `{ journey, id, seq, attempts, state, ms, provider, then }`
   per effect and terminal non-witness rows as
   `notWitnessed[effect]: { rows, dropped }`; missing evidence is
   `blocked: effects:no-witness` naming the effect and the journey it needs.
   Without an engine the check stays `blocked: no engine in this build` with
   `detail.build`, and engine-dependent journeys are `blocked: effects:no-engine`.

**Named authorization proofs.** The canonical chat/alignment qualification
records the following stable proof names in its test receipt; a lower-level
unit test may support one but does not replace the served-loop proof:

The v1 carrier is discoverable as `memberAdd(scope, principal)`,
`memberPromote(scope, membershipId)`, `memberRemove(scope, membershipId)`, and
`memberLeave(scope, membershipId)`, with the concrete schema scope argument in
place of `scope`. The names select the distinct add, promote, admin-remove, and
self-leave roles; every update/delete takes the immutable membership identity.
A scope-only self-leave cannot prove incarnation safety because delayed replay
could delete a successor seat.

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

- `why <query> --as p`: re-runs the read. The original document default is
  superseded by the 2026-09-08 prose format in §“Diagnostics say the fix”;
  `--json` retains, per examined row, the rule
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
  (the family's wrong/right pair), and `<topic>` (all Markdown cards shipped in
  the package, discovered from their filenames without a fixed recipe list).
  The build splits the Quarry reference into focused cards, including types,
  exact numbers, assets, rules, writes, pagination, helpers and migrations.
  Each card has an 8 KiB ceiling and an advisory warning below 20% headroom;
  the whole Markdown set has a 96 KiB allocation, reported with free headroom.
  This replaces the nearly full per-recipe ceilings inside the existing package
  build check; it adds no gate, script, registry or runtime generator.
  `<keyword>` serves an authored card when one exists, otherwise its grammar
  line and defining paragraph. The build derives aliases from code names in a
  card's H1, so `assets/client`, `successor` and `migration` resolve to useful
  complete cards. A matching symbol retains its declaration. README H2 topics
  remain fallbacks with the first paragraph and packaged source pointer;
  authored cards and constructs take precedence. CLI file lookup admits only
  simple topic slugs; slash aliases are resolved from the generated index.
  Missing, unreadable, or invalid keyword indexes never
  suppress a symbol hit. A keyword-only lookup with a missing index is unknown;
  unreadable or invalid indexes return `E_OWNER_GUIDE` only when keyword help is
  needed. Unknown-name guidance includes index keys when readable. `--json` keeps
  `{ page, content }`; ordinary lookup reads only the requested card or generated index, while unknown-name guidance lists shipped card filenames.
  `guide init`, `guide dev`, and `guide check` serve the corresponding built-in
  command help before symbol lookup, keeping the same `{ page, content }` envelope.
  The remaining guide bytes are served from the package, not embedded in the binary.
  The app guide uses the same certified operation map as `certificates.json`.
  Schedule bindings are certified internal programs (LLP 1016 D5), excluded
  from both; their names do not decide whether a program is an operation.
  Missing or mismatched operation certificates and invalid seed facts refuse
  with `E_GUIDE_STALE` and `run snapback2 check`, without repairing the cache
  or substituting invented bounds.

## Diagnostics say the fix

Revised 2026-09-08, commissioned by Charlie Cheever; delegated rulings from the
Snapback 2 elegance program, implemented by GPT-6 Astra, lane D. These supersede
§3's unknown-index wording for unbounded value reads and §8's JSON-only default.
The earlier trace document remains the `--json` representation.

D1. A table read used as a value with no range clause and no exactly-matching unique index is a missing bound, not an unknown index: message "`posts[]` reads a range; name its bound", rewrite listing every `by` index whose prefix matches the keys (`posts[] first 50 by byTime`) and any unique index that matches exactly. Key types print as declared (`[principal]`), never `[?]`.
D2. Did-you-mean: an unknown table, column, index, fn, proc, shape, op, enum case, or module name gets the nearest declared name in the rewrite (Damerau-Levenshtein ≤ 2 or a case-only difference): "unknown messages field `authorid` — did you mean `authorId`?".
D3. `families.source.json`: every `wrong`/`right` example is Quarry (or the CLI/TS harness surface where the family is about seeds, effects, journeys); an entry whose code can no longer be emitted is deleted along with its dead site. A compiler test asserts no example contains `db.`, `rule.`, `ctx.`, `t.text(`, `withIndex`, `.take(`. `E_OWNER_PROJECT_ROOT` drops `schema.ts`; no message repeats its own code.
D4. `check` never truncates a `message` or `rewrite` (the 120-character cut that caused four misdiagnosed loops in the Clique run); long lines wrap.
D5. `why` speaks: the default output is prose, `--json` is today's document. Shape:

```
messages.thread as charlie — denied (MEMBERSHIP_REQUIRED)
  messages.q:7   require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
    memberships[conversation-1, dev:charlie]   absent   (byConversationPrincipal)
```
and for an admitted read, per site: the rows examined and visible, the bound (`last 50 by byRecipientConversationKindAt`, `complete` or `capped`), the rule that admitted, then the subscriptions (table and index prefix). Sites map to `file:line` through the compiler's site table; when unavailable, the site id prints. The bounds and digests stay in `--json`.
D6. The prose format gets its paragraph on the guide page that documents `why` (within budget).


Implementation: source positions, helper call sites, requirement associations,
and compiled source lines travel in the compiler's existing `sources` map and
are retained with each operation in `certificates.json`. They do not change
executable IR, generation hashes, or served query envelopes. The prose uses
the certificate matching the active owner plan and schema, so an edit or refused successor
cannot make it quote a different program. Missing metadata falls back to site IDs.
Unknown keys still report the catalog's nominal types. Rust and TypeScript
name repairs share the unrestricted Damerau–Levenshtein algorithm and the
two-edit/case-only threshold, with separate implementation helpers. Dead families and
their unused code declarations are deleted. `check --ir` now includes rewrites;
project `check` honors text versus JSON output and neither path truncates text.
Range visibility remains a range fact even without source metadata; fallback
prose never calls a range's hidden rows an absent point. Runtime refusal messages
omit their own platform or application code, which stays in the `code` field.

Review fixes (Revised 2026-09-08): every emitted `Require` has a source entry,
including postfix assertions and implicit non-ID write-address checks. An
application code identifies a failed source only when exactly one requirement
uses it; repeated codes and branches stay explicitly ambiguous. All executed
lookups remain visible, including rows bound to locals before a requirement;
there is no incomplete guard filter. Prose subscriptions include primary-key
absences and whole-table constraint inputs, matching runtime invalidation.
`run`, owner operation lookups and `why` use declared-name spelling repairs;
`why` resolves the active operation before inspecting certificate custody.
An existing wrong-typed `walk` column gets a self-reference declaration repair,
never its unchanged name as a spelling suggestion. Name suggestions preserve
cap/declaration/builtin fallback repairs. Wrapped continuation lines hang under
the field. Auth diagnosis starts with prose; `--json` remains authoritative.
`E_UNBOUND_SCAN` resolves to the flat `quarry` guide in Quarry, shared frontend
diagnostics and native certification. Family fixtures compile
both sides and check the claimed code. Six core-only families use explicit
`check --ir` CLI input because Quarry refuses those malformed forms earlier;
the unreachable TypeScript-schema family and its emit branch are deleted.

Second repair pass (Revised 2026-09-08): family Markdown preambles and fenced
blocks pass through the existing renderer, with Wrong/Right labels outside
paired fences. `walk ... up .id` cannot declare the implicit ID; its repair
adds a separately named optional self-reference (`parent: posts ?`) and uses
that field in the walk. Type and ambiguous-index diagnostics resolve to the
flat `quarry` page. Published family examples contain their required schema,
file placement and effect context, including the non-uniform read rule for
`E_STRUCTURAL_COUNT` and `then: recordNotified` for `E_EFFECT_THEN_ARGS`.
The existing executable harness compiles those published files without
per-code semantic injection. The intended code must be first; only dependent
certification refusals may follow it. Six core-only examples remain explicitly
`check --ir` inputs. The unconditional refused-successor recovery wording
for `E_WHY_STALE` is superseded by the final repair below; fail-closed
certificate custody remains unchanged. Unique local/assertion sources exclude ambiguity;
repeated-code controls and all executed lookups remain covered.

Final focused repair (Revised 2026-09-08): inspect `dev --status --json`; if
a successor is refused, resolve it through the published reviewed-migration
(`migrationFile` plan/project, then `applyCommand`) or revert path first.
Otherwise go directly to `snapback2 check`. In either case, `check` refreshes
the missing, malformed or stale certificate cache before retrying `why`; it
does not install a successor. The existing cache-corruption assertion follows
that refresh with a ready owner, while the refused-successor assertion retains
the revert path. The complete rendered-guide assertion covers
`E_EFFECT_THEN_ARGS` with prose labels and paired Quarry/TypeScript fences
as well as the six core JSON examples.

## 9. The client (`snapback2/client`, `snapback2/react`, `snapback2/test`)

```ts
const client = createClient({ url, token?, tokenStore? } | { url, as }) // storage is explicitly keyed; `as` is dev-only and exclusive
await client.ready                                  // restore barrier before any data request
client.auth.signup / login / guest / logout / me
await client.query(api.todos.list, { take: 50 })       // → { state, data, seq, … } — never throws on a typed state
await client.mutation(api.todos.add, { title })       // → committed | rejected | queued | admission-unknown
await client.recoverMutation(api.todos.add, { title }, recovery) // same forwarded request identity
const sub = client.subscribe(api.todos.list, args, (r) => …)   // SSE; { state: live|stale|refused|partial }; sub.close(); sub.until(pred)
const observed = client.observe(api.todos.list, args)       // lazy { getSnapshot, subscribe }; shares sub's entry
const room = client.channel(api.typing, args) // lazy, typed ephemeral state
room.getSnapshot(); room.subscribe(cb); await room.set({ typing: true })
await room.clear(); room.close()
```

`useChannel(api.typing, args)` owns this handle for React/Expo and returns its
immutable `entries`, `key`, `status` (`loading | ready | unavailable`), reason,
refusal, `set` and `clear`. The private wire lease never reaches callbacks.
Transport loss and authority replacement erase its entries; reconnect receives
a fresh snapshot. Headless handles stay open until `close`, even after their
last listener detaches. Cold `clear` opens nothing and cancels older sets
waiting for initial admission. No durable receipt, prediction or offline queue
is implied; LLP 1001.000 is the complete lifecycle and version-fencing contract.

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
is `committed | rejected | queued | admission-unknown`. With local-first custody (LLP 1012 §7),
`queued` means saved on the device for FIFO replay after resume; transport loss
keeps the same intent for retry. `status: OutboxStatus` explains readiness,
the next action, queued count, and fence; `useOutbox()` exposes entries, and
`outbox.drain()`/`settled()` return `{ stopped, remaining }` (`OutboxSettlement`).
For a browser follower, `queued` means the lock-holding writer durably admitted
the command into that shared partition. If its acknowledgment is lost after
send, the call returns `admission-unknown` with an opaque `recovery`; callers
pass the same operation, arguments, and token to `recoverMutation`, which can
only recover that request and never substitutes a fresh write.
A thrown transport failure leaves `last` untouched, sets `transport` (a
retryable `SnapbackRefusal`, cleared by a successful run), and rejects `run()`;
a 503 after commit must never look like a server rejection.
Every 4xx envelope on `query()`/`mutation()`
throws `SnapbackRefusal`; subscriptions deliver `refused`. Typed HTTP 200
session terminals expire captured custody at the same JSON boundary before
internal replay/resume settlement. Direct mutation and channel calls keep their
typed terminal result; automatic mutation cleanup still precedes expiry.
**Transport status is not a query state**: hooks and the provider expose `connection: connected |
reconnecting | offline` separately, and a network failure leaves a query
`hydrating` with `connection: reconnecting`, never `refused`.

One client owns one immutable `QueryView` for each authority generation,
operation, canonical argument value, and live/drain mode. `client.observe()`
returns stable `getSnapshot()` and `subscribe(notify)` functions over that
entry. Obtaining the observer is lazy: it opens no transport and retains no
inactive entry. The first listener opens the same entry used by
`client.subscribe`; the last listener or raw subscriber releases it. React and
Expo `useQuery` consume that external store, so identical mounted hooks read
the same snapshot and data identity. A program reset publishes `hydrating`
before reopening the stream. An account transition or client close retires
the entry, notifies snapshot listeners once, and makes the old observer return
its stable `hydrating` fallback, so it cannot expose the retired account's
data. `{ live: false }` uses the same lazy snapshot lifecycle for its retrying
one-shot query; drain remains live-only.

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

React/Expo `useAuth()` returns `{ session, actions }`: `session` is the exact
client `AuthSnapshot`, and `actions` is the stable headless `client.auth` API.
The flattened hook and its bearer field are deleted. `useViewer()` reads
`session.viewer ?? session.restoringViewer` from that same provider for display;
it supplies no additional query or authority and eliminates viewer prop drilling.
All three starter entrypoints now use bearer sessions, with signup, login,
guest, logout, a visible who-am-I identity, working/error states, and automatic
restoration in a compact `Auth.tsx`. Browser storage is explicitly selected and
backend-keyed; Expo's SecureStore key encodes the complete backend URL. The
account boundary keys children by principal and unmounts them after logout.
A token-bound restoring principal keeps its app mounted during cold offline
restoration, under the existing SDK held-read/write fences; unbound hydration,
anonymous, and refused sessions show the sign-in screen. Personas remain a
CLI/test input. The real template interaction regressions exercise signup,
bad/good login, guest, logout, browser cold restoration and native secure custody.
Both chat clients include `groupCreate` with a title and invited account ID.
The paginated `groups.mine` query joins only the viewer's memberships to their
conversations, so an empty conversation survives restart and is visible to its
invited member before the first message. Existing delivery rows still supply
inbox previews. A real-owner journey creates password and guest accounts,
checks member/outsider discovery, logs out/in, then sends and reads a message.

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
replacing already-confirmed auth. A session prepares offline metadata before returning,
but a metadata refusal stays on `lastRefusal` and does not reject an installed,
still-current bearer; expiry or close still rejects. Startup work skipped or interrupted
by a session attempt remains pending. Interruption releases `ready` during confirmation,
metadata, or resume even when the old transport ignores abort; stale responses remain fenced.
After the latest queued transition settles, confirmed current custody resumes metadata and
the outbox through the existing flight, including when a failed attempt preserved that custody.
One failed session metadata fetch does not skip that recovery flight. Deferred failures stay on
`lastRefusal`; `online()` retries them. A successful resume clears that pending work,
so ordinary re-login does not implicitly release a past-fence queue.
The recovery barrier is installed before waiting for queued transitions. Cancelling its
flight wakes existing waiters even if fetch ignores abort; each waiter rechecks authority
and joins any replacement recovery before dispatching. A cancelled flight's late response
cannot alter custody, sync status, or the settled outbox.
Cancellation also releases replay and log-tail transport waits inside the serialized
outbox drain, so replacement recovery never depends on an obsolete response or body.
After response-body parsing succeeds or fails, cancelled resume requests check the signal
before clearing custody or recording a refusal. Auth restoration's valid late terminal
`me()` evidence keeps the bearer-keyed cleanup contract below.
Hooks wait for `ready` before deciding whether
a tokenless client needs its lazy first `me()`.

While a bearer is hydrating, mounted reads wait for confirmation or answer
from existing offline coverage after pending account transitions settle, on both one-shot
and live reads; each held read checks authority after the carrier returns. The token-bound display field supplies no
network authority. Confirming the same bearer preserves live React query observers and
their held item identity; the client resumes those reads in place. A one-shot read
retries on confirmation if it could not answer while hydrating. Actual account
transitions still replace observations through `authGeneration`.
If an uncached query's metadata request starts during bearer restoration and fails
with a retryable transport error, preparation waits on that restoration and retries
once after rechecking authority. This also covers a failure received after confirmation;
without held metadata the query stays loading while restoration is unresolved.
Explicit `me()` replaces its backoff timer. `offline()`
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
replacement custody is never cleared by a delayed predecessor response. Raw asset
fetch and XHR follow that same rule before suppressing delivery; successful byte
bodies recheck authority before leaving the client, including without a cache.
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
`SnapbackProvider({ url, persona? })` (supersedes the `as` prop; LLP 1018.003
§The plain tier) and an optional `<DevOverlay/>` (persona,
connection, generation, last refusal).
Reconnect with backoff; a lost SSE stream reports `stale(since)` until the
first delivery after reconnect. The evaluator twin gains `Emit` as a
no-op that consumes one id (LLP 1001 §8) and one corpus case proving it.

## 10. `init`

**Client startup (2026-09-08; supersedes the 2026-09-07 shell URL capture).**
The next command is `npm install && npx snapback2 dev && npm run dev` for
React and Expo, with the project path quoted. `dev` writes its actual URL plus
one newline to `.snapback/dev-url` on startup and attach. The Vite config reads
it when `VITE_SNAPBACK_URL` is unset; Expo's app config publishes it in
`extra.snapbackUrl` when `EXPO_PUBLIC_SNAPBACK_URL` is unset. The owner never
starts or watches the bundler. The generic React starter displays
`useConnection()` state.

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

**Integrated shipped-docs accuracy (2026-09-09).** The commissioned
pre-publication pass audits existing package docs, guide pages and scaffold
instructions against integrated source, templates and generated declarations.
It repairs existing pages and assertions only, rebuilds the package, and
qualifies installed guide queries and fresh React/Expo scaffolds; it adds no
document, check, script, registry, configuration or compatibility alias and
changes neither product behavior nor guide budgets/keyword definitions.

The README's text send takes `{ conversationId, body, expiresAt? }` and returns
`{ id }`; the existing check now generates its declarations from the shipped
chat template instead of modeling the deleted `recipientId`/`null` contract.
Query examples omit the initial cursor. The managed agent block routes client
authors to `guide live-query` and offline/recovery authors to `guide offline`,
and names Quarry `first`/`last` bounds with separate hook status, read verdict
and freshness. This supersedes its old `take` and mixed-state sentence.
The Quarry guide preserves the integrated composite's one cursor-bearing page;
public recovery examples use `online()` and distinguish follower inbox writes
from refused uploads/channels. Durable replay is distinguished from a call
without durable admission; explicit upload promises retain their current
failure behavior.

**Round-1 review fixes (2026-09-09).** The no-resubmission guarantee is for
mutation calls without durable admission; retryable query transport failures
get up to three attempts. The README explicitly qualifies rejection as a
transport failure. Follower inbox admission requires an established account;
E_OFFLINE_FOLLOWER includes signing in to that tab and sending again. A record
may carry one nested page's root `next`, but an object/nested page is not a
resumable drain. Builder-facing replay and recovery name `online()`, including
E_OFFLINE_INTENT_EXPIRED. E_OFFLINE_RESUME leads with the unsupported-log query
repair: a direct ascending `after c first N` append page, `N <= 50`; `online()`
may retry a mounted-limit refusal once but does not repair an unsupported log.
Existing client regressions pin query versus mutation attempts, guide assertions
pin these repairs and both README routes, and Quarry pays for its clarification
by deletion within the unchanged byte budget. These qualifications supersede
the audit candidate's unscoped calls/replay and incomplete drain/follower wording;
runtime behavior is unchanged.

**Round-2 review fixes (2026-09-09).** The three-attempt retry bound above
applies to imperative `client.query()`, superseding the unscoped query sentence.
One-shot `observe`/`useQuery` can keep retrying retryable refusals; live observes
reconnect through SSE. The existing package-guide assertion pins that distinction.
Quarry restores "otherwise use Quarry" outside seeds, tests, and effect I/O,
paid for by shortening the effects-recipe pointer within its unchanged
15,872-byte budget. Runtime behavior is unchanged.

## Templates are products

2026-09-08 — commissioned by Charlie Cheever; delegated rulings from the
Snapback 2 elegance program, implemented by GPT-6 Astra (Lane C). These
supersede the duplicate threads, `summary`, single-recipient `send`, and
`deliveries.post` inventory above. The offline schema and effects contract
remain LLP 1012 and LLP 1003 respectively.

C1. One module per concern: `schema.q` (tables), `access.q` (fns + `proc deliver`), `messages.q` (`thread`, `conversationView`, `inbox`, `search`, `send`, `sendPhoto`, `sendClip`, `sendOncePhoto`, `edit`, `unsend`, `purgeMessage` + `schedule expireMessage`), `groups.q`, `profiles.q`, `feeds.q`, `posts.q`, `follows.q`, `notifications.q`. `deliveries.q` is deleted. `thread` reads the delivery log (one event per live message, `withHistory` fallback for declared partial custody); `conversationView` is the composite (page + count + preview). `send(conversationId, body, expiresAt?)` is the one text send: insert, `deliver`, then `emit notify` to every other member. The old `messages.thread` over messages, `summary`, and `send(recipientId)` are deleted.
C2. Rows are returned, not rebuilt: `insert` yields its row. `createMyProfile` and the follow branch of `setFollow` use `insert ... if absent`, returning the created row or `null` for any occupied unique key without disclosing its row; `updateMyProfile` and `createPost` return their rows. `messages.edit` uses `update ... if .body = baseBody`; a stale edit returns `reason: "conflict"` and the readable current message for explicit review. Optional columns are omitted, never spelled `null`.
C3. `delivery.ts` is a plain effect: build the request, `fetch` it with the idempotency key, return `{ providerId }`; `then: recordNotified`. A two-line comment at the top says the grant names your provider. No unused imports, no rethrowing `catch`, no identity helpers.
C4. Tests read fixtures from files: `snapback/tests/fixtures/photo.jpg` and `clip.mp4` (real tiny files, committed), loaded in the journey. If the journey runtime forbids `fs`, `snapback2/test` gains `fixture(name)` (relative to the test file). No byte literals in the template test.
C5. Zero `@ref` comments in any template file. A gloss a builder needs becomes a plain one-line comment; the rest is dropped (the LLP already holds it).
C6. Screens: mechanical op renames only (`api.deliveries.conversationView/thread/inbox/edit/unsend` → `api.messages.*`; `api.deliveries.post` → `api.messages.send`); nothing else in `react/src`, `expo/src`, `shared/` (lane A2 owns the rewrite).
C7. `snapback2 dev` also writes the URL to `.snapback/dev-url` (one line, gitignored). The React template's `vite.config.ts` defines `import.meta.env.VITE_SNAPBACK_URL` from that file when the variable is unset, so `init`'s next-step line becomes `npm install && npx snapback2 dev && npm run dev`. The Expo template reads the same file through its `app.config`. The client contract is still `SNAPBACK_URL`; the server spawns and watches nothing.
C8. Seeds: if the engine requires `messageCounts: [], memberCounts: []` in `seed.ts`, keep them and note it in the report; do not change the engine.

**Metro and the build cache (2026-09-11; implementer Claude Opus 5).** Two
independent Astra Clique lanes lost Expo web the same way, on 0.0.24 and on
0.0.25: after a successor compile, Metro's `FallbackWatcher` threw `ENOENT` on a
journey transient under `.snapback/build/` (`.tests-NMmoHO` on one lane,
`tests.replaced-<pid>-<ts>` on the other) and the bundler exited, costing a
correction loop at the first schema successor
(`benchmarks/runs/2026-09-11-clique-astra-snapback2-0024-linux`,
`benchmarks/runs/2026-09-11-snapback2-0025-clique-linux`). Both halves land. The
Expo scaffold ships `metro.config.cjs` block-listing `.snapback/` — `.cjs` so it
loads whether or not the project's `package.json` says `"type": "module"` — and
`compileJourneys` stages its candidate `tests` directory and its `.api-*.d.ts`
in a same-device sibling of the project root, so only the finished directory
crosses into `.snapback/build`. This is Snapback 1's ruled answer to the same
crash (`issues/closed/20260827-snapback-expo-metro-generations-watcher-crash.md`),
reached independently. An unwritable or cross-device parent falls back to staging
inside the build cache, where the block list is the remaining defense. `snapback2
test`'s isolated-owner scratch (`.snapback/test-run-<stamp>`) and asset staging
stay under `.snapback/` on purpose — owner-only permissions — so the block list,
not relocation, is what protects them. The client contract is unchanged: the
server still spawns and watches no bundler.

**The URL names its owner (2026-09-11; implementer Claude Opus 5).** Precedence
is unchanged: explicit `EXPO_PUBLIC_SNAPBACK_URL`/`VITE_SNAPBACK_URL`, then Vite
dotenv, then `.snapback/dev-url` (C7). But when an inherited variable disagrees
with the file this project's owner wrote, `app.config.js` and `vite.config.ts`
warn and name both URLs instead of silently serving the other owner. An ambient
variable left by a concurrent lane on the same host sent the 0.0.25 run's first
M1 browser traffic to the 0.0.24 lane's backend, invalidating the attempt; a
benchmark launcher unsets both variables (`benchmarks/protocol.md`, Environment
pinning).

The shipped backend has 24 client API operations, the system-only
`messages.purgeMessage`, and one internal expiry binding.
Its TypeScript files are `delivery.ts`, `seed.ts`, and the acceptance journey;
media fixtures are committed under `snapback/tests/fixtures/`. `fixture(name)`
loads bytes relative to the authored test file even when executing its compiled
copy, during registration and asynchronous execution, including named-journey
selection. The engine seeds maintained counts without empty target arrays, so
`messageCounts: []` and `memberCounts: []` are omitted. Package witnesses use
the shipped operation names. The compiler's independent Quarry chat regression
project retains its own scenarios; template certification and composition tests
lower the shipped template directly, without requiring byte identity.

The CLI's derived authorization probe admits a delivery-log carrier that declares
tombstones for the protected table. A denied-table successor must retain the
readable log metadata and replace each projected complete protected row with
`null`; revoking membership still requires terminal denial with no rows.

**Review revision 2026-09-08:** the earlier shape-only projection oracle is
superseded. Candidate IR must prove a straight-line carrier page whose output
fields are direct carrier-column reads or complete protected-row point reads.
Scalar projections from protected rows, constructed arrays/nested values,
unknown expressions, control flow and aliased accumulators are ineligible;
unsupported candidates block rather than treating unexamined values as metadata.
The served retained and fresh responses must match that independently derived
projection. Their receipt counts derive from the checked response: carrier rows,
remaining protected images and nulled images are separate. The seeded chat
witness pins one carrier row and one nulled message in each response.
Vite configuration precedence is explicit environment, Vite dotenv, then the
owner URL file; the existing init regression executes Vite's `resolveConfig`.
The conversation metadata journey pins count 1 from the source seed; its
original shared-conversation send/unsend probe is superseded by the isolated
round-2 journey below. Provider honoring of `meta.id`, rather than the header alone,
is the condition that makes effect retries safe.

**Round-2 review revision 2026-09-08 (implementer GPT-6 Astra):** policy-probe
eligibility rejects terminal control flow whose truth can depend on the
protected table under the denying successor. Ignoring top-level `Require` is
superseded: each must resolve to stable literals/arguments/viewer or an existence
check on a self-readable membership table with stable keys. The latter's read
rule must probe only that same table/index; a protected-table read in the key
or read policy invalidates the proof. Aliases preserve this classification;
unknown expressions and other terminal control flow block. This is a bounded
dependency rule, not a general IR interpreter, and applies to direct and carrier
queries. The served `require exists messages['message-1']` and aliased variant
block before applying a successor; the shipped membership guard stays eligible.
Candidate selection retains the specific projection/control-flow rejection in
the existing blocked receipt's `detail.candidates`, including the query name.

The count journey still proves seeded count 1 before other journeys. Its writes
use a disposable conversation and separate personas, assert 1 → 2 → 1 around
send/unsend, and assert that the seeded member's inbox is unchanged. Removed
message history therefore cannot reorder later shared-member journeys. Every
client close in this journey is awaited. Round-1 projection, receipt-count,
Vite-precedence, fixture and template-surface fixes remain in force.

**Final review revision 2026-09-08 (implementer GPT-6 Astra):** the round-2
assumption that classifying an unused expression's result also covered its
execution is superseded. `Merge.lanes[].setup` holds executable statements;
an unused merge can require a protected row before returning a separate carrier
projection. Policy-probe eligibility rejects every merge expression, including
unused `Const`/`Let` bindings and expressions nested in fields, arrays, objects,
operators, builtins, point-read keys, scan prefixes/cursors/ranges, loop domains
and loop-body values. The exhaustive expression match treats `Merge` as the
only statement-bearing variant; rejecting it as a whole also covers its source,
setup, scan and held-search expressions. This is a bounded structural exclusion,
with the unchanged query-specific control-flow reason, not an interpreter or a
change to compiler/runtime permission. The shipped membership guard remains
eligible. The real compiler/certifier and served regression preserve and reject
`unused = merge messages last 1 by byConvTime:` with lane key
`[(messages['message-1'] ! else HAS_MESSAGE).conversationId]` respectively.

Both inbox observations in the disposable 1 → 2 → 1 count journey must be
`complete` or `capped` arrays before comparing their data. Matching null,
denied, refused or partial results cannot prove inbox isolation. Awaited client
closes, startup/configuration evidence and the browser-witness boundary remain.

## 11. Measured

The package phase schedules Node test files at the host's available processor
count clamped to 2–6 workers, unless `SNAPBACK_PACKAGE_TEST_THREADS` explicitly
overrides it. Tests, their 10-second deadlines, the complete file inventory and
all-failure reporting remain unchanged. The bound prevents many owner-heavy
files from simultaneously starting and stopping native owners; the retained
timing ticket records its controlled qualification rather than treating a
single green rerun as reliability evidence. After the initial package and
native build prerequisites, the complete package, native, doctest, evaluator
and compiler inventories run concurrently. Package tests use a target-scoped
copy of their source and built artifacts, while their repository and native
binary lookups remain pinned to the canonical checkout. Compiler clean-build
and killed-lock regressions use a separate target-scoped package generation,
snapshot and lock. Native tests assert that the canonical package generation
is complete and consume it without rebuilding. These ownership boundaries
prevent destructive package fixtures from deleting an artifact another phase
is reading. The script snapshots the freshly built canonical `dist` before
the concurrent interval and compares it byte-for-byte after every reader
finishes. The ordinary path therefore preserves the already-complete artifact
generation without a redundant rebuild; if a future fixture crosses its
boundary, the script reports failure and restores that exact snapshot.
The prerequisite also exclusively builds the canonical native owner and media
helper. Package owner harnesses and compiler binary certification receive the
same internal prebuilt marker and do not repeat `cargo build` during the
concurrent interval. Compiler certification still executes every binary check;
its standalone invocation still builds the owner. A relink cannot make
`target/debug/snapback2` transiently absent while native or package tests are
executing it. Outside the blocking script the harness retains its standalone
build behavior.

On the warm Silver M5 integrated source, the eight-file setting exposed owner
shutdown pressure in two complete samples (three package failures in 52.37 s,
then one in 56.85 s) while every other inventory passed. The six-file control
kept the original 10-second test deadline, passed all 1,307 package tests and
the complete native/compiler/evaluator/doctest inventories, and returned in
53.38 s. Six is therefore the measured default ceiling; the environment
override remains diagnostic rather than release evidence.

The final no-override canonical run at `06559b7e3fad` returned exit zero in
**53.92 s** on the same Silver M5: 1,307 package tests; 1,125 native passes and
four configured skips across the exhaustive disjoint split; 302 compiler
checks; evaluator delivery 10/10, visibility 2/2 and corpus 266/266; plus
doctests, script self-test, prerequisite builds and unchanged canonical
artifacts. Qualified tools were Node 24.20.0, Bun 1.4.0, Rust 1.97.0 and
cargo-nextest 0.9.143. The exact-suite 60-second budget is closed by this
content-green default result; focused or overridden phase runs were not used
as a substitute.

The blocking suite schedules Rust executable tests at the host's available
processor count, clamped to 8–32 workers, unless
`SNAPBACK_RUST_TEST_THREADS` explicitly overrides it. Tests remain separate
processes with the same inventory, deadlines, and no-fail-fast reporting. On
the exact suite, seven empirically long tests start at phase birth in a
four-worker priority process; the complement receives the remaining bounded
worker slots. The two disjoint filter sets are exhaustive and write separate
JUnit reports, so this changes scheduling rather than inventory or outcomes.
On the warm Silver M5 control before integrating the split, those seven tests
and their complement passed 7/7 and 1,115/1,115 in 41.654 and 40.433 seconds,
respectively, when started together with four and fourteen workers. The same
1,122 tests under the unsplit 18-worker full-suite phase took 60.549 seconds.
On
the same warm 96-CPU EPYC source and build, nextest ran 865 tests with four
skips in 39.856 s at 16 workers versus 77.510 s at eight; external wall times
were 40.253 s and 77.907 s, and compile-only preparation took 0.603 s.
A subsequent 32-worker run preserved all outcomes and took 36.244 s in
nextest (36.636 s external elapsed). These measurements are native test
execution on that EPYC host; the 60-second budget covers the entire blocking
suite.

After compiler fixture reuse and the concurrent client-item integration,
`43e06fa90` passes the complete canonical script in **83.921 s warm** on the
EPYC lane: 815 Node tests, 865 native passes and four skips, doctests,
225 evaluator cases plus two visibility checks, and 214 compiler checks.
Native execution is 36.118 s; compiler type checking plus tests takes
27.235 s. The qualified tools are Rust/Cargo 1.97.0, Node 24.13.1,
Bun 1.3.14 and nextest 0.9.143. Earlier worker/compiler wrappers did not
record runtime tool versions, so their paired phase measurements are kept
separate from historical full-suite comparisons using different tooling.
The 60-second total budget remains open; the existing timing issue retains
the failed samples, phase evidence and remaining work.

The first complete overlapping run on a warm 96-CPU EPYC host ended after
60.226 seconds with content failures: package tests finished in 53 seconds,
native nextest in 49 seconds (47.971 seconds inside nextest), compiler checks
in 39 seconds, evaluator checks in eight seconds and doctests in one second.
The package inventory reported 1,289 passes and 12 failures; native reported
1,105 passes, 13 failures and four skips; the compiler runtime inventory passed
302/302 while its separate typecheck reported four failures. The retained
ticket distinguishes these content failures from orchestration evidence and
keeps the exact content-green sub-60 qualification open. No inventory,
per-test deadline or no-fail-fast behavior changed.

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
30 s. An engine-less development build accepts exactly the engine-absence
blocks — the `effects` check `blocked: no engine in this build` and journeys
`blocked: effects:no-engine` — when every other check passes (LLP 1021 §4;
before 2026-09-10 only the single `effects` block was admitted); zero checks
cannot pass. Publication repeats this consumer proof against the actual staged
production tarballs and requires every check to pass, including effects, whose
witness coverage must be complete. The packed
README travels with the compiler, client, templates, and guide. Gates from
`rules/RULES.md`: `check` < 1 s, `doctor` < 0.5 s; from LLP 0329.016 §8:
`init` → `dev` ≤ 10 s. This implements LLP 1007 §5 item 7 (2026-09-05).

The packed shim's optional platform dependencies name exactly the platform
artifacts selected for that publication, all at the shim's version. The current
publisher qualifies and stages its host platform. `--stage-only` performs the
same production binary, media, package and installed-consumer qualification,
writes the durable resume record, and performs no registry convergence or
publish request; its normal package dependency fetches remain part of building
and qualifying that candidate. The stage directory is portable: when transferred intact, recorded tarballs are
resolved beside `resume.json` and checked against their immutable integrity.
`--platform-artifact <resume.json>` imports a separately staged platform only
after checking its recognized package identity, version, `os`/`cpu`, tarball
integrity and explicit successful native-host consumer evidence. It never runs
the foreign binary locally.

The selection helper preserves multiple platforms when supplied together. The
recognized platform package identities are `snapback2-darwin-arm64` and
`snapback2-linux-x64`, matching the source shim's platform dependencies.
Selection and replacement use those exact identities; unrelated optionals,
including `snapback2-plugin` and `snapback2-plugin-tools`, and normal/peer
dependencies remain unchanged. A recognized name alone does not establish
platform qualification. Each platform's resume evidence binds both that
platform tarball integrity and the exact shim integrity exercised by its
production consumer. An imported shim is canonical only when its packed
platform dependency map names the complete selected platform set at the
publication version. The next host copies and locally qualifies those exact
shim tarball bytes rather than independently packing an equivalent manifest;
a single-platform imported shim cannot be canonical for an expanded set, so
that first expansion packs the unified shim once. Registry publication still
refuses until every selected platform has successfully exercised the final
identical shim. Thus the bounded two-host workflow is platform A stage,
platform B unified expansion, platform A reuse and qualification of B's exact
unified shim, then platform B publication using the refreshed platform A
receipt. The local consumer installs only its host artifact plus the unified
shim, avoiding a direct foreign package install and its `EBADPLATFORM`; the
shim's packed dependency map is still checked against every selected artifact.
Production qualification checks the packed package identities and dependency
map, including resumed tarballs. A publication invocation refuses an existing
resume when its exact platform selection, imported artifact integrities, or an
imported canonical full-set shim integrity do not match the request, leaving
the resume and immutable tarballs unchanged.
Intentional reassembly uses `--stage-only`; before replacing a mismatched
selection it renames the complete prior stage to a reported sibling path, so
its receipt and tarballs remain recoverable. A matching resume is reused, so a
newly requested platform can neither be silently ignored nor destructively
replace publication state.
Development consumer packing uses the same selection. `publish.mjs --self-test`
includes an offline fixture install followed by a fresh `npm ci` with unchanged
package/lock bytes and default peer/optional dependency semantics. This is
packaging evidence, separate from runtime/platform qualification and the
consumer's existing 30-second budget.

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
   under §2's closed rules and pin site identity to module, export, and
   ordinal. **Superseded 2026-09-08:** the TypeScript provenance refusal rule
   is historical; direct Quarry binding uses `E_QUARRY_UNKNOWN`/`E_QUARRY_TYPE`
   and the old provenance-ambiguity code is deleted. In the historical TypeScript
   experiment, classification was body-derived: the LLP 0329.017 C4 trio yielded
   `Arg` / `Arg` / `Computed`, because two helper bodies passed their argument
   through while the third applied a template-string transform. Helper names
   did not affect those results. This records that experiment, not a current
   TypeScript authoring or sentinel contract.
1. `tiny_http` versus a std-only server (size vs. correctness of chunked SSE).
2. Whether `init --client react` should exist before the React arm has a
   benchmark run, or `init` should scaffold the backend only.
3. `tick` as a control route (dev only) versus `ctx.now()` bound to the
   request — the spec takes the control route.

### Runtime hardening (2026-09-12)

The npm launcher pins `SNAPBACK2_NODE` to `process.execPath`. Compiler and
journey subprocesses use that absolute executable, never an ambient PATH search.
Direct-binary invocations that compile must explicitly supply the trusted absolute
Node path; a missing, relative, or non-executable path refuses `E_OWNER_NO_COMPILER`.
The source watcher skips symlinks, so linked directory cycles cannot recurse.
