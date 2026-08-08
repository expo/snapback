# Lane template: competitor web

This template was proved by diary 0068's four-lane run on npm 0.1.13,
2026-08-07. The prompt is carried here verbatim from that run, with only
run-specific values replaced by parameters.

## Parameters

| Placeholder | Value |
|---|---|
| `{{WORKDIR}}` | Absolute, lane-private working directory. Use one fresh directory per lane; lanes must never share or inspect each other's directories. |
| `{{BRIEF}}` | The brief's lane-prompt block, taken verbatim from the `Lane-prompt block` section of a `benchmarks/briefs/*.md` file. |
| `{{PORT_EXCLUSIONS}}` | The occupied-ports sentence for this machine at run time. Proven example: `Metro ports 8081/8082/8095/8097 and backend ports 4287/4290/4293/8788/8789/3210/3211/3212/3230 may be occupied — pick other ports.` |

## Template

```text
You are a senior product engineer building a demo app from scratch. Work entirely inside {{WORKDIR}} (create it).

THE BRIEF: {{BRIEF}}

BACKEND CONSTRAINT: use **Convex** (the `convex` npm package). Discover everything from its published packages, CLI, and public documentation (web access allowed). Prefer an anonymous/local dev deployment if cloud login isn't available non-interactively; do not get stuck on account auth. You MUST NOT read anything under /Users/ccheever/projects/snapback or any Snapback checkout, and do not look at the sibling m4-snapback-* / m3-* / rematch-* scratchpad directories — this build must be independent.

ENVIRONMENT NOTES: {{PORT_EXCLUSIONS}}

MEASUREMENT DISCIPLINE (timed, measured): first action `date +%s` into build-log.md; timestamped entries at every phase change, error, retry, workaround; count correction loops (framework vs self vs tooling, honestly); note where each piece of knowledge came from; if hopelessly blocked, best workaround + continue; stop when the brief's proofs pass; do not polish beyond the brief.

FINAL REPORT (raw facts): start/end epochs + wall time; correction loops one line each; what worked immediately vs fought; knowledge sources; acceptance results with pass counts; paths; candid comparison-free assessment. Do NOT write anything into /Users/ccheever/projects/snapback. Kill your servers when done.
```

## Notes

- The independence fence's sibling-directory list
  (`m4-snapback-* / m3-* / rematch-*`) names the proven run's lane
  directories. When instantiating, replace it with the current run's actual
  sibling lane directories; the fence's meaning — never inspect another
  lane's work — is what must be preserved.
- The Convex instance is the proven control lane. Supabase, PocketBase, and
  Postgres belong to the LLP 0186 W1 lane set but do not yet have proven
  prompts. For those lanes, adapt only the `BACKEND CONSTRAINT` paragraph.
  Preserve its fences: published packages and public docs only; prefer a
  non-interactive local or anonymous deployment and do not stall on account
  authentication; never read the Snapback checkout or any sibling lane
  directory.
