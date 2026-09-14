# Grok grade: Snapback4 client attribution audit

Date: 2026-09-14

This is a bounded static orchestration audit of the received Grok grade. It preserves the grader's findings while separately attributing the most relevant defects to the graded application or to Snapback4 0.2.6. It is not another assertion grade, a rerun, or a claim about evidence outside the listed public artifacts.

## Baseline and custody

- Published product baseline inspected: `342c53d306d7484cd64e820ee27a151e02eb4b0b`, where `snapback4/packages/snapback4/package.json` is version `0.2.6`.
- Post-publication comparison inspected: delivery revision `04ed8cab8eeca7decc3a25d46873d5a1fccab11d`. The pending-sync transport mismatch described below remains present there. This audit did not use mutable working-tree content for the 0.2.6 claims.
- Received grade: `lanes/grok-snapback4/grading/grader-report.json` (`sha256:30112e495f85977a396ae5fb6e53cbb4263b3d62471f3e04fdd320b234efc982`), `trace.md` (`sha256:d77ca21d509e33e6726c69da7e878bafda3d22d14a9b16e18f4de13c1d0bca1e`), and `DONE` (`sha256:ce82a0edc8772dab588e10eea38211f5fad3c005b17e3d3bac3cf13bf2452eb5`).
- Only public grader reports, public evidence, graded application source, and pinned product source were read. No probe or product edit was performed, and no private model/reasoning body was read.

## d-05: mixed application amplification and a real Snapback4 wire-bound mismatch

**Grader attribution.** Grok reports that the web conversation first delivered updates live, then stopped syncing after receipt mutations accumulated. The retained browser evidence records a `/sync?...pending=...` console entry truncated at 300 characters and a separate `net::ERR_FAILED`; it does not retain the full URL, the pending-ID count, the raw HTTP status, or a parser diagnostic. The “CORS block” label is therefore a browser symptom in the report, not a demonstrated root cause.

**Application cause.** `lanes/grok-snapback4/components/ConversationView.tsx:118-136` loops over every foreign server message and sends both `markDelivered` and `markRead` immediately and again at 400, 1,200, and 3,000 ms. The effect reruns when its message-ID or recipient-count dependencies change. That is eight writes per foreign message per effect execution, including already-settled receipts. It independently explains rapid durable-outbox growth and must be corrected in the application. Source hash: `sha256:06e9d57a35a485980fa28f55ab18251b375e106076009d5ff1bd63158d69c39d`.

**Product defect.** Snapback4 0.2.6 nevertheless promises a pending set that its own HTTP framing cannot carry at the documented bound:

- `snapback4/crates/snapback4-device/src/device.rs:336-347` returns as many as 256 unsent IDs (`sha256:605356dccd9e256bddc6eb8f538a47d623131af5a1d01959ff3cdc6e31349ef5`).
- `snapback4/packages/snapback4/src/local.ts:423-427` puts the complete JSON array into one percent-encoded GET query (`sha256:d4687c9d345687a22b34cb5f7ecebb56149a4219aa892a5c80b6d282664365f9`).
- `snapback4/packages/snapback4/README.md:937-943` documents `pending=[ids]` with at most 256 IDs (`sha256:eaa5d557bcb3a0e77b8a3f804d0f555d1aa9fa01dcf47beb970628d8e1e64072`).
- `snapback4/crates/snapback4/src/serve.rs:910-924` accepts 256 IDs of up to 128 characters each (`sha256:22ac491fb81c7a38783d7b474902fe060402a3d7185c31e9a85c0606e7c9f831`).
- `snapback4/vendor/tiny_http/src/client.rs:16,149-155,251-258` limits the complete request line to 8 KiB and answers a request-line parse failure with a bare 400 before routing (`sha256:62499b6065febe57053a284e32eef4e1a440d82d403e61846bba05527a0edb60`).

The exact 0.2.6 composition is `GET /sync?from=<watermark>&limit=4000&pending=${encodeURIComponent(JSON.stringify(ids))} HTTP/1.1`. The package’s `client.ts:45-64` mints 26-character base32 IDs (`sha256:e3217e8f5590c0bd1947bb351288164772237a8e4ee8d11591a2ceafff06381b`). For the fixed four-digit watermark `1091` and those 26-byte IDs, deterministic byte counts are:

| Pending IDs | Path bytes | Request-line bytes |
|---:|---:|---:|
| 232 | 8,158 | 8,171 |
| 233 | 8,193 | 8,206 |
| 256 | 8,998 | 9,011 |

Thus the documented 256-ID state is unwireable even with ordinary 26-byte IDs; 233 IDs already cross the 8,192-byte parser ceiling for that exact prefix. Watermark width changes the threshold by only its byte delta. The server's allowed 128-byte IDs make the maximum discrepancy larger.

The actual failed request's count and byte length cannot be reconstructed: `lanes/grok-snapback4/grading/work/grader-web-convo-diag.mjs:18-20` deliberately retains each console string only through `slice(0,300)` (`sha256:8c28c5cdf476b2b1e44b44bf12d3d7690c11a3fee0502186261bce2b5b39d870`). Its three final console entries have lengths 59, 300, and 40; the 300-character entry contains `/sync?` and `pending=`, and the 40-character entry contains `ERR_FAILED`. The claim that the observed request hit the 8 KiB parser path is a strong source-backed inference, not a retained wire observation. No raw response proves that the parser's bare 400 caused the browser's cross-origin message.

The post-publication delivery revision still builds the same GET at `local.ts:442-446`, caps at 256 in `device.rs:336-348`, accepts 256 in `serve.rs:940-945`, and uses the identical vendored parser hash. No fix was found in that inspected later revision.

**Disposition.** A narrow P1 Snapback4 follow-up is warranted for the pending-ack transport bound, alongside a separate application fix for receipt amplification. Acceptance should prove that every advertised pending state, including 256 maximum-length allowed IDs, reaches `/sync` with browser/native parity and preserves acknowledgement behavior. A narrow open/closed ticket search found no existing Snapback4 ticket for this mismatch. `issues/closed/20260913-snapback4-sync-stream-is-per-group.md` bounded request parsing as resource control, but neither its problem nor its resolution addresses the client/host pending-set incompatibility.

Evidence: `lanes/grok-snapback4/grading/evidence/web-convo-diag.json` (`sha256:77f0118f60074c66f0d88587ab8dd4d0c153b6f8582507223a08cce44fda910a`), `web-probes-2.json` (`sha256:281f172a85ca24bef12d3d4a73d0a554c76bdae75bdd58127e05306e765c6f86`), `web-probes-2.log` (`sha256:a0639de6cbab7ff649d88d48a0febb4aae1f6aeb92c22ead60a8e9baf8d490fc`), and `grading/logs/web.log` (`sha256:bdc621ae2661f5026614fc8c94e0bdc8f3438541fe4e90dd64d384620265f47a`).

## d-01: repost clearing is an application rule/modeling error

`lanes/grok-snapback4/snapback/schema.q:140-156` lets only each feed row's `readerId` read or delete it, while `setRepost` at lines 633-657 tries to point-read and delete every follower's row as the reposter. Those point reads correctly return no row under the declared rule; the later insert-if-absent collides with a hidden retained row. Snapback4 0.2.6 explicitly documents that outcome at `README.md:146-157`: a collision with an unreadable row returns generic `E_RULE`.

This is a concrete schema/authority contradiction in the graded application, not a Snapback4 client/host defect. The application needs a server-authorized fanout cleanup model or compatible delete authority. Evidence: `evidence/repost-recheck.json` (`sha256:8ba95bc98b261c3148b7e7e969908ea0f9473f916424c75e057571280d562d67`); schema source `sha256:1c0cd8576cc94e83ec0b4a08cb3b9d70cb1889d5040e8596e05c19c1c971b54a`. No product follow-up is warranted from this finding.

## d-02: signup collision recovery is an application workflow error

`lanes/grok-snapback4/lib/client.tsx:125-147` adopts the newly created session before attempting `upsertProfile` through a second client. If the derived handle collides, it records an error only after the account/session has become the active app state; the authenticated UI then has no recovery path for the absent profile. Snapback4 returns the profile write as a failed `Write`, which this code receives and handles too late to keep signup atomic from the user's perspective.

This is an application transaction/workflow error. The app should reserve or retry the handle before committing its onboarding state, or present an authenticated profile-completion recovery screen. Evidence: `evidence/web-m1a03-redo.json` (`sha256:50b4e1577c2297d1888a8565252d3e28d83737b1c60c7092f78394631c8f762f`); client source `sha256:c031f45e9521241f48c6f3643470f2962551de2a1172d305fefb045a3b7a4083`. No product follow-up is warranted.

## d-03 and d-04: DM poisoning and duplicate pairs are application schema errors

`lanes/grok-snapback4/snapback/schema.q:245-253` makes `(a,b)` an ordered unique key, and `createDm` at lines 664-674 trusts caller-supplied `a` and `b`; it checks only that the viewer occupies one slot and never proves that the other slot equals the `other` argument. That directly permits both unsorted duplicate pairs and the demonstrated third-party pair poisoning. Snapback4 enforces the rules and key exactly as authored.

The app must derive a canonical pair inside authoritative server logic and bind it to `{viewer, other}`. This is not a product client/host defect. Selected credential-clean results are retained in `evidence/api-probes.json` (`sha256:6ffbffd09abd187913d0e71d6a5b0db3afc8a492bdb2db88822480dc30ed66b0`) and `api-probes.log` (`sha256:40a942e8ef0904f5bdbceb7848d774d5692fbb7711f05f675a673f7b16557bd9`). No product follow-up is warranted.

## d-06 and d-14: the web feature loss and persistent overlay are application UI defects

`lanes/grok-snapback4/components/WebConvoSurface.tsx:41-77` appends a fixed, high-z-index node to `document.body`; its effect has no unmount cleanup. Lines 59-75 create a compact text-only surface and an attach button without an attach handler. Those choices explain both the missing media/actions in d-06 and the overlay covering the feed after navigation in d-14 without implicating Snapback4 transport or React hooks.

This is application UI/lifecycle code. Evidence: `evidence/web-overlay-nav.json` (`sha256:733d81a3eac26636c1b333287bc8f4c067c49b74066549af1917324db7844647`); source `sha256:4ae1485aae39a88f9e23ab7e31f09bf9e7e0ba85091692332f547357b72eba77`. No product follow-up is warranted.

## Result

Among the audited Grok defects, d-05 contains one corroborated new Snapback4 product issue: the pending acknowledgement set exceeds the product's own request-line envelope. Its benchmark trigger is compounded by clear application write amplification, and the retained failed request is truncated, so the exact observed pending count and parser response remain unresolved. The other reviewed clusters are directly explained by the graded application's schema, workflow, or DOM lifecycle and do not justify Snapback4 tickets.
