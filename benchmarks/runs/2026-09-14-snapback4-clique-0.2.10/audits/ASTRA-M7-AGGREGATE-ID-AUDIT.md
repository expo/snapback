# Maintained aggregate identity blocks schema adoption — 2026-09-15 UTC

**Confirmed on the unmodified published 0.2.10 binary:** valid bounded text fields can produce an engine-maintained identity that is accepted during a mutation and readable under the existing schema, but rejected when an unrelated index is added. The exact boundary is the generated identity's **canonical tagged UTF-8 size**, including JSON re-escaping: **144 bytes succeeds; 145 and 159 bytes refuse store opening with `E_INPUT`**. Restoring the prior schema returns the same source rows in all three isolated cases.

This is an **orchestrator evidence audit**, not a blind review, benchmark grade, author ruling, or product fix. It read only the four named live M7 evidence/schema files, relevant repository source/guide, and its own isolated reproduction artifacts. It did not steer the builder, alter a lane/source file, touch lane processes/stores, open server ports, or inspect credentials. Current-main runtime applicability is **unverified**; static applicability is described below. Parent owns ticket disposition and any later fix.

**Received lane evidence.** Under `/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/m7/`:

| File | Observation / SHA-256 |
| --- | --- |
| `evidence/migration-correction.log` | `counts.backfill` fails before execution while opening the store: `E_INPUT: identity exceeds 144 canonical tagged UTF-8 bytes`; exit 2. SHA `538b3d86bf503a9d350f4978e70500de1d578c1c44fdcdac29e7bd3366443c37`. |
| `evidence/aggregate-id-repro.json` | Three received command receipts: `add` succeeds, a later `all` refuses store opening, subsequent `all` succeeds. These receipts alone do not record the intermediate schema edits. SHA `476cc3dc6ac87f227d530688a980dc752d00578b6d4a36671c917aebce9dbb9f`. |
| `aggregate-id-repro/snapback/schema.q` | Minimal public `votes`, three bounded text keys, grouped count maintain, add/all operations. SHA `51020191f00a0a234068a4a6213f0478cf2738621e4c4f5a23140e07c5c53845`. |
| `evidence/poll-tally-ids.json` | Received SQL output has three generated IDs, raw UTF-8 lengths 129/82/82. Wrapping each as canonical `{"Id":…}` gives **150/103/103** bytes. Thus the 129-byte raw ID exceeds the 144-byte *tagged* bound; raw SQL length does not refute the refusal. SHA `b906e32c97e839004e9492e4f33deaee91284f337311bbfb52557856507ce005`. No lane store was opened by this audit. |

**Independent published-pin reproduction.** The executable was the existing Astra-installed `node_modules/snapback4-darwin-arm64/snapback4`, **7,728,288 bytes**, SHA `af4e26be10419df9428bf6be0c7513de07d227e33f77cdb464c4d93dc2a0767d`, matching the previously recorded published binary. No resigning or package install was performed. Three new directories/stores were created under:

`/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/astra-m7-maintained-id-audit-8tbmrtwr/`

Each case ran `check`, `run add … --as alice --json`, and `run all {} --as alice --json`; then added only `by byOption: optionKey, id` to `votes`, re-ran `all`, restored the original schema bytes and re-ran `all`. Each invocation is a fresh CLI process against that case's own store. No server was started.

| conversationKey length; other keys 36 each | Raw generated group-ID bytes | Canonical `Id` bytes | Check / insert / unchanged read | Added-index read | Restored read; source rows equal |
| --- | ---: | ---: | --- | --- | --- |
| 8 | 123 | **144** | 0 / 0 / 0 | **0** | 0; yes |
| 9 | 124 | **145** | 0 / 0 / 0 | **2, E_INPUT** | 0; yes |
| 23 | 138 | **159** | 0 / 0 / 0 | **2, E_INPUT** | 0; yes |

The long-key cases fail with empty stdout and exactly:

```text
cannot open the store: E_INPUT: identity exceeds 144 canonical tagged UTF-8 bytes
```

Full argv, cwd, exit code, stdout, stderr, wall duration, both schema strings, calculated sizes and source-row equality checks are retained in [ASTRA-M7-AGGREGATE-ID-AUDIT.repro.json](./ASTRA-M7-AGGREGATE-ID-AUDIT.repro.json), SHA **`2d5aa1eb240069523f77c13d3573b3b25a65cfc0a5679122dfbfa14ddf9ad561`**. These are synthetic data and public persona operations, without credentials. The temporary directories remain available; they were not copied into the packet or recording repository.

**Minimal schema for a ticket.** This is the exact baseline schema used:

```quarry
use personas alice

table votes:
  conversationKey: text 1..50
  messageKey: text 1..50
  optionKey: text 1..50
  public
  insert <- allow
  sync public

maintain tallies: count votes by conversationKey, messageKey, optionKey
  read <- allow

mutation add(conversationKey: text 1..50, messageKey: text 1..50, optionKey: text 1..50):
  insert votes { conversationKey, messageKey, optionKey }

query all():
  return votes first 10 by byId
```

For the first failing case, the exact operation argument is:

```json
{"conversationKey":"ccccccccc","messageKey":"mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm","optionKey":"oooooooooooooooooooooooooooooooooooo"}
```

In a fresh external directory containing that `snapback/schema.q`, invoke the exact binary as `check`; then `run add '<JSON above>' --as alice --json`; then `run all '{}' --as alice --json`. All succeed. Add the following line under `votes` (the candidate in the retained JSON puts it immediately after `sync public`):

```quarry
  by byOption: optionKey, id
```

The next `run all '{}' --as alice --json` refuses opening. Restore the original schema and the same read succeeds. Using eight `c` characters instead of nine is the immediately adjacent passing control. Full executable paths and exact expanded commands are in the JSON, so no hidden helper or shell substitution is required to reconstruct the sequence.

**Source explanation and likely current-main applicability.** The parent reports `origin/main` at `d0ea08192`. This audit read the current recording checkout files below and hashed them; it did not build or execute that revision, or certify those working files against its Git object. The observed mechanism remains present in these checked sources:

- [schema.rs:1138](/Users/ccheever/projects/snapback-relaxed-record/snapback4/crates/snapback4-core/src/schema.rs:1138): `maintained_id` is the canonical serialized group vector. The comment explicitly calls it conformance-sensitive inherited spelling and says programs read aggregates by group, not ID. File SHA `4d294b7a2a02b5695513addea5d191d3b8f516eb3ed2f8484f2dda1d5bcc80a5`.
- [engine/write.rs:571](/Users/ccheever/projects/snapback-relaxed-record/snapback4/crates/snapback4-core/src/engine/write.rs:571): `apply_aggregate` wraps that serialized vector in `Value::Id`, constructs the maintained row, then calls `tx.put`; it does not run the ordinary identity validator there. File SHA `f4039e1d5cafa49256bcffe0fcaf2dba802a05bf523d124dff0e4896ecd97dfe`.
- [value.rs:347](/Users/ccheever/projects/snapback-relaxed-record/snapback4/crates/snapback4-core/src/value.rs:347): `identity_fits` counts nine tag bytes plus escaped UTF-8 content and requires ≤144; `validate_identities` rejects larger `Value::Id` values. File SHA `bde1e18617afec6521237ae4668e363989a793447394665ddd696c893f1ce552`.
- [engine/validate.rs:33](/Users/ccheever/projects/snapback-relaxed-record/snapback4/crates/snapback4-core/src/engine/validate.rs:33): every supplied column first passes `validate_identities`, including the generated maintained `id`.
- [store/activation.rs:88](/Users/ccheever/projects/snapback-relaxed-record/snapback4/crates/snapback4-core/src/store/activation.rs:88) skips maintained-row validation before rebuilding, but the later [post-build loop at line 100](/Users/ccheever/projects/snapback-relaxed-record/snapback4/crates/snapback4-core/src/store/activation.rs:100) validates **all** rows when the schema changes. Thus a harmless index addition encounters the oversized internal identity after the maintained rows are rebuilt. File SHA `ef566f44d1274665fc3fef49611d5a18a853e5c91480796855dd416ba5c04b80`.

For the reproduction's three string keys, JSON group spelling contains twelve quote characters that are escaped again when represented as an `Id`; its outer tag adds nine bytes. Hence raw 123 becomes 144, and raw 124 becomes 145. The observed threshold agrees exactly with the checked validator. The current source therefore supports **likely continuing applicability**, not a current-main runtime confirmation.

**Engineering versus author boundary.** The app supplies legal `text 1..50` values, never an oversized ID. The engine creates the internal maintained ID, accepts it on ordinary mutation, then rejects it on additive schema activation. This is a concrete consistency/adoption defect; it is not evidence that the application violated an explicit ID input limit or that a client subscription caused the refusal. The row remains readable after restoring old source, so these tests do not show data loss. Recovery is narrowly demonstrated for these synthetic schemas, not a general production migration or byte-identical rollback guarantee.

An engineering fix needs to reconcile internal maintained identities with validation consistently. The conformance-sensitive canonical spelling, store/partition/cursor uses and public identity budget constrain any remedy; this audit neither raises the budget nor chooses a replacement encoding, validation exemption or migration policy. It does not commission SQL, change accepted contracts, or credit later fixes to 0.2.10. The parent already searched for duplicates and plans the P2 adoption-refusal ticket; this audit adds the independent 144/145/159 controls, not a second ticket or a product patch.
