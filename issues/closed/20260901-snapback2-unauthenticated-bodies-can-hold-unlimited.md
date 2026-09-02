# snapback2: unauthenticated bodies can hold unlimited HTTP threads

**Status:** Closed
**Resolution:** Control loopback/secret authentication now precedes body reads and HTTP workers are capped at 64 in snapback2/crates/snapback2/src/serve.rs; a 32-client slow-body integration test proves prompt 403 responses without bodies plus a worker-ceiling unit test.
**Systems:** snapback2, HTTP, control security, resource handling
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/serve.rs:77-94

Failure scenario: local clients open many POST /control/reset connections with a declared body and then trickle or never send it. The server creates one OS thread per request, and each blocks indefinitely in read_body before the X-Snapback-Control secret is checked, exhausting threads/memory.

Why it happens: the accept loop has no worker bound, sockets have no read deadline, and handle reads up to 1MiB at lines 134-168 before authenticating control headers. Loopback restriction does not protect against another local process or accidental clients.

Suggested fix: authenticate control headers before body reads, set header/body read deadlines and rate/size limits, and bound concurrent request workers. Add a many-slow-body test that proves bounded resources and 403 without consuming bodies.
