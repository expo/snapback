# Pre-test 1: resolution rules, fixed before comparison totals

2026-09-25. Governing instrument: frozen LLP 4001 §3 and §7 at
`da443e4d44`. These rulings were written after reading both ambiguity lists
and idiom arguments, before reading the blind rate table or computing joined
totals. The commission and author's draft already disclosed the builder's
rates and expected stop; this recorder was **not** blind to those. The two
original classifications remain untouched. The README records numerical
effects and distinguishes original family results from resolution overlays.

## Counting and scope

- **A-PARSER, A-TEMPLATE:** accept both Postgres parser versions: the freeze
  names no parser binary. Hash original bytes; template expansion is parse
  preparation, not classification. Compare statements after normalizing only
  the common prefix, identifiers' index base, and parser representation.
- **A-CHILDREN / blind parser choice:** explicit ColumnDef and Constraint AST
  nodes, including NULL, NOT NULL and DEFAULT, are separate under §7. Preserve
  the blind family's bundled-column denominator as a reported sensitivity;
  align its column to the builder column plus those attached attributes.
  Never put children in the top-level denominator.
- **A-SYNTHETIC:** the literal frozen-AST census includes parser-inserted RETURN
  nodes; show authored-only sensitivity too. No classification disagreement
  is assigned to a node absent from the other inventory.
- **A-DO, A-SQL-BODY / blind parser choice:** report routine PL/pgSQL as the
  narrow body denominator and SQL/DO as separate components, plus the combined
  denominator. Neither omitted SQL nor DO work disappears from the record.
  Signatures and block/declaration wrappers never enter body rates. An ELSIF
  condition belongs to its IF; it is not another executable statement.
- Ignored boilerplate is included in the headline denominator, with the
  non-ignored denominator beside it; §7 leaves this unspecified.

## Builder ambiguity readings

The complete affected-id index is [builder/ambiguities.md](builder/ambiguities.md).
Except for inventory reconciliation above, retain the builder's chosen readings:

| Reading | Resolution under the finite §3/§7 instrument |
| --- | --- |
| A-TYPES | §3.1 does not alias integer/int4 to bigint or stored varchar to bounded text; refuse these stored, argument and return spellings. Argument varchar typmods remain the explicit §3.5 exception. |
| A-KEYS | Only intrinsic-id PRIMARY KEY is registered. Do not invent natural/composite PRIMARY KEY → UNIQUE. Preserve the source's total-key facts when examining a probe. |
| A-CHECKS | Keep only the registered constraints/aliases; char_length, regex and arbitrary numeric/cross-column checks are not silently rewritten. |
| A-UUID | Judge the identity path and preserve values/authority; a foreign key or cascade remains a separate refusal. A refused surrounding program does not make an individually admitted probe fail. |
| A-UUID-SCOPE | Actual UUID casts, serialized ordering and pair-key construction on the identity path bar conversion. Mere unrelated UUID generation elsewhere in a family does not bar every identity conversion. |
| A-PROBE-CLASS | Exact helper inlining is rewritten work under §7, despite §3.3 admitting the probe grammar. Recognized probe bodies/calls are not raw refusals; UUID signature conversion is. |
| A-REWRITE-SET | §3.7's explicit null-safe equality rewrite is available when it preserves behavior; do not introduce a two-null match. |
| A-NULL, A-NULL-OR | Require explicit non-null narrowing for nullable comparisons/booleans, including under NOT. An `x is null OR x > now()` disjunction is not that narrowing. |
| A-BODY-CONTEXT | Classify owned expressions with their actual types, authority and read scope. A failed signature does not taint every primitive; proven local narrowing can matter, but no invented global proof admits a nullable comparison. |
| A-IN-LIST | Required constant-list membership is permitted by §3.7's IN rule, not an invented alias. |
| A-CONFLICT | Targeted DO NOTHING is not interchangeable with targetless DO NOTHING. |
| A-MULTI-VALUES | No registered expansion of multi-row VALUES into point inserts. |
| A-EXTENSION | pgcrypto has no manifested crypto product use in these files; treat it as UUID dependency boilerplate under §7. Do not speculate about unmanifested callers. |
| A-SEARCH | Only redundant nonunique performance indexes may be removed. Preserve uniqueness, full-text behavior and named merge dependencies. |
| A-EXPIRY | A SELECT predicate alone does not prove expire_at preserves the source's other visibility/write behavior. |
| A-NESTED-PROBE | No chained-probe residual outside the finite §3.3 equality/null-test grammar. |
| A-BASELINE | Freeze the verified form table at da443e4d44; its shared-baseline additions are present. The source global sequence still fails the registered per-parent rewrite. |
| A-COUNTER-SCOPE | Accept the manifested Astra insert/delete writers after initialization, as requested. No retarget writer is present there; do not extend this local idiom answer to arbitrary SQL-owner writes, overflow or a passing whole application. Muse's explicit policy-authorized retargeting is inside scope and fails. |
| A-WINDOW | Preserve runtime configuration, strict OLD/NEW boundaries, purge bypass and every direct/privileged writer; fixed defaults or invented RPC-only authority fail. |
| A-FEED | Preserve mapped-column updates, arbitrary viewer/limit inputs, duplicate cards, ranking, continuation and current-state behavior; a similar first page is insufficient. |

## Blind ambiguity list, in its recorded order

Numbers below are stable labels B01–B25 for the 25 bullets in
[blind/summary.md](blind/summary.md#ambiguities), not its overlapping affected-unit
counts. A top-level unit can repeat a child's ambiguity; do not add them twice.

| Reading | Resolution |
| --- | --- |
| B01 PRIMARY KEY as uniqueness | Use A-KEYS: refuse unregistered natural/composite key spelling; raw refusal too. |
| B02 UUID operations at family scope | Use A-UUID/A-UUID-SCOPE: trace the relevant identity path, not the mere presence of a UUID function elsewhere. |
| B03 integer/int4 columns | Retain refusal, A-TYPES. |
| B04 text/uuid no-action REFERENCES | Retain refusal: no unregistered type conversion or loss of FK behavior. |
| B05 integer arguments | Retain refusal, A-TYPES. |
| B06 nullable parameters/locals after earlier IF | Use A-NULL/A-BODY-CONTEXT: a demonstrated explicit narrowing is allowed; an earlier unrelated IF is not proof. |
| B07 nullable UNIQUE | Retain the registered §3.2 UNIQUE classification; do not create a sixth class for a documented semantic difference. |
| B08 enum CHECK IN | Retain canonicalization under §3.7. |
| B09 creation IF NOT EXISTS | Retain canonicalized floor on an otherwise admitted parent, under §7. |
| B10 mutable policy old/next composition | Retain §3.3 composition; absence of immutable means no single-image alias. |
| B11 UNIQUE index → constraint | Retain refusal: §7 does not register this conversion. |
| B12 varchar columns | Retain refusal; the argument exception does not extend to columns. |
| B13 integer return | Retain refusal, A-TYPES. |
| B14 named probe despite refused principal column | Admit the online-only probe behavior; account for exact inlining as rewritten work, A-PROBE-CLASS. |
| B15 ambiguous `||` | Resolve from operand types, as §3 requires: only the registered list concatenation is admitted; text concatenation is not. An AST alone need not carry the catalog's types. |
| B16 probe plus mutable update policy | Apply B14 and B10 together; neither cancels the other. |
| B17 ALTER DROP CONSTRAINT IF EXISTS | Retain final-catalog classification, not ignored DROP boilerplate. |
| B18 char_length | Retain refusal: no listed length alias. |
| B19 inclusive integer FOR | Retain admission of the registered inclusive endpoints, subject to operand validity. |
| B20 conflict target removal | Retain refusal, A-CONFLICT. |
| B21 non-point FOR SELECT | Admit only when the planned read's bounds/audience and expressions satisfy §3.5–§3.6; no unrestricted scan exemption. |
| B22 CREATE OR REPLACE signature | Retain creation canonicalization when the routine kind fits. |
| B23 FOR ALL | Retain admitted multi-effect composition; no implicit immutability. |
| B24 sequence IF NOT EXISTS | Retain refusal of the underlying sequence; an alias cannot rescue it. |
| B25 pgcrypto | Use A-EXTENSION: ignored dependency boilerplate, not a raw/post refusal. |

The blind prose's Astra counter caveat is resolved by A-COUNTER-SCOPE.
For Muse, its `greatest(count-1,0)` argument is insufficient by itself on an
always-consistent count. The builder supplies the decisive reachable witness:
authorized retargeting leaves source counters stale, whereas a maintained count
moves the contribution. Both families' no-spelling answer therefore stands.

These rulings do not manufacture a new classifier consensus. Remaining
unit-level disagreements are published with both rationales. Only identified
ambiguity changes are overlaid, and parent classes are recomputed where those
children change. No input classifier ledger is edited.
