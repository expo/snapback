# Research Room / Supabase 2.111.0 refresh diary draft

**Date:** 2026-07-29

**Outcome:** stopped before scenarios for a builder secret exposure

The provider upgrade itself began cleanly. A fresh external project installed
`@supabase/supabase-js@2.111.0` and CLI 2.110.0. The official local Docker
stack started under a unique project identity; all twelve project containers
ran and the core services were healthy.

The attempt then repeated the most serious lesson from the original arm. The
CLI start receipt contained generated local credentials in an ANSI table. An
attempted redactor covered environment assignments and JWTs but not table
cells, so credential values were emitted into tool output. This was a builder
evidence-handling failure, not a Supabase product disclosure, but LLP 0102
correctly treats any secret exposure as Stop-class. No acceptance scenario or
performance sample ran.

Containment was exact: the project stopped without backup; its containers,
volumes, network, credential files, and assigned ports are absent. That does
not retract already-emitted tool output, so the handoff remains stopped and
makes no refreshed acceptance claim.

What felt good:

- The 2.111.0 client installed without application-source changes.
- A unique project and port set produced a healthy full local stack.
- Target-specific stop with no backup removed all Docker resources cleanly.

What was bad:

- The CLI's ordinary start output remains secret-bearing and visually
  formatted, which is hazardous for automated agent transcripts.
- Redacting provider output after capture is brittle; the safe design is to
  suppress credential rendering entirely or consume a typed secret channel
  whose values never reach logs or tool output.
- Repeating the same builder incident shows that a written warning is
  insufficient without an enforceable secret-safe command wrapper.

The final synthesis should preserve both facts: Supabase successfully started
on the current client, and this refresh provides no valid current acceptance
ranking input because the builder Stop terminated the arm.

