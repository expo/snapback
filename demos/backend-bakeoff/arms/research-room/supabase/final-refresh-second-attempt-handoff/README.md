# Research Room / Supabase final refresh: safe r2 and prospective r3

This directory is additive. It does not replace or reinterpret the original
builder Stop record or the first final-refresh Stop record in
`../final-refresh-handoff/`.

- r2 validated a fail-closed CLI boundary. Its one live start exited zero, but
  the parser rejected an unknown output field. The exact target was stopped
  immediately; no scenario or performance work ran.
- Static inspection of the official CLI `v2.110.0` source identified the exact
  output contract mismatch. The narrow correction and nine-case adversarial
  suite are under `fail-closed-cli-wrapper/`.
- The coordinator approved a fresh prospective r3. It used a new external
  project and Docker namespace, disjoint ports, the corrected wrapper, and
  package versions `@supabase/supabase-js 2.111.0` / Supabase CLI `2.110.0`.
- r3 recorded all 15 scenarios. Performance used two warmups and seven
  recorded samples. Hosted deployment remains explicitly unsampled because no
  project-scoped hosted CLI token was in scope.
- The exact r3 target was stopped, all carriers and raw streams were destroyed,
  and resource, port, and credential scans passed.

No shared diary, score, calibration, or report file is edited here.
