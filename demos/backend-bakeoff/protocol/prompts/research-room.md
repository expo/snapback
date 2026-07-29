# Neutral build prompt: Collaborative AI research room

Build the frozen research-room shell with the assigned backend's idiomatic
database, auth, authorization, files, search/vector, realtime/streaming,
actions/functions, scheduling, secrets, and deployment path. Do not introduce
a shared provider abstraction.

Alice and Bob are room members; Mallory is an outsider. Seed the dataset in
`workloads.v1.json`. Implement authorized source upload, metadata, deletion,
keyword search, provider-native semantic retrieval or an explicit GAP,
questions with four durable authoritative progress updates before completion,
answers citing source records, two-member live observation, idempotent retry,
and distinct complete/failed/cancelled/timed-out/ambiguous states. Confirmed
cancellation must prevent late durable patches. A scheduled refresh fetches an
external source and records durable progress without exposing secrets.

Use the frozen deterministic 32-dimensional embedding and deterministic stream
for acceptance. A real-model hosted run is optional and reported separately;
it cannot replace deterministic proof or improve the product score by itself.

Run every scenario in `acceptance/research-room.v1.json`. Preserve file,
search, progress, cancellation, settlement, outsider, secret-redaction, target,
and cleanup evidence. Stop immediately on an LLP 0102 Stop-class defect.

The timed diagnostic budget is 480 active minutes and 400 tool calls, followed
only by a separately labeled untimed extension.
