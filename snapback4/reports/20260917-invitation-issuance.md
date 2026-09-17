# Optional invitation issuance — 2026-09-17

This is source-qualified partial Identity work under LLP 3000.009 §7, not a
complete provider or application qualification. The optional fixture remains
outside the default OIDC recipe registry. Final source is
`c513bb98484e1f967fb180aaa7f5cba2e56832a6`; the integration retains the
corrected managed invitation policy from `e1536df94` and adds only its narrow
delivery-state query. Recipe and test bytes match the reviewed source.

The action first checks current administration and durably prepares a random
32-byte invitation token plus a frozen message/configuration fingerprint. A
stable managed-write ID records the invitation; the handler confirms the exact
row through a protected query rather than relying on mutation response values.
The provider step uses one stable key and body. Reconciliation checks current
authority, pending state, expiry, a conservative ten-minute window, and the
original configuration/key fingerprint before another provider attempt.
Unknown delivery behind a failed guard parks; it is never treated as absence.
Final ordinary results omit the token. The private preparation step and the
provider's message do contain it; privileged inspection is not global erasure.

The Resend adapter fixes the endpoint, refuses redirects, consumes at most
64 KiB of successful response bytes, shares the invocation abort lifetime and
observes body-cancellation rejection without waiting indefinitely. Oversized,
malformed or lost replies remain uncertain. Provider acceptance is not inbox
delivery, and the ten-minute action deadline is not a test of every possible
idempotency-horizon branch.

## Verification and reviews

The author ran 38 protocol-double tests with zero failures/skips in
370.188 ms under Office Node 24.18.0, plus syntax, strict helper TypeScript and
diff checks. Two earlier 34-pass/4-failure instrument runs remain in their
receipts. A weak initial overflow witness was subsequently replaced by a valid
multibyte JSON body above the byte ceiling, requiring two reads and one cancel.
These tests used existing ignored package output for public error classes;
they do not establish source-matched generated application compatibility.

Both independent initial reviews rejected unbounded response consumption.
Each original reviewer then examined its own repair delta and returned READY:
[Sol](../../llp/reviews/3000.009-b1d3-issuance.sol.md) and
[Grok](../../llp/reviews/3000.009-b1d3-issuance.grok.md). Root read the full
public answers and source. No reviewer test execution is claimed.

## Actual compile and generated-manifest gate

One bounded attempt on idle 450b passed from 18:01:51Z to 18:01:53Z on
2026-09-17, exit zero. The staged six-file recipe is byte-pinned separately
from checker source `8ba9a3c6eecae45134ea9ad91bbf72b6cfb88606`. The checker
remains a recoverable, not-yet-landed qualification instrument; its source
repair is `021a4a61e`, followed only by an append-only evidence correction.
That correction withdraws an unsupported native-author test-red narrative:
both actual recorded synthetic runs passed 7/7, not 5/7 then 7/7.

The actual CLI check returned `ok:true`, 11 tables and 30 operations in
1,049 ms. Strict TypeScript passed, and importing only generated api/server
modules proved the three root action registrations, declared secrets and
organization-operation manifests. The application entry was not imported or
started. Three advisory notes remain: the deliberately nonuniform
`adminInvitations` page (`N_NEVER_COMPLETE`) and two declared count channels
(`N_MAINTAIN_DELTA`). This is compile/manifest evidence, not runtime registry
adoption or authentication evidence.

The command used Node 24.13.1, CLI source `1e91bc7fe` with binary SHA-256
`7342e869fe475e0a4629c36b87f91beac262d4551b769773574903a4cb32f187`,
package source `7b2ad55a6` / version 0.2.27 with all 60 dist files pinned
by aggregate `32c44791e8972306a6ff27f4df84145da4b55a8fc41e30902a44b993e77c79d1`,
TypeScript 5.9.3 and Node types 22.20.2. The existing ancestor-resolved
openid-client 6.8.8 entry and metadata were pinned without installing or
changing the package. Implementation files were pinned, not just tool shims.
All source, tool and package hashes were independently unchanged afterward.

The source-only archive SHA-256 is
`0b0d6740fcf675c40fdfe769f26bb6370e9ccd506c4ee88404129419fc0046bf`;
actual receipt SHA-256 is
`a76f8302bdef7da43e4f6d4705090afc530f5ee7479c81d642d737b36c6f9b83`.
Private evidence remains under `/home/ccheever/sb4-b1d3-compile.i5QC0E`
on 450b, with verified control copies. The outer cap was 115 seconds plus
five seconds kill grace; compiler children had 35-second caps. All three
observed outer process identities were absent afterward and before/after
listener snapshots match. This is not a complete descendant-execution trace
or proof excluding every transient listener. No provider credentials, send,
application server or database mutation was involved.

## Remaining gates

Engine/HTTP authentication, before/after durable-step
cuts, actual provider uncertainty, default diagnostic secrecy, concurrent
acceptance, restart and rollback remain unqualified here. A real Resend send
requires an approved account/sender and consumes quota; none was sent by this
source work. Verification/recovery and full Identity remain open. No
publication or post-Workroom retain/remove decision follows.
