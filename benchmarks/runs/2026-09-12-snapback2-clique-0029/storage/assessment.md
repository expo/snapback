# Clique 0.0.29 storage attribution

The 5,196,644,352-byte canonical scale database (4.840 GiB) is dominated by the current generic index representation. This is a concrete implementation cost worth investigating. The evidence does not determine a safely removable percentage or establish that Clique inherently requires this footprint.

Source is frozen at `f2c569a5e50f8add3c7fc0680cc0ec093fba7a23`. The retained [audit](storage-breakdown.json) completed at 09:27:39 UTC after the initial builder exited; its source stat was unchanged. The schema comes from the immutable 09:25 final builder snapshot. Exact hashes and source coordinates are in [assessment.json](assessment.json) and [source-manifest.json](source-manifest.json). This task read those retained files and Git objects only.

| Measured structures | Allocated bytes | File share |
|---|---:|---:|
| Generic index entries and their SQLite indexes | 3,638,677,504 | 70.020% |
| Application rows and primary index | 806,375,424 | 15.517% |
| Search postings and their indexes | 687,235,072 | 13.225% |
| Commit log | 37,990,400 | 0.731% |

The entire file has only 8,192 freelist bytes. `dbstat` reports 577,937,297 unused bytes **inside allocated pages**; this is distinct from free pages and is not a measured vacuum saving. The small search dictionary, auth metadata and empty outbox/job structures do not explain the dominant allocation. This audit covers one SQLite file, excluding WAL, media and other replay copies.

## What the frozen source establishes

**Ordinary indexes multiply both entries and representation.** Each plain schema index stores one `index_entries` row per application row. The same entry is represented in four B-trees: the base rowid table, primary-key autoindex, ordered covering lookup, and row-cleanup index. The lookup repeats all eight key slots and addresses; the cleanup index supports replacement/deletion across all named indexes. Collectively these allocate 2.787 times the base index-entry table's size. These are copies of index keys/addresses, not four copies of the full application row body. See [store.rs:170](source/snapback2/crates/snapback2-core/src/store.rs#L170) and [index.rs:106](source/snapback2/crates/snapback2-core/src/engine/index.rs#L106).

**Key encoding expands text and IDs.** A string or ID with N UTF-8 bytes becomes a `3:` or `4:` tag plus hexadecimal bytes: 2N+2 ASCII bytes. Integers use 22 ASCII bytes. Unused key slots are SQL NULL. A generated 64-character delivery ID becomes a 130-character byId key in addition to its raw row address. Rows themselves are typed JSON with field names/value tags. See [index.rs:724](source/snapback2/crates/snapback2-core/src/engine/index.rs#L724), [delivery.rs:376](source/snapback2/crates/snapback2-core/src/delivery.rs#L376), and [value.rs:318](source/snapback2/crates/snapback2-core/src/value.rs#L318).

**Search has a distinct multiplier.** Each derived index inserts one posting per distinct nonempty normalized word prefix per row; a set deduplicates repeated prefix nodes. Each posting occupies three B-trees. The base `WITHOUT ROWID` table and ordered lookup each have exactly 258,630,418 measured payload bytes; the reverse lookup adds 71,736,926. The shared prefix dictionary is below 1 MB allocated. See [search_index.rs:29](source/snapback2/crates/snapback2-core/src/engine/search_index.rs#L29) and [its insertion loop:119](source/snapback2/crates/snapback2-core/src/engine/search_index.rs#L119). Actual per-message prefix cardinality is absent from the audit.

**The final schema creates substantial legitimate index populations.** Static inspection finds 19 authored table kinds, 14 Count targets and two generated delivery table kinds. They share generic SQLite storage. Including implicit byId, there are 83 plain index declarations: 49 authored-table indexes, 28 Count-target indexes and six delivery indexes, plus three word-prefix indexes. Each row gets its own table's indexes; 83 is not a per-row multiplier. Count target rows correspond to groups. The full [inventory](schema-index-inventory.json) retains names and declaration lines; [catalog.ts:30](source/snapback2/packages/compiler/src/quarry/catalog.ts#L30), [index.ts:131](source/snapback2/packages/compiler/src/quarry/index.ts#L131), and [deliver.ts:105](source/snapback2/packages/compiler/src/quarry/deliver.ts#L105) establish generated behavior.

For a newly delivered message with R recipients, the generated log and initial receipts create 6R logical plain-index entries (four plus two per recipient), hence 24R generic B-tree records before source-message indexes/search/maintains. At the declared cap of 50, that conditional example reaches 300 entries / 1,200 records. Delivery rows contain metadata rather than the full message body. This explains a possible multiplier, **not its measured share or average R**. See [custody.rs:236](source/snapback2/crates/snapback2-core/src/engine/custody.rs#L236) and [acknowledgements.rs:51](source/snapback2/crates/snapback2-core/src/engine/acknowledgements.rs#L51).

The app also declares identical key columns under separate unique/nonunique names for [follows:120](scale-schema.q#L120) and [reactions:227](scale-schema.q#L227). Both are stored. Their declaration semantics differ, and this task did not audit all call sites for safe consolidation. Unchanged derived keys already avoid retokenization; unchanged ordinary keys avoid reindexing ([index.rs:58](source/snapback2/crates/snapback2-core/src/engine/index.rs#L58)).

## Disposition

The structural cost is source-confirmed and potentially fixable at the representation level. Specific savings remain unmeasured. The current four access structures have real uniqueness, ordered-read and cleanup purposes; deleting one casually could trade disk space for slow or incorrect behavior. Compact key representation and sharing equivalent authored indexes are candidates for later investigation, with ordering, uniqueness, deletion, rebuild, search, authority and custody preserved.

The smallest useful next evidence is application-table/index cardinalities and key-length distributions from a separately retained copy after grading. Those would rank delivery, authored data, maintained groups and duplicate declarations before any implementation experiment. No database access, benchmark traffic, owner launch, repository edit or actor/grader feedback occurred in this task; no owned long-lived process remains.
