**NOT READY.** The reconnect fix holds up, but claim 2 still fails: credentials can escape through output redaction.

1. **P2 — Reversible token encodings leak through server metadata.** [Redaction](/home/ccheever/sb4-intent/review-bn-r1-astra/snapback4/packages/snapback4/bin/witness-acquire.js:25) matches only specific, case-sensitive encodings. Using a real session token, I reflected its **uppercase hexadecimal encoding** through a query name. The command exited **0**, with `passed: true`, while emitting the recoverable credential in JSON stdout, text summaries and `acquire.json`. A missing-argument error also exposed it in **stderr**. Lowercase percent escapes and reflected SHA-256 values likewise survive. Discarding refusal bodies does not cover these other reflection paths. [Reproduction](/tmp/bn-r1-astra-k67mnqj_/snapback4/packages/snapback4/test/review-real-token.test.mjs), [results](/tmp/bn-r1-astra-k67mnqj_/real-token.log).

2. **P2 — Invalid `--token=…` spelling prints the raw bearer.** [Secret discovery](/home/ccheever/sb4-intent/review-bn-r1-astra/snapback4/packages/snapback4/bin/witness-acquire.js:297) recognizes only standalone `--token`. Consequently, `witness acquire --as alice --token=BN_EQUALS_BEARER_TEST_NOT_REAL` echoes the entire credential in its unknown-argument error. Rejecting that spelling is fine; printing its value is not. [Failing reproduction](/tmp/bn-r1-astra-k67mnqj_/review-token.log).

| Claim | Independent check |
|---|---|
| **1. Completed, verified reconnect** | Confirmed in tested cases. All existing reconnect controls pass. **14 additional checks pass**, covering malformed native payloads, changed identity/generation, failed schema fetch, unpublished application and a valid two-page reconnect. No new false passing reconnect found. |
| **2. Token secrecy at every boundary** | **Refuted above.** Existing refusal-echo tests pass, and injected native child stderr is correctly suppressed. |
| **3. Performance defect named separately** | Confirmed in report and bounds guide. Reverting the guide wording makes its detecting test fail. |
| **4. CLI diagnostics and usage** | Confirmed. Reverted diagnostics and family usage fail their tests. |
| **5. Hosting note and separate clocks** | Confirmed. Reverting each correction fails its test; the delayed coverage scan belongs to `coverageVerifiedMs`. |
| **6. Detecting controls and suite result** | Independently reproduced **17/17 detecting failures** with the reverted helper/guide and preserved round-0 binary. The full-suite log contains the reported single failure; its unchanged file passes **10/10** here. Baseline attribution remains scope-based, with cause unresolved, as disclosed. |

The affected checks pass **37/37**. Disabling retention comparison makes deleted-row and changed-history controls fail; disabling identity comparison and the event guard breaks their respective controls. [Reversion results](/tmp/bn-r1-astra-k67mnqj_/reverted-controls.log).

A fresh heavy-account run acquired **105,034 rows / 1,000 conversations / 4,014 table-group pairs in 41.684 s**. Restart’s first answer took **0.267 s**, coverage verification **0.295 s**, and reconnect completed with native publication at **419402**, `more: false`, and zero events. The four committed round-1 receipts also recompute correctly. [Fresh receipt](/tmp/bn-r1-astra-k67mnqj_/fresh-heavy/unconfined/u0001/acquire.json).

I did not rerun the full suite. The reviewed checkout remains clean at `7d1d7dbc6e`; all mutations were confined to scratch, and nothing was pushed.