# Charter — reconstruct two merge-clobbered files as the true parent union

**You do not commit.** Use apply_patch. Touch ONLY
scripts/check-package-test-inventory.mjs and
packages/snapback-codegen/package.json.

Background: merge commit c6a8be969 merged the media lane into integration.
A blanket --theirs pass accidentally overwrote the careful resolutions of
these two files with the media side, dropping the integration side's
additions (substrate S2/S3 + client-lifecycle lane entries).

Task: reconstruct both files as the exact union of the two parents:
- `git show c6a8be969^:scripts/check-package-test-inventory.mjs` (integration
  side: has S1/S2/S3/L entries, expectedTotal 262) and
  `git show c6a8be969^2:...` (media side: adds media-field-authoring.test.mjs,
  base 256). Union: every entry from both sides in each package list, all
  changelog comment blocks in chronological order, expectedTotal = actual
  union count (verify by running the check, expect 263 if 262+1).
- Same for packages/snapback-codegen/package.json: the test chain must
  contain every command from both parents exactly once (S2/S3 additions:
  handler-graph-parity, semantic-generation-golden, semantic-generation-
  rotation, plus L's client-lifecycle and the canonicalizer-fix regression
  test if the integration parent chain names it, plus media's
  media-field-authoring). Compare against both parents and the actual
  on-disk *.test.mjs set.

Then verify and report verbatim:
- node scripts/check-package-test-inventory.mjs → PASS with the final total
- node scripts/check-inventories.mjs → package-test PASS
- env -u FORCE_COLOR npm test --workspace @expo/snapback-codegen → PASS
Report (REPORT-unionfix.md): the reconstruction, entry-by-entry union proof
for both files, verification tails.
