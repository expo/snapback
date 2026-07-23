# File the ibex 0028/0029 contract corrections required by LLP 0062

**Status:** Resolved (2026-07-23 — both filings exist with recorded identifiers; landing stays deliberately deferred)
**Severity:** P2
**Systems:** Runtime, Packaging, Docs
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-17
**Related:** LLP 0062 §6 (Review revision `14f54843…`), ibex LLP 0028 (Oxc-only transform), ibex LLP 0029 (single-file executable)
**Marker:** app-cli, cross-repo, ibex

Phase 1 has no embedded-Ibex dependency. The current ibex documents
still couple this RFC to computed-import work and describe the
single-file executable as prototyping the Snapback CLI, while their
actual contracts admit one compile-time entry and forbid runtime
file/eval/REPL ingress. File one correction for each document so the
corpora cannot sequence phase-1 app-CLI work against a dependency LLP
0062 explicitly removed. The filings preserve ibex's current ingress
and supply-chain boundaries; arbitrary external script ingress,
separate credential-owning parent/worker policies, runtime transform
inclusion, and target attenuation remain a separately reviewed phase-2
direction.

This is a filing obligation, not an obligation to land the ibex design
changes before Snapback phase 1. File the issues in the Exact Linear
project with exactly one `repo:ibex` and one tier label, link both back
to LLP 0062 and this program, and record the resulting identifiers here.

**Done when:**

- Distinct Linear issues exist for ibex LLP 0028 and LLP 0029, with the
  stale claims quoted, the phase-1 non-dependency explicit, and
  resolution criteria that require reviewed amendments before any
  standalone app-CLI phase begins.
- Both issue identifiers are recorded in this file and in the
  cross-cutting program closeout; neither is represented as already
  landed.
- The Snapback and ibex corpora no longer have an untracked sequencing
  dependency even if the ibex amendments remain open.

## Resolution (2026-07-23, session 1681e9d6)

- **ENG-25410** — ibex LLP 0028 correcting amendment (Oxc-only transform):
  stale claims quoted (the §6-acceptance-criterion coupling and the
  2026-07-18 "Snapback requires computed dynamic imports for 0.2" Revised
  entry), phase-1 non-dependency explicit, resolution requires a reviewed
  amendment before any standalone app-CLI phase.
- **ENG-25411** — ibex LLP 0029 correcting amendment (single-file executable
  packaging): "v1 prototypes the contract for Snapback" and the 0.2
  computed-import claim quoted; resolution requires naming the concrete
  ibex-side contract revisions the standalone phase needs.

Both labeled repo:ibex + tier:3 in the Exact Linear project, linked back to
LLP 0062 and this program; identifiers also recorded in the phase-1 program
index and LLP 0062's disposition table. Neither is represented as landed;
ibex's ingress and supply-chain boundaries are unchanged. The corpora no
longer carry an untracked sequencing dependency.
