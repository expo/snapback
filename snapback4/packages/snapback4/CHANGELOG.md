# Snapback 4 behavior changes

## 0.4.28

- Deploy/rollback narration counts incompatible stored values and dormant rows, cells and logical index entries separately. Unchanged scheduled source with changed dependencies gets a note. Graceful shutdown removes serve.lock; dead-owner reclaim is verbose-only.
- Upgrade and first check show runtime history even without a compiler comparison snapshot. Development warns after useMutation().run() has waited offline for 10 seconds; settlement and custody semantics stay unchanged.
- Rollback preview names missing operations and changed rule clauses. Rebuild clients against the selected release, or guard newer fields and operations across rollback (guide deploy).

## 0.4.27

- Expo web starters omit the SVG favicon that the Expo image pipeline rejected; adapt repairs that old generated setting while preserving custom assets.
- Mounted Exact device files that are missing or unreadable get a file/build diagnostic. Rebuild with bun exact.mjs snapback --rebuild.
- Client runtime: useMutation().run() retains 0.4.26's terminal-settlement behavior, including waiting offline for reconnect; no further settlement change.

## 0.4.26

- Client runtime: useMutation().run() now waits for sent | failed; offline it waits for reconnect. Pass { waitSeconds: 0 } for immediate custody (pending), and observe the write receipt separately. The settlement observer survives component unmount.
- Keyed aggregates: a hidden key reads null; an authorized missing count group reads 0. Generated private keyed-count results may change from number to number | null. Use qtySum[room] ?? 0 only when treating hidden/missing values as zero is your application policy.
- A whole service-seat branch can bootstrap the first member of a synced roster. Service probes and table writes still obey the caller's read/write rules (guide deploy).
- Release selection excludes failed adoption candidates; bare rollback selects the previous committed activation, and latest selects the latest successful release. Preview rehearses the actual activation on a private snapshot.
- Upgrade pins core and installed Expo adapters together and compares compiler notes, types and refusals when a successful check snapshot is available. Rebuild native/Exact devices after upgrading their runtime.

History begins at 0.4.26. Older upgrades receive all recorded entries; this file does not reconstruct changes before that version. Compiler deltas remain schema-specific and separate from client runtime history.
