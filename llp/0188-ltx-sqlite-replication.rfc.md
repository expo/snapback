# LLP 0188 — Continuous SQLite replication via a vendored LTX replicator

**Type:** RFC
**Status:** Review
**Systems:** Storage, Backup and restore, Deployment, Control plane, CLI, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-08-06
**Revised:** 2026-08-06 (r4, post-loop rewrite applying the round-3
ledger — **unreviewed by the formal loop**: resume admits verified
ahead-of-head restart (prefix rule); durable keyring coverage records;
immutable genesis/succession chain; hosted epoch validation serialized
atomically with head advancement; keyring snapshots client-side
encrypted on every lane (resolves OQ2, subject to author ratification);
LLP 0072/0111 amendments made acceptance dependencies; checkpoint proof
binds replication and 0072 identities separately; pin lifetime extended
to all referencing artifacts; fencing acceptance matrix; G1 differential
leg must execute). 2026-08-06 (r3, super-refine round 2 delta findings:
restorable frontier = min(db position, keyring coverage) with the
keyring-before-dependent-frames ordering invariant; checkpoint proofs
bind and pin the governing keyring snapshot; replication incarnation
renamed, moved outside the database (sidecar), explicit resume-vs-
succession attach protocol; hosted 0072 epoch binding mandatory;
custody role split with store-enforced immutability; LLP 0057
boundary-4 equivalence argued and a dated 0057 amendment made an
acceptance dependency). 2026-08-06 (r2, super-refine round 1: the replicated unit is
the whole instance database including the auth catalog — the
data-plane/auth split was false per LLP 0057; checkpoint proof envelope
per LLP 0099; incarnation-based fencing with restore-side lineage
binding; confidentiality/custody section; declared-restore composition;
vendoring contingent on provenance verification). 2026-08-06 (Draft →
Review at llp-super-refine loop start)
**Related:** LLP 0007, LLP 0033, LLP 0044, LLP 0057, LLP 0072, LLP 0081,
LLP 0083, LLP 0099, LLP 0111, LLP 0134, LLP 0158

## Summary

Snapback has no continuous replication of its SQLite databases anywhere in
the system. The local server writes a WAL-mode SQLite file
(`src/storage.rs`); durability beyond the local disk exists only as the
LLP 0057 quiesced backup/restore image and as control-plane backup
manifests that LLP 0072 and LLP 0111 specify for the hosted lane. LLP 0099
(Accepted) already *requires* a "streaming backup" to a separately
permissioned object store as the qualifying pre-apply checkpoint for the
container-VM migration executor — but no LLP owns the design of that
stream. This RFC proposes to fill the gap by adopting the LTX replication
lane that celld (Deno's self-hosted Durable Objects runtime,
<https://github.com/denoland/celld>, Apache-2.0) has already built in
Rust: a WAL-tailing replicator that ships LTX segments (Litestream's v0.5
replica format, spec at superfly/ltx) to an S3-compatible bucket, restores
a database from the bucket, and exposes the replicated position so a
caller can gate on durability.

The proposal is deliberately narrow: take the *replication lane* (the
`crates/ltx` crate and its conformance posture), not celld's runtime,
placement, or lease machinery. Those belong to the LLP 0083 prior-art
discussion of self-hosted DO substrates and are out of scope here.

## Motivation

1. **The local-first durability story has a hole.** A Snapback instance's
   effective RPO today is "time since the last `snapback auth backup`
   run." Continuous replication turns that into a bounded, measurable
   number (seconds of WAL tail) against a bucket the operator owns —
   matching the self-hosted posture LLP 0033/0083 record and the
   operator-owned-bucket shape celld demonstrates in production form.
2. **LLP 0099's checkpoint needs an owner.** The Accepted executor
   profile binds admission to "create and read back the streaming backup,
   restore it into isolation" — with the stream itself unspecified. An
   LTX stream is the right substrate for that artifact; §3 defines the
   proof envelope that turns a stream position into the checkpoint LLP
   0099 actually requires, composing with LLP 0072's backup-manifest
   identities rather than replacing them.
3. **The engineering is substantially done, in our language, under our
   license.** celld's `crates/ltx` is a Rust port of Litestream v0.5
   (seeded from rustyriver, replication behavior and test vectors taken
   from Litestream v0.5.11, format pinned to superfly/ltx v0.5.1), with a
   conformance suite that verifies byte-for-byte output compatibility
   against the real Litestream binary (`differential_xtool`). Adopting it
   buys us a tested WAL reader, LTX encoder/decoder, restore path, and
   durability-position API instead of a from-scratch replication project.

## Prior art

- **Litestream / LTX.** Litestream v0.5 rebased its replica format on LTX
  (log-structured transactions, superfly/ltx), the format LiteFS
  introduced: page-level transaction files with checksums, compactable
  into snapshot levels, restorable to any retained transaction boundary.
  This is the de-facto standard for SQLite-to-object-store streaming.
- **celld.** Uses the same crate to get RPO=0 semantics: a cell's write is
  acknowledged only once the bucket holds it (~90 ms durable-write cost),
  and a cell restores from the bucket when its lease moves. We adopt the
  mechanism but not the default policy (see Design §3).
- **LLP 0022** surveyed Turso/Electric/PowerSync sync engines; those are
  *logical* sync products. LTX is physical page replication of one
  database file — a durability lane, not a sync lane — and does not
  overlap LLP 0008/0155's client-sync direction.

## Design

### 1. Vendor the crate, track upstream — contingent on provenance verification

Vendor celld's `crates/ltx` (Apache-2.0, attributions preserved) with a
pinned upstream commit and a provenance receipt, following the
`vendor/` + receipt discipline the repo already uses for skills. A
crates.io dependency is preferred if/when Deno publishes the crate
stably; vendoring is the default because the crate is young and we want
the conformance suite (upstream Litestream vectors + differential test)
running in our CI, not just theirs. Adoption is contingent on verifying,
at the pinned commit: the crate's and its transitive dependencies'
license metadata and required notices; the provenance of the ported test
vectors and of the reference Litestream binary the differential test
drives; and reproduction of the conformance results in our CI (gate G1).
Snapback-side glue lives in our tree; the vendored crate stays
patch-clean **except, if required, a storage-backend adapter** (§2) —
any other divergence is recorded in the receipt.

### 2. Integration point: the whole instance database

The replicated unit is the instance's single SQLite database — the file
LLP 0057 backups stage as `database.sqlite3`. Per LLP 0057 that file
contains the app tables **and** the `_auth_*` catalog and
`_snapback_meta` marker; the auth keyring is a sidecar file, not in the
database. LTX replication is physical and page-level: it cannot exclude
tables, so the stream necessarily carries the auth catalog (session
token digests, identities, agent-credential rows). Two consequences are
binding: the stream's confidentiality posture is the database's (§5),
and restore is an auth-bearing operation (§6).

The keyring sidecar is replicated as content-addressed (digest-named)
**keyring snapshots** in the same prefix, under an ordering invariant:
when the local keyring changes (LLP 0057 publishes the keyring before
any digest computed with a new key exists), the new snapshot must be
durable in the prefix **before** any WAL frame committed after that
publication is counted as replicated. Coverage is a durable mapping,
never an inference from upload order: each snapshot upload appends an
immutable, digest-named **coverage record** in the generation prefix
binding the snapshot digest to the first position it governs; the
governing snapshot for a position is the record with the greatest
covered-from at or below it, and a snapshot (with its record) is
retained for as long as any position it covers remains restorable. The
lane's governing position is therefore the **restorable frontier** —
min(replicated database position, keyring coverage) — and every RPO/lag
claim, the §3 `async` metric, and G2's bounded-loss exit are measured
against the frontier, not the raw database position. This gives every
restorable position a governing keyring snapshot by construction (§6).

When replication is enabled, the replicator owns WAL checkpointing:
auto-checkpoint is disabled on every writer connection, and all
checkpoint/truncation paths — including non-writer triggers such as
last-connection-close truncation from the reader pool — are mediated by
the replicator so no WAL frame is truncated before it is shipped (the
Litestream model).

Object-store I/O goes through a narrow object-store protocol the
replication lane defines: put/get of immutable keys plus a
conditional-write (compare-and-swap) primitive that §4 requires,
qualified per store. Whether the vendored crate's own storage backend
sits behind that protocol or is replaced by an adapter over the existing
SigV4 core (`src/assets_s3.rs`, MinIO-qualified per LLP 0044) is decided
at vendoring time by inspecting the crate's storage seam; either outcome
is recorded in the vendoring receipt. The target is a **separately
permissioned bucket or prefix** per LLP 0111's backup posture, under the
custody rules of §5.

### 3. Durability policy: bounded-RPO async by default, gated checkpoint on demand

celld's RPO=0 default (ack after bucket write) is wrong for Snapback's
local-first posture — user-visible commits must not wait ~90 ms on a
bucket. The proposed modes:

- **`async` (default):** commits ack locally; the replicator ships the
  tail continuously and exposes the restorable frontier (§2). The honest
  claim is "RPO ≤ observed frontier lag," not zero; the implementation
  contract must define the lag clock and position mapping, the staleness
  of the observation, and stall behavior — a stalled replicator (or a
  lagging keyring upload holding the frontier back) surfaces as degraded
  replication (doctor/status), never as a silently growing bound.
- **`checkpoint` (on demand):** a caller (the LLP 0099 executor, the LLP
  0072 backup flow, `snapback replicate checkpoint`) names a commit
  position `P` and receives a **checkpoint proof** or a refusal. The
  proof binds: the replication incarnation and generation lineage (§4)
  and — separately, on hosted targets — the applicable LLP 0072
  data/reset identity (`streamIncarnation`), a distinct authority; an
  exact retained LTX transaction boundary equal to `P` under a durable
  commit-position→TXID mapping recorded at capture; the content
  identities (digests) and read-back evidence of the immutable objects
  that materialize that boundary, **including the governing keyring
  snapshot for that boundary** — the proof must be a full-instance
  restorable artifact, since LLP 0072 manifests and LLP 0081's
  rollback-to-backup residual both restore the auth-bearing database;
  and isolated-restore evidence — the boundary restored into isolation
  and opened at the exact source schema, durable version, and replay
  floor, per LLP 0099's admission requirements. Only a full proof is
  bindable into a `MigrationCheckpointV1` or an LLP 0072 backup
  manifest. The named boundary **and its governing keyring snapshot**
  are **pinned against compaction and retention** for as long as any
  referencing artifact remains live — the consuming admission, LLP
  0081's rollback-to-backup residual, and any LLP 0072 backup manifest,
  rehearsal, or restore record that names the proof — not merely until
  the admission concludes: boundary retention is a correctness
  precondition here, not a cost knob (§OQ3 covers only the unpinned
  tail). The same contract defines the local WAL-growth policy while
  replication is stalled (checkpointing is replicator-mediated, so a
  stalled bucket grows the local WAL): a configured cap and the
  behavior at the cap, surfaced with the degraded state.

### 4. Single-writer safety: replication-incarnation fencing with explicit succession

Exactly one live process may replicate a given database to a given
prefix, on every lane — including self-hosted instances that have no LLP
0072 deployment identity. The fencing identity is a per-database
**replication incarnation** — deliberately named apart from LLP 0072's
`streamIncarnation`, which is the *application* data/reset authority
that 0072's restore translation rotates; the two are distinct and
neither substitutes for the other. The replication incarnation is a
random identifier minted at attach and held **outside the replicated
database** — in a local sidecar state file beside the keyring sidecar,
and in the bucket head — precisely so that backups, restore outputs, and
LLP 0158 fork copies of the database do not carry the source's
replication identity and can never impersonate its resume.

Mechanism: generations live under immutable per-generation prefixes;
each generation opens with an immutable, digest-named **genesis record**
in its own prefix binding the predecessor's incarnation and generation,
the predecessor's last head position, and the successor's **divergence
position** (the two differ after a restore-to-earlier-P succession, and
both are needed to judge a lineage at read time; the initial generation
writes a genesis with no predecessor). A single authoritative **head**
object names the current incarnation, generation, and position and
digest-binds its generation's genesis, so the full succession chain is
traversable from the head through immutable records; the head is
advanced only by conditional write (compare-and-swap, from §2's
protocol). Three positions exist at attach time — the local durable
database position, the sidecar-recorded shipped position, and the head
position — and the protocol must tolerate the crash windows between
segment ship, sidecar update, and head advance rather than demand
three-way equality. The attach protocol distinguishes resume from
succession:

- **Resume** — permitted when the local sidecar carries the head's
  incarnation and the head's lineage is a **verified
  checksum-continuous prefix of the local durable state** (local
  position ≥ head position, continuity proven from the head's position
  to the local tail). The ordinary `async` crash restart — a database
  ahead of the head by the unshipped WAL tail — resumes without
  ceremony, ships the tail, and advances the head. Resume continues the
  current generation and never mints identities.
- **Refusal / succession** — a genuinely rewound or divergent database
  (continuity from the head fails), or a missing or foreign sidecar
  (every fresh restore, fork, or copied disk lands here) — MUST NOT
  resume. Default behavior is refusal; on explicit operator
  (self-hosted) or supervisor (hosted) instruction, the process mints a
  fresh replication incarnation and opens a **new generation** with its
  genesis record as above, making takeover an explicit, auditable
  succession rather than a silently won CAS race. New generations are
  minted only here; resume never mints one.

On hosted targets, binding the current LLP 0072 epoch/fence into head
acquisition and every head advancement is **mandatory**, not optional —
and epoch validation is **serialized atomically with the conditional
write**: both run as one operation at the single advancing authority
(§5 places head advancement in supervisor custody, where 0072's fence
is enforced and the epoch is recorded in the head), so no process whose
authority was superseded between a check and a write can commit an
advancement. Which artifact carries that authority — a first-class
signed replication epoch or the existing deployment fence — is decided
by the LLP 0072 amendment this RFC requires (§5, OQ4). A writer that
loses a conditional advance halts replication and raises. A stale or
partitioned writer can therefore append only under its own generation
prefix — it can never overwrite another lineage or advance the head —
and its output is excluded at read time: **every restore and every
checkpoint proof binds the explicit generation lineage resolved through
the head — including its recorded succession chain — and refuses on
ambiguity** (multiple live heads, divergent lineage, a lineage whose
succession record conflicts with observed prefixes) rather than
silently selecting one. This is deliberately fencing, not placement:
ownership authority stays with the operator (self-hosted) or the
control plane (hosted); the bucket protocol only makes stale writers
harmless.

### 5. Confidentiality and custody

The stream is a continuous copy of the entire database, auth catalog
included (§2). LLP 0072's backup posture — encrypted components, keys
held outside the protected deployment, an explicit statement of who can
decrypt and restore — applies to it. Two rules, one unconditional:

- **Keyring snapshots are client-side encrypted on every lane, without
  exception.** The prefix otherwise co-locates the keyring's HMAC keys
  with the `_auth_verification_codes` keyed digests carried in
  segments, so a single bucket-credential compromise would enable
  offline recovery of live low-entropy codes — defeating LLP 0057's
  boundary 2 outright. No "recorded weaker posture" is available for
  key material. (This resolves former OQ2; as a security-posture rule
  it is subject to author ratification at acceptance.)
- **Segments** are client-side encrypted before upload with keys
  custodied per LLP 0072 on hosted targets; the self-hosted lane may
  accept provider-side bucket encryption for segments only, recorded as
  the weaker posture in the instance's replication config. Shipping
  plaintext segments (the celld default) is a recorded divergence,
  never a silent one.

Credential custody, hosted lane: LLP 0111 routes backup bytes through
the supervisor and gives the application machine no provider credential
so that backup custody survives application compromise. A continuous
replicator inside the server process needs *some* write path; the rule
proposed here is a **role split with enforced immutability**:

- The application-side replicator holds an **append-only, prefix-scoped
  credential**, never exposed through the application secret API, and
  valid only where the store **enforces immutability of written objects
  against that credential** (overwrite and delete denied by bucket
  policy or object lock — qualified per store in G2/G3 alongside the
  CAS primitive). Without enforcement, a compromised server could
  re-PUT earlier segments with internally consistent checksums and
  retroactively falsify the disaster-recovery history — the property
  the supervisor-mediated path existed to protect. Where a store cannot
  enforce this, the lane falls back to 0111's supervisor-mediated byte
  path.
- The **supervisor owns the head, the proofs, and the lifecycle**: head
  advancement (where §4's atomic LLP 0072 epoch check runs), read-back
  verification, checkpoint-proof assembly, and **compaction/retention
  deletion** — the only operations needing the overwrite/delete rights
  the immutability policy denies the application credential — execute
  in supervisor custody, not on the application machine. The head
  object itself is the one deliberate exemption from prefix
  immutability: it stays CAS-overwritable while generation prefixes,
  genesis records, and coverage records are immutable.

**Acceptance dependency:** this role split diverges from LLP 0111's
supervisor-mediated byte path, so dated LLP 0072 and LLP 0111
amendments admitting it (and choosing §4/OQ4's epoch representation)
are prerequisites of accepting this RFC, exactly as the LLP 0057
amendment is in §6. Until they land, the hosted lane's only admissible
shape is 0111's existing supervisor-mediated path. Self-hosted: the
operator configures the bucket and credential directly and both roles
run in the operator's single custody domain (a separate
lifecycle-scoped credential for deletion where the store supports it),
with store-enforced immutability still required or its absence recorded
as a weaker posture (OQ5).

### 6. Restore composes with LLP 0057's declared restore

`snapback replicate restore` materializes a database from the bucket at
a chosen retained position on an explicit lineage (§4) and verifies
integrity (`PRAGMA integrity_check` plus LTX checksum continuity). Its
output is **non-servable until declared-restore composition runs**: the
LLP 0057 declared restore obligations (bulk session revocation,
challenge purge, the `--restored-from-backup` declaration) and, on
hosted targets, LLP 0072's restore-incarnation/identity translation.
Continuous replication must not become a second restore surface that
resurrects backed-up sessions — the residual LLP 0057 pins for its own
quiesced path.

Keyring pairing: the restored position's auth rows may reference
`key_id`s; the restore selects the keyring snapshot governing that
position (§2's frontier invariant gives every restorable position one)
and otherwise **fails closed**, exactly as LLP 0057's restore does on a
missing `key_id`.

This composition must be squared with LLP 0057's boundary 4, which as
written admits only one capture discipline — database and keyring bytes
under a single quiescence boundary — and explicitly rejects raw copies
taken while the server runs. The claim here is consistency-equivalence,
not exemption: an LTX restore materializes a transactionally exact
commit boundary (unlike a fuzzy file copy), and §2's ordering invariant
guarantees the governing keyring is at least as fresh as any key a
restorable position's rows can reference, with the `key_id` check
failing closed on any gap. Accepting this RFC therefore **requires a
dated LLP 0057 amendment** recognizing "retained LTX boundary within
the restorable frontier + governing keyring snapshot" as a second
admissible physical-capture discipline; until that amendment lands,
`snapback replicate restore` output is not presented as satisfying LLP
0057's backup/restore contract, declared-restore composition
notwithstanding. Restore and fork outputs also never inherit the
source's replication identity (§4 sidecar rule). Fork (LLP 0158) may
later source its snapshot from a retained LTX position instead of the
live SQLite backup API, but that is expressly a follow-on, not part of
this proposal.

### 7. Honesty and qualification

Per the claims-gated-on-acceptance rule this corpus applies to hosted
capabilities (the LLP 0074/0109/0113-family posture, as LLP 0099 applies
it to itself), no capability manifest claims replication until an
acceptance corpus passes; a real replication capability id additionally
enters LLP 0134's registry experimental-first with a
`MaturityIntroductionRecordV1`. Sketch of the gates:

- **G1 (provenance + format conformance):** §1's license/notice and
  test-vector provenance verification at the pinned commit; upstream
  vectors + differential test green in our CI on macOS and Linux, with
  the reference Litestream binary **required present** — upstream's
  `differential_xtool` self-skips without it, and a skipped leg is a
  G1 failure, not a pass.
- **G2 (local drill):** replicate a live instance under sustained write
  load to MinIO; kill the server mid-write; restore on a clean machine
  through the §6 composition; verify integrity, lineage binding, and
  bounded loss ≤ observed frontier lag at kill time.
- **G2f (fencing matrix, local):** demonstrate each §4 case: verified
  ahead-of-head resume after unclean restart (no succession minted);
  crash in each window between segment ship, sidecar update, and head
  advance; competing writers with CAS loss → halt; rewound copy and
  foreign-sidecar copy → refusal; explicit succession → traversable
  genesis chain; multi-succession restore with correct lineage
  selection and refusal on manufactured ambiguity; store-enforced
  immutability probes (overwrite/delete denied to the append
  credential).
- **G3 (hosted binding):** the LLP 0099 executor consumes a §3
  checkpoint proof as its pre-apply streaming backup in a real drill —
  isolated restore, exact-boundary equality, pinning per §3's
  referencing-artifact lifetime — against the LLP 0111 separately
  permissioned bucket under §5 custody, plus the hosted fencing cases:
  stale-epoch advancement refused atomically, supervisor-custody head
  advancement and lifecycle deletion exercised.

## What this RFC deliberately does not take from celld

Lease-by-CAS placement, the bucket-as-control-plane coordination model,
the V8 runtime, and RPO=0-by-default all stay out. They are recorded as
prior art in LLP 0083's celld section (which cross-references this RFC),
and some may be argued for later — but each is a separate decision with
its own blast radius, and bundling them here would put a working
durability lane behind an architecture debate.

## Open questions

1. **Vendor vs. dependency.** If Deno publishes the `ltx` crate on
   crates.io with semver discipline, prefer the dependency and keep only
   the conformance suite vendored; §1's provenance verification applies
   either way.
2. **Auth exposure disposition — resolved in §5** (r4): keyring
   snapshots are client-side encrypted on every lane, unconditionally;
   segments may fall back to provider-side encryption on self-hosted
   only, as a recorded weaker posture. Retained here for the record;
   the rule is ratified with the document.
3. **Retention and compaction policy for unpinned positions.** Pick a
   default retention window (and its S3 cost story) and decide whether
   point-in-time restore is a v1 user-facing feature or an internal
   drill capability. (Pinned checkpoint boundaries are governed by §3,
   not this question.)
4. **Epoch representation.** §4 decides that hosted head advancement
   mandatorily carries LLP 0072's epoch/fence, validated atomically
   with the conditional write; what remains open is representation —
   whether 0072 mints a first-class signed replication epoch (mirroring
   LLP 0099's barrier-lease epochs) or the existing deployment fence is
   bound as-is. Owned by the dated LLP 0072 amendment §5 names as an
   acceptance dependency.
5. **Local operator surface.** What does the self-hosted operator
   configure — bucket URL + credentials in instance config — and does
   `snapback doctor`-style diagnosis gain replication-lag and
   lineage-ambiguity checks?
6. **Upstream tracking cadence.** celld is weeks old and "still
   evolving"; decide who re-pins the vendored crate and how upstream
   format changes (superfly/ltx version bumps) are absorbed.
