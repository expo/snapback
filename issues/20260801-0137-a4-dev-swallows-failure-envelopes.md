# A4 sweep: `snapback dev` exits 1 with no output when the managed loop's first result is not ok

**Opened:** 2026-08-01
**Systems:** CLI, Developer loop
**Related:** LLP 0137 (A4 arm), demos/improvement-sweep/arms/a4-snapback-web/findings/0137-a4-f2-dev-swallows-failure-envelopes.json

When `runDev`'s initial result is not ok (observed with
`SNAPBACK_SEED_VERSION_REUSED` after editing seed bytes under an already
registered seedVersion), the `dev` CLI branch returns
`result.ok ? 0 : 1` without ever printing the failed result envelope:
exit 1, zero bytes on stdout and stderr. The same failure through
`snapback generate` prints a full structured diagnostic. The A4 arm lost a
debugging cycle to the silent exit and recovered the diagnostic only by
calling `runDev` programmatically. `snapback dev --help` also silently
exits 1 (`--help` is consumed as the backend directory name).

Fix shape: print the not-ok envelope through the same `printResult` path
every other command uses before returning 1, and reject flag-shaped
positional arguments. Witness: a CLI test drives `snapback dev` over a
failing backend and asserts the diagnostic reaches the terminal.
