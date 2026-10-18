# Integration 16 schema census

All 150 schemas compile before and after; every original module hash is unchanged.

| Code | Wave15 0.4.31 | Wave15 0.4.32 | Wave16 0.4.31 | Wave16 0.4.32 |
|---|---:|---:|---:|---:|
| N_CASCADE_DORMANT | 7 | 7 | 0 | 0 |
| N_CONDITIONAL_COMPLETE | 3 | 3 | 7 | 7 |
| N_DELETE_RESTRICTED | 3 | 3 | 0 | 0 |
| N_IMMUTABLE_PATCH | 14 | 13 | 12 | 12 |
| N_LOOKUP_HIDDEN | 0 | 0 | 7 | 7 |
| N_MAINTAINED_COLUMN_DISCLOSURE | 2 | 2 | 0 | 0 |
| N_MAINTAIN_AUTHORIZATION | 3 | 3 | 0 | 0 |
| N_MAINTAIN_DELTA | 14 | 14 | 9 | 9 |
| N_MAINTAIN_SYNCED | 2 | 2 | 0 | 0 |
| N_NEVER_COMPLETE | 16 | 16 | 21 | 21 |
| N_NO_CURSOR | 257 | 250 | 23 | 23 |
| N_NO_HORIZON | 14 | 14 | 0 | 0 |
| N_NO_PRODUCTION_WRITER | 51 | 51 | 0 | 0 |
| N_PATCH_CLEARS | 2 | 2 | 0 | 0 |
| N_PROBE_ONLY_READ | 2 | 2 | 0 | 0 |
| N_QUERY_FILTERED | 0 | 14 | 0 | 29 |
| N_REFERENCE_UNCHECKED | 8 | 7 | 0 | 0 |
| N_REQUIRE_HIDDEN | 0 | 0 | 1 | 1 |
| N_REQUIRE_REFUSED | 0 | 1 | 0 | 0 |
| N_SPARSE_FILTER | 31 | 31 | 5 | 5 |
| N_SYNC_ORDER | 7 | 7 | 0 | 0 |
| N_UNREADABLE_PROBE | 16 | 16 | 13 | 13 |
| N_WIDE_MERGE | 0 | 0 | 4 | 4 |

Wave15 matches LANG4 exactly: 452→458, with cursor−7, immutable−1, reference−1, query-filtered+14 and require-refused+1. RULES5’s 452 is the pre-LANG4 control on these inputs. LIVE’s 372 uses a different wave14 corpus (001-scaffold-tag-board rather than 001-weld-coupon-quals), so it is not a competing wave15 total. Wave16 changes only by 29 query-filtered notes. Full per-schema findings and hashes are in schemas.json.gz.
