# Source capture correction

The first post-builder source capture admitted two credential token files
because its filename exclusion was incomplete. The orchestrator moved that
capture into the ignored private run quarantine before any repository copy.
No credential value was printed or copied into this result record.

The external helper was tightened to exclude token-named credential files;
the corrected helper SHA-256 is
`16ba39c30917e9417177d63fb3fecb38e57a8c0ae862ea90b73a59c4a2361cf5`.
The canonical replacement capture at
`/Users/ccheever/clique-sb4-20260913-full-3models/snapshots/grok-continuous`
contains 228 source files and records 18 excluded paths. Its source archive is
SHA-256
`a99a15e1f9464d0185decf06eea30b78bcf39d8459861349f2ba5ac29f43fa7f`.
The canonical inventory and tar members were checked to confirm that the two
credential files are absent. The source archive remains external; the
repository retains its corrected manifest and digest pointer.
