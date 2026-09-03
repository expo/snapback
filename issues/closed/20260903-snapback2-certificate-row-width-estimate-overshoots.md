# snapback2: certificate output/closure estimates overshoot real row width by ~50×

**Opened:** 2026-09-03 (Clique Pay lane, blind review measurement)
**Area:** `snapback2/crates/snapback2-core/src/certificate/output.rs`,
`bounds.rs` (row width accounting)

In the Clique Pay fixture (`fixtures/quarry-clique`), a conversation's
expenses page with a nested shares page per expense —
`expenses[c] last 20 { *, payerProfile, shares: shares[c, .id] first 50 { *, debtorProfile } }`
— is refused `E_BOUND: output bytes 14905678 exceeds ceiling 1048576;
product: … take 20 × take 50 = 1000` (closure 15434460 > 4194304). Even
`last 2` refuses at 1490926 output bytes. That is ~14.9 KB estimated per
share row (ten scalar columns, one `text <=100`, a two-field profile shape)
against ~300 bytes of real JSON. The feature shipped as two reads
(`convExpenses` twenty expenses, `expenseShares` per expense) and the spec
records that shape on purpose, so this is not blocking; it is the accounting
that makes a modest 1,000-row nested page look like 15 MB.

Ask: derive per-row width from the declared column bounds (`money` is an
integer, `time` an integer, a `text <=100` at most ~400 bytes, a shape of two
bounded texts likewise) instead of the flat 32-bytes-times-something the
current estimate seems to apply, and pin the fixture's nested shape (or a
synthetic 20 × 50 one) certifying under the 1 MiB ceiling. Keep the
ceilings; fix the estimate.

## Resolution — 2026-09-03

Resolved by the `s2/row-width` lane, landed as `fc450e4cc` (merged with the
LLP 1010 amendments on the way to main). Known row projections now use declared column widths in
both output and closure estimates, while `Get` and `*` retain the whole-row
bound and unknown bases keep the conservative fallback. The real Clique
compiler/certifier pin certifies the focused 20 × 50 shape at 822,692 output
bytes and 821,450 closure bytes; the shares `{ * }` twin remains an `E_BOUND`
refusal at 1,820,692 output bytes (1,879,850 closure bytes with raised
ceilings). `estimate_row_width.rs` executes maximum-width rows spanning every
column type and checks the canonical result against the new and old bounds.
