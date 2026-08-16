# Asset-cut import trusts `object_path` — path traversal plus hash oracle

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Assets, Host-ops, Admin, Security
**Date:** 2026-08-15
**Governing:** LLP 0044 (cut import / restore)
**Related:** `src/store_state.rs` `validate_relative_path` (the pattern to copy)
**Found while:** Whole-codebase security/correctness review (2026-08-15)

## Problem

`asset.importCut` validates a directory by joining each manifest
`object_path` onto the cut root with no confinement check:

```336:354:src/assets_cut.rs
        let path = dir.join(&blob.object_path);
        if !path.is_file() { ... }
        let observed = crate::assets_store::hash_path(&path)?;
        if observed.digest != blob.digest || observed.byte_length != blob.byte_length {
            return Err(cut_error(
                "SNAPBACK_ASSET_IMPORT_DIGEST_MISMATCH",
                format!(
                    "blob object {} does not match the manifest ({} bytes, sha256 {})",
                    blob.object_path, observed.byte_length, observed.digest
                ),
            ));
        }
```

Apply rereads the same path (`src/local.rs:8795-8804`) and `put_blob_idempotent`s
the bytes.

`Path::join` on Unix **replaces** the base when the second component is
absolute, and `../` walks out of the export dir. Export-generated paths are
always `blobs/sha256/<hex>` (`assets_cut.rs:278`). Import trusts the JSON.

This is not apply-only. Default `apply: false` still opens and hashes every
listed path. A digest mismatch returns the **real SHA-256 and length** of
whatever file the server process can read (`~/.ssh/id_rsa`, the instance
SQLite, `.agent-local-secrets.md`).

Store export already has `validate_relative_path`
(`src/store_state.rs:1016-1030`). The cut path does not.

## Threat

Admin/host-ops (`asset.importCut`) of an untrusted cut — a third-party
backup, a planted `asset-cut.manifest.json` next to a legitimate directory.
No unauthenticated route. Still a confused-deputy read of any file the
snapback uid can open, plus a hash oracle. With
`SNAPBACK_ASSET_IMPORT_EXPERIMENTAL=1` and `apply: true`, the same path is
copied into the blob store.

## Desired outcome

Admit only `blobs/sha256/<64 lowercase hex>`. After join, require the
canonicalized path stays under `dir` (same rules as `validate_relative_path`:
no absolute, no `..`, no symlink escape). Digest-mismatch diagnostics must
not echo the observed hash/length of a refused path.

## Acceptance

- `../etc/passwd`, `/etc/passwd`, and symlink-escape `object_path` values
  refuse as `SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID` before any read.
- Validate-only does not open files outside the cut root.
- Apply of a well-formed export directory is unchanged.
