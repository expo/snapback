# snapback2: journey import rewriting mutates ordinary source text

**Status:** Closed
**Resolution:** Replaced textual journey rewriting with syntax-targeted module-specifier edits in project.ts; added ordinary-string regression.
**Systems:** snapback2, compiler
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/compiler/src/project.ts:299-316. A journey containing a payload or assertion string such as `"snapback2/client"` has that data rewritten to a generated file URL, changing the test input even though it is not an import. The rewriter applies textual regular expressions across the full source rather than identifying module specifiers in the parsed syntax tree. Parse the module and rewrite only static import/export specifiers and supported dynamic-import string literals, leaving comments, templates, and ordinary strings byte-for-byte unchanged.
