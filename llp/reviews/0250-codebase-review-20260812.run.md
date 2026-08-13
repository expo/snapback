# LLP 0250/0251 — single-family super-refine run journal

## Authorization, bounds, and topology

- **Invoked:** 2026-08-12 by Charlie Cheever, the named human author, for
  `llp/0250-codebase-review-20260812.research.md` and
  `llp/0251-outbound-destination-policy.rfc.md`.
- **Authorized variation:** the author explicitly requested one family only,
  Codex GPT-5.6-sol at xhigh, as writer and reviewer, and explicitly waived the
  Claude family. This run therefore cannot claim the ordinary dual-family
  convergence of LLP 0010; `READY` below means single-family Codex readiness.
- **Role separation:** a dedicated Codex writer may revise; every review is by
  a fresh Codex reviewer that did not write the reviewed revision. The
  orchestrator records provenance and applies returned revisions but does not
  count itself as a reviewer.
- **Topology:** one lockstep cluster. LLP 0250 is primary because its research
  record motivates and cross-references LLP 0251; reviewers see both exact
  target byte streams and must return per-target plus set-level verdicts.
- **Bounds:** three rounds for the cluster (the skill default per document),
  six reviewer launches per target/family including voids, and approximately
  20% net growth over the entering Review revisions. One lockstep reviewer
  launch counts once against each target's cap.
- **Status authority:** both targets entered as Draft. The authorized
  `Draft → Review` transition was applied before round 1 and is the loop's only
  status transition. This run never sets Accepted, Active, or beyond.
- **Revision identity:** both targets were untracked at entry, so every
  revision is bound by full SHA-256 rather than a commit hash. Pre-transition
  hashes were LLP 0250 `a45d49abac0bcfaf15680cfdcd238e93b1798fb1f1fdb9b388ad822c8febcc0a`
  and LLP 0251 `fa8940d874f33bb9e18e5609faf3b1f58052e12ef29bd2efb4057ed87cbd8523`.
  The entering Review byte sizes are 11,453 and 9,664 respectively.

## Disclosure and blindness

The human author explicitly selected OpenAI Codex GPT-5.6-sol for both roles,
which authorizes sending the unredacted targets and review context to that
service. No credential file, `.agent-local-secrets.md`, environment value,
runtime database, private key, or unrelated untracked working-tree file is in
the capsule.

Each capsule is a repository export at recorded `HEAD`, overlaid with the exact
unredacted targets and the relevant current working-tree LLP/ticket changes.
Target-specific review artifacts, this run journal, and orchestrator notes are
structurally absent. Reviewers share a machine/filesystem where the parent
checkout remains technically readable, so they are additionally instructed to
read only the capsule and self-attest compliance. This residual is disclosed as
instruction-enforced blindness; a response that admits reading outside the
capsule is malformed and does not count.

## Round 1 — 2026-08-12

- **Revision r1:** LLP 0250 SHA-256
  `1b9936f4c6bd14a031729d76cf55e5db8f89a82d05df82cfad8c287623085626`;
  LLP 0251 SHA-256
  `39aa47f2792f1d4ff83b0ebe00d43523f3fc4f564d03780ee880b2df5415bfdf`.
- **Capsule base:** repository `HEAD`
  `27d3a9cd9b54f4b45b5c0ca50c8d85796dc06b59`, plus r1 targets, the current
  LLP 0009 working-tree revision, the two updated pre-existing tickets named by
  LLP 0250, and all `issues/20260812-*.md` findings. The export contains 11,018
  files (about 240 MiB).
- **Outbound inventory:** the public tracked repository at that HEAD; the two
  complete targets; governing LLPs and code; the current review-created issue
  files; `REVIEW_INSTRUCTIONS.md`. Excluded: target review artifacts, this
  journal, `.llp` notes outside the capsule, Git metadata, credentials, secrets,
  runtime state, and unrelated untracked changes.
- **Capsule inventory SHA-256:**
  `44a677fe6f14bef30eaa64e7b6eabf9cf512632223d1ac41fe69738265d7dd95`.
- **Instruction SHA-256:**
  `b5e3da596c404d7ed06aed512af69a57bb12e8ab97f0be12a8469e3fb6d8613a`.
- **Reviewer runtime:** fresh Codex collaboration agent, model
  `gpt-5.6-sol`, reasoning effort `xhigh`; standard review lens; read-only
  instructions; no prior target review supplied.
- **Launch record:** one launch, completed. The collaboration runner exposed no
  stable session id or duration, so neither is invented.
- **Outcome:** LLP 0250 **READY** (no MATERIAL; five DETAIL), LLP 0251
  **NOT READY** (six MATERIAL; five DETAIL), set **NOT READY**. The reviewer
  self-attested capsule-only compliance. Its complete response was written
  verbatim on receipt to the primary Codex artifact; the LLP 0251 artifact
  points to that one preserved cluster review.
- **Revision plan:** apply the complete ledger. LLP 0250 needs snapshot/pass
  provenance, local scoping, and the dormant R13 posture. LLP 0251 needs honest
  Cloudflare degradation, canonical authority/allowlist rules, a complete
  consumer matrix, proxy-free v1, pre-unwrap secret-safe refusals, migration,
  and all-consumer acceptance evidence.

## Revision r2 — 2026-08-12 (dedicated Codex writer)

- **Writer runtime:** separate Codex collaboration agent, model
  `gpt-5.6-sol`, reasoning effort `xhigh`. It did not review or issue a verdict.
- **Revision hashes:** LLP 0250
  `3e3ed0749284e9d47a1860457c788586728c5d1d14282e46c13fc2806bab49f6`
  (12,262 bytes; +7.1% over entering Review); LLP 0251
  `59c115052c93a0cc0b0687f8ef2c6a0d3ca305230c684f30cf8a0ef8714dd32f`
  (11,456 bytes; +18.5%). Combined growth is +12.3%, within the ~20% budget.
- **Complete disposition:** C250-01..05 add the landed snapshot identity,
  stable-symbol/pass-map provenance, priority rubric, local-only constant-time
  claim, and dormant R13 posture. C251-01..11 define Cloudflare Missing while
  preserving LLP 0049's fixed-provider residual; parse-once canonical
  authority and exact host/port allowlists; Host/authority refusal;
  per-consumer HTTPS, loopback, and 3xx behavior; proxy-free v1; pre-unwrap
  admission and closed value-free refusals; migration and cross-consumer
  evidence; LLP 0070 relation; current push wording; future redirect stripping;
  and conservative-classifier terminology. Former open questions moved into
  normative decisions.
- **Revision audit:** byte inspection confirmed Cloudflare `Missing`,
  `try_proxy_from_env(false)`, exact authority rules, no-follow/manual redirect
  treatment, pre-unwrap ordering, default-off loopback, and secret-safe refusal
  wording. `./ref-check --verbose` passed (251 LLP documents, 13,871 refs,
  0 errors, 0 unchecked); `git diff --check` passed.

## Round 2 — 2026-08-12 (delta + implementer lens)

- **Revision r2:** hashes as above; exact r1 baselines were included in the
  capsule for direct comparison.
- **Capsule base:** repository `HEAD`
  `b5b5d2d5b931634a718a72aba44a3dbd7e39ac09`, with target-specific reviews
  and this journal removed, r2 overlaid, and r1 copied under
  `REVIEW_BASELINE/`. The export contained 11,022 files (about 240 MiB).
- **Outbound inventory:** the public tracked repository at that HEAD; complete
  unredacted r2 targets and r1 baselines; governing LLPs and implementation;
  `REVIEW_INSTRUCTIONS.md`. Excluded: all target-specific reviews/journal,
  orchestrator notes, `.llp` data outside the capsule, Git metadata,
  credentials, secrets, runtime state, and unrelated untracked changes.
- **Capsule inventory SHA-256:**
  `772c371197481546cb4f797e7c85ab9aa6461258f36242fabd6d5d6e7bbf8841`.
- **Instruction SHA-256:**
  `69b54c4e6c6a314941b877d7e12f389e7d361d7daebb1fcd882db9e6d9cc14f8`.
- **Reviewer runtime:** fresh Codex collaboration agent, model
  `gpt-5.6-sol`, reasoning effort `xhigh`; it did not write r2. Instructions
  required IN-DELTA/PRE-EXISTING classification and an implementer derivation.
- **Launch record:** one launch, completed; no stable session id or duration
  was exposed.
- **Outcome:** LLP 0250 **NOT READY**, LLP 0251 **NOT READY**, set
  **NOT READY**. Exactly three MATERIAL concerns: C250-01 PRE-EXISTING (the
  categorical product count omits current Ask provider egress); C251-01
  IN-DELTA (universal scope omits Ask and leaves infrastructure such as S3
  ambiguous); C251-02 IN-DELTA (no authoritative fact proves the proposed
  trusted, non-tunnelled local loopback profile). No other material concern was
  found. The complete response was appended verbatim on receipt.
- **Final-round plan:** add Ask as a current governed application/provider
  egress consumer with LLP 0204 context, exact provider allowlist, pre-secret
  admission, capability/migration/acceptance treatment; explicitly narrow this
  RFC away from operator infrastructure transports such as S3; and make
  loopback HTTP test-harness-only, eliminating the unprovable operator-enabled
  trusted-local state. Round 3 will re-review the exact r2→r3 delta and the
  complete cluster unchanged.

## Revision r3 — 2026-08-12 (dedicated Codex writer; final budget)

- **Continuity note:** concurrent movement of `main` reset the two working
  targets to r1 after round 2. The writer first restored the exact sealed r2
  capsule bytes (verified hashes `3e3ed074…` / `59c115052…`), then applied only
  the round-2 ledger. Round 2 remains bound to its capsule; no verdict is
  rebound to reset working-tree bytes.
- **Writer runtime:** the same dedicated Codex writer role, model
  `gpt-5.6-sol`, reasoning effort `xhigh`; it issued no verdict.
- **Revision hashes:** LLP 0250
  `12023fa7aaba5e23555c7b7a482c701a28096ca04e975d35285ccd1a6afd1d66`
  (12,741 bytes; +11.2% over entering Review); LLP 0251
  `e8bdef3288ecc24c2470ab22b774792138f95d72bf2999e60fab0e3253bb0c08`
  (11,304 bytes; +17.0%). Combined growth is +13.9%; all growth remains within
  the declared budget.
- **Complete disposition:** C250-01 adds current Ask/OpenAI-compatible
  provider egress and LLP 0204 while keeping it distinct from R1's
  handler-authored user-URL ticket. C251-01 precisely scopes
  application/integration egress, adds Ask across ordering/outcomes/capability/
  migration/evidence, and excludes S3/MinIO, deployment, CLI/control-plane and
  private workerd transports from inheriting any claim. C251-02 makes loopback
  HTTP available only through an unexported, test-constructed
  `TestLoopbackHttp` capability absent from every served configuration and app
  surface; every served target reports loopback off.
- **Revision audit:** the r3 files were copied immediately into the sealed
  round-3 capsule and their full hashes matched. Byte inspection confirmed the
  Ask credential ordering, excluded-infrastructure non-claim, test-only
  loopback source, Cloudflare Missing, exact authority, proxy refusal, and
  no-Location rules. The writer reported `ref-check` and `git diff --check`
  clean; final orchestrator validation follows after the verdict.

## Round 3 — 2026-08-12 (final delta + cross-consistency lens)

- **Revision r3:** hashes as above; exact r2 baselines included under
  `REVIEW_BASELINE/` with hashes
  `3e3ed0749284e9d47a1860457c788586728c5d1d14282e46c13fc2806bab49f6`
  and
  `59c115052c93a0cc0b0687f8ef2c6a0d3ca305230c684f30cf8a0ef8714dd32f`.
- **Capsule base:** repository `HEAD`
  `df3567633d370e0daa6014159676d4b448bfec0f`, with target-specific reviews and
  journal removed, r3 overlaid, and r2 baselines copied. The export contains
  11,022 files (about 240 MiB).
- **Outbound inventory:** the public tracked repository at that HEAD; complete
  unredacted r3 targets and r2 baselines; governing LLPs and implementation;
  `REVIEW_INSTRUCTIONS.md`. Excluded: target review artifacts/journal,
  orchestrator notes, `.llp` outside the capsule, Git metadata, credentials,
  secrets, runtime state, and unrelated untracked changes.
- **Capsule inventory SHA-256:**
  `3da169acaedc7aee76df0dce23da1a406f1099c4dfbacd1f1dfd0c352faf6f63`.
- **Instruction SHA-256:**
  `1f7decf9dff4b71d78c7fb33b2a8750e18a1c8f8fa63b26981533382e58d4f04`.
- **Reviewer runtime:** fresh Codex collaboration agent, model
  `gpt-5.6-sol`, reasoning effort `xhigh`, which did not write r3. This final
  review examines the delta and complete cluster, preserving the implementer
  and altitude lenses.
- **Launch record:** launch 1 failed before receipt with a Codex response-stream
  transport disconnect. It counts against the launch cap, produced no review
  body or verdict, and cannot count for convergence. The unchanged capsule and
  target hash vector were byte-verified before launch 2. Launch 2 completed;
  no stable session id or duration was exposed.
- **Outcome:** LLP 0250 **READY**, LLP 0251 **READY**, set **READY**. No
  MATERIAL concern, IN-DELTA or PRE-EXISTING. One IN-DELTA DETAIL
  (`SR3-0250-D1`) suggests explicitly noting current Ask's manifest-loopback
  acceptance in the Research text; it is altitude-dispositioned and not applied
  because LLP 0251 already makes the migration decision determinate.
- **Convergence:** single-family Codex READY on the exact r3 hash vector. This
  is the author-requested one-family variation, not ordinary dual-family
  convergence. The complete response was appended verbatim to the primary
  Codex artifact immediately on receipt.

## Terminal — 2026-08-12: single-family READY

- Final verdicts bind to LLP 0250 SHA-256
  `12023fa7aaba5e23555c7b7a482c701a28096ca04e975d35285ccd1a6afd1d66`
  and LLP 0251 SHA-256
  `e8bdef3288ecc24c2470ab22b774792138f95d72bf2999e60fab0e3253bb0c08`.
- No later target revision exists. The working-tree target bytes were
  re-hashed after receipt and must match this vector through close-out.
- Rounds run: three completed reviews plus one failed pre-receipt launch in
  round 3. Reviewer launches per target: four, below the cap of six.
- Growth at the final reviewed revision: LLP 0250 +11.2%, LLP 0251 +17.0%,
  combined +13.9%, within the ~20% budget.
- Both LLPs remain **Review**. This skill recommends author acceptance but does
  not set Accepted or any later status.
- Final close-out must repeat that this is single-family Codex readiness, name
  the bound vector, and state that there are no later unreviewed revisions.
