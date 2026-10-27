# Why SQLite's ≈8 ms flush differs from PG's ≈2.64 ms

The files are on the **same `/dev/nvme0n1p3`, ext4, `rw,relatime` volume**. Both one-host PG and this SQLite run put their store under `/tmp`. The device is a Samsung MZVL2512HCJQ-00B00 NVMe, firmware GXA7401Q, with write-back cache and FUA support reported by sysfs. No mount, barrier, cache, device or product option was changed.

Three repetitions of a bare 8 KiB `pwrite` + sync test use 20 warm-up calls and 400 recorded calls per arm. An initialized arm writes/fsyncs the entire 16 MiB file before overwriting it; a growing arm extends its file. The first exploratory probe instead used `posix_fallocate`: those allocated but unwritten extents are deliberately kept as separate evidence, not equated with initialized PG-like WAL. Timed sync alone is measured with the host monotonic clock.

| File state | `fsync` mean ms, three repetitions | `fdatasync` mean ms, three repetitions |
|---|---:|---:|
| Fully written/fsynced 16 MiB | 10.948 / 8.513 / 7.920 | 2.549 / 2.767 / 2.611 |
| Growing file | 8.125 / 8.518 / 8.041 | 8.213 / 8.226 / 8.279 |
| `posix_fallocate`, previously unwritten extents | 8.286 / 7.903 / 7.659 | 7.896 / 7.646 / 7.922 |

[Initialized/growing receipts](./fsync-probe.json), [unwritten-extent receipts](./fsync-unwritten-probe.json). Samples were taken before capacity load, alongside setup/build activity; sporadic tails remain visible in p99. This is a method/allocation comparison, not an idle-device specification.

PG16.15's own [pg_test_fsync output](./pg-test-fsync.txt), on the same `/tmp` volume and PG core mask, independently reports **2.714 ms/op `fdatasync` vs 8.206 ms/op `fsync`** for one 8 KiB write, and **2.599 vs 7.997 ms/op** for two writes. Those utility figures include the write, whereas the Python probe times sync alone. Its [primary source](https://github.com/postgres/postgres/blob/REL_16_15/src/bin/pg_test_fsync/pg_test_fsync.c) first fully writes/fsyncs the file, then overwrites fixed offsets for these tests. Direct I/O is used by the separately labelled `open_datasync`/`open_sync` arms, not these two buffered arms.

The PG controls explicitly configure `wal_sync_method=fdatasync`. The unchanged bundled SQLite build calls **`fsync`**: its `libsqlite3-sys 0.38.2` amalgamation aliases `fdatasync` to `fsync` unless `HAVE_FDATASYNC` or an explicit `fdatasync` macro is supplied; this build supplies neither. Separate serving observation records the actual syscall choice, not just the C macro.

The experiments therefore explain the approximately threefold gap without invoking a different disk: **buffered `fsync` remains near 8 ms; buffered `fdatasync` on already initialized extents can be near 2.6 ms. Growing or converting unwritten extents removes that fast `fdatasync` case.** The allocation dependence is consistent with ext4 metadata/journal work; it does not isolate how much time belongs to journal barriers versus the NVMe controller. No historical block trace was retained, so this is a reproduced mechanism, not a reconstruction of every old PG flush. The old SQLite ≈7.9 ms measurement is reproduced on this host.

No `HAVE_FDATASYNC` change, pragma change, WAL preallocation change or durability relaxation is applied to the product. WAL/FULL remains intact. The capacity results include the shipped cost; the faster microbenchmark arm is solely diagnostic evidence.
