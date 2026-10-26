# REL2 copied-store release replay

This report compares the untouched initial-main 0.4.42 production-feature build
with REL2. Neither the version nor publication state changes. `summary.json`
contains counts and the eleven wave-29 extraction shapes; the compressed lane
manifests retain every measured transition and row-shape result. Sample row ids
are removed from the retained manifests; no credentials or database bytes are
included. `false-refusal-fixtures.json` records the separate before/after
reproductions of the two historical authoring refusals and stale roster marker.

`measure.py` copies all 50 Snapback production stores in each of waves 25, 27 and
29. Source DB/WAL files are checked with `lstat` and copied, never opened in
SQLite. Release store links are retargeted into the copy; a second regular-file
check precedes the copied WAL checkpoint. Credential/owner/control sidecars are
excluded. Saved client compatibility baselines are copied as Quarry sources,
including baselines outside `versions/`. No service, browser or real identity
endpoint is started/contacted.

Per lane: inspect; normalize forward; deploy working source; preview explicit
exact v1; preview/default rollback to v1; deploy forward; repeat default rollback
and forward. The five reported moves exclude normalization and previews. The
predecessor census includes active and dormant row ids before deployment and
checks them after both successful rollbacks, following declared table identities.
Preview/listing/live shape fields must agree. All eleven wave-29 extraction
choices and fields additionally agree with an independent source-column census.

The frozen stores include builders' workarounds. They cannot recreate an earlier
refused authoring attempt; the list widening and circular save-version tests run
both initial and candidate binaries on equivalent fresh fixtures. Roster recovery
uses a synthetic roster and mocked identity responses, not production credentials.

Run from the repository root:

```sh
python3 snapback4/reports/20261026-rel2/measure.py --binary /path/to/pinned/snapback4 --out /tmp/replay.json --workers 12
python3 snapback4/reports/20261026-rel2/summarize.py /tmp/before.json /tmp/after.json
```

Known retained true-refusal families are documented in REL's prior report:
wave25/004 (removed/defaulted media), /024 (undeclared reversible media custody),
/030 (visibility without a truthful projection), /045 (pending individual security
decision), wave27/012 and /042 (historical write audiences exceeding current
column authority). The verifier permits these signatures, but never masks a new
refusal as one of them. A previously refused transition may succeed if a truthful
guarded view now serves it. The final workstream report gives exact residuals and
selector evidence. No full-battery, publication or Mac qualification is claimed.

Final default rollback counts (exact / view / truthful refusal), before → after:

| Wave | Before | After | Hidden v1 rows | False refusals |
|---|---|---|---:|---:|
| 25 | 33 / 14 / 3 | 33 / 14 / 3 | 0 | 0 |
| 27 | 30 / 18 / 2 | 30 / 18 / 2 | 0 | 0 |
| 29 | 27 / 23 / 0 | 28 / 22 / 0 | 0 | 0 |

Both final rollback cycles expose consistent preview/listing shape fields in all
290 successful rollback populations. All eleven extraction shapes match the
independent predecessor-column census: 040 preserves v1; the other ten disclose
the omitted v1 payload columns. Across 750 attempted release moves, 732 succeed;
the remaining eighteen are the documented truthful refusal families above.

Final runtime source is `809a7e9a81`; its fourteen runtime hashes match the
verbatim dual READY review composition r15/r16/r18/r20. All 58 rollback cases
pass, including safe restoration after intervening narrowing, finite A/B deploy
reuse, every retained qualification alias and fail-closed hiding-policy mismatch.
The five corrected client files pass 556/556. No ordinary source-origin cutoff
discards committed rollback obligations.

Reproduce stale roster behavior against actual initial-main TypeScript, using
only synthetic identity replies (build the current SDK first):

```sh
node snapback4/reports/20261026-rel2/roster-before-after.mjs
```

`roster-before-after.json` retains the source hashes and before/after outcomes,
never sessions or account secrets. The compressed list/save fixture logs bind
the actual rebuilt initial-main control to the candidate assertions. Original
150-store baseline manifests remain unchanged; newer intermediate replays are
superseded by the final after manifest. Local pins and proof logs are preserved
under ignored `target/rel2-evidence/`.
