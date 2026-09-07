# Interim Grok 0.0.15 acceptance audit

The full published-package Grok benchmark is still active; this is neither a final score nor a completed milestone claim. Root FULL read the current acceptance and coverage sources and the instrument M3 requirements, then compared the captured suite and browser receipts.

Read [REPORT.md](./REPORT.md) for the coverage findings. The suite reports pass while the corresponding quoted-reply browser check fails. All three remaining browser failures and the optional skip are retained. Missing-test fallback exists in source but did not activate in the captured M3 receipt. The report distinguishes insufficient proof from reproduced application failure.

`manifest.json` binds the complete external source snapshots and original receipts. The complete acceptance source remains at its recorded external path; only exact relevant line excerpts are copied here, avoiding unnecessary fixture credential duplication. The other four snapshots are copied byte-for-byte. No benchmark source, assertions, deadlines, populations, or live application files were edited. Final acceptance must be audited again before grading. Existing Convex/Supabase baselines remain retained; Office versus M5 is a hardware confound.

The live file was already partway through a subsequent attempt when copied; its four original rows remain in choreo-m3.jsonl. The complete 14:42:07 attempt cited here is choreo-m3-complete-144207.jsonl, retrieved from the earlier immutable snapshot and matched to the included suite by its recorded SHA256. See the report correction for this capture race.
