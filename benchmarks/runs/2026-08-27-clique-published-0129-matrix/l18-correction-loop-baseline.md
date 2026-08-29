# LLP 0317.000 L18 retrospective correction-loop baseline

**Recorded:** 2026-08-29

**Backend:** published Snapback 0.1.29

**Retained instrument:** `social-messenger@0.3.4-m8`

**L17-fixed instrument:** `social-messenger@0.3.6-m8`

**Machine record:** [`l18-correction-loop-baseline.json`](./l18-correction-loop-baseline.json)

## Result and claim boundary

The retained matrix establishes an **existence-only floor** of 22 certified
correction loops across four usable cells. A certified loop has all three facts
required by [`benchmarks/protocol.md`](../../protocol.md): a done-claim or tool
success, contrary evidence, and a revision of already-produced work. Retries
against the same defect are folded into one row.

The number 22 is the count of the evidence rows below, **not an exhaustive
lane total and not a magnitude baseline**. The historical logs were not emitted
by a protocol-aware loop recorder, so absence of another auditable triad cannot
be turned into zero. Total loop count is therefore inapplicable for every cell.
Attribution is re-adjudicated under the protocol and LLP 0317 disposition;
lane self-labels remain evidence, not authority. The Grok Explicit unexplained
owner loss stays `ambiguous` because no causal terminal receipt was retained.

| Cell | Certified existence loops | Snapback defect | Agent error | Environment | Ambiguous | Cell posture |
|---|---:|---:|---:|---:|---:|---|
| Sol × Explicit | 13 | 5 | 6 | 2 | 0 | usable for listed-loop existence only |
| Sol × Familiar | 4 | 2 | 2 | 0 | 0 | usable for listed-loop existence only |
| Grok × Explicit | 4 | 1 | 2 | 0 | 1 | usable for listed-loop existence only |
| Grok × Familiar | 1 | 1 | 0 | 0 | 0 | usable for listed-loop existence only |
| Terra × Explicit | — | — | — | — | — | inapplicable: 220-second non-signal; score misidentifies model |
| Terra × Familiar | — | — | — | — | — | inapplicable: 348-second non-signal |
| GLM × Explicit | — | — | — | — | — | inapplicable: conflicting lane identity/owners/depth; no score record |
| GLM × Familiar | — | — | — | — | — | inapplicable: observer-only mirror; no score record |
| **Certified rows** | **22** | **9** | **10** | **2** | **1** | existence only |

An em dash means inapplicable, not zero.

The Sol Explicit log retains a stale Grok lane/model string in its first lines.
The sealed matrix record plus that directory's `scores.json`, diary, and final
report resolve it as Sol Explicit; the machine record discloses this provenance
repair. The GLM logs lack an equivalent complete machine record and also
disagree with the sealed terminal depth, so their conflicts are not resolved by
analogy.

## Instrument confound and residual gate

The retained cells ran `social-messenger@0.3.4-m8`. L17 changed the instrument
to `social-messenger@0.3.6-m8`: `0.3.5-m8` repaired the M3 Dave precondition,
restored the scale fixture, and added the choreography self-test, while
`0.3.6-m8` repaired the frozen choreography-root identity after the first
Wave 5 launch found the 0.3.5 digest stale. Retrospective annotation cannot
remove that confound.

Before any comparative claim, run fresh published-0.1.29 cells under 0.3.6 with
the same model, effort, profile, and platform conditions. A “fewer loops” or
ordering claim additionally requires N≥8 per configuration unless a
variance-transfer rule was preregistered. Until then this record supports only
the statement that the listed obligations produced at least one qualifying
loop in the retained evidence.

## Certified loop evidence

The link triplets are done → contrary → revision. Folded retry locators are
retained in the machine record.

### Sol × Explicit

| ID | Phase | Attribution | Cause | Evidence |
|---|---|---|---|---|
| sol-explicit-01 | M1 | agent-error | O2 child port escaped declared range | [done](./lanes/sol-snapback-explicit/run-log.md#L26) → [contrary](./lanes/sol-snapback-explicit/run-log.md#L27) → [revision](./lanes/sol-snapback-explicit/run-log.md#L28) |
| sol-explicit-02 | M1 | agent-error | N5 post-login route expectation | [done](./lanes/sol-snapback-explicit/run-log.md#L48) → [contrary](./lanes/sol-snapback-explicit/run-log.md#L50) → [revision](./lanes/sol-snapback-explicit/run-log.md#L52) |
| sol-explicit-03 | M2 | snapback-defect/defect | F1 Metro generation-watcher race | [done](./lanes/sol-snapback-explicit/run-log.md#L63) → [contrary](./lanes/sol-snapback-explicit/run-log.md#L64) → [revision](./lanes/sol-snapback-explicit/run-log.md#L65) |
| sol-explicit-04 | M2 | snapback-defect/defect | O26 codegen/runtime media capability skew | [done + contrary](./lanes/sol-snapback-explicit/run-log.md#L80) → [revision](./lanes/sol-snapback-explicit/run-log.md#L81) |
| sol-explicit-05 | M2 | environment | N8/N9 RNW semantics and retained Router surface | [done](./lanes/sol-snapback-explicit/run-log.md#L93) → [contrary](./lanes/sol-snapback-explicit/run-log.md#L90) → [revision](./lanes/sol-snapback-explicit/run-log.md#L92) |
| sol-explicit-06 | M3 | agent-error | N2 wrong shared choreography credentials | [done](./lanes/sol-snapback-explicit/run-log.md#L111) → [contrary](./lanes/sol-snapback-explicit/run-log.md#L113) → [revision](./lanes/sol-snapback-explicit/run-log.md#L114) |
| sol-explicit-07 | M3 | snapback-defect/defect | O7 warm-offline bootstrap did not recover | [done + contrary](./lanes/sol-snapback-explicit/run-log.md#L122) → [revision](./lanes/sol-snapback-explicit/run-log.md#L123) |
| sol-explicit-08 | M3 | agent-error | O20 navigation abandoned membership mutation | [done](./lanes/sol-snapback-explicit/run-log.md#L111) → [contrary](./lanes/sol-snapback-explicit/run-log.md#L124) → [revision](./lanes/sol-snapback-explicit/run-log.md#L126) |
| sol-explicit-09 | M4 | snapback-defect/defect | O14 reaction live invalidation | [done](./lanes/sol-snapback-explicit/run-log.md#L135) → [contrary](./lanes/sol-snapback-explicit/run-log.md#L145) → [revision](./lanes/sol-snapback-explicit/run-log.md#L148) |
| sol-explicit-10 | M4 | environment | N10 reaction chip/observer tree mismatch | [done](./lanes/sol-snapback-explicit/run-log.md#L135) → [contrary](./lanes/sol-snapback-explicit/run-log.md#L150) → [revision](./lanes/sol-snapback-explicit/run-log.md#L151) |
| sol-explicit-11 | M5 | agent-error | N10/N11/O20 retained-state choreography bundle | [done](./lanes/sol-snapback-explicit/run-log.md#L165) → [contrary](./lanes/sol-snapback-explicit/run-log.md#L167) → [revision](./lanes/sol-snapback-explicit/run-log.md#L169) |
| sol-explicit-12 | M6 | agent-error | O21 offline transition blanked composer | [done](./lanes/sol-snapback-explicit/run-log.md#L186) → [contrary](./lanes/sol-snapback-explicit/run-log.md#L189) → [revision](./lanes/sol-snapback-explicit/run-log.md#L190) |
| sol-explicit-13 | M8 | snapback-defect/defect | O17/O24 same-principal convergence | [done](./lanes/sol-snapback-explicit/run-log.md#L203) → [contrary](./lanes/sol-snapback-explicit/run-log.md#L215) → [revision](./lanes/sol-snapback-explicit/run-log.md#L216) |

### Sol × Familiar

| ID | Phase | Attribution | Cause | Evidence |
|---|---|---|---|---|
| sol-familiar-01 | M1 | snapback-defect/defect | F1 Metro generation-watcher race | [done](./lanes/sol-snapback-familiar/run-log.md#L26) → [contrary](./lanes/sol-snapback-familiar/run-log.md#L29) → [revision](./lanes/sol-snapback-familiar/run-log.md#L31) |
| sol-familiar-02 | M2 | agent-error | N9 profile route lacked persistent tabs | [done](./lanes/sol-snapback-familiar/run-log.md#L86) → [contrary](./lanes/sol-snapback-familiar/run-log.md#L87) → [revision](./lanes/sol-snapback-familiar/run-log.md#L88) |
| sol-familiar-03 | M3 | snapback-defect/defect | O14/O15 settled write absent from same live hook | [done + contrary](./lanes/sol-snapback-familiar/run-log.md#L112) → [revision](./lanes/sol-snapback-familiar/run-log.md#L113) |
| sol-familiar-04 | record | agent-error | first-green wall misreported | [done](./lanes/sol-snapback-familiar/run-log.md#L44) → [contrary + revision](./lanes/sol-snapback-familiar/run-log.md#L147) |

### Grok × Explicit

| ID | Phase | Attribution | Cause | Evidence |
|---|---|---|---|---|
| grok-explicit-01 | M1 | agent-error | O2 child port escaped declared range | [done](./lanes/grok-snapback-explicit/run-log.md#L14) → [contrary](./lanes/grok-snapback-explicit/run-log.md#L15) → [revision](./lanes/grok-snapback-explicit/run-log.md#L16) |
| grok-explicit-02 | M3 | ambiguous | O6 lifecycle owner disappeared without a causal receipt | [done](./lanes/grok-snapback-explicit/run-log.md#L16) → [contrary](./lanes/grok-snapback-explicit/run-log.md#L35) → [revision](./lanes/grok-snapback-explicit/run-log.md#L50) |
| grok-explicit-03 | M3 | agent-error | O14/O35 live query went empty | [done + contrary](./lanes/grok-snapback-explicit/run-log.md#L40) → [revision](./lanes/grok-snapback-explicit/run-log.md#L52) |
| grok-explicit-04 | M3 | snapback-defect/defect | O7/O21 offline receipt recovery | [done](./lanes/grok-snapback-explicit/run-log.md#L40) → [contrary + revision](./lanes/grok-snapback-explicit/run-log.md#L53) |

### Grok × Familiar

| ID | Phase | Attribution | Cause | Evidence |
|---|---|---|---|---|
| grok-familiar-01 | M4–M8 | snapback-defect/defect | O33 generate removed application-ready | [done](./lanes/grok-snapback-familiar/run-log.md#L32) → [contrary + revision](./lanes/grok-snapback-familiar/run-log.md#L37) |

## LLP 0201 registered-field coverage

Milestone status and first-green event timestamps are retained for the four
usable cells. Sol Familiar also explicitly records corrected M1 authoring wall,
M2 authoring wall, and M3 terminal wall. Sol Explicit explicitly records its
scale replay clock and excluded probe wall.

All other per-milestone wall phases, every token phase, aggregate authoring
clocks, grading clocks, and M7 clocks are inapplicable because the retained
harness did not stamp them or the phase did not run. Event timestamps and total
run wall are not reconstructed into missing phase metrics. Exact field-level
values and reasons are in the machine record.
