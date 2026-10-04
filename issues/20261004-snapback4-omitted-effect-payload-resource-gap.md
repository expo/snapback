# Omitted effect payloads can exceed the server meter after device prediction

Status: Open
Date: 2026-10-04
Scope: Snapback 4 effect-only prediction (LLP 3000.013 §12.3)
Origin: Lane RP round 5, explicitly retained by the author's actual-value option

An infallible point read used exclusively by an effect payload and its private
local bindings are omitted on the device. The server executes and charges their
actual values. A sufficiently expensive payload loop can therefore predict a row
on the device and later receive an atomic `E_BOUND` refusal from the server.
Settlement must roll back that provisional row. No effect from the refused
transaction is committed. This is a resource-admission mismatch, not an authority
or receipt-state escape.

The ordinary-note counterexample below is **pre-existing on unmodified main `a8c20c40e9`** and on RP
round 3 `7fc57283b3`, independently rerun on eb1000. It has the same meters after
round 5. Round 4's fixed declared-maximum prices closed it but refused ordinary
50-member group sends in both real calibration apps. The author expressly
allowed restoring the former actual-value behavior on both hosts and tracking
this pathological case separately. Runtime once-key accounting and all other
reservation repairs remain in force; no meter ceiling increased.

Reproduction (the full compiled source, seeds/pages and server oracle are in
`snapback4/crates/snapback4-lang/tests/fixtures/rp-effect-payload-gap.json`):

```quarry
effect pinged
table profiles:
  name: text <=2000
  public
  online only
# Seed profiles['p'].name to 2,000 ASCII characters.
# notes is an ordinary fully synced, insertable table.
mutation burst():
  insert notes { room: 'c', shots: null }
  for n in range(0, 600):
    emit pinged { n, label: sha256(profiles['p'].name ?? '') }
```

Memory, SQLite and wasm predict one note. The server refuses at `burst:4:3`,
`E_BOUND` steps: **1,001,466 / 1,000,000**, with heap **6,336,802 B**,
497 examined, 1 index entry, 0 rule probes, 0 output bytes and 1 metered write.
The note and outbox remain empty on the server. The test asserts this exact
behavior, rather than ignoring or silently removing round 4's 600-payload case:

- `cargo test -p snapback4-lang --test declarative_receipts documented_payload_gap -- --nocapture`
- `node --test packages/snapback4/test/reservation-parity.test.mjs`

The passing reservation differential uses the same payload shape at 40
iterations; the 600-iteration exception is reported separately. Regression
coverage for ordinary traffic uses the **complete unchanged** 0.4.11 and 0.4.12
calibration schemas, 50 members, realistic profiles and hello/realistic/1,999-char
messages. All seven server meters must stay no worse than round 3. Those cases
also run on memory, SQLite and wasm.

A future repair must preserve those headroom assertions. A declared maximum
must not multiply entire row bounds through field selection, conflate read-rule
JSON length with expression visits, ignore literal slices, or accumulate
reusable read scratch once per recipient. Blindly raising the meter or restoring
round 4's reservations is not a fix. Private payload values and formulas must
remain off devices; authority, expiry, maintained-value reads, refusal and
once-key conditions must retain their real read path.

Evidence retained outside git: `/tmp/rp-r5-pre-rp-gap.log`,
`/tmp/rp-r5-r3-gap.log`, `/tmp/rp-r5-gap.log` and
`/tmp/rp-r5-tight-prototype.patch` on eb1000. No machine outside eb1000 was used.

## Receipt-derived exposure (RP round 6)

RP widens prediction exposure for pathological payload sizes. Append an
online-only `profiles` table (`name: text <=2000`, public) and this mutation
to the authentic `rp-predecessor/schema.q`, retaining its receipt-derived
`unreadCounts`. Seed profile `p` with 2,000 ASCII characters:

```quarry
mutation sendGap(conversation: conversations):
  insert messages { conversation, sender: viewer, text: 'gap', photo: null, at: now }
  for n in range(0, 495):
    emit notify { n, label: sha256(profiles['p'].name ?? '') }
```

Unmodified `a8c20c40e9` queues this receipt-derived writer; RP predicts a message.
At 495 payloads, the server refuses at **1,000,632 steps before RP** and
**1,000,680 steps with RP**. Both versions commit at 490 payloads and refuse at
495: that commit/refuse boundary is unchanged, while prediction exposure widens.
R3 and R5 have matching meters, independently measured in Astra's
`/tmp/rp-r5-astra-evidence/comparison.json` and receipt-gap logs on eb1000.

The permanent R6 regression runs 490 and 495 on memory and SQLite and exports
the 495 case to `rp-receipt-payload-gap.json` for wasm. It proves custody survives
restart and remains until the terminal response; retrying the same write id
returns the recorded `E_BOUND`. Refusal settlement releases the outbox entry,
removes the provisional message durably, and leaves exact unread zero. The
server commits neither message nor effect. Custody is preserved until a terminal
outcome, not retained as an unfinished write after acknowledged refusal.

Run `cargo test -p snapback4-lang --test declarative_receipts documented_receipt_payload_gap`
and the existing `reservation-parity.test.mjs` client test. This is an explicitly
asserted exception beside the passing differential, not a skipped failure or a
claim of universal device/server resource parity.
