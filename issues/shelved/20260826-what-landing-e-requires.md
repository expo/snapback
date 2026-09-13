# What landing E actually requires: 16 bundles, 0 satisfiable today

**Status:** open (living measurement)
**Produced:** 2026-08-26, read-only audit. No build, test, generator, attack, cold install, or
external review was executed.

LLP 0313 §8 states that **only landing E may report F-1 closed or publication unblocked**, and
describes E in a single sentence. This decomposes that sentence into a checklist so the remaining
distance is measurable rather than guessed.

**Headline:** E is **16 acceptance bundles**. On the present tree **0 of 16 can receive final E
credit**. At the machinery level, **4 have reusable end-to-end runners, 10 have partial substrate,
and 2 require a primary artefact or protocol that does not exist yet.**

The two that need something genuinely new are the ones to act on first, because both are blocked on
a **decision** rather than on landings B-D:

- **E-02, the 46-family ledger.** LLP 0291 enumerated the forgery families but carries **no per-family
  four-state disposition**. Nothing can be frozen until that exists.
- **E-16, independent integrated review.** **LLP 0313 does not define reviewer count, blindness,
  execution duty, reconciliation, or the signature artefact.** The protocol is simply absent — and this
  programme's own record shows why it matters: a reading reviewer and an executing reviewer have
  repeatedly caught *disjoint* defect classes on the same commit, and on one occasion the executing
  reviewer passed a witness that the reading reviewer showed was failing on a six-versus-seven argument
  mismatch.

Also load-bearing, and easy to miss: **`verify-local-proof --complete` is necessary but not
sufficient** — it does not run the row corpus, the cold clone, or the actual package cold install. And
of the 84 security-boundary attacks, **71 carry no row mapping and are protected by a debt digest
rather than disposition evidence.**

Every claim is labelled READ-CONFIRMED or INFERRED; preserve that distinction when quoting.

---

# Landing E checklist

**[INFERRED] Count:** landing E decomposes into **16 acceptance bundles**. On the present tree, **0/16 can receive final E credit; 16/16 remain blocked**. At the machinery level, **4/16 have reusable end-to-end runners, 10/16 have partial substrate, and 2/16 require a new primary artefact or protocol**.

**[READ-CONFIRMED]** No build, test, generator, attack, cold install, or external review was executed. The enforced read-only sandbox rejected creation of `/tmp/landingE.final.md`; no file was changed.

| ID | Requirement and satisfying evidence | Current state |
|---|---|---|
| E-01 | **[INFERRED] Zero-legacy/equivalent-effect gate:** a registry-driven scan over every required feature closure showing no old authority vocabulary, public evidence components, exposed/adoptable `LocalDatabase`, unregistered protected writer/effect, registry mismatch, or inherited creator-process origin. | **[READ-CONFIRMED] Partial.** The LLP 0284 gates cover public privilege seeds, raw SQLite, re-exports, discriminators, features and compilation-unit escapes. LLP 0313 requires substantial extensions. **[INFERRED] Blocked on A–D.** |
| E-02 | **[INFERRED] 46-family ledger:** each LLP 0291 family carries one four-state disposition, feature predicate, producer, consumer, returned authority, tables/columns, writer, replacement purpose and evidence links. | **[READ-CONFIRMED] Absent.** LLP 0291 contains no per-family four-state dispositions. LLP 0293 requires this frozen ledger. |
| E-03 | **[INFERRED] Row/effect ledger:** one normalized authoritative ledger covering aliases and the nine unrowed effects, with evidence for every disposition. | **[READ-CONFIRMED] Partial.** The issue records proposed targets for 132/133 programme units; F287 is unclassified. The issue expressly says targets are not closure. |
| E-04 | **[INFERRED] Effect-wide witnesses/maps:** an alternate producer→consumer execution for every family and row obligation; refusals prove protected rows unchanged, while acceptances prove exact columns, receipts and fences. | **[READ-CONFIRMED] Partial.** The standing corpus has 36 rows × four cells, 31 expected `CLOSED`, five expected `OPEN`, and 15 negative routes. It is deliberately nonblocking and absent from `verify-local-proof`. **[EXECUTION REQUIRED]** |
| E-05 | **[INFERRED] Race matrix:** every applicable purpose races revocation, expiry, generation/policy change, anchor rotation and fence terminalization inside the verification/write boundary. | **[READ-CONFIRMED] Partial.** Purpose-specific race tests exist, but no registry-derived all-purpose matrix exists. **[INFERRED] Blocked on C–D and the final purpose registry.** |
| E-06 | **[INFERRED] Fork matrix:** ordinary POSIX fork, registration races, exec/new-graph recovery, and Linux container-init `clone(CLONE_NEWPID)` must fail closed for inherited authority state. | **[READ-CONFIRMED] Partial and known-open.** F126 covers ordinary POSIX fork, but `process_bound_identity.rs` documents a `CLONE_NEWPID`-from-PID-1 fail-open. Durable store identity is also absent. **[EXECUTION REQUIRED on Linux.]** |
| E-07 | **[INFERRED] Second-/third-handle tests:** independent handles to one resource, stale state, reopen and cached-statement cases, with third-handle durable readback. | **[READ-CONFIRMED] Partial.** F170 remains `OPEN`; F182 now has a resource-owned reread witness. Two examples do not establish all-purpose coverage. |
| E-08 | **[INFERRED] Separate-process tests:** independently opened processes, stale pre-activation state, exec/new-graph controls, replay and post-terminal use, with bounded hang detection. | **[READ-CONFIRMED] Partial.** Process precedents exist, but no all-purpose/process matrix is registered. |
| E-09 | **[INFERRED] Authorizer-bypass matrix:** every protected object and SQL form—direct DML, `REPLACE`, triggers/views, schema changes, `writable_schema`, attached databases, dynamic SQL, cached statements, savepoints and wrong permits—must be refused; exact permitted writers must succeed. | **[READ-CONFIRMED] Partial.** LLP 0162’s connection-local authorizer is reusable substrate, but ordinary databases deliberately leave it unarmed and it is not LLP 0313’s AuthorityFacts authorizer. |
| E-10 | **[INFERRED] Ambiguity/reconciliation:** lost success response, rollback, post-write/pre-receipt failure, duplicate/conflicting retry, stale operation ID and receipt mismatch for every purpose. | **[READ-CONFIRMED] Partial.** Scattered tests exist; no purpose-derived coverage join exists. |
| E-11 | **[INFERRED] Fault injection:** verifier I/O, authorizer installation, nonce/permit poisoning or reuse, clock regression, anchor mismatch/rotation, SQL failure, HTTP cancellation/poisoning, process death and publication failure. | **[READ-CONFIRMED] Partial.** No final purpose×fault matrix exists. |
| E-12 | **[INFERRED] Regeneration:** regenerate from the integrated checkout, commit intentional outputs, obtain zero diff on a second pass, and pass generated-artifact, guide, schema/type, diagnostics and inventory checks. | **[READ-CONFIRMED] Runner exists.** Canonical regeneration machinery is present. **[INFERRED] Final run blocked on C–D.** |
| E-13 | **[INFERRED] Scoped qualification plus complete proof:** bind implementation, E gates, ledgers, verification maps, tests and review digest; reference the newest eligible complete battery green on claim-relevant gates. | **[READ-CONFIRMED] Runner exists.** `verify-local-proof --complete` covers LLP 0284 gates, regeneration, tests, builds and runtime qualification. It does not run the row corpus, cold clone, or actual package cold install. |
| E-14 | **[INFERRED] Cold checkout:** clean clone, documented dependency/bootstrap path, sealed binary build and runtime qualification, clean regeneration, production surface build and browser acceptance, with retained receipt. | **[READ-CONFIRMED] Runner exists.** `cold-clone-check.sh` provides most of this but does not create the clone itself and is All Aboard-specific. **[EXECUTION REQUIRED after D.]** |
| E-15 | **[INFERRED] External package cold install:** exact immutable tarballs installed into fresh external projects without workspace/symlink/source fallback, including packaged CLI/runtime, codegen, deploy/dev, React/browser and applicable Expo/scaffold evidence. | **[READ-CONFIRMED] Runner exists.** `snapback-package-cold-install.mjs` supports staged and public ledgers. **[INFERRED] Final semantics remain undecided.** |
| E-16 | **[INFERRED] Independent integrated review:** mutually blind semantic and executing reviews over the same content digest, followed by finding reconciliation, affected reruns and two READY signatures. | **[READ-CONFIRMED] Protocol absent.** LLP 0313 does not define reviewer count, blindness, execution duty, reconciliation or the signature artefact. |

## What the existing machinery proves

**[READ-CONFIRMED]** [`verify-local-proof --complete`](scripts/verify-local-proof:95) is necessary but insufficient. It contains the LLP 0284 gates, generators, workspace tests, builds and runtime-readiness proof. It runs cold-install harness unit tests, not the actual external cold-install ceremony.

**[READ-CONFIRMED]** [`check-security-boundaries.mjs`](scripts/check-security-boundaries.mjs:1) proves compiler refusal at the marked hostile expression and joins the privilege scanner. It does not run the row corpus.

**[READ-CONFIRMED]** LLP 0284 explicitly describes compiler fixtures as witnesses rather than coverage and admits that syn/metadata/rustc spans cannot prove body flow, verifier sufficiency or evidence-to-write correspondence.

**[READ-CONFIRMED]** The security-boundary inventory currently contains 84 attacks, only 13 carrying row mappings; 71 unmapped attacks are protected by a debt count/digest rather than disposition evidence.

**[READ-CONFIRMED]** [`run-row-attacks.mjs`](scripts/run-row-attacks.mjs:54) executes producer-to-effect compositions and rejects failures away from `@attack`. Its code specifically records the stale-arity/mechanical-failure danger that affected F145.

**[READ-CONFIRMED]** [`cold-clone-check.sh`](scripts/cold-clone-check.sh:1) and [`snapback-package-cold-install.mjs`](scripts/snapback-package-cold-install.mjs:1) are complementary: the former proves a clean checkout/runtime and one production surface; the latter proves a genuinely external package consumer.

**[READ-CONFIRMED]** Previous successful runs validate those runners but cannot prove future D/E content. The repository’s own F-3 record requires rerunning them after F-1.

## All-family/row dispositions

**[READ-CONFIRMED]** LLP 0313 §10 literally requires a disposition for every row. Landing E separately says “all-family/row dispositions,” while §9 requires an alternate-route witness for every LLP 0291 family and inventory row.

**[INFERRED]** E therefore requires both instruments: a family ledger and a row/effect ledger. Families are end-to-end forgery routes; rows are declaration/effect inventory units. Neither substitutes for the other.

**[INFERRED] Ambiguity:** LLP 0313 does not say whether one cross-mapped execution may discharge a family and several rows, nor whether “row” means 135 historical spellings, 124 normalized row-derived units, or 133 programme units including unrowed effects.

| Population | Current proposed four-token assignment |
|---|---:|
| LLP 0291 forgery families | **[READ-CONFIRMED] 0/46** |
| Historical spellings after the later additive row | **[READ-CONFIRMED] 134/135** |
| Normalized row-derived units | **[READ-CONFIRMED] 123/124** |
| Normalized programme units including nine unrowed effects | **[READ-CONFIRMED] 132/133** |

**[READ-CONFIRMED]** The 133-unit table is 47 `DELETED`, 67 `ABSORBED`, three `POWERLESS`, 15 `OUTSIDE-AUTHORITY-CREATION`, and one `UNCLASSIFIED` ([acceptance ledger](issues/shelved/20260826-row-acceptance-ledger-62-units-remain.md:26)).

**[READ-CONFIRMED]** These are inferred final-state targets, not current closure. The three `POWERLESS` rows F006/F096/F242 require execution. F287 requires cross-engine/connection/issuer execution to select `POWERLESS` or `ABSORBED(AcknowledgeInvalidationManualRetry)`.

**[READ-CONFIRMED]** The current row JSON contains 36 attacks, 31 expected closed and five expected open: F170, F053, F145, F272 and F318. **[INFERRED]** Those static expectations do not constitute final chokepoint closure, and they were not executed in this audit.

## Independent review required at E

**[READ-CONFIRMED]** The programme has shown disjoint review strengths. In the process-identity work, reading accepted a round whose execution exposed a post-fork hang; later reading exposed the Linux PID-namespace case that macOS execution could not observe ([fork issue](issues/shelved/20260826-allocation-identity-fails-open-across-fork.md:121)).

**[READ-CONFIRMED]** F170 and F182 were both recorded closed before alternate second-handle executions reached their effects. The repaired F182 fixture now rereads resource-owned state; the defect class remains relevant.

**[INFERRED]** A sufficient E review needs:

1. **[INFERRED] A blind semantic reviewer** who authored neither implementation nor gates. They reconcile all 46 families and 133 units to exact purposes, mutations, verification maps, SQL/write sets, producers and consumers; inspect transaction ordering, durable predecessors, equivalent effects and all feature closures; perform mutation review; and audit the qualification digest.

2. **[INFERRED] A blind executing reviewer** who independently runs hostile compositions across the approved feature/platform cells, including at least one alternate route not copied from the implementer. They validate fixture setup, exact failure location, unchanged durable state, accepted receipts, races, handles, processes, Linux fork namespaces, authorizer cases, ambiguity and fault injection.

3. **[INFERRED] A reconciliation pass** in which every disagreement and defect is dispositioned, semantic changes receive affected re-review/re-execution, and both reviewers sign the same content/evidence digest.

**[READ-CONFIRMED]** LLP 0189 D-5 allows reviews to bind content rather than a perpetually moving HEAD. Normal advancement of `main` does not invalidate them unless semantic conflict-resolution work changes the reviewed content.

**[INFERRED] Ambiguity:** LLP 0313 currently says only “independent review.” The two-mode shape above is necessary given the programme record, but it is not yet normative.

## Critical path

**[READ-CONFIRMED]** LLP 0313 remains `Draft` pending an owner decision on §11 ([LLP 0313](llp/0313-authority-creation-chokepoint.spec.md:30)).

**[READ-CONFIRMED]** The proposed `storage/authority_transition` implementation, `KernelVerifiedEvidence` and LLP-0313 `PreparedOperation<Kind>` are absent. Public `ServingDatabase::adopt`, `auth_database_mut`, `Deref`, and `LocalDatabase::memory/open` remain.

**[INFERRED]** A has not landed in the LLP 0313 form; therefore B–D have not landed in that form either.

### Can be done now

**[INFERRED]** No E item can receive final credit now. The programme can nevertheless:

- **[INFERRED]** Ratify §11 and settle the decisions below.
- **[INFERRED]** Freeze the family/row crosswalk and review artefact schemas.
- **[INFERRED]** Execute F006/F096/F242/F287.
- **[INFERRED]** Build fail-first E gates and matrices.
- **[INFERRED]** Fix and execute the known Linux namespace fork case.
- **[INFERRED]** Define the LLP 0189 D-4 claim scope and reviewer signatures.
- **[INFERRED]** Run existing complete/cold machinery for informational runner validation.

### Depends on B–D

**[INFERRED]** E-01 cannot go zero before B–D.

**[INFERRED]** Resource races, handles, the permanent authorizer, ambiguity and most fault injection require C.

**[INFERRED]** Effect-wide in-memory witnesses, process transfer and publication fences require D.

**[INFERRED]** Regeneration, final qualification, cold runs and review must operate on the integrated D content.

### Decisions nobody has made

1. **[READ-CONFIRMED] Acceptance authority:** accept or reject LLP 0313 §11 and its supersessions.

2. **[READ-CONFIRMED] Publication posture:** LLP 0283 contains a standing author ruling allowing publication while F-1 remains open, with disclaimers. LLP 0313 is a later Draft saying only E may unblock publication. **[INFERRED]** Publication is currently permitted under LLP 0283; E-only blocking is not operative until the owner explicitly changes that ruling.

3. **[INFERRED] Denominator/evidence cardinality:** choose 135 spellings, 124 normalized rows or 133 programme units, require the 46-family crosswalk, and define evidence sharing.

4. **[READ-CONFIRMED] Purpose registry and rehearsal:** LLP 0313 does not name the exact purpose/mutation variants. The ledger says delete F202 rehearsal authority while LLP 0313 retains derived non-production rehearsal; the ledger records 43 affected files.

5. **[INFERRED] Outside-scope semantics:** decide whether the 15 `OUTSIDE-AUTHORITY-CREATION` dispositions are sufficient for F-1 while their product defects remain. If so, unresolved Q13 billing does not block F-1.

6. **[INFERRED] Matrix closure:** freeze protected SQL forms, purpose×race/fault/ambiguity axes, feature cells, platforms, process variants and timeout/refusal rules.

7. **[INFERRED] Cold-install semantics:** staged versus public proof, package set and platforms. Requiring public-registry proof before the publication it enables is circular; the coherent ordering is staged proof before publication and public proof afterward.

8. **[INFERRED] Review/claim protocol:** reviewer independence, mutual blindness, executing duty, reconciliation receipt, D-4 scope and re-review rules.

## The honest distance

**[INFERRED]** There is no defensible single scalar remaining-work count. Four separate dimensions are measurable:

| Dimension | Current count |
|---|---:|
| Atomic implementation packages before E | **[READ-CONFIRMED] 4: A → B → C → D** |
| Row/effect outcomes | **[READ-CONFIRMED] 47 deleted, 67 absorbed, 3 powerless, 15 outside, 1 unsettled** |
| Family/row acceptance identities | **[INFERRED] 46 + 133 = 179 identities** |
| E acceptance bundles | **[INFERRED] 0/16 final-creditable** |
| Unresolved acceptance/policy decisions | **[INFERRED] 8** |

**[INFERRED]** The ledger’s “62 independent units” is not the distance to E:

- **[READ-CONFIRMED]** It consists of 47 deletion units plus 15 outside-authority units, with F287 creating a 62–63 range.
- **[INFERRED]** If `OUTSIDE-AUTHORITY-CREATION` is a genuine nonblocking disposition, those 15 need classification, not F-1 implementation.
- **[INFERRED]** The 67 absorbed units remain mapping, verifier/writer integration and acceptance-proof obligations.
- **[READ-CONFIRMED]** The 47 deletions belong to atomic A–D groups rather than 47 independently dispatchable tasks.
- **[INFERRED]** The ledger assigns no cost to the private core, registries, authorizer, store identity/anchor, prepared operations, consumer reconnection, E gate extensions, platform matrices, cold evidence or dual review.

**[INFERRED] Conditional arithmetic:** if every family and normalized programme unit required a distinct witness, and each current row attack credited only its row, `46 + (133 − 36) = 143` witness slots would be unrepresented. That is not a measured remainder because sharing and cross-mapping are undecided.

**[INFERRED] Dependency structure:**

```text
8 decisions
   ├── settle 3 POWERLESS probes and F287
   ├── freeze the 46-family / 133-unit crosswalk and matrices
   └── A → B → C → D
                    ├── zero/effect gates and family/row proof
                    ├── race/fork/handle/process/authorizer/fault matrices
                    ├── regeneration, scoped qualification, complete battery
                    ├── cold checkout and staged package install
                    └── blind reading review || blind executing review
                                             └── reconcile, rerun, two READY signatures
                                                  └── E / F-1 closure
```

**[INFERRED]** The unbounded part is specific: until the purpose registry, evidence-sharing rule and matrix axes are fixed, the counts of verification maps, alternate-route executions, race cells, authorizer cases and per-lane fault injections cannot be derived.

**[INFERRED] Bottom line:** the honest distance is **four unlanded atomic implementation packages containing at least 47 deletion outcomes, followed by 16 integrated E acceptance bundles, against a 46-family/133-unit acceptance join, with eight prerequisite decisions**. It is not 62 units, and no total becomes bounded until the owner fixes E’s evidence cardinality, purpose registry, platform matrix, review protocol and publication semantics.