You are one code reviewer. Do not spawn agents, clone anything, run remote commands, or edit files. Read only. You are in a checkout of the Snapback repository at branch sb4/progressive-history. You may build and run tests inside `snapback4/` (cargo and bun from that directory; Node 24 via volta) but must not modify files or git state.

This is a SHORT round 5 of a blind two-family review, scoped to the commits AFTER b57bb824a1 (`git log --oneline b57bb824a1..HEAD`; `git diff b57bb824a1..HEAD -- snapback4/crates snapback4/packages`). Rounds 1–4 are recorded under `snapback4/reports/20261102-progressive-history-reviews/` and ended READY from both seats on b57bb824a1. The landing's broad battery then found client files red that the targeted suites never exercised; the commits under review are those fixes (one by the supervisor: a cold pin scanned every schema table and refused on ephemeral tables; the rest by fix round 4, `fix-r4/REPORT.md`).

Answer only these:
1. For each fix in the range: is it a product fix or a test update? If a test was updated, did it only replace LEGACY wire-shape assertions (exact snapshot limit sequences, `from:0, after:null`, "publish only the complete snapshot") with the negotiated protocol's equivalent, or did it weaken a behavioral property (acquired becomes true, recovery after E_BOUND, correlation of in-flight writes, overtaken-owner refusal, upgrade-restore halting, answer correctness)? Name any weakened property.
2. Did any fix open a soundness hole of the kind earlier rounds looked for (complete:true over unobserved data; partial progress writing ACQUIRED; a superseded owner's page accepted; prediction before acquired; disclosure beyond the audience)?
3. Does each regression test fail without its fix (say how you checked)?

End with a per-fix verdict table and one line: READY / NOT READY and a confidence from 0 to 1.
