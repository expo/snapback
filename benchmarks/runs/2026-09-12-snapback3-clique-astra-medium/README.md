# Snapback 3 Clique diagnostic — Astra medium

This is the selected public record of the original full-scope Clique run. The
builder produced a working textual account/profile slice, but M1 did not turn
green: Snapback 3 `0.0.1-experimental.0` rejected the required avatar media
schema with `S3_CAPABILITY_UNAVAILABLE`. The required M1 suite therefore passed
5 of 7 assertions and failed avatar upload and avatar rendering; the unchanged
browser choreography passed 3 of 3 checks. M2–M8 and the separate M7 session
were not attempted because the brief made them depend on green M1. This run
contains no messaging, scale, performance, efficiency, or comparative-win
result.

For current evaluation, this full attempt was superseded by the user-authorized
[focused Clique run](../2026-09-12-snapback3-clique-focused-astra-medium/README.md),
which starts from the retained M1 code and targets client coordination and
performance scenarios without treating the unavailable media prerequisite as
part of that narrower scope.

The builder receipts are in [builder/](builder/). The combined terminal is
[m1-terminal.json](builder/evidence/m1-terminal.json), the seven suite results
are [m1-suite.json](builder/evidence/m1-suite.json), and the three browser checks
are in [choreography-m1.jsonl](builder/evidence/choreography-m1.jsonl). The
runtime's independent media refusal is retained in
[m1-media-check.json](builder/evidence/m1-media-check.json). The authored links
to Apple-platform status now resolve to
[artifacts/native-status.json](builder/artifacts/native-status.json).

## Independent grade

An independent Claude Opus 5 grader completed successfully, without seeing the
builder narratives excluded by the freeze. It labeled itself uncalibrated and
used one rerun. It independently reproduced the five suite passes and two media
failures, confirmed server-side token revocation and the media admission limit,
and sampled all seven suite coverage mappings as honest. Across the frozen
119-assertion full-run denominator it recorded 11 M1 passes, 2 M1 failures, 105
not-run assertions, and 1 conditional not-applicable assertion. It scored O1 at
10 and O2 at 45; O3, O4, and O5 are null, and it computed no weighted total.

The grader also reported two major defects: logout silently failed in 4 of 7
back-to-back choreography runs, and the documented seed-then-acceptance order
hit the authentication rate limit until a cooldown. Four additional findings
were minor. See the schema-valid [grader report](grader/grading/grader-report.json),
[M8 supplement](grader/grading/m8-supplement.json), and
[evidence trace](grader/grading/trace.md). The terminal marker is
[DONE](grader/grading/DONE). The foreground transport exited 0; the grader and
its server processes exited, and an independent check found port 54800 closed,
as recorded in [grader-completion.json](provenance/grader-completion.json).

## Fixed provenance

- Builder: `gpt-6-astra`, medium reasoning. The frozen prompt SHA-256 is
  `e5389e4c3f397a9fea868a9134228d6cfa958a9955b17751ae36ed333e61b113`.
- Package: private Linux x64 `snapback3@0.0.1-experimental.0`, SHA-256
  `719eba5bfaffeebf117ca3e10d60d830da2ca4ca735693ea0e46f0d6317fcb4e`.
- Snapback source commit: `409954115f151a72dd95e897c5f00f36877f11e0`.
- Frozen instrument: `social-messenger@0.3.8-m8`, 185 verified files at commit
  `b323d61f60b5d167708ca6ebe6434b1d5a79c899`; manifest SHA-256
  `b183d949bb4c5871747afb92f0eccb153c813765037507ef4d888f76a6da07a6`.
- Launcher: SHA-256
  `5c8999630fb3e50fbdbc11273e3d8754b74adbf9986368599cb2121692b78cf9`.
- Independent grader: `claude-opus-5`; report SHA-256
  `9440676c1a0b6d51e4d154931b3b0301af15deb420e425645f2d82b714cb8b89`.

Exact prompts, preparation records, package qualification, process receipts,
and the retained native-session manifest are under [provenance/](provenance/).
Packet preparation and separate package qualification preceded the measured
builder work. Application dependencies were not a preinstalled baseline: the
builder transcript installs the private package and application dependencies
after launch, within the reported M1 authoring interval. The run record reports
586 seconds of M1 authoring; the foreground launcher ran for 945 seconds
including post-terminal reporting and evidence capture. The timing evidence is
summarized in [dependency-timing.json](provenance/dependency-timing.json).
Native token use was retained but not joined into an authenticated accounting
result.

## Limits of this record

The four-hour milestone cap was prompt-only; no authenticated numeric cap or
boundary controller existed. The launcher bound the foreground actor PID and
retained its native root/descendant rollout tree, while server ownership relied
on builder-recorded PIDs rather than an S2 scale-owner controller. The retained
base run record failed the composed record schema because several metering,
orientation, observability, and suite-linkage fields were absent. No holdout
probe set was committed. Apple simulator proof was unavailable on the Linux
host; the retained iOS/Hermes export is build output, not native execution
evidence.

[builder-collection.json](builder-collection.json) hashes the 58 selected
builder files; [collection-manifest.json](collection-manifest.json) hashes the
complete 128-file public selection. The secret scan found no high-confidence
secret material; [secret-scan.json](secret-scan.json) reports filenames only
for credential-like diagnostic/test literals. The public selection omits the runtime/auth database, `.expo`,
`node_modules`, web and Hermes export bytes, copied frozen support kits, raw
native model sessions, and grader helper scripts. The complete immutable
builder snapshot and statuses remain retained outside this selected public
directory; the grader artifacts here are a separate copy and do not modify that
snapshot.
