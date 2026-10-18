# Integration 17 schema survey

All 150 unchanged schemas pass `check --json` on merged0.4.33: wave15 100/100, wave16 50/50, zero diagnostics. Every original module hash matches Integration16 and was verified again after checking private copies. Source directories, all flat .q modules and module names are preserved.

Ordinary compiler notes:

| Code | Wave15 0.4.32 | Wave15 0.4.33 | Wave16 0.4.32 | Wave16 0.4.33 |
|---|---:|---:|---:|---:|
| N_CASCADE_DORMANT | 7 | 7 | 0 | 0 |
| N_CONDITIONAL_COMPLETE | 3 | 3 | 7 | 7 |
| N_DELETE_RESTRICTED | 3 | 3 | 0 | 0 |
| N_IMMUTABLE_PATCH | 13 | 13 | 12 | 12 |
| N_LOOKUP_HIDDEN | 0 | 0 | 7 | 7 |
| N_MAINTAINED_COLUMN_DISCLOSURE | 2 | 2 | 0 | 0 |
| N_MAINTAIN_AUTHORIZATION | 3 | 3 | 0 | 0 |
| N_MAINTAIN_DELTA | 14 | 14 | 9 | 9 |
| N_MAINTAIN_SYNCED | 2 | 2 | 0 | 0 |
| N_NEVER_COMPLETE | 16 | 16 | 21 | 21 |
| N_NO_CURSOR | 250 | 250 | 23 | 23 |
| N_NO_HORIZON | 14 | 14 | 0 | 0 |
| N_NO_PRODUCTION_WRITER | 51 | 51 | 0 | 0 |
| N_PATCH_CLEARS | 2 | 2 | 0 | 0 |
| N_PROBE_ONLY_READ | 2 | 2 | 0 | 0 |
| N_QUERY_FILTERED | 14 | 14 | 29 | 29 |
| N_REFERENCE_UNCHECKED | 7 | 7 | 0 | 0 |
| N_REQUIRE_HIDDEN | 0 | 0 | 1 | 1 |
| N_REQUIRE_REFUSED | 1 | 1 | 0 | 0 |
| N_SPARSE_FILTER | 31 | 31 | 5 | 5 |
| N_SWEEP_DEADLINE | 0 | 30 | 0 | 16 |
| N_SYNC_ORDER | 7 | 7 | 0 | 0 |
| N_UNREADABLE_PROBE | 16 | 16 | 13 | 13 |
| N_WIDE_MERGE | 0 | 0 | 4 | 4 |

Ordinary note totals: wave15 458→488 (+30 N_SWEEP_DEADLINE), wave16 131→147 (+16 N_SWEEP_DEADLINE). Every preexisting code count is unchanged from0.4.32. LANG4’s same-input 452→458 reconciliation remains intact: cursor−7, immutable−1, reference−1, query-filtered+14, require-refused+1. RULES5’s452 is pre-LANG4; LIVE’s372 is the different wave14 corpus, not these wave15 schemas.

New independent security analysis is reported in the JSON `security.notes` field, separately from ordinary `notes`:

| Code | Wave15 | Wave16 |
|---|---:|---:|
| N_ARGUMENT_GRANT | 106 | 63 |
| N_BROAD_READ | 200 | 51 |
| N_EXISTENCE_ORACLE | 402 | 247 |
| N_GRANT_OUTLIVES_ROLE | 134 | 147 |
| N_OPTIONAL_EVIDENCE | 19 | 17 |
| N_SECURITY_INTENT | 100 | 50 |
| N_SWEEP_ONLY_DEADLINE | 23 | 8 |
| N_VACUOUS_RULE | 0 | 1 |

Security notes total984 and584. All 150 schemas declare zero invariants. Each receives exactly one N_SECURITY_INTENT aggregate note; none fails compilation or receives a proof claim. Exposures and advice are observations about unspecified intent, not demonstrated security defects. Full findings/hashes are in schemas.json.gz; source/binary binding in binding.json.

Command: `timeout 1800s python3 /home/ccheever/sb4-loop/prewave17/integ17-survey.py` (exit0). Every CLI child uses `timeout 120s`.
