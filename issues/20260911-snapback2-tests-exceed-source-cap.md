# Two existing Snapback2 test files exceed the source cap

**Status:** Open
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Snapback2 package tests, source-size budget
**Related:** rules/RULES.md; LLP 1018.008.007.001

The acquisition implementation's base `6e644f028` already contains two
Snapback2 test files above the unchanged 1,500-line limit:

- `snapback2/packages/snapback2/tests/auth-restoration.test.ts`: 1,517 lines.
- `snapback2/packages/snapback2/tests/twin.test.ts`: 1,525 lines.

Counts use caps' `text.split('\n').length`, including the trailing empty line.
Both files are unchanged by the acquisition implementation. Its modified source
files all remain below the cap. The complete caps run reports 206 oversized
files against a 204 baseline. Its two printed Snapback1 paths are merely the
smallest oversized files; those names do not establish which files caused the
overflow. Do not repeat that misleading attribution.

Split the existing tests by coherent topic without dropping controls, update
their real test runner where necessary, and rerun the full source census.
Do not enlarge the baseline or add generated-file exemptions. The current
acquisition run retains its failing caps result in its verification record.
