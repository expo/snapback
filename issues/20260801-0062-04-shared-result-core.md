# 0062-04: shared result core and frozen exit taxonomy

**Status:** OPEN. **Authority:** LLP 0062 §2 (result contract, exit
codes), residue #8 (unknown-diagnostic stable fallback by wire locus/
result kind) and #10 (envelope-less sessions redeploy-required gets
its own frozen exit class); LLP 0024 amendment (ENG-25406: the
wrapper-to-core mapping + LLP 0037 ownership registration).

One shared result envelope across CLI/HTTP/MCP projections per LLP
0019/0024; the frozen exit-code taxonomy with per-kind mapping; parity
gates proving the CLI's rendering of server diagnostics is lossless
(attribution block verbatim — the seams landed 2026-07-30, the parity
gates are this ticket).

Done when: the LLP 0024 dated amendment lands with the mapping table,
exit taxonomy is frozen in 0062's §2 terms, and parity tests cover the
diagnostic families incl. unknown-code fallback.
