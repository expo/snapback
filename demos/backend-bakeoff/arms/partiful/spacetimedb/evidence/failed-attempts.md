# Retained failed attempts

The failures below were encountered in this arm and informed the final path.
They are not rewritten as successful evidence.

1. `spacetime version` returned CLI usage (exit 2); the correct version probe is
   `spacetime --version`.
2. Non-interactive `spacetime init` without the positional project name failed;
   adding `partiful-spacetimedb` succeeded.
3. `npm install spacetime@2.7.0` failed with `ETARGET`; the official package is
   `spacetimedb@2.7.0`.
4. `spacetime build --project-path ...` failed because the correct option is
   `--module-path`.
5. Binding generation with `--server` failed because generation reads a module
   path, not a deployed server.
6. The first authoritative SQL used a scalar subquery, which SpacetimeSQL did
   not accept. Separate direct count queries replaced it.
7. A rerun created new SDK identities and persona claims were rejected. Actor
   credentials are now kept only in ignored, mode-0600 arm custody and reused.
8. A partial RSVP made the seed assertion’s exact RSVP count stale. The
   assertion now checks the required rows rather than assuming an untouched
   target.
9. The native procedure HTTP client rejected the first loopback effect target:
   `HttpError: refusing to connect to private or special-purpose addresses`.
   The direct diagnostic is retained in the server log; an arm-lifetime public
   Quick Tunnel was required.
10. A server helper based on the browser `URL` global rejected the public
    target in the module runtime. A narrow HTTPS hostname expression replaced
    that unsupported assumption.
11. Starting a Quick Tunnel and immediately scheduling produced a DNS lookup
    failure. The harness now proves the tunnel is externally ready before
    invoking the procedure.
12. The receiver’s accepted-then-dropped response surfaced through the tunnel
    as HTTP 502. Treating that as definitive failure was incorrect; 5xx is now
    retained as ambiguous and retried with the same key.
13. The first RSVP performance sample inherited the functional capacity
    winner and could legitimately exceed capacity. A documented authoritative
    reset now precedes that measured path.

Final cleanup does not reuse the malformed negative probe seen in an earlier
arm. It invokes positional database grammar, rejects any `Usage:` diagnostic as
proof, and retains that syntax check.
