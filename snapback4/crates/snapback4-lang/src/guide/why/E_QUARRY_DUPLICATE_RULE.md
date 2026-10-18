# E_QUARRY_DUPLICATE_RULE

E_QUARRY_DUPLICATE_RULE means a table declares the same read, insert, update or delete effect more than once. The diagnostic names the first declaration and points at the duplicate. Keep one rule per effect; combine intended alternatives with `or`. Compilation stops, while the first rule and table remain available for diagnostic recovery so their users do not produce spurious unknown-table errors. See guide rules.
