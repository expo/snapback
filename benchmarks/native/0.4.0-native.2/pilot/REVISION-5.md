# Revision 5 — source refusal retained; Convex followed by diagnostic SB4

P2A Round 4 lead ruling, 2026-10-05. Snapback 4's native outcome is
`handoff-refused-by-source-audit`, a pilot finding, not a void or setup failure.
The initial audit and every finding remain unchanged. Two findings were
verified against source: `src/Chats.tsx` awaits the observation journal before
send, and `scripts/native-oracle.mjs` uses an SDK query path capable of posting
delivery receipts. No product edit or setup rerun is authorized or consumed.

For both lanes and both audit stages, the operator supplies the exact bytes
of mandated `~/.snapback-env.sh` in sealed `metadata/operator-environment.sh`,
with its SHA-256 in `metadata/operator-environment.json`. Each audit verifies
the sealed and live hashes and retains the contents, hash, check time and
relevant fixed environment in its input record and prompt. Sourcing the script
is mandated and admissible. Operator variables, including an unset
`SNAPBACK4_BIN`, are operator decisions; the auditor still traces and flags
builder-authored binary substitutions. Compilation overrides are cleared by
the operator. Origins supplied to adapters are the fixed operator origins.
This amendment changes no builder prompt or authoring input.

One initial re-audit of the retained SB4 work copy runs before continuation,
with no preparation or product change. It is retained separately under
`results/snapback4/re-audit-revision-5/`, including both verdicts and their
digests. The original audit is never overwritten. The source refusal remains
the native outcome; a diagnostic cannot reverse it.

The one-use continuation is:

```sh
./pilot-chain.sh --continue-source-audit-ruling
```

The sealed ruling binds revision 4, original audit/attempt, lane/custody/work
inventories and every prior ended chain. Admission requires cold Convex,
the recorded re-audit, and no prior continuation/diagnostic. Execution order:
Convex builder → Convex after-builder → SB4 diagnostic. Both Convex audits
remain gating. A setup failure or exception is recorded per step and does not
short-circuit the diagnostic. The shared authoring/operator lock prevents
co-tenancy, including when the builder's launcher returns after detaching it.
Host/toolchain or simulator unavailability remains a real execution limit.

The diagnostic uses the existing retained SB4 custody work copy, then the
original authored preparation argv, a recorded non-gating prepared-source
audit, the original Release build argv, qualified native M6 and M8 on the
dedicated simulator, and independent validation. Segment errors are retained
and M8 is still attempted after an M6 instrument/setup refusal when cleanup
allows it. No source fix, product retry, setup rerun, substitute binary, new
driver or pass claim is authorized. An inherited macOS write-denial profile
protects original builder/custody/audit trees through authored commands and
the native driver. The auditor retains its own read-only sandbox. The existing
SwiftPM preference accommodation is scoped to the diagnostic's serial lease and
restored afterward. Original builder and custody trees are reverified afterward.

Every diagnostic artifact is labeled:
**diagnostic: audit-refused, never admissible, no pass claimed**.
The dedicated result directory and its notice mark the scope before execution;
the scratch notice covers generated build artifacts. A final per-path manifest
binds every file, including video, raw driver/validator output, logs, binaries
and retained scratch, to this label and its hash. Qualified evidence bytes are
not rewritten to inject extra schema fields. Their raw verdicts are diagnostic
observations only. Summary segment passes stay null, with `admissible:false`
and `passClaimed:false`; O4 and overall remain null. No later review can admit
these diagnostic artifacts as a pilot pass.

PACKET.v1–v4 are retained. Revision 5 binds the v4→v5 harness diff, operator
environment and ruling. The native instrument, driver, validator, runner,
helper, UI kit and all builder prompts/inputs remain unchanged. Safety tests
cover exact sealed environment bytes and live drift, fixed operator overrides,
audit gating, non-gating diagnostic review, one-use custody admission, retained
findings, every diagnostic artifact label and continuation after setup failures.
Only eb1000 and the Apartment mini are used. No black M5 or office M1. Commit
locally with the requested Astra coauthor trailer; do not push.
