# Model availability — preparation probes

These were isolated, one-turn probes under
`/Users/ccheever/clique-sb4-20260913-model-probes/`, outside the run packet and
every benchmark lane. Each prompt requested only `MODEL_OK`, used no tools,
installed nothing, and exited successfully. Raw stdout/stderr and epoch
metadata are retained by provider name; they contain no copied credentials or
environment dump.

| Role | CLI available now | Requested model / effort | Result |
| --- | --- | --- | --- |
| Astra builder/M7 | Codex CLI 0.154.0 | `gpt-6-astra` / medium | exit 0, `MODEL_OK` |
| Grok builder/M7 | Grok 1.0.30 | `grok-4.6` / xhigh | exit 0, streamed `MODEL_OK`; usage labeled the serving alias `grok-4.6-build` |
| Muse builder/M7 | Muse Code 1.2.1 | `muse-spark-1.3` / xhigh | exit 0, `MODEL_OK` |
| Independent grader | Claude Code 2.1.270 | `claude-opus-5` / provider default | exit 0, `MODEL_OK` |

The builder model IDs and efforts are the actual substitutions retained by the
September 5 run. CLI versions have drifted: that run recorded Codex 0.153.4,
Grok 1.0.13, and Muse Code 1.0.3; the September 12 Snapback4 Astra run recorded
Codex 0.154.0. This packet records the current versions rather than presenting
them as identical harness binaries.

`claude-opus-5` exactly matches the independent grader model recorded by the
September 5 full run and the September 12 Snapback4 run. Those records did not
pin a Claude CLI version, so the current Claude Code 2.1.270 binary is disclosed
as a comparison limitation.

Host probe: macOS 26.6.2 (25G83), Apple M5 Max, 18 logical CPUs, 128 GiB RAM;
Node 24.18.0 and Bun 1.3.12.
