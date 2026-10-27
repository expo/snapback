# Probe lifetime contract

Read-only sources inspected: `~/sb4-loop/bakeoff/probe.mjs` startServe/verifyServe
and `brief-bakeoff.md` §4. The external harness starts a detached process group,
waits for one JSON line, holds it at least 30 seconds, then sends SIGTERM.
Builder and harness environments both contain CI/PORT_LO/PORT_HI/SB4_LANE;
those variables cannot distinguish an accidental foreground builder invocation.

For revised guarded entry scripts, the harness's **driver child only** must use
one of these equivalent opt-ins:

```sh
npm run probe:serve -- --hold
# Or, on that child environment only:
SNAPBACK4_PROBE_HOLD=1 npm run probe:serve
```

For probe.mjs's existing `spawn("bash", ["-c", `exec npm run ${script}`], …)`,
the exact argv change is `exec npm run ${script} -- --hold`, or add
`SNAPBACK4_PROBE_HOLD: "1"` to that spawn's environment. Do not export it to
builder sessions: that would disable their foreground idle protection.
No external harness file was edited. The coordinator must apply this opt-in
when adopting the revised starter. `serveCheck`/`probe:check` already supply
it internally, because the checker owns a bounded uptime proof.

Ordinary `serveUntilSignal` recipes without probeServeGuard retain indefinite
service. The generated guarded probe prints its advice before deployment,
bounds the first zero-request ready wait to 60 seconds, and refuses a subsequent
terminated >60-second zero-request run before deployment. Provisioning/readiness
requests are excluded from the post-ready activity baseline. Aggregate local
request counts contain no paths, payloads, account data or authorization.
