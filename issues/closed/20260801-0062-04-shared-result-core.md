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

---

**RESOLVED 2026-08-01.** All three "done when" items landed:

1. The dated LLP 0024 amendment (§Dated amendment: shared app-data
   result core) — `AppDataResultCoreV1` (Rust-owned,
   `src/app_data_result.rs`, committed
   `schemas/app-data.result-core.schema.json` under the drift gate, LLP
   0037 ownership recorded), the `appCliCallResult` wrapper-to-core
   mapping, the frozen per-kind mapping table, the reserved
   tagged-value extension point (v1 validation refuses it), and the
   MCP-catalog parity obligation stated. `SNAPBACK_APP_CLI_*`
   registered in LLP 0012's dialect same day.
2. Exit taxonomy frozen in 0062 §2's terms and implemented once in
   `packages/snapback-app-cli/result-core.mjs`; projections consume it
   (cli.mjs's exit path now classifies through the shared module).
   Parity: the cross-language anchor document is admitted byte-losslessly
   by the Rust authority (`engine_representative_document_round_trips`)
   and produced byte-identically by the engine constructor
   (result-core.test.mjs's stability assertion); attribution rides
   verbatim through core and wrapper; wrapper embeds the core
   byte-identically with envelope identity absent-not-null on dev.
3. Forward-skew residues frozen and tested: residue #8's per-locus
   fallback table (auth-shaped → 3, 5xx → 6, result/live/broker → 5;
   never 8; codes preserved + `unrecognized` marker) and residue #10's
   envelope-absent = exit 7 sub-cause (`SNAPBACK_APP_CLI_ENVELOPE_ABSENT`).

Evidence: `src/app_data_result.rs` tests 3/3;
`packages/snapback-app-cli` suite (package + attribution + result-core)
green; `artifact_schemas_v0` drift gate green with the new schema.
Deferred honestly: server-side emission of the core DTO on the HTTP
surface (the "core parity byte-identical across HTTP" full gate rides
0062-02 step-4 / 0062-03's settlement remainder, which will construct
cores from real wire responses); the MCP catalog does not block phase 1
per the amendment.
