# LLP 0068: Collaborative document convergence

**Type:** RFC
**Status:** Draft
**Systems:** Documents, Collaboration, Sync, Offline, Realtime, Auth, Storage, Client integration, Code generation, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-07-26 (author-side review reconciliation: separate operation and atom identities, total block-move reduction, canonical bytes, mark and grapheme behavior, lease-bounded compaction, abuse bounds, and the bespoke canonical-model decision; remains Draft pending independent review and executable witnesses). 2026-07-23 (research corroboration from the LLP 0082–0085 prior-art passes added — two first-party core-CRDT retreats and the industry convergence on typed-document carve-outs — plus an explicit build-vs-integrate section naming the Yjs alternative and a matching open question; no change to the proposed semantics). 2026-07-20 (initial proposal for LLP 0063's document pressure test)
**Related:** LLP 0000, LLP 0004, LLP 0008, LLP 0010, LLP 0011, LLP 0012, LLP 0013, LLP 0018, LLP 0022, LLP 0037, LLP 0043, LLP 0053, LLP 0063, LLP 0070, LLP 0071, LLP 0083, LLP 0084, LLP 0085

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
- `operationId` is `(authorityInstanceId, operationCounter)`, where the
  unsigned 64-bit counter is strictly increasing for one retained client
  outbox and the authority id is the opaque, never-reused 128-bit identity
  already required by LLP 0043;
- `blockId` is the `operationId` of its block insertion;
- `placementId` and `markId` are the `operationId` of the operation that
  creates them;
- `atomId` is `(insertionOperationId, scalarOffset)`, where `scalarOffset` is
  the zero-based unsigned 32-bit index in the insertion's canonical scalar
  sequence;
- `streamIncarnation` identifies the reset/artifact stream; and
- `frontier` is a sparse map from authority identity to the greatest contiguous
  **operation** counter incorporated for that authority.

One durable operation consumes exactly one operation counter regardless of
payload size. Atom ids do not consume counters and never appear as frontier
keys. A text insert containing `N` Unicode scalars creates atom offsets
`0..N-1`; an empty insertion is invalid. The next operation uses the next
operation counter, not `counter + N`. This is the only identity allocation
rule in v1. Authority ids are nonzero, counters start at one, and root/start/end
sentinels use explicit schema tags outside the raw-id namespace.

An operation must carry the application, database, target profile, stream
incarnation, document, authorization witness, operation id, dependency
frontier, and payload. A counter may have at most one canonical payload. The
server treats an identical replay as success and rejects a reused operation id
with different bytes as `SNAPBACK_DOCUMENT_OPERATION_ID_REUSED`.

Client wall clocks never order edits. Server receipt time is audit metadata,
not a convergence input.

## Replicated structure

### Blocks

The document root is a replicated growable array. A block insertion or move
creates a placement naming the `blockId` of the left neighbor it observed, or
the root sentinel. Anchors are block ids, never placement ids. A move also
names the placement it observed for diagnostics, but stale observation does
not make otherwise valid concurrent work order-dependent. Concurrent
placements for one block select the placement with the greatest operation id;
losing placements remain audit tombstones and cannot be future anchors.

A block deletion is monotonic and wins over every concurrent or later move.
Moving a deleted block settles as `blockDeleted` and never resurrects it; a
user-visible reinsertion allocates a new block id. An operation may anchor
after a block that is concurrently deleted or moved. Reduction first chooses
the winning placement for every block, then materializes the order with this
total algorithm:

1. construct the one-parent graph for all blocks, including deleted blocks;
2. find every cycle and redirect to the root the edge whose placement id is
   greatest in that cycle, repeating until the full graph is acyclic;
3. for a live block anchored to a deleted block, follow the now-acyclic chain
   until reaching a live block or the root;
4. exclude deleted blocks from visible output; and
5. visit root children and then descendants depth-first, sorting siblings by
   ascending placement-id bytes.

Missing anchors whose insertion is not present remain dependency-blocked.
Anchors proven outside the retained frontier use the compaction repair rules
below. The golden corpus includes concurrent delete/move, anchors after
deleted and moved blocks, `A-after-B`/`B-after-A` cycles, equal graphs delivered
in every order, and an attempted anchor to a losing placement.

Block attributes are last-writer-wins registers ordered by operation id. This
limited rule is acceptable for presentation attributes such as heading level
or checklist checked state; application invariants and permissions are not
block attributes.

### Text and marks

Text within a block is another replicated growable array. Each insertion names
the atom after which it was authored and carries one or more Unicode scalar
values. Its first atom names that authored anchor and each subsequent atom
names the preceding offset from the same insertion. Concurrent siblings use
atom-id byte ordering. A deletion names atom ids; delete is monotonic and wins
over concurrent or later presentation changes. The materialized string is a
depth-first traversal from the root sentinel that omits tombstoned atoms.

Inline marks are immutable half-open intervals whose start and end are atom
identities or the start/end sentinels and whose kind and JSON value come from a
generated, size-bounded schema. Endpoints are interpreted in the full
tombstone-preserving atom traversal at the mark operation's dependency
frontier. A mark covers only atoms present in that frontier and in
`[start, end)`; concurrent and later insertions do not inherit it. Deleting an
endpoint therefore does not move the interval, and an editor extends a mark by
issuing a superseding mark operation rather than relying on cursor affinity.
Deleting or superseding a mark names its identity. Concurrent overlapping
marks of the same exclusive kind use the greatest operation id for each
materialized atom; non-exclusive marks compose in operation-id order.
Generated code rejects reversed, missing, unknown, or out-of-frontier
endpoints and unknown mark kinds or values before enqueue, and the server
validates them again.

Insert payloads may batch adjacent atoms for transport, but canonicalization
decodes the exact UTF-8 string to Unicode scalar values and assigns consecutive
scalar offsets before hashing or reduction. It does not normalize Unicode.
Invalid UTF-8, surrogate code points, and non-scalar values fail closed. The
batch is one operation and is not an alternative semantic representation.

The wire reducer operates on scalars, not grapheme clusters. Generated editor
adapters pin Unicode 15.1 extended-grapheme segmentation for selection,
backspace, and delete: a user edit is translated to the complete current set
of atom ids in the selected grapheme(s) before enqueue. Segmentation never
changes the canonical reducer. Adapter fixtures cover combining marks, emoji
ZWJ sequences, variation selectors, skin tones, and regional indicators.

## Canonical bytes and ordering

`authorityInstanceId` is 16 raw bytes, `operationCounter` is a big-endian
unsigned 64-bit integer, and `scalarOffset` is a big-endian unsigned 32-bit
integer. Operation ids compare lexicographically over the 24 concatenated raw
bytes; atom ids compare by their operation id and then scalar offset. JSON
representations use lowercase fixed-width hexadecimal strings for every raw id
and integer, so no JavaScript number participates in identity.

Every operation, frontier, snapshot, settlement, and anchor skeleton has a
closed versioned schema serialized as RFC 8785 JCS UTF-8. Unknown fields,
duplicate keys, invalid UTF-8, non-NFC schema/attribute names, and JSON numbers
in integer fields are refused. User text remains byte-preserving and is not
normalized. SHA-256 inputs are length-framed and domain-separated:

`domain UTF-8 || 0x00 || uint64be(bodyLength) || canonicalBody`

The domains are `snapback-document-operation-v1`,
`snapback-document-frontier-v1`, `snapback-document-snapshot-v1`,
`snapback-document-settlement-v1`, and
`snapback-document-anchor-skeleton-v1`. Cross-language golden vectors include
maximum counters, non-ASCII text and attributes, canonically equivalent but
byte-distinct input, unknown-field refusal, domain-collision attempts, and
changed-one-field digest rejection.

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
and creation of the server settlement record commit in one storage
transaction. The resulting ordinary Snapback commit version drives live-query
invalidation. A client can therefore subscribe to a document head using the
existing realtime lane, then fetch operations after its frontier; Snapback
does not create a second unversioned push protocol. Clearing a client outbox is
a separate receipt step: after an ambiguous response the client reads the
server settlement by operation id and clears only after its canonical payload
digest and authoritative frontier match.

Limits are target-profile facts. The initial required floor is 2 MiB of visible
UTF-8 text, 10,000 blocks, 100 operations per batch, 256 KiB per canonical
batch, and 32 concurrently connected editors. A target may publish higher
limits, but lower or missing limits cannot claim `collaborative-document-v1`.

Every claiming target also publishes hard bounds for total retained atoms,
tombstones, placements, marks, comments, operation bytes, dependency gaps per
authority, authorities per document, named history frontiers, unexpired
retention leases, and reducer work per admission. Approaching a bound triggers
bounded compaction or typed backpressure; crossing it returns
`SNAPBACK_DOCUMENT_LIMIT_EXCEEDED` with the dimension and repair action before
allocating unbounded memory or CPU. The deterministic abuse corpus proves that
a tiny visible document with adversarial deletes, marks, gaps, and lease churn
cannot evade those bounds.

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

## Authorization and sharing

Document metadata names owners, editors, commenters, and viewers through the
LLP 0053 authorization model. V1 authorization is document-wide; block-level
ACLs are not implied by atom-level operation inspection. Authorization is
checked for every snapshot, operation fetch, operation admission, comment,
history read, and ephemeral-room grant. Generated read and write sets include
the membership and document rows that determine the decision so permission
changes create invalidation obligations.

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
snapshot only after the server proves a stable frontier. Each retained
authority receives a server-clocked lease containing `leaseId`, document and
stream identity, observed frontier, and `expiresAt`. An offline operation is
admissible only under the same still-unexpired lease from which it was
authored. Renewal requires an authoritative sync; a client cannot extend a
lease while offline.

For every unexpired lease, the provider retains a content-addressed anchor
skeleton containing all block, placement, atom, and mark tombstone topology
that any operation based on that lease's frontier may legally name. Compaction
may discard operation bodies below the cut, but not this topology, unsettled
operation identities, authorization/audit obligations, or the prior snapshot
needed to verify the new artifact. Skeleton publication is transactionally
bound to a fixed document head and its snapshot hash.

After a lease expires, an operation based on its old frontier fails with
`SNAPBACK_DOCUMENT_RETENTION_EXPIRED` and is quarantined for export or discard.
V1 never silently rewrites its anchor or replays it with a new operation id.
A reconnect behind the retained frontier but holding an unexpired lease
receives the current snapshot, its verified skeleton, and subsequent
operations, then reduces its original operation unchanged. A compaction
fixture deletes and compacts an offline edit's predecessor, reconnects both
before and after lease expiry, proves convergence in the first case and typed
quarantine in the second, and races lease renewal against skeleton retirement.

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
- `Parity`: deterministic local reduction, replay, resnapshot, typed
  retention-expiry quarantine, authorization fencing, and the complete
  acceptance suite.

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
  transfer, and stays within preregistered memory, latency, CPU, log-growth,
  and fan-out budgets;
- an adversarial small-visible-document fixture reaches each declared history,
  tombstone, gap, lease, and reducer-work bound with typed backpressure and no
  unbounded allocation;
- comments, orphan anchors, history restore, backup, destroy/replace, and
  restore preserve the pinned snapshot hash and authorization behavior;
- cursor and selection presence works during edits but leaves no durable or
  exported bytes; and
- the same golden operation corpus passes in the server, web client, and at
  least one non-web client.

The reference application is a Notion/Docs-style document, not a toy textarea.
Before its judged candidate exists, a dated prospective instrument amendment
must freeze the memory, latency, CPU, log-growth, and fan-out methods,
thresholds, target/hardware identities, idle-host rule, calibration candidate,
and untouched holdout. Calibration and holdout receipts are separate and
revision-bound. Its retained receipt names the exact target profile, two
repository revisions, schema/artifact hashes, client platforms, reducer corpus
hash, snapshot and skeleton hashes, limits, instrument amendment, and every
GAP.

## Canonical-model decision and editor adapters

V1 chooses the bespoke canonical operation, wire, storage, and reducer model in
this RFC. Applications edit through generated high-level editor adapters; the
atom-level transport is not a general public mutation surface. A ProseMirror
adapter is the first web integration and Exact Native is the mandatory
non-web reducer gate. A Contract/Hermes reducer is additionally required
before a Contract native carrier may claim this profile.

**Integrating Yjs would buy:** a mature ecosystem of editor bindings
(ProseMirror/TipTap, CodeMirror, and others) instead of building adapters atom
by atom; battle-tested sequence-CRDT internals; and, on the hosted target, an
existing room server on Snapback's own substrate (Y-PartyServer,
[LLP 0083](./0083-cloudflare-do-d1-prior-art.research.md)).

**Integrating Yjs would cost:** the properties this RFC is built around. Yjs
updates are an opaque binary format, which precludes this RFC's atom-level
admission and audit rules even though a room-authorized service could still
validate bounded materialized state. Compaction and history would follow Yjs's
model, not Snapback's. That is a valid different product, but not the v1
profile selected here.

An editor adapter may use a Yjs-backed editor internally only if it translates
to and from this canonical model and passes bidirectional fidelity,
authorization, compaction, and adversarial-update witnesses. Snapback does not
ingest Yjs updates as authoritative bytes in v1. This decision preserves the
authorization and acceptance contract at the acknowledged cost of building
the reducer on every claiming platform and maintaining editor adapters.

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

## Open questions

1. Which ProseMirror version and schema subset should be pinned for the first
   generated adapter?
2. What default hard limits should the first hosted target choose above the
   mandatory 2 MiB/10,000-block claim floor?
3. Should a later profile add an explicit, user-approved operation-rebase
   protocol after retention expiry, or preserve export/discard as the product
   boundary?

These questions affect adapter packaging and target defaults, not v1 identity,
reduction, compaction, or authorization semantics. This RFC remains Draft
until independent non-GPT review and executable model/property tests validate
the revised protocol.
