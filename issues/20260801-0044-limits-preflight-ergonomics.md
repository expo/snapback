# Limits discoverability: make declared ceilings actionable client-side

**Status:** OPEN — from the LLP 0139 bakeoff (field-wide finding)

Three of five App C arms made the author discover size limits by
failing (Supabase: three ceilings, three error shapes, none
discoverable up front; TUS OPTIONS advertising no capabilities;
Firebase: bare 404 on unprovisioned storage). Snapback is best-in-field
server-side — the capability manifest declares chunk bound, quota,
minimum unit, TTLs — but the bakeoff showed the client does not consume
them: the driver discovered the (defective, since-fixed) chunk ceiling
by 413, exactly the field's discover-by-failure norm.

Fix: the asset client preflights against the manifest's declared facts —
chunk size from the declared chunk fact (not a hardcoded default),
file-size refusal client-side against remaining quota/bounds where
knowable, and a documented "limits" section on the guide assets page
sourced from the manifest. Also honor the diary's TUS note: advertise
`Tus-Max-Size`/extensions on the TUS OPTIONS response — we implement
the extensions; we should say so on the wire like the protocol intends.

Evidence: diaries/0048-upload-bakeoff-clip-locker.diary.md (Snapback
finding 1 + Supabase frictions + App C steal list item 3);
demos/upload-bakeoff/reports/summary.md (operational-surface axis).
