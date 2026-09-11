# Snapback 2 reduced Clique loop bar — published 0.0.21, Astra medium, N=3

**Result: NOT MET.** The exact M1 timing gate passed in all three fresh
sessions, but the correction-loop, retrieval, and pass^3 gates did not. This
record therefore does not qualify the Snapback 2 loop bar or unblock a
downstream capability claim.

The series was preregistered in [PREREGISTRATION.md](PREREGISTRATION.md) at
commit `6abeaaf16`, before any replicate started. Every replicate used the
same [brief](brief.md), harness, model/effort, public package, and Silver host;
the controller ran them serially in clean app/store directories without
steering, delegation, or warm retries. The orchestrating conversation is not
counted.

## Gate result

| Replicate | M1 first green | ≤1,200 s | Pre-edit retrievals | ≤2 | Snapback corrections | ≤1 | Required M1–M3 proof | Constituent |
| --- | ---: | :---: | ---: | :---: | ---: | :---: | --- | :---: |
| `astra-medium-01` | 677.462 s | PASS | 2 | PASS | 2 | FAIL | final plain `snapback2 test` failed HTTP 503 | FAIL |
| `astra-medium-02` | 313.893 s | PASS | 3 | FAIL | 2 | FAIL | only the pacing wrapper passed; the retained direct run exited 1 | FAIL |
| `astra-medium-03` | 455.462 s | PASS | 2 | PASS | 3 | FAIL | final plain `snapback2 test`, acceptance, and build passed | PASS |

M1 median is **455.462 s**, range **313.893–677.462 s**, N=3; every
constituent clears the timing gate. Retrieval calls are 2/3/2 (median 2,
range 2–3), and correction loops are 2/2/3 (median 2, range 2–3). Only one
of three M1–M3 constituents passes, so the preregistered pass^3 gate is not
met. Per `benchmarks/protocol.md`, N=3 supports this exact ratchet reading but
not a variance, ordering, release-regression, or cross-model claim.

The machine-readable result is [adjudication.json](adjudication.json). It is
an independent audit of the builders' own summaries. In particular, replicate
2's `allGreen: true` is not accepted: its final command list invokes
`python3 scripts/paced-suite.py`, while the brief explicitly requires plain
`snapback2 test`; its retained direct suite exits 1. Replicate 3 eventually
made that exact command pass without the explored pacing experiments.

## What failed

All three sessions encountered the same package-test resource edge: repeated
derived subscriptions began returning `E_OWNER_TEST_SSE` / HTTP 503 at or
around the 49th probe. Replicate 1 stayed red. Replicate 2 passed only after
externally pacing the unchanged test supervisor. Replicate 3 made the plain
command pass by ordering fixtures so committing witnesses were found before
the edge, but that recovery is still a Snapback-attributed correction episode.

Two other correction classes are part of the count. Every builder encountered
the profile-only invalidation proof's need for a concrete disjoint mutation
and added an otherwise unrelated real operation. Replicate 3 additionally had
to match exact canonical membership-operation names and a
`membershipId`-bearing leave signature before the derived authority proofs
would run. The attribution protocol remains Draft, so all raw builder labels
are preserved; `adjudication.json` records the narrow independent count.

## Prior 0.0.20 / 0.0.21 record audit

| Published record | Useful evidence | Why it cannot fill this bar |
| --- | --- | --- |
| [`2026-09-09-clique-snapback2-0.0.20-treatment`](../2026-09-09-clique-snapback2-0.0.20-treatment/README.md) | three cold full-app builders; Astra M1 498 s, Grok 3,105 s, Muse 8,261 s | three different configurations, hence N=1 per cell; no retained pre-edit retrieval measurement; complete machine record only for Astra |
| [`2026-09-10-clique-ri-0.0.21`](../2026-09-10-clique-ri-0.0.21/README.md) | one Astra-medium and one Grok-xhigh full-app run | N=1 per configuration, parallel/shared-host execution, no reduced pre-edit retrieval measurement; Astra's missing-harness-file attempt continued rather than restarting cold |

Those records remain valid existence/calibration evidence. They are neither
discarded nor pooled into this cell. The new series began at zero eligible
replicates.

## Environment and evidence

All three runs used “Charlie’s MacBook Pro M5 Max Silver”, Apple `Mac17,6`,
18 physical/logical CPU cores, 137,438,953,472 bytes memory, macOS 26.6.2,
arm64, Node 24.20.0, npm 11.19.0, and Codex CLI 0.153.4. Each start observed
the public registry identity for `snapback2@0.0.21` with integrity
`sha512-Mc2fRjWYmKW4rYhh+ksZ/Q4ZvM5JzyXxZ/IMRmDkXTgYUiJq03yYcYIodxp15mf8sePWjFR9g8u9MEi0K90zcw==`.
Exact start load and tool output live in each `environment.json`.

Each directory under [`cells/`](cells/) retains the controller terminal,
environment, first-edit marker, M1 marker, builder correction ledger, builder
summary, selected decisive test logs, and the complete native Codex event
stream. Large text streams are gzip-compressed without content changes. The
raw app trees remain on Silver at
`/Users/ccheever/snapback2-loop-0021-n3-execution/`; they are supporting local
artifacts, not required to interpret the committed result.

- Replicate 1's `evidence/final-suite-attempt-1.log.gz` is the decisive final
  plain-suite failure; `evidence/m1-suite.log` retains its milestone pass.
- Replicate 2's `evidence/m3-suite.exit` and `m3-suite.log.gz` retain the
  direct failure; `paced-suite-exit.json` / `paced-suite.log.gz` retain the
  non-qualifying workaround.
- Replicate 3's `evidence/all-suite.log` and `acceptance.log` retain the final
  qualifying plain command and complete acceptance; `m3-suite-observe.log.gz`
  retains the reproduced 503 diagnosis.

`SHA256SUMS` binds the committed evidence bytes. To inspect a compressed raw
stream, use `gzip -dc <path>`.

## Disposition

Keep the filesystem ticket open. The next eligible attempt needs a newly
published package that removes the derived-SSE cliff and the invalidation /
canonical-proof discoverability corrections, followed by another
preregistered, serial, same-configuration cold N≥3 cell. A warm retry of any
of these apps cannot fill that requirement.
