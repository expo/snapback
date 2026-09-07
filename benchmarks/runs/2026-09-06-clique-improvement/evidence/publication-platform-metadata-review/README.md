The publication metadata review first requested changes, then accepted the exact correction. This commit records that sequence; it changes no product source. Root separately landed the R1+R2 product delta at `c94a4783a`.

| Round | Source compared | Astra xhigh | Grok 4.6 xhigh | Actual native exits |
| --- | --- | --- | --- | --- |
| R1 | `7884642f` over `1bb06d521` | [REQUEST_CHANGES](r1/astra/review.md) | [READY](r1/grok/review.md) | Both 0; 387.797s / 892.943s |
| R2 | `f681a72ef` over `7884642f` | [READY](r2/astra/review.md) | [READY](r2/grok/review.md) | Both 0; 292.411s / 458.172s |

Each pair remained mutually blind until both actual processes closed. Native identities and terminals are retained per family. The actual Grok summary model is `grok-4.6` with `xhigh`; its separately reported usage alias is `grok-4.6-build`. Neither R2 reviewer ran optional verification. The complete unedited reports and final answers are included; their original internal paths remain historical, and the full packets linked below retain referenced artifacts omitted from this compact copy.

R1's controlling P2 was reproduced: staging removed an unrelated `snapback2-plugin@1.2.3` because it removed every `snapback2-*` optional dependency. Grok's READY on the current manifest did not test or refute that preservation counterexample. The [exact fixture source](r1/astra/scratch/preserve-optional.mjs), [before/after output](r1/astra/scratch/executions/01-counterexample.stdout.log), [failed assertion](r1/astra/scratch/executions/01-counterexample.stderr.log), and [actual exit-1 terminal](r1/astra/scratch/executions/01-counterexample.terminal.json) are retained. These historical fixture scripts are inspection evidence; their snapshot imports refer to the external original packets.

R2 uses the same exact supported-platform predicate for removing old platform entries and validating selected artifacts. It preserves `snapback2-plugin` and `snapback2-plugin-tools`, ordinary dependencies and peer metadata. Darwin-only, Linux-only and both-platform metadata selections remain represented; recognition does not qualify a binary. The [common prompt](r2/prompt.md), [workload](r2/workload.json), [98-leaf input manifest](r2/source-manifest.json), [completion](r2/completion.json), and [source integrity check](r2/source-integrity-at-closure.json) bind the scope and unchanged inputs. The two original packets had identical common prompt/workload/source leaves; that does not claim identical total provider contexts.

The [single affected publication self-test](affected-checks/publication-self-test.stdout.log) passed seven metadata tests plus existing self-tests under Node 24.18.0/npm 11.16.0: actual PID 79253, exit 0 in 6.440s. Its [launch](affected-checks/publication-self-test.launch.json) and [terminal](affected-checks/publication-self-test.terminal.json) retain the 60-second capture guard, distinct from unchanged 30-second test/consumer limits. Ref-check and diff-check also passed. This evidence landing ran no product tests or models.

The earlier failures and narrower successes remain separate:

- [Combined-platform installation](r1/astra/scratch/executions/02-counterexample.stderr.log) passed packed metadata validation but failed mandatory Linux tarball installation on Darwin with `EBADPLATFORM`. That inherited consumer limitation is not repaired by this correction.
- [Unresolved synthetic optional](r1/grok/scratch/executions/01-counterexample.stderr.log) was correctly preserved, then npm 11 ci failed with `Missing: unrelated@ from lock file`. Its first failure remains intact.
- [Host-only npm-pack/ci](r1/grok/scratch/executions/02-counterexample.stdout.log) subsequently passed without that unresolved optional. It remains a narrower result, not plugin installation or Linux qualification.

The fixtures cover metadata and a synthetic host-only exact lock. They do not qualify real binaries, full production/development packing, registry-only transitive acquisition, plugin installation or Linux runtime behavior. Historical 0.0.15 registry metadata and app/consumer locks remain unchanged. The earlier npm 10 workaround was an environment-only setup workaround, not an npm 11 pass or app acceptance.

R1 Grok read an unbound generic bundled review skill; the [observed provenance](r1/grok/provider-input-provenance.json) records that procedure deviation. R2 supplied the [complete known body](r2/provider-inputs/grok-bundled-review.SKILL.md) and bound its hash in [provider-inputs.json](r2/provider-inputs.json), with broader suggested actions explicitly outside scope. Grok again read the original provider path; its [actual observation](r2/grok/provider-input-observation.json) confirms the returned body exactly matched the bound copy. No additional provider workflow was authorized or observed.

The complete sealed external evidence remains available locally:

- [R1 review packet and closure](/Users/ccheever/clique-improvement/reviews/publication-platform-metadata-r1/REPORT.md), manifest SHA256 `626984d16678dc54863dca0253527fddddf663390d00d9bcd62c32ef53b07383`.
- [R2 review packet and closure](/Users/ccheever/clique-improvement/reviews/publication-platform-metadata-r2/REPORT.md), manifest SHA256 `3fbf5d52c503e2562aa47865e1e71eb322bb310215cc4c077e3912a86a7cb882`.
- [Corrected implementation and checks](/Users/ccheever/clique-improvement/revisions/publication-platform-metadata-r2/REPORT.md), manifest SHA256 `cb14855955a47736f198de5cde952ea492295e0890e45b0f819cbda501164734`.

`manifest.json` records byte hashes and exact external origins for the selected copies. Raw native transcripts, dependency caches and duplicated source trees stay outside this landing.
