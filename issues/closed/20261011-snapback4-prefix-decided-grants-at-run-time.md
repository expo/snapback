# Snapback 4: a pin-decided parent probe as a page guard at run time

**Opened:** 2026-10-11 (wave 6 app farm #1c, 5 lanes, 4 named it first; LLP 3000.036 §13.1, §14.1, §16.3)
**Closed:** 2026-10-12 (branch `sb4-ws-ln`; LLP 3000.036 §16.3 "Implemented")

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

## Resolution (2026-10-12)

Landed as the ticket describes, with the Lean model in the same change:

- **Server.** `rules::page_guard_decision` (core `engine/rules.rs`) returns
  the readable grants plus every disjunct whose row columns the scan's
  prefix pins and whose probed rows its holders can read
  (`pinned_probe_readable`); the walk (`read.rs`, `grant_verdict`) evaluates
  them once with the prefix's values. The board owner's `cards where .board
  = b` and the leader's roster answer `complete: true`; a search `exists`
  over such a scan answers `false` for them. A parent its holders cannot
  read still decides nothing.
- **Devices.** Unchanged (a union read rule cannot sync); the parity test
  `snapback4-device/tests/readauth/parent_guards.rs` runs both stores (they
  answer unknown and defer to the server) and checks that rows hidden from a
  caller never change their server answer.
- **`check`.** `grant_dominated` follows `if`/`require` of the pinned probe
  when the pinned value is a literal, `viewer` or an argument never rebound;
  `N_NEVER_COMPLETE` names the disjunct among the callers it admits, the
  copy-the-principal recipe is gone, and §16.1's form says every page is
  complete. Mutation admission shares `grant_dominated`.
- **Lean.** C8 refined soundly: `granted` admits a positive disjunct whose
  row columns are all pinned, evaluated with the pinned values over the
  caller's view (`Rule.pin`); `Rule.eval_pin`, `granted_readable` and
  `decided_store` prove a page decided so omits no row its pins select, and
  `query_noninterference` still holds. The emitter's `read-grant` exclusion
  is gone. `./check.sh`: 46 theorems, 42 examples; `run-lean` 100,000 cases
  with only the classified C2/W4 signatures (`lean/OPEN.md` C8).
