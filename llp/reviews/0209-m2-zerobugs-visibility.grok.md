# LLP 0209 arc, lane M2 — grok review record (zerobugs-control visibility declaration)

**Change:** behavior-preserving `public-read` declarations + identity-only corpus re-freeze (landed on main as `db1574a9c..06e6b4a6b`, 2026-08-24)
**Reviewer:** grok-4.6, xhigh, blind
**Orchestrator:** Claude Fable 5 (session 01VKza4iiZ918TtDxobNDvvy); measurement-tail prerequisite of `issues/20260824-llp0209-g3-commission.md`
**Provenance:** the review below was actually received from the named model; verbatim (including streamed narration preamble).
**Disposition:** r1 VERDICT: READY.

## r1

I'll review the three-commit series read-only: first the diffs, governing docs, and identity/enforcement evidence, then I'll judge the orchestrator ruling against the required checks.Commits are isolated on a clean branch. Next I’ll pull the range diff, tickets, and the LLP/enforcement context.Schema looks like the intended 23-table `public-read` add. Next I’ll check identity hashes, generated artifacts, and whether table visibility is actually enforced at read time.The corpus hashes that moved sit under the broadcast fixture, not the control schema — I’m checking whether the freezer updated the wrong identity.Checking one custody-enforcement path and the nested gitignore interaction, then I’ll write the verdict.## Review — M2: zerobugs-control visibility declaration + identity re-freeze

Range `c2371f43f^..70bfbe23b` (`8e9086c73` → `70bfbe23b`). Three commits, working tree clean. Independent read-only review.

### Orchestrator ruling

**Sound as a frozen-instrument exception, not as general policy.** This is a policy call, not a defect.

LLP 0231 D2’s fail phase refuses omitted table policy at generation (`packages/snapback-codegen/index.mjs:3092–3101`). The public-read remediation text there says not to declare `public-read` merely to unblock generation. That is the right default for a new app. It is the wrong default for the LLP 0182/0183 D1 control: the last successful implicit posture already lowered to unrestricted reads at the data layer, and honest-narrowest would change the parity instrument.

The series does the thing the diagnostic warns against, **and records that fact**: schema comment at `demos/zerobugs/control/snapback/schema.mjs:10-13`, incident update still **Open**, follow-up `issues/20260824-zerobugs-control-honest-narrowest-visibility.md` with per-table evidence. That is the honest shape.

---

### (a) Behavior preservation is proven, not asserted — **holds for the corpus file**

Deep compare of `tests/conformance/graph/corpus.v1.json` parent vs HEAD: **exactly five leaf diffs**.

| Field | What moved |
|---|---|
| `broadcastFixture.schema.schemaHash` | identity |
| `broadcastFixture.schema.inputsHash` | identity |
| `broadcastFixture.functionManifest.bundleHash` | identity |
| `broadcastFixture.functionManifest.inputsHash` | identity |
| `contentDigest` | hash of the rest |

Result bytes, completeness labels, proof classes, refusal reasons, and proof objects are byte-identical. Recomputed `contentDigest` with the freezer’s `canonical()` matches the stored value (`sha256:9549fa1f…`). `bound-derivation.v1.json` is not in the diff, which is what a freezer rewrite produces when bounds are identical.

**Caveat (see MINOR-1 and (k)):** those identity hashes are the **broadcast fixture**, not the control schema. Control graph identities in the corpus remain placeholders (`corpus-schema-v1`). Broadcast `authoredSourceHash` is unchanged while `schemaHash`/`inputsHash`/`bundleHash` moved, with stored table JSON byte-identical — so the freeze is identity-only on observables, but the identities that rotated are not the control’s.

### (b) Repository-pinned freezer — **holds**

`requestedFixtures` is exactly the freezer default (`demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:46-50`):

```148853:148857:tests/conformance/graph/corpus.v1.json
  "requestedFixtures": [
    "normal-seed-v1",
    "large-seed42-v1",
    "hot-recent-v1"
  ],
```

Not a narrowed spelling.

### (c) Schema change is minimal — **holds**

- 23 `defineTable` exports, 23 `.visibility({ kind: 'public-read' })` lines, nothing else on the table chains except wrapping `.membership({` so visibility can sit in front (`schema.mjs:185-186`).
- `functions.mjs` diff is empty.
- Generated `artifacts.json` is the only tracked generated file (`demos/zerobugs/control/.gitignore:9-10`). Summary reports `declared: 23`, `implicit: 0`, `publicRead: 23`. Regeneration command on file records is `snapback generate snapback --target-profile local-dev-sqlite-ibex`, i.e. the canonical path (control `package.json` generate script is `SNAPBACK_OUTBOUND_ACTIONS=1 snapback generate snapback`).
- `artifacts.json` also grew current-codegen fields (`identities`, `authoredSourceHash`, `tableVisibility`, write-posture advisories, 184→138 file inventory). That is generate-format catch-up after D2 made the previous pin unregenerable, not an extra schema mutation.

### (d) No shipped-surface / capability change — **holds**

No `packages/` edits. `guide/capabilities.md` `auth.table-visibility` row unchanged. Guide edits are the live snippet from `schema.mjs` plus the generated guide chain (`guide-manifest`, flats, diagnostics-registry `sourceDigest` — that digest hashes all non-reference `guide/**/*.md`, so the snippet page change is expected). Control is repo-internal.

### (e) Ticket honesty — **holds**

- Incident ticket remains **Open**, acceptance bullets are not checked off, and it does not claim zb5 passed — only that generate now succeeds and the corpus re-freeze was identity-only.
- Follow-up is **Open — author decision required**. All 44 `functions.mjs:N` citations resolve and name the right handlers (spot-checked `assertIssueVisible` 262–271, `fixtureInspectTable` 714–730, `lane4StateAudit` 2319–2353, `searchMembership` 3044–3087, notification operator guards 4542–4703, asset gateway 4441–4463).
- Schema identity cited in the incident ticket (`127729d9…` → `fbfb92e0…`) matches parent/HEAD `artifacts.json`, not the corpus (correct: those are different apps).

### (f) Identity fallout — **holds for the listed pins; see MINOR-2**

Old control schema identity `127729d9…` remains only as historical text in the incident ticket. New identity `fbfb92e0…` is in `artifacts.json` and the gitignored generated tree. Graph corpus never embedded the control schema hash. Relational corpus has no zerobugs identity. Inventories that embed the snippet/diagnostics were regenerated together.

---

### (j) Does `public-read` change any enforced read path?

**No.** At the current shipped enforcement state, omitted and `PublicRead` compile to the same data-layer predicate: **no restricted table policy**.

`TableVisibilityV1::is_restricted` is `!PublicRead` (`crates/snapback-types/src/manifest/types.rs:1280-1282`). Ordinary `ctx.db` composition then stores only the restricted form:

```1997:2016:crates/snapback-engine/src/runtime/host_glue.rs
        let expected = declared
            .as_ref()
            .filter(|visibility| visibility.is_restricted())
            .cloned();
        // ...
        plan.table_visibility = expected;
```

The same filter is used for composed relational/bounded/snapshot surfaces (`crates/snapback-kernel/src/storage.rs:8356-8361`, `crates/snapback-engine/src/local/engine.rs:38963-38967`). The composed-plan validator documents the identity explicitly: “Public read is normalized to `None`, exactly as for a single-table `QueryPlan`” (`engine.rs:34787-34799`). Graph admission treats omitted as `PublicRead` (`engine.rs:35162-35165`). Graph query lowering drops `PublicRead` off the `QueryPlan` (`crates/snapback-engine/src/graph_evaluator.rs:846-847`).

So:

- vs the last successful implicit generate: **neither weaker nor stronger** at the data layer.
- vs the handler boundary: the data layer **remains weaker** than `assertIssueVisible` / owner checks / crew leases for private tables. That was already true under implicit. Handler narrowing is still the real boundary. `ctx.db.elevated` is unchanged.

D2’s fail phase is a **generation** fence (`index.mjs:3095-3100`), not a new row filter.

### (k) Weakest link in the behavior-preservation proof

The lane checksums do **not** execute the control schema through the engine.

1. Oracle bytes come from `mockContext` (`freeze-graph-g0-corpus.mjs:96-122`), an in-memory table scan with **no** `compose_declared_table_visibility`.
2. Graph declarations are codegen’d from `tests/conformance/graph/zerobugs/schema.mjs`, which **already** had `public-read` and is not this series’ schema. Control identities in the corpus are placeholders (`freeze-graph-g0-corpus.mjs:763`).
3. Large/hot G0 exit observations remain `NOT SATISFIED` (`corpus.v1.json:148822+`); those fixtures cannot move a checksum that was never recorded.
4. Served observations are reused only when `graphPlanHash` matches; plan hashes did not move.

The observable that could have changed **without** any of those checksums moving is therefore a **live control read that does not go through the mock oracle**: generated JS `ctx.db` under the engine (independently shown equivalent), generated direct/live HostPlans served to clients, `.sync()` replicas, asset gateway, and zb5 `startScaleServer`. Independently, those row sets should not move because PublicRead ≡ omitted for restricted-policy composition.

The **un-refuted** weakest leftover is not a row set: it is anything that treats **explicit** `PublicRead` as a distinct declared fact from omission — authorization-review / write-posture projections (`artifacts.json` warnings 2 → 122), and the published identity-binding snippet.

---

## Findings

### MATERIAL

None.

### MINOR

**MINOR-1 — Corpus identity motion is broadcast hasher drift, not control schema.**  
`broadcastFixture.schema` tables, including existing `visibility` blocks (`corpus.v1.json:126-128`, `167-170`), are byte-identical; `authoredSourceHash` is unchanged; `schemaHash`/`inputsHash`/`bundleHash` still moved. `schemaHash` is framed over isolated schema-evaluation items (`packages/snapback-codegen/index.mjs:7717-7738`), not over the stored JSON. Re-running the pinned freezer rotated a neighboring app’s identity without a source change. Observables still identity-only; the ticket’s “control identity moved, corpus followed” story is slightly misaligned.

**MINOR-2 — Nested custody gitignore still drops newly consumer-committed review leaves.**  
HEAD `artifacts.json` marks `authorization-review.json` and `elevated-read-site-baseline.json` `consumer-committed` (2 files; `review-surface.mjs:127-129` says the authorization projection cannot be demoted). Root `.gitignore:19-22` un-ignores those for `demos/*/snapback/generated/`. The nested control gitignore (`demos/zerobugs/control/.gitignore:9-10`) still only excepts `artifacts.json`. Intentional nested-demo exception, and `agent_safe_publication_checker_v1.mjs` does not list this path — but this is the first successful generate under current codegen, so the review manifest now claims committed files git will not take. Does not block zb5 (`zb5-large.mjs` imports `api.mjs` via cache restore).

**MINOR-3 — Pre-existing composition release pin remains stale.**  
`demos/zerobugs/control/composition/zerobugs-control-composition.v1.json:227-233` still pins `schemaHash …0ff7735e…`. zb0 `verifyGeneratedReleaseIdentity` (`zb0.mjs:542-548`) and `composition/server.mts:904-910` require equality with `artifacts.json`. That pin was already stale vs parent `127729d9…`; it is still stale vs `fbfb92e0…`. zb5 `startScaleServer` (`zb5-scale-support.mjs:84-107`) does not consult it. Out of this lane’s zb5-import failure mode; still a live identity consumer that will fail zb0/gateway.

**MINOR-4 — Published identity-binding example now shows `public-read`.**  
`guide/auth/app-identity-binding.md:70-81` copies the control declaration. The caveat paragraph is accurate. Copy-paste still teaches the compatibility posture unless the reader hits the warning. Not a capability-index change.

### REFUTED-RISK

**REFUTED — Ruling unsound because public-read weakens the data layer vs handlers / vs implicit.**  
See (j). Omitted already lowered to unrestricted reads. Public-read is the explicit spelling of that default, not a new hole. Honest-narrowest would *introduce* data-layer narrowing the D1 instrument never had. The follow-up ticket is the right remainder, not a reason to reject this landing.

**REFUTED — Green-but-stale pin of the old control identity `127729d9…`.**  
Repo search finds that digest only in the incident ticket’s before/after record. Live `artifacts.json` carries `fbfb92e0…`.

**REFUTED — Write-posture advisory flood (warnings 2 → 122) is a generate refusal or a shipped-policy change.**  
`SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING` is a `migrationAdvisories` row, not a D2 error. Generate produced `artifacts.json` with `ok` implied by a written review manifest. Separate closed-track work (`issues/20260816-write-posture-migration-closure.md`).

---

VERDICT: READY
