# Todo / Snapback Linux final-confirmation handoff

This additive handoff records the external-package confirmation executed on the
Minisforum Linux worker from frozen Snapback source
`4e5da63c33064082c73359f0ee02efcd11e360ff`.

- Staged version: `0.1.1-llp0102.1`, dry-run only; nothing was published.
- Assigned API/Vite ports: `33101` / `43101`.
- Result: 11 passes, 3 declared gaps, 0 failures, 14 expected checks.
- The server was started twice, including the reconnect restart, through the
  external project's installed `snapback` CLI and installed
  `@snapback/runtime-linux-x64`.
- Both runtime identities reported the frozen commit, clean source, and release
  profile. No Cargo, source binary, runtime override, demo-kit server wrapper,
  or repo-relative Snapback import was used.
- The frozen arm removed its exact runtime and persona targets. The companion
  package identity receipt confirms all lifecycle files absent at process exit;
  the assigned ports were closed in the post-run probe.

`evidence/transformation-receipt.json` accounts for all 14 externalization
changes and contains a clean forbidden-source-coupling scan.
`evidence/package-identity-receipt.json` records both installed launch paths,
binary identities, stop commands, intermediate stop residuals, and final
cleanup. The acceptance directory preserves every scenario, performance, gap,
backup, persona, and cleanup receipt emitted by the frozen runner.

The raw performance samples were collected on Linux x86_64. The frozen runner
hardcodes the stale label `Mac17,3 arm64` in `performance.v1.json`; the
companion `execution-environment.json` corrects the machine context. These
samples must not be represented as Mac measurements.
