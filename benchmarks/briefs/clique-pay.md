# Brief extension: Clique Pay (wallets and bill splitting)

**Status:** Active extension of `social-messenger.md`. Authored 2026-09-03 at
the author's request ("add a feature to Clique that would work out Decimal
and Money"). It is **not** a milestone of the reduced run (M1–M3) or the
full run (M1–M8) and enters neither completeness denominator; it exists to
exercise the exact value model of LLP 0329.014.004 (`money`, `decimal`,
Euclidean `divmod`, the deterministic share) at app scale, the way M1–M3
exercise the rest of Quarry. Prerequisite: M3 (groups, members, DMs).

Numbering: **P1** (P for Pay), so it never collides with a future M9.

## The feature, as a user sees it

Every Clique account has a **wallet** in US dollars. You can **send money**
to any other user with an optional note. In any conversation you can **add
an expense** ("dinner, $10.00, 18% tip, split among Alice, Bob, Carol"); the
app splits the tipped total into per-person **shares** to the cent, and each
person can **settle** their share from their wallet. The conversation shows
its expenses, who has settled, and the total spent.

No external I/O: there is no card, bank, or provider. Wallets are funded by
the seed (every persona starts with $100.00). The app never mints money
outside the seed.

## P1 — Wallets, sends, and split expenses

Spec:

- **Money is exact.** Amounts are `money USD` (scale 2). On the wire and in
  storage an amount is an integer of minor units (`250` is $2.50); the client
  formats. A fractional wire number is refused as input.
- **Wallet balance is a ledger sum.** There is no balance column. Every
  transfer writes one ledger entry per affected wallet, signed (a send
  writes `-amount` on the sender's ledger and `+amount` on the recipient's);
  a wallet's balance is the maintained sum of its owner's entries. A user
  with no entries has a balance of exactly zero.
- **Send:** `sendMoney(to, amount, note?)` requires a positive amount, a
  recipient other than yourself, and a balance of at least the amount
  (`INSUFFICIENT_FUNDS`, and the ledger is untouched on refusal). Both
  ledger entries carry the same commit time.
- **Add expense:** `addExpense(conversation, description, total, tipRate,
  participants)` in a conversation you belong to. `total` is money; `tipRate`
  is `decimal 4` (a rate: `0.1800` is 18%); `participants` are one to fifty
  users who must all be members of the conversation, without duplicates. The
  tip is `total * tipRate`, **rounded toward negative infinity** to the cent;
  the grand total is `total + tip`. Each participant's share is the
  deterministic share of the grand total: the Euclidean quotient for everyone,
  plus one cent for the first `remainder` participants **in ascending order
  of participant id**. Shares always sum to the grand total exactly. The
  payer's own share is created already settled.
- **Settle:** `settleShare(share)` by the debtor only, once
  (`ALREADY_SETTLED`), moves the share amount from the debtor's wallet to the
  payer's wallet through the ledger under the same balance rule as a send.
- **Reads:** your balance; your ledger (most recent first, with counterparty
  profiles); a conversation's twenty most recent expenses plus its total
  spend (the maintained sum of grand totals); one expense's shares with
  their settlement state; your open (unsettled) shares. Expenses and their
  shares are two reads on purpose: a page of expenses each carrying a page
  of shares exceeds the certificate's output ceiling, and the UI expands one
  expense at a time.
- **Privacy:** ledger entries are readable only by the wallet owner; a
  conversation's expenses, shares, and total spend are readable by its
  members only; balances are readable only by their owner.
- **One rounding law.** Every operation that can lose precision (`divmod`,
  the share, and multiplying money by a decimal rate) rounds toward negative
  infinity; the remainder is never invented and always recoverable.

Acceptance (all executed against the seed where Alice, Bob, and Carol each
start with $100.00 and share one group):

1. Alice sends Bob $2.50 with a note. Alice's balance is $97.50, Bob's is
   $102.50; each sees exactly one new ledger entry (`-250` / `+250`) and
   both entries carry the same timestamp.
2. Alice sending $1,000.00 is refused as `INSUFFICIENT_FUNDS` and no ledger
   entry exists afterwards; sending to herself is refused as `SELF_PAY`;
   sending $0.00 is refused as `NOT_POSITIVE`; sending a fractional wire
   amount (`2.5`) is refused as input.
3. Alice adds "dinner" for $10.00 at an 18% tip (`0.1800`) split among
   Alice, Bob, and Carol: tip $1.80, grand total $11.80, shares $3.94
   (Alice, first in id order), $3.93 (Bob), $3.93 (Carol); Alice's share is
   settled at creation; the conversation's total spend reads $11.80.
4. Rounding: "coffee" for $10.01 at 18% has a tip of $1.80 (not $1.81);
   "cab" for $0.02 at 18% (tip $0.00) split three ways gives shares of $0.01, $0.01, $0.00.
5. Bob settles his dinner share: Bob's balance falls by $3.93, Alice's rises
   by $3.93, the share reads settled with a time; settling it again is
   refused as `ALREADY_SETTLED`; Carol settling Bob's share is refused as
   `NOT_YOUR_SHARE`.
6. A participant who is not a member of the conversation is refused
   (`PARTICIPANT_NOT_MEMBER`); a duplicated participant is refused as
   input; a non-member cannot read the conversation's expenses or total.
7. Dave (seeded with no ledger entries) reads a balance of exactly zero and
   is refused `INSUFFICIENT_FUNDS` on any positive send.
8. A `.q` literal with more fractional digits than its scale (`0.12345` in a
   `decimal 4` position) is refused at `snapback2 check` time with a sited
   `E_DECIMAL_SCALE`, before any test runs.

Executor classes follow the parent brief: 1–7 are suite-required journeys;
8 is a check-time assertion.
