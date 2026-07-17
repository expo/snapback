# File the ibex 0028/0029 contract corrections required by LLP 0062

**Status:** Open
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
