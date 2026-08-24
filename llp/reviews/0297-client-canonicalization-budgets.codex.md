# LLP 0297 review artifact — codex family

One dated section per round. Bodies are persisted verbatim on receipt and
never edited. Provenance per LLP 0005.

## Round 1 — 2026-08-24

- Reviewer: codex `gpt-5.6-sol` @ ultra (`codex exec --skip-git-repo-check
  -m gpt-5.6-sol -c model_reasoning_effort=ultra -s read-only`), cwd =
  `scratchpad/0297-loop/capsule-r1/`. Effort header verified in the run log:
  `model: gpt-5.6-sol` / `reasoning effort: ultra` (Codex v0.149.1, session
  01a032b8-92ff-79c2-8a88-22a9b1644c6b, 130,514 tokens).
- Target revision (r1, sha256):
  `1071a9e61b92eeab6bba045c38f9cd7a3122ee0445cc2a2c3f68fd7a272fc131`
- Capsule hash:
  `d40352a7ca34ffdfb31992ab710e3b3552ec38bd0ab07570b983d8008076c4a1`
- Instruction hash (`CAPSULE.md`):
  `265c97d0cf15307b845577dd9179c3c0363329b4e069a7f59a3470118f34ba31`
- Blindness: structural (capsule contains no review artifacts, journal, or
  orchestrator notes); sealed from the grok review until both landed.
- Received 2026-08-24 00:53 (exit 0); the delayed orchestrator wake-up was a
  harness scheduling artifact, not a runner failure. Persisted verbatim
  below.
- Verdict: **NOT READY** (M1–M4, m1–m3).

### Verbatim body

# Independent review of LLP 0297

## Overall assessment

The Research correctly establishes three points: caller-authored identity needs a finite guard; the generated-app boot failure is a category/diagnostic error; and dynamic results need better user-facing vocabulary than “invalid arguments.”

It does not yet establish its substantive Option C recommendation. In particular, it has not proved that results need another whole-value canonicalization profile, nor that LLP 0114’s 65,536-node receipt profile is the right contract for every generated `AppDescriptor` or hydrated API catalog.

## MATERIAL concerns

**M1 — The result half of Option C rests on unverified evidence and an unknown invariant.**

The only `viewerState` evidence is outside the repository and cannot be checked in this capsule (`CAPSULE.md`, lines 46–49; LLP 0297 §Method, lines 117–122). Nevertheless, Finding 3 narrates the failing value, path, and recovery as fact, and §Confidence rates convergence on the same mechanism “High” (LLP 0297, lines 185–210 and 428–430). Open question 1 simultaneously admits that the applying call site and its purpose—egress validation, cloning, or snapshot identity—are unknown (lines 445–447).

The included implementation only demonstrates canonicalization of provider identity, generated references, and normalized arguments for store keys; it contains no result-snapshot call (`canonical-client-value.mjs`, lines 211–244). The LLP 0155/0200 summaries further show that retained identity already excludes result content and live frames already carry server versions (`CAPSULE.md`, lines 37–44).

The incident may justify a reproduction and call-site audit. It does not yet distinguish C from D, a bad wrapper diagnostic, or deletion of redundant canonicalization. The result-profile recommendation must remain a hypothesis until the run is imported or reproduced, the exact count/shape is recorded, and the call site’s invariant is identified.

**M2 — The accepted generated-artifact precedent is extrapolated beyond its actual scope.**

LLP 0297 treats the existing 65,536-node profile as already applicable to every complete `AppDescriptor`, API catalog, and receipt digest (lines 51–57, 326–328, 380–383, and 431–432). LLP 0114 defines those numbers specifically for canonicalizing the normalized generated manifest used by the offline binding receipt (`0114…spec.md`, §Offline binding receipt, lines 1467–1491). Its AppDescriptor amendment says the descriptor itself is not copied into that receipt (lines 1506–1518).

LLP 0179 separately makes the portable descriptor its identity-bearing source, specifies its sentinel-plus-RFC-8785 digest, and gives it descriptor/member ceilings (`0179…rfc.md`, lines 187–197, 225–251, and 638–650). The Clique evidence proves only that hydrated `app.api.queries` incorrectly crossed the 4,096 argument path (`20260822…ceiling.md`, lines 17–27; run record, lines 69–74; Diary 0106, lines 57–61).

That proves a category error, not that the receipt profile is the correct replacement. The Research must compare reuse of 65,536 against using LLP 0179’s verified descriptor identity or a prepared opaque binding so the hydrated tree need not be recanonicalized at boot.

**M3 — Finding 1 overstates the shipped canonicalizer’s resource-safety guarantee.**

LLP 0297 says the profile makes synchronous identity work finite and places CPU, memory, and output ceilings around hostile input (lines 21–25 and 140–153). The implementation does not enforce all those ceilings before doing the corresponding work:

- It obtains every own key and every descriptor, and repeats key enumeration, before applying the 256-field limit (`canonical-client-value.mjs`, lines 64–96 and 172–179).
- It UTF-8-encodes a complete string before testing its byte limit (lines 52–61).
- It constructs and encodes the complete canonical output before enforcing the 262,144-byte ceiling (lines 192–206).
- Proxy traps execute during inspection, and a stable transparent proxy is not detectably refused, contrary to LLP 0114’s stronger proxy claim (`0114…spec.md`, lines 1160–1168 and 1328–1332).

The limits bound admission after potentially unbounded enumeration, trap execution, or allocation; they are not strict CPU/memory budgets as described. This matters directly to A/B/C’s alleged safety tradeoff. The Research should distinguish grammar/admission ceilings from enforceable resource ceilings and include this implementation/spec mismatch in the evidence program.

**M4 — The evidence program cannot yet adjudicate C versus D or derive a defensible budget.**

The program inventories semantic classes and benchmarks fixed node counts, but prototypes only C-style diagnostics (`0297`, lines 402–424). It supplies neither:

- a purpose/phase map distinguishing validation, transport admission, retention, equality, cloning, and digest identity;
- a prototype of D using existing server versions;
- a prototype using AppDescriptor identity instead of whole hydrated-tree canonicalization; nor
- pass/fail thresholds for synchronous latency, allocation, retained memory, or live-delivery cadence.

“Result snapshot” remains too broad a class: transport bytes, decoded structural safety, retained-store memory, and change identity are different invariants even for the same result. Without alternatives and decision thresholds, the proposed measurements could produce excellent data while still providing no rule for choosing A, C, D, or a number.

## Findings 1–5

- **Finding 1:** The finite grammar and exact default limits are confirmed by LLP 0114 and the source. Its stronger runtime-resource and proxy-safety characterization is not.
- **Finding 2:** Strong evidence for removing generated `app` admission from the argument path and diagnosing it during generation. It does not select 65,536 or establish which generated representation should be canonicalized.
- **Finding 3:** Hypothesis-grade in this capsule. Even if accurate, the twelve-record recovery supports bounded/windowed product semantics at least as strongly as it supports a larger result profile.
- **Finding 4:** At most supports rows, bytes, work, and pagination as better product vocabulary. The vendor units are not convertible to JavaScript nodes, so they do not establish that 4,096 is numerically “far below” comparable result envelopes.
- **Finding 5:** Shows roughly linear cost for one synthetic shape on M5/V8 and no local cliff near 6,251. It cannot choose among A/C/D or establish representative-client affordability.

## Option ranking

1. **Other — purpose/phase-specific hybrid.** Keep the caller-argument limit provisionally, repair its actual pre-admission safety properties, validate generated artifacts once under LLP 0179 and carry descriptor/prepared-binding identity, and separate result transport, structural, retention, and equality concerns. Prefer per-operation declared windows plus an absolute platform guard. Investigate D for equality.
2. **C, narrowed.** Semantic classification is valuable for ownership and diagnostics, especially for the generated-app defect. The evidence does not yet support one new canonical result profile or blanket reuse of the receipt profile.
3. **D.** Strategically promising because version-stamped delivery can avoid repeated whole-snapshot stringification. It still requires independent admission bounds and proofs for stale, reordered, coalesced, retained, optimistic, and authority-transition behavior.
4. **B.** The safest interim result posture while the call path is unknown, with better diagnostics and bounded projections. Literal “4,096 everywhere” is incompatible with LLP 0114’s already-accepted receipt exception and is not a permanent generated-app answer.
5. **A.** A global increase weakens the only well-supported boundary, preserves category conflation, and improves neither diagnostics nor architecture. It may not even cover the unstated `viewerState` size.

## Minor concerns

**m1 — The A/B comparison contains unsupported quantitative claims.** Option A says 8,192 or 16,384 immediately covers both incidents, but no `viewerState` node count is given (`0297`, lines 292–300 versus 185–197). Option B says 4,096 is “far below” other result envelopes despite having no node-to-row/byte conversion (lines 310–322).

**m2 — Several factual phrasings need correction.** Raising the default would affect callers inheriting it, not “every call site,” because per-call overrides already exist (`canonical-client-value.mjs`, lines 103–107). The 4,096 count applies independently to canonicalized arguments/components; the complete store key is bounded by final bytes, not one whole-key node count (lines 229–243; LLP 0114, lines 1337–1340). The benchmark did not omit canonical-output allocation—it executed code that constructs and encodes that output; it merely did not isolate allocation or GC (`0297`, lines 249–258; source lines 192–206).

**m3 — Evidence traceability is incomplete.** The 263-function fixture, named `sha256GeneratedManifest` behavior, benchmark raw record, competitor pages, and published-0.1.25 incident are unavailable here. The checked-in generated-app ticket, record, and diary are three descriptions of one N=1 calibration run, not independent corroboration; the record explicitly says it is not claim-eligible (`2026-08-22…record.md`, lines 3–4; Diary 0106, lines 9–11).

## Confidence and hand-off quality

- The first “High” should be split: different producer classes are clear, but convergence on the same result mechanism is Low pending reproduction and tracing.
- The artifact-precedent “High” is warranted only for the manifest-receipt profile, not its proposed extension to AppDescriptor/API catalogs.
- The competitor “High” is unverifiable here and has limited decision relevance.
- Representative-client affordability and safe removal of result canonicalization are both Low until their respective benchmarks and correctness prototypes exist.
- Low confidence in any final numeric limit is appropriate.

Open questions 1, 2, 5, 6, and 7 are foundational. Warning hysteresis is premature. Missing questions include which invariant each call site protects, portable versus hydrated artifact identity, pre-parse transport enforcement, per-operation versus class-wide limits, and what measured thresholds would select each option.

The Research is a useful problem statement and evidence-plan draft, but it is not yet an adequate basis for the proposed RFC direction.

VERDICT: NOT READY
