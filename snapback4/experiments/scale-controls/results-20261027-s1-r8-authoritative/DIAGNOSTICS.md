# R8 W4/A and W5 hot1/B diagnostics

Native sent means and CPU/WAL belong to the corresponding native repetition. Prefix/loan values are from its separately labeled, fresh-service diagnostic companion; they are not asserted to describe the identical native window. Means are milliseconds unless labeled otherwise. `p99` for wait/custody uses 50 µs histogram upper bounds. Occupancy is time weighted over the companion’s 20 s measured window at millisecond timestamp resolution; peaks include all recorded events, including duplicate timestamps. Available data width is **29**, total product cap **32**.

| Cell | Rate /s | Rep | Native sent mean upper ms | Native app / PG CPU ms/ACK | Native WAL B/ACK / syncs/ACK | Companion resolved−W mean / p99 / peak | Companion outcome-confirm→prefix reply-release mean / p99 ms | Companion loans mean / p99 / peak | Pool wait mean / p99 ms | Direct dispatch→owner/lane entry mean / p99 ms | Loan custody mean / p99 / max ms | Companion clean? |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| W4-disjoint-A | 3,805 | 1 | 189.5893 | 15.7345 / 60.3058 | 18978.9 / 33.58654 | 0.01 / 0 / 4 | 11.110 / 15.100 | 0.01 / 0 / 1 | 0.001 / 0.050 | 164.967 / 319.200 | 3.436 / 5.800 / 29.050 | clean FAIL |
| W4-disjoint-A | 3,805 | 2 | 185.6343 | 15.6630 / 60.7917 | 19366.5 / 33.01395 | 0.01 / 0 / 5 | 11.333 / 16.150 | 0.01 / 0 / 1 | 0.001 / 0.050 | 168.399 / 320.550 | 3.501 / 6.550 / 25.950 | clean FAIL |
| W4-disjoint-A | 3,805 | 3 | 182.9619 | 15.3231 / 59.8106 | 20952.5 / 32.67421 | 0.01 / 0 / 4 | 10.968 / 15.800 | 0.01 / 1 / 1 | 0.001 / 0.050 | 163.945 / 313.150 | 3.405 / 6.000 / 16.650 | clean FAIL |
| W4-disjoint-A | 3,805 | 4 | 188.5737 | 17.3184 / 67.1705 | 29319.3 / 37.02116 | 0.01 / 0 / 5 | 11.130 / 15.950 | 0.01 / 0 / 1 | 0.001 / 0.050 | 165.309 / 314.850 | 3.440 / 5.900 / 25.550 | clean FAIL |
| W4-disjoint-A | 3,805 | 5 | 185.7683 | 14.9207 / 57.6513 | 23543.1 / 34.60891 | 0.01 / 0 / 5 | 11.363 / 17.400 | 0.01 / 0 / 1 | 0.001 / 0.050 | 167.105 / 324.300 | 3.480 / 6.350 / 24.550 | clean FAIL |
| W4-disjoint-A | 4,525 | 1 | 182.4396 | 14.0347 / 54.3512 | 22804.6 / 31.48035 | 0.01 / 0 / 5 | 10.986 / 15.450 | 0.01 / 0 / 1 | 0.001 / 0.050 | 164.247 / 317.900 | 3.414 / 5.900 / 27.200 | clean FAIL |
| W4-disjoint-A | 4,525 | 2 | 188.3678 | 13.7802 / 53.5177 | 23869.7 / 32.49767 | 0.01 / 0 / 5 | 11.253 / 15.650 | 0.01 / 0 / 1 | 0.001 / 0.050 | 166.500 / 321.950 | 3.469 / 6.100 / 29.150 | clean FAIL |
| W4-disjoint-A | 4,525 | 3 | 187.5239 | 14.6372 / 57.3421 | 22700.8 / 34.16425 | 0.01 / 0 / 4 | 11.146 / 15.900 | 0.00 / 0 / 1 | 0.001 / 0.050 | 165.271 / 315.900 | 3.437 / 6.050 / 25.550 | clean FAIL |
| W4-disjoint-A | 4,525 | 4 | 185.4235 | 18.1482 / 73.5453 | 31186.7 / 37.77249 | 0.01 / 0 / 4 | 11.023 / 15.100 | 0.01 / 0 / 1 | 0.001 / 0.050 | 165.182 / 313.700 | 3.433 / 6.050 / 30.350 | clean FAIL |
| W4-disjoint-A | 4,525 | 5 | 187.7827 | 16.3101 / 64.1678 | 26615.9 / 36.92593 | 0.01 / 0 / 4 | 11.271 / 15.700 | 0.01 / 0 / 1 | 0.001 / 0.050 | 166.466 / 317.750 | 3.469 / 6.200 / 25.650 | clean FAIL |
| W5-hot1-B | 2,690 | 1 | 217.5997 | 14.7310 / 52.5568 | 15845.7 / 31.96296 | 0.01 / 0 / 4 | 12.603 / 18.150 | 0.01 / 1 / 1 | 0.002 / 0.050 | 195.964 / 393.950 | 4.049 / 7.000 / 26.600 | clean FAIL |
| W5-hot1-B | 2,690 | 2 | 26.1770 | 0.4115 / 0.7685 | 5449.7 / 0.31950 | 0.01 / 0 / 5 | 12.827 / 18.500 | 0.02 / 1 / 1 | 0.002 / 0.050 | 197.262 / 392.500 | 4.084 / 6.700 / 24.950 | clean FAIL |
| W5-hot1-B | 2,690 | 3 | 221.5842 | 14.5500 / 51.5998 | 31141.3 / 27.96244 | 0.01 / 0 / 5 | 12.724 / 18.900 | 0.01 / 0 / 1 | 0.002 / 0.050 | 195.272 / 387.050 | 4.043 / 6.550 / 25.350 | clean FAIL |
| W5-hot1-B | 2,690 | 4 | 218.2563 | 13.4081 / 47.7078 | 17066.2 / 26.37118 | 0.01 / 0 / 5 | 12.812 / 18.150 | 0.01 / 1 / 1 | 0.002 / 0.050 | 195.940 / 386.200 | 4.061 / 6.700 / 25.950 | clean FAIL |
| W5-hot1-B | 2,690 | 5 | 220.7535 | 14.5631 / 51.8446 | 22610.0 / 30.10553 | 0.01 / 0 / 5 | 12.736 / 19.300 | 0.01 / 1 / 1 | 0.002 / 0.050 | 197.335 / 395.500 | 4.065 / 6.900 / 26.100 | clean FAIL |
| W5-hot1-B | 3,200 | 1 | 218.4106 | 16.1428 / 57.3338 | 25222.8 / 32.48108 | 0.02 / 0 / 29 | 7.230 / 17.200 | 0.11 / 1 / 28 | 0.004 / 0.050 | 108.492 / 366.350 | 4.750 / 8.600 / 25.750 | clean FAIL |
| W5-hot1-B | 3,200 | 2 | 217.4306 | 16.6442 / 59.8780 | 22632.4 / 29.46341 | 0.01 / 0 / 5 | 12.835 / 18.750 | 0.02 / 1 / 1 | 0.002 / 0.050 | 198.622 / 392.400 | 4.108 / 6.900 / 27.800 | clean FAIL |
| W5-hot1-B | 3,200 | 3 | 220.7175 | 14.8330 / 53.9382 | 21831.0 / 30.23350 | 0.01 / 0 / 5 | 12.666 / 18.900 | 0.01 / 1 / 1 | 0.002 / 0.050 | 195.283 / 382.650 | 4.044 / 6.750 / 25.400 | clean FAIL |
| W5-hot1-B | 3,200 | 4 | 220.1100 | 13.2302 / 46.1614 | 24432.6 / 27.47222 | 0.01 / 0 / 5 | 12.781 / 18.750 | 0.02 / 1 / 1 | 0.002 / 0.050 | 198.057 / 399.600 | 4.098 / 7.050 / 26.300 | clean FAIL |
| W5-hot1-B | 3,200 | 5 | 215.3996 | 14.8126 / 54.2448 | 23177.2 / 31.36269 | 0.01 / 0 / 5 | 12.603 / 18.500 | 0.01 / 1 / 1 | 0.002 / 0.050 | 194.295 / 387.400 | 4.032 / 6.750 / 25.100 | clean FAIL |
| W5-hot1-B | 3,805 | 1 | 220.6144 | 14.6563 / 51.7578 | 21932.7 / 30.74872 | 0.01 / 0 / 5 | 12.717 / 18.750 | 0.02 / 1 / 1 | 0.002 / 0.050 | 197.159 / 388.000 | 4.082 / 7.150 / 26.250 | clean FAIL |
| W5-hot1-B | 3,805 | 2 | 222.1953 | 14.7663 / 52.7187 | 21909.1 / 28.99505 | 0.01 / 0 / 5 | 13.060 / 21.250 | 0.02 / 1 / 1 | 0.002 / 0.050 | 200.227 / 404.950 | 4.145 / 7.750 / 31.900 | clean FAIL |
| W5-hot1-B | 3,805 | 3 | 216.6686 | 15.3708 / 56.4031 | 19933.3 / 32.23529 | 0.01 / 0 / 4 | 12.651 / 17.550 | 0.01 / 1 / 1 | 0.001 / 0.050 | 197.206 / 387.300 | 4.052 / 6.750 / 26.650 | clean FAIL |
| W5-hot1-B | 3,805 | 4 | 218.4206 | 14.2401 / 51.0231 | 21102.0 / 28.91388 | 0.01 / 0 / 5 | 12.721 / 18.050 | 0.02 / 1 / 1 | 0.001 / 0.050 | 196.670 / 391.600 | 4.068 / 6.750 / 26.600 | clean FAIL |
| W5-hot1-B | 3,805 | 5 | 224.0674 | 16.8917 / 59.5465 | 22303.6 / 31.23684 | 0.01 / 0 / 4 | 12.699 / 17.350 | 0.01 / 0 / 1 | 0.002 / 0.050 | 194.004 / 381.450 | 4.030 / 6.450 / 25.350 | clean FAIL |

The `prefix_ack_wait` clock runs from outcome confirmation/resolution to prefix reply release, before the committed/void branch (`6c0fe17c6e:snapback4/crates/snapback4-core/src/engine/spike_r.rs`, lines 643–654). It includes failed/void outcomes in these failing companions; the aggregate collector cannot isolate the requested successful-commit-only ACK distribution, which is N/A. It includes post-resolution owner scheduling and prefix wait and excludes subsequent HTTP transmission. These nested waits must not be added twice. Physical loan return and through-W result/footprint holds are distinct. The `dispatch_lock` timer starts before invoking the host callback and ends after entry to the owner closure and acquisition of the lane lock (`6c0fe17c6e:snapback4/crates/snapback4-core/src/engine/spike_r_direct.rs`, lines 95–98); it does not split waiting for the host mutex from waiting for the lane mutex. The JSON retains both confirmed-count and highest-confirmed-revision gaps, allocated gaps and retained-result/footprint occupancy. Reader/control shares are described there; no mixed-reader progress qualification is claimed.

CPU uses the frozen runner’s controller launch anchor plus its 100 ms scheduler lead and 10 s warmup, interpolating 100 ms tick samples; this has launch/tick uncertainty and includes drain completions in the measured ACK divisor. WAL and syncs span the complete warmup/measurement/drain snapshot interval and include ordinary product maintenance and PG statistics reporting lag. The conservative sent mean uses the HDR service sum divided by **sent** requests; unsent expiry timings can only increase this upper bound.

Companion profiling writes numeric clocks and a CSV series, which costs work. It is diagnostic evidence and never substitutes for the native S1 or ≤6.0 ms gate. No PG-marker SQL or altered product transaction is enabled.

Companion phase summary below gives medians of the eligible companions’ phase means over warmup, measurement and drain. These nested clocks are not additive, and do not describe the identical native cohort. `dispatch_lock` covers direct submission to owner/lane entry, without splitting host-mutex and lane-mutex waiting.

| Cell | Rate /s | Eligible companions | Direct dispatch→owner/lane entry ms | Pool wait ms | Loan custody ms | Prefix ACK wait ms |
|---|---:|---:|---:|---:|---:|---:|
| W4-disjoint-A | 3,805 | 5 | 165.309 | 0.001448 | 3.440 | 11.130 |
| W4-disjoint-A | 4,525 | 5 | 165.271 | 0.001425 | 3.437 | 11.146 |
| W5-hot1-B | 2,690 | 5 | 195.964 | 0.001565 | 4.061 | 12.736 |
| W5-hot1-B | 3,200 | 5 | 195.283 | 0.001553 | 4.098 | 12.666 |
| W5-hot1-B | 3,805 | 5 | 197.159 | 0.001503 | 4.068 | 12.717 |
