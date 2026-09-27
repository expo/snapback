# Snapback 4: live token minting — remaining test gaps (lane TK, Lows)

Opened 2026-09-27 at TK's landing. Severity: Low (tests only; the product fails closed).
Source: `~/sb4-intent/reviews/tk-r1.grok.md` (READY WITH CHANGES) and the supervisor's reading.
The other reviewer family could not review this security code.

1. **The `[::]` test assumes a dual-stack host.**
   `ipv6_wildcard_refuses_ipv4_mapped_loopback_and_remote_peers`
   (`crates/snapback4/tests/token_live.rs:390`, connecting at `:100`) unwraps
   an IPv4 connection to a server bound to `[::]`. It passes on Linux
   (`net.ipv6.bindv6only = 0`) and on the supervisor's macOS host (13/13).
   A host with `IPV6_V6ONLY` on by default refuses that connection, and the
   test panics before the `::1` mint. Fix: when the IPv4 connect fails,
   assert that no session was inserted and continue. Assert 403 only when the
   connect succeeds.
2. **A lost completion reply is untested.**
   Changing `mint_live` to mint offline when the second `exchange` fails
   (`src/serve_token.rs:168`) passes every test. Add a test that accepts the
   completion, drops the response, and asserts exactly one session and no
   offline writer.
3. **Accepted, not fixable by test:** replacing `verify_slice` with `==`
   survives, because nothing measures timing. A leaked tag is not the file
   secret and cannot open the sealed reply.
4. **Accepted:** a local process that can stat the store's directory can
   compute the store identity. It can then fill the 128-entry challenge table
   (10 s TTL) and deny minting for up to 10 s. It cannot mint or learn a
   proof.
