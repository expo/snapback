# Neutral build prompt: Realtime group chat

Build the frozen Chat shell into a working React web application using the
assigned backend's idiomatic recommended path. Keep provider-specific schema,
queries, mutations, subscriptions, auth, presence, deployment, and generated
code visible. Do not normalize through a shared gateway or count polling as
native push.

Use native auth for Alice and Bob (members) and Mallory (outsider). Seed two
public and two private channels with 125 messages per channel. Use stable
25-message cursor pages. Messages require server-authoritative identity,
author, timestamp/order, and deterministic concurrent-send ordering.

Prove native realtime in a second connected client, private-channel refusal,
typing and presence through an ephemeral provider path where one exists,
reconnect without duplication, offline readability of loaded history where
supported, correct two-client unread state, stable pagination under a
concurrent insert, and cessation of protected delivery after logout or
membership removal. A durable typing row is allowed only when clearly
documented as application glue, not attributed to a native ephemeral feature.

Run every scenario in `acceptance/chat.v1.json`. Retain authoritative checks,
transport attribution, target identity, expected-check count, command results,
and cleanup proof. An explicit GAP is evidence, not a pass. Stop on an LLP 0102
Stop-class defect.

The timed diagnostic budget is 240 active minutes and 200 tool calls, followed
only by a separately labeled untimed extension.
