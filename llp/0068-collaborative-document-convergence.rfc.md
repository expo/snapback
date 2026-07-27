# LLP 0068: Collaborative document convergence

**Type:** RFC
**Status:** Draft
**Systems:** Documents, Collaboration, Sync, Offline, Realtime, Auth, Storage, Client integration, Code generation, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-07-26 (author-side review application: v1 now derives atom
identities from one operation id plus scalar offsets, defines the canonical
wire/hash profile, makes expired offline retention a typed resync/quarantine
boundary, retains anchor redirects through every live lease, pins deterministic
block move/delete/cycle and mark-boundary rules, separates server settlement
from client outbox clearing, and selects the canonical Snapback reducer with
generated editor adapters. The RFC remains Draft and still requires independent
review and executable evidence). 2026-07-23 (research corroboration from the
LLP 0082–0085 prior-art passes added — two first-party core-CRDT retreats and
the industry convergence on typed-document carve-outs — plus an explicit
build-vs-integrate section naming the Yjs alternative and a matching open
question; no change to the proposed semantics). 2026-07-20 (initial proposal
for LLP 0063's document pressure test)
**Related:** LLP 0000, LLP 0004, LLP 0008, LLP 0010, LLP 0011, LLP 0012, LLP 0013, LLP 0018, LLP 0022, LLP 0037, LLP 0043, LLP 0053, LLP 0063, LLP 0083, LLP 0084, LLP 0085

## Summary

Snapback should support one deliberately narrow collaborative-document model:
an ordered sequence of blocks whose text is a replicated sequence of immutable
atoms. Clients exchange idempotent operations, not whole-document overwrites.
Concurrent inserts have a deterministic order, deletes name immutable atom or
block identities, and every replica that has accepted the same operation set
must materialize the same document.

This RFC chooses an operation-log CRDT for this one profile. It does not turn
ordinary Snapback rows into CRDTs, promise compatibility with every editor, or
change LLP 0008's server-authoritative conflict rule for ordinary mutations.
Cursor and selection presence remain ephemeral under LLP 0013. Durable content,
comments, history, and sharing remain in the application-data and authorization
lanes.

The first claim profile is `collaborative-document-v1` on a Snapback target that
already satisfies LLP 0012 Parity for retained reads and replay. The profile is
not supported merely because this RFC exists: it requires generated bindings,
the reference reducer on at least two client platforms, a server implementation,
and the executable convergence and authorization witnesses below.

## Why a separate model

LLP 0008 and LLP 0043 intentionally choose server-authoritative replay for
ordinary data. That is appropriate for inventory, permissions, and most form
writes, but it cannot merge two offline edits to the same paragraph without
discarding one edit or inventing application-specific conflict behavior. LLP
0013 likewise keeps cursor traffic out of durable storage and explicitly
declines to make the generic ephemeral subsystem a CRDT database.

The document pressure test in LLP 0063 therefore needs a named semantic bridge.
The bridge must preserve Snapback's existing application, authorization,
version, and target boundaries instead of becoming a second hidden database.

## Prior art and external corroboration (2026-07-23)

The 2026-07 prior-art passes ([LLP 0082](./0082-instantdb.research.md)–
[LLP 0085](./0085-jazz.research.md), with
[LLP 0022](./0022-electric-powersync-turso.research.md)) bear directly on this
RFC's central boundary — an operation-log CRDT for one document profile, and
nothing else — and support it from both directions. [inferred, from confirmed
findings in the cited passes]

**Against CRDTs in the core, the record is now first-party and dated.**
ElectricSQL built generic CRDT sync and retreated in 2024 (LLP 0022); Jazz
built cryptographic-CRDT foundations and retreated in 2026, moving to a
trusted server with field-level last-write-wins
([LLP 0085](./0085-jazz.research.md)); every surviving close peer — PowerSync,
Turso, InstantDB, Triplit — ships server-authoritative LWW
([LLP 0022](./0022-electric-powersync-turso.research.md),
[LLP 0082](./0082-instantdb.research.md),
[LLP 0084](./0084-triplit-ditto.research.md)). Ditto, the one thriving
production-CRDT vendor, requires mesh-without-a-server markets to justify the
model and instructs customers to derive business state at read time rather
than trust merge semantics (LLP 0084). This RFC's refusal to treat ordinary
rows as replicated registers is the cohort-wide conclusion, not a local taste.

**For the carve-out, the industry converges on the same shape this RFC
proposes.** ElectricSQL's only flagged CRDT reintroduction is scoped to
Yjs-style collaborative documents (LLP 0022); Cloudflare ships Y-PartyServer —
Yjs rooms on Durable Objects, Snapback's own hosted substrate
([LLP 0083](./0083-cloudflare-do-d1-prior-art.research.md)); and Jazz v2,
having abandoned CRDT replay as its foundation, retains rich-text merging as a
*per-type merge strategy* inside a server-authoritative system (LLP 0085).
"CRDT as a typed document primitive under server authority" is where the field
lands; this RFC is Snapback's version of that landing.

## Scope

The first document model includes:

- an ordered list of paragraph, heading, checklist-item, quote, code, and image
  blocks;
- plain text plus bounded inline marks on textual blocks;
- concurrent insert, delete, move, mark, and block-attribute operations;
- retained offline reads and replay of locally originated operations;
- durable revision history, comments, and granular document membership;
- cursor and selection presence through LLP 0013;
- deterministic snapshots and bounded operation-log compaction; and
- large-document loading by block window and version frontier.

The first model excludes tables, arbitrary nested block trees, executable
embeds, peer-to-peer transport, encrypted collaboration, binary asset bytes,
and arbitrary third-party editor update formats. Image blocks reference LLP
0044 asset ids; they do not carry asset bytes.

## Identity and clocks

Every durable object carries an immutable, application-scoped identity:

- `documentId` identifies the document;
- `blockId` is a trusted Snapback id created with the block insertion;
- `operationId` is `(authorityInstanceId, counter)`, where `counter` is
  strictly increasing for one retained client outbox and
  `authorityInstanceId` is the opaque, never-reused authority identity already
  required by LLP 0043;
- `atomId` is `(operationId, scalarOffset)`, where `scalarOffset` is a
  zero-based unsigned 32-bit offset into that insertion operation's validated
  Unicode-scalar sequence;
- `streamIncarnation` identifies the reset/artifact stream; and
- `frontier` is a sparse map from authority identity to the greatest contiguous
  **operation** counter incorporated for that authority.

One operation consumes exactly one authority counter regardless of its payload
size. A text insertion may create several atom ids but does not reserve
additional counters. Frontiers, dependency gaps, settlement, and idempotency
refer only to operation ids. The byte order of operation ids is a deterministic
tie-breaker, not a claim about wall-clock order or user-visible causality.

An operation must carry the application, database, target profile, stream
incarnation, document, authorization witness, operation id, dependency
frontier, and payload. A counter may have at most one canonical payload. The
server treats an identical replay as success and rejects a reused operation id
with different bytes as `SNAPBACK_DOCUMENT_OPERATION_ID_REUSED`.

Client wall clocks never order edits. Server receipt time is audit metadata,
not a convergence input.

## Canonical wire and hash profile

The v1 wire profile is `snapback-document-canonical-json-v1`. Generated closed
schemas reject unknown fields, duplicate object keys, non-integer JSON numbers,
unpaired surrogates, noncharacters forbidden by the declared text schema, and
non-canonical base64url. Object keys are UTF-8 strings sorted by unsigned UTF-8
bytes; arrays preserve semantic order; unsigned counters use minimal decimal
notation; optional fields are either present with a value or absent, never
silently rewritten between absent and `null`; byte strings and opaque ids use
unpadded base64url.

Each retained object hashes
`UTF8(domain) || 0x00 || UTF8(canonicalJson)`, where the closed domain is one of
`snapback-document-operation-v1`, `snapback-document-frontier-v1`,
`snapback-document-snapshot-v1`, or
`snapback-document-settlement-v1`. SHA-256 is the v1 digest. Tuple identities
are canonical arrays with fixed arity, so string concatenation cannot create a
framing collision. Cross-language golden vectors include non-ASCII ids,
maximum counters and offsets, omission versus `null`, changed unknown fields,
and objects that would collide under delimiter-only framing.

## Replicated structure

### Blocks

The document root is a replicated growable array. An inserted block names the
left neighbor it observed, or the root sentinel. Concurrent siblings are sorted
by the unsigned byte ordering of their insertion operation ids. A deleted block
keeps a tombstone until compaction makes its identity stable. Delete wins for
that `blockId`; a later visible replacement allocates a new block identity.
Moving a live block is one atomic operation that tombstones the old placement
and inserts a placement for the same `blockId`; concurrent moves select the
placement with the greatest operation id and retain losing placements only as
history, never as future anchors.

Materialization first chooses the greatest admitted placement for every live
block. An anchor to a deleted block resolves through that block's retained
placement ancestry to the nearest live predecessor, or the root sentinel. The
chosen placements then form a directed predecessor graph. If a component
contains a cycle, the placement edge with the greatest operation id in that
cycle is ignored for materialization and its block is reattached to the root;
the process repeats until acyclic. Root siblings and ordinary siblings retain
the insertion-operation byte order. This total algorithm is independent of
traversal and delivery order. Golden vectors cover delete-versus-move,
move-after-deleted-anchor, `A-after-B`/`B-after-A`, larger cycles, and a move
that loses before a later operation names the stable `blockId`.

Block attributes are last-writer-wins registers ordered by operation id. This
limited rule is acceptable for presentation attributes such as heading level
or checklist checked state; application invariants and permissions are not
block attributes.

### Text and marks

Text within a block is another replicated growable array. Each insertion names
the atom after which it was authored and carries one Unicode scalar value.
Concurrent siblings use operation-id byte ordering. A deletion names atom ids;
delete is monotonic and wins over concurrent or later presentation changes.
The materialized string is a depth-first traversal from the root sentinel that
omits tombstoned atoms.

Inline marks are immutable intervals whose endpoints are atom identities and
whose kind and JSON value come from a generated, size-bounded schema. Deleting
or superseding a mark names its identity. Concurrent overlapping marks of the
same exclusive kind use the greatest operation id for each materialized atom;
non-exclusive marks compose in operation-id order. Generated code rejects
unknown mark kinds or values before enqueue and the server validates them
again.

Mark intervals are half-open `[start, end)` in materialized atom order.
`start` has right affinity and `end` has left affinity: concurrent insertion
exactly at the start is outside the mark, and insertion immediately before the
end is inside it. A deleted endpoint resolves to its nearest surviving neighbor
in the endpoint's affinity direction; if no atom survives, the mark
materializes empty but remains in history. Reducer offsets are Unicode-scalar
offsets. Editor adapters alone expand selections and deletion UI to pinned
Unicode extended-grapheme boundaries; they may not change the underlying atom
set. Golden vectors cover combining marks, emoji ZWJ sequences, regional
indicators, endpoint deletion, and concurrent insertion on both boundaries.

Insert payloads carry one validated sequence of 1–4,096 Unicode scalars.
Canonicalization expands it into atom ids `(operationId, 0)` through
`(operationId, scalarCount - 1)` before reduction. The canonical operation hash
still covers the one insertion operation and its complete scalar array. A
one-scalar and multi-scalar insertion therefore consume one counter each and
cannot collide with a later non-insert operation.

## Canonical reduction

The same pure reference reducer is compiled or generated for every supported
client. It must:

1. reject operations for another identity tuple or stream incarnation;
2. canonicalize and validate the payload;
3. retain an operation whose dependencies are missing without exposing its
   effects;
4. apply newly ready operations in operation-id byte order until no more become
   ready; and
5. emit a canonical snapshot and frontier independent of delivery order,
   duplication, batching, reconnect count, or process restart.

The server uses the same golden corpus as clients. A platform that cannot run
or prove an equivalent reducer reports `Online`, not `Parity`, for this profile.

Malformed dependency cycles, counters beyond the declared contiguous frontier,
references to compacted-but-unknown identities, oversized payloads, and
unsupported schema versions fail closed with structured diagnostics. They do
not silently become whole-document replacement mutations.

## Storage and transactions

The provider stores:

- document metadata and current authorization fields in ordinary Snapback
  tables;
- an append-only operation table keyed by document and operation id;
- a canonical snapshot, snapshot hash, schema version, and stable frontier;
- per-authority contiguous counter and gap metadata;
- durable comments anchored to a block plus optional atom endpoints; and
- compaction and audit metadata.

Admission of a batch, operation-id uniqueness, per-document version allocation,
and the server's durable settlement record commit in one storage transaction.
The client clears its local outbox only after it receives or later rediscovers
that settlement; no transaction spans client and server. The resulting ordinary
Snapback commit version drives live-query invalidation. A client can therefore
subscribe to a document head using the existing realtime lane, then fetch
operations after its frontier; Snapback does not create a second unversioned
push protocol.

Limits are target-profile facts. The initial required floor is 2 MiB of visible
UTF-8 text, 10,000 blocks, 100 operations per batch, 256 KiB per canonical
batch, and 32 concurrently connected editors. It also caps retained atoms and
tombstones at 4,000,000, admitted operations at 2,000,000 per document,
outstanding dependency gaps at 10,000, marks at 100,000, comments at 100,000,
active retention leases at 1,024, and reducer work at 250,000 visited
operations per admission before returning a typed backpressure/resnapshot
outcome. These are conformance floors and safety ceilings for v1; the dated
performance instrument must preregister latency, memory, storage
amplification, and invalidation fan-out thresholds separately. A target may
publish higher product limits only with corresponding resource evidence, and
lower or missing floors cannot claim `collaborative-document-v1`.

## Offline replay and resynchronization

The retained client store keeps the last verified snapshot, frontier, and local
operation outbox under LLP 0043's complete application/database/target/stream
identity. Local edits reduce immediately into a labeled optimistic document.
Reconnect proceeds in this order:

1. authenticate and revalidate document visibility;
2. fetch a snapshot or all missing remote operations through the current head;
3. reduce remote and local operations together;
4. submit local operations in counter order with their original authority
   descriptor; and
5. clear an outbox operation only after the server returns its idempotent
   settlement and authoritative frontier.

Unlike an ordinary row mutation, a valid document operation does not fail just
because the document head advanced. It can be admitted when its dependencies
are available and its authorization witness remains valid. Missing dependencies
produce `SNAPBACK_DOCUMENT_DEPENDENCY_MISSING` plus the required snapshot or
frontier repair instruction. Permission loss, stream reset, schema
incompatibility, or an invalid authority descriptor quarantines local
operations and exposes export/discard UI; the client must not replay them under
a new principal.

Every retained client lease names document, authority instance, stream,
greatest potentially referenced frontier, expiry, and lease generation. A
client may renew only while currently authorized and before expiry. Operations
created under an expired lease are never silently transplanted: the server
returns `SNAPBACK_DOCUMENT_RESYNC_REQUIRED`, the client resnapshots, and the old
operations remain quarantined/exportable. An explicit user-reviewed rebase may
create new operation ids against the new snapshot and records predecessor
digests; it does not rewrite or present the expired operations as admitted.

## Authorization and sharing

Document metadata names owners, editors, commenters, and viewers through the
LLP 0053 authorization model. Authorization is checked for every snapshot,
operation fetch, operation admission, comment, history read, and ephemeral-room
grant. Generated read and write sets include the membership and document rows
that determine the decision so permission changes create invalidation
obligations.

Authorization is document-wide in v1. Blocks and atoms do not carry independent
ACLs. An editor adapter may hide UI affordances, but only the document
membership decision authorizes durable operation fetch or admission. Per-block
authorization would require a later profile with new visibility, compaction,
and index-invalidation semantics.

The server never accepts an operation merely because its authority once edited
the document. Offline replay presents the enqueue-time authority descriptor and
must pass the current authorization decision. A denied operation is quarantined
with a typed reason. Cross-user, cross-app, cross-database, cross-target, and
cross-stream operation injection must fail without disclosing document
existence.

Cursor and selection messages use a connection grant scoped to the same
document room. They contain actor presentation metadata and atom anchors, have
a short TTL, and never enter snapshots, history, exports, backups, or the
operation log.

## History, comments, and compaction

Every accepted operation remains attributable to its principal and authority
instance in the audit projection. User-visible revisions are named frontiers,
not copies of mutable rows. Restoring a revision creates new inverse or
replacement operations; it never rewinds the stream or reuses ids.

Comments are ordinary durable rows. An anchor that loses all visible atoms
remains attached to its block and is marked orphaned rather than silently
moving to unrelated text.

Compaction may replace an operation prefix with a content-addressed canonical
snapshot only after the server proves a stable frontier. For v1, stability is
administrative: the server retains every operation newer than the oldest
unexpired client-retention lease and never compacts past an outstanding replay
settlement or authorization obligation. The compacted snapshot retains a
bounded anchor skeleton for every tombstoned block or atom reachable from any
live lease: identity, deletion fact, placement/predecessor redirect, and
snapshot generation, but no deleted display text. No skeleton entry may retire
until the maximum referenced lease and settlement horizon closes. A reconnect
behind the retained frontier receives the snapshot plus subsequent operations.
A client beyond its lease horizon receives the typed resync/quarantine boundary
above rather than an invented anchor repair.

Snapshot creation runs against a fixed document head, verifies reduction and
hash equality, then publishes with a per-document snapshot-generation CAS in
the same database authority. Only the current fenced compactor generation may
publish. Failover must supersede that generation before reducing; a stale
compactor cannot publish even if its bytes are otherwise valid. The prior
snapshot and anchor skeleton remain until the new projection and redirects are
durable.

Backups include document metadata, operation logs, snapshots, comments,
membership, settlement records, and stream identity. Restore verification
re-reduces a pinned document sample and compares canonical snapshot hashes.

## Generated API shape

The exact surface is generated from a document declaration rather than
hand-written endpoint strings. Its conceptual operations are:

- `documents.open(documentId, frontier?)` → snapshot or missing operations;
- `documents.apply(documentId, operations, authorityDescriptor)` → settlements
  and authoritative frontier;
- `documents.history(documentId, cursor)`;
- `documents.comments.*`; and
- `documents.presence(documentId)` → an LLP 0013 ephemeral handle.

The generated client exposes `authoritative`, `optimistic`, `stale`,
`reconnecting`, `quarantined`, and `error` as distinct state. It exposes the
operation outbox and conflict/repair facts to Exact through the same provider
fact boundary used by LLP 0043; Exact owns their render projection.

## Portability and target claims

The model depends only on transactional uniqueness, ordered operation scans,
content-addressed blobs or rows, and the existing live invalidation stream. A
SQLite implementation and one hosted implementation must run the same corpus.
Storage-specific shortcuts may accelerate reduction but cannot change the
canonical snapshot.

Capability reports distinguish:

- `Missing`: no document operation implementation;
- `Online`: server reduction and live delivery, no retained local reducer;
- `OfflineRead`: retained snapshots, no local edits;
- `OfflineWrite`: retained snapshots and queued edits, but no proven local
  deterministic reduction; and
- `Parity`: deterministic local reduction, replay, rebase, authorization
  fencing, and the complete acceptance suite.

## Acceptance

The RFC is implemented only when all of the following are executable and
retained:

- two clients on different supported platforms concurrently insert at the
  same block and text anchors, receive operations in opposite and duplicated
  orders, and converge to byte-identical snapshots and hashes;
- two offline clients edit, delete, move, and mark overlapping content, then
  reconnect in both orders and converge without losing either admissible edit;
- reconnect during partial batch delivery, process restart, duplicate replay,
  and a missing-dependency repair all converge and create one settlement per
  operation id;
- a permission revocation while offline quarantines queued edits, invalidates
  retained visibility, denies presence and history, and never replays under a
  replacement session for the same user;
- cross-tenant/app/database/target/stream injection and operation-id payload
  substitution fail closed;
- compaction racing with edit admission preserves the canonical hash, and a
  client behind the compacted frontier resnapshots then converges;
- a 2 MiB/10,000-block fixture opens by window, edits without whole-document
  transfer, and stays within preregistered memory, latency, and fan-out budgets;
- comments, orphan anchors, history restore, backup, destroy/replace, and
  restore preserve the pinned snapshot hash and authorization behavior;
- cursor and selection presence works during edits but leaves no durable or
  exported bytes; and
- the same golden operation corpus passes in the server, web client, and Exact
  Native on both iOS and Android; a Contract/Hermes reducer is an additional
  reported tuple, not a substitute for either required Exact Native OS.

The reference application is a Notion/Docs-style document, not a toy textarea.
Its retained receipt names the exact target profile, two repository revisions,
schema/artifact hashes, client platforms, reducer corpus hash, snapshot hashes,
limits, and every GAP.

## Build vs integrate — canonical reducer selected

The Scope section excludes "arbitrary third-party editor update formats," which
implicitly rejects integrating an existing CRDT library such as Yjs. The
2026-07 research makes that a decision with a live, cheaper-than-before
alternative rather than a default, so the trade is recorded here explicitly.
[inferred]

**Integrating Yjs would buy:** a mature ecosystem of editor bindings
(ProseMirror/TipTap, CodeMirror, and others) instead of building adapters atom
by atom; battle-tested sequence-CRDT internals; and, on the hosted target, an
existing room server on Snapback's own substrate (Y-PartyServer,
[LLP 0083](./0083-cloudflare-do-d1-prior-art.research.md)).

**Making Yjs updates the wire authority would cost:** the properties this RFC
is built around. Yjs
updates are an opaque binary format, which defeats the atom-level authorization
witnesses, the canonical reference reducer, the deterministic
golden-corpus acceptance gates, and the bounded, inspectable operation payloads
specified below; server-side admission could at most validate a bounded
materialized room state rather than each semantic operation.
Compaction, history, and per-block authorization would follow Yjs's model, not
Snapback's. The bespoke model keeps the document lane inside Snapback's
authorization and acceptance story at the price of building and proving the
reducer on every client platform and writing editor adapters ourselves.

V1 selects the middle path: this RFC's canonical operation model and reducer
are the wire, storage, convergence, and audit truth; applications consume
generated block/editor adapters rather than constructing atoms directly.
A Yjs-compatible editor binding may be offered only as a derived adapter. It
must translate to canonical operations before admission and pass bidirectional
fidelity, selection, undo, compaction, and authorization witnesses. Opaque Yjs
updates are not stored or accepted as `collaborative-document-v1` authority.

## Non-goals and claim boundary

This RFC does not claim generic CRDT support, Google Docs fidelity, arbitrary
editor compatibility, end-to-end encryption, peer-to-peer sync, horizontal
realtime scale, or unbounded documents. It does not authorize treating payment,
inventory, permissions, jobs, or other application invariants as replicated
registers. Those continue through ordinary Snapback transactions and their own
governing RFCs.

While this document is Draft, implementation may be exploratory but no public
Snapback profile may report `collaborative-document-v1` as supported. LLP 0063
Step 6 requires maintainer acceptance of these semantics plus the executable
witnesses above.

## Decisions still requiring ratification

The 2026-07-26 author-side review application proposes the v1 choices above:
canonical Snapback operations with generated adapters; document-wide
authorization; operation-scoped atom ids; lease-bounded offline admission;
winning block placements with deterministic cycle breaking; administrative
stable-frontier compaction plus anchor skeletons; and Exact Native iOS and
Android as the mandatory non-web reducer tuples. These are not accepted merely
because they are written here. Independent protocol review and maintainer
ratification remain prerequisites before implementation can satisfy LLP 0063.
