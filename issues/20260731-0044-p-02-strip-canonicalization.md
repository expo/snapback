# 0044 P-02: EXIF extraction and strip canonicalization

**Status:** OPEN. **Authority:** LLP 0044 §Restricted staging and
trusted finalization (privacy rewriting before digesting), §Generated
upload intents (location policy), §Deduplication (canonical bytes).

`kamadak-exif` extraction of orientation + captured-at into typed media
facts (never location). Strip canonicalization = decode → orientation
transform → re-encode (re-encoding structurally drops all metadata);
canonical SHA-256 digested AFTER rewriting; canonicalization policy tag
moves off `none` for strip-image intents (blob identity includes it);
expansion beyond the intent byte bound refuses. Retain-declared images
bypass rewriting (policy `none`) with policy evidence in receipts.
Finalizer's strip defense-refusal flips to real processing for image/*
under strip, keyed off the image-finalization capability fact so P-05's
flip activates it; video stays refused.

Done when: GPS-strip end-to-end proves no location in any deliverable
blob with orientation applied and captured-at retained; strip-vs-retain
digests differ; strip dedups with strip; expansion refusal tested.
