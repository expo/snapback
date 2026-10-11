# Snapback 4: a pin-decided parent probe as a page guard at run time

**Opened:** 2026-10-11 (wave 6 app farm #1c, 5 lanes, 4 named it first; LLP 3000.036 §13.1, §14.1, §16.3)

`read <- .tester = viewer or exists sessions[.session, designer = viewer]`
under `sessions[session] … tests where .session = session`: for the
designer the second disjunct holds for every row the page reads, so the
page is fully readable to them, but the server decides a page complete only
from a disjunct that reads no row column (`rules::grant_decision`), so the
designer's roster answers `complete: false` whatever `require` or `if`
guards it. `check` now says so on every such note and prints the
copy-the-principal repair (LLP 3000.036 §16.3).

What landing it takes:

- Server: in the walk (`read.rs`, the `granted` path), evaluate the
  disjuncts whose columns the prefix pins and whose probe the caller can read
  (`rules::pinned_probe_readable`) with the prefix values; a true one
  decides the page once, as a grant does. Device: unchanged (grants are
  server-only today).
- Lean model: C8 says a non-uniform page is never complete. Add the arm
  (a disjunct whose row columns are all pinned, true for the caller, with a
  self-disclosing probe), which would also let the emitter lift today's
  `read-grant` exclusion of §12.1's grants; otherwise the emitter must name
  every pinned-witness page of `OwnerOrWitness` unsupported.
- `check`: `rules::grant_dominated` follows the same guards for these
  disjuncts; the §16.1 complete form's parent-probe arm then becomes complete.
- Owner: the lead session (LLP 3000 decision 4); coordinate with the
  workstream changing `exists … where` evaluation.
