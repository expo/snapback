Top finding: `npm run probe:serve` exits by itself after its idle wait, no hold or timeout wait needed.

Ran once in foreground with 120s allowed:

- Elapsed time: ~60 seconds. It reported `E_PROBE_IDLE: no requests in 60 seconds`.
- First stderr advice: `stays up until SIGTERM; verify with npm run probe:check`
- Exit status: `1`
- Tool timeout wait: No. It reached terminal `failed` on its own before the 120s allowance. No timeout, polling, or extra requests used.

Ran the bounded command it named, once:

- `npm run probe:check` exit `0`
- Output: `{"ok":true,"script":"probe:serve","failures":[],"ready":true,"upMs":30000,"lockReleased":true}`

Nothing left running.
