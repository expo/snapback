# LLP 0330: turbokv as a Snapback storage engine — evaluated and declined

**Type:** Research
**Status:** Active
**Systems:** Storage, Runtime, Sync, Client SDK, Deployment, Performance, Competitive analysis
**Author:** Charlie Cheever / Claude Fable 5
**Date:** 2026-08-29
**Revised:** — (single-session assessment, unreviewed; author-directed to
land outside `llp/current/` because the disposition follows from documents
already Accepted or Active rather than from new work)
**Related:** LLP 0097, LLP 0128, LLP 0158, LLP 0161, LLP 0162, LLP 0163,
LLP 0166, LLP 0188, LLP 0269, LLP 0329.014.004,
<https://github.com/kingroryg/turbokv>, `crates/snapback/src/storage.rs`,
`crates/snapback-kernel/src/branches.rs`

## Summary

The author asked whether [turbokv](https://github.com/kingroryg/turbokv), an
embedded LSM key-value store in Rust, is worth incorporating into Snapback in
any way. The answer is **no**, in each of the three positions it could
occupy: as a replacement for SQLite under the authority store, as a durable
side store beside SQLite, and as the storage engine a device-authority
partition would carry under LLP 0329.014.004 §2.2 dimension P. None of the reasons is
about turbokv's quality as a key-value store. They are that Snapback
consumes an interactive-transaction, SQL-evaluating, file-format-bound engine
(§2), that the corpus has three times declined to become a database-layer
author above raw ordered bytes (LLP 0128 family E, LLP 0161 §2, LLP 0162 §9),
that LLP 0163's one-transaction rule closes the side-store niche, and that an
embedded single-process store is a lateral move on the graduation axis LLP
0269 fixes (SQLite → Postgres → transactional cells) rather than a step along
it. §2 is written so the next embedded-engine candidate can be run through
the same table without re-deriving it.

## 1. What turbokv is

Facts observed from the repository on 2026-08-29 `[observed — README,
Cargo.toml, CHANGELOG, GitHub API]`:

- An async embedded key-value store: raw byte keys and values, lexicographic
  key order, point `get`/`insert`/`remove`, an atomic `WriteBatch` of blind
  puts and deletes, eager `range`/`scan_prefix` and streaming
  `range_iter`/`scan_prefix_iter`, `flush`, `compact`, and statistics.
  Architecture is memtable (skiplist) + WAL + SSTables with Bloom filters,
  block cache, and background compaction.
- Three durability presets: `fast()` (no WAL), `durable()` (WAL append, no
  per-write sync — the recommended default), `paranoid()` (group-commit
  `sync_all` before acknowledgement). Defaults: 64 MiB memtable, 64 MiB block
  cache, LZ4.
- Version 0.6.0 dated 2026-08-28; pre-1.0; Apache-2.0; `rust-version = 1.85`.
  Repository created 2026-01-04; one contributor; roughly 141 commits; 132
  stars; one fork; one open issue.
- Dependencies include `memmap2`, `libc`, `tokio` (`rt-multi-thread`),
  `crossbeam-skiplist`, `parking_lot`, `zstd`/`snap`/`lz4_flex`, `crc32fast`,
  `lru`, and `gxhash`. The persisted Bloom-filter format uses hardware AES,
  so x86 builds need `RUSTFLAGS="-C target-feature=+aes,+sse2"` and AArch64
  builds `+aes,+neon`. `unsafe_code` is allowed for mmap and platform FD
  calls; the Miri job was removed in 0.6.0 because Miri cannot emulate them.
- One open handle exclusively owns its directory; dropping the handle is not
  a clean shutdown. Every scan captures a point-in-time view by freezing a
  nonempty active memtable, so frequent small scans increase later flush
  work. Streaming iterators advance synchronously and pin snapshot readers
  and directory ownership. One WAL record or batch must fit a `u32` payload
  length.
- On-disk formats: WAL v5, manifest v3, SST v3 as of 0.6.0; older versions
  cannot open v5 segments. 0.6.0 also removed the prefix Bloom filter, the
  buffer pool, direct I/O, the time-partitioning/TTL interfaces, and the
  public cached-time interface.
- Absent by design: interactive (read-then-write) transactions, any
  read-validation or OCC primitive, secondary indexes, a query language,
  TTL, multi-process or multi-reader access, and a wasm target.
- Published benchmarks (Apple M4, macOS 15.3.2, self-run against fjall
  2.11.2 and redb 2.6.3): sequential fill ~3.0 M keys/s in `fast`, ~1.8 M in
  `durable`, ~213 keys/s single-key in `paranoid`, ~20.7 k keys/s in
  `paranoid` with 100-key batches `[unverified — vendor claim]`. A
  `benchmarks/published_claims.rs` test binds the README figures to retained
  JSON artifacts.

## 2. What Snapback consumes from its physical engine

The obligations below are what any candidate local engine must supply or
Snapback must rebuild above it. Each cites the document that establishes it.

| # | Obligation | Established by |
|---|------------|----------------|
| O1 | Evaluate the typed relational contract's queries — today by lowering to SQL against application-shaped tables; `crates/snapback` depends on `rusqlite` with the `backup`, `column_decltype`, `functions`, `hooks`, `limits`, and `serialize` features | LLP 0269 §0.1 (`LocalDatabase` over `rusqlite::Connection`; no backend-neutral trait yet); LLP 0128 §3 |
| O2 | One interactive transaction that reads and advances the head, validates the captured read set, writes rows and `_snapback_changes`, and commits through the authorization interlock | LLP 0269 §0.1; LLP 0161 §3 row P5 |
| O3 | Covered data changes, journal rows, commit envelope, suppression record, and initial receipt state commit in **one** transaction; jobs and schedules are transactionally enqueued | LLP 0163 §Contract summary; LLP 0070; LLP 0329.014.004 §6 `schedule` |
| O4 | Fork and branch substrate: `MaterializedBase` + COW overlay (`crates/snapback-kernel/src/branches.rs`), O(1) cold copy plus journal diff, restore-derived rehearsal — all SQLite-file operations (online backup, `serialize`) | LLP 0097; LLP 0158; LLP 0081 §7 |
| O5 | Continuous replication at the SQLite page level with connection-local persistent-WAL and no-auto-checkpoint discipline | LLP 0188 |
| O6 | Direct local inspection and brownfield access to a standard multi-reader file | LLP 0162 §9 |
| O7 | Portable semantics per target; the local engine adds no build-matrix constraint of its own | LLP 0162 §9; LLP 0161 §3 coverage caveat |
| O8 | A device-plane store that already exists on every client platform (IndexedDB / file / memory today; SQLite permitted behind LLP 0008 DK-9; no Rust on the client) | LLP 0166 D1; LLP 0329.014.004 §2.2 dimension P, §7 |
| O9 | Graduation direction: larger single-authority cell → Postgres → declared transactional cells; a *distributed* transactional KV (family E) is a later downselection candidate, an embedded one is not on the axis | LLP 0269 §0; LLP 0128 §E |
| O10 | No bespoke on-disk format: Snapback owns durability *protocols* above SQLite/OS primitives, never page storage, WAL recovery, or crash-atomicity | LLP 0161 §2 and §3 ("no gap calls for reimplementing the physical engine") |

## 3. turbokv against the obligations

| # | turbokv | Verdict |
|---|---------|---------|
| O1 | Raw ordered bytes; no query language, indexes, constraints, or typed columns. Tuple encoding, secondary indexes, uniqueness, planning, and migrations would all become Snapback's | Fails — exactly the "Snapback becomes a database layer author" cost LLP 0128 §E prices and declines |
| O2 | Only blind atomic `WriteBatch`; no read-then-write scope, so read-set validation and head advancement would be an OCC layer Snapback builds with its own locking | Fails |
| O3 | A second durable store beside SQLite cannot share SQLite's transaction; every envelope, journal, receipt, job, or timer row placed in it needs two-phase commit | Fails — closes the side-store position outright |
| O4 | Exclusive directory lock; no online backup or serialize equivalent; forks would be directory copies under the lock's rules | Fails |
| O5 | Its own WAL/SST/manifest formats (v5/v3/v3, no downgrade); LTX replication does not apply | Fails |
| O6 | Single exclusive owner; no standard tooling reads it | Fails |
| O7 | Hardware-AES `RUSTFLAGS` requirement across the build matrix; mmap/`libc`/multi-thread `tokio` rule out wasm | Fails |
| O8 | Rust-only; would need a native-module bridge on every client platform where SQLite is already resident | Fails — and reverses D-A more expensively than the SQLite reading of dimension P |
| O9 | Same locality as SQLite: one process, one directory, one writer | Lateral, not graduation |
| O10 | Adopting it means owning page-level format evolution vicariously through a pre-1.0, single-maintainer crate | Contradicts the decision |

Nothing in the table is a criticism of turbokv on its own terms. A raw-byte
LSM with atomic batches is a reasonable thing to build; it is simply two
layers below what Snapback consumes, and every layer between would be new
Snapback code that SQLite provides today with the most exercised database
codebase in existence behind it `[interpretation]`.

## 4. The three positions, individually

**Engine replacement.** Fails O1–O7 and O10 together. The performance
argument does not rescue it: LLP 0269 §0's demand gate has not fired (no hot
application has outgrown one authority; the LLP 0265 championship has not
exposed the authority ceiling), and the performance work that has landed sits
above the engine in evaluation and session keying rather than in page I/O.
turbokv's headline throughput is in `fast()` (no WAL); its `durable()` preset
is the same contract SQLite offers as WAL mode with `synchronous=NORMAL`.

**Durable side store** (job queue, timer index, outbox, projection cache).
Fails O3. Every durable side structure in the design is specified to commit
with the data change it belongs to; LLP 0163 makes that a contract, not a
convenience. A second store would reintroduce the atomicity problem the
single-database design exists to avoid. A purely *volatile* cache would not
violate O3, but Snapback's volatile state is already in-process memory, and a
persistent LSM adds compaction, format, and lock semantics to a cache that
gains nothing from surviving a restart `[interpretation]`.

**Device-plane engine under LLP 0329.014.004 §2.2 dimension P.** That RFC (§2.2 dimension P, §7 Runtime) records that a
device-authority partition "needs the interpreter and the storage engine" on
the device — a second runtime, not a second language. The economical reading
is the engine every client OS already ships (SQLite; LLP 0166 D1 keeps it
permitted behind DK-9). A Rust LSM there means a native module per platform
plus turbokv's own format lifecycle on end-user devices, where an
un-openable v5 segment after an app update is a data-loss incident rather
than an operator chore. Fails O8.

## 5. Anything worth taking

No code. Two habits are already present in this repository in stronger
form: turbokv's `published_claims.rs` (README numbers bound to retained
artifacts) is what the frozen-record drift registry and LLP 0189's
claim-digest discipline do; its three named durability presets are a
vocabulary SQLite's `synchronous` pragma already covers under LLP 0188 §3's
bounded-RPO policy. Its benchmark write-up's honesty about macOS
`F_BARRIERFSYNC` per transaction in redb is a useful reminder when reading
any embedded-engine comparison run on APFS `[observed — README benchmark
protocol]`.

## 6. Revisit triggers

Re-evaluating an embedded key-value engine — turbokv or another — is
warranted only if one of these changes, and none is proposed:

1. the author reopens LLP 0161 §2's no-bespoke-format decision;
2. LLP 0163's one-transaction rule is relaxed so that durable side
   structures may settle outside the authority transaction;
3. LLP 0128's evidence program downselects family F (log-first core with
   maintained projections) and the projection store is specified outside the
   authority transaction — the only family under which a raw ordered-byte
   store is the natural substrate `[interpretation]`;
4. a client platform arrives with no resident SQLite and a Rust toolchain as
   its native path.

Absent a trigger, the next candidate engine should be run through §2's
table; a candidate that clears O1–O3 is a database, not a key-value store,
and belongs in LLP 0269's graduation sequence rather than here.

## Confidence

**High** on §1 (directly observed from the repository on the date given,
subject to the crate's own churn) and on §3's O1–O6 verdicts (each rests on
one Accepted or Active document plus turbokv's documented API).
**Medium** on the performance claim in §4 — the demand gate's state is
documented in LLP 0269 §0, but no Snapback benchmark isolates page-I/O share
of commit latency, so "the engine is not the bottleneck" is an inference from
where the landed performance work found its wins rather than a measurement.
**Low** on §6 trigger 3, which is an interpretation of an undecided family.

## Status

Active. Unreviewed single-session research; landed outside `llp/current/` by
author direction. If the author wants the disposition visible from the
storage-scale docket, one row in LLP 0128's considered-and-excluded material
pointing here is sufficient; this document does not amend LLP 0128.
