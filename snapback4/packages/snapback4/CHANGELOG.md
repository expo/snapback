# Snapback 4 behavior changes

## 0.4.28

- Deploy/rollback narration counts incompatible stored values and dormant rows, cells and logical index entries separately. Unchanged scheduled source with changed dependencies gets a note. Graceful shutdown removes serve.lock; dead-owner reclaim is verbose-only.
- Upgrade and first check show runtime history even without a compiler comparison snapshot. Development warns after useMutation().run() has waited offline for 10 seconds; settlement and custody semantics stay unchanged.
- Rollback preview names missing operations and changed rule clauses. Rebuild clients against the selected release, or guard newer fields and operations across rollback (guide deploy).

- Compiler: required rows project to ids in reference destinations; decimal KB/MB/GB media bounds are accepted. Cascade repairs fit the joint reservation. Nullable references, sparse filters and private ownership proofs suppress only proved-safe notes; syntax refusals give checked repairs and direct why-code commands.
- Authorization: readable declared unique-key conflicts return E_UNIQUE; hidden conflicts retain ambiguous E_RULE. Developer queries/tests count encountered hidden row images outside wire replies. Bare persona principal arguments refuse on dev doors with the dev:name spelling; production arguments retain ordinary validation. Service-seat E_RULE explains the authored write clause for every private cause.
- Client runtime: run() still awaits terminal sent | failed, including reconnect while offline; { waitSeconds: 0 } still returns custody. The development offline warning changes no delivery behavior. useSignedInViewer retains its non-null type and now names the restoring/signed-in render gates. Generated mutation results become required only where stable read authority is proved; authority-loss and indirect/lifetime cases remain nullable.
- Starters and recipes: init --web --online selects browser journal writes/server reads without a web device. Adapt prints a preview and preserves edited files; --dry-run writes nothing and --apply changes recognized starter files. guide production covers account restoration, profiles, private directories, trusted enrollment and rollback; authorization recipes cover copied audiences, materialised access, reveal, redemption, anonymity and publication pointers. data --release inspects the selected release and SQL flags are diagnosed outside the SQL string.
- Proofs: snapback4/proof supplies bounded backend/frontend/browser helpers, private file logs, served identity and fresh UI waits. Web/Expo starters declare proof dependencies and read port ranges at execution. deploy --schema and test --source select saved complete sources without swapping working files; saved aliases resolve explicitly or refuse. Loaded-host qualification runs both starter UI proofs twice beside the Ubuntu/Alpine starter-toolchain checks.
- Membership pages cover party/static-role, compound and pure membership shapes. Hidden-parent inversion remains refused with checked source repairs.
- PAGE4 completes mixed owner/public/member pages, exact witness scopes, necessarily pinned membership components and required parent scalar snapshots. Named indexes normalize speculatively; rejected plans retain the authored scan. Online membership search provisions its reverse and scoped word indexes together. Readable lifetime-free negative points and finite enum complements can certify pages; hidden/timed absence cannot. Query point cuts report unavailable/incomplete, and acquired delivered history survives membership expiry. Completeness notes name actual guards and distinguish analyzer limits from partial evidence; branch-pages-v3 fences the new interpretation.

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
