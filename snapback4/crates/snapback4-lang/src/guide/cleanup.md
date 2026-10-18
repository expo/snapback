# Background cleanup and active-row references

Mark a parent before resumable child cleanup, or retain history while accepting work only against active rows. Both recipes use ordinary rules and jobs.

```quarry
table folders:
  owner: principal
  archived: bool default false
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  online only
table entries:
  folder: folders on delete restrict
  owner: principal
  body: text <=200
  immutable folder, owner
  read <- .owner = viewer
  insert <- .owner = viewer and exists folders[id = .folder, owner = viewer, archived = false]
  delete <- .owner = viewer
  online only
mutation newFolder():
  return insert folders { owner: viewer }
mutation addEntry(folder: folders, body: text <=200):
  f = folders[folder] ! else NOT_FOUND
  require not f.archived else ARCHIVED
  return insert entries { folder: f.id, owner: viewer, body }
mutation archiveFolder(folder: folders):
  update folders[folder] { archived: true }
query activeFolders(c: cursor ?):
  return folders where .owner = viewer and not .archived first 50 by .id after c
job removeArchivedEntries():
  for entry in entries:
    f = folders[entry.folder] ! else NOT_FOUND
    if f.archived:
      delete entries[entry.id]
job removeEmptyArchivedFolders():
  for f in folders:
    if f.archived and not exists entries where .folder = f.id:
      delete folders[f.id]
```

Run `removeArchivedEntries`, then `removeEmptyArchivedFolders` as system jobs;
rerunning either is safe. New entries into an archived folder are refused by
the physical insert rule, even if a caller skips the mutation's require.
Existing child rows retain their own read rule during cleanup. This example
uses online-only data; a job is resumable, and does not promise atomic removal
of every child from every screen. Authorization recipes are in guide rule-recipes.

### Active-row references with retained history

When history should outlive an active row, choose `keep` and check existence
and active status when accepting new work. A reference type alone validates
the id, not existence or business status. The table insert rule below checks
physical existence; the mutation gives the caller a useful business refusal.

```quarry
table assets:
  owner: principal
  active: bool default true
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  online only
table assetHistory:
  asset: assets on delete keep
  owner: principal
  body: text <=200
  immutable asset, owner, body
  read <- .owner = viewer
  insert <- .owner = viewer and exists assets[id = .asset, owner = viewer, active = true]
  online only
mutation newAsset():
  return insert assets { owner: viewer }
mutation recordAsset(asset: assets, body: text <=200):
  current = assets[asset] ! else NOT_FOUND
  require current.active else INACTIVE
  return insert assetHistory { asset: current.id, owner: viewer, body }
mutation retireAsset(asset: assets):
  update assets[asset] { active: false }
mutation removeAsset(asset: assets):
  delete assets[asset]
```

After retirement, new records refuse `INACTIVE`; after deletion they refuse
`NOT_FOUND`. Existing history remains readable by its owner with its original
id value. No cap is needed for retained history. This is a write-time active
check, not ongoing inherited read authority or a general foreign-key promise.
There is no `checked` annotation: use explicit guards for the intended rule.

