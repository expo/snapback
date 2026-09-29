# Consider an explained offline refusal for one-shot server-only queries

Status: Open
Date: 2026-09-29
Systems: Snapback 4 client / server-only query recovery
Related: LLP 3000.017; LLP 3000.011.005.000 §2; LLP 3000.030 §12

Published snapback4@0.4.7 one-shot `client.query` returns `loading` for an
unavailable ephemeral/server-only read while offline. The cal25 native
witness reproduces this with `chat.typingInMyRooms`; an `E_OFFLINE`-style
explained refusal might serve one-shot callers better than indefinite loading.

Investigate the one-shot contract, including observer behavior, reconnect and
existing recovery tests, before choosing a semantic change. This is separate
from smoke classification: compiler-declared server-only operations are
expected to be unavailable offline and must answer online. NP-mac round 1
changes witness classification only and does not change client semantics.
Evidence: snapback4/reports/20260929-np-macos-slice/round1/REPORT.md and the
original round-0 loading receipts.
