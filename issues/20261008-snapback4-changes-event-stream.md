# Snapback 4: `/changes` as an event stream, so Exact apps stop polling on a timer

Status: Open
Date: 2026-10-08
Scope: the HTTP host's `/changes` (crates/snapback4, serve/dev); coordinating owner of the seam: Exact2 [LLP 1110](https://github.com/ccheever/exact2/blob/main/llp/1110-live-snapback-reads.rfc.md) (Draft)

An Exact app sees other viewers' writes only when it asks again. In the app
farm's client arm (Exact2's first-party Snapback client, 26+ apps built by
GPT-6.1-sol and Muse builders, diaries under `~/appfarm` on the M5 Ultra
Studio), every app that showed updates without a tap did it with a Contract
`task` that re-syncs every 2–15 seconds; in the hand-written arm, 61 of 109
apps polled on a timer. None held `GET /changes?wait`: an Exact data answer
is bounded, and an answer in flight holds the agent's `clock settle`, so a
held long poll stalls every test (quiet-tent-capacity-0966,
pto-coverage-planner-0432, studio-door-0755). Exact already has streams that
do not hold `settle` once their first message lands (Exact2 LLP 1016.000 D5):
server-sent events and listen-only WebSockets.

Ask: `GET /changes?stream` (or `Accept: text/event-stream`) that holds the
response and sends one event per movement of the viewer's head, with the
cursor as the event `id` (so `Last-Event-ID` resumes), heartbeats between,
and the same credentials, admission and interest as `/changes?wait`. Events
may coalesce; a reader needs only the newest cursor. State the bound on open
streams per principal and per host, with a refusal a client can show: the
host reserves 32 long-wait workers today, and a stream that pins one while
idle would exhaust them at 32 viewers.

Design of the Exact side (a stream source in the client, resources re-asked
by the stream's sequence) is in LLP 1110; it needs nothing else from Snapback.
