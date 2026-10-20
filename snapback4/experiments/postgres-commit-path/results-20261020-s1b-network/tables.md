Rates = median of three; spreads retain all runs. Latencies = median / worst run p99. RTT = before/after p50 / before/after p99, µs.

| Execution cell | executions/s (min–max) | p99 ms | CPU 450a/450b % | RTT µs |
|---|---:|---:|---:|---:|
| exec-c8 | 1,218 (1,213–1,232) | 9.81 / 9.96 | 12.6 / 35.3 | 560/617 / 707/899 |
| exec-c16 | 2,275 (2,254–2,291) | 8.91 / 10.84 | 18.3 / 37.3 | 585/598 / 991/725 |
| exec-c32 | 3,692 (3,638–3,756) | 13.30 / 14.11 | 25.7 / 45.5 | 567/638 / 680/808 |
| exec-c64 | 4,460 (4,460–4,678) | 23.89 / 24.51 | 29.7 / 52.5 | 617/591 / 757/799 |
| exec-c128 | 4,537 (4,403–5,353) | 47.22 / 51.04 | 35.1 / 55.2 | 674/614 / 858/1000 |
| k1-c32 | 376 (376–377) | 89.09 / 89.20 | 7.1 / 38.1 | 569/580 / 991/707 |
| k1-c64 | 767 (758–773) | 88.96 / 89.41 | 10.2 / 40.2 | 610/602 / 863/1118 |
| k1-c128 | 1,580 (1,580–1,595) | 87.31 / 87.35 | 11.6 / 16.9 | 608/582 / 745/720 |
| k2-c32 | 6,969 (6,920–7,032) | 7.38 / 7.61 | 33.7 / 34.1 | 648/627 / 780/749 |
| k2-c64 | 8,149 (8,079–8,248) | 14.81 / 15.46 | 41.3 / 23.5 | 595/566 / 762/1123 |
| k2-c128 | 7,935 (7,888–7,975) | 35.48 / 38.66 | 45.0 / 26.9 | 598/642 / 869/737 |
| k3p-c32 | 381 (381–386) | 86.12 / 86.41 | 6.2 / 11.4 | 667/683 / 845/841 |
| k3p-c64 | 776 (771–779) | 86.22 / 86.67 | 9.2 / 8.2 | 608/556 / 747/697 |
| k3p-c128 | 1,616 (1,601–1,657) | 86.15 / 86.24 | 14.4 / 9.3 | 595/630 / 709/780 |
| k3-c32 | 9,544 (9,527–9,711) | 6.29 / 6.54 | 40.2 / 17.5 | 642/598 / 717/683 |
| k3-c64 | 9,640 (9,573–9,712) | 17.38 / 18.57 | 44.7 / 18.2 | 634/601 / 730/724 |
| k3-c128 | 9,378 (9,213–9,392) | 43.96 / 46.73 | 45.5 / 18.7 | 655/575 / 806/721 |

| Raw control | commits/s (min–max) | p99 ms | CPU 450a/450b % | RTT µs |
|---|---:|---:|---:|---:|
| raw-c32-disjoint | 5,890 (5,811–5,957) | 7.02 / 7.18 | 22.6 / 17.5 | 554/657 / 674/759 |
| raw-c32-hot1 | 6,066 (5,868–6,079) | 6.40 / 6.54 | 22.5 / 16.4 | 638/564 / 740/672 |
| raw-c64-disjoint | 12,388 (11,798–12,452) | 6.35 / 14.15 | 26.9 / 26.7 | 559/543 / 712/657 |
| raw-c64-hot1 | 11,810 (11,711–11,915) | 6.85 / 7.34 | 27.9 / 26.3 | 549/514 / 654/663 |
| raw-c128-disjoint | 24,383 (24,335–24,434) | 7.07 / 7.23 | 51.8 / 37.9 | 521/576 / 678/670 |
| raw-c128-hot1 | 18,560 (18,534–18,862) | 13.06 / 34.33 | 43.0 / 31.3 | 546/580 / 690/712 |

| Commit stage | stream ops/s (min–max) | p99 ms | CPU 450a/450b % | RTT µs |
|---|---:|---:|---:|---:|
| commit-p0-n1 | 180 (179–184) | 62.34 / 62.63 | 4.5 / 7.5 | 583/602 / 806/779 |
| commit-p0-n4 | 688 (612–690) | 52.08 / 52.13 | 5.0 / 9.3 | 574/533 / 755/741 |
| commit-p0-n16 | 2,064 (1,180–2,084) | 53.30 / 60.49 | 5.1 / 8.9 | 595/560 / 835/744 |
| commit-p0-n64 | 4,256 (2,000–4,368) | 64.35 / 87.68 | 6.4 / 4.4 | 555/560 / 674/696 |
| commit-p10-n1 | 182 (181–183) | 61.94 / 63.43 | 4.5 / 9.1 | 556/549 / 664/661 |
| commit-p10-n4 | 686 (622–688) | 51.29 / 51.50 | 5.1 / 9.1 | 555/526 / 682/722 |
| commit-p10-n16 | 2,088 (1,248–2,148) | 52.84 / 60.07 | 5.1 / 9.1 | 565/592 / 756/688 |
| commit-p10-n64 | 4,528 (2,176–4,528) | 57.01 / 84.01 | 6.1 / 9.1 | 579/580 / 723/655 |
| commit-p30-n1 | 182 (181–182) | 61.64 / 62.31 | 4.6 / 6.8 | 597/596 / 736/792 |
| commit-p30-n4 | 658 (645–665) | 51.71 / 51.92 | 4.9 / 6.7 | 555/560 / 742/695 |
| commit-p30-n16 | 2,080 (1,440–2,080) | 52.89 / 58.00 | 5.1 / 6.3 | 647/573 / 776/752 |
| commit-p30-n64 | 4,592 (2,416–4,656) | 71.35 / 96.80 | 6.1 / 10.0 | 561/584 / 715/732 |

Best qualified commit stages: {"0": [4255.933320164706, 64], "10": [4527.921440563006, 64], "30": [4591.925639504175, 64]}

| Execution lever | C | execution/s | predicted (a)/s | required/s | margin/s | predicted/required | §8 sizing |
|---|---:|---:|---:|---:|---:|---:|---|
| exec | 32 | 3,692 | 3,692 | 2,945 | +747 | 1.254× | CLEARS |
| k1 | 32 | 376 | 376 | 2,945 | -2,569 | 0.128× | DO NOT BUILD |
| k2 | 32 | 6,969 | 4,256 | 2,945 | +1,311 | 1.445× | CLEARS |
| k3p | 32 | 381 | 381 | 2,945 | -2,564 | 0.129× | DO NOT BUILD |
| k3 | 32 | 9,544 | 4,256 | 2,945 | +1,311 | 1.445× | CLEARS |
| exec | 64 | 4,460 | 4,256 | 6,194 | -1,938 | 0.687× | DO NOT BUILD |
| k1 | 64 | 767 | 767 | 6,194 | -5,427 | 0.124× | DO NOT BUILD |
| k2 | 64 | 8,149 | 4,256 | 6,194 | -1,938 | 0.687× | DO NOT BUILD |
| k3p | 64 | 776 | 776 | 6,194 | -5,418 | 0.125× | DO NOT BUILD |
| k3 | 64 | 9,640 | 4,256 | 6,194 | -1,938 | 0.687× | DO NOT BUILD |
| exec | 128 | 4,537 | 4,256 | 12,191 | -7,935 | 0.349× | DO NOT BUILD |
| k1 | 128 | 1,580 | 1,580 | 12,191 | -10,611 | 0.130× | DO NOT BUILD |
| k2 | 128 | 7,935 | 4,256 | 12,191 | -7,935 | 0.349× | DO NOT BUILD |
| k3p | 128 | 1,616 | 1,616 | 12,191 | -10,576 | 0.133× | DO NOT BUILD |
| k3 | 128 | 9,378 | 4,256 | 12,191 | -7,935 | 0.349× | DO NOT BUILD |

```text
CPU and wait-event details:
exec-c32 {"450a": {"busy": 25.65714285714286, "wait": 0.2571428571428571, "samples": 35, "peak_busy": 56}, "450b": {"busy": 45.51428571428571, "wait": 3.8857142857142857, "samples": 35, "peak_busy": 74}, "waits_pct": {"Client:ClientRead:idle in transaction": 84.44, "Client:ClientRead:idle": 8.93, "CPU:-:idle in transaction": 3.57, "Client:ClientRead:active": 1.66, "CPU:-:active": 1.05, "CPU:-:idle": 0.34}}
exec-c64 {"450a": {"busy": 29.65714285714286, "wait": 0.22857142857142856, "samples": 35, "peak_busy": 68}, "450b": {"busy": 52.5, "wait": 1.5555555555555556, "samples": 36, "peak_busy": 87}, "waits_pct": {"Client:ClientRead:idle in transaction": 84.21, "Client:ClientRead:idle": 9.06, "CPU:-:idle in transaction": 4.25, "Client:ClientRead:active": 1.72, "CPU:-:active": 0.39, "CPU:-:idle": 0.36}}
exec-c128 {"450a": {"busy": 35.138888888888886, "wait": 0.19444444444444445, "samples": 36, "peak_busy": 84}, "450b": {"busy": 55.22222222222222, "wait": 3.7222222222222223, "samples": 36, "peak_busy": 90}, "waits_pct": {"Client:ClientRead:idle in transaction": 82.79, "Client:ClientRead:idle": 9.19, "CPU:-:idle in transaction": 5.57, "Client:ClientRead:active": 1.45, "CPU:-:active": 0.6, "CPU:-:idle": 0.4}}
k1-c32 {"450a": {"busy": 7.111111111111111, "wait": 0.2222222222222222, "samples": 36, "peak_busy": 17}, "450b": {"busy": 38.138888888888886, "wait": 4.444444444444445, "samples": 36, "peak_busy": 54}, "waits_pct": {"Client:ClientRead:idle in transaction": 98.47, "Client:ClientRead:idle": 0.83, "CPU:-:idle in transaction": 0.33, "CPU:-:active": 0.19, "Client:ClientRead:active": 0.13, "CPU:-:idle": 0.05}}
k1-c64 {"450a": {"busy": 10.25, "wait": 0.19444444444444445, "samples": 36, "peak_busy": 29}, "450b": {"busy": 40.166666666666664, "wait": 1.5555555555555556, "samples": 36, "peak_busy": 56}, "waits_pct": {"Client:ClientRead:idle in transaction": 98.33, "Client:ClientRead:idle": 0.83, "CPU:-:idle in transaction": 0.43, "Client:ClientRead:active": 0.23, "CPU:-:active": 0.13, "CPU:-:idle": 0.05}}
k1-c128 {"450a": {"busy": 11.555555555555555, "wait": 0.16666666666666666, "samples": 36, "peak_busy": 27}, "450b": {"busy": 16.88888888888889, "wait": 2.888888888888889, "samples": 36, "peak_busy": 34}, "waits_pct": {"Client:ClientRead:idle in transaction": 98.61, "Client:ClientRead:idle": 0.76, "CPU:-:idle in transaction": 0.34, "Client:ClientRead:active": 0.22, "CPU:-:idle": 0.04, "CPU:-:active": 0.04}}
k2-c32 {"450a": {"busy": 33.74285714285714, "wait": 0.2571428571428571, "samples": 35, "peak_busy": 74}, "450b": {"busy": 34.142857142857146, "wait": 3.085714285714286, "samples": 35, "peak_busy": 64}, "waits_pct": {"Client:ClientRead:idle in transaction": 58.23, "Client:ClientRead:idle": 18.54, "CPU:-:active": 12.62, "CPU:-:idle in transaction": 6.97, "Client:ClientRead:active": 2.36, "CPU:-:idle": 1.27}}
k2-c64 {"450a": {"busy": 41.27777777777778, "wait": 0.25, "samples": 36, "peak_busy": 92}, "450b": {"busy": 23.52777777777778, "wait": 5.972222222222222, "samples": 36, "peak_busy": 49}, "waits_pct": {"Client:ClientRead:idle in transaction": 42.73, "CPU:-:idle in transaction": 20.09, "Client:ClientRead:idle": 16.45, "CPU:-:active": 15.89, "Client:ClientRead:active": 2.71, "CPU:-:idle": 2.13}}
k2-c128 {"450a": {"busy": 45.02777777777778, "wait": 0.19444444444444445, "samples": 36, "peak_busy": 97}, "450b": {"busy": 26.944444444444443, "wait": 1.7777777777777777, "samples": 36, "peak_busy": 57}, "waits_pct": {"Client:ClientRead:idle in transaction": 34.59, "CPU:-:idle in transaction": 29.3, "CPU:-:active": 15.16, "Client:ClientRead:idle": 14.61, "CPU:-:idle": 3.76, "Client:ClientRead:active": 2.58}}
k3p-c32 {"450a": {"busy": 6.194444444444445, "wait": 0.19444444444444445, "samples": 36, "peak_busy": 12}, "450b": {"busy": 11.416666666666666, "wait": 3.7222222222222223, "samples": 36, "peak_busy": 21}, "waits_pct": {"Client:ClientRead:idle in transaction": 49.71, "Client:ClientRead:idle": 49.04, "CPU:-:active": 0.9, "CPU:-:idle in transaction": 0.13, "CPU:-:idle": 0.11, "Client:ClientRead:active": 0.1}}
k3p-c64 {"450a": {"busy": 9.25, "wait": 0.19444444444444445, "samples": 36, "peak_busy": 17}, "450b": {"busy": 8.194444444444445, "wait": 3.638888888888889, "samples": 36, "peak_busy": 23}, "waits_pct": {"Client:ClientRead:idle in transaction": 49.71, "Client:ClientRead:idle": 48.79, "CPU:-:active": 0.83, "Client:ClientRead:active": 0.28, "CPU:-:idle in transaction": 0.21, "CPU:-:idle": 0.17}}
k3p-c128 {"450a": {"busy": 14.444444444444445, "wait": 0.19444444444444445, "samples": 36, "peak_busy": 37}, "450b": {"busy": 9.333333333333334, "wait": 0.8888888888888888, "samples": 36, "peak_busy": 21}, "waits_pct": {"Client:ClientRead:idle in transaction": 49.73, "Client:ClientRead:idle": 48.89, "CPU:-:active": 0.5, "Client:ClientRead:active": 0.43, "CPU:-:idle in transaction": 0.24, "CPU:-:idle": 0.21}}
k3-c32 {"450a": {"busy": 40.25, "wait": 0.16666666666666666, "samples": 36, "peak_busy": 89}, "450b": {"busy": 17.47222222222222, "wait": 0.25, "samples": 36, "peak_busy": 39}, "waits_pct": {"CPU:-:active": 30.86, "Client:ClientRead:idle in transaction": 26.43, "Client:ClientRead:idle": 24.31, "CPU:-:idle in transaction": 9.73, "CPU:-:idle": 7.22, "Client:ClientRead:active": 1.44}}
k3-c64 {"450a": {"busy": 44.69444444444444, "wait": 0.4166666666666667, "samples": 36, "peak_busy": 98}, "450b": {"busy": 18.166666666666668, "wait": 0.25, "samples": 36, "peak_busy": 39}, "waits_pct": {"CPU:-:active": 31.69, "CPU:-:idle in transaction": 21.04, "Client:ClientRead:idle": 15.89, "CPU:-:idle": 15.39, "Client:ClientRead:idle in transaction": 14.56, "Client:ClientRead:active": 1.44}}
k3-c128 {"450a": {"busy": 45.47222222222222, "wait": 0.19444444444444445, "samples": 36, "peak_busy": 99}, "450b": {"busy": 18.666666666666668, "wait": 0.7777777777777778, "samples": 36, "peak_busy": 36}, "waits_pct": {"CPU:-:active": 30.13, "CPU:-:idle in transaction": 24.58, "CPU:-:idle": 19.46, "Client:ClientRead:idle": 12.06, "Client:ClientRead:idle in transaction": 11.83, "Client:ClientRead:active": 1.95}}
raw-c32-disjoint {"450a": {"busy": 22.6, "wait": 6.066666666666666, "samples": 15, "peak_busy": 32}, "450b": {"busy": 17.466666666666665, "wait": 1.4666666666666666, "samples": 15, "peak_busy": 22}, "waits_pct": {"LWLock:WALWrite:active": 79.54, "Client:ClientRead:idle": 14.12, "IO:WALSync:active": 3.09, "CPU:-:active": 1.41, "CPU:-:idle": 0.9, "Client:ClientRead:active": 0.44, "LWLock:BufferContent:active": 0.36, "LWLock:BufferContent:idle": 0.04, "LWLock:WALInsert:active": 0.04, "IO:WALWrite:active": 0.02, "Timeout:SpinDelay:active": 0.02, "LWLock:WALWrite:idle": 0.02, "IPC:XactGroupUpdate:active": 0.0, "LWLock:ProcArray:active": 0.0, "LWLock:WALInsert:idle": 0.0}}
raw-c32-hot1 {"450a": {"busy": 22.533333333333335, "wait": 6.2, "samples": 15, "peak_busy": 26}, "450b": {"busy": 16.4, "wait": 0.13333333333333333, "samples": 15, "peak_busy": 22}, "waits_pct": {"LWLock:WALWrite:active": 77.93, "Client:ClientRead:idle": 15.21, "IO:WALSync:active": 3.09, "CPU:-:active": 1.68, "CPU:-:idle": 0.98, "Client:ClientRead:active": 0.5, "LWLock:BufferContent:active": 0.44, "LWLock:WALInsert:active": 0.05, "LWLock:BufferContent:idle": 0.04, "LWLock:WALWrite:idle": 0.02, "IO:WALWrite:active": 0.02, "Timeout:SpinDelay:active": 0.01, "Lock:transactionid:active": 0.0, "LWLock:XidGen:active": 0.0, "IPC:XactGroupUpdate:active": 0.0, "LWLock:WALInsert:idle": 0.0, "LWLock:XactSLRU:active": 0.0}}
raw-c64-disjoint {"450a": {"busy": 26.933333333333334, "wait": 5.933333333333334, "samples": 15, "peak_busy": 30}, "450b": {"busy": 26.733333333333334, "wait": 2.0, "samples": 15, "peak_busy": 29}, "waits_pct": {"LWLock:WALWrite:active": 82.84, "Client:ClientRead:idle": 12.42, "IO:WALSync:active": 1.54, "Client:ClientRead:active": 0.93, "CPU:-:idle": 0.83, "CPU:-:active": 0.7, "LWLock:WALWrite:idle": 0.58, "LWLock:BufferContent:idle": 0.05, "LWLock:WALInsert:active": 0.03, "LWLock:WALInsert:idle": 0.03, "LWLock:BufferContent:active": 0.03, "IO:WALWrite:active": 0.01, "IPC:XactGroupUpdate:active": 0.0, "IPC:ProcArrayGroupUpdate:active": 0.0, "Timeout:SpinDelay:active": 0.0, "LWLock:XactSLRU:active": 0.0, "LWLock:XidGen:idle": 0.0, "LWLock:XidGen:active": 0.0, "LWLock:ProcArray:active": 0.0}}
raw-c64-hot1 {"450a": {"busy": 27.866666666666667, "wait": 6.0, "samples": 15, "peak_busy": 35}, "450b": {"busy": 26.266666666666666, "wait": 1.4666666666666666, "samples": 15, "peak_busy": 30}, "waits_pct": {"LWLock:WALWrite:active": 83.72, "Client:ClientRead:idle": 11.53, "IO:WALSync:active": 1.53, "Client:ClientRead:active": 0.89, "CPU:-:idle": 0.82, "CPU:-:active": 0.71, "LWLock:WALWrite:idle": 0.57, "Lock:transactionid:active": 0.04, "LWLock:BufferContent:idle": 0.04, "LWLock:WALInsert:active": 0.03, "LWLock:WALInsert:idle": 0.02, "Timeout:SpinDelay:active": 0.02, "LWLock:BufferContent:active": 0.02, "IPC:XactGroupUpdate:active": 0.01, "IO:WALWrite:active": 0.01, "IO:WALInitSync:active": 0.01, "IO:WALInitWrite:active": 0.0, "LWLock:XactSLRU:active": 0.0, "LWLock:LockManager:active": 0.0, "IPC:ProcArrayGroupUpdate:active": 0.0, "Lock:transactionid:idle": 0.0, "LWLock:XidGen:idle": 0.0, "IO:WALWrite:idle": 0.0, "LWLock:XidGen:active": 0.0}}
raw-c128-disjoint {"450a": {"busy": 51.8, "wait": 3.8666666666666667, "samples": 15, "peak_busy": 56}, "450b": {"busy": 37.86666666666667, "wait": 1.6, "samples": 15, "peak_busy": 50}, "waits_pct": {"LWLock:WALWrite:active": 79.17, "Client:ClientRead:idle": 12.19, "Client:ClientRead:active": 3.21, "LWLock:WALWrite:idle": 1.92, "CPU:-:active": 1.16, "CPU:-:idle": 1.08, "IO:WALSync:active": 0.76, "LWLock:WALInsert:active": 0.12, "LWLock:WALInsert:idle": 0.1, "Timeout:SpinDelay:active": 0.06, "IPC:XactGroupUpdate:active": 0.06, "LWLock:BufferContent:idle": 0.05, "IPC:ProcArrayGroupUpdate:active": 0.04, "LWLock:BufferContent:active": 0.03, "IO:WALWrite:active": 0.01, "LWLock:XactSLRU:active": 0.01, "LWLock:LockManager:active": 0.0, "LWLock:ProcArray:active": 0.0, "IO:WALSync:idle": 0.0, "LWLock:XidGen:active": 0.0, "Timeout:SpinDelay:idle": 0.0, "IO:WALInitSync:active": 0.0, "LWLock:XidGen:idle": 0.0, "IO:WALWrite:idle": 0.0, "IO:WALInitWrite:active": 0.0, "LWLock:ProcArray:idle": 0.0, "LWLock:LockManager:idle": 0.0, "LWLock:XactSLRU:idle": 0.0, "IO:SLRUWrite:idle": 0.0}}
raw-c128-hot1 {"450a": {"busy": 43.0, "wait": 4.466666666666667, "samples": 15, "peak_busy": 49}, "450b": {"busy": 31.266666666666666, "wait": 1.8, "samples": 15, "peak_busy": 36}, "waits_pct": {"LWLock:WALWrite:active": 62.8, "Lock:transactionid:active": 19.02, "Client:ClientRead:idle": 9.91, "Client:ClientRead:active": 1.97, "Lock:tuple:active": 1.55, "LWLock:WALWrite:idle": 1.23, "CPU:-:active": 0.81, "LWLock:LockManager:active": 0.79, "IO:WALSync:active": 0.77, "CPU:-:idle": 0.76, "Timeout:SpinDelay:active": 0.08, "LWLock:WALInsert:active": 0.08, "LWLock:WALInsert:idle": 0.07, "LWLock:BufferContent:active": 0.04, "IPC:ProcArrayGroupUpdate:active": 0.03, "IPC:XactGroupUpdate:active": 0.03, "LWLock:BufferContent:idle": 0.01, "Lock:tuple:idle": 0.01, "IO:WALWrite:active": 0.01, "LWLock:ProcArray:active": 0.01, "LWLock:XactSLRU:active": 0.0, "Lock:extend:active": 0.0, "IO:WALInitSync:active": 0.0, "Lock:transactionid:idle": 0.0, "Timeout:SpinDelay:idle": 0.0, "LWLock:XidGen:active": 0.0, "LWLock:XidGen:idle": 0.0, "IO:WALWrite:idle": 0.0, "LWLock:LockManager:idle": 0.0, "IO:WALInitWrite:active": 0.0, "IO:WALSync:idle": 0.0, "IO:DataFileExtend:active": 0.0, "IO:SLRUWrite:idle": 0.0}}
```
