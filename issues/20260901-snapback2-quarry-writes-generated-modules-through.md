# snapback2: Quarry writes generated modules through output symlinks

**Status:** Open
**Systems:** snapback2, quarry, security
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/quarry/src/compiler.ts:39-55 and snapback2/packages/quarry/src/compiler.ts:81-89. If the generated `snapback` directory is a symlink to an external directory, compiling a Quarry file writes modules outside the project; an individual generated target symlink can likewise redirect an overwrite when its current contents satisfy the generated-header check. Output validation relies on textual paths and file contents rather than no-follow metadata and canonical containment. Reject symlinks in every generated path component and target, verify the resolved parent remains inside the project output root, and publish via newly created no-follow temporary files plus atomic rename.
