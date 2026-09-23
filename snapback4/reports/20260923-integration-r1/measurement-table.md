| Measure | Full-fixture result |
|---|---:|
| Seeding and model construction | 314.956 s |
| Entire serial full fixture | 484.496 s |
| SQLite allocated bytes / physical rows after adoption | 730,181,632 B / 420,764 |
| Prior snapshot: rows / production JSON bytes / acquisition | 114,993 / 19,539,296 B / 4.623 s |
| Complete-app snapshot: rows / production JSON bytes / acquisition | 114,993 / 20,268,151 B / 4.793 s |
| Populated activation / row events | 29.411 s / 0 |
| Following sparse: examined / p95 | 102 / 0.510416 ms |
| Following dense: examined / p95 | 102 / 0.724708 ms |
| Following celebrity reader: examined / p95 | 145 / 0.657291 ms |
| Dense/sparse read p95 ratio | 1.420× (asserted ≤ 3×) |
| Celebrity/sparse read p95 ratio | 1.288× (asserted ≤ 3×) |
| Post acknowledgement p95: alice, 5 followers | 5.666334 ms |
| Post acknowledgement p95: u0900, 900 followers | 4.813000 ms |
| Celebrity/ordinary write p95 ratio | 0.849× (asserted ≤ 3×) |
| 500-byte parent: column / separate stream | 1,111 / 611 B (1.818×) |
| 500-byte parent: column / separate aggregate event | 647 / 147 B |
| 4,000-byte parent: column / separate stream | 4,611 / 611 B (7.547×) |
| 4,000-byte parent: column / separate aggregate event | 4,147 / 147 B |
