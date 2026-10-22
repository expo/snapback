# 0.4.35 Linux attempt 3 at f0eed70bb3 — one load-sensitive client test; flake rule applied

Commit: f0eed70bb36705b08c0c065fa154b386b9ad0504 (census fix; parent 2e10681b32). Prepared bytes: client sha512-BazFeTCT... (identical to attempt 2), expo sha512-+qd2MFQZ...
Private NPM_CONFIG_CACHE for this attempt (attempt 2 hit an externally pruned shared ~/.npm).

Suite: `== 1 failure(s) in 3688 s`. cargo test ok (1,216 s). Census now green. Client files 423/423, failed 1; tests 7,811 / pass 7,754 / fail 1 / skip 56. Client models ok (394 s).
Red: packages/snapback4/test/following-history.test.mjs test 17 "witness fragments include query arguments at and beyond the 64 KiB envelope boundary"
(following-history.test.mjs:322): "only an envelope that crosses the allowance needs another fragment" — expected 1 mounted refresh, got 2 (at extra=0).
Not deterministic: the same test code passed in the attempt-2 Linux full suite (2e10681b32; f0eed70bb3 changes only the census .mjs) and in the
Mac evidence full suite; alone it passed 6/6 (isolated-a3/, 18 pass + 1 skip each). Reading: an extra refresh round under full-suite load
(24 concurrent client files on 96 CPUs, other agents' work on the host).
Flake rule step 1 (pass alone) satisfied; step 2 = full-suite rerun: Linux attempt 4 on the same prepared bytes.
The rest of linux-3 (consumer proofs; no receipt possible) was stopped by script (kill-linux.sh, root pid 4033913) to start attempt 4.
