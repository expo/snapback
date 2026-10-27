Ran `npm run probe:serve` once in foreground with 120s allowed.

- Elapsed: ~60s — server self-exited on its own `E_PROBE_IDLE: no requests in 60 seconds` timer, well before the 120s tool wait expired.
- First stderr advice: `stays up until SIGTERM; verify with npm run probe:check`
- Exit status: `1`
- Tool timeout wait: No — process exited terminally (`failed`, exit 1), no timeout/polling needed.

Bounded verification `npm run probe:check` run once: exit `1`, `ok:false`, `ready:false` with `E_SERVE_NO_JSON / E_SERVE_EARLY_EXIT / E_SERVE_STOP_FAILED / E_SERVE_STORE_MISSING`.

Service did not stay running. No files modified or inspected.
