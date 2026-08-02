# 0062-07: ibex-side contracts for the one-file executable

**Status:** OPEN — coordination ticket; the ibex repo owns the work.
**Authority:** LLP 0062 §6 phase 2 (the author's 2026-08-01 one-file
direction); ENG-25410/25411 (the filed-not-landed ibex 0028/0029
correcting amendments).

What Snapback needs from ibex, precisely: (1) the 0028 correction
(its citation of this RFC predates §6's scoping — no phase-1
embedded-Ibex or computed-import requirement exists); (2) the 0029
correction ("prototypes the Snapback CLI" lacks the external-script
lane); (3) the NEW reviewed extension — the author-direction gap: a
trusted embedded parent admitting one caller-selected local TS/JS file
as a separately attributed restricted principal, transformed under the
pinned 0028 toolchain, granted only the broker capability, with the
worker filesystem/network/import/clock/subprocess/environment posture
stated as enforced policy and the threat model honest per ibex
0013/0014 (supply-chain authority, not hostile-code sandbox).

Done when: the three ibex-side documents land reviewed in the ibex
repo and this ticket records their identifiers; 0062-08 unblocks.
