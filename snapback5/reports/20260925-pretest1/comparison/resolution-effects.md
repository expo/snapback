# Numerical effects of the fixed resolutions

Every ruling in resolutions.md not named below changes zero class/raw counts in both families. Counts here are deltas on each original inventory, not additional units. Parent propagation is shown separately to avoid attributing the same parent change to several children. The exact changed ids, old/new classes and raw flags are in comparison.json. No resolution changes an idiom answer or any stop predicate.

| Resolution | Family | Group | Changed units (class or raw flag) | Δ post refusals | Δ raw refusals |
| --- | --- | --- | ---: | ---: | ---: |
| A-KEYS / B01 | blind | table_child | 104 | +104 | +104 |
| B04 (reference type required) | builder | table_child | 28 | +28 | +28 |
| B06 / A-BODY-CONTEXT | blind | plpgsql_body | 5 | -5 | -5 |
| A-IN-LIST | blind | plpgsql_body | 3 | -2 | -3 |
| A-EXTENSION / B25 | blind | top | 1 | -1 | -1 |
| A-UUID / B02 | blind | table_child | 19 | -19 | +0 |
| A-PROBE-CLASS / B14 / B16 | blind | top | 6 | +0 | -6 |
| A-EXPIRY | blind | top | 1 | +1 | +0 |
| A-UUID / B02 | blind | signature | 3 | -3 | +0 |
| A-PROBE-CLASS / B14 / B16 | blind | sql_body | 3 | +0 | -3 |
| A-BODY-CONTEXT (no signature taint) | blind | plpgsql_body | 9 | -9 | -9 |
| B21 / A-BODY-CONTEXT | blind | plpgsql_body | 1 | +1 | +1 |
| A-NULL | blind | plpgsql_body | 1 | +1 | +0 |
| A-PROBE-CLASS / B14 / B16 | blind | plpgsql_body | 5 | -5 | -5 |
| B17 (§7 final-catalog enum replacement) | blind | table_child | 1 | -1 | -1 |
| B22 (creation alias) | builder | signature | 1 | +0 | +0 |
| A-BODY-CONTEXT | blind | plpgsql_body | 2 | +2 | +1 |
| §7 worst-child propagation | blind | top | 17 | +9 | +1 |

A-KEYS/B01 covers 67 PRIMARY KEY constraints and 37 text id/reference columns. B04 affects 28 separately admitted reference constraints; its other recorded occurrences already refused or repeat a parent. B17 applies §7’s final-catalog instruction: the following ADD replaces the enum with the registered IN check, so this DROP is admitted catalog work, not ignored boilerplate. B22 moves the creation alias onto the signature; it changes no refusal.

Counting resolutions preserve the original inventories for headline family rates: A-CHILDREN reconciles 443 attached attributes into 546 comparable bundles (989 builder child nodes); the blind record has two additional ALTER-default children. A-SYNTHETIC accounts for six routine and four DO empty RETURN nodes. A-SQL-BODY adds 18 units and A-DO adds 13 to the builder narrow body denominator; the blind combined denominator already includes 18 SQL and nine authored DO units. README shows each denominator with its numerator, so these are not concealed rate changes.

Original blind raw refusal meant every rewritten/refused unit. The resolution overlay applies A-PROBE-CLASS: exact recognized probe calls/bodies are rewrite work but not raw refusals. UUID signatures remain raw refusals. Both original and resolved raw rates remain reported.
