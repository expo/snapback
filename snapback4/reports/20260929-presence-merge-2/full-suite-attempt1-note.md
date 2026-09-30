# First full-suite attempt: interrupted during file teardown

The required command ran at source merge `f45697974ce19f5c505c03af813249f153009253`.
All pre-client stages and the complete Rust run passed. At interruption the
buffered client log had 3,200 passing entries and no failure entries, but
`per-row-react.test.mjs` had not exited after all five assertions/tests passed.
Read-only inspection found its Node child (PID 90976) and a native device child
(PID 96034) still alive after the app server and browsers had closed. The
fixture kept only its latest opened process handle. An earlier handle could
therefore be abandoned on a browser/development-server reload.

The owned exec session was interrupted with Ctrl-C (exit 130), and its process
subtree exited. The suite cleanup removed the buffered client log; the retained
`full-suite-attempt1.log.gz` ends at the completed pre-client/Rust stages. The
3,200 count and process evidence above were observed live, not reconstructed
from that retained log. This incomplete run is not qualification evidence.

The fixture now assigns each bridge opening its own handle and retains every
opening promise for teardown. A forced process-host browser reload verifies
that another handle is created before the existing 1,000-row write assertions.
No product code, deadline, expected count or assertion was relaxed. The full
suite is restarted from its beginning after the focused fixture check passes.
