# LLP 0275: single-source, staleness-aware verify path registration

Status: Open

Authority: Draft LLP 0275 D5; LLP 0146 D1/D2 and LLP 0189 remain authoritative
for evidence and claim honesty.

## Problem

The React starter declares expected paths as strings in
`snapback.verify.config.mjs` while `acceptance.mjs` separately invokes generated
references and reports its own checks. Converting the starter from todos to
bugs required synchronized edits to both files. A stale todo path is easy to
leave behind, while auto-registering every generated operation would create a
vacuous claim.

## Scope

- Design the smallest generated-reference-backed identity shared by expected
  profile paths and runner observations.
- Detect registered paths whose function was deleted or renamed.
- Report generated operations that have no acceptance claim without treating
  existence as evidence.
- Distinguish registered/observed, registered/unobserved, registered/stale,
  observed/unclaimed, and generated/unclaimed in the machine receipt.
- Migrate first-party starter profiles and carrier helpers.

The ticket must not make a path pass because an operation exists or because an
unbound network request happened. Expected product intent remains authored;
observation remains identity-bound evidence.

## Acceptance

- One typed/generated operation identity is the join key from declaration
  through observation and receipt.
- Renaming `listTodos` to `listBugs` makes the old path stale with a typed
  remediation and shows the new operation as unclaimed.
- A claimed but unexecuted path fails coverage exactly as today.
- An executed but unclaimed operation is visible and contributes no passing
  claim.
- Zero-profile verification retains `passed-without-acceptance`.
- Existing verify configs have a compatibility path with no silent claim
  widening.
- React, CRUD, media, and Expo starter proof fixtures cover the migration.
