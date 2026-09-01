# snapback2: schemas can certify indexes wider than storage supports

**Status:** Open
**Systems:** snapback2, core engine, schema, storage
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2-core/src/engine/index.rs:47-50

Failure scenario: define a table with a nine-column index. Generation certification/open succeeds. The first indexed insert fails at runtime with a schema error, while a scan can construct SQL ordering by ie.c8 even though index_entries physically has only c0 through c7.

Why it happens: structural schema validation checks referenced columns but no maximum width. The eight-column limit exists only during reindex_row, after the generation has been admitted; scan SQL at lines 173-191 independently trusts index.columns.len().

Suggested fix: reject empty or greater-than-eight-column indexes during compiler and core schema/generation validation, before storage is opened or queries certify. Add admission tests for widths 0, 8, and 9.
