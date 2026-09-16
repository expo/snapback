# Pilot launcher verification

Final runner SHA-256:
`35f2417ea79479f18c0ae8d19e4107d1cf10284c0f25505a6b283c4dbe11f53b`.
Node 24.13.1. No real model was used by these mock checks.

- Neutral packet staged outside Git; starter 294 and conformance 96 records
  generated and independently verified. Delivered manifest SHA-256:
  `da59b8261abc345758d761042cca6513c29f3e270f97062038503e58b7f3be70`.
- Original candidate mock checks retained successful, exit-7 and unavailable
  native-rollout outcomes with private logs and end records.
- Repaired candidate: same-group descendant remaining after leader exit was
  terminated and its group disappearance recorded; authored app FINAL and
  CLI last-message had distinct retained identities.
- Repaired candidate: changed brief failed post-run integrity and returned
  126; wrong child-PATH Node version was refused before spawning the builder.
- Final candidate: fake ps returning another PGID never caused a negative-PGID
  signal. Exact-child cleanup recorded TERM then disappearance; with a delayed
  fake ps allowing the child to install its TERM-ignore handler, it recorded
  TERM, five-second wait, KILL, and confirmed disappearance. Both refusals
  returned 1 and retained end.json.
- Final syntax and git whitespace checks pass. The one-line final delta only
  removed an unrecorded early TERM in the failed-PGID branch; the affected
  exact-child paths were rerun. Other repaired paths are unchanged.

Private mock receipts live below `/tmp/workroom-review.W8gyXV/` on the control
Mac; its `*-stage-path` files identify the retained cases. These are launcher
checks, not Workroom application acceptance or benchmark results.

Sol and Grok independently cleared the final hash, with received source and
delta reviews retained in `../reviews/`. The first Grok attempt returned no
verdict and is not counted. Sol cleared before diagnostic launch; Grok's fresh
inline-source review completed while the diagnostic was running. This is
verification, not a scored-cell or application-qualification verdict.
