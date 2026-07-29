# guide-gap draft: sessions + bounded streamed actions cannot be deployed

The guide independently teaches sessions-mode startup and bounded streamed
actions on the local target, but it does not warn that their combination is
rejected at the frozen commit. A generated sessions artifact with
`bounded_response_stream_v1`, produced and served under
`SNAPBACK_OUTBOUND_ACTIONS=1`, fails before readiness with
`SNAPBACK_CAPABILITY_UNSUPPORTED`.

The immediate need is a product fix, not merely prose. Until fixed, the guide
should either carry a composition GAP or an executable sessions-plus-streaming
witness. After the fix, the witness should cold-start the exact generated pair,
mint two sessions, stream authoritative progress to the second member, cancel,
and prove no late durable patch.

Separate discoverability gap: `guide/backend/actions-and-fetch.md` says to
enable egress for the deployment/process, but generation also requires
`SNAPBACK_OUTBOUND_ACTIONS=1`; otherwise codegen emits
`BUNDLE_UNSUPPORTED_FETCH`. The repair text should show the generation command
and runtime command side by side.
