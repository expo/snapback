# Actual Muse builder reproduction: 024 and 036

Received 2026-10-27 from `muse-spark-1.3-contributor`, high effort, via the exact [replay brief](muse-replay.txt). Result follows verbatim. Disposable project/store copies only; no full app/time-score claim.

muse: workspace root: /home/ccheever/projects/sb4-b32-dx15 (cwd default)
muse: workspace trust: trusted source=run-flag
Ran the exact verification from `snapback4/`, no edits.

Command:

`systemd-run --user --scope -q -p MemoryMax=40G -p OOMPolicy=continue node --test --test-concurrency=1 --test-name-pattern='036/017/008: SIGTERM|024:' packages/snapback4/test/srv1-lifetime.test.mjs`

Unaltered relevant output from [srv1-lifetime.test.mjs](/home/ccheever/projects/sb4-b32-dx15/snapback4/packages/snapback4/test/srv1-lifetime.test.mjs):

```
{"shape":"036/017/008","kind":"serveUntilSignal","signal":"SIGTERM","pipeEOFms":430}
✔ 036/017/008: SIGTERM to npm only releases serveUntilSignal driver store and pipes (14358.007385ms)
{"shape":"036/017/008","kind":"native CLI","signal":"SIGTERM","pipeEOFms":302}
✔ 036/017/008: SIGTERM to npm only releases native CLI store and pipes (14012.201687ms)
024 transcript: node driver.mjs | tail -n 2 -> requests complete, EOF, exit 0; next serve/deploy succeeds
✔ 024: request-making driver exits; serveUntilSignal child cannot keep | tail open (14263.748633ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

Status: exit 0. All 3 passed.

Each original wait ended on the first try. No `E_STORE_BUSY` appears. Both 036 shapes show measured `pipeEOFms` (430ms, 302ms). 024 shows the full transcript: driver requests complete, EOF, exit 0, next serve/deploy succeeds.

Scope note: this is only SRV1 024/036 completion evidence, not an app bakeoff or time-score claim.
