# R2 `sol-coterie-familiar` blocked at controller admission replay

Date: 2026-08-24  
Host: `Mac.lan` (`mac-mini-durand`)  
Disposition: **cell consumed before prompt delivery; campaign continues**

`sol-coterie-familiar` passed the registered three-sample admission gate, but
the landed lane controller refused the admission before importing the driver or
creating the private cell. Its finalization path then reported:

```text
social-messenger lane controller finalization failure:
stage=unclassified source="none" streamLine=none eventOrdinal=none eventType="unknown" cause="R2_ADMISSION_SERIALITY: campaign state changed after admission" rawPayloadExcerpt="<not event-scoped>"
```

The controller exited 2. Per the campaign ruling, this consumed cell is not
rerun; the failure is recorded and serial execution continues.

## Admission evidence

The admission gate sampled load once per minute and all three samples were
below the inclusive 10.00 ceiling:

| Sample | UTC | loadavg-1 | loadavg-5 | loadavg-15 |
| --- | --- | ---: | ---: | ---: |
| 1 | `2026-08-24T21:47:58.115Z` | 1.5562 | 1.7266 | 1.9688 |
| 2 | `2026-08-24T21:48:58.118Z` | 1.5400 | 1.6724 | 1.9277 |
| 3 | `2026-08-24T21:49:58.121Z` | 1.4136 | 1.5928 | 1.8794 |

The complete admission artifact is retained at
`admissions/sol-coterie-familiar.json` with SHA-256
`0ec6af1b5a61413864bf4c30408a79ca87b9df731d0d7c39e41973fb7611c886`.
It binds the digest-verified
`social-messenger@0.3.3-m8` materialization at
`/Users/ccheever/bench-matrix-20260823-r2/instrument-corpus-hardening-20260824-v5`,
the registered controller and driver bytes, closed prior processes, unbound
campaign ports, and campaign HEAD
`634818d70f7c0ca5e96e77349d1bb6878e916504`.

## Refusal cause and retained evidence

While the admission process was taking its minute-spaced samples, another
local process committed `96c168dfc2b5faaaa6c372c46e4237da9fd885d2`
(`issues: document running the Snapback suites on Linux build hosts`) to the
shared `main` checkout at 2026-08-24 14:49:28 PDT. The admission artifact was
issued at 2026-08-24T21:49:58.206Z still bound to the earlier HEAD. The
controller's immediate replay observed the changed campaign state and refused
it fail-closed.

No private root exists at
`/Users/ccheever/bench-matrix-20260823-r2/cells/sol-coterie-familiar`.
The controller did not import the driver, create a prompt, launch Codex, write
events, or produce `record-base.json`, metering, suite/choreography receipts,
terminal boundaries, or `record.json`. There is therefore no record to run
through the schema and semantic validators and no product or harness evidence
to fabricate. The retained admission artifact and this report are the complete
evidence for the refused launch.

No product, harness, controller, driver, or validator code was modified.
