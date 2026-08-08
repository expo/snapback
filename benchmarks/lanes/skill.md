# Lane template: skill-equipped Snapback web

This template was proved by diary 0068's four-lane run on npm 0.1.13,
2026-08-07. The prompt is carried here verbatim from that run, with only
run-specific values replaced by parameters.

## Parameters

| Placeholder | Value |
|---|---|
| `{{WORKDIR}}` | Absolute, lane-private working directory. Use one fresh directory per lane; lanes must never share or inspect each other's directories. |
| `{{BRIEF}}` | The brief's lane-prompt block, taken verbatim from the `Lane-prompt block` section of a `benchmarks/briefs/*.md` file. |
| `{{PORT_EXCLUSIONS}}` | The occupied-ports sentence for this machine at run time. Proven example: `Metro ports 8081/8082/8095/8097 and backend ports 4287/4290/4293/8788/8789/3210/3211/3212/3230 may be occupied — pick other ports.` |
| `{{SKILL_PAYLOAD}}` | Full text of the consumer-form `SKILL.md`, extracted by the recipe in `benchmarks/README.md`: scaffold from published packages and take `.claude/skills/snapback-authoring/SKILL.md`. |

## Template

```text
You are a senior product engineer building a demo app from scratch. Work entirely inside {{WORKDIR}} (create it).

YOU HAVE THE FOLLOWING AGENT SKILL INSTALLED (from your harness's skill directory — treat it exactly as an installed Claude Code skill you have already loaded):

<installed-skill name="snapback-authoring">
{{SKILL_PAYLOAD}}
</installed-skill>

THE BRIEF: {{BRIEF}}

BACKEND CONSTRAINT: use Snapback — the @expo/snapback-* packages published on npm (latest). Discover everything from the installed skill and published surfaces only: the npm packages, their CLIs and READMEs, and anything a running Snapback server serves. You may use web search generally, but you MUST NOT read, list, or execute anything under /Users/ccheever/projects/snapback or any other local checkout or scratchpad directory of it. Do not use cargo/Rust.

ENVIRONMENT NOTES: {{PORT_EXCLUSIONS}}

MEASUREMENT DISCIPLINE (timed, measured build): first action `date +%s` into build-log.md; timestamped entries at every phase change, error, retry, workaround; count correction loops (framework vs self vs tooling, honestly); note where each piece of knowledge came from (skill vs served guide vs package source vs README); if hopelessly blocked, best workaround and continue; stop when the brief's proofs pass.

FINAL REPORT (raw facts): start/end epochs and wall time; correction loops with one line each; what worked immediately vs fought you; knowledge sources (specifically: what the SKILL saved you vs what it lacked); acceptance results with pass counts; paths; candid assessment including whether the skill helped, where it was wrong or silent. Do NOT write anything into /Users/ccheever/projects/snapback. Kill your servers when done.
```

## Notes

- The proven runs wrote the fully instantiated prompt to a file and started
  the lane agent with this one-liner (verbatim from diary 0068's skill lane):
  "Read <file> as your complete task instructions and follow them exactly.
  That file contains: your working directory, an installed agent skill you
  should treat as loaded, the full app brief, backend and isolation
  constraints, measurement discipline, and the required final-report format.
  Everything in that file governs; deliver the final report it specifies."
  Use the same delivery method when a harness's inline prompt field is
  impractical for a 13 KB prompt.
- The skill payload must be the consumer form. The extraction recipe and the
  registry-propagation-lag check live in `benchmarks/README.md`.
