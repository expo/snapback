# Writes — E_WRITE_ID_REUSE

Reusing an id with different operation names or JSON arguments returns local
`E_WRITE_ID_REUSE` while the client knows the input: unresolved submissions,
its last 256 terminal input identities, or its recovered outbox. Object key
order does not matter. This refusal does not replace the original write or emit
a terminal event for it. A receipt recovered after reopen holds no arguments,
so it returns the original outcome without comparing inputs. When neither
outbox nor receipt knows an id, the request reaches the server: its record is
keyed by principal and mutation id, and an existing record wins even if the
operation or arguments differ. Use a new id for a new intent. A client remembers
used ids for its lifetime (ids only after the bounded input/receipt window);
if a known id has lost its receipt and left the outbox, it refuses
`E_WRITE_RECEIPT_EXPIRED` instead of admitting it again. Reopen to recover that
outcome through the server. The server guarantee belongs to that backend store.
An online `createApp` journal separately preserves ids retired after a store
change, including sent ids displaced to make room for retirement receipts,
so reopening cannot replay those writes on the replacement store:
evicted bodies return `E_WRITE_RECEIPT_EXPIRED` without dispatch. It keeps up to
4,096 compact retirement ids; saturation durably blocks new admissions until
the application reconciles prior outcomes and explicitly replaces that journal,
rather than forgetting ids automatically. Already-admitted intents remain
recoverable as pending while their outcomes are unresolved.
Online intent records its dispatch store before transmission. A failed receipt
save preserves the known terminal outcome for mutate, lookup and notification;
reopening may resend that intent only to the acknowledging store, whose replay
record prevents double execution. Persisted terminal receipts are not reposted.
A replacement retires old-store intent with an unknown-outcome refusal; an old
unbound intent may replay only to the first store its journal has seen.
For a caller-supplied id with no local outcome, a prediction or validation refusal
queues the write without a row so the server can answer from its replay record.
The journal preserves this replay eligibility through navigation. If the server
has no record, it executes or refuses the write against its current state.
Separate live web tabs have separate outboxes; the server deduplicates their
requests under the same principal and id. Different principals may use the same
id independently.
The server's own code for a reused id is `E_ID_REUSED` (HTTP 200,
`{state: "failed"}` from `/m/<op>`), which a wire client sees instead.
