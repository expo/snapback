| Cell | Statements/op | App starts/op | RO starts/op | COMMIT/op | ROLLBACK/op | Sessions/op | Inferred exchanges/op | PG database tx/op, uncorrected | RFC envelope |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| W1 natural | 23.000 | 4.000 | 4.000 | 0.000 | 4.000 | 2.000 | 23.000 | 4.150 | 23 |
| W2 natural | 23.000 | 4.000 | 4.000 | 0.000 | 4.000 | 2.000 | 23.000 | 4.267 | 23 |
| W3 natural | 153.000 | 4.000 | 4.000 | 0.000 | 4.000 | 2.000 | 153.000 | 4.600 | program-dependent; no constant budget |
| W4 natural | 58.000 | 10.000 | 9.000 | 1.000 | 9.000 | 4.000 | 57.000 | 9.233 | 57–58 tiny/member examples |
| W5 same natural | 61.000 | 10.000 | 9.000 | 1.000 | 9.000 | 4.000 | 60.000 | 11.467 | 57–58 tiny/member examples |
| W5 hot1 natural | 58.030 | 10.000 | 9.000 | 1.000 | 9.000 | 4.000 | 57.030 | 10.390 | 57–58 tiny/member examples |
| W1 +0.5 ms | 23.000 | 4.000 | 4.000 | 0.000 | 4.000 | 2.000 | 23.000 | 4.967 | 23 |
| W2 +0.5 ms | 23.000 | 4.000 | 4.000 | 0.000 | 4.000 | 2.000 | 23.000 | 4.767 | 23 |
| W3 +0.5 ms | 153.000 | 4.000 | 4.000 | 0.000 | 4.000 | 2.000 | 153.000 | 4.933 | program-dependent; no constant budget |
| W4 +0.5 ms | 58.000 | 10.000 | 9.000 | 1.000 | 9.000 | 4.000 | 57.000 | 10.217 | 57–58 tiny/member examples |
| W5 same +0.5 ms | 61.000 | 10.000 | 9.000 | 1.000 | 9.000 | 4.000 | 60.000 | 10.667 | 57–58 tiny/member examples |
| W5 hot1 +0.5 ms | 58.030 | 10.000 | 9.000 | 1.000 | 9.000 | 4.000 | 57.030 | 10.880 | 57–58 tiny/member examples |
