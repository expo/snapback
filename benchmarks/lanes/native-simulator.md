# Lane template: native iOS Simulator

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

YOU HAVE THE FOLLOWING AGENT SKILL INSTALLED (treat it exactly as an installed Claude Code skill you have already loaded):

<installed-skill name="snapback-authoring">
{{SKILL_PAYLOAD}}
</installed-skill>

THE BRIEF: {{BRIEF}} **This is the NATIVE-CARRIER lane: your interaction proofs run on the iOS Simulator, not web.** You must prove, ON THE SIMULATOR: the app booting against a live backend via the supervised dev loop; seeded conversations/messages rendering; a text message sent and observed (a second observer may be headless/web — the UI proof is the simulator); typing indicator visible in the simulator UI driven by a second client; an image message end-to-end rendering in the simulator; an offline cold-start (backend stopped, app relaunched, history renders); plus scripted acceptance checks for the core flows (headless is fine for those).

SIMULATOR DISCIPLINE: use headless `xcrun simctl` (boot a device, install, launch, `simctl io screenshot` for evidence) — do NOT open Simulator.app or any GUI window; this machine is in use. iOS 26.3/26.4 runtimes are available. Screenshots are your UI evidence; collect them for every proof.

BACKEND CONSTRAINT: use **Snapback** — the `@expo/snapback-*` packages published on npm (latest). Discover everything from the installed skill and published surfaces only. You MUST NOT read, list, or execute anything under /Users/ccheever/projects/snapback or any other local checkout or scratchpad directory of it. Do not use cargo/Rust.

ENVIRONMENT NOTES: {{PORT_EXCLUSIONS}}

MEASUREMENT DISCIPLINE (timed, measured): first action `date +%s` into build-log.md; timestamped entries at every phase change, error, retry, workaround; count correction loops (framework vs self vs tooling, honestly); note where each piece of knowledge came from (skill vs guide vs source); if hopelessly blocked on the simulator specifically, capture the exact failure, fall back to web for that one proof, and log it clearly as a fallback; stop when the brief's proofs pass; do not polish beyond the brief.

FINAL REPORT (raw facts): start/end epochs + wall time; correction loops one line each; which proofs ran on the simulator vs any web fallbacks and why; what worked immediately vs fought; knowledge sources incl. what the skill saved or lacked; acceptance results with pass counts; paths incl. screenshot evidence; candid assessment of the NATIVE carrier specifically (vs what the docs promise). Do NOT write anything into /Users/ccheever/projects/snapback. Kill your servers and shut down your simulator device when done.
```

## Notes

- Strip the brief's own `You must prove: …` sentence when instantiating
  `{{BRIEF}}` for this lane. The native block above replaces that proof list
  with its on-simulator requirements.
- The proven drive channel is headless `simctl` end to end: boot a device,
  install Expo Go, pre-approve the `exp` scheme, drive interaction through
  deep links (`simctl openurl`), and collect `simctl io screenshot` evidence
  (diary 0068; the lane build log records "deep-link driver for headless sim
  interaction").
- The iOS 26.3 simulator runtime renders astral emoji as tofu because of a
  CoreText bug, not Snapback; 26.5 renders them correctly. Prefer the newest
  available runtime.
- Metro's file watcher is blind under `/private/tmp`, and `CI=1` silently
  disables watching (three runs). Place `{{WORKDIR}}` outside `/private/tmp`
  or expect supervisor restarts after each edit.
