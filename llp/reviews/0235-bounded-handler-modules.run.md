# Super-refine run — authoring-improvement set (now LLP 0237–0243)

**Authorized by:** Charlie Cheever, 2026-08-12, in session
**Protocol:** author-directed single-family adaptation of `llp-super-refine`
**Family constraint:** Codex GPT-5.6-sol, xhigh only; Claude intentionally
skipped by author direction
**Entering targets:** LLP 0235–0241
**Canonical targets after collision repair:** LLP 0237–0243; research input
LLP 0234 became LLP 0236
**Topology:** one lockstep cluster; each review must render per-target and
set-level verdicts over one unchanged hash vector
**Round budget:** 3 lockstep rounds
**Launch cap:** 6 launches per reviewer lane, including voids
**Growth budget:** approximately 20% net over the entering Review revisions
**Reviser:** a separate Codex GPT-5.6-sol xhigh agent; it does not review its
own revisions

## Round 1 launch record

- **Recorded before launch:** 2026-08-12
- **Target state:** Review (the one author-authorized Draft → Review transition
  was applied before this record)
- **Target sha256 vector:**
  - LLP 0235: `fd16424a1120161071d158a5d89c9d7fab92604588dd506fd2e80c4d7167e730`
  - LLP 0236: `6bbe63bde02cfd0df78af3810b29b2459e20a7327f30cdc997755803415e2cd2`
  - LLP 0237: `1d0415cae8ee169ef4a06d76e180cc351f2d74b7ab4d403027959f0a02828808`
  - LLP 0238: `b39f0eeb832c874b81bb818b06b4980fa754ca10f474250035a56b3dfc511d21`
  - LLP 0239: `c94f027ad96369182aed5095ccff631abad025831f89bf223d21b61391f99d8e`
  - LLP 0240: `7af931953fbf8da27bd32fc0261b337064c292847812c55e93de26337ad13c6a`
  - LLP 0241: `626942dbca8cc8a44fc9bb3c01375e37e64028823eae7fa5644f49a20ab15d91`
- **Capsule:** `/tmp/snapback-llp-super-refine-r1-min.0oZ7sZ`
- **Capsule inventory:** 257 files — `AGENTS.md`, all top-level LLP documents,
  selected relevant diaries, and `guide/capabilities.md`; `llp/reviews/`,
  `.llp/`, orchestration notes, VCS metadata, build outputs, dependencies, and
  target review artifacts structurally absent
- **Capsule sha256:**
  `683c25563bf5e966871fe8d8ec150b88a9230e87e9876b0aab8c81d39a598c20`
  (review instructions excluded)
- **Reviewer A instruction sha256:**
  `41489bbce99c9cfb645b8a1b9fa968b3e75129a75d2bd9ba0f64c227973e7e97`
- **Reviewer B instruction sha256:**
  `861f46eab7f6b5541e022c08f661ad004167e6a58d8b4ca5171bcdf4190bee94`
- **Reviewer A runtime/lens:** fresh Codex GPT-5.6-sol xhigh;
  architecture/correctness/security/ownership/cross-RFC coherence
- **Reviewer B runtime/lens:** fresh Codex GPT-5.6-sol xhigh; skeptical
  implementer/underdetermination/failure and sequencing coherence
- **Blindness:** structural capsule exclusion plus distinct live-repository
  artifact paths; reviewers instructed not to read the live workspace except
  for one write-only artifact creation and not to communicate with each other
- **Outbound disclosure:** none; both reviewers are internal collaboration
  agents operating on the local capsule
- **Mid-round mutation rule:** any target-byte change before both artifacts land
  voids the round
- **Assigned verbatim artifacts:**
  - `llp/reviews/0235-bounded-handler-modules.gpt-5.6-sol-a.md`
  - `llp/reviews/0235-bounded-handler-modules.gpt-5.6-sol-b.md`

### Round 1 outcome and revision

- **Reviewer A:** LLP 0235/0236 READY; LLP 0237–0241 NOT READY; set NOT
  READY.
- **Reviewer B:** LLP 0235 READY; LLP 0236–0241 NOT READY; set NOT READY.
- **Target mutation check:** hash vector unchanged until both artifacts landed.
- **Verbatim artifacts:** both assigned paths above, 240 and 271 lines.
- **Revision:** separate Codex GPT-5.6-sol xhigh reviser applied every MATERIAL
  disposition across all seven targets and recorded the delta in each Revised
  header; no review artifact was edited.
- **Growth:** 16,549 → 19,831 words, +3,282 / +19.83% (inside the approximate
  20% set budget).
- **Check:** `./ref-check --verbose` passed with 0 errors and 0 unchecked.

## Round 2 launch record

- **Recorded before launch:** 2026-08-12
- **Round type:** delta; every MATERIAL must be classified `IN-DELTA` or
  `PRE-EXISTING`
- **Target sha256 vector:**
  - LLP 0235: `2d3118645c67aec72f7b8d2b560789d73bbeacaaf7dcca85f612f15f31025ab6`
  - LLP 0236: `14ab7278154814b715fea8b78e1897789b158187db6c54221aa722453cb58247`
  - LLP 0237: `ef0e8553807c7e90d6f4ab078273527602d91127df20bd8dc84c8478fd381d11`
  - LLP 0238: `06658688843b51c2a34e824e7dbd9bcb85c870002ed86fca0b735afdd28d875b`
  - LLP 0239: `9f28cbaed244cdaf8d16ed448fc656e6055b5f512b67c724a0797c03b6375dfe`
  - LLP 0240: `0f79e2cfb522541ace43b54103c637d9862fc3f8c431f6b1550671bc9481d3e1`
  - LLP 0241: `78d23b0a9b6244c94f6e44e013017ec718e8211550fcd525b3081cdbd9f0dffc`
- **Capsule:** `/tmp/snapback-llp-super-refine-r2-min.2KGrDu`
- **Capsule inventory:** same structural scope as round 1, refreshed after
  revision; review artifacts and orchestration notes absent
- **Capsule sha256:**
  `235147b6fdbc5963734808c3fce9c35886d032e0603efe3377fb6b9646135507`
  (review instructions excluded)
- **Reviewer A instruction sha256:**
  `7e2ad5c9b9fbd657d1393544b0ca19b9d9a556c95b319a4c51bbebf99bcec30b`
- **Reviewer B instruction sha256:**
  `f86def827a22b31980a0e8b4bb6fd96333c52d0ac3ebdfd1d73c013118f22e85`
- **Runtimes/lenses:** two fresh Codex GPT-5.6-sol xhigh agents; A is
  architecture/security/ownership, B is skeptical implementer
- **Blindness:** structural capsule exclusion and distinct round-2 artifact
  paths; no live-workspace reads except write-only artifact creation
- **Mid-round mutation rule:** any target-byte change before both artifacts land
  voids the round
- **Assigned verbatim artifacts:**
  - `llp/reviews/0235-bounded-handler-modules.gpt-5.6-sol-a.round2.md`
  - `llp/reviews/0235-bounded-handler-modules.gpt-5.6-sol-b.round2.md`

### Round 2 outcome, revision, and collision repair

- **Reviewer A:** LLP 0235/0237/0238/0240/0241 READY; LLP 0236/0239 NOT
  READY; set NOT READY.
- **Reviewer B:** LLP 0235/0237/0238/0241 READY; LLP 0236/0239/0240 NOT
  READY; set NOT READY.
- **Delta classification:** all five rendered MATERIAL instances covered three
  distinct concerns and every instance was `IN-DELTA`; neither reviewer found
  a MATERIAL `PRE-EXISTING` concern.
- **Target mutation check:** the Round 2 hash vector remained unchanged until
  both assigned artifacts landed.
- **Revision:** the separate Codex GPT-5.6-sol xhigh reviser aligned mutation
  observation to LLP 0218, selected a pre-pointer generation candidate and
  custodian-readiness protocol, and added a same-snapshot complete-scope proof
  with sealed scope-limit refusal. No review artifact was edited.
- **Remote collision discovered during ship preflight:** fresh `origin/main` at
  `b92bcd412622d63300105883154ae767d5927401` owns LLP 0234 and LLP 0235.
  Before Round 3, research LLP 0234 was mechanically renumbered to LLP 0236 and
  RFCs LLP 0235–0241 to LLP 0237–0243. Headings, metadata, Related entries,
  internal cross-references, and the improvement map moved with them; the
  Round 1/2 verbatim artifacts retain their historical identifiers and paths.
- **Growth:** Round 2 input 19,831 words to 20,528 words, +697 / +3.51%.
- **Check:** `./ref-check --verbose` passed with 0 errors and 0 unchecked.

## Round 3 launch record

- **Recorded before launch:** 2026-08-12
- **Round type:** final delta; every MATERIAL must be classified `IN-DELTA` or
  `PRE-EXISTING`
- **Canonical target sha256 vector:**
  - LLP 0237: `a85c91ee9781814d4f1480daa7e9414a0e640159b754cee0227ac0f523cd6e3d`
  - LLP 0238: `34f25e6b8c7a554d57b7970188353c03726e513643d328eac6a3baa7f1d4ddf5`
  - LLP 0239: `b5d3958b3075582861ead50d8227c6714aa6d9a0f964e8ac4292f1617ba2aae9`
  - LLP 0240: `71e85b361e31bc564d3847ef142d7858d0c268bb05e74df319915a3a2974e955`
  - LLP 0241: `17ab2d020caaa8e020a6a465b445b8e6ff2a9a690eacc597147b7204906c083f`
  - LLP 0242: `0f5a7cdf136e8e3774382dbb055c475df6be319515038c59a6d22f51f53e4a12`
  - LLP 0243: `992fb4ca522e37495fa7415bf74b36c62f4b05cbc590c89b0b1948922203ef55`
- **Research input sha256:** LLP 0236
  `237a50ebdedbcdadbdd197babcd04184f1ddf251b1a4ed6a4d4f88fec6ba93f8`
- **Capsule:** `/tmp/snapback-llp-super-refine-r3-origin.K7mI2t`
- **Capsule inventory:** 259 content files before reviewer instructions —
  `AGENTS.md`, fresh `origin/main` top-level LLPs including LLP 0234/0235,
  candidate LLP 0236–0243 overlays, 13 selected diaries, and
  `guide/capabilities.md`; all review artifacts and orchestration notes absent
- **Capsule sha256:**
  `3d206762331cdc4e321a8972e5e2d0d44fd6bdbd3e8001c60ce1d9b72081eb50`
  (review instructions excluded)
- **Reviewer A instruction sha256:**
  `49aa6dde232617d172989df237d2064436525deefc42ce889ed80885529dde5b`
- **Reviewer B instruction sha256:**
  `c3fa69b1b470ff256d775ccd0c9f9deb26c0f5e9adaa6efa42385a135c026525`
- **Runtimes/lenses:** two fresh Codex GPT-5.6-sol xhigh agents; A is
  architecture/security/ownership, B is skeptical implementer
- **Blindness:** structural capsule exclusion and distinct Round 3 artifact
  paths; no live-workspace reads except write-only artifact creation
- **Mid-round mutation rule:** any canonical target-byte change before both
  artifacts land voids the round
- **Assigned verbatim artifacts:**
  - `llp/reviews/0237-bounded-handler-modules.gpt-5.6-sol-a.round3.md`
  - `llp/reviews/0237-bounded-handler-modules.gpt-5.6-sol-b.round3.md`

### Round 3 outcome and convergence

- **Reviewer A:** LLP 0237–0243 READY; set READY; no MATERIAL concern.
- **Reviewer B:** LLP 0237–0243 READY; set READY; no MATERIAL concern.
- **Target mutation check:** the canonical hash vector remained unchanged until
  both artifacts landed and was reverified afterward.
- **Convergence:** both fresh Codex GPT-5.6-sol xhigh reviewers marked the same
  seven-target revision READY. The author-directed single-family adaptation of
  `llp-super-refine` therefore converged in Round 3. Claude was not launched.
- **Residual findings:** MINOR implementation-Spec and cross-document
  integration notes only; no blocking author question and no later content
  revision.
- **Check:** `./ref-check --verbose` passed with 242 LLP documents, 13,806
  references, 0 errors, and 0 unchecked.
- **Acceptance boundary:** this run renders READY verdicts only. Any subsequent
  `Review` → `Accepted` transition is a separate author action and is not part
  of the super-refine verdict or reviewed hash vector.

## Post-run author action

- **Transition:** after Round 3 convergence, the author directed a metadata-only
  `Review` → `Accepted` transition for canonical RFCs LLP 0237–0243.
- **Content boundary:** no decision or body bytes were otherwise revised; review
  MINORs were not absorbed into the accepted cut.
- **Accepted target sha256 vector:**
  - LLP 0237: `d9d60ddf5b5946c1b647c21fb363f4f8e0de23062dc99689b307307a61a12f8c`
  - LLP 0238: `f121c473a9cc75872e493555affc86cafed07bdb9907ad24ad1181d670a87a75`
  - LLP 0239: `6c9910fc3c0b7423aa6b6541aced9616e9d84af47451ad5a70b4c211fbbe9bfd`
  - LLP 0240: `57a5630d4696ecfa556e6896e5798468436f246c3c401cca607acc67ae6dc633`
  - LLP 0241: `3c813ef8db37d4e62132f0adbe8828d28d0d64242c19c78fcdf17a251f865565`
  - LLP 0242: `c486d35dd12f9617c04e7a0af1148af1071ab0fcc033e2dfffedca56f58c59b0`
  - LLP 0243: `03cb361210043df6b641c5168c8f04d872d685bdb0b85c11812d2e9137b4db0b`
- **Check:** `./ref-check --verbose` passed with 242 LLP documents, 13,806
  references, 0 errors, and 0 unchecked.
- **Implementation handoff:** Fable 5's implementation supervision is outside
  `llp-super-refine`; it does not alter this run's verdicts or convergence
  record.
