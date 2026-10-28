# GEN1 review dispositions

All received reviews are preserved verbatim with provenance in llp/reviews.
Every verdict below refers only to the source revision actually reviewed.

- Round 1: Muse READY; fresh Codex NOT READY. Fixed large-domain expansion,
  Following exact-history versus bounded-inbox guidance, spanning-type notice,
  action admission, and literal whitespace/comment escaping. Added literal
  prose argument/result type checks alongside the original fenced-code checks.
- Round 2: Muse READY; fresh Codex NOT READY. Fixed token-dense intermediate enum
  domains and string-based asset compaction. The renderer now compacts type
  nodes; opaque enum strings stay exact. Stress covers 151 cases / 150 distinct
  enum sizes, including the 30-variant counterexample and the opaque asset-shape
  literal; all packet snippets and documented required shapes compile.
- Round 3: Muse READY; fresh Codex NOT READY. Corrected browser setup to retain
  app.client/AppProvider and app.auth.login. Bare createClient is explicitly a
  Node/server option. The literal shared setup is executed against an app-owner
  boundary; a bare-client reconstruction negative control fails. Six real packed
  browser starters separately prove existing App/client writes and admission.
- Round 4: Muse READY; fresh Codex NOT READY. Added a combined type/guard/code
  density threshold and 150 mixed cases, including its concrete 508-token
  counterexample. All seven usage tests pass on source 6fa122d7d9.
- Round 5: fresh Muse and fresh Codex both READY on source 6fa122d7d9. Earlier
  NOT READY reviews remain preserved; none is relabelled.

Optional held/maintained/nested-guard coverage remains outside the three-fixture
bar. Existing source emitter tests cover held/maintained contracts; the packet
states source/row rules still apply and does not infer an authorization matrix.
No review or static token budget is a whole-session latency/token-use result.
